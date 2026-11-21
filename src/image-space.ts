/** Reserve paper in the projected drawing, including holes inside a shape and gaps between buildings. */
import type { Target } from './image-read';
import type { Grid } from './image-tone';

type Area = 'ink' | 'blank' | 'mixed';

/** A summed-area table of cells to leave blank, in sheet millimetres. */
export class ImageSpace {
  private readonly sum: Uint32Array;
  private readonly stride: number;
  private readonly radius: number;
  private readonly grid: Grid;

  /**
   * `cutoff` is the tone from which paper is kept, one for transparency alone; or one per cell where
   * masks set it, where above one keeps nothing blank at all.
   */
  constructor(t: Pick<Target, keyof Grid | 'tone' | 'weight'>, cutoff: number | Float32Array, nib: number) {
    this.grid = { W: t.W, H: t.H, cell: t.cell, x0: t.x0, y0: t.y0 };
    // Allow for endpoint joining (0.03 mm per axis), SVG rounding and plotter simplification.
    this.radius = nib / 2 + 0.08;
    this.stride = t.W + 1;
    this.sum = new Uint32Array(this.stride * (t.H + 1));
    for (let y = 0; y < t.H; y++) {
      let row = 0;
      for (let x = 0; x < t.W; x++) {
        const i = y * t.W + x;
        const c = typeof cutoff === 'number' ? cutoff : cutoff[i];
        if ((t.weight[i] <= 0 && c <= 1) || (c < 1 && t.tone[i] >= c)) row++;
        const above = y * this.stride + x + 1;
        this.sum[above + this.stride] = this.sum[above] + row;
      }
    }
  }

  /** Classify the box swept by the pen, including its width. The renderer has already clipped to the sheet. */
  private area(ax: number, ay: number, bx: number, by: number): Area {
    const { x0, y0, cell, W, H } = this.grid;
    const { radius, sum, stride } = this;
    const l = Math.max(0, Math.floor((Math.min(ax, bx) - radius - x0) / cell));
    const r = Math.min(W, Math.ceil((Math.max(ax, bx) + radius - x0) / cell));
    const t = Math.max(0, Math.floor((Math.min(ay, by) - radius - y0) / cell));
    const b = Math.min(H, Math.ceil((Math.max(ay, by) + radius - y0) / cell));
    if (r <= l || b <= t) return 'blank';
    const blank = sum[b * stride + r] - sum[t * stride + r] - sum[b * stride + l] + sum[t * stride + l];
    if (!blank) return 'ink';
    return blank === (r - l) * (b - t) ? 'blank' : 'mixed';
  }

  /** Whether a pen can touch this point without marking reserved paper. */
  keeps(x: number, y: number): boolean {
    return this.area(x, y, x, y) === 'ink';
  }

  private clip(line: number[]): number[][] {
    let x0 = line[0], x1 = x0, y0 = line[1], y1 = y0;
    for (let i = 2; i < line.length; i += 2) {
      x0 = Math.min(x0, line[i]); x1 = Math.max(x1, line[i]);
      y0 = Math.min(y0, line[i + 1]); y1 = Math.max(y1, line[i + 1]);
    }
    const area = this.area(x0, y0, x1, y1);
    if (area === 'ink') return [line];
    if (area === 'blank') return [];
    const pieces: number[][] = [];
    let run: number[] = [], length = 0;
    const end = () => {
      if (run.length && length >= this.radius) pieces.push(run);
      run = [];
      length = 0;
    };
    // Subdivide only at mask boundaries. Testing each whole interval also catches a narrow
    // hole crossed between two visible endpoints, including after the Humanize pass.
    const part = (ax: number, ay: number, bx: number, by: number) => {
      const area = this.area(ax, ay, bx, by);
      const d = Math.hypot(bx - ax, by - ay);
      if (area === 'ink') {
        if (!run.length) run.push(ax, ay);
        run.push(bx, by);
        length += d;
      } else if (area === 'blank' || d <= this.grid.cell / 16) {
        if (run.length) end();
      } else {
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        part(ax, ay, mx, my);
        part(mx, my, bx, by);
      }
    };
    for (let i = 2; i < line.length; i += 2) part(line[i - 2], line[i - 1], line[i], line[i + 1]);
    end();
    return pieces;
  }

  /** Clip actual plotter paths and keep the catalogue's references to those same paths. */
  trim(pens: number[][][], tally: Map<string, number[][]> | null): void {
    if (!this.sum[this.sum.length - 1]) return;
    const changes = new Map<number[], number[][]>();
    for (let p = 0; p < pens.length; p++) {
      const kept: number[][] = [];
      for (const line of pens[p]) {
        const pieces = this.clip(line);
        for (const piece of pieces) kept.push(piece);
        if (tally && pieces[0] !== line) changes.set(line, pieces);
      }
      pens[p] = kept;
    }
    if (tally) for (const [name, lines] of tally) {
      const kept = lines.flatMap((line) => changes.get(line) ?? [line]);
      if (kept.length) tally.set(name, kept);
      else tally.delete(name);
    }
  }
}
