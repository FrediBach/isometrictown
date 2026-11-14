import { car, newSolid, prism, type Build, type Solid } from './buildings';
import { pointInRing, ringArea } from './geo';
import type { Masks } from './nature';
import type { Paper, Test } from './raster';
import { hash } from './rng';
import { LINEWORK, ROOFS, SHADOWS } from './settings';
import { bestRect } from './shape';
import { curbs, groundSeg, outline, shifted, walk } from './streets';
import type { Lift, Town, Way } from './tiles';

/**
 * Things that come with the transport network: cable cars and ski lifts, ferries, tunnel
 * portals, airfields with their planes, road markings and parking bays. Each part returns
 * the solids it adds (for the depth buffer) and a draw step for the line pass.
 */
export type Extra = { solids: Solid[]; draw: (paper: Paper) => void };

const none: Extra = { solids: [], draw: () => {} };

/** Cumulative lengths along a polyline. */
export function measure(p: number[]): Float64Array {
  const n = p.length / 2;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
  return cum;
}

/** Position and direction at distance t along a polyline. */
export function at(p: number[], cum: Float64Array, t: number): [number, number, number, number] {
  const n = cum.length;
  let i = 1;
  while (i < n - 1 && cum[i] < t) i++;
  const l = cum[i] - cum[i - 1] || 1;
  const ux = (p[i * 2] - p[i * 2 - 2]) / l;
  const uy = (p[i * 2 + 1] - p[i * 2 - 1]) / l;
  const d = t - cum[i - 1];
  return [p[i * 2 - 2] + ux * d, p[i * 2 - 1] + uy * d, ux, uy];
}

/** A polygon given in a local frame (a along u, b across it) as a world ring. */
export function place(x: number, y: number, ux: number, uy: number, local: number[][]): number[] {
  const vx = -uy;
  const vy = ux;
  return local.flatMap(([a, b]) => [x + ux * a + vx * b, y + uy * a + vy * b]);
}

export function slab(B: Build, out: Solid, ring: number[], z0: number, z1: number, pen = LINEWORK): void {
  // prism wants counter-clockwise rings.
  const pts = ringArea(ring) < 0 ? reverse(ring) : ring;
  prism(B, [{ pts, seam: new Uint8Array(pts.length / 2) }], z0, z1, { roof: true, windows: false, pen }, out);
}

function reverse(ring: number[]): number[] {
  const out: number[] = [];
  for (let i = ring.length - 2; i >= 0; i -= 2) out.push(ring[i], ring[i + 1]);
  return out;
}

export function rect(a0: number, a1: number, b0: number, b1: number): number[][] {
  return [
    [a0, b0],
    [a1, b0],
    [a1, b1],
    [a0, b1],
  ];
}

/** Is a ground point on a mask? Points are in local metres. */
export function onMask(paper: Paper, mask: Uint8Array, x: number, y: number): boolean {
  return paper.on(mask, paper.cam.sx(x, y), paper.cam.sy(x, y, 0));
}

// ---------------------------------------------------------------- Lifts

type LiftSpec = { span: number; h: number; twin: number; carrier: 'cabin' | 'car' | 'chair' | 'bar' };
const GONDOLA: LiftSpec = { span: 90, h: 16, twin: 2.6, carrier: 'cabin' };
const CHAIR: LiftSpec = { span: 55, h: 10, twin: 2.4, carrier: 'chair' };
const DRAG: LiftSpec = { span: 40, h: 6.5, twin: 0, carrier: 'bar' };
const LIFTS: Record<string, LiftSpec> = {
  cable_car: { span: 220, h: 28, twin: 3.2, carrier: 'car' },
  gondola: GONDOLA,
  mixed_lift: GONDOLA,
  chair_lift: CHAIR,
  drag_lift: DRAG,
  't-bar': DRAG,
  'j-bar': DRAG,
  platter: DRAG,
  rope_tow: { span: 30, h: 2.5, twin: 0, carrier: 'bar' },
};

/** Cable cars, gondolas, chair lifts and drag lifts: pylons, sagging cables and what hangs from them. */
export function lifts(B: Build, town: Town): Extra {
  if (!B.set.rails || !town.lifts.length) return none;
  const solids: Solid[] = [];
  const lines: number[][] = [];
  const stations = town.pois.filter((p) => p.cls === 'aerialway');
  const nearStation = (x: number, y: number) => stations.some((p) => Math.hypot(p.x - x, p.y - y) < 40);
  for (const lift of town.lifts) one(B, lift, nearStation, solids, lines);
  return { solids, draw: (paper) => lines.forEach((l) => paper.line3(LINEWORK, l)) };
}

function one(B: Build, lift: Lift, nearStation: (x: number, y: number) => boolean, solids: Solid[], lines: number[][]): void {
  const spec = LIFTS[lift.cls];
  if (!spec) return;
  const p = lift.pts;
  const cum = measure(p);
  const L = cum[cum.length - 1];
  if (L < 20) return;
  const n = Math.max(1, Math.round(L / spec.span));
  const ends = [nearStation(p[0], p[1]), nearStation(p[p.length - 2], p[p.length - 1])];
  const STATION_Z = 4.5;
  // Supports: the two ends (a station, or the cable running on past the edge) and the pylons between.
  const sup: [number, number][] = [[0, ends[0] ? STATION_Z : spec.h]];
  for (let k = 0; k < n; k++) sup.push([((k + 0.5) * L) / n, spec.h]);
  sup.push([L, ends[1] ? STATION_Z : spec.h]);
  const z = (t: number) => {
    let k = 1;
    while (k < sup.length - 1 && sup[k][0] < t) k++;
    const [ta, za] = sup[k - 1];
    const [tb, zb] = sup[k];
    const u = (t - ta) / (tb - ta || 1);
    const sag = Math.min(0.035 * (tb - ta), 0.35 * Math.min(za, zb));
    return za + (zb - za) * u - sag * 4 * u * (1 - u);
  };
  const offs = spec.twin ? [-spec.twin / 2, spec.twin / 2] : [0];
  for (const o of offs) {
    const pts: number[] = [];
    const m = Math.ceil(L / 3);
    for (let i = 0; i <= m; i++) {
      const t = (L * i) / m;
      const [x, y, ux, uy] = at(p, cum, t);
      pts.push(x - uy * o, y + ux * o, z(t));
    }
    lines.push(pts);
  }
  // Pylons: a mast with a crossbar carrying the cables.
  for (let k = 1; k < sup.length - 1; k++) {
    const [x, y, ux, uy] = at(p, cum, sup[k][0]);
    const top = sup[k][1];
    const w = spec.twin / 2 + 0.7;
    lines.push([x, y, 0, x, y, top + 0.4]);
    if (spec.twin) lines.push([x + uy * w, y - ux * w, top, x - uy * w, y + ux * w, top]);
    else lines.push([x, y, top, x - uy * 0.9, y + ux * 0.9, top]);
  }
  // Stations: a hall the cable runs into.
  for (const t of [0, L]) {
    if (!ends[t ? 1 : 0]) continue;
    const [x, y, ux, uy] = at(p, cum, t);
    const s = newSolid();
    const hall = place(x, y, ux, uy, rect(-6, 6, -spec.twin / 2 - 3, spec.twin / 2 + 3));
    slab(B, s, hall, 0, STATION_Z + 1.2);
    s.casts.push({ ring: hall, h: STATION_Z + 1.2 });
    solids.push(s);
  }
  // What hangs from the cable.
  const [k0, k1] = B.key(p[0], p[1]);
  const gap = spec.carrier === 'cabin' ? 45 : spec.carrier === 'chair' ? 14 : spec.carrier === 'bar' ? 16 : L;
  offs.forEach((o, side) => {
    const phase = hash(k0, k1, B.set.seed, 400 + side) * gap;
    const list: number[] = spec.carrier === 'car' ? [L * (side ? 0.68 : 0.32)] : [];
    if (spec.carrier !== 'car') for (let t = phase + 8; t < L - 8; t += gap) list.push(t);
    for (const t of list) {
      const [cx, cy, ux, uy] = at(p, cum, t);
      const x = cx - uy * o;
      const y = cy + ux * o;
      const zc = z(t);
      if (spec.carrier === 'cabin' || spec.carrier === 'car') {
        const big = spec.carrier === 'car';
        const drop = big ? 4.2 : 3.2;
        const hh = big ? 2.6 : 1.9;
        const s = newSolid();
        slab(B, s, place(x, y, ux, uy, big ? rect(-2.8, 2.8, -1.6, 1.6) : rect(-0.9, 0.9, -0.9, 0.9)), zc - drop, zc - drop + hh);
        solids.push(s);
        lines.push([x, y, zc, x, y, zc - drop + hh]);
      } else if (spec.carrier === 'chair') {
        // Hanger, seat and back, facing along the way it travels.
        const f = side ? 1 : -1;
        const sx = ux * f * 0.5;
        const sy = uy * f * 0.5;
        lines.push([x, y, zc, x, y, zc - 2.0, x + sx, y + sy, zc - 2.0, x + sx, y + sy, zc - 1.6]);
        lines.push([x - uy * 0.7, y + ux * 0.7, zc - 2.0, x + uy * 0.7, y - ux * 0.7, zc - 2.0]);
      } else {
        lines.push([x, y, zc, x, y, zc - 1.8]);
        lines.push([x - uy * 0.5, y + ux * 0.5, zc - 1.8, x + uy * 0.5, y - ux * 0.5, zc - 1.8]);
      }
    }
  });
}

// ---------------------------------------------------------------- Boats

/** A boat pointing along (ux, uy): a hull with a pointed bow and a cabin. */
export function boat(B: Build, x: number, y: number, ux: number, uy: number, len: number, beam: number): Solid {
  const s = newSolid();
  const h = Math.max(0.6, len * 0.05);
  const hb = beam / 2;
  const hull = place(x, y, ux, uy, [
    [-len / 2, -hb * 0.85],
    [len / 4, -hb],
    [len / 2, 0],
    [len / 4, hb],
    [-len / 2, hb * 0.85],
  ]);
  slab(B, s, hull, 0, h);
  const top = h + Math.max(1.0, len * 0.06);
  slab(B, s, place(x, y, ux, uy, rect(-len * 0.32, len * 0.08, -hb * 0.6, hb * 0.6)), h, top);
  if (len > 15) slab(B, s, place(x, y, ux, uy, rect(-len * 0.24, -len * 0.04, -hb * 0.45, hb * 0.45)), top, top + 1.8);
  s.casts.push({ ring: hull, h: top });
  return s;
}

/** Ferry routes: a dotted line across the water, with the ferry somewhere along it. */
export function ferries(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  if (!B.set.water || !town.ferries.length) return none;
  const solids: Solid[] = [];
  for (const f of town.ferries) {
    const cum = measure(f);
    const L = cum[cum.length - 1];
    if (L < 120) continue;
    const [k0, k1] = B.key(f[0], f[1]);
    const [x, y, ux, uy] = at(f, cum, L * (0.3 + 0.4 * hash(k0, k1, B.set.seed, 410)));
    if (!onMask(paper, M.water, x, y)) continue;
    solids.push(boat(B, x, y, ux, uy, 30, 9));
  }
  const s = B.cam.s;
  const dash = 0.7 / s;
  const period = dash + 1.1 / s;
  const test: Test = (x, y, d) => paper.on(M.water, x, y) && !paper.on(M.road, x, y) && paper.seen(x, y, d);
  return {
    solids,
    draw: () => {
      for (const f of town.ferries)
        walk(f, 0, period, dash, (x, y, ux, uy) => {
          groundSeg(paper, LINEWORK, x, y, x + ux * dash, y + uy * dash, test);
          paper.end();
        });
    },
  };
}

/**
 * Boats moored along quays: where open water meets a street or a building, and all along
 * the water's edge near a harbour.
 */
export function moorings(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  if (!B.set.water || B.cam.s < 0.25) return none;
  const harbours = town.pois.filter((p) => p.cls === 'harbor');
  const solids: Solid[] = [];
  const water = (x: number, y: number) => onMask(paper, M.water, x, y) && !onMask(paper, M.pool, x, y);
  for (const shape of town.water)
    for (const ring of shape) {
      const p = ring.pts;
      const n = p.length / 2;
      for (let e = 0; e < n; e++) {
        if (ring.seam[e]) continue;
        const f = (e + 1) % n;
        const ax = p[e * 2];
        const ay = p[e * 2 + 1];
        const len = Math.hypot(p[f * 2] - ax, p[f * 2 + 1] - ay);
        if (len < 9) continue;
        const ux = (p[f * 2] - ax) / len;
        const uy = (p[f * 2 + 1] - ay) / len;
        for (let t = 4.5; t < len - 4.5; t += 9) {
          const x = ax + ux * t;
          const y = ay + uy * t;
          // Which side is the water?
          let nx = -uy;
          let ny = ux;
          if (!water(x + nx * 3, y + ny * 3)) {
            nx = -nx;
            ny = -ny;
          }
          if (!water(x + nx * 3, y + ny * 3) || water(x - nx * 2.5, y - ny * 2.5)) continue;
          const harbour = harbours.some((h) => Math.hypot(h.x - x, h.y - y) < 250);
          const quay = onMask(paper, M.road, x - nx * 2.5, y - ny * 2.5) || onMask(paper, M.foot, x - nx * 2.5, y - ny * 2.5);
          if (!harbour && !quay) continue;
          const [k0, k1] = B.key(x, y);
          const h = (salt: number) => hash(k0, k1, B.set.seed, 450 + salt);
          if (h(0) > (harbour ? 0.7 : 0.5)) continue;
          const bl = 5.5 + h(1) * 2.5;
          const beam = 2.1 + h(2) * 0.8;
          const cx = x + nx * (beam / 2 + 0.6);
          const cy = y + ny * (beam / 2 + 0.6);
          if (!water(cx + ux * bl * 0.5, cy + uy * bl * 0.5) || !water(cx - ux * bl * 0.5, cy - uy * bl * 0.5) || !water(cx + nx * beam, cy + ny * beam)) continue;
          const f2 = h(3) < 0.5 ? 1 : -1;
          solids.push(boat(B, cx, cy, ux * f2, uy * f2, bl, beam));
        }
      }
    }
  return { solids, draw: () => {} };
}

/** Small closed loops of road: roundabouts, whose middles are planted. */
export function roundabouts(town: Town): { islands: Town['green']; centres: [number, number][] } {
  const islands: Town['green'] = [];
  const centres: [number, number][] = [];
  for (const w of town.ways) {
    const p = w.pts;
    if (w.kind !== 'road' || p.length < 8) continue;
    if (Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]) > 0.5) continue;
    const ring = p.slice(0, -2);
    const area = Math.abs(ringArea(ring));
    if (area < 30 || area > 3000) continue;
    islands.push([{ pts: ringArea(ring) > 0 ? ring : reverse(ring), seam: new Uint8Array(ring.length / 2) }]);
    // A tree in the middle when there's room for one beyond the carriageway.
    if (Math.sqrt(area / Math.PI) - w.width / 2 > 3) {
      let x = 0;
      let y = 0;
      for (let i = 0; i < ring.length; i += 2) {
        x += ring[i];
        y += ring[i + 1];
      }
      centres.push([x / (ring.length / 2), y / (ring.length / 2)]);
    }
  }
  return { islands, centres };
}

// ---------------------------------------------------------------- Bridges

/** How far below the deck the water is drawn, and the deck's thickness, in metres. */
const WATER_DROP = 5;
const DECK = 0.9;
const BEAM_ROADS = new Set(['motorway', 'trunk', 'primary']);

/**
 * Bridges over water: the side of the deck facing the viewer, carried on arches (short
 * bridges) or on piers (long ones). The water sits notionally below the deck, so the arches
 * hang down over it; waves keep out from behind them.
 */
export function bridges(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  if (B.cam.s < 0.25) return none;
  const [upx, upy] = B.cam.up;
  const lines: number[][] = [];
  for (const w of town.ways) {
    if (!w.bridge) continue;
    const p = w.pts;
    const cum = measure(p);
    const L = cum[cum.length - 1];
    const hw = (w.kind === 'path' ? 2 : w.kind === 'rail' ? 2.5 : w.width / 2) + 0.3;
    // Railways and big roads cross on beams and piers; everything else on masonry arches.
    const beams = w.kind === 'rail' || BEAM_ROADS.has(w.cls) || w.sub === 'pier';
    // Runs of the bridge that cross water.
    const runs: [number, number][] = [];
    let start = -1;
    for (let t = 0; t <= L + 1e-6; t += 1) {
      const [x, y] = at(p, cum, Math.min(t, L));
      const wet = onMask(paper, M.water, x, y) && !onMask(paper, M.pool, x, y);
      if (wet && start < 0) start = t;
      if ((!wet || t + 1 > L) && start >= 0) {
        if (t - start >= 6) runs.push([Math.max(0, start - 1), Math.min(L, t + 1)]);
        start = -1;
      }
    }
    for (const [t0, t1] of runs) {
      const len = t1 - t0;
      const [, , mux, muy] = at(p, cum, (t0 + t1) / 2);
      // The side facing the viewer.
      const side = -muy * upx + mux * upy < 0 ? 1 : -1;
      const edge = (t: number, z: number) => {
        const [x, y, ux, uy] = at(p, cum, t);
        return [x - uy * hw * side, y + ux * hw * side, z];
      };
      const arched = w.sub !== 'pier' && (!beams || len <= 60);
      const n = Math.max(1, Math.round(len / (arched ? 16 : w.sub === 'pier' ? 4 : 32)));
      const span = len / n;
      const pier = arched ? 1.6 : w.sub === 'pier' ? 0.3 : 2.2;
      const under = (t: number) => {
        if (!arched) return -DECK - 0.6;
        const k = Math.min(n - 1, Math.floor((t - t0) / span));
        const a = t0 + k * span + (k > 0 ? pier / 2 : 0);
        const b = t0 + (k + 1) * span - (k < n - 1 ? pier / 2 : 0);
        if (t <= a || t >= b) return -WATER_DROP;
        const u = Math.sin((Math.PI * (t - a)) / (b - a));
        return -WATER_DROP + (WATER_DROP - DECK) * Math.pow(u, 0.6);
      };
      const top: number[] = [];
      const soffit: number[] = [];
      const fascia: number[] = [];
      for (let t = t0; t <= t1 + 1e-6; t += 0.5) {
        const tt = Math.min(t, t1);
        top.push(...edge(tt, 0));
        fascia.push(...edge(tt, -DECK));
        soffit.push(...edge(tt, under(tt)));
      }
      const back: number[] = [];
      for (let i = soffit.length - 3; i >= 0; i -= 3) back.push(soffit[i], soffit[i + 1], soffit[i + 2]);
      paper.fillMask3(M.under, [[...top, ...back]]);
      lines.push(fascia);
      if (arched) lines.push(soffit);
      // Piers standing in the water.
      for (let k = 1; k < n; k++) {
        const t = t0 + k * span;
        for (const d of [-pier / 2, pier / 2]) lines.push([...edge(t + d, arched ? -WATER_DROP : -DECK - 0.6), ...edge(t + d, -WATER_DROP - (arched ? 0 : 0.4))]);
        lines.push([...edge(t - pier / 2, -WATER_DROP), ...edge(t + pier / 2, -WATER_DROP)]);
      }
      if (!arched) {
        const beam: number[] = [];
        for (let t = t0; t <= t1 + 1e-6; t += 0.5) beam.push(...edge(Math.min(t, t1), -DECK - 0.6));
        lines.push(beam);
      }
    }
  }
  return { solids: [], draw: () => lines.forEach((l) => paper.line3(LINEWORK, l, (x, y) => paper.on(M.under, x, y) || paper.on(M.water, x, y))) };
}

// ---------------------------------------------------------------- Station platforms

/** Station platforms: a raised slab along the track, with a canopy on columns over the middle. */
export function platforms(B: Build, town: Town): Extra {
  const solids: Solid[] = [];
  if (!B.set.rails || B.cam.s < 0.2) return { solids, draw: () => {} };
  for (const w of town.ways) {
    if (w.kind !== 'path' || w.sub !== 'platform' || w.bridge) continue;
    const p = w.pts;
    const cum = measure(p);
    const L = cum[cum.length - 1];
    if (L < 15) continue;
    const s = newSolid();
    for (let i = 0; i + 3 < p.length; i += 2) {
      const l = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      if (l < 0.5) continue;
      const ux = (p[i + 2] - p[i]) / l;
      const uy = (p[i + 3] - p[i + 1]) / l;
      slab(B, s, place(p[i], p[i + 1], ux, uy, rect(0, l, -1.8, 1.8)), 0, 0.8);
    }
    // The canopy over the middle stretch, segment by segment so it follows a curve.
    const c0 = L * 0.25;
    const c1 = L * 0.75;
    for (let t = c0; t < c1; t += 10) {
      const t1 = Math.min(c1, t + 10);
      const [x0, y0] = at(p, cum, t);
      const [x1, y1] = at(p, cum, t1);
      const l = Math.hypot(x1 - x0, y1 - y0);
      if (l < 1) continue;
      const ux = (x1 - x0) / l;
      const uy = (y1 - y0) / l;
      slab(B, s, place(x0, y0, ux, uy, rect(0, l, -2.2, 2.2)), 3.6, 3.85, ROOFS);
      s.lines.push({ pen: LINEWORK, pts: [x0, y0, 0.8, x0, y0, 3.6] });
    }
    const [ex, ey] = at(p, cum, c1);
    s.lines.push({ pen: LINEWORK, pts: [ex, ey, 0.8, ex, ey, 3.6] });
    s.casts.push({ ring: place(...(at(p, cum, c0).slice(0, 2) as [number, number]), ...(at(p, cum, (c0 + c1) / 2).slice(2) as [number, number]), rect(0, c1 - c0, -2.2, 2.2)), h: 3.8 });
    solids.push(s);
  }
  return { solids, draw: () => {} };
}

// ---------------------------------------------------------------- Sailing

/**
 * Sailing boats out on open water, well clear of the shore. They all lean to the same
 * wind, which is the seed's.
 */
export function sailing(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const solids: Solid[] = [];
  const { cam, set } = B;
  if (!set.water || cam.s < 0.15 || !town.water.length) return { solids, draw: () => {} };
  const water = (x: number, y: number) => onMask(paper, M.water, x, y) && !onMask(paper, M.pool, x, y) && !onMask(paper, M.road, x, y);
  const wind = hash(set.seed, 7, 0, 470) * Math.PI * 2;
  const [x0, y0, x1, y1] = cam.region(0);
  const step = 70;
  for (let i = Math.floor(x0 / step); i <= Math.ceil(x1 / step); i++)
    for (let j = Math.floor(y0 / step); j <= Math.ceil(y1 / step); j++) {
      const [k0, k1] = B.key(i * step, j * step);
      const h = (k: number) => hash(k0, k1, set.seed, 480 + k);
      if (h(0) > 0.2) continue;
      const x = (i + 0.2 + 0.6 * h(1)) * step;
      const y = (j + 0.2 + 0.6 * h(2)) * step;
      // Open water all round.
      if (![0, 1, 2, 3, 4, 5, 6, 7].every((q) => water(x + Math.cos(q) * 22, y + Math.sin(q) * 22)) || !water(x, y)) continue;
      // Heading across the wind, either way.
      const head = wind + (h(3) < 0.5 ? 1 : -1) * (Math.PI / 2 + (h(4) - 0.5) * 0.8);
      const ux = Math.cos(head);
      const uy = Math.sin(head);
      const len = 6 + h(5) * 4;
      const s = boat(B, x, y, ux, uy, len, len * 0.33);
      // Mast, mainsail and jib, all bellied out to leeward.
      const lee = Math.sign(Math.sin(wind - head)) || 1;
      const mx = x + ux * len * 0.1;
      const my = y + uy * len * 0.1;
      const top = len * 1.3;
      const sx = -uy * lee * len * 0.12;
      const sy = ux * lee * len * 0.12;
      const main = [mx, my, top, mx, my, 1.4, mx - ux * len * 0.45 + sx, my - uy * len * 0.45 + sy, 1.4];
      const jib = [mx, my, top * 0.85, mx + ux * len * 0.45, my + uy * len * 0.45, 0.9, mx + sx * 0.6, my + sy * 0.6, 1.2];
      s.faces.push([main], [jib]);
      s.lines.push({ pen: LINEWORK, pts: main, closed: true }, { pen: LINEWORK, pts: jib, closed: true });
      solids.push(s);
    }
  return { solids, draw: () => {} };
}

// ---------------------------------------------------------------- Level crossings

/** Where a road crosses a railway on the level: barriers on both sides and a crossbuck sign. */
export function crossings(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const lines: { pen: number; pts: number[] }[] = [];
  if (!B.set.rails || B.cam.s < 0.35) return { solids: [], draw: () => {} };
  const rails = town.ways.filter((w) => w.kind === 'rail' && !w.bridge && w.sub !== 'tram' && w.sub !== 'subway');
  if (!rails.length) return { solids: [], draw: () => {} };
  const rs: number[] = [];
  for (const w of rails) for (let i = 0; i + 3 < w.pts.length; i += 2) rs.push(w.pts[i], w.pts[i + 1], w.pts[i + 2], w.pts[i + 3]);
  const done: [number, number][] = [];
  for (const w of town.ways) {
    if (w.kind !== 'road' || w.bridge || w.cls === 'motorway' || w.cls === 'trunk') continue;
    const p = w.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
      for (let k = 0; k < rs.length; k += 4) {
        const [cx, cy, dx, dy] = [rs[k], rs[k + 1], rs[k + 2], rs[k + 3]];
        const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
        const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
        // Level crossings share a node, so both segments may just end there: allow for rounding.
        if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) continue;
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t;
        // Several tracks at one crossing get one set of barriers.
        if (done.some(([qx, qy]) => Math.hypot(qx - x, qy - y) < 15)) continue;
        done.push([x, y]);
        const l = Math.hypot(bx - ax, by - ay);
        const ux = (bx - ax) / l;
        const uy = (by - ay) / l;
        const hw = w.width / 2;
        for (const side of [1, -1]) {
          // The barrier stands at the kerb before the tracks, its boom lowered across its half of the road.
          const back = 5.5;
          const px = x - ux * side * back - uy * side * (hw + 0.6);
          const py = y - uy * side * back + ux * side * (hw + 0.6);
          if (onMask(paper, M.foot, px, py)) continue;
          lines.push({ pen: LINEWORK, pts: [px, py, 0, px, py, 1.3] });
          const ex = px + uy * side * (hw + 0.4);
          const ey = py - ux * side * (hw + 0.4);
          lines.push({ pen: LINEWORK, pts: [px, py, 1.0, ex, ey, 1.0] });
          for (let f = 0.1; f < 0.95; f += 0.2) lines.push({ pen: ROOFS, pts: [px + (ex - px) * f, py + (ey - py) * f, 1.0, px + (ex - px) * (f + 0.1), py + (ey - py) * (f + 0.1), 1.0] });
          // The crossbuck on its own post.
          const sx = px - ux * side * 1.2;
          const sy = py - uy * side * 1.2;
          lines.push({ pen: LINEWORK, pts: [sx, sy, 0, sx, sy, 2.6] });
          const a = 0.5;
          lines.push({ pen: LINEWORK, pts: [sx - uy * a, sy + ux * a, 2.1, sx + uy * a, sy - ux * a, 2.9] }, { pen: LINEWORK, pts: [sx - uy * a, sy + ux * a, 2.9, sx + uy * a, sy - ux * a, 2.1] });
        }
      }
    }
  }
  return { solids: [], draw: (paper) => lines.forEach((l) => paper.line3(l.pen, l.pts)) };
}

// ---------------------------------------------------------------- Tunnel portals

/** Where a road or railway goes underground: a portal wall with an arch, the mouth hatched dark. */
export function portals(B: Build, town: Town): Extra {
  if (!town.tunnels.length) return none;
  const key = (x: number, y: number) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
  const open = new Set<string>();
  for (const w of town.ways) {
    if (w.kind === 'path') continue;
    open.add(key(w.pts[0], w.pts[1]));
    open.add(key(w.pts[w.pts.length - 2], w.pts[w.pts.length - 1]));
  }
  const solids: Solid[] = [];
  const lines: { pen: number; pts: number[] }[] = [];
  const [upx, upy] = B.cam.up;
  for (const w of town.tunnels) {
    if (w.kind === 'path' || w.cls === 'service') continue;
    const p = w.pts;
    const cum = measure(p);
    if (cum[cum.length - 1] < 30) continue;
    const n = p.length / 2;
    for (const [e, f] of [
      [0, 1],
      [n - 1, n - 2],
    ]) {
      const x = p[e * 2];
      const y = p[e * 2 + 1];
      if (!open.has(key(x, y))) continue;
      const l = Math.hypot(x - p[f * 2], y - p[f * 2 + 1]) || 1;
      // Outward: from inside the tunnel towards daylight.
      const ox = (x - p[f * 2]) / l;
      const oy = (y - p[f * 2 + 1]) / l;
      const vx = -oy;
      const vy = ox;
      const rail = w.kind === 'rail';
      const ow = rail ? 5 : Math.max(5, w.width + 1);
      const crown = rail ? 6.4 : 5.6;
      const spring = Math.max(2.2, crown - ow / 2);
      const hw = ow / 2 + 2.2;
      const top = crown + 1.6;
      const wing = 6;
      const P = (v: number, z: number) => [x + vx * v, y + vy * v, z];
      const wall = [P(-hw - wing, 0), P(-hw, top), P(hw, top), P(hw + wing, 0)];
      const s = newSolid();
      s.faces.push([wall.flat()]);
      solids.push(s);
      lines.push({ pen: LINEWORK, pts: wall.flat() });
      lines.push({ pen: LINEWORK, pts: [...P(-hw, top - 0.45), ...P(hw, top - 0.45)] });
      if (ox * upx + oy * upy >= 0) continue;
      // The arch, and the dark mouth under it.
      const arch: number[] = [...P(-ow / 2, 0)];
      for (let k = 0; k <= 12; k++) {
        const a = Math.PI - (k / 12) * Math.PI;
        arch.push(...P((Math.cos(a) * ow) / 2, spring + Math.sin(a) * (crown - spring)));
      }
      arch.push(...P(ow / 2, 0));
      lines.push({ pen: LINEWORK, pts: arch });
      for (let v = -ow / 2 + 0.3; v < ow / 2; v += 0.32) {
        const c = Math.max(-1, Math.min(1, (v * 2) / ow));
        const zt = spring + Math.sqrt(1 - c * c) * (crown - spring) - 0.05;
        lines.push({ pen: SHADOWS, pts: [...P(v, 0.05), ...P(v, zt)] });
      }
    }
  }
  return { solids, draw: (paper) => lines.forEach((l) => paper.line3(l.pen, l.pts)) };
}

// ---------------------------------------------------------------- Airfields

/** An airliner: fuselage, swept wings, tailplane, fin and engines. */
function plane(B: Build, x: number, y: number, ux: number, uy: number, scale: number): Solid {
  const s = newSolid();
  const S = (pts: number[][]) => pts.map(([a, b]) => [a * scale, b * scale]);
  const P = (pts: number[][]) => place(x, y, ux, uy, S(pts));
  const body = P([
    [-17, -1.8],
    [12, -1.8],
    [17, 0],
    [12, 1.8],
    [-17, 1.8],
  ]);
  slab(B, s, body, 1.2 * scale, 4.8 * scale);
  for (const f of [1, -1]) {
    slab(
      B,
      s,
      P([
        [3, 1.8 * f],
        [-6, 17 * f],
        [-9, 17 * f],
        [-5, 1.8 * f],
      ]),
      2.3 * scale,
      2.7 * scale,
    );
    slab(
      B,
      s,
      P([
        [-13, 1.8 * f],
        [-16, 6 * f],
        [-17.5, 6 * f],
        [-16.5, 1.8 * f],
      ]),
      4.0 * scale,
      4.3 * scale,
    );
    slab(B, s, P(rect(-3.5, 0.5, 5 * f - 0.8, 5 * f + 0.8)), 1.0 * scale, 2.3 * scale);
  }
  const fin = [
    [-17, 0, 4.8],
    [-12, 0, 4.8],
    [-15.5, 0, 10],
    [-17.5, 0, 10],
  ].flatMap(([a, b, zz]) => [x + (ux * a - uy * b) * scale, y + (uy * a + ux * b) * scale, zz * scale]);
  s.faces.push([fin]);
  s.lines.push({ pen: LINEWORK, pts: fin, closed: true });
  s.casts.push({ ring: body, h: 4.8 * scale });
  return s;
}

const MARKED = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

/** Runways, taxiways and aprons: surfaces, markings and a few parked planes. */
export function airfields(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  if (!town.runways.length && !town.aprons.length) return none;
  const solids: Solid[] = [];
  for (const a of town.aprons) {
    const outer = a[0].pts;
    const area = Math.abs(ringArea(outer));
    const { rect: r } = bestRect(outer);
    if (!r || area < 4000 || r.w < 40) continue;
    const count = Math.min(4, Math.floor(r.L / 48));
    for (let k = 0; k < count; k++) {
      const t = (k - (count - 1) / 2) * 48;
      const x = r.cx + r.ux * t;
      const y = r.cy + r.uy * t;
      const [k0, k1] = B.key(x, y);
      if (!pointInRing(x, y, outer) || hash(k0, k1, B.set.seed, 420) > 0.75) continue;
      const f = hash(k0, k1, B.set.seed, 421) < 0.5 ? 1 : -1;
      solids.push(plane(B, x, y, -r.uy * f, r.ux * f, 0.85 + 0.3 * hash(k0, k1, B.set.seed, 422)));
    }
  }
  const s = B.cam.s;
  return {
    solids,
    draw: () => {
      curbs(paper, town.runways, M);
      outline(paper, LINEWORK, town.aprons, M.road);
      if (!B.set.markings || s < 0.12) return;
      const test: Test = (x, y, d) => paper.on(M.road, x, y) && paper.seen(x, y, d);
      for (const w of town.runways) {
        if (w.cls === 'taxiway') {
          paper.line3(LINEWORK, w.pts.flatMap((v, i) => (i % 2 ? [v, 0] : [v])), test);
          continue;
        }
        walk(w.pts, 10, 50, 30, (x, y, ux, uy) => {
          groundSeg(paper, LINEWORK, x, y, x + ux * 30, y + uy * 30, test);
          paper.end();
        });
        // Side stripes and touchdown marks in pairs.
        for (const side of [-1, 1]) {
          const o = side * (w.width / 2 - 2);
          paper.line3(LINEWORK, shifted(w.pts, o), test);
          walk(w.pts, 150, 150, 40, (x, y, ux, uy) => {
            for (const d of [6, 9]) {
              const v = side * d;
              groundSeg(paper, LINEWORK, x - uy * v, y + ux * v, x - uy * v + ux * 22, y + ux * v + uy * 22, test);
              paper.end();
            }
          });
        }
      }
    },
  };
}

// ---------------------------------------------------------------- Road markings

/** Centre dashes on main roads and zebra crossings near busy junctions. */
export function markings(B: Build, paper: Paper, ways: Way[], M: Masks): void {
  const s = B.cam.s;
  if (!B.set.markings || s < 0.3) return;
  const key = (x: number, y: number) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
  const degree = new Map<string, number>();
  for (const w of ways) {
    if (w.kind !== 'road') continue;
    for (const k of [key(w.pts[0], w.pts[1]), key(w.pts[w.pts.length - 2], w.pts[w.pts.length - 1])]) degree.set(k, (degree.get(k) ?? 0) + 1);
  }
  const junction = (x: number, y: number) => (degree.get(key(x, y)) ?? 0) >= 3;
  const zebras: [number, number][] = [];
  const test: Test = (x, y, d) => paper.on(M.road, x, y) && !paper.on(M.foot, x, y) && paper.seen(x, y, d);
  for (const w of ways) {
    if (w.kind !== 'road' || !MARKED.has(w.cls) || w.width < 10) continue;
    const p = w.pts;
    const cum = measure(p);
    const L = cum[cum.length - 1];
    const j0 = junction(p[0], p[1]);
    const j1 = junction(p[p.length - 2], p[p.length - 1]);
    const start = j0 ? 9 : 1.5;
    const stop = j1 ? 9 : 1.5;
    walk(p, start, 9, stop + 3, (x, y, ux, uy) => {
      groundSeg(paper, LINEWORK, x, y, x + ux * 3, y + uy * 3, test);
      paper.end();
    });
    // Zebras a little way in from junctions, and traffic lights at the busier ones.
    if (s < 0.6) continue;
    if (w.cls !== 'tertiary') {
      for (const [isJ, t, dir] of [
        [j0, 2, 1],
        [j1, L - 2, -1],
      ] as const) {
        if (!isJ || L < 12) continue;
        const [x, y, ux, uy] = at(p, cum, t);
        const [k0, k1] = B.key(Math.round(x), Math.round(y));
        if (hash(k0, k1, B.set.seed, 435) > 0.6) continue;
        // On the kerb to the right of traffic heading into the junction.
        const side = -dir;
        const px = x - uy * side * (w.width / 2 + 0.8);
        const py = y + ux * side * (w.width / 2 + 0.8);
        if (onMask(paper, M.foot, px, py) || onMask(paper, M.water, px, py)) continue;
        paper.line3(LINEWORK, [px, py, 0, px, py, 3.2]);
        const fx = -ux * dir * 0.2;
        const fy = -uy * dir * 0.2;
        const box = [px + fx - uy * 0.2, py + fy + ux * 0.2, px + fx + uy * 0.2, py + fy - ux * 0.2];
        paper.line3(LINEWORK, [box[0], box[1], 2.2, box[2], box[3], 2.2, box[2], box[3], 3.3, box[0], box[1], 3.3], paper.seen, true);
      }
    }
    const hw = w.width / 2;
    for (const [isJ, t] of [
      [j0, 5],
      [j1, L - 5],
    ] as const) {
      if (!isJ || L < 16) continue;
      const [x, y, ux, uy] = at(p, cum, t);
      const [k0, k1] = B.key(x, y);
      // One zebra per spot, even where a road is split into pieces or carriageways.
      if (hash(k0, k1, B.set.seed, 430) > 0.6 || zebras.some(([zx, zy]) => Math.hypot(zx - x, zy - y) < 14)) continue;
      zebras.push([x, y]);
      // One stroke per stripe, so the crossing stays light on paper.
      for (let v = -hw + 1.0; v <= hw - 1.0; v += 1.3) {
        const [ax, ay, bx, by] = place(x, y, ux, uy, [
          [-1.5, v],
          [1.5, v],
        ]);
        paper.line3(LINEWORK, [ax, ay, 0, bx, by, 0], test);
      }
    }
  }
}

// ---------------------------------------------------------------- Parking

/** Bays either side of parking aisles: painted lines, and cars in most of them. */
export function parking(B: Build, paper: Paper, ways: Way[], M: Masks): Extra {
  const { set, cam } = B;
  type Bay = { x: number; y: number; ux: number; uy: number; nx: number; ny: number; v0: number };
  const bays: Bay[] = [];
  const W = 2.6;
  const D = 5;
  const clear = (x: number, y: number) => {
    const sx = cam.sx(x, y);
    const sy = cam.sy(x, y, 0);
    return !paper.on(M.road, sx, sy) && !paper.on(M.foot, sx, sy) && !paper.on(M.water, sx, sy);
  };
  for (const w of ways) {
    if (w.kind !== 'road' || w.service !== 'parking_aisle') continue;
    const hw = w.width / 2 + 0.2;
    for (const side of [1, -1]) {
      walk(w.pts, 3, W, 3, (x, y, ux, uy) => {
        const nx = -uy * side;
        const ny = ux * side;
        const cx = x + ux * (W / 2) + nx * (hw + D / 2);
        const cy = y + uy * (W / 2) + ny * (hw + D / 2);
        if (!clear(cx, cy) || !clear(cx + nx * (D / 2 - 0.3), cy + ny * (D / 2 - 0.3))) return;
        bays.push({ x, y, ux, uy, nx, ny, v0: hw });
      });
    }
  }
  const solids: Solid[] = [];
  // Packed bays turn into a dark mass on paper at small scales, so fewer cars there.
  const full = Math.min(0.85, set.cars * 1.9) * (cam.s >= 0.5 ? 1 : 0.4);
  if (set.cars > 0)
    for (const b of bays) {
      const cx = b.x + b.ux * (W / 2) + b.nx * (b.v0 + D / 2);
      const cy = b.y + b.uy * (W / 2) + b.ny * (b.v0 + D / 2);
      const [k0, k1] = B.key(cx, cy);
      if (hash(k0, k1, set.seed, 440) < full) solids.push(car(B, cx, cy, b.nx, b.ny, hash(k0, k1, set.seed, 441)));
    }
  return {
    solids,
    draw: () => {
      if (!set.markings || cam.s < 0.5) return;
      const test: Test = (x, y, d) => !paper.on(M.foot, x, y) && paper.seen(x, y, d);
      for (const b of bays)
        for (const u of [0, W]) {
          const x = b.x + b.ux * u;
          const y = b.y + b.uy * u;
          groundSeg(paper, LINEWORK, x + b.nx * b.v0, y + b.ny * b.v0, x + b.nx * (b.v0 + D), y + b.ny * (b.v0 + D), test);
          paper.end();
        }
    },
  };
}
