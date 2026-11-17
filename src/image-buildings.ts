/**
 * Buildings for image mode (§12 of docs/plans/image-mode.md): a footprint on every lot the way
 * its zone builds, explicit heights kept smooth along a row, the evidence `classify()` reads to
 * make each one what it should be, and a few landmarks: churches by the squares and across the
 * town, a town hall on the largest square, schools with a pitch beside the parks. Streets the
 * blocks don't reach (dead ends, the town's outer edge) get buildings set along them.
 */
import { pointInRing, ringArea } from './geo';
import { CORNER, frontage, lotDepth, lotRing, merge, Occupancy, PAVEMENT, ROWS, strip, type Block, type Lot, type Vary } from './image-blocks';
import { centre, Footprints, type Ground } from './image-check';
import { LABELS, type Label } from './image-tone';
import type { Zones } from './image-zones';
import { hash } from './rng';
import type { Settings } from './settings';
import type { Style } from './styles';
import type { Area, Building, Poi, Shape, Tagged, Way } from './tiles';

/** Buildings are laid out this far beyond the ground that can show, m; those beyond it are context only. */
const MARGIN = 60;
/** The most buildings a town gets (§17). */
export const MAX_BUILDINGS = 30000;
/** Storeys of each built label at its lowest and highest level. */
const STOREYS: Partial<Record<Label, [number, number]>> = { suburb: [1, 2], rows: [2, 3], old: [3, 5], blocks: [4, 7], towers: [10, 24], works: [2, 4] };
/** Rows: how far the building stands back from the front of its lot and how deep it is, m, at the zone's sparsest level and its densest. */
const ROW: Partial<Record<Label, { back: [number, number]; depth: [number, number] }>> = {
  old: { back: [0.5, 0], depth: [11, 14] },
  rows: { back: [2.5, 1], depth: [9, 12] },
  blocks: { back: [2, 0], depth: [13, 16] },
};
/** The narrowest plot in a row on paper, mm: at coarse scales rows are drawn as fewer, longer buildings. */
export const ROW_LOT_MM = 1.4;
/** Churches stand at least this far apart, m, and one is sought in every cell this size of built town. */
const CHURCH_SPACING = 350;
const PARISH = 500;
/** What the frontage rows mark in the occupancy raster: they share walls only with each other. */
const SHARED = 2;
/** And what lots mark: they share their cut lines only with each other. */
const LOT = 3;
/** Schools stand at least this far apart, m. */
const SCHOOL_SPACING = 700;

/** What the buildings come to: footprints with their evidence, points of interest, and land use for schools and pitches. */
export type Built = { buildings: Building[]; tagged: Tagged[]; pois: Poi[]; landuse: Area[] };
export type BuildContext = { z: Zones; set: Settings; style: Style; box: number[]; vary: Vary; occ: Occupancy; ground: Ground; plazas: Shape[]; parks: Shape[]; paths: Way[]; ways: Way[]; cores: [number, number][]; mmPerMetre: number };

const rect = (F: [number, number], u: [number, number], v: [number, number], w: number, d: number): number[] => [
  F[0], F[1], F[0] + u[0] * w, F[1] + u[1] * w, F[0] + u[0] * w + v[0] * d, F[1] + u[1] * w + v[1] * d, F[0] + v[0] * d, F[1] + v[1] * d,
];
/** How far a point is from a ring's outline, m. */
function toRing(x: number, y: number, p: number[]): number {
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
const within = (ring: number[], lot: number[]) => {
  for (let k = 0; k < ring.length; k += 2) if (!pointInRing(ring[k], ring[k + 1], lot) && toRing(ring[k], ring[k + 1], lot) > 0.05) return false;
  const [cx, cy] = centre(ring);
  return pointInRing(cx, cy, lot);
};
/**
 * A lot's front, along the street: where it starts, the unit along it, the unit inwards, and its
 * length. A lot spanning a corner fronts along its longer leg.
 */
function frontOf(l: Lot): { A: [number, number]; u: [number, number]; v: [number, number]; L: number } {
  const o = l.o;
  const n = o.length / 2;
  let split = -1;
  let sharpest = (CORNER * Math.PI) / 180;
  for (let k = 1; k < n - 1; k++) {
    const a = Math.atan2(o[k * 2 + 1] - o[k * 2 - 1], o[k * 2] - o[k * 2 - 2]);
    const b = Math.atan2(o[k * 2 + 3] - o[k * 2 + 1], o[k * 2 + 2] - o[k * 2]);
    let t = Math.abs(b - a);
    if (t > Math.PI) t = 2 * Math.PI - t;
    if (t > sharpest) [sharpest, split] = [t, k];
  }
  let [s, e] = [0, n - 1];
  if (split > 0) {
    const first = Math.hypot(o[split * 2] - o[0], o[split * 2 + 1] - o[1]);
    const second = Math.hypot(o[(n - 1) * 2] - o[split * 2], o[(n - 1) * 2 + 1] - o[split * 2 + 1]);
    [s, e] = first >= second ? [0, split] : [split, n - 1];
  }
  const ax = o[s * 2];
  const ay = o[s * 2 + 1];
  const L = Math.hypot(o[e * 2] - ax, o[e * 2 + 1] - ay) || 1;
  const u: [number, number] = [(o[e * 2] - ax) / L, (o[e * 2 + 1] - ay) / L];
  return { A: [ax, ay], u, v: [-u[1], u[0]], L };
}

/** How much a pitched roof adds over the walls, as `classify()` reckons it, for a building this wide. */
const allowance = (w: number, style: Style) => Math.min((w / 2) * Math.tan(((style.pitch[0] + style.pitch[1]) * Math.PI) / 360), 13) * 0.45;

type Plan = { ring: number[]; h: number; building: string; roof?: string; across?: boolean; poi?: Poi };

/** Lay out the buildings on the blocks' lots, then along the streets the blocks don't reach. */
export function buildingsOf(blocks: Block[], c: BuildContext): Built {
  const { set, style, vary, occ } = c;
  const [bx0, by0, bx1, by1] = c.box;
  const inBox = (x: number, y: number, pad: number) => x >= bx0 - pad && x <= bx1 + pad && y >= by0 - pad && y <= by1 + pad;
  const out: Built = { buildings: [], tagged: [], pois: [], landuse: [] };
  const likeness = Math.max(0, Math.min(1, set.likeness));
  const worship = style.id === 'arid' ? 'mosque' : style.id === 'eastAsian' ? 'temple' : 'church';

  landmarks(blocks, c);

  // Lots in order: landmarks first, then block by block; each takes its ground or is dropped.
  const all: Lot[] = blocks.flatMap((b) => b.lots).filter((l) => {
    const [x, y] = centre(lotRing(l));
    return inBox(x, y, MARGIN);
  });
  all.sort((a, b) => (b.use ? 1 : 0) - (a.use ? 1 : 0));
  const kept = all.filter((l) => {
    const ring = lotRing(l);
    if (!occ.free(ring, LOT)) return false;
    occ.take(ring, LOT);
    return true;
  });
  kept.sort((a, b) => a.block - b.block || a.side - b.side || a.index - b.index);

  const towers: [number, number, number][] = [];
  const laid = new Footprints();
  const add = (p: Plan): boolean => {
    if (out.buildings.length >= MAX_BUILDINGS || !c.ground.clear(p.ring) || laid.clash(p.ring)) return false;
    laid.add(p.ring);
    const [cx, cy] = centre(p.ring);
    const b: Building = { shape: [{ pts: p.ring, seam: new Uint8Array(p.ring.length / 2) }], h: p.h, min: 0 };
    if (!inBox(cx, cy, 0)) b.context = true;
    out.buildings.push(b);
    out.tagged.push({ x: cx, y: cy, building: p.building, roof: p.roof, across: p.across, from: 'image' });
    if (p.poi) out.pois.push({ ...p.poi, x: cx, y: cy });
    return true;
  };

  // Storeys along each street side, kept smooth: neighbours differ by one at full realism, three at full likeness.
  const step = Math.round(1 + 2 * likeness);
  let prev: Lot | null = null;
  let prevSt = 0;
  for (const l of kept) {
    const [lo, hi] = STOREYS[l.label] ?? [1, 2];
    const [fx, fy] = [l.o[0], l.o[1]];
    let st = Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * l.level + (vary(fx, fy, 14042) - 0.5) * 0.9)));
    const next = prev && prev.block === l.block && prev.side === l.side && l.index === prev.index + 1;
    if (next && !l.use && !prev!.use) st = Math.max(prevSt - step, Math.min(prevSt + step, st));
    prev = l;
    prevSt = st;
    for (const p of footprints(l, st)) add(p);
  }

  /** The footprints on one lot. */
  function footprints(l: Lot, st: number): Plan[] {
    const ring = lotRing(l);
    const D = lotDepth(l);
    const { A, u, v, L } = frontOf(l);
    const [mx, my] = centre(ring);
    const r = (salt: number) => vary(mx, my, salt);
    // Rows keep one roof habit, building line and depth along a street side.
    const side = (salt: number) => hash(l.block, l.side, set.seed, salt);
    const at = (range: [number, number]) => range[0] + (range[1] - range[0]) * l.level;
    const pitched = (salt: number) => (ROWS.has(l.label) ? side(salt) : r(salt)) < l.warmth;

    if (l.use === 'church') {
      const deep = D >= 26;
      const len = deep ? Math.min(D - 4, 32) : Math.min(L - 4, 30);
      const wid = deep ? Math.min(L - 4, 12 + 3 * r(14043)) : Math.min(D - 1.5, 14);
      if (len >= 16 && wid >= 8) {
        const F: [number, number] = deep ? [A[0] + u[0] * (L - wid) * 0.5 + v[0] * 2, A[1] + u[1] * (L - wid) * 0.5 + v[1] * 2] : [A[0] + u[0] * (L - len) * 0.5 + v[0] * 0.5, A[1] + u[1] * (L - len) * 0.5 + v[1] * 0.5];
        const q = deep ? rect(F, u, v, wid, len) : rect(F, u, v, len, wid);
        if (within(q, ring)) return [{ ring: q, h: 13 + 4 * r(14044), building: worship }];
      }
    }
    if (l.use === 'school') {
      // A hall set back on a deep lot; in a row, the row's own strip, three storeys and flat.
      const len = Math.min(L - 6, 50);
      const dep = Math.min(D - 6, 14);
      const F: [number, number] = [A[0] + u[0] * (L - len) * 0.5 + v[0] * 4, A[1] + u[1] * (L - len) * 0.5 + v[1] * 4];
      const q = len >= 20 && dep >= 9 ? rect(F, u, v, len, dep) : ROWS.has(l.label) ? strip(l, 0, Math.min(1, 12 / l.depth)) : null;
      if (q && within(q, ring)) {
        out.landuse.push({ shape: [{ pts: ring, seam: new Uint8Array(ring.length / 2) }], cls: 'school' });
        const pitch = pitchBy(q, u, c);
        if (pitch) out.landuse.push({ shape: [{ pts: pitch, seam: new Uint8Array(4) }], cls: 'pitch' });
        return [{ ring: q, h: (2 + Math.round(r(14045))) * style.floor, building: 'school', roof: 'flat' }];
      }
    }
    const hall = l.use === 'townhall' ? { building: 'civic', poi: { x: 0, y: 0, cls: 'town_hall', sub: 'townhall' } } : null;

    if (ROWS.has(l.label)) {
      const R = ROW[l.label]!;
      const back = at(R.back);
      const dep = R.depth[0] + (R.depth[1] - R.depth[0]) * side(14046);
      // Fractions of the block's depth, the same on every lot, so neighbours share their corners.
      const f0 = Math.min(0.3, back / l.depth);
      const f1 = Math.min(1, (back + dep) / l.depth);
      const q = strip(l, f0, f1);
      const s = hall ? st + 1 : st;
      const roof = pitched(14047) ? undefined : 'flat';
      const h = s * style.floor + (roof ? 0 : allowance(Math.min(dep, D), style));
      const building = hall?.building ?? (l.label === 'old' && s > 3 ? 'apartments' : l.label === 'blocks' ? 'apartments' : 'terrace');
      return [{ ring: q, h, building, roof, poi: hall?.poi }];
    }
    if (l.label === 'suburb') {
      if (hall) {
        const q = rect([A[0] + u[0] * (L - 24) * 0.5 + v[0] * 6, A[1] + u[1] * (L - 24) * 0.5 + v[1] * 6], u, v, 24, 14);
        if (L >= 28 && within(q, ring)) return [{ ring: q, h: 3 * style.floor, building: 'civic', poi: hall.poi }];
      }
      const plans: Plan[] = [];
      let ww = Math.min(9 + 3 * r(14048), L - 5);
      let dd = 8 + 3 * r(14049);
      let sb = 7 - 3 * l.level + 3 * (r(14050) - 0.5);
      if (ww < 6) return [];
      const m = L / 2 + (r(14051) - 0.5) * Math.max(0, L - ww - 5) * 0.6;
      const wing = r(14052) < 0.25;
      const right = r(14053) < 0.5;
      const ex = 4 + 2 * r(14054);
      const wg = ww * (0.4 + 0.1 * r(14055));
      let house: number[] | null = null;
      for (let tries = 0; tries < 3 && !house; tries++) {
        const F: [number, number] = [A[0] + u[0] * (m - ww / 2) + v[0] * sb, A[1] + u[1] * (m - ww / 2) + v[1] * sb];
        const P = (a: number, b: number) => [F[0] + u[0] * a + v[0] * b, F[1] + u[1] * a + v[1] * b];
        const q =
          wing && tries === 0
            ? right
              ? [...P(0, 0), ...P(ww, 0), ...P(ww, dd + ex), ...P(ww - wg, dd + ex), ...P(ww - wg, dd), ...P(0, dd)]
              : [...P(0, 0), ...P(ww, 0), ...P(ww, dd), ...P(wg, dd), ...P(wg, dd + ex), ...P(0, dd + ex)]
            : rect(F, u, v, ww, dd);
        if (within(q, ring)) house = q;
        else if (tries > 0) {
          sb *= 0.6;
          dd *= 0.85;
          ww *= 0.9;
        }
      }
      if (!house) return [];
      const roof = pitched(14056) ? undefined : 'flat';
      const s = Math.min(st, 2);
      plans.push({ ring: house, h: s * style.floor + (roof ? 0 : allowance(Math.min(ww, dd), style)), building: 'house', roof });
      if (r(14057) < 0.25) {
        const back = sb + dd + (wing ? ex : 0) + 3;
        const off = right ? m - ww / 2 : m + ww / 2 - 3;
        const q = rect([A[0] + u[0] * off + v[0] * back, A[1] + u[1] * off + v[1] * back], u, v, 3, 3.5);
        if (within(q, ring)) plans.push({ ring: q, h: 2.6, building: 'shed' });
      }
      return plans;
    }
    if (l.label === 'works') {
      const gap = 5 + 3 * r(14058);
      const ww = L - 2 * gap;
      const sb = 8 + 4 * r(14059);
      let dd = Math.min(D - sb - 5, 28 + 17 * r(14060));
      if (dd < 12) dd = D - sb - 2;
      if (ww < 15 || dd < 10) return [];
      const q = rect([A[0] + u[0] * gap + v[0] * sb, A[1] + u[1] * gap + v[1] * sb], u, v, ww, dd);
      if (!within(q, ring)) return [];
      return [{ ring: q, h: 6 + 2.5 * st, building: r(14061) < 0.4 ? 'warehouse' : 'industrial', roof: r(14062) < l.warmth ? 'sawtooth' : 'flat' }];
    }
    if (l.label === 'towers') {
      const slab = r(14063) < 0.4;
      let a = slab ? 36 + 14 * r(14064) : 18 + 6 * r(14064);
      let b = slab ? 14 + 2 * r(14065) : a;
      for (let tries = 0; tries < 2; tries++) {
        const cx = A[0] + u[0] * (L / 2) + v[0] * (D / 2);
        const cy = A[1] + u[1] * (L / 2) + v[1] * (D / 2);
        const q = rect([cx - u[0] * (a / 2) - v[0] * (b / 2), cy - u[1] * (a / 2) - v[1] * (b / 2)], u, v, a, b);
        const rad = Math.max(a, b) / 2;
        if (within(q, ring) && towers.every(([x, y, r2]) => Math.hypot(x - cx, y - cy) >= r2 + rad + 20)) {
          towers.push([cx, cy, rad]);
          return [{ ring: q, h: st * style.floor, building: 'apartments', roof: 'flat' }];
        }
        a = b = 18;
      }
    }
    return [];
  }

  frontages(c, out, add);
  return out;
}

/**
 * Lots made over into landmarks: a church beside every square of the old town, rows or blocks,
 * and one in every parish of built town that has none near; a town hall on the largest square
 * with lots beside it, or else at the middle of the main core;
 * a school beside each large park in suburbs and rows. A landmark takes a run of neighbouring
 * lots on one side, merged until its frontage is long enough.
 */
function landmarks(blocks: Block[], c: BuildContext): void {
  // Every lot once, with where it is, filed by 50 m cell; `live` holds those not yet merged away.
  type Entry = { b: Block; l: Lot; at: [number, number] };
  const entries: Entry[] = blocks.flatMap((b) => b.lots.map((l) => ({ b, l, at: centre(lotRing(l)) })));
  const live = new Set(entries.map((x) => x.l));
  const open = (x: Entry) => live.has(x.l) && !x.l.use;
  const homely = (x: Entry) => x.l.label !== 'works' && x.l.label !== 'towers';
  const CELL = 50;
  const grid = new Map<number, Entry[]>();
  const id = (i: number, j: number) => (i + 32768) * 65536 + j + 32768;
  for (const x of entries) {
    const k = id(Math.floor(x.at[0] / CELL), Math.floor(x.at[1] / CELL));
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(x);
  }
  /** Open lots whose middles are within `d` of a ring's outline, nearest first: each stretch of the outline measured only to the lots in the cells beside it. */
  const beside = (ring: number[], d: number, want: (x: Entry) => boolean) => {
    const dist = new Map<Entry, number>();
    for (let a = 0, b = ring.length - 2; a < ring.length; b = a, a += 2) {
      const [ax, ay, bx, by] = [ring[b], ring[b + 1], ring[a], ring[a + 1]];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      for (let i = Math.floor((Math.min(ax, bx) - d) / CELL); i <= Math.floor((Math.max(ax, bx) + d) / CELL); i++)
        for (let j = Math.floor((Math.min(ay, by) - d) / CELL); j <= Math.floor((Math.max(ay, by) + d) / CELL); j++)
          for (const x of grid.get(id(i, j)) ?? []) {
            const t = Math.max(0, Math.min(1, ((x.at[0] - ax) * dx + (x.at[1] - ay) * dy) / l2));
            const e = Math.hypot(x.at[0] - ax - dx * t, x.at[1] - ay - dy * t);
            if (e < d && e < (dist.get(x) ?? Infinity)) dist.set(x, e);
          }
    }
    return [...dist].filter(([x]) => open(x) && want(x)).map(([x, e]) => ({ ...x, d: e })).sort((p, q) => p.d - q.d);
  };
  /** Merge a lot with its neighbours on the same side until its frontage is at least `need`. */
  const run = (b: Block, l: Lot, need: number, use: Lot['use']): Lot | null => {
    let m = l;
    const take = [l];
    for (let k = 1; k <= 6 && frontage(m) < need; k++) {
      const after = b.lots.find((x) => x.side === l.side && x.index === take[take.length - 1].index + 1 && !x.use);
      const before = b.lots.find((x) => x.side === l.side && x.index === take[0].index - 1 && !x.use);
      if (after && (k % 2 || !before)) {
        m = merge(m, after);
        take.push(after);
      } else if (before) {
        m = merge(before, m);
        take.unshift(before);
      } else break;
    }
    if (frontage(m) < need) return null;
    m.index = take[0].index;
    m.use = use;
    for (const t of take) live.delete(t);
    b.lots = b.lots.filter((x) => !take.includes(x));
    b.lots.push(m);
    b.lots.sort((p, q) => p.side - q.side || p.index - q.index);
    return m;
  };
  const churches: [number, number][] = [];
  const near = (list: [number, number][], x: number, y: number, d: number) => list.some(([px, py]) => Math.hypot(px - x, py - y) < d);

  // Squares, the largest first: a church beside each in town, the town hall beside the largest.
  const squares = c.plazas.map((s) => ({ s, area: ringArea(s[0].pts) })).filter((q) => q.area >= 600);
  squares.sort((a, b) => b.area - a.area);
  let halled = false;
  for (const { s } of squares) {
    const ring = s[0].pts;
    const by = beside(ring, 40, homely);
    if (!by.length) continue;
    const [sx, sy] = centre(ring);
    let church: Lot | null = null;
    if (by[0].l.label !== 'suburb' && !near(churches, sx, sy, CHURCH_SPACING)) {
      church = run(by[0].b, by[0].l, 22, 'church');
      if (church) churches.push(centre(lotRing(church)));
    }
    if (!halled) {
      const at = church ? centre(lotRing(church)) : null;
      const hall = by.find((x) => open(x) && (!at || Math.hypot(x.at[0] - at[0], x.at[1] - at[1]) > 30));
      if (hall) halled = !!run(hall.b, hall.l, 18, 'townhall');
    }
  }
  // With no square to stand on, the town hall stands nearest the middle of the main core.
  if (!halled && c.cores.length) {
    const [mx, my] = c.cores[0];
    const by = entries.filter((x) => open(x) && homely(x)).sort((a, b) => Math.hypot(a.at[0] - mx, a.at[1] - my) - Math.hypot(b.at[0] - mx, b.at[1] - my));
    for (const x of by.slice(0, 8)) if (run(x.b, x.l, 18, 'townhall')) break;
  }

  // A church in every parish of built town with none near, at the lot nearest a point the seed picks.
  const parishes = new Map<number, Entry[]>();
  for (const x of entries) {
    if (!open(x) || !homely(x)) continue;
    const k = id(Math.floor(x.at[0] / PARISH), Math.floor(x.at[1] / PARISH));
    (parishes.get(k) ?? parishes.set(k, []).get(k)!).push(x);
  }
  for (const [k, list] of [...parishes].sort(([a], [b]) => a - b)) {
    if (list.length < 30) continue;
    const i = Math.floor(k / 65536) - 32768;
    const j = (k % 65536) - 32768;
    const tx = (i + 0.25 + 0.5 * hash(i, j, c.set.seed, 14066)) * PARISH;
    const ty = (j + 0.25 + 0.5 * hash(i, j, c.set.seed, 14067)) * PARISH;
    if (near(churches, tx, ty, CHURCH_SPACING)) continue;
    const best = list.filter(open).sort((a, b) => Math.hypot(a.at[0] - tx, a.at[1] - ty) - Math.hypot(b.at[0] - tx, b.at[1] - ty));
    for (const x of best.slice(0, 8)) {
      if (near(churches, x.at[0], x.at[1], CHURCH_SPACING)) break;
      const ch = run(x.b, x.l, 22, 'church');
      if (ch) {
        churches.push(centre(lotRing(ch)));
        break;
      }
    }
  }

  // A school beside each park of a hectare or more in suburbs and rows.
  const schools: [number, number][] = [];
  for (const park of c.parks) {
    const ring = park[0].pts;
    if (ringArea(ring) < 10000) continue;
    const [px, py] = centre(ring);
    if (near(schools, px, py, SCHOOL_SPACING)) continue;
    for (const x of beside(ring, 50, (x) => x.l.label === 'suburb' || x.l.label === 'rows').slice(0, 6)) {
      if (!open(x)) continue;
      const s = run(x.b, x.l, ROWS.has(x.l.label) ? 28 : 40, 'school');
      if (s) {
        schools.push(centre(lotRing(s)));
        break;
      }
    }
  }
}

/** A pitch in a park beside a school, square to it either way round, clear of the park's paths and edges, as near the school as it fits; null if none does. */
function pitchBy(school: number[], u: [number, number], c: BuildContext): number[] | null {
  const [sx, sy] = centre(school);
  let best: number[] | null = null;
  let bestD = Infinity;
  const v: [number, number] = [-u[1], u[0]];
  const fits = (q: number[], park: Shape) => {
    const ring = park[0].pts;
    for (let k = 0; k < 8; k += 2) if (!pointInRing(q[k], q[k + 1], ring) || toRing(q[k], q[k + 1], ring) < 2) return false;
    for (const hole of park.slice(1)) if (pointInRing(hole.pts[0], hole.pts[1], q) || [0, 2, 4, 6].some((k) => pointInRing(q[k], q[k + 1], hole.pts))) return false;
    for (const w of c.paths) {
      const p = w.pts;
      for (let k = 0; k < p.length; k += 2) if (pointInRing(p[k], p[k + 1], q) || toRing(p[k], p[k + 1], q) < 2) return false;
      // Long path segments can cross without a point inside: test their middles too.
      for (let k = 2; k < p.length; k += 2) {
        const mx = (p[k] + p[k - 2]) / 2;
        const my = (p[k + 1] + p[k - 1]) / 2;
        if (pointInRing(mx, my, q)) return false;
      }
    }
    return true;
  };
  for (const park of c.parks) {
    const ring = park[0].pts;
    if (ringArea(ring) < 10000 || toRing(sx, sy, ring) > 60) continue;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k < ring.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, ring[k]), Math.min(y0, ring[k + 1]), Math.max(x1, ring[k]), Math.max(y1, ring[k + 1])];
    for (let y = y0; y <= y1; y += 6)
      for (let x = x0; x <= x1; x += 6) {
        const d = Math.hypot(x - sx, y - sy);
        if (d >= bestD || d > 160 || !pointInRing(x, y, ring)) continue;
        for (const [a, b] of [[50, 32], [32, 50], [36, 22], [22, 36]]) {
          const q = rect([x - u[0] * (a / 2) - v[0] * (b / 2), y - u[1] * (a / 2) - v[1] * (b / 2)], u, v, a, b);
          if (fits(q, park)) {
            best = q;
            bestD = d;
            break;
          }
        }
      }
  }
  return best;
}

/**
 * How each built zone stands along streets the blocks don't reach, at its sparsest level and its
 * densest: plot width along the street, building width (0 for the whole plot, so neighbours
 * share their walls), depth and set-back, m, and the OSM building type it is said to be.
 */
type Frontage = { lot: [number, number]; width: [number, number]; depth: [number, number]; back: [number, number]; building: string };
const FRONTAGE: Partial<Record<Label, Frontage>> = {
  suburb: { lot: [28, 18], width: [9, 12], depth: [8, 11], back: [7, 4], building: 'house' },
  rows: { lot: [7.5, 6], width: [0, 0], depth: [9, 12], back: [2.5, 1], building: 'terrace' },
  old: { lot: [9, 6], width: [0, 0], depth: [12, 16], back: [0.5, 0], building: 'terrace' },
  blocks: { lot: [36, 24], width: [0, 0], depth: [13, 16], back: [2, 0], building: 'apartments' },
  towers: { lot: [95, 70], width: [18, 24], depth: [18, 24], back: [20, 14], building: 'apartments' },
  works: { lot: [75, 55], width: [40, 55], depth: [28, 45], back: [12, 8], building: 'industrial' },
};

/**
 * Buildings set along both sides of every street, the busiest first, where the blocks left the
 * ground free: up dead ends, along the town's outer edge, and in blocks too awkward to inset.
 * The occupancy raster keeps them off roads, lots and each other; houses in a row share walls.
 */
function frontages(c: BuildContext, out: Built, add: (p: Plan) => boolean): void {
  const { z, style, occ, vary } = c;
  const zoneAt = (x: number, y: number) => {
    const i = Math.floor((x - z.x0) / z.cell);
    const j = Math.floor((y - z.y0) / z.cell);
    return i < 0 || j < 0 || i >= z.W || j >= z.H ? -1 : j * z.W + i;
  };
  /** Whether a plot is free, and on land of `label` at its middle and near each corner. */
  const free = (q: number[], label: number) => {
    const [cx, cy] = centre(q);
    for (let k = -2; k < q.length; k += 2) {
      const [x, y] = k < 0 ? [cx, cy] : [q[k] + (cx - q[k]) * 0.15, q[k + 1] + (cy - q[k + 1]) * 0.15];
      const zc = zoneAt(x, y);
      if (zc < 0 || z.label[zc] !== label) return false;
    }
    return occ.free(q, SHARED);
  };
  const [bx0, by0, bx1, by1] = c.box;
  const inBox = (x: number, y: number, pad: number) => x >= bx0 - pad && x <= bx1 + pad && y >= by0 - pad && y <= by1 + pad;
  const RANKS: Record<string, number> = { primary: 4, secondary: 3, tertiary: 2, minor: 1 };
  const ways = c.ways;
  const order = ways.map((_, i) => i).sort((a, b) => (RANKS[ways[b].cls] ?? 0) - (RANKS[ways[a].cls] ?? 0) || a - b);
  for (const wi of order) {
    const w = ways[wi];
    if (w.bridge) continue;
    const p = w.pts;
    // Distance along the street at each point, and the point at any distance.
    const cum = [0];
    for (let i = 2; i < p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
    const total = cum[cum.length - 1];
    let seg = 0;
    const pointAt = (d: number): [number, number] => {
      while (seg > 0 && cum[seg] > d) seg--;
      while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
      const t = (d - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
      return [p[seg * 2] + (p[seg * 2 + 2] - p[seg * 2]) * t, p[seg * 2 + 1] + (p[seg * 2 + 3] - p[seg * 2 + 1]) * t];
    };
    for (const sideSign of [1, -1]) {
      // A row keeps one depth and building line along a street side.
      const rowHash = vary(p[0], p[1], sideSign > 0 ? 14020 : 14021);
      let s = 4;
      while (s < total - 4 && out.buildings.length < MAX_BUILDINGS) {
        // The street's way here: along the chord a few metres either side.
        const [fx, fy] = pointAt(s);
        const [gx, gy] = pointAt(Math.min(total, s + 6));
        const len = Math.hypot(gx - fx, gy - fy) || 1;
        const ux = (gx - fx) / len;
        const uy = (gy - fy) / len;
        const probe = zoneAt(fx - uy * sideSign * (w.width / 2 + PAVEMENT + 6), fy + ux * sideSign * (w.width / 2 + PAVEMENT + 6));
        const label = probe < 0 ? undefined : LABELS[z.label[probe]];
        const f = label && FRONTAGE[label];
        if (!f || !label) {
          s += 6;
          continue;
        }
        const level = z.level[probe];
        const at = (r: [number, number]) => r[0] + (r[1] - r[0]) * level;
        const row = f.width[1] === 0;
        const lot = row ? Math.max(at(f.lot), ROW_LOT_MM / c.mmPerMetre) : at(f.lot);
        if (s + lot > total - 4) break;
        const [ax, ay] = pointAt(s);
        const [bx, by] = pointAt(s + lot);
        const chord = Math.hypot(bx - ax, by - ay);
        // Where the street bends sharply under a plot, there is no room for one.
        if (chord < lot * 0.9) {
          s += lot;
          continue;
        }
        const cx0 = (bx - ax) / chord;
        const cy0 = (by - ay) / chord;
        const nx = -cy0 * sideSign;
        const ny = cx0 * sideSign;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const r = (salt: number) => vary(mx, my, salt);
        const depth = at(f.depth) + (row ? 2 * rowHash : 2 * r(14023));
        const back = w.width / 2 + PAVEMENT + at(f.back) * (row ? 1 : 0.7 + 0.6 * r(14024));
        let q: number[];
        if (row) {
          // Rows are cut square to the street at each end, so on a bend neighbours share the cut
          // line and fan apart rather than overlap.
          const normal = (d: number): [number, number] => {
            const [p0x, p0y] = pointAt(Math.max(0, d - 3));
            const [p1x, p1y] = pointAt(Math.min(total, d + 3));
            const l = Math.hypot(p1x - p0x, p1y - p0y) || 1;
            return [(-(p1y - p0y) / l) * sideSign, ((p1x - p0x) / l) * sideSign];
          };
          const [n0x, n0y] = normal(s);
          const [n1x, n1y] = normal(s + lot);
          q = [ax + n0x * back, ay + n0y * back, bx + n1x * back, by + n1y * back, bx + n1x * (back + depth), by + n1y * (back + depth), ax + n0x * (back + depth), ay + n0y * (back + depth)];
        } else {
          const width = Math.min(chord - 2, at(f.width) + 2 * (r(14022) - 0.5));
          const s0 = (chord - width) / 2;
          const fr = [ax + cx0 * s0 + nx * back, ay + cy0 * s0 + ny * back, ax + cx0 * (s0 + width) + nx * back, ay + cy0 * (s0 + width) + ny * back];
          q = [...fr, fr[2] + nx * depth, fr[3] + ny * depth, fr[0] + nx * depth, fr[1] + ny * depth];
        }
        // Corners counter-clockwise, still starting on the street side.
        if (ringArea(q) < 0) q = [q[2], q[3], q[0], q[1], q[6], q[7], q[4], q[5]];
        const [qx, qy] = [(q[0] + q[4]) / 2, (q[1] + q[5]) / 2];
        if (inBox(qx, qy, MARGIN) && free(q, z.label[probe])) {
          const [lo, hi] = STOREYS[label] ?? [1, 2];
          const st = Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * level + (r(14025) - 0.5) * 0.9)));
          const warm = z.warmth[probe];
          const roof = label === 'works' ? (r(14026) < warm ? 'sawtooth' : 'flat') : label === 'towers' || r(14027) >= warm ? 'flat' : undefined;
          const h = label === 'works' ? 6 + 2.5 * st : st * style.floor + (roof ? 0 : allowance(depth, style));
          const building = label === 'old' && st > 3 ? 'apartments' : label === 'works' && r(14028) < 0.4 ? 'warehouse' : f.building;
          if (add({ ring: q, h, building, roof })) occ.take(q, SHARED);
        }
        s += lot;
      }
    }
  }
}
