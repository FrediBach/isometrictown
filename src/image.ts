/**
 * Image mode: a town laid out from an image instead of the map, so that the drawing seen from a
 * step away looks like the image. See docs/plans/image-mode.md.
 *
 * This is milestone M0: the plumbing end to end, with a deliberately crude town. Lightness alone
 * decides each block of a plain street grid, in the order of how much ink each lays down: paved
 * squares where the image is lightest, then water, then parks, then houses, packed closer and
 * taller the darker it gets. Zoning, streets that follow the image, parcels and tuning replace
 * it in later milestones.
 */
import { Camera } from './camera';
import { Frame, type LngLat } from './geo';
import { readImage, toneAt, type Target } from './image-read';
import { reachHeight } from './render';
import { hash } from './rng';
import type { Settings } from './settings';
import { IMAGE_STYLE, STYLES, type Region, type Style, type StyleId } from './styles';
import { empty, ROAD_WIDTH, type Area, type Building, type Shape, type Town, type Way } from './tiles';

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

/** Everything a drawing from an image needs: the drawn-as settings, the camera, the target and the town. */
export type Scene = { set: Settings; cam: Camera; frame: Frame; box: [number, number, number, number]; target: Target; town: Town; region: Region; style: Style };

/**
 * Settings the town's layout depends on. Detail, pen width, pens, sun, shadows and the layer
 * switches only change how it is drawn, so they never move a street.
 */
const STRUCTURE: (keyof Settings)[] = ['imageFit', 'imageFocus', 'imageLight', 'imageContrast', 'imageColour', 'likeness', 'fabric', 'style', 'seed', 'sheet', 'landscape', 'margin', 'marginalia', 'scale', 'bearing', 'tilt', 'heightScale'];
/** And the target, on what decides how the drawing should look. */
const LOOK: (keyof Settings)[] = ['imageFit', 'imageFocus', 'imageLight', 'imageContrast', 'imageColour', 'mono', 'pens', 'customBackground', 'background', 'sheet', 'landscape', 'margin', 'marginalia'];

const keyOf = (pic: Picture, set: Settings, keys: (keyof Settings)[]) => JSON.stringify([pic.id, ...keys.map((k) => set[k])]);

/** The last town laid out and the last target read, kept pristine: rendering writes into buildings. */
let laid: { key: string; town: Town } | null = null;
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
  const townKey = keyOf(pic, drawn, STRUCTURE);
  if (laid?.key !== townKey) {
    note('Laying out streets');
    laid = { key: townKey, town: imageTown(target, drawn, cam, frame, box, style) };
  }
  return { set: drawn, cam, frame, box, target, town: structuredClone(laid.town), region, style };
}

/** Street centre lines are this far apart, m. */
const PITCH = 64;
/** Every so many streets is a main road. */
const MAIN_EVERY = 4;
/** Houses along each long side of a block. */
const LOTS = 4;
/** Pavement between the road and the front of a block, m. */
const PAVEMENT = 2.5;
/** Buildings are laid out this far beyond the ground that can show, m, so the ones at the edge have neighbours. */
const MARGIN = 60;
/**
 * What a block becomes by how light the image is over it (0 the darkest the drawing gets, 1 bare
 * paper), lightest first: each takes the blocks at least as light as its `from`.
 */
const BANDS: { from: number; use: Use }[] = [
  { from: 0.9, use: 'square' },
  { from: 0.76, use: 'water' },
  { from: 0.62, use: 'green' },
  { from: -Infinity, use: 'houses' },
];
/** Lighter than this, a lot is left as garden. */
const HOUSES_BELOW = BANDS[2].from;

type Use = 'square' | 'water' | 'green' | 'houses';

/** The square around a point, as a counter-clockwise ring. */
const square = (x0: number, y0: number, x1: number, y1: number): Shape => [{ pts: [x0, y0, x1, y0, x1, y1, x0, y1], seam: new Uint8Array(4) }];

/**
 * The crude M0 town: a street grid over the whole ground box, each block water, green or houses
 * by how light the image is over it. Houses get more storeys where it is darker.
 */
export function imageTown(target: Target, set: Settings, cam: Camera, frame: Frame, box: [number, number, number, number], style: Style): Town {
  const town = empty();
  const [bx0, by0, bx1, by1] = box;
  const i0 = Math.floor((bx0 - MARGIN) / PITCH) - 1;
  const i1 = Math.ceil((bx1 + MARGIN) / PITCH) + 1;
  const j0 = Math.floor((by0 - MARGIN) / PITCH) - 1;
  const j1 = Math.ceil((by1 + MARGIN) / PITCH) + 1;
  const NI = i1 - i0;
  const NJ = j1 - j0;
  // Map-fixed keys, as `B.key` gives them, from the fictional frame.
  const key = (x: number, y: number): [number, number] => [Math.round(frame.mx0 + x / frame.k), Math.round(frame.my0 + y / frame.k)];
  const tone = (x: number, y: number, z: number) => toneAt(target, cam.sx(x, y), cam.sy(x, y, z));
  const main = (n: number) => ((n % MAIN_EVERY) + MAIN_EVERY) % MAIN_EVERY === 0;
  const half = (n: number) => (main(n) ? ROAD_WIDTH.secondary : ROAD_WIDTH.minor) / 2;

  // What each block is, from the mean tone over it; where there is no image, ordinary houses.
  const use: Use[] = new Array(NI * NJ);
  const level = new Float32Array(NI * NJ);
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      let sum = 0;
      let n = 0;
      for (let u = 0; u < 3; u++)
        for (let v = 0; v < 3; v++) {
          const t = tone((i + (u + 0.5) / 3) * PITCH, (j + (v + 0.5) / 3) * PITCH, 0);
          if (t === null) continue;
          sum += t;
          n++;
        }
      const t = n ? sum / n : 0.5;
      const k = (i - i0) * NJ + (j - j0);
      level[k] = t;
      use[k] = BANDS.find((b) => t >= b.from)?.use ?? 'houses';
    }
  }
  const at = (i: number, j: number): Use => (i < i0 || i >= i1 || j < j0 || j >= j1 ? 'houses' : use[(i - i0) * NJ + (j - j0)]);

  // Streets on every grid line, except between two blocks of water.
  const ways: Way[] = [];
  const street = (pts: number[], n: number) => ways.push({ pts, kind: 'road', width: half(n) * 2, cls: main(n) ? 'secondary' : 'minor' });
  for (let i = i0; i <= i1; i++) {
    let run: number[] = [];
    for (let j = j0; j < j1; j++) {
      const keep = at(i - 1, j) !== 'water' || at(i, j) !== 'water';
      if (keep) {
        if (!run.length) run.push(i * PITCH, j * PITCH);
        run.push(i * PITCH, (j + 1) * PITCH);
      } else if (run.length) {
        street(run, i);
        run = [];
      }
    }
    if (run.length) street(run, i);
  }
  for (let j = j0; j <= j1; j++) {
    let run: number[] = [];
    for (let i = i0; i < i1; i++) {
      const keep = at(i, j - 1) !== 'water' || at(i, j) !== 'water';
      if (keep) {
        if (!run.length) run.push(i * PITCH, j * PITCH);
        run.push((i + 1) * PITCH, j * PITCH);
      } else if (run.length) {
        street(run, j);
        run = [];
      }
    }
    if (run.length) street(run, j);
  }
  town.ways = ways;

  // Blocks: water to the street centre lines (the streets lie over it), green or houses inside the pavements.
  const buildings: Building[] = [];
  const landuse: Area[] = [];
  const inBox = (x: number, y: number, pad: number) => x >= bx0 - pad && x <= bx1 + pad && y >= by0 - pad && y <= by1 + pad;
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      const k = (i - i0) * NJ + (j - j0);
      const X0 = i * PITCH;
      const Y0 = j * PITCH;
      if (use[k] === 'water') {
        town.water.push(square(X0, Y0, X0 + PITCH, Y0 + PITCH));
        town.waterCls.push('lake');
        continue;
      }
      const x0 = X0 + half(i) + PAVEMENT;
      const x1 = X0 + PITCH - half(i + 1) - PAVEMENT;
      const y0 = Y0 + half(j) + PAVEMENT;
      const y1 = Y0 + PITCH - half(j + 1) - PAVEMENT;
      if (use[k] === 'square') {
        town.plazas.push(square(x0, y0, x1, y1));
        continue;
      }
      if (use[k] === 'green') {
        town.green.push(square(x0, y0, x1, y1));
        continue;
      }
      landuse.push({ shape: square(x0, y0, x1, y1), cls: 'residential' });
      // Darker blocks get more, wider and deeper houses, up to a closed row.
      const dense = 1 - Math.max(0, Math.min(1, level[k] / HOUSES_BELOW));
      const lots = LOTS + Math.round(dense * 2);
      const lot = (x1 - x0) / lots;
      for (const side of [-1, 1]) {
        for (let n = 0; n < lots; n++) {
          const cx = x0 + (n + 0.5) * lot;
          const edge = side > 0 ? y1 : y0;
          const [k0, k1] = key(cx, edge);
          const w = Math.min(lot - 0.5, lot * (0.55 + 0.45 * dense) + 2 * hash(k0, k1, set.seed, 14001));
          const d = 8 + 4 * dense + 3 * hash(k0, k1, set.seed, 14002);
          const back = (3 + 2.5 * hash(k0, k1, set.seed, 14003)) * (1 - 0.8 * dense);
          const ya = side > 0 ? edge - back - d : edge + back;
          if (!inBox(cx, ya, MARGIN)) continue;
          // Each house follows the image where its roof shows, a few metres up.
          const t = tone(cx, ya + d / 2, 4) ?? level[k];
          if (t >= HOUSES_BELOW + 0.05) continue;
          const dark = 1 - Math.max(0, Math.min(1, t / HOUSES_BELOW));
          const storeys = Math.max(1, Math.min(6, Math.round(1 + dark * 5 + (hash(k0, k1, set.seed, 14004) - 0.5) * 0.8)));
          const b: Building = { shape: square(cx - w / 2, ya, cx + w / 2, ya + d), h: storeys * style.floor, min: 0 };
          if (!inBox(cx, ya, 0)) b.context = true;
          buildings.push(b);
          town.density.built.push(cx, ya + d / 2, w * d);
        }
      }
    }
  }
  town.buildings = buildings;
  town.landuse = landuse;
  town.nearby = { landuse, pois: [], numbers: [], helipads: [], ways };
  return town;
}
