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

function crossesRay(x: number, y: number, pts: ArrayLike<number>, i: number, j: number): boolean {
  const yi = pts[i + 1], yj = pts[j + 1];
  return yi > y !== yj > y && x < ((pts[j] - pts[i]) * (y - yi)) / (yj - yi) + pts[i];
}

/** Whether a point is inside a ring, using the even-odd rule. */
export function pointInRing(x: number, y: number, pts: ArrayLike<number>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2)
    if (crossesRay(x, y, pts, i, j)) inside = !inside;
  return inside;
}

/** Test many points against a fixed ring. For long outlines, file the edges by their northing. */
export function ringTest(pts: number[], y0: number, y1: number): (x: number, y: number) => boolean {
  if (pts.length < 64 || y0 === y1) return (x, y) => pointInRing(x, y, pts);
  const count = Math.min(64, Math.ceil(pts.length / 16));
  const bands: number[][] = Array.from({ length: count }, () => []);
  const band = (y: number) => Math.min(count - 1, Math.floor(((y - y0) / (y1 - y0)) * count));
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const a = pts[i + 1], b = pts[j + 1];
    if (a === b) continue;
    const last = band(Math.max(a, b));
    for (let k = band(Math.min(a, b)); k <= last; k++) bands[k].push(i);
  }
  return (x, y) => {
    if (y < y0 || y >= y1) return false;
    let inside = false;
    for (const i of bands[band(y)]) if (crossesRay(x, y, pts, i, i ? i - 2 : pts.length - 2)) inside = !inside;
    return inside;
  };
}

/** How far a point is from a ring's outline, m. */
export function toRing(x: number, y: number, p: number[]): number {
  let best = Infinity;
  for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2) {
    const dx = p[a] - p[b];
    const dy = p[a + 1] - p[b + 1];
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - p[b]) * dx + (y - p[b + 1]) * dy) / l2));
    best = Math.min(best, Math.hypot(x - p[b] - dx * t, y - p[b + 1] - dy * t));
  }
  return best;
}
