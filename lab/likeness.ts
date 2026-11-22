/**
 * The likeness lab: draws towns from pictures at a run of scales, headless, and scores how like
 * each picture the drawing is. `npm run likeness` drives it through `lab/likeness.mjs`.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { imageFeatures } from './image-features';
import { imageScene, plausibility, type Picture } from '../src/image';
import { TARGET_CELL } from '../src/image-read';
import { blur, coverage, LABELS, likeness, oklab, toGamma, type Label, type Likeness } from '../src/image-tone';
import { predict } from '../src/image-tune';
import { labelAt, type Zones } from '../src/image-zones';
import { PAIRS } from '../src/image-adjacency-data';
import { streetRules } from '../src/image-streets';
import { PALETTES } from '../src/palettes';
import { plan, toSvg } from '../src/plot';
import { render } from '../src/render';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { PICTURES as synthetic } from '../test/support/pictures';
import { measure, type SheetStats } from './metrics';

/** A real photograph and a transparent mark, checked in so the lab stays offline. */
function fixture(name: string): Picture {
  const { width: w, height: h, data } = PNG.sync.read(readFileSync(new URL(`./images/${name}.png`, import.meta.url)));
  const id = createHash('sha256').update(`${w}x${h}:`).update(data).digest('hex').slice(0, 16);
  return { id, name, w, h, rgba: new Uint8ClampedArray(data) };
}

export const PICTURES: Record<string, () => Picture> = { ...synthetic, astronaut: () => fixture('astronaut'), logo: () => fixture('logo') };
export const SCALES = [1000, 2500, 5000, 8000];

export type LikenessOptions = { tuned?: boolean; likeness?: number; relief?: number; buildingDensity?: number; density?: number; hatching?: number; contours?: number; floorplans?: number; townBias?: number; water?: number; districtSize?: number; streetSpacing?: number; neighbours?: number; roundabouts?: number; preserveSpace?: boolean; highlight?: number; pens?: string; sheet?: Settings['sheet']; detail?: number; penWidth?: number };
/** An RGB image, 8 bits a channel, for writing out. */
export type Rgb = { w: number; h: number; data: Uint8Array };
export type LikenessResult = {
  picture: string;
  scale: number;
  svg: string;
  likeness: Likeness;
  /** Milliseconds per step. */
  ms: { read: number; zone: number; layout: number; render: number; plan: number; score: number; total: number };
  stats: SheetStats;
  counts: Record<string, number>;
  rect: [number, number, number, number];
  /** What the drawing should look like, and what it does look like, both seen from arm's length. */
  look: Rgb;
  squint: Rgb;
  /** The picture itself. */
  source: Rgb;
  /** The target's tone with its edges in red, bright lines in yellow and dark lines in blue. */
  edges: Rgb;
  /** The land plan as it lands on the sheet, a colour per label. */
  zones: Rgb;
  /** Share of the ground in each label. */
  shares: Partial<Record<Label, number>>;
  /** How typical the land plan's borders are of real towns, nats per border (higher is more typical). */
  realism: number;
  /** Streets in the network, and breaches of the street rules (§10.5). */
  streets: number;
  features: Record<string, number>;
  violations: string[];
  /** Blocks and lots laid out, and what makes the town implausible (§11.4). */
  blocks: number;
  lots: number;
  implausible: string[];
  /**
   * How well the drawing's lightness follows the image's, seen from across the room: a Pearson
   * correlation, which unlike the score doesn't depend on how the target's range is set.
   */
  corr: number;
  /** Each pen's mean coverage as the predictor has it and as drawn: the calibration guard (§7.3). */
  guard: { predicted: number[]; drawn: number[] };
};

/** A colour per label for the zone view: water blue, green things green, built things warm to dark. */
const ZONE_COLOUR: Record<Label, [number, number, number]> = {
  water: [70, 130, 210], plaza: [235, 235, 225], sand: [240, 220, 150], meadow: [190, 225, 150], field: [215, 210, 120], park: [120, 190, 110],
  allot: [160, 170, 90], wood: [40, 110, 60], works: [150, 150, 165], suburb: [240, 175, 150], rows: [215, 120, 100], old: [170, 70, 60], blocks: [120, 95, 110], towers: [50, 45, 60],
};

/** The settings a case is drawn with: the app's defaults in image mode, as on first switching to it, at this scale. */
export function caseSettings(pic: Picture, scale: number, o: LikenessOptions = {}): Settings {
  const pens = o.pens ? PALETTES.find((p) => p.name.toLowerCase() === o.pens!.toLowerCase())?.pens : undefined;
  if (o.pens && !pens) throw new Error(`No palette "${o.pens}". Try: ${PALETTES.map((p) => p.name.toLowerCase()).join(', ')}`);
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    source: 'image',
    image: pic.id,
    imageName: pic.name,
    scale,
    tilt: 40,
    power: false,
    sheet: o.sheet ?? 'a3',
    likeness: o.likeness ?? DEFAULT_SETTINGS.likeness,
    imageRelief: o.relief ?? DEFAULT_SETTINGS.imageRelief,
    buildingDensity: o.buildingDensity ?? DEFAULT_SETTINGS.buildingDensity,
    imageDensity: o.density ?? DEFAULT_SETTINGS.imageDensity,
    imageHatching: o.hatching ?? DEFAULT_SETTINGS.imageHatching,
    imageFloorplans: o.floorplans ?? DEFAULT_SETTINGS.imageFloorplans,
    imageTownBias: o.townBias ?? DEFAULT_SETTINGS.imageTownBias,
    imageDistrictSize: o.districtSize ?? DEFAULT_SETTINGS.imageDistrictSize,
    imageWater: o.water ?? DEFAULT_SETTINGS.imageWater,
    imageStreetSpacing: o.streetSpacing ?? DEFAULT_SETTINGS.imageStreetSpacing,
    imageNeighbours: o.neighbours ?? DEFAULT_SETTINGS.imageNeighbours,
    imageRoundabouts: o.roundabouts ?? DEFAULT_SETTINGS.imageRoundabouts,
    imageContours: o.contours ?? DEFAULT_SETTINGS.imageContours,
    imagePreserveSpace: o.preserveSpace ?? DEFAULT_SETTINGS.imagePreserveSpace,
    imageHighlight: o.highlight ?? DEFAULT_SETTINGS.imageHighlight,
    detail: o.detail ?? DEFAULT_SETTINGS.detail,
    penWidth: o.penWidth ?? DEFAULT_SETTINGS.penWidth,
    pens: pens ? [...pens] : [...DEFAULT_SETTINGS.pens],
  };
}

/** Linear RGB planes to 8-bit sRGB. */
function rgb(planes: Float32Array[], w: number, h: number): Rgb {
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) data[i * 3 + c] = Math.round(Math.max(0, Math.min(1, toGamma(planes[c][i]))) * 255);
  return { w, h, data };
}

/** Draw one picture at one scale and score it. */
export function runCase(name: string, scale: number, o: LikenessOptions = {}): LikenessResult {
  const pic = PICTURES[name]();
  const set = caseSettings(pic, scale, o);
  const marks: [string, number][] = [];
  const t0 = performance.now();
  const scene = imageScene(pic, set, (note) => marks.push([note, performance.now()]), o.tuned);
  const t1 = performance.now();
  const at = (note: string) => marks.find(([n]) => n === note)?.[1];
  const reading = at('Reading the image'), zoning = at('Zoning the ground'), streets = at('Laying out streets');
  const read = reading === undefined ? 0 : (zoning ?? streets ?? t1) - reading;
  const zoned = zoning === undefined ? 0 : (streets ?? t1) - zoning;
  const tally = new Map<string, number[][]>();
  const drawing = render(scene.town, scene.set, scene.frame, scene.style, undefined, scene.region.left, tally, scene.target);
  const t2 = performance.now();
  const planned = plan(drawing.pens, scene.set);
  const svg = toSvg(planned.pens, scene.set, scene.cam.sheet);
  const t3 = performance.now();
  const t = scene.target;
  const cov = coverage(drawing.pens, { x0: t.x0, y0: t.y0, cell: TARGET_CELL, W: t.W, H: t.H }, scene.set.penWidth, scene.set.mono);
  const scored = likeness(cov, t, scene.set, t.paper - t.dark);
  const t4 = performance.now();
  const stats = measure(tally, scene.cam.rect, scene.set.penWidth, scene.set.speed);
  const predicted = scene.prediction ?? predict(structuredClone(scene.blocks), scene.zones, t, scene.cam, scene.set, scene.box);
  const source: Rgb = { w: pic.w, h: pic.h, data: new Uint8Array(pic.w * pic.h * 3) };
  for (let i = 0; i < pic.w * pic.h; i++) {
    const a = pic.rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) source.data[i * 3 + c] = Math.round(pic.rgba[i * 4 + c] * a + 255 * (1 - a));
  }
  const edges: Rgb = { w: t.W, h: t.H, data: new Uint8Array(t.W * t.H * 3) };
  const zones: Rgb = { w: t.W, h: t.H, data: new Uint8Array(t.W * t.H * 3) };
  for (let i = 0; i < t.W * t.H; i++) {
    const g = Math.round(255 * (0.35 + 0.65 * t.tone[i]));
    edges.data.set(t.edge[i] > 0 ? [230, 40, 40] : t.ridge[i] > 0 ? [230, 200, 0] : t.ridge[i] < 0 ? [40, 80, 230] : [g, g, g], i * 3);
    const [gx, gy] = scene.cam.ground(t.x0 + ((i % t.W) + 0.5) * t.cell, t.y0 + (Math.floor(i / t.W) + 0.5) * t.cell);
    const l = labelAt(scene.zones, gx, gy);
    zones.data.set(l ? ZONE_COLOUR[l] : [255, 255, 255], i * 3);
  }
  const shares: Partial<Record<Label, number>> = {};
  for (const v of scene.zones.label) shares[LABELS[v]] = (shares[LABELS[v]] ?? 0) + 1 / scene.zones.label.length;
  return {
    picture: name,
    scale,
    svg,
    likeness: scored.likeness,
    ms: { read, zone: zoned, layout: t1 - t0 - read - zoned, render: t2 - t1, plan: t3 - t2, score: t4 - t3, total: t4 - t0 },
    stats,
    counts: drawing.counts,
    rect: scene.cam.rect,
    look: rgb(scored.views.look, t.W, t.H),
    squint: rgb(scored.views.drawing, t.W, t.H),
    source,
    edges,
    zones,
    shares,
    realism: realism(scene.zones),
    features: imageFeatures(name, scene, pic, scored.views),
    streets: scene.streets.edges.length,
    violations: streetRules(scene.streets),
    blocks: scene.blocks.length,
    lots: scene.blocks.reduce((n, b) => n + b.lots.length, 0),
    implausible: plausibility(scene.town),
    corr: correlation(scored.views.drawing, scored.views.look, t),
    guard: {
      predicted: predicted.pens,
      drawn: cov.map((plane) => {
        let sum = 0;
        let w = 0;
        for (let i = 0; i < plane.length; i++)
          if (t.weight[i] > 0) {
            sum += plane[i];
            w++;
          }
        return sum / Math.max(1, w);
      }),
    },
  };
}

/**
 * How typical a land plan's borders are of real towns: the mean log-chance, nats, of the label
 * across each border given the label on this side, as the real places in the adjacency lab have it.
 */
function realism(z: Zones): number {
  const K = LABELS.length;
  const P = PAIRS.map((row, a) => {
    const sum = row.reduce((s, v, b) => s + (b === a ? 0 : v + 4), 0);
    return row.map((v) => Math.log((v + 4) / sum));
  });
  let ll = 0;
  let n = 0;
  const side = (a: number, b: number) => {
    if (a === b || a >= K || b >= K) return;
    ll += P[a][b] + P[b][a];
    n += 2;
  };
  for (let j = 0; j < z.H; j++)
    for (let i = 0; i < z.W; i++) {
      const c = j * z.W + i;
      if (i + 1 < z.W) side(z.label[c], z.label[c + 1]);
      if (j + 1 < z.H) side(z.label[c], z.label[c + z.W]);
    }
  return ll / Math.max(1, n);
}

/** Pearson correlation of two views' lightness, blurred a further 3 mm (across the room), where the target has weight. */
function correlation(drawn: Float32Array[], look: Float32Array[], t: { W: number; H: number; cell: number; weight: Float32Array }): number {
  const L = (rgb: Float32Array[]) => {
    const v = new Float32Array(t.W * t.H);
    const lab = [0, 0, 0];
    for (let i = 0; i < v.length; i++) {
      oklab(rgb[0][i], rgb[1][i], rgb[2][i], lab);
      v[i] = lab[0];
    }
    blur(v, t.W, t.H, 3 / t.cell);
    return v;
  };
  const a = L(drawn);
  const b = L(look);
  let [n, ma, mb] = [0, 0, 0];
  for (let i = 0; i < a.length; i++) if (t.weight[i] > 0) [n, ma, mb] = [n + 1, ma + a[i], mb + b[i]];
  ma /= n || 1;
  mb /= n || 1;
  let [ab, aa, bb] = [0, 0, 0];
  for (let i = 0; i < a.length; i++) if (t.weight[i] > 0) [ab, aa, bb] = [ab + (a[i] - ma) * (b[i] - mb), aa + (a[i] - ma) ** 2, bb + (b[i] - mb) ** 2];
  return ab / Math.sqrt(aa * bb || 1);
}

