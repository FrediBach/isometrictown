import { pointInRing, ringArea } from './geo';
import { hash } from './rng';
import type { Settings } from './settings';
import type { HouseRoof, Style } from './styles';
import type { Town } from './tiles';

export type Kind = 'house' | 'terrace' | 'apartment' | 'shed' | 'industrial' | 'civic' | 'worship' | 'tall';
export type Roof = HouseRoof | 'skirt' | 'shed' | 'sawtooth' | 'church' | 'mosque' | 'temple';

/** What we worked out about a building, from its shape, its neighbours and what's around it. */
export type Info = {
  kind: Kind;
  roof: Roof;
  /** Roof pitch in degrees. */
  pitch: number;
  /** Per outer-ring edge: the height of the building next door where the edge is a shared party wall, else 0. */
  party: Float32Array;
  /** Direction of the nearest street, and the unit vector from the building towards it. */
  street?: [number, number];
  toStreet?: [number, number];
  /** OSM says the ridge runs across the building, not along it. */
  across?: boolean;
  chimney: boolean;
  dormers: boolean;
  /** 0: plain gable; 1: stepped gable; 2: neck gable, on the end facing the street. */
  gableFront: 0 | 1 | 2;
  parapet: boolean;
  /** Stable seed shared by a row of terraced houses, so they match. */
  seed: [number, number];
  /** True when the roof came from OSM tags rather than a guess. */
  tagged: boolean;
};

type Key = (x: number, y: number) => [number, number];

const CELL = 48;
const PARTY_TOL = 0.9;
const CIVIC_POIS = new Set(['school', 'college', 'kindergarten', 'town_hall', 'hospital', 'library', 'museum', 'theatre', 'police', 'fire_station', 'post', 'railway', 'castle']);
const CIVIC_LAND = new Set(['school', 'university', 'college', 'hospital']);
const WORK_LAND = new Set(['industrial', 'railway', 'garages', 'military']);

/** Buckets of item indices over a square grid, for neighbour lookups. */
class Grid {
  private cells = new Map<number, number[]>();
  private stamp: Int32Array;
  private tick = 0;
  constructor(size: number) {
    this.stamp = new Int32Array(size);
  }
  private id(cx: number, cy: number) {
    return (cx + 32768) * 65536 + (cy + 32768);
  }
  add(i: number, x0: number, y0: number, x1: number, y1: number): void {
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const k = this.id(cx, cy);
        const c = this.cells.get(k);
        if (c) c.push(i);
        else this.cells.set(k, [i]);
      }
  }
  /** Each item near a box, once. */
  near(x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void): void {
    this.tick++;
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const c = this.cells.get(this.id(cx, cy));
        if (!c) continue;
        for (const i of c) {
          if (this.stamp[i] === this.tick) continue;
          this.stamp[i] = this.tick;
          fn(i);
        }
      }
  }
}

function bbox(p: number[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < x0) x0 = p[i];
    if (p[i] > x1) x1 = p[i];
    if (p[i + 1] < y0) y0 = p[i + 1];
    if (p[i + 1] > y1) y1 = p[i + 1];
  }
  return [x0, y0, x1, y1];
}

function pick<T extends string>(weights: Partial<Record<T, number>>, r: number): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let t = r * total;
  for (const [k, w] of entries) {
    t -= w;
    if (t <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

const OSM_ROOF: Record<string, Roof> = {
  flat: 'flat',
  gabled: 'gabled',
  saltbox: 'gabled',
  round: 'gabled',
  hipped: 'hipped',
  pyramidal: 'hipped',
  side_hipped: 'hipped',
  'half-hipped': 'halfHipped',
  gambrel: 'mansard',
  mansard: 'mansard',
  skillion: 'shed',
  lean_to: 'shed',
  sawtooth: 'sawtooth',
  dome: 'mosque',
  onion: 'mosque',
};

const OSM_KIND: Record<string, Kind> = {
  house: 'house',
  detached: 'house',
  semidetached_house: 'house',
  bungalow: 'house',
  cabin: 'house',
  farm: 'house',
  terrace: 'terrace',
  apartments: 'apartment',
  residential: 'apartment',
  hotel: 'apartment',
  office: 'apartment',
  commercial: 'apartment',
  retail: 'apartment',
  garage: 'shed',
  garages: 'shed',
  shed: 'shed',
  hut: 'shed',
  carport: 'shed',
  industrial: 'industrial',
  warehouse: 'industrial',
  barn: 'industrial',
  farm_auxiliary: 'industrial',
  school: 'civic',
  university: 'civic',
  college: 'civic',
  hospital: 'civic',
  public: 'civic',
  civic: 'civic',
  government: 'civic',
  train_station: 'civic',
  church: 'worship',
  cathedral: 'worship',
  chapel: 'worship',
  mosque: 'worship',
  temple: 'worship',
  shrine: 'worship',
  synagogue: 'worship',
};

const OSM_RELIGION: Record<string, string> = { church: 'christian', cathedral: 'christian', chapel: 'christian', mosque: 'muslim', temple: 'buddhist', shrine: 'shinto', synagogue: 'jewish' };

/**
 * Work out what each building is and what roof it gets. Everything random is keyed to
 * map position and the seed, so it doesn't change as the view moves.
 */
export function classify(town: Town, style: Style, set: Settings, key: Key): void {
  const bs = town.buildings;
  const N = bs.length;
  const boxes = bs.map((b) => bbox(b.shape[0].pts));
  const grid = new Grid(N);
  boxes.forEach((b, i) => grid.add(i, b[0] - 1, b[1] - 1, b[2] + 1, b[3] + 1));

  const containing = (x: number, y: number): number => {
    let found = -1;
    grid.near(x, y, x, y, (i) => {
      if (found >= 0) return;
      const b = boxes[i];
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return;
      if (pointInRing(x, y, bs[i].shape[0].pts)) found = i;
    });
    return found;
  };

  // Points that say what a building is.
  const numbers = new Uint16Array(N);
  for (let k = 0; k < town.numbers.length; k += 2) {
    const i = containing(town.numbers[k], town.numbers[k + 1]);
    if (i >= 0 && numbers[i] < 65535) numbers[i]++;
  }
  const poi: (string | undefined)[] = new Array(N);
  const religion: (string | undefined)[] = new Array(N);
  for (const p of town.pois) {
    const i = containing(p.x, p.y);
    if (i < 0) continue;
    if (p.cls === 'place_of_worship') {
      poi[i] = 'worship';
      religion[i] = p.sub;
    } else if (CIVIC_POIS.has(p.cls) && !poi[i]) poi[i] = 'civic';
  }
  const tags: (Town['tagged'][number] | undefined)[] = new Array(N);
  for (const t of town.tagged) {
    const i = containing(t.x, t.y);
    if (i >= 0) tags[i] = t;
  }

  // Land use under each building, smallest area wins.
  const landBoxes = town.landuse.map((a) => bbox(a.shape[0].pts));
  const landArea = town.landuse.map((a) => Math.abs(ringArea(a.shape[0].pts)));
  const land: (string | undefined)[] = new Array(N);
  const centre: [number, number][] = boxes.map((b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
  const landGrid = new Grid(town.landuse.length);
  landBoxes.forEach((b, k) => landGrid.add(k, ...b));
  for (let i = 0; i < N; i++) {
    const [x, y] = centre[i];
    let best = Infinity;
    landGrid.near(x, y, x, y, (k) => {
      const b = landBoxes[k];
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3] || landArea[k] >= best) return;
      if (pointInRing(x, y, town.landuse[k].shape[0].pts)) {
        best = landArea[k];
        land[i] = town.landuse[k].cls;
      }
    });
  }

  // Party walls: an edge that runs back-to-back along a neighbour's edge.
  const party = bs.map((b) => new Float32Array(b.shape[0].pts.length / 2));
  const parent = Int32Array.from({ length: N }, (_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < N; i++) {
    const ring = bs[i].shape[0];
    if (bs[i].min > 0) continue;
    const p = ring.pts;
    const n = p.length / 2;
    for (let e = 0; e < n; e++) {
      if (ring.seam[e]) continue;
      const f = (e + 1) % n;
      const ax = p[e * 2];
      const ay = p[e * 2 + 1];
      const dx = p[f * 2] - ax;
      const dy = p[f * 2 + 1] - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1.5) continue;
      const tx = dx / len;
      const ty = dy / len;
      let cover = 0;
      let next = 0;
      const ex0 = Math.min(ax, ax + dx) - PARTY_TOL;
      const ey0 = Math.min(ay, ay + dy) - PARTY_TOL;
      const ex1 = Math.max(ax, ax + dx) + PARTY_TOL;
      const ey1 = Math.max(ay, ay + dy) + PARTY_TOL;
      grid.near(ex0, ey0, ex1, ey1, (j) => {
        if (j === i || bs[j].min > 0) return;
        const bj = boxes[j];
        if (bj[2] < ex0 || bj[0] > ex1 || bj[3] < ey0 || bj[1] > ey1) return;
        const q = bs[j].shape[0].pts;
        const m = q.length / 2;
        for (let g = 0; g < m; g++) {
          const h = (g + 1) % m;
          const qx = q[g * 2];
          const qy = q[g * 2 + 1];
          const rx = q[h * 2];
          const ry = q[h * 2 + 1];
          const ql = Math.hypot(rx - qx, ry - qy);
          if (ql < 0.5) continue;
          if (((rx - qx) * tx + (ry - qy) * ty) / ql > -0.97) continue;
          const d0 = Math.abs((qx - ax) * ty - (qy - ay) * tx);
          const d1 = Math.abs((rx - ax) * ty - (ry - ay) * tx);
          if (d0 > PARTY_TOL || d1 > PARTY_TOL) continue;
          const s0 = (qx - ax) * tx + (qy - ay) * ty;
          const s1 = (rx - ax) * tx + (ry - ay) * ty;
          const overlap = Math.min(len, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1));
          if (overlap > 0.5) {
            cover += overlap;
            next = Math.max(next, bs[j].h);
            parent[root(i)] = root(j);
          }
        }
      });
      if (cover > 0.6 * len) party[i][e] = next;
    }
  }

  // Streets, for which way ridges and gables face.
  const segs: number[] = [];
  for (const w of town.ways) {
    if (w.kind === 'rail' || w.bridge) continue;
    for (let k = 0; k + 3 < w.pts.length; k += 2) segs.push(w.pts[k], w.pts[k + 1], w.pts[k + 2], w.pts[k + 3]);
  }
  const segGrid = new Grid(segs.length / 4);
  for (let s = 0; s < segs.length; s += 4) segGrid.add(s / 4, Math.min(segs[s], segs[s + 2]), Math.min(segs[s + 1], segs[s + 3]), Math.max(segs[s], segs[s + 2]), Math.max(segs[s + 1], segs[s + 3]));

  // Terraces share one seed, taken from the member with the smallest position key.
  const groupSeed = new Map<number, [number, number]>();
  const keys = centre.map(([x, y]) => key(x, y));
  for (let i = 0; i < N; i++) {
    const g = root(i);
    const cur = groupSeed.get(g);
    const k = keys[i];
    if (!cur || k[0] < cur[0] || (k[0] === cur[0] && k[1] < cur[1])) groupSeed.set(g, k);
  }

  const share = Math.min(1, (style.pitchedShare * set.pitched) / 0.7);
  for (let i = 0; i < N; i++) {
    const b = bs[i];
    const p = b.shape[0].pts;
    const area = Math.abs(ringArea(p));
    const H = b.h;
    const k = keys[i];
    const r = (salt: number) => hash(k[0], k[1], set.seed, 100 + salt);
    const hasParty = party[i].some((v) => v);
    const seed = hasParty ? groupSeed.get(root(i))! : k;
    const g = (salt: number) => hash(seed[0], seed[1], set.seed, 200 + salt);
    // Rows share their roof shape and details only where that's the local habit.
    const row = (salt: number) => (style.rows ? g(salt) : r(salt));
    const t = tags[i];

    let kind: Kind;
    let faith = religion[i];
    if (t?.building && OSM_KIND[t.building]) {
      kind = OSM_KIND[t.building];
      faith ??= OSM_RELIGION[t.building];
    } else if (poi[i] === 'worship') kind = 'worship';
    else if (poi[i] === 'civic' || CIVIC_LAND.has(land[i] ?? '')) kind = 'civic';
    else if (area < 30 && H <= 4.5 && !numbers[i] && !hasParty) kind = 'shed';
    else if (WORK_LAND.has(land[i] ?? '') || (area > 1500 && H <= 15 && !numbers[i] && land[i] !== 'residential')) kind = 'industrial';
    else if (H > 40) kind = 'tall';
    else if (hasParty && area < 500 && H <= style.pitchedMaxH) kind = 'terrace';
    else if (area > style.pitchedMaxArea || H > style.pitchedMaxH || numbers[i] >= 4) kind = 'apartment';
    else kind = 'house';
    if (kind === 'worship' && area < 30) kind = 'shed';

    // Street direction and side.
    let street: [number, number] | undefined;
    let toStreet: [number, number] | undefined;
    {
      const [cx, cy] = centre[i];
      const bx = boxes[i];
      const reach = Math.min(bx[2] - bx[0], bx[3] - bx[1]) / 2 + 30;
      let best = reach * reach;
      segGrid.near(cx - reach, cy - reach, cx + reach, cy + reach, (s) => {
        const o = s * 4;
        const ax = segs[o];
        const ay = segs[o + 1];
        const dx = segs[o + 2] - ax;
        const dy = segs[o + 3] - ay;
        const ll = dx * dx + dy * dy;
        if (ll < 1e-6) return;
        const tt = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / ll));
        const px = ax + dx * tt - cx;
        const py = ay + dy * tt - cy;
        const d2 = px * px + py * py;
        if (d2 < best && d2 > 1e-6) {
          best = d2;
          const l = Math.sqrt(ll);
          street = [dx / l, dy / l];
          const dl = Math.sqrt(d2);
          toStreet = [px / dl, py / dl];
        }
      });
    }

    let roof: Roof;
    const tagRoof = t?.roof ? OSM_ROOF[t.roof] : undefined;
    const pitchedOk = H <= style.pitchedMaxH * 1.15 && area <= style.pitchedMaxArea * 1.4;
    const houseRoof = (rr: number) => (rr < share ? pick(style.roofs, rr / share) : 'flat');
    switch (kind) {
      case 'house':
        roof = houseRoof(r(1));
        break;
      case 'terrace':
        roof = houseRoof(row(1));
        break;
      case 'apartment':
        roof = style.blocks !== 'flat' && H <= style.pitchedMaxH * 1.5 && r(2) < share ? style.blocks : pitchedOk && r(2) < share * 0.6 ? houseRoof(r(1)) : 'flat';
        break;
      case 'civic':
        roof = pitchedOk && r(2) < share ? (r(3) < 0.6 ? 'hipped' : houseRoof(r(1))) : style.blocks !== 'flat' && r(2) < share ? style.blocks : 'flat';
        break;
      case 'worship':
        roof = faith === 'muslim' ? 'mosque' : faith === 'christian' ? 'church' : faith === 'buddhist' || faith === 'shinto' || faith === 'hindu' ? 'temple' : 'hipped';
        break;
      case 'industrial':
        roof = area > 800 ? pick({ sawtooth: 0.3, gabled: 0.25, flat: 0.45 }, r(4)) : pick({ shed: 0.3, gabled: 0.3, flat: 0.4 }, r(4));
        if (style.id === 'arid') roof = 'flat';
        break;
      case 'shed':
        roof = style.id === 'arid' ? 'flat' : pick({ flat: 0.45, shed: 0.35, gabled: 0.2 }, r(4));
        break;
      default:
        roof = 'flat';
    }
    if (tagRoof) roof = tagRoof === 'mosque' && kind !== 'worship' ? 'hipped' : tagRoof;
    if (b.min > 0 && roof !== 'flat') roof = 'flat';

    const [p0, p1] = style.pitch;
    let pitch = p0 + (p1 - p0) * (kind === 'terrace' ? g(5) : r(5));
    if (kind === 'industrial') pitch = 10 + r(6) * 8;
    if (roof === 'shed') pitch = 8 + r(6) * 8;
    if (kind === 'shed' && roof === 'gabled') pitch = Math.min(pitch, 30);

    const isHome = kind === 'house' || kind === 'terrace' || kind === 'apartment';
    const pick2 = (prob: number, salt: number) => (kind === 'terrace' ? row(salt) : r(salt)) < prob;
    b.info = {
      kind,
      roof,
      pitch,
      party: party[i],
      street,
      toStreet,
      across: t?.across,
      chimney: isHome && pick2(style.chimney, 7),
      dormers: (isHome || kind === 'civic') && pick2(style.dormer, 8),
      gableFront: isHome && roof === 'gabled' && r(9) < style.gableFront ? (r(10) < 0.55 ? 1 : 2) : 0,
      parapet: r(11) < style.parapet,
      seed,
      tagged: !!tagRoof,
    };
  }
}
