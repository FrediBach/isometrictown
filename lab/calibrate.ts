/**
 * Measures what each zone label lays down: a town of one label, level and warmth everywhere,
 * drawn with the real renderer, and each pen's coverage over the middle of the sheet. The
 * numbers go into `MATERIALS` in `src/image-tone.ts`. `npm run calibrate` drives it through
 * `lab/calibrate.mjs`. This is the first step of the calibration in docs/plans/image-mode.md §7.3:
 * one scale and tilt for now.
 */
import { Camera } from '../src/camera';
import { Frame } from '../src/geo';
import { drawnAs, imageRegion, imageScene, imageTown } from '../src/image';
import { readImage } from '../src/image-read';
import { predict } from '../src/image-tune';
import { blur, BUILT, coverage, LABELS, MATERIALS, type Label, type Material } from '../src/image-tone';
import type { Zones } from '../src/image-zones';
import { reachHeight, render } from '../src/render';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { STYLES } from '../src/styles';
import { paint, PICTURES } from '../test/support/pictures';

export { LABELS };

/** The settings swatches are drawn with: image mode as it starts, on A4 with no margin notes. */
export function swatchSettings(scale: number, tilt: number): Settings {
  return drawnAs({ ...structuredClone(DEFAULT_SETTINGS), source: 'image', scale, tilt, sheet: 'a4', power: false, marginalia: false, frame: false });
}

/** Mean coverage of each pen over the middle of a sheet of one label. */
export function swatch(label: Label, level: number, warmth: number, scale = 2500, tilt = 40): number[] {
  const set = swatchSettings(scale, tilt);
  const cam = new Camera(set);
  const frame = new Frame(set.center);
  const box = cam.region(reachHeight(set));
  const pad = 400;
  const cell = 8;
  const W = Math.ceil((box[2] - box[0] + 2 * pad) / cell);
  const H = Math.ceil((box[3] - box[1] + 2 * pad) / cell);
  const zones: Zones = { x0: box[0] - pad, y0: box[1] - pad, cell, W, H, label: new Uint8Array(W * H).fill(LABELS.indexOf(label)), level: new Float32Array(W * H).fill(level), warmth: new Float32Array(W * H).fill(warmth), sp: new Int32Array(W * H) };
  const region = imageRegion(set);
  // A flat grey picture: no lines and no orientation for the streets to follow.
  const target = readImage(paint('Flat', () => [128, 128, 128]), set, cam.rect);
  const { town } = imageTown(zones, target, set, cam, frame, box, STYLES[region.style]);
  const drawing = render(town, set, frame, STYLES[region.style], undefined, region.left);
  // The middle of the drawing area, clear of anything odd at its edges.
  const [x0, y0, x1, y1] = cam.rect;
  const g = { x0: x0 + (x1 - x0) * 0.2, y0: y0 + (y1 - y0) * 0.2, cell: 0.5, W: Math.floor(((x1 - x0) * 0.6) / 0.5), H: Math.floor(((y1 - y0) * 0.6) / 0.5) };
  return coverage(drawing.pens, g, set.penWidth).map((c) => c.reduce((a, v) => a + v, 0) / c.length);
}

/**
 * Fit the materials at one scale to real towns (§7.3 step 4): draw each picture, measure each
 * pen's ink where every predictor cell shows, and solve by least squares for the materials that
 * predict it best, both sides blurred over `blurMm` so ink drawn a little off its lot (walls,
 * roofs, shadows) still counts for it. The uniform swatches are the prior, weighted by `alpha`,
 * so a label the pictures barely have keeps its swatch.
 */
export function fit(scale: number, names: string[], alpha = 0.02, blurMm = 2): Record<Label, Material> {
  const prior = MATERIALS[40][scale];
  // Features: per built label lo·warm, hi·warm, flatLo·flat, flatHi·flat; per other label one.
  const slots: { label: Label; part: keyof Material }[] = [];
  for (const label of LABELS) {
    if (BUILT.has(label)) for (const part of ['lo', 'hi', 'flatLo', 'flatHi'] as const) slots.push({ label, part });
    else slots.push({ label, part: 'lo' });
  }
  const F = slots.length;
  const first = new Map<Label, number>();
  slots.forEach((s, i) => first.has(s.label) || first.set(s.label, i));
  const XtX = new Float64Array(F * F);
  const Xty = [0, 1, 2, 3, 4].map(() => new Float64Array(F));
  let count = 0;
  for (const name of names) {
    const pic = PICTURES[name]();
    // As the likeness lab draws it: image mode as it starts, on A3.
    const scene = imageScene(pic, { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id, imageName: pic.name, scale, tilt: 40, power: false, sheet: 'a3' });
    const p = predict(structuredClone(scene.blocks), scene.zones, scene.target, scene.cam, scene.set, scene.box);
    const drawing = render(scene.town, scene.set, scene.frame, scene.style, undefined, scene.region.left);
    const t = scene.target;
    const real = coverage(drawing.pens, { x0: t.x0, y0: t.y0, cell: t.cell, W: t.W, H: t.H }, scene.set.penWidth);
    for (const plane of real) blur(plane, t.W, t.H, blurMm / t.cell);
    const n = p.W * p.H;
    const planes = slots.map(() => new Float32Array(n));
    for (let c = 0; c < n; c++) {
      const li = p.owner[c];
      const zc = p.ground[c];
      const [label, level, warmth] = li >= 0 ? [p.lots[li].label, p.lots[li].level, p.lots[li].warmth] : zc >= 0 ? [LABELS[scene.zones.label[zc]], scene.zones.level[zc], scene.zones.warmth[zc]] : [null, 0, 0];
      if (!label) continue;
      const f = first.get(label)!;
      if (BUILT.has(label)) {
        planes[f][c] = (1 - level) * warmth;
        planes[f + 1][c] = level * warmth;
        planes[f + 2][c] = (1 - level) * (1 - warmth);
        planes[f + 3][c] = level * (1 - warmth);
      } else planes[f][c] = 1;
    }
    for (const plane of planes) blur(plane, p.W, p.H, blurMm / p.cellMm);
    const x = new Float64Array(F);
    for (let c = 0; c < n; c++) {
      const at = p.at[c];
      if (at < 0 || p.weight[c] <= 0) continue;
      for (let i = 0; i < F; i++) x[i] = planes[i][c];
      for (let i = 0; i < F; i++) {
        if (!x[i]) continue;
        for (let j = 0; j < F; j++) XtX[i * F + j] += x[i] * x[j];
        for (let k = 0; k < 5; k++) Xty[k][i] += x[i] * real[k][at];
      }
      count++;
    }
  }
  // Ridge towards the swatches, then solve each pen.
  const m0 = (s: (typeof slots)[number]) => prior[s.label][s.part] ?? prior[s.label].lo;
  const out = {} as Record<Label, Material>;
  for (const label of LABELS) out[label] = BUILT.has(label) ? { lo: [], hi: [], flatLo: [], flatHi: [] } : { lo: [], hi: [] };
  for (let k = 0; k < 5; k++) {
    const A = Float64Array.from(XtX);
    const b = Float64Array.from(Xty[k]);
    for (let i = 0; i < F; i++) {
      A[i * F + i] += alpha * count / F;
      b[i] += ((alpha * count) / F) * m0(slots[i])[k];
    }
    const m = solve(A, b, F);
    slots.forEach((s, i) => {
      const v = Math.max(0, m[i]);
      const mat = out[s.label];
      (mat[s.part] as number[])[k] = v;
      if (!BUILT.has(s.label)) mat.hi[k] = v;
    });
  }
  return out;
}

/** Gaussian elimination with partial pivoting: A x = b for an n × n system. */
function solve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
    if (p !== c) {
      for (let j = 0; j < n; j++) [A[c * n + j], A[p * n + j]] = [A[p * n + j], A[c * n + j]];
      [b[c], b[p]] = [b[p], b[c]];
    }
    const d = A[c * n + c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / d;
      if (!f) continue;
      for (let j = c; j < n; j++) A[r * n + j] -= f * A[c * n + j];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let v = b[r];
    for (let j = r + 1; j < n; j++) v -= A[r * n + j] * x[j];
    x[r] = v / (A[r * n + r] || 1e-12);
  }
  return x;
}
