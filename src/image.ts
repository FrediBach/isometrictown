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
import { villageRailway } from './image-rail';
import { rockSites } from './image-rock';
import { ferryLandings } from './image-ferries';
import { Camera } from './camera';
import { Frame, pointInRing, ringArea, type LngLat } from './geo';
import { amenitiesOf, parkingSites } from './image-amenities';
import { blocksOf, Occupancy, type Block } from './image-blocks';
import { FloorplanGuides } from './image-floorplans';
import { buildingsOf, fieldBarns, landmarks, ROW_LOT_MM, type BuildContext, type FrontageLot } from './image-buildings';
import { centre, Footprints, Ground } from './image-check';
import { densityOf } from './image-density';
import { ALLOTMENTS, FIELDS, landOf, patchwork, treesOf } from './image-ground';
import { imageHeights } from './image-heights';
import { tune, type Prediction, type Seen } from './image-tune';
import { fitImage } from './image-fit';
import { activeMasks, BUILD_KEYS, groundValue, LAYOUT_KEYS, MaskField, masksKey, READ_KEYS, type MaskKey } from './image-masks';
import { readImage, remapTarget, targetGrid, type Target } from './image-read';
import { streets, tramRoute, type Graph } from './image-streets';
import { zone, type Zones } from './image-zones';
import { reachHeight, streamShapes } from './render';
import { hash } from './rng';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { IMAGE_STYLE, STYLES, type Region, type Style, type StyleId } from './styles';
import { empty, type Shape, type Town } from './tiles';

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
export type Scene = { set: Settings; cam: Camera; frame: Frame; box: [number, number, number, number]; target: Target; zones: Zones; streets: Graph; blocks: Block[]; town: Town; region: Region; style: Style; prediction?: Prediction; /** The settings masks change over parts of the picture, on the target's grid. */ masks?: MaskField };

/**
 * Settings the layout depends on. Colour zoning uses the Classic pens on white paper.
 * Detail, pen width, pen colours, sun, shadows and the layer switches only change how it
 * is drawn, so they never move a street.
 */
const LOOK: (keyof Settings)[] = ['imageFit', 'imageFocus', 'imageLight', 'imageContrast', 'imageColour', 'mono', 'sheet', 'landscape', 'margin', 'marginalia'];
const ZONING: (keyof Settings)[] = [...LOOK, 'likeness', 'imageNeighbours', 'scale', 'bearing', 'tilt', 'heightScale'];
const STRUCTURE: (keyof Settings)[] = [...ZONING, 'imageRoundabouts', 'imageRoadWinding', 'imageContours', 'fabric', 'style', 'seed'];

const keyOf = (pic: Picture, set: Settings, keys: (keyof Settings)[]) => JSON.stringify([pic.id, ...keys.map((k) => set[k])]);

/** The last town laid out and the last target read, kept pristine: rendering writes into buildings. */
let laid: { key: string; zoneKey: string; zones: Zones; layout: Layout } | null = null;
let built: { key: string; density: number; floorplans: number; masks: string; town: Town } | null = null;
let read: { key: string; target: Target } | null = null;

/** Lay out the town for a picture, reusing the last layout. The lab can request a tuned build of its own. */
export function imageScene(pic: Picture, set: Settings, note: (text: string) => void = () => {}, tuned = false): Scene {
  const drawn = drawnAs(set);
  const cam = new Camera(drawn);
  const frame = new Frame(drawn.center);
  const box = cam.region(reachHeight(drawn));
  const region = imageRegion(drawn);
  const style = STYLES[region.style];
  const reference = { ...drawn, pens: DEFAULT_SETTINGS.pens, customBackground: false };
  // Masks are drawn on the picture, so they follow it wherever the crop puts it on the sheet.
  const masks = activeMasks(drawn.imageMasks).length
    ? new MaskField(drawn.imageMasks, drawn, targetGrid(cam.rect), fitImage(cam.rect, pic.w, pic.h, drawn.imageFit, drawn.imageFocus), pic)
    : undefined;
  const readMasks = masksKey(drawn.imageMasks, READ_KEYS);
  const layoutMasks = masksKey(drawn.imageMasks, [...READ_KEYS, ...LAYOUT_KEYS]);
  const lookKey = keyOf(pic, drawn, LOOK) + readMasks;
  if (read?.key !== lookKey) {
    note('Reading the image');
    read = { key: lookKey, target: readImage(pic, reference, cam.rect, masks) };
  }
  const target = read.target;
  const townKey = keyOf(pic, drawn, STRUCTURE) + layoutMasks;
  if (laid?.key !== townKey) {
    const zoneKey = keyOf(pic, drawn, ZONING) + layoutMasks;
    let zones = laid?.zones;
    if (!zones || laid?.zoneKey !== zoneKey) {
      note('Zoning the ground');
      zones = zone(target, reference, cam, [box[0] - PLAN_MARGIN, box[1] - PLAN_MARGIN, box[2] + PLAN_MARGIN, box[3] + PLAN_MARGIN], { likeness: localOf(masks, cam, 'likeness'), neighbours: localOf(masks, cam, 'imageNeighbours') });
    }
    note('Laying out streets');
    laid = { key: townKey, zoneKey, zones, layout: imageLayout(zones, target, drawn, cam, frame, box, style, note, masks) };
  }
  const scene = { set: drawn, cam, frame, box, target: remapTarget(target, drawn), zones: laid.zones, streets: laid.layout.streets, region, style, masks };
  if (tuned) {
    const experiment = imageBuild(laid.layout, scene.target, drawn, cam, note, true, undefined, masks);
    return { ...scene, blocks: experiment.blocks, town: experiment.town, prediction: experiment.prediction! };
  }
  const buildMasks = masksKey(drawn.imageMasks, BUILD_KEYS);
  if (built?.key !== townKey || built.density !== drawn.imageDensity || built.floorplans !== drawn.imageFloorplans || built.masks !== buildMasks) {
    built = { key: townKey, density: drawn.imageDensity, floorplans: drawn.imageFloorplans, masks: buildMasks, town: imageBuild(laid.layout, target, { ...drawn, imageRelief: 0 }, cam, note, false, undefined, masks).town };
  }
  const town = structuredClone(built.town);
  imageHeights(town, target, cam, drawn, laid.layout.context, masks);
  return { ...scene, blocks: laid.layout.blocks, town };
}

/** A setting at a ground position where masks set it for part of the picture. */
function localOf(masks: MaskField | undefined, cam: Camera, key: MaskKey): ((x: number, y: number) => number) | undefined {
  return masks?.varies(key) ? (x, y) => groundValue(masks, cam, key, x, y) : undefined;
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
export function imageLayout(zones: Zones, target: Target, set: Settings, cam: Camera, frame: Frame, box: [number, number, number, number], style: Style, note: (text: string) => void = () => {}, masks?: MaskField): Layout {
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
  const st = streets(zones, target, cam, { likeness: set.likeness, imageContours: set.imageContours, fabric: set.fabric, seed: set.seed, style: style.id, vary, roundabouts: set.imageRoundabouts, winding: set.imageRoadWinding, likenessAt: localOf(masks, cam, 'likeness'), roundaboutsAt: localOf(masks, cam, 'imageRoundabouts'), contours: masks?.field('imageContours') ?? undefined }, parks);
  town.controls = st.controls;
  // Roundabout islands: nothing is laid on them, and the renderer plants them.
  const islands: Shape[] = st.roundabouts.map((o) => [{ pts: o.pts.slice(0, -2), seam: new Uint8Array(o.pts.length / 2 - 1) }]);
  town.ways = [...st.ways, ...st.paths, ...fields.tracks, ...allots.tracks];
  const tram = tramRoute(st.ways, st.cores);
  if (tram) town.ways.push(tram);
  town.plazas.push(...st.circles);
  town.streams = st.streams;
  town.landuse = land.landuse;

  // Blocks and their lots, kept off roads, paths, water, parks, woods and squares, and the landmarks among them.
  const occ = new Occupancy(zones.x0, zones.y0, Math.max(OCCUPY, zones.cell / 4), zones.W * zones.cell, zones.H * zones.cell);
  for (const w of st.ways) occ.way(w);
  for (const w of [...st.paths, ...fields.tracks, ...allots.tracks]) occ.way({ ...w, width: 1.5 }, 0.5);
  const streams = streamShapes(town.streams);
  for (const s of [...town.water, ...streams, ...parks, ...town.wood, ...town.plazas, ...islands]) occ.fill(s.map((r) => r.pts));
  const landings = ferryLandings(town, cam, occ, vary);
  town.ways.push(...landings);
  parkingSites(town, zones, occ, vary);
  const mmPerMetre = 1000 / set.scale;
  note('Cutting blocks into lots');
  const blocks = blocksOf(st.graph, zones, vary, ROW_LOT_MM / mmPerMetre).filter((b) => !st.roundabouts.some((o) => pointInRing(...centre(b.face), o.pts)));
  const plazas = town.plazas.slice(0, town.plazas.length - st.circles.length);
  const ground = new Ground(town);
  const context: BuildContext = { cam, target, z: zones, set, style, box, vary, occ, ground, laid: new Footprints(), plazas, parks, paths: [...st.paths, ...landings], ways: st.ways, cores: st.cores, mmPerMetre };
  // Compare rail alignments against the homes that would stand here without a railway.
  // Only draw up those footprints if the station search has a usable street frontage.
  villageRailway(town, st.cores, zones, cam, target, occ, streams, vary,
    () => buildingsOf(blocks, { ...context, occ: occ.clone(), laid: new Footprints() }).buildings);
  if (town.buildings.length) context.ground = new Ground(town);
  rockSites(town, land.cover.filter(a => a.cls === 'meadow'), cam, target, context.ground, occ, vary);
  landmarks(blocks, context);
  return { town, streets: st.graph, blocks, context };
}

/**
 * Put up a town's buildings on its structure and plant its trees, leaving the structure as it was.
 * With `tuned`, the lots are first tuned to the target (§14), refined against how the drawing came
 * out when `seenBefore` says so (§14.3). Tuning gains no likeness yet (see the plan's notes from
 * M5), so drawings are built untuned.
 */
export function imageBuild(layout: Layout, target: Target, set: Settings, cam: Camera, note: (text: string) => void = () => {}, tuned = false, seenBefore?: Seen, masks?: MaskField): { town: Town; blocks: Block[]; prediction: Prediction | null } {
  // Buildings add land use, and rendering can put roundabout islands in the parks.
  const town: Town = { ...layout.town, green: [...layout.town.green], landuse: [...layout.town.landuse] };
  const blocks = structuredClone(layout.blocks);
  let density = set.imageDensity !== 0 ? densityOf(target, cam, set.imageDensity < 0) : undefined;
  let densityAmount: ((x: number, y: number) => number) | undefined;
  if (masks?.varies('imageDensity')) {
    // Where masks set it, the sign picks thinning or filling and the size how far it goes.
    const fill = densityOf(target, cam), thin = densityOf(target, cam, true);
    const strength = (x: number, y: number) => groundValue(masks, cam, 'imageDensity', x, y);
    density = (x, y) => {
      const s = strength(x, y);
      return s > 0 ? fill(x, y) : s < 0 ? thin(x, y) : 0;
    };
    densityAmount = (x, y) => Math.min(1, Math.abs(strength(x, y)));
  }
  const floorplans = masks?.varies('imageFloorplans') ? masks : undefined;
  const guides = floorplans
    ? floorplans.peak('imageFloorplans') > 0 ? new FloorplanGuides(target, cam, (sx, sy) => floorplans.at('imageFloorplans', sx, sy)) : undefined
    : set.imageFloorplans > 0 ? new FloorplanGuides(target, cam, set.imageFloorplans) : undefined;
  const buildingGround = (): BuildContext => ({ ...layout.context, set, density, densityAmount, guides, occ: layout.context.occ.clone(), laid: new Footprints() });
  let prediction: Prediction | null = null;
  let tunedFronts: Map<number, FrontageLot> | undefined;
  if (tuned) {
    // The streets take only ground left free by the block lots. Find the exact plots first so
    // the predictor changes real rows; the final placement checks every changed footprint again.
    const fronts: FrontageLot[] = [];
    buildingsOf(blocks, buildingGround(), { record: fronts });
    note('Tuning to the image');
    prediction = tune(blocks, layout.context.z, target, cam, set, layout.context.box, { seenBefore, frontages: fronts });
    tunedFronts = new Map(fronts.map((l) => [l.index, l]));
  }
  note('Putting up buildings');
  const ctx = buildingGround();
  const built = buildingsOf(blocks, ctx, tunedFronts ? { tuned: tunedFronts } : undefined);
  town.buildings = [...built.buildings, ...layout.town.buildings];
  town.tagged = [...built.tagged, ...layout.town.tagged];
  town.pois = [...built.pois, ...layout.town.pois];
  for (const b of layout.town.buildings) ctx.laid.add(b.shape[0].pts);
  for (const a of town.landuse) if (a.cls === 'railway') ctx.laid.add(a.shape[0].pts);
  town.pools = built.pools;
  town.landuse.push(...built.landuse);
  fieldBarns(town, ctx);
  amenitiesOf(town, ctx);
  note('Planting trees');
  town.trees = treesOf(blocks, built.landuse.filter((a) => a.cls === 'cemetery'), ctx.laid, ctx.ground, ctx.vary);
  town.density = { built: [], shops: [] };
  for (const p of town.pois) if (p.cls === 'shop') town.density.shops.push(p.x, p.y);
  for (const b of town.buildings) {
    if (b.context) continue;
    const p = b.shape[0].pts;
    const [cx, cy] = centre(p);
    town.density.built.push(cx, cy, Math.abs(ringArea(p)));
  }
  town.nearby = { landuse: town.landuse, pois: town.pois, numbers: [], helipads: [], ways: town.ways };
  // Drawings shape heights afterwards, on a copy, with the masks' own strengths.
  imageHeights(town, target, cam, set, ctx, set.imageRelief > 0 ? masks : undefined);
  return { town, blocks, prediction };
}

/** A town laid out and built in one go, untuned unless asked: for calibration and tests. */
export function imageTown(zones: Zones, target: Target, set: Settings, cam: Camera, frame: Frame, box: [number, number, number, number], style: Style, note: (text: string) => void = () => {}, tuned = false): { town: Town; streets: Graph; blocks: Block[] } {
  const layout = imageLayout(zones, target, set, cam, frame, box, style, note);
  const { town, blocks } = imageBuild(layout, target, set, cam, note, tuned);
  return { town, streets: layout.streets, blocks };
}
