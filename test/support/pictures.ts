/**
 * Pictures made in code for image mode, so the tests and the likeness lab need no image files.
 * Each stresses something different: a tone ramp, a blob, colour bands, oriented stripes, bright
 * lines that want to be streets, and a soft landscape.
 */
import type { Picture } from '@/image';
import { hash, patch } from '@/rng';

const W = 300;
const H = 200;

type Paint = (u: number, v: number) => [number, number, number] | [number, number, number, number];

/** A content id for a picture made here: two FNV-1a hashes of its size and pixels (the app uses SHA-256; any stable id will do). */
function idOf(rgba: Uint8ClampedArray, w: number, h: number): string {
  const fnv = (seed: number) => {
    let x = Math.imul(Math.imul(seed ^ w, 0x01000193) ^ h, 0x01000193);
    for (let i = 0; i < rgba.length; i++) x = Math.imul(x ^ rgba[i], 0x01000193);
    return (x >>> 0).toString(16).padStart(8, '0');
  };
  return fnv(0x811c9dc5) + fnv(0x2c1b3c6d);
}

/** A picture from a function of position (0–1 across and down) to sRGB 0–255 and optional alpha. */
export function paint(name: string, fn: Paint, w = W, h = H): Picture {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = fn((x + 0.5) / w, (y + 0.5) / h);
      rgba.set([r, g, b, a], (y * w + x) * 4);
    }
  return { id: idOf(rgba, w, h), name, w, h, rgba };
}

const grey = (v: number): [number, number, number] => [v, v, v];
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const PICTURES: Record<string, () => Picture> = {
  /** Light on the left to dark on the right. */
  gradient: () => paint('Gradient', (u) => grey(245 - u * 225)),
  /** A dark disc on light paper. */
  disc: () => paint('Disc', (u, v) => grey(Math.hypot((u - 0.5) * 1.5, v - 0.5) < 0.3 ? 40 : 230)),
  /** Red at the top, green in the middle, blue at the bottom. */
  bands: () => paint('Bands', (_u, v) => (v < 1 / 3 ? [196, 64, 52] : v < 2 / 3 ? [70, 140, 70] : [60, 100, 190])),
  /** Diagonal stripes, dark and light. */
  stripes: () => paint('Stripes', (u, v) => grey(Math.sin((u * 1.5 + v) * Math.PI * 8) > 0 ? 50 : 220)),
  /** A white cross on mid-grey: bright lines that should become streets. */
  cross: () => paint('Cross', (u, v) => grey(Math.abs(u - 0.5) < 0.03 || Math.abs(v - 0.45) < 0.045 ? 250 : 120)),
  /** Soft noise: a sky, hills and a village, more or less. */
  landscape: () =>
    paint('Landscape', (u, v) => {
      const n = 0.55 * patch(u * 4, v * 4, 1, 1) + 0.3 * patch(u * 9, v * 9, 1, 2) + 0.15 * hash(Math.floor(u * 60), Math.floor(v * 60), 1, 3);
      const sky = 1 - smooth(0.25, 0.4, v + (n - 0.5) * 0.2);
      const village = smooth(0.15, 0.05, Math.hypot(u - 0.7, v - 0.8) - 0.1 * n);
      const r = 90 + 60 * n + sky * 90 + village * 70;
      const g = 120 + 70 * n + sky * 90 - village * 40;
      const b = 70 + 30 * n + sky * 150 - village * 30;
      return [r, g, b];
    }),
};
