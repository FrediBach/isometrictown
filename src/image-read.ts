/**
 * Reading the image in image mode: what the drawing should look like over the drawing area,
 * in OKLab on a fine sheet grid, with its tone mapped into what pens on paper can reach.
 * See docs/plans/image-mode.md §6.
 */
import type { Picture } from './image';
import { fitImage, toImage } from './image-fit';
import { blur, hexToLinear, lightnessAt, oklab, paperOf, toLinear, type Look } from './image-tone';
import { LINEWORK, type Settings } from './settings';

/** What the drawing should look like, and the range of lightness the drawing can reach. */
export type Target = Look & {
  /**
   * How light each cell should be, 0 (the darkest a believable town gets) to 1 (bare paper),
   * before the pens: the layout reads this, so the pens never move a street.
   */
  tone: Float32Array;
  /** Edge strength 0–1, thinned to the crest of each edge and kept where it joins a strong one (Canny). */
  edge: Float32Array;
  /** Which way contours run on the sheet, radians (x right, y down), from the structure tensor. */
  dir: Float32Array;
  /** How strongly the image is oriented there, 0–1. */
  coherence: Float32Array;
  /** Thin dark (−1) or bright (+1) lines, and the centrelines of broad bright strokes (+2). */
  ridge: Int8Array;
  /** Paper colour used to map this target, including cells where the picture is transparent. */
  paperColour: string;
  /** OKLab lightness of the paper and of the darkest tone a believable town lays down. */
  paper: number;
  dark: number;
};

/** Side of a target cell, mm. */
export const TARGET_CELL = 0.5;
/** Coverage of the darkest pen that the image's black is mapped to: as dark as a town gets without blotting. */
export const DARKEST = 0.55;
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

type InkSettings = Pick<Settings, 'pens' | 'mono' | 'customBackground' | 'background'>;

/** Apply the current paper and linework ink to a target without reading the pixels or finding its edges again. */
export function remapTarget(t: Target, set: InkSettings): Target {
  const paperColour = paperOf(set);
  const dark = lightnessAt(paperColour, set.mono ? '#000000' : set.pens[LINEWORK], DARKEST);
  if (paperColour === t.paperColour && dark === t.dark) return t;
  const tint = [0, 0, 0];
  oklab(...hexToLinear(paperColour), tint);
  const paper = tint[0];
  const L = Float32Array.from(t.tone, (v) => dark + (paper - dark) * v);
  // The uncovered cells of a fitted or transparent image take the tint of the new paper.
  const a = t.a.slice();
  const b = t.b.slice();
  for (let i = 0; i < L.length; i++) if (!t.weight[i]) {
    a[i] = tint[1];
    b[i] = tint[2];
  }
  return { ...t, L, a, b, dark, paper, paperColour };
}

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
  return { x0, y0, cell, W, H, L, a: A, b: B, weight, tone, paperColour: paperHex, paper, dark, ...structure(tone, weight, W, H, cell) };
}

/** Blur for gradients, for the structure tensor and for thin lines, mm. */
const EDGE_BLUR = 1;
const TENSOR_BLUR = 4;
const RIDGE_BLUR = 1.5;
/** Gradient (tone per mm) an edge must reach somewhere, and may fall to along its length. */
const EDGE_HIGH = 0.08;
const EDGE_LOW = 0.04;
/** Gradient that counts as a full-strength edge. */
const EDGE_FULL = 0.3;
/** Scale-normalised curvature across a thin line, and how much more it must curve across than along. */
const RIDGE_MIN = 0.06;
const RIDGE_ASPECT = 2;

/**
 * Edges, orientation and thin lines of the tone, as §6 step 5 describes: Canny edges on the tone
 * lightly blurred, the structure tensor for which way contours run, and the Hessian for lines.
 * Cells next to where there is no image get none, so Fit's margins make no edges.
 */
function structure(tone: Float32Array, weight: Float32Array, W: number, H: number, cell: number) {
  const n = W * H;
  const at = (v: Float32Array, x: number, y: number) => v[Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))];
  const g = tone.slice();
  blur(g, W, H, EDGE_BLUR / cell);
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const mag = new Float32Array(n);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      gx[i] = (at(g, x + 1, y) - at(g, x - 1, y)) / (2 * cell);
      gy[i] = (at(g, x, y + 1) - at(g, x, y - 1)) / (2 * cell);
      mag[i] = Math.hypot(gx[i], gy[i]);
    }
  // Where the image ends (Fit's margins, transparency) is no edge of the picture.
  const bare = new Uint8Array(n);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (at(weight, x, y) < 0.5 || at(weight, x - 3, y) < 0.5 || at(weight, x + 3, y) < 0.5 || at(weight, x, y - 3) < 0.5 || at(weight, x, y + 3) < 0.5) bare[y * W + x] = 1;

  // The structure tensor, smoothed: which way contours run, and how clearly.
  const jxx = new Float32Array(n);
  const jyy = new Float32Array(n);
  const jxy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    jxx[i] = gx[i] * gx[i];
    jyy[i] = gy[i] * gy[i];
    jxy[i] = gx[i] * gy[i];
  }
  for (const j of [jxx, jyy, jxy]) blur(j, W, H, TENSOR_BLUR / cell);
  const dir = new Float32Array(n);
  const coherence = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = jxx[i] - jyy[i];
    const spread = Math.sqrt(d * d + 4 * jxy[i] * jxy[i]);
    const sum = jxx[i] + jyy[i];
    // The gradient's orientation, turned a quarter: contours run across it.
    dir[i] = 0.5 * Math.atan2(2 * jxy[i], d) + Math.PI / 2;
    coherence[i] = sum > 1e-9 && !bare[i] ? (spread / sum) ** 2 : 0;
  }

  // Canny: keep each gradient's crest, then the weak crests joined to a strong one.
  const crest = new Float32Array(n);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (mag[i] < EDGE_LOW || bare[i]) continue;
      const a = ((Math.atan2(gy[i], gx[i]) * 4) / Math.PI + 8) % 4;
      const [dx, dy] = a < 0.5 || a >= 3.5 ? [1, 0] : a < 1.5 ? [1, 1] : a < 2.5 ? [0, 1] : [-1, 1];
      if (mag[i] >= at(mag, x + dx, y + dy) && mag[i] >= at(mag, x - dx, y - dy)) crest[i] = mag[i];
    }
  const edge = new Float32Array(n);
  const stack: number[] = [];
  for (let i = 0; i < n; i++) if (crest[i] >= EDGE_HIGH) stack.push(i);
  while (stack.length) {
    const i = stack.pop()!;
    if (edge[i]) continue;
    edge[i] = Math.min(1, crest[i] / EDGE_FULL);
    const x = i % W;
    const y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!edge[j] && crest[j] >= EDGE_LOW) stack.push(j);
      }
  }

  // Thin lines: the Hessian's stronger curvature, much stronger than the other.
  const h = tone.slice();
  const s = RIDGE_BLUR / cell;
  blur(h, W, H, s);
  const ridge = new Int8Array(n);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (bare[i]) continue;
      const hxx = at(h, x + 1, y) - 2 * h[i] + at(h, x - 1, y);
      const hyy = at(h, x, y + 1) - 2 * h[i] + at(h, x, y - 1);
      const hxy = (at(h, x + 1, y + 1) - at(h, x - 1, y + 1) - at(h, x + 1, y - 1) + at(h, x - 1, y - 1)) / 4;
      const m = (hxx + hyy) / 2;
      const r = Math.sqrt(((hxx - hyy) / 2) ** 2 + hxy * hxy);
      const [big, small] = Math.abs(m + r) > Math.abs(m - r) ? [m + r, m - r] : [m - r, m + r];
      // Normalised by scale (σ² in cells), so the threshold holds whatever the grid. At a line's
      // middle the slope is flat; beside a step it isn't, which tells the two apart.
      if (Math.abs(big) * s * s < RIDGE_MIN || Math.abs(big) < RIDGE_ASPECT * Math.abs(small)) continue;
      const slope = Math.hypot(at(h, x + 1, y) - at(h, x - 1, y), at(h, x, y + 1) - at(h, x, y - 1)) / 2;
      if (slope > Math.abs(big) * s * 0.2) continue;
      ridge[i] = big < 0 ? 1 : -1;
    }
  // A broad bright stroke has two facing edges but little curvature in its flat middle.
  // Trace inward from each bank and mark halfway to the opposite one. Stop at the first
  // strong edge so a road cannot jump across intervening detail or a transparent margin.
  const maxSpan = Math.round(36 / cell);
  // Surrounded by other stripes of similar brightness, a band is texture for the zones.
  // Look beyond each bank for another light band within two widths of the first. An edge
  // of the picture leaves that flank unknown, so judge it from the side still in view.
  const nextBand = (x: number, y: number, nx: number, ny: number, span: number, light: number): boolean | undefined => {
    const step = Math.max(1, Math.floor(span / 4));
    for (let d = Math.ceil(span / 2); d < 2 * span; d += step) {
      const xx = x + Math.round(d * nx);
      const yy = y + Math.round(d * ny);
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || bare[yy * W + xx]) return undefined;
      if (g[yy * W + xx] > light - EDGE_LOW) return true;
    }
    return false;
  };
  for (let i = 0; i < n; i++) {
    if (!edge[i]) continue;
    const x = i % W;
    const y = Math.floor(i / W);
    const nx = gx[i] / mag[i];
    const ny = gy[i] / mag[i];
    for (let d = 3; d <= maxSpan; d++) {
      const xx = x + Math.round(d * nx);
      const yy = y + Math.round(d * ny);
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) break;
      const j = yy * W + xx;
      if (bare[j]) break;
      if (!edge[j]) continue;
      if (d * cell >= 4 && gx[j] * nx + gy[j] * ny < -0.95 * mag[j]) {
        const mid = Math.round((y + yy) / 2) * W + Math.round((x + xx) / 2);
        if (!ridge[mid] && g[mid] > Math.max(g[i], g[j]) + EDGE_LOW) {
          const before = nextBand(x, y, -nx, -ny, d, g[mid]);
          const after = nextBand(xx, yy, nx, ny, d, g[mid]);
          const repeated = (before || after) && before !== false && after !== false;
          if (!repeated) ridge[mid] = 2;
        }
      }
      break;
    }
  }
  return { edge, dir, coherence, ridge };
}

/** How light the target is at a sheet position, from 0 (as dark as the drawing gets) to 1 (bare paper); null where there is no image. */
export function toneAt(t: Target, sx: number, sy: number): number | null {
  const cx = Math.max(0, Math.min(t.W - 1, Math.floor((sx - t.x0) / t.cell)));
  const cy = Math.max(0, Math.min(t.H - 1, Math.floor((sy - t.y0) / t.cell)));
  const i = cy * t.W + cx;
  return t.weight[i] < 0.5 ? null : t.tone[i];
}
