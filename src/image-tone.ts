/**
 * Tone and colour in image mode: OKLab conversions, how pens mix on paper, and the likeness
 * score that compares a finished drawing with the image it was made from. See
 * docs/plans/image-mode.md §2.3 and §7.4.
 */
import type { Settings } from './settings';

/** A grid of square cells over the drawing area, in sheet mm with y down. */
export type Grid = { x0: number; y0: number; cell: number; W: number; H: number };

export const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055);

/** A `#rrggbb` colour in linear RGB, 0–1. */
export function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(/^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '000000', 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}

/** Linear RGB to OKLab (Ottosson 2020), written into `out` at `i`, `i + 1`, `i + 2`. */
export function oklab(r: number, g: number, b: number, out: Float32Array | number[], i = 0): void {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[i + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[i + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
}

/** OKLab to linear RGB, written into `out` at `i`. Colours outside sRGB come out below 0 or above 1. */
export function fromOklab(L: number, a: number, b: number, out: Float32Array | number[], i = 0): void {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  out[i] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[i + 1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[i + 2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
}

/** The paper the drawing is seen on: the custom background when it's on, else white. */
export function paperOf(set: Pick<Settings, 'customBackground' | 'background'>): string {
  return set.customBackground && /^#[0-9a-f]{6}$/i.test(set.background) ? set.background : '#ffffff';
}

/** The pen colours as plotted, darkest last: in one-pen output, everything is the black pen. */
export function inksOf(set: Pick<Settings, 'pens' | 'mono'>): [number, number, number][] {
  return set.pens.map((c, i) => hexToLinear(set.mono ? (i === set.pens.length - 1 ? '#000000' : '#ffffff') : c));
}

/**
 * The colour of paper with pen coverages `c` (0–1 each), seen from far enough that the strokes
 * blend, assuming strokes of different pens overlap at random: per linear channel,
 * paper × Π (1 − c + c × pen / paper). Written into `out` at `i`.
 */
export function mix(paper: readonly number[], inks: readonly (readonly number[])[], c: ArrayLike<number>, out: Float32Array | number[], i = 0): void {
  for (let ch = 0; ch < 3; ch++) {
    const p = Math.max(1e-6, paper[ch]);
    let v = p;
    for (let k = 0; k < inks.length; k++) if (c[k] > 0) v *= 1 - c[k] + (c[k] * inks[k][ch]) / p;
    out[i + ch] = v;
  }
}

/** OKLab lightness of paper with `c` coverage of one ink and none of the others. */
export function lightnessAt(paper: string, ink: string, c: number): number {
  const out = [0, 0, 0];
  mix(hexToLinear(paper), [hexToLinear(ink)], [c], out);
  const lab = [0, 0, 0];
  oklab(out[0], out[1], out[2], lab);
  return lab[0];
}

/**
 * How much of each grid cell each pen covers, 0–1, from strokes in sheet mm. A stroke lays
 * its length times the pen width; strokes of one pen that overlap are counted once only as far
 * as the cell fills, which is near enough for tone. With `mono`, every pen is the last one.
 */
export function coverage(pens: number[][][], g: Grid, nib: number, mono = false): Float32Array[] {
  const out = pens.map(() => new Float32Array(g.W * g.H));
  const step = g.cell * 0.5;
  const per = nib / (g.cell * g.cell);
  pens.forEach((lines, k) => {
    const c = out[mono ? pens.length - 1 : k];
    for (const l of lines) {
      for (let i = 2; i < l.length; i += 2) {
        const ax = l[i - 2];
        const ay = l[i - 1];
        const dx = l[i] - ax;
        const dy = l[i + 1] - ay;
        const len = Math.hypot(dx, dy);
        if (!len) continue;
        const n = Math.ceil(len / step);
        const ink = (len / n) * per;
        for (let s = 0; s < n; s++) {
          const t = (s + 0.5) / n;
          const cx = Math.floor((ax + dx * t - g.x0) / g.cell);
          const cy = Math.floor((ay + dy * t - g.y0) / g.cell);
          if (cx >= 0 && cy >= 0 && cx < g.W && cy < g.H) c[cy * g.W + cx] += ink;
        }
      }
    }
  });
  for (const c of out) for (let i = 0; i < c.length; i++) if (c[i] > 1) c[i] = 1;
  return out;
}

/** Box widths whose three passes make a Gaussian of `sigma` cells (Kovesi's method). */
function boxes(sigma: number): number[] {
  const n = 3;
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let lo = Math.floor(ideal);
  if (lo % 2 === 0) lo--;
  const m = Math.round((12 * sigma * sigma - n * lo * lo - 4 * n * lo - 3 * n) / (-4 * lo - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? lo : lo + 2));
}

/** One box pass along rows (`dx` 1) or columns, the edges held, from `src` into `dst`. */
function boxPass(src: Float32Array, dst: Float32Array, W: number, H: number, r: number, along: boolean): void {
  const lines = along ? H : W;
  const len = along ? W : H;
  const stride = along ? 1 : W;
  const inv = 1 / (2 * r + 1);
  for (let j = 0; j < lines; j++) {
    const base = along ? j * W : j;
    const at = (k: number) => src[base + Math.max(0, Math.min(len - 1, k)) * stride];
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += at(k);
    for (let k = 0; k < len; k++) {
      dst[base + k * stride] = sum * inv;
      sum += at(k + r + 1) - at(k - r);
    }
  }
}

/** Gaussian blur of a grid in place, `sigma` in cells. */
export function blur(v: Float32Array, W: number, H: number, sigma: number): void {
  if (sigma < 0.3) return;
  const tmp = new Float32Array(v.length);
  for (const b of boxes(sigma)) {
    const r = (b - 1) / 2;
    if (r < 1) continue;
    boxPass(v, tmp, W, H, r, true);
    boxPass(tmp, v, W, H, r, false);
  }
}

/** What the drawing should look like, on a grid over the drawing area: OKLab after the tone curve, and how much each cell counts. */
export type Look = Grid & {
  L: Float32Array;
  a: Float32Array;
  b: Float32Array;
  /** 0 where there is no image to match (Fit's margins, transparent pixels). */
  weight: Float32Array;
};

/** How like the image a drawing is, seen from a step away. */
export type Likeness = {
  /** 1 − mean ΔE / the ΔE of blank paper: 0 is no better than blank paper, 1 a perfect match. */
  score: number;
  /** Mean ΔE in OKLab at arm's length (σ 1.2 mm) and across the room (σ 3 mm). */
  dE: [number, number];
  /** Structural similarity of lightness across the room. */
  ssim: number;
};

/** Blurs for arm's length and across the room, mm. */
export const NEAR = 1.2;
export const FAR = 3;
/** The window SSIM compares structure over, mm. */
const SSIM_WINDOW = 4;

/** Linear RGB planes of a grid of OKLab colours. */
function planes(L: Float32Array, a: Float32Array, b: Float32Array): Float32Array[] {
  const n = L.length;
  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const rgb = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    fromOklab(L[i], a[i], b[i], rgb);
    out[0][i] = rgb[0];
    out[1][i] = rgb[1];
    out[2][i] = rgb[2];
  }
  return out;
}

/** The colour of a drawing from its pen coverage (see `mix()`), as linear RGB planes. */
export function inked(cov: Float32Array[], set: Pick<Settings, 'pens' | 'mono' | 'customBackground' | 'background'>): Float32Array[] {
  const paper = hexToLinear(paperOf(set));
  const inks = inksOf(set);
  const n = cov[0].length;
  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const c = new Float32Array(cov.length);
  const rgb = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < cov.length; k++) c[k] = cov[k][i];
    mix(paper, inks, c, rgb);
    out[0][i] = rgb[0];
    out[1][i] = rgb[1];
    out[2][i] = rgb[2];
  }
  return out;
}

/** Blur RGB planes, each weighted by `w` and normalised, so cells with no weight don't bleed in. */
function blurred(rgb: Float32Array[], w: Float32Array | null, g: Grid, sigmaMm: number): Float32Array[] {
  const s = sigmaMm / g.cell;
  if (!w) return rgb.map((p) => {
    const q = p.slice();
    blur(q, g.W, g.H, s);
    return q;
  });
  const ww = w.slice();
  blur(ww, g.W, g.H, s);
  return rgb.map((p) => {
    const q = new Float32Array(p.length);
    for (let i = 0; i < q.length; i++) q[i] = p[i] * w[i];
    blur(q, g.W, g.H, s);
    for (let i = 0; i < q.length; i++) q[i] = ww[i] > 1e-4 ? q[i] / ww[i] : 0;
    return q;
  });
}

/** OKLab planes of linear RGB planes. */
function labOf(rgb: Float32Array[]): Float32Array[] {
  const n = rgb[0].length;
  const out = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const lab = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    oklab(rgb[0][i], rgb[1][i], rgb[2][i], lab);
    out[0][i] = lab[0];
    out[1][i] = lab[1];
    out[2][i] = lab[2];
  }
  return out;
}

/** Mean structural similarity of two lightness grids, weighted, over windows of `sigma` cells. */
function ssim(x: Float32Array, y: Float32Array, w: Float32Array, g: Grid, sigma: number, range: number): number {
  const n = x.length;
  const mx = x.slice();
  const my = y.slice();
  const xx = new Float32Array(n);
  const yy = new Float32Array(n);
  const xy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xx[i] = x[i] * x[i];
    yy[i] = y[i] * y[i];
    xy[i] = x[i] * y[i];
  }
  for (const p of [mx, my, xx, yy, xy]) blur(p, g.W, g.H, sigma);
  const c1 = (0.01 * range) ** 2;
  const c2 = (0.03 * range) ** 2;
  let sum = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (w[i] <= 0) continue;
    const vx = Math.max(0, xx[i] - mx[i] * mx[i]);
    const vy = Math.max(0, yy[i] - my[i] * my[i]);
    const cxy = xy[i] - mx[i] * my[i];
    sum += w[i] * (((2 * mx[i] * my[i] + c1) * (2 * cxy + c2)) / ((mx[i] * mx[i] + my[i] * my[i] + c1) * (vx + vy + c2)));
    total += w[i];
  }
  return total ? sum / total : 0;
}

/** Mean ΔE between two OKLab grids where `w` counts, with chroma weighed by `chroma`. */
function deltaE(p: Float32Array[], q: Float32Array[], w: Float32Array, chroma: number): number {
  let sum = 0;
  let total = 0;
  const c2 = chroma * chroma;
  for (let i = 0; i < w.length; i++) {
    if (w[i] <= 0) continue;
    const dL = p[0][i] - q[0][i];
    const da = p[1][i] - q[1][i];
    const db = p[2][i] - q[2][i];
    sum += w[i] * Math.sqrt(dL * dL + c2 * (da * da + db * db));
    total += w[i];
  }
  return total ? sum / total : 0;
}

/** How much chroma counts in a colour difference beside lightness (§7.4): by `imageColour`, and not at all in one-pen output. */
export function chromaWeight(set: Pick<Settings, 'imageColour' | 'mono'>): number {
  return set.mono ? 0 : set.imageColour;
}

/** Squinted views of a comparison, as linear RGB planes on the look's grid, for the likeness lab. */
export type Views = { drawing: Float32Array[]; look: Float32Array[] };

/**
 * Compare a drawing's pen coverage (see `coverage()`) with what it should look like, through the
 * pens and paper of `set`. Lightness counts fully, chroma by `imageColour`, and not at all in
 * one-pen output. `lightRange` is the spread of lightness the drawing can reach, for SSIM.
 */
export function likeness(cov: Float32Array[], look: Look, set: Pick<Settings, 'pens' | 'mono' | 'customBackground' | 'background' | 'imageColour'>, lightRange: number): { likeness: Likeness; views: Views } {
  const chroma = chromaWeight(set);
  const drawn = inked(cov, set);
  const want = planes(look.L, look.a, look.b);
  const paperRgb = hexToLinear(paperOf(set));
  const blank = [0, 1, 2].map((ch) => new Float32Array(look.L.length).fill(paperRgb[ch]));
  const blankLab = labOf(blank);
  const dE: [number, number] = [0, 0];
  let dE0 = 0;
  const near = { d: blurred(drawn, null, look, NEAR), t: blurred(want, look.weight, look, NEAR) };
  const far = { d: blurred(drawn, null, look, FAR), t: blurred(want, look.weight, look, FAR) };
  let farL: Float32Array[] = [];
  for (const [k, { d, t }] of [near, far].entries()) {
    const dl = labOf(d);
    const tl = labOf(t);
    dE[k] = deltaE(dl, tl, look.weight, chroma);
    dE0 += deltaE(blankLab, tl, look.weight, chroma);
    farL = [dl[0], tl[0]];
  }
  const score = dE0 > 0 ? 1 - (dE[0] + dE[1]) / dE0 : 0;
  return { likeness: { score, dE, ssim: ssim(farL[0], farL[1], look.weight, look, SSIM_WINDOW / look.cell, lightRange) }, views: { drawing: near.d, look: near.t } };
}

/** What a patch of the town can be (§8.1). Ground labels first, then built ones, roughly light to dark. */
export const LABELS = ['water', 'plaza', 'sand', 'meadow', 'field', 'park', 'allot', 'wood', 'works', 'suburb', 'rows', 'old', 'blocks', 'towers'] as const;
export type Label = (typeof LABELS)[number];
/** Labels that are buildings, with a warmth (share of pitched roofs) as well as a level. */
export const BUILT = new Set<Label>(['works', 'suburb', 'rows', 'old', 'blocks', 'towers']);

/**
 * Pen coverage of a label at level 0 and 1, by pen (shadows, water, greenery, roofs, linework),
 * with pitched roofs, and for built labels also with flat roofs (`flat…`).
 */
type Material = { lo: number[]; hi: number[]; flatLo?: number[]; flatHi?: number[] };

/**
 * How much of each pen a label lays down over a district, as a share of the paper, at each scale
 * measured: a sheet of nothing but that label, drawn by the real renderer and measured by
 * `npm run calibrate`, so built labels include their streets, gardens and shadows. Ground
 * labels don't vary with level yet, so their two rows are the same. Paste a new run in whole.
 */
const MATERIALS: Record<number, Record<Label, Material>> = {
// Measured by npm run calibrate at tilt 40°, 2026-11-17.
  1000: {
    water: { lo: [0, 0.106, 0, 0, 0.001], hi: [0, 0.106, 0, 0, 0.001] },
    plaza: { lo: [0, 0, 0, 0, 0], hi: [0, 0, 0, 0, 0] },
    sand: { lo: [0.028, 0, 0, 0.015, 0.049], hi: [0.028, 0, 0, 0.015, 0.049] },
    meadow: { lo: [0, 0, 0.043, 0, 0.001], hi: [0, 0, 0.043, 0, 0.001] },
    field: { lo: [0.005, 0, 0.159, 0, 0.001], hi: [0.005, 0, 0.159, 0, 0.001] },
    park: { lo: [0.008, 0, 0.188, 0, 0.001], hi: [0.008, 0, 0.188, 0, 0.001] },
    allot: { lo: [0.009, 0, 0.201, 0, 0.031], hi: [0.009, 0, 0.201, 0, 0.031] },
    wood: { lo: [0.05, 0, 0.119, 0, 0], hi: [0.05, 0, 0.119, 0, 0] },
    works: { lo: [0.028, 0, 0, 0.011, 0.015], hi: [0.036, 0, 0, 0.02, 0.049], flatLo: [0.028, 0, 0, 0, 0.028], flatHi: [0.036, 0, 0, 0, 0.045] },
    suburb: { lo: [0.025, 0, 0.054, 0.032, 0.046], hi: [0.07, 0, 0.058, 0.115, 0.079], flatLo: [0.018, 0, 0.056, 0, 0.054], flatHi: [0.059, 0, 0.063, 0, 0.107] },
    rows: { lo: [0.068, 0, 0.025, 0.12, 0.054], hi: [0.088, 0, 0.011, 0.185, 0.09], flatLo: [0.056, 0, 0.026, 0, 0.086], flatHi: [0.079, 0, 0.012, 0, 0.142] },
    old: { lo: [0.092, 0, 0.012, 0.193, 0.081], hi: [0.098, 0, 0.007, 0.125, 0.124], flatLo: [0.083, 0, 0.013, 0, 0.126], flatHi: [0.094, 0, 0.008, 0, 0.162] },
    blocks: { lo: [0.092, 0, 0.024, 0.053, 0.062], hi: [0.099, 0, 0.008, 0.173, 0.095], flatLo: [0.078, 0, 0.025, 0, 0.083], flatHi: [0.099, 0, 0.009, 0.001, 0.152] },
    towers: { lo: [0.034, 0, 0.028, 0, 0.026], hi: [0.132, 0, 0.023, 0, 0.088], flatLo: [0.034, 0, 0.028, 0, 0.026], flatHi: [0.132, 0, 0.023, 0, 0.088] },
  },
  2500: {
    water: { lo: [0, 0.103, 0, 0, 0.003], hi: [0, 0.103, 0, 0, 0.003] },
    plaza: { lo: [0, 0, 0, 0, 0.001], hi: [0, 0, 0, 0, 0.001] },
    sand: { lo: [0, 0, 0, 0, 0.013], hi: [0, 0, 0, 0, 0.013] },
    meadow: { lo: [0, 0, 0.042, 0, 0], hi: [0, 0, 0.042, 0, 0] },
    field: { lo: [0.003, 0, 0.184, 0, 0.002], hi: [0.003, 0, 0.184, 0, 0.002] },
    park: { lo: [0.008, 0, 0.201, 0, 0.002], hi: [0.008, 0, 0.201, 0, 0.002] },
    allot: { lo: [0, 0, 0.174, 0, 0.052], hi: [0, 0, 0.174, 0, 0.052] },
    wood: { lo: [0.027, 0, 0.213, 0, 0], hi: [0.027, 0, 0.213, 0, 0] },
    works: { lo: [0.021, 0, 0.009, 0.032, 0.044], hi: [0.053, 0, 0.023, 0.079, 0.103], flatLo: [0.022, 0, 0.009, 0, 0.037], flatHi: [0.054, 0, 0.023, 0, 0.084] },
    suburb: { lo: [0.02, 0, 0.054, 0.047, 0.058], hi: [0.062, 0, 0.041, 0.135, 0.115], flatLo: [0.012, 0, 0.055, 0, 0.081], flatHi: [0.044, 0, 0.043, 0, 0.181] },
    rows: { lo: [0.052, 0, 0.05, 0.151, 0.088], hi: [0.081, 0, 0.016, 0.232, 0.151], flatLo: [0.037, 0, 0.052, 0, 0.163], flatHi: [0.066, 0, 0.019, 0, 0.27] },
    old: { lo: [0.085, 0, 0.021, 0.21, 0.135], hi: [0.08, 0, 0.023, 0.139, 0.175], flatLo: [0.069, 0, 0.023, 0, 0.236], flatHi: [0.077, 0, 0.025, 0, 0.265] },
    blocks: { lo: [0.069, 0, 0.049, 0.077, 0.078], hi: [0.092, 0, 0.019, 0.126, 0.124], flatLo: [0.06, 0, 0.051, 0, 0.117], flatHi: [0.087, 0, 0.02, 0, 0.188] },
    towers: { lo: [0.032, 0, 0.061, 0, 0.049], hi: [0.117, 0, 0.039, 0, 0.117], flatLo: [0.032, 0, 0.061, 0, 0.049], flatHi: [0.117, 0, 0.039, 0, 0.117] },
  },
  5000: {
    water: { lo: [0, 0.1, 0, 0, 0.025], hi: [0, 0.1, 0, 0, 0.025] },
    plaza: { lo: [0, 0, 0, 0, 0], hi: [0, 0, 0, 0, 0] },
    sand: { lo: [0, 0, 0.014, 0, 0.024], hi: [0, 0, 0.014, 0, 0.024] },
    meadow: { lo: [0, 0, 0.059, 0, 0.012], hi: [0, 0, 0.059, 0, 0.012] },
    field: { lo: [0, 0, 0.154, 0, 0.015], hi: [0, 0, 0.154, 0, 0.015] },
    park: { lo: [0, 0, 0.217, 0, 0.013], hi: [0, 0, 0.217, 0, 0.013] },
    allot: { lo: [0, 0, 0.328, 0, 0.093], hi: [0, 0, 0.328, 0, 0.093] },
    wood: { lo: [0, 0, 0.14, 0, 0.011], hi: [0, 0, 0.14, 0, 0.011] },
    works: { lo: [0.022, 0, 0.015, 0.081, 0.083], hi: [0.044, 0, 0.026, 0.135, 0.125], flatLo: [0.022, 0, 0.015, 0, 0.098], flatHi: [0.044, 0, 0.026, 0.001, 0.139] },
    suburb: { lo: [0.013, 0, 0.086, 0.058, 0.081], hi: [0.054, 0, 0.059, 0.159, 0.191], flatLo: [0, 0, 0.087, 0.001, 0.119], flatHi: [0.036, 0, 0.062, 0, 0.298] },
    rows: { lo: [0.05, 0, 0.088, 0.193, 0.143], hi: [0.083, 0, 0.046, 0.291, 0.22], flatLo: [0.033, 0, 0.09, 0, 0.286], flatHi: [0.067, 0, 0.048, 0, 0.432] },
    old: { lo: [0.083, 0, 0.042, 0.264, 0.221], hi: [0.074, 0, 0.041, 0.213, 0.26], flatLo: [0.067, 0, 0.044, 0, 0.405], flatHi: [0.07, 0, 0.045, 0, 0.406] },
    blocks: { lo: [0.072, 0, 0.085, 0.124, 0.11], hi: [0.077, 0, 0.036, 0.191, 0.155], flatLo: [0.061, 0, 0.087, 0, 0.184], flatHi: [0.075, 0, 0.039, 0, 0.27] },
    towers: { lo: [0.028, 0, 0.075, 0, 0.077], hi: [0.101, 0, 0.044, 0, 0.151], flatLo: [0.028, 0, 0.075, 0, 0.077], flatHi: [0.101, 0, 0.044, 0, 0.151] },
  },
  8000: {
    water: { lo: [0, 0.106, 0, 0, 0.003], hi: [0, 0.106, 0, 0, 0.003] },
    plaza: { lo: [0, 0, 0, 0, 0], hi: [0, 0, 0, 0, 0] },
    sand: { lo: [0, 0, 0.002, 0, 0.014], hi: [0, 0, 0.002, 0, 0.014] },
    meadow: { lo: [0, 0, 0.041, 0, 0.002], hi: [0, 0, 0.041, 0, 0.002] },
    field: { lo: [0, 0, 0.143, 0, 0.011], hi: [0, 0, 0.143, 0, 0.011] },
    park: { lo: [0, 0, 0.206, 0, 0.004], hi: [0, 0, 0.206, 0, 0.004] },
    allot: { lo: [0, 0, 0.467, 0, 0.112], hi: [0, 0, 0.467, 0, 0.112] },
    wood: { lo: [0, 0, 0.053, 0, 0.002], hi: [0, 0, 0.053, 0, 0.002] },
    works: { lo: [0.019, 0, 0.006, 0.104, 0.13], hi: [0.036, 0, 0.017, 0.196, 0.194], flatLo: [0.019, 0, 0.006, 0, 0.138], flatHi: [0.036, 0, 0.016, 0.001, 0.205] },
    suburb: { lo: [0.001, 0, 0.053, 0.084, 0.119], hi: [0.048, 0, 0.046, 0.245, 0.251], flatLo: [0, 0, 0.054, 0, 0.175], flatHi: [0.025, 0, 0.048, 0, 0.419] },
    rows: { lo: [0.048, 0, 0.066, 0.239, 0.205], hi: [0.076, 0, 0.045, 0.311, 0.296], flatLo: [0.032, 0, 0.068, 0, 0.383], flatHi: [0.058, 0, 0.048, 0, 0.525] },
    old: { lo: [0.076, 0, 0.041, 0.316, 0.294], hi: [0.072, 0, 0.029, 0.226, 0.316], flatLo: [0.059, 0, 0.042, 0.001, 0.529], flatHi: [0.067, 0, 0.031, 0.001, 0.486] },
    blocks: { lo: [0.064, 0, 0.074, 0.177, 0.174], hi: [0.064, 0, 0.037, 0.267, 0.226], flatLo: [0.053, 0, 0.076, 0, 0.28], flatHi: [0.062, 0, 0.039, 0.002, 0.399] },
    towers: { lo: [0.027, 0, 0.051, 0, 0.122], hi: [0.094, 0, 0.031, 0, 0.24], flatLo: [0.027, 0, 0.051, 0, 0.122], flatHi: [0.094, 0, 0.031, 0, 0.24] },
  },
};
/** The scales measured, finest first. */
const MEASURED = Object.keys(MATERIALS).map(Number).sort((a, b) => a - b);

/** Pen coverage of a label at a level (0–1) and warmth (0 flat roofs, 1 pitched), at a scale, between the scales measured in log(scale). */
export function material(label: Label, level: number, warmth = 1, scale = 2500): number[] {
  const at = (m: Material) => {
    const lerp = (lo: number[], hi: number[]) => lo.map((v, i) => v + (hi[i] - v) * level);
    const warm = lerp(m.lo, m.hi);
    if (!m.flatLo || !m.flatHi) return warm;
    const flat = lerp(m.flatLo, m.flatHi);
    return warm.map((v, i) => flat[i] + (v - flat[i]) * warmth);
  };
  const s = Math.max(MEASURED[0], Math.min(MEASURED[MEASURED.length - 1], scale));
  let k = 0;
  while (k < MEASURED.length - 2 && MEASURED[k + 1] < s) k++;
  const a = at(MATERIALS[MEASURED[k]][label]);
  if (MEASURED.length === 1) return a;
  const b = at(MATERIALS[MEASURED[k + 1]][label]);
  const t = Math.max(0, Math.min(1, Math.log(s / MEASURED[k]) / Math.log(MEASURED[k + 1] / MEASURED[k])));
  return a.map((v, i) => v + (b[i] - v) * t);
}

/** The OKLab colour of a label at a level and warmth through these pens and paper. */
export function materialColour(label: Label, level: number, warmth: number, set: Pick<Settings, 'pens' | 'mono' | 'customBackground' | 'background' | 'scale'>): [number, number, number] {
  const rgb = [0, 0, 0];
  const c = material(label, level, warmth, set.scale);
  if (set.mono) c[4] = Math.min(1, c.reduce((a, v) => a + v, 0));
  mix(hexToLinear(paperOf(set)), inksOf(set), set.mono ? [0, 0, 0, 0, c[4]] : c, rgb);
  const lab: [number, number, number] = [0, 0, 0];
  oklab(rgb[0], rgb[1], rgb[2], lab);
  return lab;
}
