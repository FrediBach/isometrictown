/// <reference lib="webworker" />
import { Camera } from './camera';
import { Frame } from './geo';
import { pathData, plan, toSvg, type PlotStats } from './plot';
import { pickAt, reachHeight, render, type Census, type Counts, type Picks } from './render';
import type { Settings } from './settings';
import type { StageProgress } from './app/stages';
import { loadTags } from './osm';
import { detectRegion, STYLES, type Region } from './styles';
import { loadTown, TooBigError, type Tagged } from './tiles';

/** Strokes and ink (mm) per tally name (`streets:bridges`, `roofs/house/gabled-roof`) in a drawing. */
export type Features = Record<string, [strokes: number, ink: number]>;
/** Some of a drawing's strokes as SVG path data in sheet mm, and the middle of the patch (mm) where they're densest. */
export type Strokes = { d: string; focus: [number, number] | null };

/**
 * Draw a sheet, ask which building shows at a sheet position (mm) in the last one drawn, or
 * ask for the strokes the last one filed under some tally names.
 */
export type Job = { kind: 'draw'; id: number; set: Settings } | { kind: 'pick'; id: number; x: number; y: number } | { kind: 'strokes'; id: number; names: string[] };
export type Reply =
  | { id: number; kind: 'picked'; key: string | null }
  | ({ id: number; kind: 'strokes' } & Strokes)
  | ({ id: number; kind: 'progress' } & StageProgress)
  | { id: number; kind: 'done'; svg: string; stats: PlotStats; counts: Counts; census: Census; features: Features; region: Region; ms: number }
  | { id: number; kind: 'error'; text: string; tooBig: boolean };

/** How long to wait for OSM tags once the map tiles are in. */
const TAG_GRACE_MS = 2500;

/** What shows where in the last finished drawing, and its strokes by tally name, kept for picking and the catalogue. */
let picks: Picks | null = null;
let tally: Map<string, number[][]> | null = null;

/** Side of the square cells (mm) the densest patch of strokes is looked for in. */
const FOCUS_CELL = 12;

function features(t: Map<string, number[][]>): Features {
  const out: Features = {};
  for (const [name, lines] of t) {
    let ink = 0;
    for (const l of lines) for (let i = 2; i < l.length; i += 2) ink += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
    out[name] = [lines.length, ink];
  }
  return out;
}

function strokes(names: string[]): Strokes {
  const lines = names.flatMap((n) => tally?.get(n) ?? []);
  // Ink per cell, to find where the thing is thickest on the ground.
  const cells = new Map<number, number>();
  let best = 0;
  let focus: [number, number] | null = null;
  for (const l of lines) {
    for (let i = 2; i < l.length; i += 2) {
      const x = (l[i] + l[i - 2]) / 2;
      const y = (l[i + 1] + l[i - 1]) / 2;
      const c = Math.floor(x / FOCUS_CELL) * 4096 + Math.floor(y / FOCUS_CELL);
      const v = (cells.get(c) ?? 0) + Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
      cells.set(c, v);
      if (v > best) {
        best = v;
        focus = [(Math.floor(x / FOCUS_CELL) + 0.5) * FOCUS_CELL, (Math.floor(y / FOCUS_CELL) + 0.5) * FOCUS_CELL];
      }
    }
  }
  return { d: pathData(lines), focus };
}

const post = (r: Reply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(r);

/** Progress for one job: every milestone, but counted progress within a step at most every 50 ms. */
function reporter(id: number) {
  let last: StageProgress['stage'] | null = null;
  let at = 0;
  return (p: StageProgress) => {
    const now = performance.now();
    if (p.done !== undefined && p.stage === last && now - at < 50) return;
    last = p.stage;
    at = now;
    post({ id, kind: 'progress', ...p });
  };
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const job = e.data;
  if (job.kind === 'pick') {
    post({ id: job.id, kind: 'picked', key: picks ? pickAt(picks, job.x, job.y) : null });
    return;
  }
  if (job.kind === 'strokes') {
    post({ id: job.id, kind: 'strokes', ...strokes(job.names) });
    return;
  }
  const { id, set } = job;
  const report = reporter(id);
  try {
    report({ stage: 'map' });
    const cam = new Camera(set);
    const frame = new Frame(set.center);
    const box = cam.region(reachHeight(set));
    // Roof tags are a bonus: fetch them alongside the tiles, but don't hold the drawing up for long.
    const tags = set.osmTags ? loadTags(frame, box) : Promise.resolve([]);
    const [region, town] = await Promise.all([
      detectRegion(set.center),
      loadTown(frame, box, undefined, () => report({ stage: 'map', note: 'Downloading OpenStreetMap tiles' }), set.power),
    ]);
    if (set.osmTags) report({ stage: 'map', note: 'Reading roof tags' });
    town.tagged = (await Promise.race([tags, new Promise<Tagged[]>((r) => setTimeout(() => r([]), TAG_GRACE_MS))])) ?? [];
    const style = STYLES[set.style === 'auto' ? region.style : set.style] ?? STYLES.generic;
    const t1 = performance.now();
    const filed = new Map<string, number[][]>();
    const drawing = render(town, set, frame, style, report, region.left, filed);
    report({ stage: 'plan', note: 'Joining strokes, ordering pens' });
    const planned = plan(drawing.pens, set);
    const svg = toSvg(planned.pens, set, cam.sheet);
    picks = drawing.picks;
    tally = filed;
    post({ id, kind: 'done', svg, stats: planned.stats, counts: drawing.counts, census: drawing.census, features: features(filed), region, ms: performance.now() - t1 });
  } catch (err) {
    post({ id, kind: 'error', text: err instanceof Error ? err.message : String(err), tooBig: err instanceof TooBigError });
  }
};
