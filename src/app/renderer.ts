import type { Picture } from '../image';
import type { Likeness } from '../image-tone';
import { recolor, type PlotStats } from '../plot';
import type { Census, Counts } from '../render';
import { sheetSize, type Settings } from '../settings';
import type { Region } from '../styles';
import type { Features, Job, Reply, Strokes } from '../worker';
import { stageLabel, type StageProgress } from './stages';

export type RenderStatus = { text: string; state: 'idle' | 'working' | 'error'; progress?: StageProgress };

const working = (p: StageProgress, source: Settings['source']): RenderStatus => ({ text: stageLabel(p.stage, source), state: 'working', progress: p });

/** The pens, paper and colour weight through which a likeness score was measured. */
export function scoreLook(set: Settings): string {
  const paper = set.customBackground ? set.background : '#ffffff';
  return set.mono ? `${paper}/mono` : `${paper}/${set.imageColour}/${set.pens.join(',')}`;
}

type DrawingLikeness = Likeness & { look: string };

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
  ms: number;
  /** Settings at the time the drawing came back, for the stats panel. */
  mono: boolean;
  speed: number;
  /** In image mode, how like the image the drawing is. */
  likeness?: DrawingLikeness;
};

/** Pictures the worker keeps, as it does: the last two used. */
const PICTURES = 2;

/** Whether a reply belongs to the source and picture the user is looking at. */
const sameSource = (a: Settings, b: Settings) => a.source === b.source && (a.source === 'map' || a.image === b.image);

/** Runs drawings on the worker, one at a time, always drawing the latest settings next. */
export class Renderer {
  private worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
  private jobId = 0;
  private submitted: Settings | null = null;
  private busy = false;
  private queued = false;
  private timer = 0;
  private pickId = 0;
  private picking = new Map<number, (key: string | null) => void>();
  private asking = new Map<number, (s: Strokes | null) => void>();
  private scoring = new Map<number, (l: Likeness | null) => void>();
  /** Ids of the pictures the worker has, least recently used first, kept in step with its own list. */
  private sent: string[] = [];

  constructor(
    private settings: () => Settings,
    /** The picture image mode draws from, once it is loaded. */
    private picture: () => Picture | null,
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
      if (r.kind === 'scored') {
        this.scoring.get(r.id)?.(r.likeness);
        this.scoring.delete(r.id);
        return;
      }
      const drawn = this.submitted;
      if (!drawn || r.id !== this.jobId) return;
      const set = this.settings();
      const current = sameSource(drawn, set);
      if (r.kind === 'progress') {
        if (current) this.onStatus(working(r, drawn.source));
        return;
      }
      this.busy = false;
      if (!current) {
        this.dispatch();
        return;
      }
      if (r.kind === 'error' && r.missing !== undefined && this.picture()?.id === r.missing) {
        // The worker lost track of the picture; send it again with the next drawing.
        this.sent = this.sent.filter((id) => id !== r.missing);
        this.queued = true;
      } else if (r.kind === 'error') {
        this.onStatus({ text: r.text, state: 'error' });
      } else {
        this.onStatus({ text: '', state: 'idle' });
        // Pens may have changed while this drawing was on the worker; colour costs no redraw.
        const likeness = r.likeness && { ...r.likeness, look: scoreLook(drawn) };
        this.onResult(recolor({ svg: r.svg, sheet: sheetSize(drawn), stats: r.stats, counts: r.counts, census: r.census, features: r.features, region: r.region, ms: r.ms, mono: drawn.mono, speed: drawn.speed, likeness }, { ...set, mono: drawn.mono }));
      }
      this.dispatch();
    };
    this.worker.onerror = () => {
      this.busy = false;
      this.cancelQueries();
      this.sent = [];
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
    const set = structuredClone(this.settings());
    const pic = set.source === 'image' ? this.picture() : null;
    if (set.source === 'image' && pic?.id !== set.image) {
      // Nothing to draw until there is an image; the image well says so.
      this.queued = false;
      this.onStatus({ text: set.image ? '' : 'Choose an image to draw from', state: 'idle' });
      return;
    }
    this.queued = false;
    this.busy = true;
    this.submitted = set;
    this.onStatus(working({ stage: 'map' }, set.source));
    const job: Job = { kind: 'draw', id: ++this.jobId, set };
    const transfer: Transferable[] = [];
    if (pic) {
      if (!this.sent.includes(pic.id)) {
        // A copy, so the picture stays usable here once its pixels have moved to the worker.
        job.picture = { ...pic, rgba: pic.rgba.slice() };
        transfer.push(job.picture.rgba.buffer);
      }
      this.sent = [...this.sent.filter((id) => id !== pic.id), pic.id].slice(-PICTURES);
    }
    this.worker.postMessage(job, transfer);
  }

  /** How like its image the drawing on show is through the pens of `set`, without drawing it again. */
  score(set: Settings): Promise<DrawingLikeness | null> {
    const drawn = this.submitted;
    if (!drawn || !sameSource(drawn, set) || drawn.mono !== set.mono || drawn.imageColour !== set.imageColour) return Promise.resolve(null);
    const id = ++this.pickId;
    const look = scoreLook(set);
    return new Promise((resolve) => {
      this.scoring.set(id, this.forDrawing<Likeness>((l) => resolve(l && look === scoreLook(this.settings()) ? { ...l, look } : null)));
      this.worker.postMessage({ kind: 'score', id, set: structuredClone(set) } satisfies Job);
    });
  }

  /** The lock key of the building at a sheet position (mm) in the drawing on show, or null. */
  pick(x: number, y: number): Promise<string | null> {
    const id = ++this.pickId;
    return new Promise((resolve) => {
      this.picking.set(id, this.forDrawing(resolve));
      this.worker.postMessage({ kind: 'pick', id, x, y } satisfies Job);
    });
  }

  /** The strokes the drawing on show filed under some tally names, or null if the worker failed. */
  strokes(names: string[]): Promise<Strokes | null> {
    const id = ++this.pickId;
    return new Promise((resolve) => {
      this.asking.set(id, this.forDrawing(resolve));
      this.worker.postMessage({ kind: 'strokes', id, names } satisfies Job);
    });
  }

  /** A score, pick or catalogue query follows the drawing the worker was answering for. */
  private forDrawing<T>(resolve: (answer: T | null) => void): (answer: T | null) => void {
    const drawn = this.submitted;
    return (answer) => resolve(drawn && drawn === this.submitted && sameSource(drawn, this.settings()) ? answer : null);
  }

  private cancelQueries(): void {
    for (const waiting of [this.picking, this.asking, this.scoring]) {
      for (const resolve of waiting.values()) resolve(null);
      waiting.clear();
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.cancelQueries();
  }
}
