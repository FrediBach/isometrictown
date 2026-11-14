/**
 * What a drawing costs a plotter and what of it can be seen. Strokes are stamped onto a fine
 * ink raster at the real pen width; then every feature is scored on:
 *
 * - specks: strokes too small to read as anything but a dot (under two pen widths across),
 * - drowned: ink laid where the paper is already solid, so it adds nothing but wear,
 * - seconds: plotting time, pen travel aside, counting a lift per stroke once touching strokes are joined.
 *
 * Waste is the plotting time spent on specks and drowned ink, as a share of the feature's time.
 */

import { join } from '../src/plot';

/** Raster resolution for ink coverage, pixels per mm. */
const RES = 10;
/** A 1 mm cell this inked or more reads as solid black. */
export const SOLID = 0.65;
/** Strokes smaller than this many pen widths across plot as dots. */
const SPECK_NIBS = 2;
const LIFT_SECONDS = 0.3;

export type LayerStats = {
  strokes: number;
  /** mm */
  ink: number;
  specks: number;
  /** mm of ink in cells that are already solid. */
  drowned: number;
  seconds: number;
  /** Share of `seconds` spent on specks and drowned ink, 0–1. */
  waste: number;
};

export type SheetStats = {
  layers: Record<string, LayerStats>;
  total: LayerStats;
  /** Share of the drawing area's 1 mm cells that are solid. */
  solid: number;
  /** Mean ink coverage over the drawing area, 0–1. */
  tone: number;
  /** Centre of the busiest 30 × 20 mm window, sheet mm, for close-ups. */
  hot: [number, number];
  /** Where the waste is, for the lab's diagnostic close-ups; not kept in the report. */
  marks?: { specks: number[][]; /** Top-left corners of solid cells, flat x, y. */ solid: number[] };
};

/** Score the strokes of one drawing, keyed by the feature that drew them. */
export function measure(tally: Map<string, number[][]>, rect: [number, number, number, number], nib: number, speed: number): SheetStats {
  const [x0, y0, x1, y1] = rect;
  const W = Math.ceil((x1 - x0) * RES);
  const H = Math.ceil((y1 - y0) * RES);
  const ink = new Uint8Array(W * H);
  const r = (nib / 2) * RES;
  const disc: number[] = [];
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r * r + 0.25) disc.push(dx, dy);
  const step = 1 / RES;

  /** Walk a stroke at raster steps, calling at(px, py) for each sample. */
  const walk = (l: number[], at: (px: number, py: number) => void) => {
    for (let i = 2; i < l.length; i += 2) {
      const ax = (l[i - 2] - x0) * RES;
      const ay = (l[i - 1] - y0) * RES;
      const bx = (l[i] - x0) * RES;
      const by = (l[i + 1] - y0) * RES;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let k = i === 2 ? 0 : 1; k <= n; k++) at(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
    }
  };

  for (const lines of tally.values()) {
    for (const l of lines) {
      walk(l, (fx, fy) => {
        const px = Math.round(fx);
        const py = Math.round(fy);
        for (let k = 0; k < disc.length; k += 2) {
          const x = px + disc[k];
          const y = py + disc[k + 1];
          if (x >= 0 && y >= 0 && x < W && y < H) ink[y * W + x] = 1;
        }
      });
    }
  }

  // Coverage per 1 mm cell.
  const CW = Math.ceil(W / RES);
  const CH = Math.ceil(H / RES);
  const cover = new Float32Array(CW * CH);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink[y * W + x]) cover[Math.floor(y / RES) * CW + Math.floor(x / RES)] += 1 / (RES * RES);
  let solidCells = 0;
  let tone = 0;
  for (const c of cover) {
    tone += c;
    if (c >= SOLID) solidCells++;
  }

  // The busiest window, by a summed-area table over the cells.
  const sat = new Float64Array((CW + 1) * (CH + 1));
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) sat[(y + 1) * (CW + 1) + x + 1] = cover[y * CW + x] + sat[y * (CW + 1) + x + 1] + sat[(y + 1) * (CW + 1) + x] - sat[y * (CW + 1) + x];
  const ww = Math.min(30, CW);
  const wh = Math.min(20, CH);
  let best = -1;
  let hot: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
  for (let y = 0; y + wh <= CH; y++) {
    for (let x = 0; x + ww <= CW; x++) {
      const s = sat[(y + wh) * (CW + 1) + x + ww] - sat[y * (CW + 1) + x + ww] - sat[(y + wh) * (CW + 1) + x] + sat[y * (CW + 1) + x];
      if (s > best) {
        best = s;
        hot = [x0 + x + ww / 2, y0 + y + wh / 2];
      }
    }
  }

  const specks: number[][] = [];
  const solid: number[] = [];
  for (let i = 0; i < cover.length; i++) if (cover[i] >= SOLID) solid.push(x0 + (i % CW), y0 + Math.floor(i / CW));
  const layers: Record<string, LayerStats> = {};
  const total: LayerStats = { strokes: 0, ink: 0, specks: 0, drowned: 0, seconds: 0, waste: 0 };
  let totalWaste = 0;
  for (const [name, raw] of tally) {
    const lines = join(raw);
    const s: LayerStats = { strokes: lines.length, ink: 0, specks: 0, drowned: 0, seconds: 0, waste: 0 };
    let wasted = 0;
    for (const l of lines) {
      let len = 0;
      let lx0 = Infinity;
      let ly0 = Infinity;
      let lx1 = -Infinity;
      let ly1 = -Infinity;
      for (let i = 0; i < l.length; i += 2) {
        if (i) len += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
        lx0 = Math.min(lx0, l[i]);
        lx1 = Math.max(lx1, l[i]);
        ly0 = Math.min(ly0, l[i + 1]);
        ly1 = Math.max(ly1, l[i + 1]);
      }
      s.ink += len;
      const t = len / speed + LIFT_SECONDS;
      s.seconds += t;
      if (Math.max(lx1 - lx0, ly1 - ly0) < SPECK_NIBS * nib) {
        s.specks++;
        wasted += t;
        specks.push(l);
        continue;
      }
      let drowned = 0;
      walk(l, (fx, fy) => {
        const c = Math.floor(fy / RES) * CW + Math.floor(fx / RES);
        if (cover[c] >= SOLID) drowned += step;
      });
      s.drowned += drowned;
      wasted += drowned / speed;
    }
    s.waste = s.seconds ? wasted / s.seconds : 0;
    layers[name || 'other'] = s;
    total.strokes += s.strokes;
    total.ink += s.ink;
    total.specks += s.specks;
    total.drowned += s.drowned;
    total.seconds += s.seconds;
    totalWaste += wasted;
  }
  total.waste = total.seconds ? totalWaste / total.seconds : 0;
  return { layers, total, solid: solidCells / cover.length, tone: tone / cover.length, hot, marks: { specks, solid } };
}
