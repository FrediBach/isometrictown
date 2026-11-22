/**
 * Blocks and parcels for image mode (§11 of docs/plans/image-mode.md). Blocks are the faces of
 * the street graph, inset from the streets by half the road and a pavement. Each block's rim is
 * a strip as deep as its zone's plots, cut into lots along each street side and at the corners.
 * Neighbouring lots share their cut lines exactly, so the rows built on them share their walls,
 * and every lot fronts a street by construction.
 */
import { pointInRing, ringArea } from './geo';
import type { Graph } from './image-streets';
import { BUILT, LABELS, type Label } from './image-tone';
import type { Zones } from './image-zones';
import { bestRect, offsetRing } from './shape';
import { ROAD_WIDTH, type Way } from './tiles';

/** Pavement between the road and the front of a lot, m. */
export const PAVEMENT = 2.5;

/**
 * A raster of what is taken (roads, water, parks, woods, squares and the lots already laid),
 * fine enough that lots sharing a cut line never mark each other's cells.
 */
export class Occupancy {
  readonly W: number;
  readonly H: number;
  readonly taken: Uint8Array;
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly cs: number,
    width: number,
    height: number,
  ) {
    this.W = Math.ceil(width / cs);
    this.H = Math.ceil(height / cs);
    this.taken = new Uint8Array(this.W * this.H);
  }

  /** A copy to lay buildings into, leaving this one as it is. */
  clone(): Occupancy {
    const o = new Occupancy(this.x0, this.y0, this.cs, this.W * this.cs, this.H * this.cs);
    o.taken.set(this.taken);
    return o;
  }

  cellOf(x: number, y: number): number {
    const i = Math.floor((x - this.x0) / this.cs);
    const j = Math.floor((y - this.y0) / this.cs);
    return i < 0 || j < 0 || i >= this.W || j >= this.H ? -1 : j * this.W + i;
  }

  /** Mark a road and its pavement taken, a cell short, so a front wall on the pavement's edge stays free. */
  way(w: Way, pavement = pavementOf(w.cls)): void {
    const cs = this.cs;
    const r = w.width / 2 + pavement - cs;
    const p = w.pts;
    for (let i = 2; i < p.length; i += 2) {
      const len = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      const n = Math.max(1, Math.ceil(len / cs));
      for (let k = 0; k <= n; k++) {
        const x = p[i - 2] + ((p[i] - p[i - 2]) * k) / n;
        const y = p[i - 1] + ((p[i + 1] - p[i - 1]) * k) / n;
        for (let dy = -r; dy <= r; dy += cs * 0.7)
          for (let dx = -r; dx <= r; dx += cs * 0.7) {
            if (dx * dx + dy * dy > r * r) continue;
            const c = this.cellOf(x + dx, y + dy);
            if (c >= 0) this.taken[c] = 1;
          }
      }
    }
  }

  /** Mark ground nothing may stand on: every cell whose centre is inside the rings (even-odd, so holes stay free), and every cell their outlines cross. */
  fill(rings: number[][]): void {
    this.cells(rings, false, (c) => {
      this.taken[c] = 1;
      return true;
    });
    const step = this.cs / 2;
    for (const r of rings)
      for (let a = 0, b = r.length - 2; a < r.length; b = a, a += 2) {
        const n = Math.max(1, Math.ceil(Math.hypot(r[a] - r[b], r[a + 1] - r[b + 1]) / step));
        for (let k = 0; k <= n; k++) {
          const c = this.cellOf(r[b] + ((r[a] - r[b]) * k) / n, r[b + 1] + ((r[a + 1] - r[b + 1]) * k) / n);
          if (c >= 0) this.taken[c] = 1;
        }
      }
  }

  /**
   * Whether a ring's cells are free, all but those on its outline, so a neighbour sharing the line
   * doesn't count. With `own`, only cells marked `own` may be shared that way: the outline must
   * keep clear of everything else.
   */
  free(ring: number[], own = 0): boolean {
    if (!this.cells([ring], true, (c) => !this.taken[c])) return false;
    return !own || this.allows(ring, own);
  }

  /** Whether a ring stays on vacant ground or ground reserved for its own kind of plot. */
  allows(ring: number[], own: number): boolean {
    return this.cells([ring], false, (c) => !this.taken[c] || this.taken[c] === own);
  }

  /** Mark a ring's cells taken, with `value` saying by what (1 for anything that may not be shared). */
  take(ring: number[], value = 1): void {
    this.cells([ring], false, (c) => {
      this.taken[c] = value;
      return true;
    });
  }

  /**
   * Call `fn` for each cell whose centre is inside the rings, stopping when it returns false.
   * `erode` skips cells next to the outline; a ring too small to have any is tested at its middle.
   */
  private cells(rings: number[][], erode: boolean, fn: (c: number) => boolean): boolean {
    const { cs, W, H, x0, y0 } = this;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of rings)
      for (let k = 0; k < r.length; k += 2) {
        minX = Math.min(minX, r[k]);
        maxX = Math.max(maxX, r[k]);
        minY = Math.min(minY, r[k + 1]);
        maxY = Math.max(maxY, r[k + 1]);
      }
    const i0 = Math.max(0, Math.floor((minX - x0) / cs) - 1);
    const i1 = Math.min(W - 1, Math.floor((maxX - x0) / cs) + 1);
    const j0 = Math.max(0, Math.floor((minY - y0) / cs) - 1);
    const j1 = Math.min(H - 1, Math.floor((maxY - y0) / cs) + 1);
    if (i1 < i0 || j1 < j0) return true;
    const lw = i1 - i0 + 1;
    const lh = j1 - j0 + 1;
    // Only erosion needs neighbouring cells. Other callers can use each span as it is found.
    const inside = erode ? new Uint8Array(lw * lh) : null;
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const y = y0 + (j + 0.5) * cs;
      xs.length = 0;
      for (const r of rings)
        for (let a = 0, b = r.length - 2; a < r.length; b = a, a += 2) {
          const ay = r[a + 1];
          const by = r[b + 1];
          if (ay > y !== by > y) xs.push(r[a] + ((r[b] - r[a]) * (y - ay)) / (by - ay));
        }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const ia = Math.max(i0, Math.ceil((xs[k] - x0) / cs - 0.5));
        const ib = Math.min(i1, Math.floor((xs[k + 1] - x0) / cs - 0.5));
        if (inside) {
          if (ia <= ib) inside.fill(1, (j - j0) * lw + ia - i0, (j - j0) * lw + ib - i0 + 1);
        } else {
          for (let i = ia; i <= ib; i++) if (!fn(j * W + i)) return false;
        }
      }
    }
    if (!inside) return true;
    let any = false;
    for (let v = 0; v < lh; v++)
      for (let u = 0; u < lw; u++) {
        const l = v * lw + u;
        if (!inside[l]) continue;
        if (u === 0 || v === 0 || u === lw - 1 || v === lh - 1 || !inside[l - 1] || !inside[l + 1] || !inside[l - lw] || !inside[l + lw]) continue;
        any = true;
        if (!fn((j0 + v) * W + i0 + u)) return false;
      }
    if (!any) {
      const r = rings[0];
      let cx = 0;
      let cy = 0;
      for (let k = 0; k < r.length; k += 2) {
        cx += r[k] / (r.length / 2);
        cy += r[k + 1] / (r.length / 2);
      }
      const c = this.cellOf(cx, cy);
      if (c >= 0 && !fn(c)) return false;
    }
    return true;
  }
}

/** A face of the street graph: its ring counter-clockwise, and how far each segment's street reaches into it, m. */
export type Face = { pts: number[]; reach: number[] };

/** How far a street of a class reaches from its centre line to the front of the lots, m. */
export const reachOf = (cls: string): number => (ROAD_WIDTH[cls] ?? ROAD_WIDTH.minor) / 2 + pavementOf(cls);
/** The pavement along a street of a class, m: lanes have only a kerbstone's width. */
export const pavementOf = (cls: string): number => (cls === 'service' ? 1 : PAVEMENT);

/**
 * The bounded faces of the street graph, found by walking half-edges and always taking the next
 * edge clockwise, which goes round each face counter-clockwise. Dead ends are pruned first, since
 * a face that runs up a cul-de-sac and back can't be inset; the lots along them come later.
 */
export function facesOf(g: Graph): Face[] {
  const E = g.edges.length;
  const N = g.nodes.length / 2;
  const alive = new Uint8Array(E).fill(1);
  const deg = new Int32Array(N);
  const at: number[][] = Array.from({ length: N }, () => []);
  g.edges.forEach((e, i) => {
    if (e.a === e.b) {
      alive[i] = 0;
      return;
    }
    deg[e.a]++;
    deg[e.b]++;
    at[e.a].push(i);
    at[e.b].push(i);
  });
  const stack: number[] = [];
  for (let v = 0; v < N; v++) if (deg[v] === 1) stack.push(v);
  while (stack.length) {
    const v = stack.pop()!;
    if (deg[v] !== 1) continue;
    const e = at[v].find((i) => alive[i]);
    if (e === undefined) continue;
    alive[e] = 0;
    const o = g.edges[e].a === v ? g.edges[e].b : g.edges[e].a;
    deg[v]--;
    deg[o]--;
    if (deg[o] === 1) stack.push(o);
  }

  // Each edge simplified, its ends kept on the nodes.
  const pts = g.edges.map((e) => simplify(e.pts, 1));
  // Half-edge h runs along edge h >> 1, forwards when even. Its heading as it leaves its tail.
  const tail = (h: number) => (h & 1 ? g.edges[h >> 1].b : g.edges[h >> 1].a);
  const path = (h: number) => (h & 1 ? reversed(pts[h >> 1]) : pts[h >> 1]);
  const heading = (h: number) => {
    const p = path(h);
    let k = 2;
    while (k < p.length - 2 && Math.hypot(p[k] - p[0], p[k + 1] - p[1]) < 3) k += 2;
    return Math.atan2(p[k + 1] - p[1], p[k] - p[0]);
  };
  const out: number[][] = Array.from({ length: N }, () => []);
  for (let e = 0; e < E; e++) if (alive[e]) out[tail(2 * e)].push(2 * e), out[tail(2 * e + 1)].push(2 * e + 1);
  const pos = new Int32Array(2 * E);
  for (const list of out) {
    const angle = new Map(list.map((h) => [h, heading(h)]));
    list.sort((p, q) => angle.get(p)! - angle.get(q)! || p - q);
    list.forEach((h, k) => (pos[h] = k));
  }
  const seen = new Uint8Array(2 * E);
  const faces: Face[] = [];
  for (let h0 = 0; h0 < 2 * E; h0++) {
    if (!alive[h0 >> 1] || seen[h0]) continue;
    const ring: number[] = [];
    const reach: number[] = [];
    let h = h0;
    let steps = 0;
    do {
      seen[h] = 1;
      const p = path(h);
      const r = reachOf(g.edges[h >> 1].cls);
      for (let k = 0; k + 2 < p.length; k += 2) {
        ring.push(p[k], p[k + 1]);
        reach.push(r);
      }
      const head = tail(h ^ 1);
      const list = out[head];
      h = list[(pos[h ^ 1] - 1 + list.length) % list.length];
    } while (h !== h0 && ++steps < 2 * E);
    if (h !== h0) continue;
    const face = tidy(ring, reach);
    if (face && ringArea(face.pts) > 0) faces.push(face);
  }
  return faces;
}

/** Drop points closer than half a metre to the last, and spikes where the ring doubles back. */
function tidy(ring: number[], reach: number[]): Face | null {
  let p: number[] = [];
  let r: number[] = [];
  for (let k = 0; k < ring.length; k += 2) {
    const n = p.length;
    if (n && Math.hypot(ring[k] - p[n - 2], ring[k + 1] - p[n - 1]) < 0.5) continue;
    p.push(ring[k], ring[k + 1]);
    r.push(reach[k / 2]);
  }
  for (let changed = true; changed && p.length >= 6; ) {
    changed = false;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const h = (i - 1 + n) % n;
      const j = (i + 1) % n;
      const ax = p[i * 2] - p[h * 2];
      const ay = p[i * 2 + 1] - p[h * 2 + 1];
      const bx = p[j * 2] - p[i * 2];
      const by = p[j * 2 + 1] - p[i * 2 + 1];
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la < 0.5 || lb < 0.5 || (ax * bx + ay * by) / (la * lb) < -0.97) {
        p = [...p.slice(0, i * 2), ...p.slice(i * 2 + 2)];
        r = [...r.slice(0, i), ...r.slice(i + 1)];
        changed = true;
        break;
      }
    }
  }
  return p.length >= 6 ? { pts: p, reach: r } : null;
}

/** Douglas–Peucker on an open polyline, keeping both ends. */
export function simplify(p: number[], tol: number): number[] {
  const n = p.length / 2;
  if (n <= 2) return p.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = p[a * 2];
    const ay = p[a * 2 + 1];
    const dx = p[b * 2] - ax;
    const dy = p[b * 2 + 1] - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = -1;
    let far = tol;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((p[k * 2] - ax) * dy - (p[k * 2 + 1] - ay) * dx) / len;
      if (d > far) {
        far = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(p[k * 2], p[k * 2 + 1]);
  return out;
}

const reversed = (p: number[]) => {
  const out: number[] = [];
  for (let k = p.length - 2; k >= 0; k -= 2) out.push(p[k], p[k + 1]);
  return out;
};

/**
 * How each built zone is parcelled: the strip's depth range, m (a block's own pick within it),
 * and the lot width along the street at the zone's sparsest level and its densest (§11.2).
 */
export const PARCEL: Partial<Record<Label, { depth: [number, number]; width: [number, number] }>> = {
  old: { depth: [10, 14], width: [8, 5] },
  rows: { depth: [12, 18], width: [9, 5] },
  blocks: { depth: [14, 20], width: [40, 18] },
  suburb: { depth: [28, 40], width: [26, 16] },
  works: { depth: [45, 80], width: [85, 45] },
  towers: { depth: [40, 70], width: [80, 50] },
};
/** How deep the plots of rows get at their densest, m: deep enough for a back building behind a yard. */
const DEEP: Partial<Record<Label, number>> = { old: 32, rows: 28, blocks: 34 };
/** Labels whose lots carry rows of buildings sharing their walls. */
export const ROWS = new Set<Label>(['old', 'rows', 'blocks']);
/** A turn sharper than this along a block's rim is a corner, where a cut falls, degrees. */
export const CORNER = 35;
/** A lot that fills less of its rectangle than this is merged with a neighbour (§11.4). */
export const MIN_FILL = 0.4;

/**
 * A lot: its front along the street (`o`) and its back (`i`), point for point, so a building
 * can be cut from it at any depth and neighbours still share their side walls. `side` numbers
 * the street sides of the block and `index` the lot's place along it; `depth` is the block's
 * strip depth, the same for every lot in it, so buildings cut at one depth share their corners.
 */
export type Lot = { o: number[]; i: number[]; label: Label; level: number; warmth: number; depth: number; block: number; side: number; index: number; use?: 'church' | 'school' | 'townhall' | 'hospital' };
/** A block: the face of the street graph, the rim inset from the streets, the courtyard inside the strip, and the zone that has most of it. */
export type Block = { face: number[]; rim: number[]; court: number[] | null; label: Label; level: number; depth: number; lots: Lot[] };

/** The ring of a lot, counter-clockwise: along the front, then back along the rear. */
export const lotRing = (l: Lot): number[] => [...l.o, ...reversed(l.i)];
/** The ring of a building on a lot from `f0` to `f1` of the lot's depth, sharing its sides with the next. */
export function strip(l: Lot, f0: number, f1: number): number[] {
  const front: number[] = [];
  const back: number[] = [];
  for (let k = 0; k < l.o.length; k += 2) {
    const dx = l.i[k] - l.o[k];
    const dy = l.i[k + 1] - l.o[k + 1];
    front.push(l.o[k] + dx * f0, l.o[k + 1] + dy * f0);
    back.push(l.o[k] + dx * f1, l.o[k + 1] + dy * f1);
  }
  return [...front, ...reversed(back)];
}
/**
 * A plan on a lot: `ring` in the unit box (along the front by length, in from it), its front set
 * `back` m behind the lot's and `depth` m deep. Walls along the front bend with the lot's front,
 * and the plan's sides fall on the lot's, so neighbours still share their walls.
 */
export function onLot(l: Pick<Lot, 'o' | 'i' | 'depth'>, ring: readonly number[], back: number, depth: number): number[] {
  const n = l.o.length / 2;
  const cum = [0];
  for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(l.o[k * 2] - l.o[k * 2 - 2], l.o[k * 2 + 1] - l.o[k * 2 - 1]));
  const total = cum[n - 1] || 1;
  const at = (a: number, b: number, out: number[]) => {
    let k = 0;
    while (k < n - 2 && cum[k + 1] < a * total) k++;
    const t = Math.max(0, Math.min(1, (a * total - cum[k]) / (cum[k + 1] - cum[k] || 1)));
    const f = (back + b * depth) / l.depth;
    const ox = l.o[k * 2] + (l.o[k * 2 + 2] - l.o[k * 2]) * t;
    const oy = l.o[k * 2 + 1] + (l.o[k * 2 + 3] - l.o[k * 2 + 1]) * t;
    const ix = l.i[k * 2] + (l.i[k * 2 + 2] - l.i[k * 2]) * t;
    const iy = l.i[k * 2 + 1] + (l.i[k * 2 + 3] - l.i[k * 2 + 1]) * t;
    out.push(ox + (ix - ox) * f, oy + (iy - oy) * f);
  };
  const out: number[] = [];
  for (let k = 0; k < ring.length; k += 2) {
    const j = (k + 2) % ring.length;
    at(ring[k], ring[k + 1], out);
    // A wall along the front gets a corner at each bend of the lot's front it passes.
    if (ring[k + 1] !== ring[j + 1]) continue;
    const [a0, a1] = [ring[k], ring[j]];
    const bends = cum.slice(1, -1).map((c) => c / total).filter((a) => a > Math.min(a0, a1) && a < Math.max(a0, a1));
    for (const a of a1 > a0 ? bends : bends.reverse()) at(a, ring[k + 1], out);
  }
  return out;
}
/** A lot's depth from front to back, m, on average. */
export function lotDepth(l: Lot): number {
  let d = 0;
  for (let k = 0; k < l.o.length; k += 2) d += Math.hypot(l.i[k] - l.o[k], l.i[k + 1] - l.o[k + 1]);
  return d / (l.o.length / 2);
}
/** The lot's frontage, m, along its front. */
export function frontage(l: Lot): number {
  let d = 0;
  for (let k = 2; k < l.o.length; k += 2) d += Math.hypot(l.o[k] - l.o[k - 2], l.o[k + 1] - l.o[k - 1]);
  return d;
}
/** Two neighbouring lots on one side as one. */
export function merge(a: Lot, b: Lot): Lot {
  return { ...a, o: [...a.o, ...b.o.slice(2)], i: [...a.i, ...b.i.slice(2)] };
}

/** A hash per decision at a map-fixed point, as `B.key` and the seed give it. */
export type Vary = (x: number, y: number, salt: number) => number;

/**
 * The blocks of a street graph over a land plan, with their lots cut. `minRow` is the narrowest
 * row lot, m, so coarse scales get fewer, longer buildings.
 */
export function blocksOf(g: Graph, z: Zones, vary: Vary, minRow: number): Block[] {
  const zone = (x: number, y: number) => {
    const i = Math.floor((x - z.x0) / z.cell);
    const j = Math.floor((y - z.y0) / z.cell);
    return i < 0 || j < 0 || i >= z.W || j >= z.H ? -1 : j * z.W + i;
  };
  const blocks: Block[] = [];
  for (const face of facesOf(g)) {
    let rim: number[] | null = null;
    for (const tol of [0, 2, 4]) {
      const f = tol ? coarsen(face, tol) : face;
      rim = offsetRing(f.pts, (e) => f.reach[e]);
      if (rim) break;
    }
    if (!rim || ringArea(rim) < 150) continue;
    // The zone over most of the block, and how dense it is.
    const counts = new Map<number, number>();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < rim.length; k += 2) {
      x0 = Math.min(x0, rim[k]);
      x1 = Math.max(x1, rim[k]);
      y0 = Math.min(y0, rim[k + 1]);
      y1 = Math.max(y1, rim[k + 1]);
    }
    const step = Math.max(z.cell, Math.sqrt(((x1 - x0) * (y1 - y0)) / 400));
    let built = 0;
    let all = 0;
    let level = 0;
    for (let y = y0 + step / 2; y < y1; y += step)
      for (let x = x0 + step / 2; x < x1; x += step) {
        if (!pointInRing(x, y, rim)) continue;
        const c = zone(x, y);
        if (c < 0) continue;
        all++;
        const l = z.label[c];
        if (!BUILT.has(LABELS[l])) continue;
        built++;
        level += z.level[c];
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
    if (!built || built < all * 0.15) continue;
    let top = -1;
    let most = 0;
    for (const [l, n] of counts) if (n > most || (n === most && l < top)) [top, most] = [l, n];
    const label = LABELS[top];
    const P = PARCEL[label]!;
    const lv = level / built;
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const narrow = bestRect(rim).rect?.w ?? 0;
    // Denser rows stand on deeper plots, with room behind for back buildings.
    const own = P.depth[0] + (P.depth[1] - P.depth[0]) * vary(cx, cy, 14040);
    const deep = DEEP[label];
    let depth = Math.min(deep ? own + (deep - own) * lv : own, narrow * 0.45);
    let court: number[] | null = null;
    for (let tries = 0; tries < 3 && depth >= 4; tries++) {
      court = offsetRing(rim, () => depth);
      if (court) break;
      depth *= 0.75;
    }
    if (!court) continue;
    const width = Math.max(P.width[0] + (P.width[1] - P.width[0]) * lv, ROWS.has(label) ? minRow : label === 'suburb' ? 12 : 0);
    const b: Block = { face: face.pts, rim, court, label, level: lv, depth, lots: [] };
    b.lots = cut(b, blocks.length, width, z, zone, vary);
    blocks.push(b);
  }
  return blocks;
}

/** A face simplified more coarsely, for an inset the fine one folds under. */
function coarsen(f: Face, tol: number): Face {
  const p = f.pts;
  // Simplify as a closed ring: from the vertex farthest from the first, both halves.
  const keep: number[] = [];
  const reach: number[] = [];
  const s = simplify([...p, p[0], p[1]], tol);
  for (let k = 0; k + 2 < s.length; k += 2) {
    keep.push(s[k], s[k + 1]);
    // The reach of the original segment the kept vertex starts.
    let best = 0;
    let bd = Infinity;
    for (let q = 0; q < p.length; q += 2) {
      const d = Math.hypot(p[q] - s[k], p[q + 1] - s[k + 1]);
      if (d < bd) [bd, best] = [d, q / 2];
    }
    reach.push(f.reach[best]);
  }
  return { pts: keep, reach };
}

/** Cut a block's strip into lots along each street side. */
function cut(b: Block, index: number, width: number, z: Zones, zone: (x: number, y: number) => number, vary: Vary): Lot[] {
  const O = b.rim;
  const I = b.court!;
  const n = O.length / 2;
  const cum = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    cum[k + 1] = cum[k] + Math.hypot(O[j * 2] - O[k * 2], O[j * 2 + 1] - O[k * 2 + 1]);
  }
  const P = cum[n];
  const segLen = (j: number) => cum[j + 1] - cum[j];
  const segAt = (s: number): [number, number] => {
    s = ((s % P) + P) % P;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return [lo, Math.min(1, (s - cum[lo]) / (segLen(lo) || 1))];
  };
  const lerp = (R: number[], j: number, t: number): [number, number] => {
    const k = (j + 1) % n;
    return [R[j * 2] + (R[k * 2] - R[j * 2]) * t, R[j * 2 + 1] + (R[k * 2 + 1] - R[j * 2 + 1]) * t];
  };
  /** The front and back of the rim between two distances round it. */
  const between = (sa: number, sb: number): { o: number[]; i: number[] } => {
    const [ja, ta] = segAt(sa);
    const o = [...lerp(O, ja, ta)];
    const i = [...lerp(I, ja, ta)];
    let arc = sa + (1 - ta) * segLen(ja);
    let k = (ja + 1) % n;
    while (arc < sb - 0.05) {
      o.push(O[k * 2], O[k * 2 + 1]);
      i.push(I[k * 2], I[k * 2 + 1]);
      arc += segLen(k);
      k = (k + 1) % n;
    }
    const [jb, tb] = segAt(sb);
    o.push(...lerp(O, jb, tb));
    i.push(...lerp(I, jb, tb));
    return { o, i };
  };

  // Corners, where the rim turns sharply; sides shorter than most of a lot join the next.
  const turnAt = (k: number) => {
    const h = (k - 1 + n) % n;
    const j = (k + 1) % n;
    const a = Math.atan2(O[k * 2 + 1] - O[h * 2 + 1], O[k * 2] - O[h * 2]);
    const c = Math.atan2(O[j * 2 + 1] - O[k * 2 + 1], O[j * 2] - O[k * 2]);
    let turn = c - a;
    if (turn > Math.PI) turn -= 2 * Math.PI;
    if (turn < -Math.PI) turn += 2 * Math.PI;
    return turn;
  };
  let corners: number[] = [];
  for (let k = 0; k < n; k++) if (Math.abs(turnAt(k)) > (CORNER * Math.PI) / 180) corners.push(k);
  for (let changed = true; changed && corners.length > 1; ) {
    changed = false;
    for (let q = 0; q < corners.length; q++) {
      const a = cum[corners[q]];
      const next = corners[(q + 1) % corners.length];
      const len = (cum[next] - a + P) % P || P;
      if (len < width * 0.6) {
        corners.splice((q + 1) % corners.length, 1);
        changed = true;
        break;
      }
    }
  }
  const round = !corners.length;
  if (round) corners = [0];
  // How much of the street a corner eats at the back of the strip: lots begin that much farther
  // out, so the lot spanning the corner keeps a back on both sides.
  const eat = corners.map((c) => {
    const t = round ? 0 : turnAt(c);
    return t > 0 ? Math.min(b.depth * Math.tan(t / 2), 2 * b.depth) : 0;
  });

  const sides: Lot[][] = corners.map((c, side) => {
    const sa = cum[c];
    const next = corners[(side + 1) % corners.length];
    const len = corners.length === 1 ? P : (cum[next] - sa + P) % P;
    const ea = eat[side];
    const eb = eat[(side + 1) % corners.length];
    const inner = Math.max(0, len - ea - eb);
    const count = Math.max(1, Math.round(inner / width));
    // Cuts where each corner's reach ends, so the corner lots are square to both streets, and
    // evenly between, a little varied.
    const cuts = [sa];
    if (ea > 0.5 && inner > width * 0.5) cuts.push(sa + ea);
    for (let k = 1; k < count; k++) {
      const s = sa + ea + (inner * k) / count;
      const [j, t] = segAt(s);
      const [x, y] = lerp(O, j, t);
      cuts.push(s + (vary(x, y, 14041) - 0.5) * 0.2 * (inner / count));
    }
    if (eb > 0.5 && inner > width * 0.5) cuts.push(sa + len - eb);
    cuts.push(sa + len);
    const list: Lot[] = [];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const { o, i } = between(cuts[k], cuts[k + 1]);
      list.push({ o, i, label: b.label, level: b.level, warmth: 0, depth: b.depth, block: index, side, index: k });
    }
    return list;
  });
  // Corner lots span the corner: the lot ending at each corner joins the one starting there.
  if (!round && corners.length > 1) {
    const joined = new Set<Lot>();
    sides.forEach((list, side) => {
      const prev = sides[(side - 1 + sides.length) % sides.length];
      if (prev === list || !prev.length || !list.length) return;
      const a = prev[prev.length - 1];
      const c = list[0];
      if (joined.has(a) || joined.has(c)) return;
      const m = merge(a, c);
      m.side = side;
      joined.add(m);
      prev.pop();
      list[0] = m;
    });
  }

  const lots: Lot[] = [];
  for (const list of sides) {
    // Slivers join a neighbour; lots whose front or middle isn't built land are dropped.
    for (let k = 0; k < list.length; k++) {
      const l = list[k];
      if (bestRect(lotRing(l)).fill >= MIN_FILL || list.length === 1) continue;
      if (k + 1 < list.length) list.splice(k, 2, merge(l, list[k + 1]));
      else list.splice(k - 1, 2, merge(list[k - 1], l));
      k = Math.max(-1, k - 2);
    }
    list.forEach((l, k) => {
      l.index = k;
      const m = (l.o.length >> 2) * 2;
      const fx = l.o[m] + (l.i[m] - l.o[m]) * 0.3;
      const fy = l.o[m + 1] + (l.i[m + 1] - l.o[m + 1]) * 0.3;
      const bx = l.o[m] + (l.i[m] - l.o[m]) * 0.7;
      const by = l.o[m + 1] + (l.i[m + 1] - l.o[m + 1]) * 0.7;
      const cf = zone(fx, fy);
      const cb = zone(bx, by);
      if (cf < 0 || cb < 0 || !BUILT.has(LABELS[z.label[cf]]) || !BUILT.has(LABELS[z.label[cb]])) return;
      if (bestRect(lotRing(l)).fill < MIN_FILL) return;
      l.level = z.level[cf];
      l.warmth = z.warmth[cf];
      lots.push(l);
    });
  }
  return lots;
}
