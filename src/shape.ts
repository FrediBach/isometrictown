import { pointInRing, ringArea } from './geo';

/** A rectangle: centre, unit axis u along its length L, width w across. */
export type Rect = { cx: number; cy: number; ux: number; uy: number; L: number; w: number };

/** The minimum-area rectangle around a ring, and how much of it the ring fills. Null for slivers with no usable edge. */
export function bestRect(p: number[]): { rect: Rect | null; fill: number } {
  const n = p.length / 2;
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = p[j * 2] - p[i * 2];
    let uy = p[j * 2 + 1] - p[i * 2 + 1];
    const l = Math.hypot(ux, uy);
    if (l < 0.5) continue;
    ux /= l;
    uy /= l;
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const a = p[k * 2] * ux + p[k * 2 + 1] * uy;
      const b = -p[k * 2] * uy + p[k * 2 + 1] * ux;
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
      b0 = Math.min(b0, b);
      b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (area < bestArea) {
      bestArea = area;
      const ca = (a0 + a1) / 2;
      const cb = (b0 + b1) / 2;
      const r = { cx: ca * ux - cb * uy, cy: ca * uy + cb * ux, ux, uy, L: a1 - a0, w: b1 - b0 };
      best = r.L >= r.w ? r : { ...r, ux: -uy, uy: ux, L: r.w, w: r.L };
    }
  }
  return { rect: best, fill: best ? Math.abs(ringArea(p)) / bestArea : 0 };
}

/** Turn a rectangle a quarter turn, so its length runs along what was its width. */
export function turn(r: Rect): Rect {
  return { ...r, ux: -r.uy, uy: r.ux, L: r.w, w: r.L };
}

/** Rectangle corners, counter-clockwise from (-L/2, -w/2). */
export function corners(r: Rect): number[] {
  const { cx, cy, ux, uy, L, w } = r;
  const vx = -uy;
  const vy = ux;
  const a = L / 2;
  const b = w / 2;
  return [cx - ux * a - vx * b, cy - uy * a - vy * b, cx + ux * a - vx * b, cy + uy * a - vy * b, cx + ux * a + vx * b, cy + uy * a + vy * b, cx - ux * a + vx * b, cy - uy * a + vy * b];
}

/** A rectangle from a footprint split, with how each side relates to the footprint. */
export type Part = {
  rect: Rect;
  /** Per side, in corner order (bottom, right, top, left): 1 if it lies on a party wall whose neighbour reaches the roof. */
  party: Uint8Array;
  /** Per side: 1 if it lies on the footprint's outline, 0 if it runs inside the building. */
  outside: Uint8Array;
};

const SNAP = 0.7;
const SKEW = Math.sin((12 * Math.PI) / 180);

/** Cluster nearby values and map each to its cluster's mean. */
function snapper(values: number[]): { snap: (v: number) => number; stops: number[] } {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const g = groups[groups.length - 1];
    if (g && v - g[g.length - 1] < SNAP) g.push(v);
    else groups.push([v]);
  }
  const stops = groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  const snap = (v: number) => {
    let best = stops[0];
    for (const s of stops) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
    return best;
  };
  return { snap, stops };
}

/**
 * Split a near-orthogonal footprint into a few overlapping rectangles that cover it,
 * largest first. Pitched roofs over each one then meet as cross gables. Returns the
 * squared-up outline too, so walls and roofs line up exactly, or null if the footprint
 * isn't orthogonal enough or needs too many pieces. `party` holds the neighbour's height
 * per edge (0 for none); sides only count as party walls where it reaches `roofParty`.
 */
export function orthoParts(p: number[], party: Float32Array, roofParty: number, axis: Rect): { parts: Part[]; ring: number[]; party: Float32Array } | null {
  const n = p.length / 2;
  if (n > 28) return null;
  const { ux, uy } = axis;
  const A: number[] = [];
  const B: number[] = [];
  for (let i = 0; i < n; i++) {
    A.push(p[i * 2] * ux + p[i * 2 + 1] * uy);
    B.push(-p[i * 2] * uy + p[i * 2 + 1] * ux);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const da = A[j] - A[i];
    const db = B[j] - B[i];
    const l = Math.hypot(da, db);
    if (l < 1.2) continue;
    if (Math.min(Math.abs(da), Math.abs(db)) / l > SKEW) return null;
  }
  const sa = snapper(A);
  const sb = snapper(B);
  // Squared-up ring, dropping vertices that snapped onto their predecessor.
  const ra: number[] = [];
  const rb: number[] = [];
  const rp: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = sa.snap(A[i]);
    const b = sb.snap(B[i]);
    const k = ra.length - 1;
    if (k >= 0 && ra[k] === a && rb[k] === b) {
      rp[k] = Math.max(rp[k], party[i]);
      continue;
    }
    ra.push(a);
    rb.push(b);
    rp.push(party[i]);
  }
  while (ra.length > 1 && ra[0] === ra[ra.length - 1] && rb[0] === rb[rb.length - 1]) {
    ra.pop();
    rb.pop();
    rp[rp.length - 2] = Math.max(rp[rp.length - 2], rp[rp.length - 1]);
    rp.pop();
  }
  const m = ra.length;
  if (m < 4) return null;
  // Every squared-up edge must run along an axis.
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    if (ra[i] !== ra[j] && rb[i] !== rb[j]) return null;
  }
  const flat: number[] = [];
  for (let i = 0; i < m; i++) flat.push(ra[i], rb[i]);
  if (Math.abs(ringArea(flat)) < 10) return null;

  const xs = sa.stops;
  const ys = sb.stops;
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (nx < 1 || ny < 1 || nx > 10 || ny > 10) return null;
  const inside: boolean[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) inside.push(pointInRing((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, flat));
  const cellArea = (i: number, j: number) => (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
  let total = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (inside[j * nx + i]) total += cellArea(i, j);
  const covered = new Uint8Array(nx * ny);
  const full = (i0: number, j0: number, i1: number, j1: number) => {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!inside[j * nx + i]) return false;
    return true;
  };

  const boxes: [number, number, number, number][] = [];
  let left = total;
  while (left > total * 0.06 && boxes.length < 4) {
    let best: [number, number, number, number] | null = null;
    let bestGain = 0;
    for (let j0 = 0; j0 < ny; j0++)
      for (let i0 = 0; i0 < nx; i0++) {
        if (!inside[j0 * nx + i0]) continue;
        for (let j1 = j0; j1 < ny; j1++)
          for (let i1 = i0; i1 < nx; i1++) {
            if (!full(i0, j0, i1, j1)) break;
            const w = xs[i1 + 1] - xs[i0];
            const h = ys[j1 + 1] - ys[j0];
            if (Math.min(w, h) < 2.5) continue;
            let gain = 0;
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!covered[j * nx + i]) gain += cellArea(i, j);
            if (gain > bestGain + 1e-6) {
              bestGain = gain;
              best = [i0, j0, i1, j1];
            }
          }
      }
    if (!best || bestGain < total * 0.04) break;
    const [i0, j0, i1, j1] = best;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!covered[j * nx + i]) left -= cellArea(i, j);
      covered[j * nx + i] = 1;
    }
    boxes.push(best);
  }
  if (!boxes.length || left > total * 0.1) return null;

  // Which stretches of the outline are party walls, and where the outline runs at all.
  const onOutline = (fixedA: boolean, at: number, lo: number, hi: number, partyOnly: boolean) => {
    let cover = 0;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      if (partyOnly && !(rp[i] > 0 && rp[i] >= roofParty)) continue;
      if (fixedA ? ra[i] !== at || ra[j] !== at : rb[i] !== at || rb[j] !== at) continue;
      const s0 = fixedA ? Math.min(rb[i], rb[j]) : Math.min(ra[i], ra[j]);
      const s1 = fixedA ? Math.max(rb[i], rb[j]) : Math.max(ra[i], ra[j]);
      cover += Math.max(0, Math.min(hi, s1) - Math.max(lo, s0));
    }
    return cover / (hi - lo);
  };

  const parts: Part[] = boxes.map(([i0, j0, i1, j1]) => {
    const a0 = xs[i0];
    const a1 = xs[i1 + 1];
    const b0 = ys[j0];
    const b1 = ys[j1 + 1];
    const ca = (a0 + a1) / 2;
    const cb = (b0 + b1) / 2;
    const rect: Rect = { cx: ca * ux - cb * uy, cy: ca * uy + cb * ux, ux, uy, L: a1 - a0, w: b1 - b0 };
    // Sides in corner order: bottom (b0), right (a1), top (b1), left (a0).
    const sides: [boolean, number, number, number][] = [
      [false, b0, a0, a1],
      [true, a1, b0, b1],
      [false, b1, a0, a1],
      [true, a0, b0, b1],
    ];
    const party = new Uint8Array(4);
    const outside = new Uint8Array(4);
    sides.forEach(([fixedA, at, lo, hi], k) => {
      party[k] = onOutline(fixedA, at, lo, hi, true) > 0.6 ? 1 : 0;
      outside[k] = onOutline(fixedA, at, lo, hi, false) > 0.5 ? 1 : 0;
    });
    return { rect, party, outside };
  });

  const ring: number[] = [];
  for (let i = 0; i < m; i++) ring.push(ra[i] * ux - rb[i] * uy, ra[i] * uy + rb[i] * ux);
  return { parts, ring, party: Float32Array.from(rp) };
}

/**
 * Move each edge of a ring its own distance d(i) towards its left (the inside of a
 * counter-clockwise outer ring, and of the building around a clockwise hole), meeting
 * at mitred corners. Null if the result folds over or shrinks to nearly nothing.
 */
export function offsetRing(p: number[], d: (edge: number) => number): number[] | null {
  const n = p.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = (i - 1 + n) % n;
    const j = (i + 1) % n;
    let e1x = p[i * 2] - p[h * 2];
    let e1y = p[i * 2 + 1] - p[h * 2 + 1];
    let e2x = p[j * 2] - p[i * 2];
    let e2y = p[j * 2 + 1] - p[i * 2 + 1];
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1;
    e1y /= l1;
    e2x /= l2;
    e2y /= l2;
    // Left normals of the incoming and outgoing edges, and how far each edge moves.
    const n1x = -e1y;
    const n1y = e1x;
    const n2x = -e2y;
    const n2y = e2x;
    const d1 = d(h);
    const d2 = d(i);
    const det = n1x * n2y - n1y * n2x;
    if (Math.abs(det) < 0.05) {
      // Nearly straight on: move along the average normal.
      if (1 + n1x * n2x + n1y * n2y < 0.25) return null;
      const m = (d1 + d2) / 2;
      const nx = n1x + n2x;
      const ny = n1y + n2y;
      const l = Math.hypot(nx, ny) || 1;
      out.push(p[i * 2] + (nx / l) * m, p[i * 2 + 1] + (ny / l) * m);
      continue;
    }
    // Solve n1 . o = d1, n2 . o = d2 for the corner's offset o.
    const ox = (d1 * n2y - d2 * n1y) / det;
    const oy = (n1x * d2 - n2x * d1) / det;
    if (Math.hypot(ox, oy) > 3 * Math.max(d1, d2) + 0.01) return null;
    out.push(p[i * 2] + ox, p[i * 2 + 1] + oy);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ox = p[j * 2] - p[i * 2];
    const oy = p[j * 2 + 1] - p[i * 2 + 1];
    const qx = out[j * 2] - out[i * 2];
    const qy = out[j * 2 + 1] - out[i * 2 + 1];
    if (ox * qx + oy * qy <= 0) return null;
  }
  const a0 = ringArea(p);
  const a1 = ringArea(out);
  if (Math.sign(a0) !== Math.sign(a1) || Math.abs(a1) < Math.abs(a0) * 0.12) return null;
  return out;
}
