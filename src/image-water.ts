/**
 * Shapes from the land plan in image mode: the outlines of zones traced off the ground grid,
 * simplified and smoothed into natural edges, and water sorted into lakes, rivers and sea.
 * See docs/plans/image-mode.md §9.
 */
import { pointInRing, ringArea } from './geo';
import { blur, LABELS, type Label } from './image-tone';
import type { Zones } from './image-zones';
import type { Shape, Stream } from './tiles';

/** A grid over the ground in local metres, as `Zones` has. */
export type GroundGrid = Pick<Zones, 'x0' | 'y0' | 'cell' | 'W' | 'H'>;

/**
 * The outlines of the cells set in `mask`, as closed rings of flat [x, y, …] along the cell
 * edges: outer rings counter-clockwise (y up), holes clockwise. Where two set cells touch only
 * at a corner they are kept apart.
 */
export function contours(mask: Uint8Array, g: GroundGrid): number[][] {
  const { W, H } = g;
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && mask[j * W + i] === 1;
  // Directed edges with the set cell on their left, keyed by their start corner.
  const V = W + 1;
  const next = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    const l = next.get(a);
    if (l) l.push(b);
    else next.set(a, [b]);
  };
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (!on(i, j)) continue;
      if (!on(i, j - 1)) add(j * V + i, j * V + i + 1);
      if (!on(i + 1, j)) add(j * V + i + 1, (j + 1) * V + i + 1);
      if (!on(i, j + 1)) add((j + 1) * V + i + 1, (j + 1) * V + i);
      if (!on(i - 1, j)) add((j + 1) * V + i, j * V + i);
    }
  const rings: number[][] = [];
  const starts = [...next.keys()].sort((a, b) => a - b);
  for (const start of starts) {
    while (next.get(start)?.length) {
      const ring: number[] = [];
      let prev = -1;
      let at = start;
      for (let guard = 0; guard < 4 * W * H + 8; guard++) {
        const outs = next.get(at)!;
        // At a corner two loops pass through, turn left, so cells touching at a corner stay apart.
        let k = 0;
        if (outs.length > 1 && prev >= 0) {
          const dx = (at % V) - (prev % V);
          const dy = Math.floor(at / V) - Math.floor(prev / V);
          k = Math.max(0, outs.findIndex((b) => (b % V) - (at % V) === -dy && Math.floor(b / V) - Math.floor(at / V) === dx));
        }
        const b = outs.splice(k, 1)[0];
        ring.push(g.x0 + (at % V) * g.cell, g.y0 + Math.floor(at / V) * g.cell);
        prev = at;
        at = b;
        if (at === start) break;
      }
      rings.push(straight(ring));
    }
  }
  return rings;
}

/** A closed ring without the points that lie on a straight line between their neighbours. */
function straight(p: number[]): number[] {
  const out: number[] = [];
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n;
    const b = (i + 1) % n;
    const cross = (p[i * 2] - p[a * 2]) * (p[b * 2 + 1] - p[i * 2 + 1]) - (p[i * 2 + 1] - p[a * 2 + 1]) * (p[b * 2] - p[i * 2]);
    if (Math.abs(cross) > 1e-9) out.push(p[i * 2], p[i * 2 + 1]);
  }
  return out;
}

/** Douglas–Peucker: the fewest points of a polyline (or a closed ring) within `tol` of it. */
export function simplify(p: number[], tol: number, closed = false): number[] {
  const n = p.length / 2;
  if (n < 3) return p.slice();
  if (closed) {
    // Split the ring at its first point and the point farthest from it, and simplify both halves.
    let far = 0;
    let best = -1;
    for (let i = 1; i < n; i++) {
      const d = (p[i * 2] - p[0]) ** 2 + (p[i * 2 + 1] - p[1]) ** 2;
      if (d > best) [best, far] = [d, i];
    }
    const a = simplify(p.slice(0, far * 2 + 2), tol);
    const b = simplify([...p.slice(far * 2), p[0], p[1]], tol);
    return [...a.slice(0, -2), ...b.slice(0, -2)];
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = p[a * 2];
    const ay = p[a * 2 + 1];
    const dx = p[b * 2] - ax;
    const dy = p[b * 2 + 1] - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    let far = -1;
    let best = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((p[i * 2] - ax) * dy - (p[i * 2 + 1] - ay) * dx) / len;
      if (d > best) [best, far] = [d, i];
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([a, far], [far, b]);
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

/** Chaikin's corner cutting, `rounds` times: a smooth curve through a polyline's corners, ends kept unless closed. */
export function chaikin(p: number[], rounds: number, closed = false): number[] {
  let q = p;
  for (let r = 0; r < rounds; r++) {
    const n = q.length / 2;
    if (n < 3) return q;
    const out: number[] = closed ? [] : [q[0], q[1]];
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n;
      const [ax, ay, bx, by] = [q[i * 2], q[i * 2 + 1], q[j * 2], q[j * 2 + 1]];
      out.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
    }
    if (!closed) {
      out.splice(2, 2);
      out.splice(out.length - 2, 2);
      out.push(q[q.length - 2], q[q.length - 1]);
    }
    q = out;
  }
  return q;
}

/** How far an outline may stray from the zone's edge when simplified, m. */
const EDGE_TOL = 3;
/**
 * A zone's outline is smoothed over this distance first, m: where the image has no edge, zones
 * part along the superpixels' honeycomb, which would ripple; where it has one, the superpixels
 * already follow it straight.
 */
const EDGE_SMOOTH = 8;

/** Shapes (outer ring, then its holes) of the cells in `mask`, simplified and smoothed; specks under `minCells` are dropped. */
export function shapesOf(mask: Uint8Array, g: GroundGrid, minCells = 2, smooth = 2): Shape[] {
  const soft = Float32Array.from(mask);
  blur(soft, g.W, g.H, EDGE_SMOOTH / g.cell);
  const rings = contours(Uint8Array.from(soft, (v) => (v >= 0.5 ? 1 : 0)), g)
    .filter((r) => Math.abs(ringArea(r)) >= minCells * g.cell * g.cell)
    // Simplified a little coarser than a superpixel's ripples, so outlines don't scallop.
    .map((r) => chaikin(simplify(r, Math.max(g.cell * 0.6, EDGE_TOL), true), smooth, true))
    .filter((r) => r.length >= 6);
  const outers = rings.filter((r) => ringArea(r) > 0).sort((a, b) => ringArea(a) - ringArea(b));
  const shapes: Shape[] = outers.map((r) => [{ pts: r, seam: new Uint8Array(r.length / 2) }]);
  for (const hole of rings.filter((r) => ringArea(r) < 0)) {
    // The smallest outer ring holding the hole.
    const k = outers.findIndex((o) => pointInRing(hole[0], hole[1], o));
    if (k >= 0) shapes[k].push({ pts: hole, seam: new Uint8Array(hole.length / 2) });
  }
  return shapes;
}

/** A mask of the cells whose label is one of `labels`. */
export function maskOf(z: Zones, labels: Label[]): Uint8Array {
  const want = new Uint8Array(LABELS.length);
  for (const l of labels) want[LABELS.indexOf(l)] = 1;
  return z.label.map((k) => want[k]);
}

/** Thinner than this (area over perimeter, m), water is a river. */
const RIVER_THIN = 25;
/** Water touching the edge of the plan along more than this share of a side is sea. */
const SEA_EDGE = 1 / 3;

/**
 * The water of a land plan as shapes, with the OpenMapTiles class each would have: long thin
 * bodies are rivers, bodies that run off a third of a side of the plan are sea, the rest lakes.
 */
export function waterOf(z: Zones): { shapes: Shape[]; cls: string[] } {
  const shapes = shapesOf(maskOf(z, ['water']), z, 4);
  const x1 = z.x0 + z.W * z.cell;
  const y1 = z.y0 + z.H * z.cell;
  const near = 1.5 * z.cell;
  const cls = shapes.map((s) => {
    const p = s[0].pts;
    const n = p.length / 2;
    let perimeter = 0;
    const edge = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const l = Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]);
      perimeter += l;
      const mx = (p[i * 2] + p[j * 2]) / 2;
      const my = (p[i * 2 + 1] + p[j * 2 + 1]) / 2;
      if (mx - z.x0 < near) edge[0] += l;
      if (x1 - mx < near) edge[1] += l;
      if (my - z.y0 < near) edge[2] += l;
      if (y1 - my < near) edge[3] += l;
    }
    const area = s.reduce((a, r) => a + ringArea(r.pts), 0);
    if (area / perimeter < RIVER_THIN) return 'river';
    const sides = [z.H, z.H, z.W, z.W].map((v) => v * z.cell);
    return edge.some((e, k) => e > SEA_EDGE * sides[k]) ? 'ocean' : 'lake';
  });
  return { shapes, cls };
}

/**
 * Trace thin lines on a grid into simplified polylines. Points and minimum length use the
 * grid's units: local metres for ground features, sheet millimetres for image strokes.
 */
export function traceLines(on: (c: number) => boolean, g: GroundGrid, min: number): number[][] {
  const { W, H } = g;
  const seen = new Uint8Array(W * H);
  const around = (c: number) => {
    const i = c % W;
    const j = Math.floor(c / W);
    const out: number[] = [];
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const a = i + di;
        const b = j + dj;
        if (a >= 0 && b >= 0 && a < W && b < H && on(b * W + a)) out.push(b * W + a);
      }
    return out;
  };
  const at = (c: number) => [g.x0 + ((c % W) + 0.5) * g.cell, g.y0 + (Math.floor(c / W) + 0.5) * g.cell];
  const lines: number[][] = [];
  const follow = (start: number) => {
    const pts = [...at(start)];
    seen[start] = 1;
    let c = start;
    for (;;) {
      const nxt = around(c).find((d) => !seen[d]);
      if (nxt === undefined) break;
      seen[nxt] = 1;
      pts.push(...at(nxt));
      c = nxt;
    }
    return pts;
  };
  // Lines from their ends first, then whatever is left (closed loops).
  for (const pass of [0, 1])
    for (let c = 0; c < W * H; c++) {
      if (seen[c] || !on(c)) continue;
      if (pass === 0 && around(c).length !== 1) continue;
      const pts = follow(c);
      let len = 0;
      for (let k = 2; k < pts.length; k += 2) len += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
      if (len >= min) lines.push(chaikin(simplify(pts, g.cell), 1));
    }
  return lines;
}

/** Streams: thin dark bluish lines in the image, away from other water. */
export function streamsOf(dark: (c: number) => boolean, z: Zones, min: number): Stream[] {
  const wet = maskOf(z, ['water']);
  return traceLines((c) => dark(c) && !wet[c], z, min).map((pts) => ({ pts, width: 2.5 }));
}
