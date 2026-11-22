/**
 * What keeps an image-mode town plausible (§11.4 and §12 of docs/plans/image-mode.md): no
 * building on a road, on water, in a park, a wood or a square, or over another building, and each
 * one near enough a street or path to front it. Laying out uses `Ground` to refuse a footprint
 * that would break a rule; `plausibility()` checks a finished town against the same tests.
 */
import { pointInRing, ringArea } from './geo';
import type { Shape, Town, Way } from './tiles';

/** A building stands at most this far from a street or path, m, to front it. */
export const FRONTS = 90;
/** How far inside its outline a footprint is tested, m, so walls shared with a neighbour don't count. */
const INSET = 0.6;
const SIZE = 50;
const EDGE = 255;

/** Whether two closed segments meet, including at their ends or along a common line. */
export function meet(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx) ||
      Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) return false;
  const c = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const a = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const b = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return c * d <= 0 && a * b <= 0;
}

/** Whether a footprint goes once round its outline, with no doubled-back edge or crossing. */
export function simpleFootprint(p: number[]): boolean {
  if (p.length < 6 || p.length % 2 || !p.every(Number.isFinite)) return false;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    const prev = (i + p.length - 2) % p.length;
    const dx = p[j] - p[i], dy = p[j + 1] - p[i + 1];
    const ux = p[i] - p[prev], uy = p[i + 1] - p[prev + 1];
    if ((!dx && !dy) || (dx * uy === dy * ux && dx * ux + dy * uy < 0)) return false;
    for (let k = i + 4; k < p.length; k += 2) {
      const l = (k + 2) % p.length;
      if (l !== i && meet(p[i], p[i + 1], p[j], p[j + 1], p[k], p[k + 1], p[l], p[l + 1])) return false;
    }
  }
  return true;
}

/** The middle of a ring's points. */
export const centre = (p: number[]): [number, number] => {
  let x = 0;
  let y = 0;
  for (let k = 0; k < p.length; k += 2) {
    x += p[k];
    y += p[k + 1];
  }
  return [x / (p.length / 2), y / (p.length / 2)];
};

/** Points a little inside a footprint's outline: its middle and each corner pulled in, where they fall inside. */
export function inside(p: number[]): [number, number][] {
  const [cx, cy] = centre(p);
  const pts: [number, number][] = pointInRing(cx, cy, p) ? [[cx, cy]] : [];
  for (let k = 0; k < p.length; k += 2) {
    const d = Math.hypot(cx - p[k], cy - p[k + 1]) || 1;
    const x = p[k] + ((cx - p[k]) / d) * INSET;
    const y = p[k + 1] + ((cy - p[k + 1]) / d) * INSET;
    if (pointInRing(x, y, p)) pts.push([x, y]);
  }
  return pts;
}

const cellId = (i: number, j: number) => (i + 32768) * 65536 + j + 32768;

/** A lookup of things by 50 m cell, each filed in every cell its bounds (padded) touch. */
export class Index {
  private grid = new Map<number, number[]>();
  add(k: number, p: ArrayLike<number>, pad = 0): void {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let q = 0; q < p.length; q += 2) [x0, y0, x1, y1] = [Math.min(x0, p[q]), Math.min(y0, p[q + 1]), Math.max(x1, p[q]), Math.max(y1, p[q + 1])];
    for (let i = Math.floor((x0 - pad) / SIZE); i <= Math.floor((x1 + pad) / SIZE); i++)
      for (let j = Math.floor((y0 - pad) / SIZE); j <= Math.floor((y1 + pad) / SIZE); j++) {
        const id = cellId(i, j);
        const list = this.grid.get(id);
        if (list) list.push(k);
        else this.grid.set(id, [k]);
      }
  }
  /** Everything filed in the cells a ring's bounds touch. */
  around(p: ArrayLike<number>): Set<number> {
    const out = new Set<number>();
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let q = 0; q < p.length; q += 2) [x0, y0, x1, y1] = [Math.min(x0, p[q]), Math.min(y0, p[q + 1]), Math.max(x1, p[q]), Math.max(y1, p[q + 1])];
    for (let i = Math.floor(x0 / SIZE); i <= Math.floor(x1 / SIZE); i++) for (let j = Math.floor(y0 / SIZE); j <= Math.floor(y1 / SIZE); j++) for (const k of this.grid.get(cellId(i, j)) ?? []) out.add(k);
    return out;
  }
  at(x: number, y: number): number[] {
    return this.grid.get(cellId(Math.floor(x / SIZE), Math.floor(y / SIZE))) ?? [];
  }
}

type Seg = { ax: number; ay: number; bx: number; by: number; r: number };
const distance = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
};
const toSeg = (s: Seg, x: number, y: number) => distance(x, y, s.ax, s.ay, s.bx, s.by);
/** Limit wider plotted kerbs to the space between the street centre line and the nearest wall. */
export function streetClearance(buildings: Town['buildings'], gap: number): (w: Way, width: number) => number {
  const walls = new Index();
  const rings = buildings.flatMap(b => b.shape);
  rings.forEach((r, i) => walls.add(i, r.pts, gap));
  return (w, width) => {
    let radius = width / 2;
    for (let k = 2; k < w.pts.length; k += 2) {
      const ax = w.pts[k - 2], ay = w.pts[k - 1], bx = w.pts[k], by = w.pts[k + 1];
      const bounds = [Math.min(ax, bx) - radius, Math.min(ay, by) - radius, Math.max(ax, bx) + radius, Math.max(ay, by) + radius];
      for (const i of walls.around(bounds)) {
        const p = rings[i].pts;
        for (let c = 0, d = p.length - 2; c < p.length; d = c, c += 2) {
          if (meet(ax, ay, bx, by, p[d], p[d + 1], p[c], p[c + 1])) return w.width;
          const nearest = Math.min(distance(p[c], p[c + 1], ax, ay, bx, by),
            distance(ax, ay, p[d], p[d + 1], p[c], p[c + 1]), distance(bx, by, p[d], p[d + 1], p[c], p[c + 1]));
          radius = Math.min(radius, nearest - gap);
          if (2 * radius <= w.width) return w.width;
        }
      }
    }
    return 2 * radius;
  };
}

/** Whether a point lies in the outer ring and outside all its holes. */
export const inShape = (s: Shape, x: number, y: number) => pointInRing(x, y, s[0].pts) && !s.slice(1).some((r) => pointInRing(x, y, r.pts));

/** Whether any two outline edges touch, including a shared corner. */
function outlinesMeet(p: number[], q: number[]): boolean {
  for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2)
    for (let c = 0, d = q.length - 2; c < q.length; d = c, c += 2)
      if (meet(p[a], p[a + 1], p[b], p[b + 1], q[c], q[c + 1], q[d], q[d + 1])) return true;
  return false;
}

/** Whether filled rings meet, including a shared edge or one contained inside the other. */
export function ringsMeet(a: number[], b: number[]): boolean {
  return pointInRing(a[0], a[1], b) || pointInRing(b[0], b[1], a) || outlinesMeet(a, b);
}

/** Edges of a long outline filed in horizontal strips for repeated collision tests. */
class BandedRing {
  private rows = new Map<number, number[]>();

  constructor(private pts: number[]) {
    for (let a = 0, b = pts.length - 2; a < pts.length; b = a, a += 2) {
      const first = Math.floor(Math.min(pts[a + 1], pts[b + 1]) / SIZE);
      const last = Math.floor(Math.max(pts[a + 1], pts[b + 1]) / SIZE);
      for (let j = first; j <= last; j++) {
        const row = this.rows.get(j);
        if (row) row.push(pts[b], pts[b + 1], pts[a], pts[a + 1]);
        else this.rows.set(j, [pts[b], pts[b + 1], pts[a], pts[a + 1]]);
      }
    }
  }

  meets(ring: number[]): boolean {
    if (pointInRing(this.pts[0], this.pts[1], ring)) return true;
    const x = ring[0], y = ring[1];
    // Edges keep their winding order. Each omitted chain lies entirely above or below
    // this strip, so joining its ends cannot change the ray test at this height.
    const row = this.rows.get(Math.floor(y / SIZE));
    if (row && pointInRing(x, y, row)) return true;
    for (let c = 0, d = ring.length - 2; c < ring.length; d = c, c += 2) {
      const first = Math.floor(Math.min(ring[c + 1], ring[d + 1]) / SIZE);
      const last = Math.floor(Math.max(ring[c + 1], ring[d + 1]) / SIZE);
      for (let j = first; j <= last; j++) {
        const edges = this.rows.get(j);
        if (!edges) continue;
        for (let a = 0; a < edges.length; a += 4)
          if (meet(ring[c], ring[c + 1], ring[d], ring[d + 1], edges[a + 2], edges[a + 3], edges[a], edges[a + 1])) return true;
      }
    }
    return false;
  }
}

/** Whether the whole site lies inside one area, clear of its boundary and any holes. */
export function containsSite(shape: Shape, site: number[]): boolean {
  return inShape(shape, site[0], site[1]) && shape.every(r =>
    !pointInRing(r.pts[0], r.pts[1], site) && !outlinesMeet(site, r.pts));
}

/** The ground buildings may not stand on, and the streets and paths they front. */
export class Ground {
  private segs: (Seg & { way: Way })[] = [];
  private roads = new Index();
  private fronts = new Index();
  private streams: Seg[] = [];
  private banks = new Index();
  private open: { what: string; shapes: Shape[]; index: Index }[];
  /**
   * Open land on a coarse raster, so most points need no test against long outlines: per cell,
   * 0 for none, the kind plus one where a cell lies wholly inside, and EDGE where an outline
   * comes near, to be tested exactly.
   */
  private cells = new Uint8Array(0);
  private gx = 0;
  private gy = 0;
  private gc = 1;
  private gw = 0;
  private gh = 0;

  constructor(t: Pick<Town, 'ways' | 'water' | 'streams' | 'green' | 'wood' | 'plazas' | 'landuse'>) {
    for (const w of t.ways.filter(w => w.kind !== 'rail' || w.streetTram))
      for (let k = 2; k < w.pts.length; k += 2) {
        const s = { way: w, ax: w.pts[k - 2], ay: w.pts[k - 1], bx: w.pts[k], by: w.pts[k + 1], r: w.kind === 'road' ? w.width / 2 : 0 };
        const n = this.segs.push(s) - 1;
        const p = [s.ax, s.ay, s.bx, s.by];
        if (s.r > 0) this.roads.add(n, p, s.r);
        this.fronts.add(n, p, FRONTS);
      }
    for (const { pts, width } of t.streams)
      for (let k = 2; k < pts.length; k += 2) {
        const s = { ax: pts[k - 2], ay: pts[k - 1], bx: pts[k], by: pts[k + 1], r: width / 2 };
        const n = this.streams.push(s) - 1;
        this.banks.add(n, [s.ax, s.ay, s.bx, s.by], s.r);
      }
    const open: [string, Shape[]][] = [['water', t.water], ['a park', t.green], ['a wood', t.wood], ['a square', t.plazas]];
    const parking = t.landuse.filter(a => a.cls === 'parking').map(a => a.shape);
    if (parking.length) open.push(['a car park', parking]);
    const rail = t.landuse.filter(a => a.cls === 'railway').map(a => a.shape);
    if (rail.length) open.push(['a railway', rail]);
    this.open = open.map(([what, shapes]) => {
      const index = new Index();
      shapes.forEach((s, k) => index.add(k, s[0].pts));
      return { what, shapes, index };
    });
    this.raster();
  }

  private raster(): void {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const o of this.open)
      for (const s of o.shapes) {
        const p = s[0].pts;
        for (let k = 0; k < p.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, p[k]), Math.min(y0, p[k + 1]), Math.max(x1, p[k]), Math.max(y1, p[k + 1])];
      }
    if (!(x1 > x0 && y1 > y0)) return;
    const c = Math.max(2, Math.sqrt(((x1 - x0) * (y1 - y0)) / 4e6));
    const W = Math.ceil((x1 - x0) / c) + 2;
    const H = Math.ceil((y1 - y0) / c) + 2;
    [this.gx, this.gy, this.gc, this.gw, this.gh] = [x0 - c, y0 - c, c, W, H];
    const cells = new Uint8Array(W * H);
    const xs: number[] = [];
    this.open.forEach((o, kind) => {
      for (const s of o.shapes) {
        // Cells whose middle is inside, even-odd over the shape's rings.
        let [sy0, sy1] = [Infinity, -Infinity];
        for (let k = 1; k < s[0].pts.length; k += 2) [sy0, sy1] = [Math.min(sy0, s[0].pts[k]), Math.max(sy1, s[0].pts[k])];
        for (let j = Math.max(0, Math.floor((sy0 - this.gy) / c)); j <= Math.min(H - 1, Math.ceil((sy1 - this.gy) / c)); j++) {
          const y = this.gy + (j + 0.5) * c;
          xs.length = 0;
          for (const r of s)
            for (let a = 0, b = r.pts.length - 2; a < r.pts.length; b = a, a += 2) {
              const ay = r.pts[a + 1];
              const by = r.pts[b + 1];
              if (ay > y !== by > y) xs.push(r.pts[a] + ((r.pts[b] - r.pts[a]) * (y - ay)) / (by - ay));
            }
          xs.sort((p, q) => p - q);
          for (let k = 0; k + 1 < xs.length; k += 2)
            for (let i = Math.max(0, Math.ceil((xs[k] - this.gx) / c - 0.5)); i <= Math.min(W - 1, Math.floor((xs[k + 1] - this.gx) / c - 0.5)); i++) if (!cells[j * W + i]) cells[j * W + i] = kind + 1;
        }
      }
    });
    // Every cell an outline passes through or beside is tested exactly.
    for (const o of this.open)
      for (const s of o.shapes)
        for (const r of s)
          for (let a = 0, b = r.pts.length - 2; a < r.pts.length; b = a, a += 2) {
            const n = Math.max(1, Math.ceil(Math.hypot(r.pts[a] - r.pts[b], r.pts[a + 1] - r.pts[b + 1]) / (c / 2)));
            for (let k = 0; k <= n; k++) {
              const i = Math.floor((r.pts[b] + ((r.pts[a] - r.pts[b]) * k) / n - this.gx) / c);
              const j = Math.floor((r.pts[b + 1] + ((r.pts[a + 1] - r.pts[b + 1]) * k) / n - this.gy) / c);
              for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (i + di >= 0 && j + dj >= 0 && i + di < W && j + dj < H) cells[(j + dj) * W + i + di] = EDGE;
            }
          }
    this.cells = cells;
  }

  /** Whether a stream or either bank touches a footprint, even between its corners. */
  crossesStream(ring: number[]): boolean {
    if (!this.streams.length) return false;
    for (const k of this.banks.around(ring)) {
      const s = this.streams[k];
      if (pointInRing(s.ax, s.ay, ring)) return true;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const ax = ring[j], ay = ring[j + 1], bx = ring[i], by = ring[i + 1];
        if (meet(ax, ay, bx, by, s.ax, s.ay, s.bx, s.by) || toSeg(s, ax, ay) < s.r ||
            distance(s.ax, s.ay, ax, ay, bx, by) < s.r || distance(s.bx, s.by, ax, ay, bx, by) < s.r) return true;
      }
    }
    return false;
  }

  /** What a point stands on that no building may. A tree also keeps its crown clear of stream banks. */
  under(x: number, y: number, crown = 0): string | null {
    if (this.streams.length) {
      const near = crown ? this.banks.around([x - crown, y - crown, x + crown, y + crown]) : this.banks.at(x, y);
      for (const k of near) if (toSeg(this.streams[k], x, y) < this.streams[k].r + crown) return 'a stream';
    }
    for (const k of this.roads.at(x, y)) if (toSeg(this.segs[k], x, y) < this.segs[k].r) return 'a road';
    const i = Math.floor((x - this.gx) / this.gc);
    const j = Math.floor((y - this.gy) / this.gc);
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return null;
    const v = this.cells[j * this.gw + i];
    if (v !== EDGE) return v ? this.open[v - 1].what : null;
    for (const o of this.open) for (const k of o.index.at(x, y)) if (inShape(o.shapes[k], x, y)) return o.what;
    return null;
  }

  /** Whether a footprint keeps off everything it may not stand on. */
  clear(ring: number[]): boolean {
    return !this.crossesStream(ring) && inside(ring).every(([x, y]) => !this.under(x, y));
  }

  /** The street or path with the nearest verge within the given frontage distance, in metres. */
  frontage(x: number, y: number, limit: number): Way | undefined {
    let way: Way | undefined;
    for (const k of this.fronts.at(x, y)) {
      const s = this.segs[k], d = toSeg(s, x, y) - s.r;
      if (d < limit) { limit = d; way = s.way; }
    }
    return way;
  }

  /** How far a point is from the edge of the nearest street or path within `FRONTS`, m; Infinity if none. */
  front(x: number, y: number): number {
    let d = Infinity;
    for (const k of this.fronts.at(x, y)) d = Math.min(d, toSeg(this.segs[k], x, y) - this.segs[k].r);
    return d;
  }
}

/** Footprints laid so far, to refuse one that would overlap another beyond a shared wall. */
export class Footprints {
  private rings: number[][] = [];
  private index = new Index();
  private banded = new Map<number, BandedRing>();
  /** How many footprints are laid; each one's number for `clash()` is its place in that count. */
  get count(): number {
    return this.rings.length;
  }
  add(ring: number[]): void {
    const j = this.rings.push(ring) - 1;
    this.index.add(j, ring);
    // Short building outlines are cheaper to check directly than to index by edge.
    if (ring.length >= 128) this.banded.set(j, new BandedRing(ring));
  }
  /** Whether a point is inside any footprint laid. */
  covers(x: number, y: number): boolean {
    return this.index.at(x, y).some((j) => pointInRing(x, y, this.rings[j]));
  }
  /** Whether any occupied outline touches, crosses or contains this ring, including narrow corner overlaps. */
  touches(ring: number[]): boolean {
    for (const j of this.index.around(ring)) {
      const banded = this.banded.get(j);
      if (banded ? banded.meets(ring) : ringsMeet(ring, this.rings[j])) return true;
    }
    return false;
  }
  /** Whether a footprint overlaps another, apart from the consecutive plots it replaces when joined. */
  clash(ring: number[], first = -1, last = -1): boolean {
    const near = this.index.around(ring);
    const mine = inside(ring);
    for (const j of near) {
      if (j >= first && j <= last) continue;
      const o = this.rings[j];
      if (mine.some(([x, y]) => pointInRing(x, y, o)) || inside(o).some(([x, y]) => pointInRing(x, y, ring))) return true;
    }
    return false;
  }
}

/**
 * What would make a laid-out town implausible: footprints that aren't proper counter-clockwise
 * rings with a height, that overlap each other, a road, water, a park, a wood or a square, or that
 * stand too far from any street or path to front it, and trees planted on any of those. One line
 * per kind of breach, with how many and where the first is.
 */
export function plausibility(town: Town): string[] {
  const found = new Map<string, { n: number; x: number; y: number }>();
  const note = (what: string, x: number, y: number) => {
    const f = found.get(what);
    if (f) f.n++;
    else found.set(what, { n: 1, x, y });
  };
  const ground = new Ground(town);
  const bs = town.buildings;
  const near = new Index();
  const simple = bs.map((b) => b.shape.length > 0 && b.shape.every((r) => simpleFootprint(r.pts)));
  bs.forEach((b, i) => { if (simple[i]) near.add(i, b.shape[0].pts); });
  bs.forEach((b, i) => {
    if (!simple[i]) return note('a footprint is not a simple ring', b.shape[0]?.pts[0] ?? 0, b.shape[0]?.pts[1] ?? 0);
    const p = b.shape[0].pts;
    const [cx, cy] = centre(p);
    if (ringArea(p) <= 0) note('a footprint runs clockwise', cx, cy);
    if (b.shape.some((r) => r.seam.some((s) => s))) note('a footprint has seams', cx, cy);
    if (!(b.h > 0 && Number.isFinite(b.h))) note('a building has no height', cx, cy);
    if (ground.crossesStream(p)) note('a building stands on a stream', cx, cy);
    for (const [x, y] of inside(p)) {
      for (const j of near.at(x, y)) if (j !== i && pointInRing(x, y, bs[j].shape[0].pts)) note('buildings overlap', x, y);
      const on = ground.under(x, y);
      if (on && on !== 'a stream') note(`a building stands on ${on}`, x, y);
    }
    if (ground.front(cx, cy) > FRONTS) note('a building fronts no street', cx, cy);
  });
  for (const t of town.trees) {
    const on = ground.under(t.x, t.y, t.r);
    if (on) note(`a tree stands on ${on}`, t.x, t.y);
    if (near.at(t.x, t.y).some((j) => pointInRing(t.x, t.y, bs[j].shape[0].pts))) note('a tree stands in a building', t.x, t.y);
  }
  return [...found].map(([what, f]) => `${what}: ${f.n} (first at ${f.x.toFixed(0)}, ${f.y.toFixed(0)})`);
}
