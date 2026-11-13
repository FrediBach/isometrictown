import type { PlotStats } from '../plot';
import type { Counts } from '../render';
import { sheetSize, type Settings } from '../settings';
import type { Region } from '../styles';
import type { Job, Reply } from '../worker';

export type RenderStatus = { text: string; state: 'idle' | 'working' | 'error' };

export type RenderResult = {
  svg: string;
  sheet: [number, number];
  stats: PlotStats;
  counts: Counts;
  /** Country and building style detected for the place. */
  region: Region;
  ms: number;
  /** Settings at the time the drawing came back, for the stats panel. */
  mono: boolean;
  speed: number;
};

/** Runs drawings on the worker, one at a time, always drawing the latest settings next. */
export class Renderer {
  private worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
  private jobId = 0;
  private busy = false;
  private queued = false;
  private timer = 0;

  constructor(
    private settings: () => Settings,
    private onStatus: (s: RenderStatus) => void,
    private onResult: (r: RenderResult) => void,
  ) {
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      const r = e.data;
      if (r.kind === 'progress') {
        this.onStatus({ text: r.text, state: 'working' });
        return;
      }
      this.busy = false;
      if (r.kind === 'error') {
        this.onStatus({ text: r.text, state: 'error' });
      } else {
        const set = this.settings();
        this.onStatus({ text: '', state: 'idle' });
        this.onResult({ svg: r.svg, sheet: sheetSize(set), stats: r.stats, counts: r.counts, region: r.region, ms: r.ms, mono: set.mono, speed: set.speed });
      }
      this.dispatch();
    };
    this.worker.onerror = () => {
      this.busy = false;
      this.onStatus({ text: 'The drawing failed. Try another place or setting.', state: 'error' });
    };
  }

  schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.queued = true;
      this.dispatch();
    }, delay);
  }

  private dispatch(): void {
    if (this.busy || !this.queued) return;
    this.queued = false;
    this.busy = true;
    this.onStatus({ text: 'Drawing', state: 'working' });
    const job: Job = { id: ++this.jobId, set: JSON.parse(JSON.stringify(this.settings())) };
    this.worker.postMessage(job);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.worker.terminate();
  }
}
