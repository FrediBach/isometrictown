/**
 * Image mode: a town laid out from an image instead of the map, so that the drawing seen from a
 * step away looks like the image. See docs/plans/image-mode.md.
 *
 * The image is read into a target (`image-read.ts`) and the ground zoned to match it
 * (`image-zones.ts`). Streets are still a plain grid (M2 replaces it): each block of it takes the
 * zone that covers most of it and is laid out simply for its kind, from fields and woods to
 * terraced rows, perimeter blocks and towers. Streets don't run through water, woods, fields or
 * parks, so those read as whole areas.
 */
import { Camera } from './camera';
import { Frame, type LngLat } from './geo';
import { readImage, type Target } from './image-read';
import { BUILT, LABELS, type Label } from './image-tone';
import { colourCounts, labelAt, zone, type Zones } from './image-zones';
import { reachHeight } from './render';
import { hash } from './rng';
import type { Settings } from './settings';
import { IMAGE_STYLE, STYLES, type Region, type Style, type StyleId } from './styles';
import { empty, ROAD_WIDTH, type Area, type Building, type Shape, type Tagged, type Town, type Way } from './tiles';

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
export type Scene = { set: Settings; cam: Camera; frame: Frame; box: [number, number, number, number]; target: Target; zones: Zones; town: Town; region: Region; style: Style };

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
let laid: { key: string; town: Town; zones: Zones } | null = null;
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
    const grid = gridOf(box);
    const zones = zone(target, drawn, cam, [grid.i0 * PITCH, grid.j0 * PITCH, grid.i1 * PITCH, grid.j1 * PITCH]);
    note('Laying out streets');
    laid = { key: townKey, zones, town: imageTown(zones, drawn, frame, box, style) };
  }
  return { set: drawn, cam, frame, box, target, zones: laid.zones, town: structuredClone(laid.town), region, style };
}

/** Street centre lines are this far apart, m. */
const PITCH = 64;
/** Every so many streets is a main road. */
const MAIN_EVERY = 4;
/** Pavement between the road and the front of a block, m. */
const PAVEMENT = 2.5;
/** Buildings are laid out this far beyond the ground that can show, m, so the ones at the edge have neighbours. */
const MARGIN = 60;
/** Zones no street runs through: a street between two of them is left out. */
const NO_STREET = new Set<Label>(['water', 'wood', 'field', 'meadow', 'sand', 'park']);
/** Storeys of each built label at its lowest and highest level. */
const STOREYS: Partial<Record<Label, [number, number]>> = { suburb: [1, 2], rows: [2, 3], old: [3, 5], blocks: [4, 7], towers: [10, 24] };

/** The street grid's blocks that cover a box, with a margin for buildings beyond it. */
function gridOf(box: readonly number[]) {
  const [bx0, by0, bx1, by1] = box;
  return { i0: Math.floor((bx0 - MARGIN) / PITCH) - 1, i1: Math.ceil((bx1 + MARGIN) / PITCH) + 1, j0: Math.floor((by0 - MARGIN) / PITCH) - 1, j1: Math.ceil((by1 + MARGIN) / PITCH) + 1 };
}

/** The square around a point, as a counter-clockwise ring. */
const square = (x0: number, y0: number, x1: number, y1: number): Shape => [{ pts: [x0, y0, x1, y0, x1, y1, x0, y1], seam: new Uint8Array(4) }];

type Block = { label: Label; level: number; warmth: number };

/**
 * The town for a land plan, on a street grid over the whole ground box: each block takes the
 * zone that covers most of it, and is filled the way that kind of place is.
 */
export function imageTown(zones: Zones, set: Settings, frame: Frame, box: [number, number, number, number], style: Style): Town {
  const town = empty();
  const [bx0, by0, bx1, by1] = box;
  const { i0, i1, j0, j1 } = gridOf(box);
  const NJ = j1 - j0;
  // Map-fixed keys, as `B.key` gives them, from the fictional frame.
  const key = (x: number, y: number): [number, number] => [Math.round(frame.mx0 + x / frame.k), Math.round(frame.my0 + y / frame.k)];
  const main = (n: number) => ((n % MAIN_EVERY) + MAIN_EVERY) % MAIN_EVERY === 0;
  const half = (n: number) => (main(n) ? ROAD_WIDTH.secondary : ROAD_WIDTH.minor) / 2;

  // Each block is what most of it is zoned as, at that zone's mean level and warmth.
  const blocks: Block[] = new Array((i1 - i0) * NJ);
  const S = 4;
  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      const votes = new Map<Label, [number, number, number]>();
      for (let u = 0; u < S; u++)
        for (let v = 0; v < S; v++) {
          const x = (i + (u + 0.5) / S) * PITCH;
          const y = (j + (v + 0.5) / S) * PITCH;
          const l = labelAt(zones, x, y) ?? 'suburb';
          const c = Math.floor((y - zones.y0) / zones.cell) * zones.W + Math.floor((x - zones.x0) / zones.cell);
          const t = votes.get(l) ?? [0, 0, 0];
          t[0]++;
          t[1] += zones.level[c] ?? 0.5;
          t[2] += zones.warmth[c] ?? 1;
          votes.set(l, t);
        }
      let best: Label = 'suburb';
      let n = -1;
      for (const [l, t] of votes) if (t[0] > n || (t[0] === n && LABELS.indexOf(l) < LABELS.indexOf(best))) [best, n] = [l, t[0]];
      const t = votes.get(best)!;
      blocks[(i - i0) * NJ + (j - j0)] = { label: best, level: t[1] / t[0], warmth: t[2] / t[0] };
    }
  }
  const at = (i: number, j: number): Block => (i < i0 || i >= i1 || j < j0 || j >= j1 ? { label: 'suburb', level: 0.5, warmth: 1 } : blocks[(i - i0) * NJ + (j - j0)]);
  /** Whether the street on grid line x = i runs past block row j, and the one on y = j past column i. */
  const alongX = (i: number, j: number) => !(NO_STREET.has(at(i - 1, j).label) && NO_STREET.has(at(i, j).label));
  const alongY = (i: number, j: number) => !(NO_STREET.has(at(i, j - 1).label) && NO_STREET.has(at(i, j).label));

  const ways: Way[] = [];
  const street = (pts: number[], n: number) => ways.push({ pts, kind: 'road', width: half(n) * 2, cls: main(n) ? 'secondary' : 'minor' });
  for (let i = i0; i <= i1; i++) {
    let run: number[] = [];
    for (let j = j0; j < j1; j++) {
      if (alongX(i, j)) {
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
      if (alongY(i, j)) {
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

  const buildings: Building[] = [];
  const tagged: Tagged[] = [];
  const landuse: Area[] = [];
  const inBox = (x: number, y: number, pad: number) => x >= bx0 - pad && x <= bx1 + pad && y >= by0 - pad && y <= by1 + pad;
  /** A building on a footprint, with what it is (and a flat roof where the zone wants one) said the way OSM would. */
  const raise = (x0: number, y0: number, x1: number, y1: number, h: number, building: string, roof?: string) => {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    if (!inBox(cx, cy, MARGIN) || x1 - x0 < 2 || y1 - y0 < 2) return;
    const b: Building = { shape: square(x0, y0, x1, y1), h, min: 0 };
    if (!inBox(cx, cy, 0)) b.context = true;
    buildings.push(b);
    tagged.push({ x: cx, y: cy, building, roof, from: 'image' });
    town.density.built.push(cx, cy, (x1 - x0) * (y1 - y0));
  };
  /** Pitched roofs where the zone is warm, flat ones where it isn't; pitched ones are left to the style. */
  const roofOf = (warmth: number, k: [number, number], salt: number) => (hash(k[0], k[1], set.seed, salt) < warmth ? undefined : 'flat');
  const storeys = (label: Label, level: number, k: [number, number], salt: number) => {
    const [lo, hi] = STOREYS[label] ?? [1, 2];
    return Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * level + (hash(k[0], k[1], set.seed, salt) - 0.5) * 0.9)));
  };

  for (let i = i0; i < i1; i++) {
    for (let j = j0; j < j1; j++) {
      const { label, level, warmth } = at(i, j);
      const X0 = i * PITCH;
      const Y0 = j * PITCH;
      if (label === 'water') {
        town.water.push(square(X0, Y0, X0 + PITCH, Y0 + PITCH));
        town.waterCls.push('lake');
        continue;
      }
      // Up to the pavement where a street runs past, to the street's line where none does.
      const x0 = X0 + (alongX(i, j) ? half(i) + PAVEMENT : 0);
      const x1 = X0 + PITCH - (alongX(i + 1, j) ? half(i + 1) + PAVEMENT : 0);
      const y0 = Y0 + (alongY(i, j) ? half(j) + PAVEMENT : 0);
      const y1 = Y0 + PITCH - (alongY(i, j + 1) ? half(j + 1) + PAVEMENT : 0);
      const ground = square(x0, y0, x1, y1);
      if (!BUILT.has(label)) {
        if (label === 'plaza') town.plazas.push(ground);
        else if (label === 'park') town.green.push(ground);
        else if (label === 'wood') town.wood.push(ground);
        else {
          const wet = [at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1)].some((b) => b.label === 'water');
          town.cover.push({ shape: ground, cls: label === 'sand' ? (wet ? 'beach' : 'sand') : label === 'field' ? 'farmland' : label === 'allot' ? 'allotments' : 'meadow' });
        }
        continue;
      }
      landuse.push({ shape: ground, cls: label === 'works' ? 'industrial' : 'residential' });
      const k = key(X0, Y0);
      const w = x1 - x0;
      const d = y1 - y0;
      if (label === 'works') {
        // One hall, or two side by side, standing back from the street with a yard.
        const h = 7 + 5 * level;
        const roof = hash(k[0], k[1], set.seed, 14010) < warmth ? 'sawtooth' : 'flat';
        if (level < 0.5) raise(x0 + 6, y0 + 6, x1 - 6, y1 - 6, h, 'industrial', roof);
        else {
          raise(x0 + 4, y0 + 5, x0 + w / 2 - 3, y1 - 5, h, 'industrial', roof);
          raise(x0 + w / 2 + 3, y0 + 5, x1 - 4, y1 - 5, h, 'warehouse', roof);
        }
        continue;
      }
      if (label === 'towers') {
        // One or two towers on open ground.
        const n = level > 0.5 ? 2 : 1;
        const side = 18 + 6 * hash(k[0], k[1], set.seed, 14011);
        for (let t = 0; t < n; t++) {
          const cx = n === 1 ? x0 + w / 2 : x0 + (t ? 0.72 : 0.28) * w;
          const cy = n === 1 ? y0 + d / 2 : y0 + (t ? 0.3 : 0.7) * d;
          const kt = key(cx, cy);
          raise(cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2, storeys(label, level, kt, 14012) * style.floor, 'apartments', 'flat');
        }
        continue;
      }
      if (label === 'blocks' || label === 'old') {
        // Perimeter rows on all four sides round a courtyard, cut into buildings that share their walls.
        const deep = label === 'old' ? 12 + 4 * level : 13 + 3 * level;
        const parts = label === 'old' ? 6 + Math.round(2 * level) : 2 + Math.round(level);
        const kind = label === 'old' ? 'terrace' : 'apartments';
        const row = (ax: number, ay: number, bx: number, by: number, along: 'x' | 'y') => {
          const len = along === 'x' ? bx - ax : by - ay;
          for (let p = 0; p < parts; p++) {
            const a = p / parts;
            const b = (p + 1) / parts;
            const [px0, py0, px1, py1] = along === 'x' ? [ax + a * len, ay, ax + b * len, by] : [ax, ay + a * len, bx, ay + b * len];
            const kp = key((px0 + px1) / 2, (py0 + py1) / 2);
            const st = storeys(label, level, kp, 14013);
            raise(px0, py0, px1, py1, st * style.floor, st > 3 ? 'apartments' : kind, roofOf(warmth, kp, 14014));
          }
        };
        row(x0, y0, x1, y0 + deep, 'x');
        row(x0, y1 - deep, x1, y1, 'x');
        row(x0, y0 + deep, x0 + deep, y1 - deep, 'y');
        row(x1 - deep, y0 + deep, x1, y1 - deep, 'y');
        if ((w - 2 * deep) * (d - 2 * deep) > 300) town.green.push(square(x0 + deep + 1, y0 + deep + 1, x1 - deep - 1, y1 - deep - 1));
        continue;
      }
      // Suburbs and terraced rows: houses along the two long sides, gardens behind.
      const rows = label === 'rows';
      const lots = rows ? 6 + Math.round(2 * level) : 4 + Math.round(level);
      const lot = w / lots;
      for (const s of [-1, 1]) {
        const edge = s > 0 ? y1 : y0;
        const ks = key(X0, edge);
        // A terrace keeps one building line; detached houses each find their own.
        const rowBack = 1 + 1.5 * hash(ks[0], ks[1], set.seed, 14015);
        for (let n = 0; n < lots; n++) {
          const cx = x0 + (n + 0.5) * lot;
          const kl = key(cx, edge);
          const depth = rows ? 9 + 3 * level : 8 + 3 * hash(kl[0], kl[1], set.seed, 14002);
          const back = rows ? rowBack : 3 + 2.5 * hash(kl[0], kl[1], set.seed, 14003);
          const width = rows ? lot : Math.min(lot - 3, lot * (0.5 + 0.25 * level) + 2 * hash(kl[0], kl[1], set.seed, 14001));
          const ya = s > 0 ? edge - back - depth : edge + back;
          const st = storeys(label, level, rows ? ks : kl, 14004);
          raise(rows ? x0 + n * lot : cx - width / 2, ya, rows ? x0 + (n + 1) * lot : cx + width / 2, ya + depth, st * style.floor, rows ? 'terrace' : 'house', roofOf(warmth, rows ? ks : kl, 14016));
        }
      }
    }
  }
  town.buildings = buildings;
  town.tagged = tagged;
  town.landuse = landuse;
  town.nearby = { landuse, pois: [], numbers: [], helipads: [], ways };
  return town;
}
