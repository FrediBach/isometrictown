/**
 * Image mode: a town laid out from an image instead of the map, so that the drawing seen from a
 * step away looks like the image. See docs/plans/image-mode.md.
 *
 * The image is read into a target (`image-read.ts`) and the ground zoned to match it
 * (`image-zones.ts`). Water, parks, woods, fields and squares take the zones' own outlines
 * (`image-water.ts`), the streets are laid out over the built zones (`image-streets.ts`), and
 * the blocks between them are cut into lots (`image-blocks.ts`), each with buildings the way its
 * zone builds, and a few landmarks (`image-buildings.ts`).
 */
import { Camera } from './camera';
import { Frame, ringArea, type LngLat } from './geo';
import { blocksOf, Occupancy, type Block } from './image-blocks';
import { buildingsOf, landmarks, ROW_LOT_MM, type BuildContext } from './image-buildings';
import { centre, Footprints, Ground } from './image-check';
import { ALLOTMENTS, FIELDS, landOf, patchwork, treesOf } from './image-ground';
import { tune, type Prediction, type Seen } from './image-tune';
import { readImage, type Target } from './image-read';
import { streets, type Graph } from './image-streets';
import { colourCounts, zone, type Zones } from './image-zones';
import { reachHeight } from './render';
import { hash } from './rng';
import type { Settings } from './settings';
import { IMAGE_STYLE, STYLES, type Region, type Style, type StyleId } from './styles';
import { empty, type Town } from './tiles';

export { plausibility } from './image-check';

/** An image, normalised on the main thread: at most 1024 px on its long side, as straight RGBA. `id` names its content. */
export type Picture = { id: string; name: string; w: number; h: number; rgba: Uint8ClampedArray };

/**
 * A nominal centre for each style. Only the latitude matters: it sets the sun, the side that gets
 * more windows and where palms grow, so they suit the style. The fictional `Frame` is built from it.
 */
export const STYLE_PLACE: Record<StyleId, LngLat> = {
  alpine: [9, 47],
  dutch: [5, 52],
  central: [10, 50],
  nordic: [15, 60],
  british: [-2, 53],
  french: [2, 47],
  mediterranean: [14, 40],
  eastern: [30, 50],
  arid: [8, 31],
  eastAsian: [135, 35],
  tropical: [100, 8],
  american: [-90, 40],
  antipodean: [150, -34],
  generic: [0, 48],
};

/** Styles that drive on the left. */
const LEFT = new Set<StyleId>(['british', 'antipodean']);

/** The settings an image-mode drawing is made with: a fictional place for the style, the image's name, and no OSM tags. */
export function drawnAs(set: Settings): Settings {
  const style = set.style === 'auto' ? IMAGE_STYLE : set.style;
  return { ...set, center: STYLE_PLACE[style], place: set.imageName || 'Image', osmTags: false };
}

/** The region an image-mode town stands in: no country, the chosen style. */
export function imageRegion(set: Settings): Region {
  const style = set.style === 'auto' ? IMAGE_STYLE : set.style;
  return { country: 'Image', code: '', style, left: LEFT.has(style) };
}

/** Everything a drawing from an image needs: the drawn-as settings, the camera, the target, the land plan and the town. */
export type Scene = { set: Settings; cam: Camera; frame: Frame; box: [number, number, number, number]; target: Target; zones: Zones; streets: Graph; blocks: Block[]; town: Town; region: Region; style: Style };

/**
 * Settings the town's layout depends on, besides the pens when colour counts (see
 * `colourCounts()`). Detail, pen width, sun, shadows and the layer switches only change how it
 * is drawn, so they never move a street.
 */
const STRUCTURE: (keyof Settings)[] = ['imageFit', 'imageFocus', 'imageLight', 'imageContrast', 'imageColour', 'mono', 'likeness', 'fabric', 'style', 'seed', 'sheet', 'landscape', 'margin', 'marginalia', 'scale', 'bearing', 'tilt', 'heightScale'];
/** And the target, on what decides how the drawing should look. */
const LOOK: (keyof Settings)[] = ['imageFit', 'imageFocus', 'imageLight', 'imageContrast', 'imageColour', 'mono', 'pens', 'customBackground', 'background', 'sheet', 'landscape', 'margin', 'marginalia'];

const keyOf = (pic: Picture, set: Settings, keys: (keyof Settings)[], more: unknown = null) => JSON.stringify([pic.id, ...keys.map((k) => set[k]), more]);

/** The last town laid out and the last target read, kept pristine: rendering writes into buildings. */
let laid: { key: string; zones: Zones; layout: Layout } | null = null;
let built: { key: string; town: Town } | null = null;
let read: { key: string; target: Target } | null = null;

/** Lay out the town for a picture (or take the last one, if nothing it depends on changed), reporting each step. */
export function imageScene(pic: Picture, set: Settings, note: (text: string) => void = () => {}): Scene {
  const drawn = drawnAs(set);
  const cam = new Camera(drawn);
  const frame = new Frame(drawn.center);
  const box = cam.region(reachHeight(drawn));
  const region = imageRegion(drawn);
  const style = STYLES[region.style];
  const lookKey = keyOf(pic, drawn, LOOK);
  if (read?.key !== lookKey) {
    note('Reading the image');
    read = { key: lookKey, target: readImage(pic, drawn, cam.rect) };
  }
  const target = read.target;
  const townKey = keyOf(pic, drawn, STRUCTURE, colourCounts(drawn) ? [drawn.pens, drawn.customBackground, drawn.background] : null);
  if (laid?.key !== townKey) {
    note('Zoning the ground');
    const zones = zone(target, drawn, cam, [box[0] - PLAN_MARGIN, box[1] - PLAN_MARGIN, box[2] + PLAN_MARGIN, box[3] + PLAN_MARGIN]);
    note('Laying out streets');
    laid = { key: townKey, zones, layout: imageLayout(zones, target, drawn, cam, frame, box, style, note) };
  }
  if (built?.key !== townKey) built = { key: townKey, town: imageBuild(laid.layout, target, drawn, cam, note).town };
  return { set: drawn, cam, frame, box, target, zones: laid.zones, streets: laid.layout.streets, blocks: laid.layout.blocks, town: structuredClone(built.town), region, style };
}

/** The land plan reaches this far beyond the ground that can show, m, so streets run off the sheet and buildings at its edge have neighbours. */
const PLAN_MARGIN = 150;
/** Cells of the occupancy raster that keeps lots and buildings off roads, open land and each other, m, at the finest. */
const OCCUPY = 0.75;

/**
 * The town for a land plan: the zones' outlines for water, parks, woods, fields and squares;
 * streets over the built zones; and along every street, buildings the way the zone it passes
 * through has them.
 */
/** The structure of a town (§4): its ground, streets, blocks and lots with their landmarks, and what laying buildings out on them needs. */
export type Layout = { town: Town; streets: Graph; blocks: Block[]; context: BuildContext };

/** Lay out a town's structure on a land plan: everything but the buildings and the trees tuning plants. */
export function imageLayout(zones: Zones, target: Target, set: Settings, cam: Camera, frame: Frame, box: [number, number, number, number], style: Style, note: (text: string) => void = () => {}): Layout {
  const town = empty();
  // Map-fixed keys, as `B.key` gives them, from the fictional frame.
  const key = (x: number, y: number): [number, number] => [Math.round(frame.mx0 + x / frame.k), Math.round(frame.my0 + y / frame.k)];
  const vary = (x: number, y: number, salt: number) => {
    const k = key(x, y);
    return hash(k[0], k[1], set.seed, salt);
  };

  // Ground: each kind of open land from its zones' outline, fields as a patchwork.
  const land = landOf(zones);
  town.water = land.water;
  town.waterCls = land.waterCls;
  town.plazas = land.plazas;
  const parks = land.parks;
  town.green = parks;
  town.wood = land.wood;
  const fields = patchwork(land.fields, FIELDS, vary);
  const allots = patchwork(land.allotments, ALLOTMENTS, vary);
  town.cover = [...land.cover, ...fields.cover, ...allots.cover];

  // Streets, paths and streams.
  const st = streets(zones, target, cam, { likeness: set.likeness, fabric: set.fabric, seed: set.seed, style: style.id }, parks);
  town.ways = [...st.ways, ...st.paths, ...fields.tracks, ...allots.tracks];
  town.plazas.push(...st.circles);
  town.streams = st.streams;
  town.landuse = land.landuse;

  // Blocks and their lots, kept off roads, paths, water, parks, woods and squares, and the landmarks among them.
  const occ = new Occupancy(zones.x0, zones.y0, Math.max(OCCUPY, zones.cell / 4), zones.W * zones.cell, zones.H * zones.cell);
  for (const w of st.ways) occ.way(w);
  for (const w of [...st.paths, ...fields.tracks, ...allots.tracks]) occ.way({ ...w, width: 1.5 }, 0.5);
  for (const s of [...town.water, ...parks, ...town.wood, ...town.plazas]) occ.fill(s.map((r) => r.pts));
  const mmPerMetre = 1000 / set.scale;
  note('Cutting blocks into lots');
  const blocks = blocksOf(st.graph, zones, vary, ROW_LOT_MM / mmPerMetre);
  const plazas = town.plazas.slice(0, town.plazas.length - st.circles.length);
  const ground = new Ground({ ways: town.ways, water: town.water, green: parks, wood: town.wood, plazas: town.plazas });
  const context: BuildContext = { z: zones, set, style, box, vary, occ, ground, laid: new Footprints(), plazas, parks, paths: st.paths, ways: st.ways, cores: st.cores, mmPerMetre };
  landmarks(blocks, context);
  return { town, streets: st.graph, blocks, context };
}

/**
 * Put up a town's buildings on its structure and plant its trees, leaving the structure as it was.
 * With `tuned`, the lots are first tuned to the target (§14), refined against how the drawing came
 * out when `seenBefore` says so (§14.3). Tuning gains no likeness yet (see the plan's notes from
 * M5), so drawings are built untuned.
 */
export function imageBuild(layout: Layout, target: Target, set: Settings, cam: Camera, note: (text: string) => void = () => {}, tuned = false, seenBefore?: Seen): { town: Town; blocks: Block[]; prediction: Prediction | null } {
  const town: Town = { ...layout.town, landuse: [...layout.town.landuse] };
  const blocks = structuredClone(layout.blocks);
  const ctx: BuildContext = { ...layout.context, set, occ: layout.context.occ.clone(), laid: new Footprints() };
  let prediction: Prediction | null = null;
  if (tuned) {
    note('Tuning to the image');
    prediction = tune(blocks, ctx.z, target, cam, set, ctx.box, { seenBefore });
  }
  note('Putting up buildings');
  const built = buildingsOf(blocks, ctx);
  town.buildings = built.buildings;
  town.tagged = built.tagged;
  town.pois = built.pois;
  town.landuse.push(...built.landuse);
  note('Planting trees');
  town.trees = treesOf(blocks, built.landuse.filter((a) => a.cls === 'cemetery'), ctx.laid, ctx.ground, ctx.vary);
  town.density = { built: [], shops: [] };
  for (const b of town.buildings) {
    if (b.context) continue;
    const p = b.shape[0].pts;
    const [cx, cy] = centre(p);
    town.density.built.push(cx, cy, Math.abs(ringArea(p)));
  }
  town.nearby = { landuse: town.landuse, pois: town.pois, numbers: [], helipads: [], ways: town.ways };
  return { town, blocks, prediction };
}

/** A town laid out and built in one go, untuned unless asked: for calibration and tests. */
export function imageTown(zones: Zones, target: Target, set: Settings, cam: Camera, frame: Frame, box: [number, number, number, number], style: Style, note: (text: string) => void = () => {}, tuned = false): { town: Town; streets: Graph; blocks: Block[] } {
  const layout = imageLayout(zones, target, set, cam, frame, box, style, note);
  const { town, blocks } = imageBuild(layout, target, set, cam, note, tuned);
  return { town, streets: layout.streets, blocks };
}
