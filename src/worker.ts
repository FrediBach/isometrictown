/// <reference lib="webworker" />
import { Camera } from './camera';
import { Frame } from './geo';
import { plan, toSvg, type PlotStats } from './plot';
import { reachHeight, render, type Counts } from './render';
import type { Settings } from './settings';
import { loadTags } from './osm';
import { detectRegion, STYLES, type Region } from './styles';
import { loadTown, TooBigError, type Tagged } from './tiles';

export type Job = { id: number; set: Settings };
export type Reply =
  | { id: number; kind: 'progress'; text: string }
  | { id: number; kind: 'done'; svg: string; stats: PlotStats; counts: Counts; region: Region; ms: number }
  | { id: number; kind: 'error'; text: string; tooBig: boolean };

/** How long to wait for OSM tags once the map tiles are in. */
const TAG_GRACE_MS = 2500;

const post = (r: Reply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(r);

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, set } = e.data;
  try {
    const cam = new Camera(set);
    const frame = new Frame(set.center);
    const box = cam.region(reachHeight(set));
    // Roof tags are a bonus: fetch them alongside the tiles, but don't hold the drawing up for long.
    const tags = set.osmTags ? loadTags(frame, box) : Promise.resolve([]);
    const [region, town] = await Promise.all([
      detectRegion(set.center),
      loadTown(frame, box, (done, total) => {
        if (done < total) post({ id, kind: 'progress', text: `Loading map ${done + 1} of ${total}` });
      }),
    ]);
    town.tagged = (await Promise.race([tags, new Promise<Tagged[]>((r) => setTimeout(() => r([]), TAG_GRACE_MS))])) ?? [];
    const style = STYLES[set.style === 'auto' ? region.style : set.style] ?? STYLES.generic;
    post({ id, kind: 'progress', text: 'Drawing' });
    const t1 = performance.now();
    const drawing = render(town, set, frame, style);
    const planned = plan(drawing.pens, set);
    const svg = toSvg(planned.pens, set, cam.sheet);
    post({ id, kind: 'done', svg, stats: planned.stats, counts: drawing.counts, region, ms: performance.now() - t1 });
  } catch (err) {
    post({ id, kind: 'error', text: err instanceof Error ? err.message : String(err), tooBig: err instanceof TooBigError });
  }
};
