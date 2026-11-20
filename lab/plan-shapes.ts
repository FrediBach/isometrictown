/**
 * Plan shapes for the floorplan lab (lab/floorplans.ts): straightening a real footprint into a
 * plan with square corners, and the grid key under which the same plan from many towns is counted.
 */
import { ringArea } from '../src/geo';
import { simpleFootprint } from '../src/image-check';
import { simplify } from '../src/image-blocks';

/** Plan grid: corners are snapped to this many steps across the unit box. */
export const GRID = 8;
/** How far a wall may lean off the street's axes and still count as square to it, degrees. */
const LEAN = 12;
/** Walls shorter than this are folded into their neighbours, m. */
const JOG = 0.8;

/**
 * Straighten a ring given in street axes (a along, b in from the street, m) into a plan whose
 * walls all run along a or b: each wall to the axis it is nearest, runs of one axis merged, short
 * jogs folded away. Null where too much of it leans, or it doesn't come out a simple ring.
 */
export function straighten(p: number[]): number[] | null {
  // Simplify as two open halves, split at the corner farthest from the first.
  let far = 0;
  for (let k = 2; k < p.length; k += 2) if (Math.hypot(p[k] - p[0], p[k + 1] - p[1]) > Math.hypot(p[far] - p[0], p[far + 1] - p[1])) far = k;
  if (!far) return null;
  const ring = [...simplify(p.slice(0, far + 2), 0.3).slice(0, -2), ...simplify([...p.slice(far), p[0], p[1]], 0.3).slice(0, -2)];
  const n = ring.length / 2;
  if (n < 4) return null;
  // Runs: [axis (0: along a, so b is fixed; 1: along b), fixed coordinate, length].
  const runs: [number, number, number][] = [];
  let leaning = 0;
  let total = 0;
  for (let k = 0; k < n; k++) {
    const ax = ring[k * 2];
    const ay = ring[k * 2 + 1];
    const bx = ring[((k + 1) % n) * 2];
    const by = ring[((k + 1) % n) * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    total += len;
    const ang = (Math.atan2(Math.abs(by - ay), Math.abs(bx - ax)) * 180) / Math.PI;
    const axis = ang < 45 ? 0 : 1;
    if (Math.min(ang, 90 - ang) > LEAN && len >= 1) leaning += len;
    runs.push(axis === 0 ? [0, (ay + by) / 2, len] : [1, (ax + bx) / 2, len]);
  }
  if (leaning > 0.1 * total) return null;
  const join = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [a[0], (a[1] * a[2] + b[1] * b[2]) / (a[2] + b[2] || 1), a[2] + b[2]];
  // Merge neighbouring runs on one axis, round the ring.
  const merged = (list: [number, number, number][]) => {
    const out: [number, number, number][] = [];
    for (const r of list) {
      if (out.length && out[out.length - 1][0] === r[0]) out[out.length - 1] = join(out[out.length - 1], r);
      else out.push(r);
    }
    while (out.length > 1 && out[0][0] === out[out.length - 1][0]) out[0] = join(out.pop()!, out[0]);
    return out;
  };
  let rs = merged(runs);
  // A run's actual length once straightened is the gap between its neighbours' fixed coordinates.
  for (let guard = 0; guard < 64 && rs.length > 4; guard++) {
    let worst = -1;
    let shortest = JOG;
    for (let i = 0; i < rs.length; i++) {
      const prev = rs[(i + rs.length - 1) % rs.length];
      const next = rs[(i + 1) % rs.length];
      const len = Math.abs(next[1] - prev[1]);
      if (len < shortest) [shortest, worst] = [len, i];
    }
    if (worst < 0) break;
    rs.splice(worst, 1);
    rs = merged(rs);
  }
  if (rs.length < 4 || rs.length % 2) return null;
  const out: number[] = [];
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    const next = rs[(i + 1) % rs.length];
    // The corner where this run meets the next: one fixes b, the other a.
    out.push(...(r[0] === 0 ? [next[1], r[1]] : [r[1], next[1]]));
  }
  return simpleFootprint(out) && ringArea(out) > 0 ? out : null;
}

/**
 * A plan snapped to the grid, as a key: corners on whole grid steps, collinear corners dropped,
 * starting from the lowest corner, and the smaller of it and its mirror. Null if snapping folds it.
 */
export function canonical(ring: number[]): { key: string; ring: number[] } | null {
  const snap = (p: number[]) => {
    const q: number[] = [];
    for (let k = 0; k < p.length; k += 2) q.push(Math.round(p[k] * GRID), Math.round(p[k + 1] * GRID));
    // Drop repeated and collinear corners until none are left.
    for (let changed = true; changed; ) {
      changed = false;
      const m = q.length / 2;
      for (let k = 0; k < m && m > 3; k++) {
        const a = ((k + m - 1) % m) * 2;
        const b = k * 2;
        const c = ((k + 1) % m) * 2;
        const cross = (q[b] - q[a]) * (q[c + 1] - q[b + 1]) - (q[b + 1] - q[a + 1]) * (q[c] - q[b]);
        if ((q[a] === q[b] && q[a + 1] === q[b + 1]) || cross === 0) {
          q.splice(b, 2);
          changed = true;
          break;
        }
      }
    }
    return q;
  };
  const start = (q: number[]) => {
    const m = q.length / 2;
    let s = 0;
    for (let k = 1; k < m; k++) if (q[k * 2 + 1] < q[s * 2 + 1] || (q[k * 2 + 1] === q[s * 2 + 1] && q[k * 2] < q[s * 2])) s = k;
    return [...q.slice(s * 2), ...q.slice(0, s * 2)];
  };
  const q = snap(ring);
  if (q.length < 8 || !simpleFootprint(q) || ringArea(q) <= 0) return null;
  // The mirror, a → 1 − a, reversed so it still runs counter-clockwise.
  const mirror: number[] = [];
  for (let k = q.length - 2; k >= 0; k -= 2) mirror.push(GRID - q[k], q[k + 1]);
  const [x, y] = [start(q), start(mirror)];
  const kx = x.join(',');
  const ky = y.join(',');
  return kx <= ky ? { key: kx, ring: x } : { key: ky, ring: y };
}
