/// <reference lib="webworker" />
import { Camera } from './camera';
import { Frame } from './geo';
import { plan, toSvg, type PlotStats } from './plot';
import { reachHeight, render, type Counts } from './render';
import type { Settings } from './settings';
import { loadTown, TooBigError } from './tiles';

export type Job = { id: number; set: Settings };
export type Reply =
  | { id: number; kind: 'progress'; text: string }
  | { id: number; kind: 'done'; svg: string; stats: PlotStats; counts: Counts; ms: number }
  | { id: number; kind: 'error'; text: string; tooBig: boolean };

const post = (r: Reply) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(r);

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, set } = e.data;
  try {
    const cam = new Camera(set);
    const frame = new Frame(set.center);
    const box = cam.region(reachHeight(set));
    const town = await loadTown(frame, box, (done, total) => {
      if (done < total) post({ id, kind: 'progress', text: `Loading map ${done + 1} of ${total}` });
    });
    post({ id, kind: 'progress', text: 'Drawing' });
    const t1 = performance.now();
    const drawing = render(town, set, frame);
    const planned = plan(drawing.pens, set);
    const svg = toSvg(planned.pens, set, cam.sheet);
    post({ id, kind: 'done', svg, stats: planned.stats, counts: drawing.counts, ms: performance.now() - t1 });
  } catch (err) {
    post({ id, kind: 'error', text: err instanceof Error ? err.message : String(err), tooBig: err instanceof TooBigError });
  }
};
