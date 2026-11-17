/**
 * The likeness lab: draws towns from pictures at a run of scales, headless, and scores how like
 * each picture the drawing is. `npm run likeness` drives it through `lab/likeness.mjs`.
 */
import { imageScene, type Picture } from '../src/image';
import { TARGET_CELL } from '../src/image-read';
import { coverage, likeness, toGamma, type Likeness } from '../src/image-tone';
import { PALETTES } from '../src/palettes';
import { plan, toSvg } from '../src/plot';
import { render } from '../src/render';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { PICTURES } from '../test/support/pictures';
import { measure, type SheetStats } from './metrics';

export { PICTURES };
export const SCALES = [1000, 2500, 5000, 8000];

export type LikenessOptions = { likeness?: number; pens?: string; sheet?: Settings['sheet']; detail?: number; penWidth?: number };
/** An RGB image, 8 bits a channel, for writing out. */
export type Rgb = { w: number; h: number; data: Uint8Array };
export type LikenessResult = {
  picture: string;
  scale: number;
  svg: string;
  likeness: Likeness;
  /** Milliseconds per step. */
  ms: { read: number; layout: number; render: number; plan: number; score: number; total: number };
  stats: SheetStats;
  counts: Record<string, number>;
  rect: [number, number, number, number];
  /** What the drawing should look like, and what it does look like, both seen from arm's length. */
  look: Rgb;
  squint: Rgb;
  /** The picture itself. */
  source: Rgb;
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
  const scene = imageScene(pic, set, (note) => marks.push([note, performance.now()]));
  const t1 = performance.now();
  const at = (note: string) => marks.find(([n]) => n === note)?.[1];
  const read = (at('Laying out streets') ?? t1) - (at('Reading the image') ?? t0);
  const tally = new Map<string, number[][]>();
  const drawing = render(scene.town, scene.set, scene.frame, scene.style, undefined, scene.region.left, tally);
  const t2 = performance.now();
  const planned = plan(drawing.pens, scene.set);
  const svg = toSvg(planned.pens, scene.set, scene.cam.sheet);
  const t3 = performance.now();
  const t = scene.target;
  const cov = coverage(drawing.pens, { x0: t.x0, y0: t.y0, cell: TARGET_CELL, W: t.W, H: t.H }, scene.set.penWidth, scene.set.mono);
  const scored = likeness(cov, t, scene.set, t.paper - t.dark);
  const t4 = performance.now();
  const stats = measure(tally, scene.cam.rect, scene.set.penWidth, scene.set.speed);
  const source: Rgb = { w: pic.w, h: pic.h, data: new Uint8Array(pic.w * pic.h * 3) };
  for (let i = 0; i < pic.w * pic.h; i++) source.data.set(pic.rgba.subarray(i * 4, i * 4 + 3), i * 3);
  return {
    picture: name,
    scale,
    svg,
    likeness: scored.likeness,
    ms: { read, layout: t1 - t0 - read, render: t2 - t1, plan: t3 - t2, score: t4 - t3, total: t4 - t0 },
    stats,
    counts: drawing.counts,
    rect: scene.cam.rect,
    look: rgb(scored.views.look, t.W, t.H),
    squint: rgb(scored.views.drawing, t.W, t.H),
    source,
  };
}
