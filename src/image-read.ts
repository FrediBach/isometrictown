/**
 * Reading the image in image mode: what the drawing should look like over the drawing area,
 * in OKLab on a fine sheet grid, with its tone mapped into what pens on paper can reach.
 * See docs/plans/image-mode.md §6. Edges, orientation and ridges come with zoning (M1).
 */
import type { Picture } from './image';
import { fitImage, toImage } from './image-fit';
import { hexToLinear, lightnessAt, oklab, paperOf, toLinear, type Look } from './image-tone';
import { LINEWORK, type Settings } from './settings';

/** What the drawing should look like, and the range of lightness the drawing can reach. */
export type Target = Look & {
  /**
   * How light each cell should be, 0 (the darkest a believable town gets) to 1 (bare paper),
   * before the pens: the layout reads this, so the pens never move a street.
   */
  tone: Float32Array;
  /** OKLab lightness of the paper and of the darkest tone a believable town lays down. */
  paper: number;
  dark: number;
};

/** Side of a target cell, mm. */
export const TARGET_CELL = 0.5;
/** Coverage of the darkest pen that the image's black is mapped to: as dark as a town gets without blotting. */
const DARKEST = 0.55;
/** The least spread of lightness auto levels stretch to, so a nearly flat image isn't blown up into noise. */
const MIN_SPREAD = 0.25;
/** Width of the soft knee at each end of the tone curve. */
const KNEE = 0.08;

/** A value clamped to 0–1 with soft shoulders instead of hard corners. */
function soft(t: number): number {
  if (t < KNEE) return KNEE * Math.exp((t - KNEE) / KNEE);
  if (t > 1 - KNEE) return 1 - KNEE * Math.exp((1 - KNEE - t) / KNEE);
  return t;
}

/** The value below which `share` of the weighted values lie, from a histogram over 0–1. */
function percentile(hist: Float64Array, total: number, share: number): number {
  let acc = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc >= share * total) return (i + 0.5) / hist.length;
  }
  return 1;
}

/** The settings that shape the target. */
export type ReadSettings = Pick<Settings, 'imageFit' | 'imageFocus' | 'imageLight' | 'imageContrast' | 'imageColour' | 'mono' | 'pens' | 'customBackground' | 'background'>;

/** Sample the picture over the drawing area `rect` (sheet mm) and map it into the drawing's range of tone. */
export function readImage(pic: Picture, set: ReadSettings, rect: readonly number[]): Target {
  const [x0, y0, x1, y1] = rect;
  const cell = TARGET_CELL;
  const W = Math.max(1, Math.ceil((x1 - x0) / cell));
  const H = Math.max(1, Math.ceil((y1 - y0) / cell));
  const n = W * H;
  const placed = fitImage(rect, pic.w, pic.h, set.imageFit, set.imageFocus);

  // The picture in linear light, so averaging mixes colours as the eye does.
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = toLinear(i / 255);
  const px = pic.w * pic.h;
  const lin = new Float32Array(px * 3);
  const alpha = new Float32Array(px);
  for (let i = 0; i < px; i++) {
    const a = pic.rgba[i * 4 + 3] / 255;
    alpha[i] = a;
    lin[i * 3] = lut[pic.rgba[i * 4]] * a;
    lin[i * 3 + 1] = lut[pic.rgba[i * 4 + 1]] * a;
    lin[i * 3 + 2] = lut[pic.rgba[i * 4 + 2]] * a;
  }

  // Each cell averages a few bilinear samples, as many as the image has pixels across it.
  const k = Math.max(1, Math.ceil(placed.ppm * cell));
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  const weight = new Float32Array(n);
  const acc = [0, 0, 0, 0];
  const lab = [0, 0, 0];
  const sample = (fx: number, fy: number) => {
    const ix = fx - 0.5;
    const iy = fy - 0.5;
    const i0 = Math.floor(ix);
    const j0 = Math.floor(iy);
    const u = ix - i0;
    const v = iy - j0;
    for (let dj = 0; dj < 2; dj++) {
      const j = Math.max(0, Math.min(pic.h - 1, j0 + dj));
      for (let di = 0; di < 2; di++) {
        const i = Math.max(0, Math.min(pic.w - 1, i0 + di));
        const w = (di ? u : 1 - u) * (dj ? v : 1 - v);
        const p = j * pic.w + i;
        acc[0] += lin[p * 3] * w;
        acc[1] += lin[p * 3 + 1] * w;
        acc[2] += lin[p * 3 + 2] * w;
        acc[3] += alpha[p] * w;
      }
    }
  };
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      let count = 0;
      for (let sy = 0; sy < k; sy++) {
        for (let sx = 0; sx < k; sx++) {
          const [fx, fy] = toImage(placed, x0 + (cx + (sx + 0.5) / k) * cell, y0 + (cy + (sy + 0.5) / k) * cell);
          count++;
          if (fx < 0 || fy < 0 || fx > pic.w || fy > pic.h) continue;
          sample(fx, fy);
        }
      }
      const i = cy * W + cx;
      const a = acc[3];
      weight[i] = a / count;
      if (a <= 1e-6) continue;
      oklab(acc[0] / a, acc[1] / a, acc[2] / a, lab);
      L[i] = lab[0];
      A[i] = lab[1];
      B[i] = lab[2];
    }
  }

  // Auto levels from the 1st and 99th percentiles, then contrast round the middle and brightness.
  const bins = 1024;
  const hist = new Float64Array(bins);
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (weight[i] <= 0) continue;
    hist[Math.max(0, Math.min(bins - 1, Math.floor(L[i] * bins)))] += weight[i];
    total += weight[i];
  }
  const p1 = total ? percentile(hist, total, 0.01) : 0;
  const p99 = total ? percentile(hist, total, 0.99) : 1;
  // A nearly flat image is stretched less, and keeps how light it is: a dark one stays dark.
  const extra = Math.max(0, MIN_SPREAD - (p99 - p1));
  const lo = p1 - extra * ((p1 + p99) / 2);
  const spread = p99 - p1 + extra;
  const median = total ? (percentile(hist, total, 0.5) - lo) / spread : 0.5;
  const gamma = 2 ** -set.imageLight;

  // Into the drawing's range: from bare paper down to the darkest a believable town gets.
  const paperHex = paperOf(set);
  const paper = lightnessAt(paperHex, paperHex, 0);
  const dark = lightnessAt(paperHex, set.mono ? '#000000' : set.pens[LINEWORK], DARKEST);
  const chroma = set.mono ? 0 : set.imageColour;
  // Where there is no image, the paper itself, tint and all, so a coloured background isn't counted as an error.
  const tint = [0, 0, 0];
  const bg = hexToLinear(paperHex);
  oklab(bg[0], bg[1], bg[2], tint);
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (weight[i] <= 0) {
      tone[i] = 1;
      L[i] = paper;
      A[i] = tint[1];
      B[i] = tint[2];
      continue;
    }
    tone[i] = soft(median + ((L[i] - lo) / spread - median) * set.imageContrast) ** gamma;
    L[i] = dark + (paper - dark) * tone[i];
    A[i] *= chroma;
    B[i] *= chroma;
  }
  return { x0, y0, cell, W, H, L, a: A, b: B, weight, tone, paper, dark };
}

/** How light the target is at a sheet position, from 0 (as dark as the drawing gets) to 1 (bare paper); null where there is no image. */
export function toneAt(t: Target, sx: number, sy: number): number | null {
  const cx = Math.max(0, Math.min(t.W - 1, Math.floor((sx - t.x0) / t.cell)));
  const cy = Math.max(0, Math.min(t.H - 1, Math.floor((sy - t.y0) / t.cell)));
  const i = cy * t.W + cx;
  return t.weight[i] < 0.5 ? null : t.tone[i];
}
