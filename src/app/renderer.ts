import { recolor, type PlotStats } from '../plot';
import type { Census, Counts } from '../render';
import { sheetSize, type Settings } from '../settings';
import type { ClimateId } from '../future';
import type { Region } from '../styles';
import type { Features, Job, Reply, Strokes } from '../worker';
import { STAGE_LABEL, type StageProgress } from './stages';

export type RenderStatus = { text: string; state: 'idle' | 'working' | 'error'; progress?: StageProgress };

const working = (p: StageProgress): RenderStatus => ({ text: STAGE_LABEL[p.stage], state: 'working', progress: p });

export type RenderResult = {
  svg: string;
  sheet: [number, number];
  stats: PlotStats;
  counts: Counts;
  /** Buildings and trees by catalogue facet, and strokes by tally name, for the catalogue. */
  census: Census;
  features: Features;
  /** Country and building style detected for the place. */
  region: Region;
  /** Climate profile the solarpunk future was drawn for, while that mode is on. */
  climate?: ClimateId;
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
  private pickId = 0;
  private picking = new Map<number, (key: string | null) => void>();
  private asking = new Map<number, (s: Strokes | null) => void>();

  constructor(
    private settings: () => Settings,
    private onStatus: (s: RenderStatus) => void,
    private onResult: (r: RenderResult) => void,
  ) {
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      const r = e.data;
      if (r.kind === 'picked') {
        this.picking.get(r.id)?.(r.key);
        this.picking.delete(r.id);
        return;
      }
      if (r.kind === 'strokes') {
        this.asking.get(r.id)?.({ d: r.d, focus: r.focus });
        this.asking.delete(r.id);
        return;
      }
      if (r.kind === 'progress') {
        if (r.id === this.jobId) this.onStatus(working(r));
        return;
      }
      this.busy = false;
      if (r.kind === 'error') {
        this.onStatus({ text: r.text, state: 'error' });
      } else {
        const set = this.settings();
        this.onStatus({ text: '', state: 'idle' });
        // Pens may have changed while this drawing was on the worker; colour costs no redraw.
        this.onResult(recolor({ svg: r.svg, sheet: sheetSize(set), stats: r.stats, counts: r.counts, census: r.census, features: r.features, region: r.region, climate: r.climate, ms: r.ms, mono: set.mono, speed: set.speed }, set));
      }
      this.dispatch();
    };
    this.worker.onerror = () => {
      this.busy = false;
      for (const resolve of this.picking.values()) resolve(null);
      this.picking.clear();
      for (const resolve of this.asking.values()) resolve(null);
      this.asking.clear();
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
    this.onStatus(working({ stage: 'map' }));
    const job: Job = { kind: 'draw', id: ++this.jobId, set: structuredClone(this.settings()) };
    this.worker.postMessage(job);
  }

  /** The lock key of the building at a sheet position (mm) in the drawing on show, or null. */
  pick(x: number, y: number): Promise<string | null> {
    const id = ++this.pickId;
    return new Promise((resolve) => {
      this.picking.set(id, resolve);
      this.worker.postMessage({ kind: 'pick', id, x, y } satisfies Job);
    });
  }

  /** The strokes the drawing on show filed under some tally names, or null if the worker failed. */
  strokes(names: string[]): Promise<Strokes | null> {
    const id = ++this.pickId;
    return new Promise((resolve) => {
      this.asking.set(id, resolve);
      this.worker.postMessage({ kind: 'strokes', id, names } satisfies Job);
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.worker.terminate();
  }
}
