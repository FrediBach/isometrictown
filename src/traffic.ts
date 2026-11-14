import { car, newSolid, prism, type Build, type Solid } from './buildings';
import { at, measure } from './infra';
import type { Masks } from './nature';
import type { Paper } from './raster';
import { hash } from './rng';
import { LINEWORK } from './settings';
import { SHOP_POIS, type Town, type Way } from './tiles';

/*
 * Traffic: vehicles driving in their lanes, queues at traffic lights, and cars parked at the kerb.
 *
 * How busy a road is comes from two things: its class, and how built up the land around it is
 * (building cover and shops within a couple of hundred metres). A country lane carries the odd car,
 * the same class of road in a town centre carries a steady trickle; a motorway is busy anywhere.
 * Along each lane the gaps between vehicles are drawn at random around that mean, stretched and
 * squeezed in long waves so traffic bunches into platoons. Parking at the kerb only happens in town.
 */

/** Mean gap between vehicles in one lane, in metres: out in the country, and in a dense town. */
const GAP: Record<string, [number, number]> = {
  motorway: [55, 38],
  trunk: [90, 50],
  primary: [140, 45],
  secondary: [220, 60],
  tertiary: [380, 85],
  minor: [1100, 150],
  service: [2500, 600],
  busway: [500, 260],
};
/** Classes with traffic lights at their busier junctions, where queues form. */
const SIGNALS = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
/** How built up a street must be, from 0 to 1, before cars are parked along it. */
const PARK_FROM: Record<string, number> = { minor: 0.3, tertiary: 0.45, secondary: 0.55, primary: 0.7 };
/** Service roads that are someone's drive or a car park's aisle carry no through traffic. */
const PRIVATE = new Set(['driveway', 'parking_aisle', 'drive-through']);
const BUSES = new Set(['primary', 'secondary', 'tertiary']);
const TRUCKS: Record<string, number> = { motorway: 0.17, trunk: 0.14, primary: 0.06, secondary: 0.04 };

const CELL = 25;
const REACH = 100;

/** Building cover and shops around a point, as 0 (open country) to 1 (town centre). */
function urbanity(town: Town): (x: number, y: number) => number {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const w of town.ways)
    for (let i = 0; i < w.pts.length; i += 2) {
      x0 = Math.min(x0, w.pts[i]);
      x1 = Math.max(x1, w.pts[i]);
      y0 = Math.min(y0, w.pts[i + 1]);
      y1 = Math.max(y1, w.pts[i + 1]);
    }
  if (!(x1 > x0)) return () => 0;
  x0 -= REACH;
  y0 -= REACH;
  const nx = Math.ceil((x1 + REACH - x0) / CELL) + 1;
  const ny = Math.ceil((y1 + REACH - y0) / CELL) + 1;
  // Summed-area tables of built area and shop count, so any square around a point costs four reads.
  const area = new Float64Array((nx + 1) * (ny + 1));
  const shops = new Float64Array((nx + 1) * (ny + 1));
  const cell = (x: number, y: number) => {
    const i = Math.floor((x - x0) / CELL);
    const j = Math.floor((y - y0) / CELL);
    return i >= 0 && j >= 0 && i < nx && j < ny ? (j + 1) * (nx + 1) + i + 1 : -1;
  };
  for (const b of town.buildings) {
    if (b.min > 0) continue;
    const p = b.shape[0].pts;
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, n = p.length / 2; i < n; i++) {
      const j = (i + 1) % n;
      a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
      cx += p[i * 2];
      cy += p[i * 2 + 1];
    }
    const c = cell(cx / (p.length / 2), cy / (p.length / 2));
    if (c >= 0) area[c] += Math.abs(a) / 2;
  }
  for (const q of town.pois) {
    if (!SHOP_POIS.has(q.cls)) continue;
    const c = cell(q.x, q.y);
    if (c >= 0) shops[c]++;
  }
  for (const t of [area, shops])
    for (let j = 1; j <= ny; j++)
      for (let i = 1; i <= nx; i++) t[j * (nx + 1) + i] += t[(j - 1) * (nx + 1) + i] + t[j * (nx + 1) + i - 1] - t[(j - 1) * (nx + 1) + i - 1];
  const r = Math.round(REACH / CELL);
  const sum = (t: Float64Array, i: number, j: number) => {
    const a0 = Math.max(0, i - r);
    const b0 = Math.max(0, j - r);
    const a1 = Math.min(nx, i + r + 1);
    const b1 = Math.min(ny, j + r + 1);
    return t[b1 * (nx + 1) + a1] - t[b0 * (nx + 1) + a1] - t[b1 * (nx + 1) + a0] + t[b0 * (nx + 1) + a0];
  };
  const box = (2 * r + 1) * CELL * ((2 * r + 1) * CELL);
  return (x, y) => {
    const i = Math.floor((x - x0) / CELL);
    const j = Math.floor((y - y0) / CELL);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return 0;
    const cover = sum(area, i, j) / box;
    const u = Math.max((cover - 0.04) / 0.22, sum(shops, i, j) / 10);
    return Math.max(0, Math.min(1, u));
  };
}

type Kind = 'car' | 'bus' | 'truck';

/** Length of a vehicle, bumper to bumper. */
function length(kind: Kind, k: number): number {
  if (kind === 'bus') return 12;
  if (kind === 'truck') return 10.5 + k * 5.5;
  return k > 0.85 ? 5.2 : 4.4;
}

function box(B: Build, s: Solid, x: number, y: number, ux: number, uy: number, a0: number, a1: number, hw: number, z0: number, z1: number): number[] {
  const vx = -uy;
  const vy = ux;
  const pts = [x + ux * a0 - vx * hw, y + uy * a0 - vy * hw, x + ux * a1 - vx * hw, y + uy * a1 - vy * hw, x + ux * a1 + vx * hw, y + uy * a1 + vy * hw, x + ux * a0 + vx * hw, y + uy * a0 + vy * hw];
  prism(B, [{ pts, seam: new Uint8Array(4) }], z0, z1, { roof: true, windows: false, pen: LINEWORK }, s);
  return pts;
}

/** A vehicle centred on x, y with its front towards ux, uy. */
function vehicle(B: Build, x: number, y: number, ux: number, uy: number, kind: Kind, k: number): Solid {
  if (kind === 'car') return car(B, x, y, ux, uy, k);
  const s = newSolid();
  const L = length(kind, k) / 2;
  if (kind === 'bus') {
    const body = box(B, s, x, y, ux, uy, -L, L, 1.25, 0, 3.0);
    box(B, s, x, y, ux, uy, -L * 0.4, L * 0.15, 0.8, 3.0, 3.3);
    s.casts.push({ ring: body, h: 3.0 });
  } else {
    // A cab up front, a short gap, and a tall box trailer behind it.
    const cab = box(B, s, x, y, ux, uy, L - 2.3, L, 1.2, 0, 3.0);
    const trailer = box(B, s, x, y, ux, uy, -L, L - 2.7, 1.25, 0, 3.9);
    s.casts.push({ ring: cab, h: 3.0 }, { ring: trailer, h: 3.9 });
  }
  return s;
}

/** One lane: its offset from the centre line (along the way's left normal) and direction (+1 along the way). */
type Lane = { o: number; dir: 1 | -1; outer: boolean };

function lanes(B: Build, w: Way, park: boolean): Lane[] {
  const hw = w.width / 2;
  // Which side of the centre line traffic in a direction keeps to, along the left normal.
  const side = (dir: 1 | -1) => (B.left ? dir : -dir);
  const big = w.cls === 'motorway' || w.cls === 'trunk';
  const out: Lane[] = [];
  if (w.oneway) {
    const dir = w.oneway;
    const n = big ? Math.max(2, Math.floor((w.width - 1.5) / 3.6)) : w.width >= 12 ? 2 : 1;
    // Measured from the kerb on the driving side, leaving room for parked cars there.
    const e0 = 0.7 + (park ? 2.2 : 0);
    const e1 = w.width - 0.7;
    const lw = (e1 - e0) / n;
    for (let i = 0; i < n; i++) out.push({ o: side(dir) * (hw - (e0 + (i + 0.5) * lw)), dir, outer: i === 0 });
    return out;
  }
  const n = big ? Math.max(1, Math.floor((hw - 0.5) / 3.4)) : 1;
  const inner = 0.3;
  const kerb = hw - 0.4 - (park ? 2.2 : 0);
  const lw = (kerb - inner) / n;
  for (const dir of [1, -1] as const) for (let i = 0; i < n; i++) out.push({ o: side(dir) * (kerb - (i + 0.5) * lw), dir, outer: i === 0 });
  return out;
}

const GRID = 20;

/**
 * Whether a vehicle on way w at x, y would stand on another road's surface: across a side street's
 * mouth, or on a road that crosses w without the two being split into a junction there. Parked cars
 * keep clear of every road, driving ones only of roads at least as wide as their own. Pieces of the
 * same road that simply continue each other don't count, and roads on bridges are on another level.
 */
function roadSurfaces(ways: Way[], degree: Map<string, number>, key: (x: number, y: number) => string): (w: Way, x: number, y: number, parked: boolean) => boolean {
  const roads = ways.filter((w) => w.kind === 'road' && !w.bridge);
  const cells = new Map<string, number[]>();
  roads.forEach((w, wi) => {
    const p = w.pts;
    const r = w.width / 2 + 1;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const i0 = Math.floor((Math.min(p[i], p[i + 2]) - r) / GRID);
      const i1 = Math.floor((Math.max(p[i], p[i + 2]) + r) / GRID);
      const j0 = Math.floor((Math.min(p[i + 1], p[i + 3]) - r) / GRID);
      const j1 = Math.floor((Math.max(p[i + 1], p[i + 3]) + r) / GRID);
      for (let a = i0; a <= i1; a++)
        for (let b = j0; b <= j1; b++) {
          const c = `${a},${b}`;
          const list = cells.get(c);
          if (list) list.push(wi, i);
          else cells.set(c, [wi, i]);
        }
    }
  });
  const ends = (w: Way) => [key(w.pts[0], w.pts[1]), key(w.pts[w.pts.length - 2], w.pts[w.pts.length - 1])];
  /** Two pieces of one road meeting end to end, with nothing else joining there. */
  const continues = (a: Way, b: Way) => {
    if (a.cls !== b.cls) return false;
    const eb = ends(b);
    return ends(a).some((k) => eb.includes(k) && degree.get(k) === 2);
  };
  return (w, x, y, parked) => {
    if (w.bridge) return false;
    const list = cells.get(`${Math.floor(x / GRID)},${Math.floor(y / GRID)}`);
    if (!list) return false;
    for (let n = 0; n < list.length; n += 2) {
      const o = roads[list[n]];
      if (o === w || (!parked && o.width < w.width)) continue;
      const p = o.pts;
      const i = list[n + 1];
      const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
      const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2));
      if (Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y) < o.width / 2 + 0.6 && !continues(w, o)) return true;
    }
    return false;
  };
}

/** Vehicles on the roads: driving, waiting at lights, and parked in town. */
export function traffic(B: Build, paper: Paper, town: Town, M: Masks): Solid[] {
  const { set, cam } = B;
  const out: Solid[] = [];
  if (set.cars <= 0) return out;
  const urban = urbanity(town);
  // The slider scales traffic around its default; at small scales vehicles turn into blobs, so fewer.
  const amount = (set.cars / 0.35) * (cam.s >= 1 ? 1 : cam.s >= 0.5 ? 0.6 : 0.3);
  const key = (x: number, y: number) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
  const degree = new Map<string, number>();
  for (const w of town.ways) {
    if (w.kind !== 'road') continue;
    for (const k of [key(w.pts[0], w.pts[1]), key(w.pts[w.pts.length - 2], w.pts[w.pts.length - 1])]) degree.set(k, (degree.get(k) ?? 0) + 1);
  }
  const junction = (x: number, y: number) => (degree.get(key(x, y)) ?? 0) >= 3;

  const fits = (w: Way, x: number, y: number) => {
    const sx = cam.sx(x, y);
    const sy = cam.sy(x, y, 0);
    if (sy < paper.y0 - 2 || sy > paper.y1 + 8 || sx < paper.x0 - 8 || sx > paper.x1 + 8) return false;
    return paper.on(M.road, sx, sy) && !paper.on(M.foot, sx, sy) && (w.bridge || !paper.on(M.water, sx, sy));
  };
  const crossing = roadSurfaces(town.ways, degree, key);
  const put = (w: Way, x: number, y: number, ux: number, uy: number, kind: Kind, k: number, parked = false) => {
    if (fits(w, x, y) && !crossing(w, x, y, parked)) out.push(vehicle(B, x, y, ux, uy, kind, k));
  };

  for (const w of town.ways) {
    const gaps = GAP[w.cls];
    if (w.kind !== 'road' || !gaps || PRIVATE.has(w.service ?? '')) continue;
    const p = w.pts;
    const cum = measure(p);
    const L = cum[cum.length - 1];
    if (L < 6) continue;
    const [mx, my] = at(p, cum, L / 2);
    const uw = urban(mx, my);
    const park = PARK_FROM[w.cls] !== undefined && uw > PARK_FROM[w.cls] && w.width >= 8;
    const j0 = junction(p[0], p[1]);
    const j1 = junction(p[p.length - 2], p[p.length - 1]);
    const hw = w.width / 2;

    // Parked cars, nose in the direction traffic runs on their side of the street.
    if (park) {
      const sides: number[] = w.oneway ? (w.width >= 10 ? [1, -1] : [B.left ? w.oneway : -w.oneway]) : [1, -1];
      const off = hw - 1.05;
      for (let t = 9; t <= L - 9; t += 6.3) {
        const [x, y, ux, uy] = at(p, cum, t);
        for (const s of sides) {
          const cx = x - uy * s * off;
          const cy = y + ux * s * off;
          // Parking comes in stretches, broken by driveways, loading bays and bus stops.
          const [sa, sb] = B.key(Math.round(cx / 40) * 40, Math.round(cy / 40) * 40);
          if (hash(sa, sb, set.seed, 474 + s) < 0.4) continue;
          const [ka, kb] = B.key(cx, cy);
          const chance = Math.min(0.85, set.cars * 1.8) * Math.min(1, (urban(cx, cy) - PARK_FROM[w.cls] + 0.15) / 0.4);
          if (hash(ka, kb, set.seed, 470 + s) >= chance) continue;
          const dir = w.oneway ?? (B.left ? s : -s);
                    put(w, cx, cy, ux * dir, uy * dir, 'car', hash(ka, kb, set.seed, 472), true);
        }
      }
    }

    const all = lanes(B, w, park);
    next: for (let li = 0; li < all.length; li++) {
      const lane = all[li];
      // Distance travelled, tau, runs from where this lane's traffic enters the way.
      const pos = (tau: number) => {
        const t = lane.dir === 1 ? tau : L - tau;
        const [x, y, ux, uy] = at(p, cum, t);
        return [x - uy * lane.o, y + ux * lane.o, ux * lane.dir, uy * lane.dir] as const;
      };
      const enters = lane.dir === 1 ? j0 : j1;
      const leaves = lane.dir === 1 ? j1 : j0;
      const start = enters ? 7 : 0.5;
      let end = L - (leaves ? 8.5 : 0.5);
      const choose = (x: number, y: number, salt: number): [Kind, number] => {
        const [ka, kb] = B.key(x, y);
        const v = hash(ka, kb, set.seed, salt);
        const k = hash(ka, kb, set.seed, salt + 1);
        if (w.cls === 'busway') return ['bus', k];
        if (lane.outer && BUSES.has(w.cls) && urban(x, y) > 0.35 && v < 0.035) return ['bus', k];
        if (lane.outer && v > 1 - (TRUCKS[w.cls] ?? 0) * (1.2 - urban(x, y) * 0.6)) return ['truck', k];
        return ['car', k];
      };

      // A queue at a red light where a busier road meets a junction in town.
      if (leaves && SIGNALS.has(w.cls) && uw > 0.3 && L > 30) {
        const [qx, qy] = pos(end);
        const [ka, kb] = B.key(Math.round(qx / 4) * 4, Math.round(qy / 4) * 4);
        if (hash(ka, kb, set.seed, 450 + (lane.dir === 1 ? 0 : 1)) < 0.45) {
          let n = 1 + Math.floor(hash(ka, kb, set.seed, 452 + li) * (1 + 3 * uw) * Math.min(1.5, amount));
          let front = end;
          while (n-- > 0) {
            const [x0, y0] = pos(front - 3);
            const [kind, k] = choose(x0, y0, 454);
            const len = length(kind, k);
            if (front - len < start + 2) break;
            const [x, y, ux, uy] = pos(front - len / 2);
            put(w, x, y, ux, uy, kind, k);
            const [ga, gb] = B.key(x, y);
            front -= len + 1.3 + hash(ga, gb, set.seed, 456) * 1.4;
          }
          end = front - 6;
        }
      }

      // Free-flowing traffic up to the queue, if there is one.
      const [a, b] = gaps;
      const mean = (a + (b - a) * uw) / Math.max(0.05, amount);
      let tau = start;
      {
        const [x, y] = pos(start);
        const [ka, kb] = B.key(x, y);
        tau += hash(ka, kb, set.seed, 458 + li) * Math.min(mean, L);
      }
      for (let guard = 0; guard < 400; guard++) {
        const [x0, y0] = pos(tau);
        const [kind, k] = choose(x0, y0, 460);
        const len = length(kind, k);
        if (tau + len > end) continue next;
        const [x, y, ux, uy] = pos(tau + len / 2);
                put(w, x, y, ux, uy, kind, k);
        // Exponential gaps, stretched or squeezed by a slow wave along the road, so vehicles bunch.
        const [ka, kb] = B.key(x, y);
        const [wa, wb] = B.key(Math.round(x / 150) * 150, Math.round(y / 150) * 150);
        const wave = 0.35 + 1.4 * hash(wa, wb, set.seed, 464);
        tau += len + 5 + -Math.log(1 - hash(ka, kb, set.seed, 462) * 0.999) * mean * wave;
      }
    }
  }
  return out;
}
