/// <reference lib="webworker" />
import { Camera } from './camera';
import { Frame } from './geo';
import { plan, toSvg, type PlotStats } from './plot';
import { pickAt, reachHeight, render, type Counts, type Picks } from './render';
import type { Settings } from './settings';
import type { StageProgress } from './app/stages';
import { loadTags } from './osm';
import { detectRegion, STYLES, type Region } from './styles';
import { loadTown, TooBigError, type Tagged } from './tiles';

/** Draw a sheet, or ask which building shows at a sheet position (mm) in the last one drawn. */
export type Job = { kind: 'draw'; id: number; set: Settings } | { kind: 'pick'; id: number; x: number; y: number };
export type Reply =
  | { id: number; kind: 'picked'; key: string | null }
  | ({ id: number; kind: 'progress' } & StageProgress)
  | { id: number; kind: 'done'; svg: string; stats: PlotStats; counts: Counts; region: Region; ms: number }
  | { id: number; kind: 'error'; text: string; tooBig: boolean };

/** How long to wait for OSM tags once the map tiles are in. */
const TAG_GRACE_MS = 2500;

/** What shows where in the last finished drawing, kept for picking. */
let picks: Picks | null = null;

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
      loadTown(frame, box, undefined, () => report({ stage: 'map', note: 'Downloading OpenStreetMap tiles' })),
    ]);
    if (set.osmTags) report({ stage: 'map', note: 'Reading roof tags' });
    town.tagged = (await Promise.race([tags, new Promise<Tagged[]>((r) => setTimeout(() => r([]), TAG_GRACE_MS))])) ?? [];
    const style = STYLES[set.style === 'auto' ? region.style : set.style] ?? STYLES.generic;
    const t1 = performance.now();
    const drawing = render(town, set, frame, style, report, region.left);
    report({ stage: 'plan', note: 'Joining strokes, ordering pens' });
    const planned = plan(drawing.pens, set);
    const svg = toSvg(planned.pens, set, cam.sheet);
    picks = drawing.picks;
    post({ id, kind: 'done', svg, stats: planned.stats, counts: drawing.counts, region, ms: performance.now() - t1 });
  } catch (err) {
    post({ id, kind: 'error', text: err instanceof Error ? err.message : String(err), tooBig: err instanceof TooBigError });
  }
};
