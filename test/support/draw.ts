/**
 * Draws a sheet the way the worker does (`src/worker.ts`), but waits for OSM tags instead of
 * racing them, so a case comes out the same every time.
 */
import { createHash } from 'node:crypto';
import { Camera } from '@/camera';
import { Frame } from '@/geo';
import { loadTags } from '@/osm';
import { plan, toSvg, type PlotStats } from '@/plot';
import { reachHeight, render, type Census, type Counts } from '@/render';
import type { Settings } from '@/settings';
import { detectRegion, STYLES, type Region } from '@/styles';
import { loadTown } from '@/tiles';
import { imageScene, type Picture, type Scene } from '@/image';
import { TARGET_CELL } from '@/image-read';
import { coverage, likeness, type Likeness } from '@/image-tone';

export type Sheet = {
  set: Settings;
  cam: Camera;
  region: Region;
  /** Raw strokes per pen as `render()` left them, in sheet mm. */
  raw: number[][][];
  /** Joined and ordered strokes per pen, as plotted. */
  pens: number[][][];
  stats: PlotStats;
  svg: string;
  counts: Counts;
  census: Census;
  /** Every stroke filed by the feature that drew it (`Paper.tally`). */
  tally: Map<string, number[][]>;
  ms: number;
};

export async function draw(set: Settings): Promise<Sheet> {
  const cam = new Camera(set);
  const frame = new Frame(set.center);
  const box = cam.region(reachHeight(set));
  const [region, town] = await Promise.all([detectRegion(set.center), loadTown(frame, box, undefined, undefined, set.power)]);
  town.tagged = set.osmTags ? await loadTags(frame, box) : [];
  const style = STYLES[set.style === 'auto' ? region.style : set.style] ?? STYLES.generic;
  const tally = new Map<string, number[][]>();
  const t0 = performance.now();
  const drawing = render(town, set, frame, style, undefined, region.left, tally);
  const planned = plan(drawing.pens, set);
  const svg = toSvg(planned.pens, set, cam.sheet);
  return { set, cam, region, raw: drawing.pens, pens: planned.pens, stats: planned.stats, svg, counts: drawing.counts, census: drawing.census, tally, ms: performance.now() - t0 };
}

/** A sheet drawn from a picture, as the worker draws one in image mode, with how like the picture it is. */
export type ImageSheet = Sheet & { scene: Scene; likeness: Likeness; cov: Float32Array[] };

export function drawImage(set: Settings, picture: Picture): ImageSheet {
  const t0 = performance.now();
  const scene = imageScene(picture, set);
  const tally = new Map<string, number[][]>();
  const drawing = render(scene.town, scene.set, scene.frame, scene.style, undefined, scene.region.left, tally, scene.target);
  const planned = plan(drawing.pens, scene.set);
  const svg = toSvg(planned.pens, scene.set, scene.cam.sheet);
  const t = scene.target;
  const cov = coverage(drawing.pens, { x0: t.x0, y0: t.y0, cell: TARGET_CELL, W: t.W, H: t.H }, scene.set.penWidth, scene.set.mono);
  const like = likeness(cov, t, scene.set, t.paper - t.dark).likeness;
  return { set: scene.set, cam: scene.cam, region: scene.region, raw: drawing.pens, pens: planned.pens, stats: planned.stats, svg, counts: drawing.counts, census: drawing.census, tally, ms: performance.now() - t0, scene, likeness: like, cov };
}

/** Length of a flat [x0, y0, x1, y1, …] polyline. */
export function length(l: number[]): number {
  let s = 0;
  for (let i = 2; i < l.length; i += 2) s += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
  return s;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * What a golden file keeps of a sheet: strokes and ink per feature and per facet, the plan,
 * the counts and a hash of the SVG. The features say *what* moved when a golden changes; the
 * hash catches anything the numbers miss.
 */
export function summary(s: Sheet) {
  const features = new Map<string, [number, number]>();
  const facets = new Map<string, [number, number]>();
  const add = (m: Map<string, [number, number]>, k: string, n: number, ink: number) => {
    const v = m.get(k) ?? m.set(k, [0, 0]).get(k)!;
    v[0] += n;
    v[1] += ink;
  };
  for (const [name, lines] of s.tally) {
    const ink = lines.reduce((t, l) => t + length(l), 0);
    const [head, ...rest] = name.split('/');
    add(features, head, lines.length, ink);
    for (const f of rest) add(facets, `${head.split(':')[0]}/${f}`, lines.length, ink);
  }
  const table = (m: Map<string, [number, number]>) => Object.fromEntries([...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, [n, ink]]) => [k, [n, r1(ink)]]));
  return {
    region: s.region,
    counts: s.counts,
    census: Object.fromEntries(Object.entries(s.census).sort(([a], [b]) => a.localeCompare(b))),
    plan: {
      lifts: s.stats.lifts,
      rawLifts: s.stats.rawLifts,
      inkMm: r1(s.stats.ink),
      travelMm: r1(s.stats.travel),
      minutes: r1(s.stats.seconds / 60),
      pens: s.stats.pens.map((p) => [p.name, p.lifts, r1(p.ink)]),
    },
    /** [strokes, ink mm] per feature as filed (`streets:kerbs`), before any facets. */
    features: table(features),
    /** [strokes, ink mm] per facet of a feature (`buildings/gabled-roof`); one stroke counts under each of its facets. */
    facets: table(facets),
    svg: { bytes: s.svg.length, sha1: hashOf(s.svg) },
  };
}

export const hashOf = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 16);

/** JSON with one line per feature, so a golden's diff reads feature by feature. */
export function pretty(v: unknown, indent = ''): string {
  if (Array.isArray(v) || v === null || typeof v !== 'object') return JSON.stringify(v);
  const inner = `${indent}  `;
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return '{}';
  const flat = entries.every(([, x]) => x === null || typeof x !== 'object' || Array.isArray(x));
  if (flat && entries.length <= 6 && JSON.stringify(v).length < 100) return JSON.stringify(v);
  return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`).join(',\n')}\n${indent}}`;
}
