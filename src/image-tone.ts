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
 * How much of each pen a label lays down over a district, as a share of the paper: a sheet of
 * nothing but that label, drawn by the real renderer and measured by `npm run calibrate`, so
 * built labels include their streets, gardens and shadows. One scale and tilt for now; M5
 * measures more and interpolates (docs/plans/image-mode.md §7.3). Ground labels don't vary with
 * level yet, so their two rows are the same.
 */
const MATERIALS: Record<Label, Material> = {
// Measured by npm run calibrate at 1:2500, tilt 40°, 2026-11-17.
  water: { lo: [0, 0.103, 0, 0, 0.003], hi: [0, 0.103, 0, 0, 0.003] },
  plaza: { lo: [0.001, 0.002, 0.004, 0, 0.132], hi: [0.001, 0.002, 0.004, 0, 0.132] },
  sand: { lo: [0, 0, 0, 0, 0.034], hi: [0, 0, 0, 0, 0.034] },
  meadow: { lo: [0.008, 0, 0.1, 0, 0], hi: [0.008, 0, 0.1, 0, 0] },
  field: { lo: [0.008, 0, 0.193, 0, 0], hi: [0.008, 0, 0.193, 0, 0] },
  park: { lo: [0.009, 0, 0.203, 0, 0], hi: [0.009, 0, 0.203, 0, 0] },
  allot: { lo: [0.003, 0, 0.133, 0, 0.093], hi: [0.003, 0, 0.133, 0, 0.093] },
  wood: { lo: [0.027, 0, 0.213, 0, 0], hi: [0.027, 0, 0.213, 0, 0] },
  works: { lo: [0.038, 0, 0.024, 0.082, 0.139], hi: [0.094, 0, 0.02, 0.111, 0.134], flatLo: [0.041, 0, 0.024, 0.001, 0.167], flatHi: [0.101, 0, 0.02, 0, 0.181] },
  suburb: { lo: [0.046, 0, 0.041, 0.115, 0.141], hi: [0.041, 0, 0.038, 0.144, 0.152], flatLo: [0.034, 0, 0.043, 0, 0.208], flatHi: [0.033, 0, 0.038, 0, 0.239] },
  rows: { lo: [0.027, 0, 0.016, 0.154, 0.132], hi: [0.049, 0, 0.012, 0.185, 0.138], flatLo: [0.019, 0, 0.016, 0, 0.208], flatHi: [0.037, 0, 0.012, 0, 0.239] },
  old: { lo: [0.075, 0, 0.024, 0.262, 0.14], hi: [0.058, 0, 0.006, 0.208, 0.219], flatLo: [0.062, 0, 0.022, 0, 0.288], flatHi: [0.055, 0, 0.005, 0, 0.324] },
  blocks: { lo: [0.086, 0, 0.016, 0.187, 0.119], hi: [0.045, 0, 0.002, 0.209, 0.106], flatLo: [0.082, 0, 0.015, 0, 0.229], flatHi: [0.044, 0, 0.002, 0, 0.216] },
  towers: { lo: [0.114, 0, 0.035, 0, 0.118], hi: [0.11, 0, 0.001, 0, 0.121], flatLo: [0.114, 0, 0.035, 0, 0.118], flatHi: [0.11, 0, 0.001, 0, 0.121] },
};

/** Pen coverage of a label at a level (0–1) and warmth (0 flat roofs, 1 pitched). */
export function material(label: Label, level: number, warmth = 1): number[] {
  const m = MATERIALS[label];
  const at = (lo: number[], hi: number[]) => lo.map((v, i) => v + (hi[i] - v) * level);
  const warm = at(m.lo, m.hi);
  if (!m.flatLo || !m.flatHi) return warm;
  const flat = at(m.flatLo, m.flatHi);
  return warm.map((v, i) => flat[i] + (v - flat[i]) * warmth);
}

/** The OKLab colour of a label at a level and warmth through these pens and paper. */
export function materialColour(label: Label, level: number, warmth: number, set: Pick<Settings, 'pens' | 'mono' | 'customBackground' | 'background'>): [number, number, number] {
  const rgb = [0, 0, 0];
  const c = material(label, level, warmth);
  if (set.mono) c[4] = Math.min(1, c.reduce((a, v) => a + v, 0));
  mix(hexToLinear(paperOf(set)), inksOf(set), set.mono ? [0, 0, 0, 0, c[4]] : c, rgb);
  const lab: [number, number, number] = [0, 0, 0];
  oklab(rgb[0], rgb[1], rgb[2], lab);
  return lab;
}
