/** Local building coverage in image mode, sampled where each plot stands on the sheet. */
import type { Camera } from './camera';
import { centre } from './image-check';
import type { Vary } from './image-blocks';
import type { Target } from './image-read';

/** Signed change in coverage, from open ground in the lights to deeper buildings in the darks. */
export type Density = (x: number, y: number) => number;

/** The adjusted tone drives density only where the picture covers the sheet. */
export function densityOf(target: Target, cam: Camera, thin = false): Density {
  const { x0, y0, W, H, cell, weight, tone } = target;
  return (x, y) => {
    const col = Math.floor((cam.sx(x, y) - x0) / cell);
    const row = Math.floor((cam.sy(x, y, 0) - y0) / cell);
    if (col < 0 || col >= W || row < 0 || row >= H) return 0;
    const i = row * W + col;
    // Thinning opens plots across the picture, most strongly in its pale areas.
    if (thin) return -weight[i] * (0.5 + 0.5 * tone[i]);
    return weight[i] * (1 - 2 * tone[i]);
  };
}

/** Pale lots gradually drop out using a fixed rank, so raising the control opens up the same gardens. */
export function vacant(density: number, x: number, y: number, vary: Vary): boolean {
  return density < 0 && vary(x, y, 14142) < -density * 0.95;
}

/**
 * Try a footprint with the requested coverage. Rows keep their street fronts and grow towards
 * the courtyard, with the depth at each party wall shared by both houses, or through `deepen`
 * where a learnt plan stands on the lot. Detached buildings
 * also use more of their plot's width. In tight quarters, take only the extra ground that fits.
 */
export function footprintAtDensity(ring: number[], row: boolean, density: Density, fits: (ring: number[]) => boolean, deepen?: (more: number) => number[]): number[] {
  const [x, y] = centre(ring);
  const d = density(x, y);
  if (!d) return ring;
  let wanted = ring.slice();
  // A learnt plan on a row lot is drawn again deeper, wings and all, from the same front.
  if (row && deepen) wanted = deepen(d * (d > 0 ? 0.9 : 0.30));
  else if (row) {
    for (let a = 0; a < ring.length / 2; a += 2) {
      const b = ring.length - a - 2;
      const side = density((ring[a] + ring[b]) / 2, (ring[a + 1] + ring[b + 1]) / 2);
      const more = side * (side > 0 ? 0.9 : 0.30);
      wanted[b] += (ring[b] - ring[a]) * more;
      wanted[b + 1] += (ring[b + 1] - ring[a + 1]) * more;
    }
  } else {
    const more = d * (d > 0 ? 0.42 : 0.22);
    for (let i = 0; i < ring.length; i += 2) {
      wanted[i] += (ring[i] - x) * more;
      wanted[i + 1] += (ring[i + 1] - y) * more;
    }
  }
  if (fits(wanted)) return wanted;
  if (d < 0) return ring;
  let best = ring;
  let lo = 0, hi = 1;
  for (let step = 0; step < 3; step++) {
    const f = (lo + hi) / 2;
    const candidate = ring.map((v, i) => v + (wanted[i] - v) * f);
    if (fits(candidate)) {
      lo = f;
      best = candidate;
    } else hi = f;
  }
  return best;
}
