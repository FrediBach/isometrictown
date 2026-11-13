export type LngLat = [number, number];

/** Web Mercator circumference in metres. */
export const EARTH = 40075016.686;

export function mercX(lng: number): number {
  return (lng / 360) * EARTH;
}

export function mercY(lat: number): number {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return (Math.log(Math.tan(Math.PI / 4 + r / 2)) / (2 * Math.PI)) * EARTH;
}

export function lngOf(mx: number): number {
  return (mx / EARTH) * 360;
}

export function latOf(my: number): number {
  return ((2 * Math.atan(Math.exp((my / EARTH) * 2 * Math.PI)) - Math.PI / 2) * 180) / Math.PI;
}

/**
 * Local, true-to-scale metres around a centre point: x east, y north.
 * Mercator is conformal, so scaling by cos(lat) gives real metres near the centre.
 */
export class Frame {
  readonly mx0: number;
  readonly my0: number;
  readonly k: number;

  constructor(readonly center: LngLat) {
    this.mx0 = mercX(center[0]);
    this.my0 = mercY(center[1]);
    this.k = Math.cos((center[1] * Math.PI) / 180);
  }

  /** Mercator metres to local metres. */
  x(mx: number): number {
    return (mx - this.mx0) * this.k;
  }

  y(my: number): number {
    return (my - this.my0) * this.k;
  }

  toLngLat(x: number, y: number): LngLat {
    return [lngOf(this.mx0 + x / this.k), latOf(this.my0 + y / this.k)];
  }
}

/** Signed area of a flat [x0, y0, x1, y1, ...] ring; positive when counter-clockwise (y up). */
export function ringArea(pts: ArrayLike<number>): number {
  let a = 0;
  const n = pts.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) a += (pts[j] - pts[i]) * (pts[j + 1] + pts[i + 1]);
  return a / 2;
}

export function pointInRing(x: number, y: number, pts: ArrayLike<number>): boolean {
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
