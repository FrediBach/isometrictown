import { newSolid, type Build, type Solid } from './buildings';
import type { ClimateId } from './future';
import { pointInRing } from './geo';
import { LOD, shows, spaced } from './lod';
import { deeper, GREENERY, LINEWORK, WATER, type Settings } from './settings';
import { bestRect, corners, type Rect } from './shape';
import { panel } from './solar';
import type { Building, Shape, Town } from './tiles';

/** A property's reserved productive structures, planned in local metres before drawing. */
export type Production = {
  wing?: Rect;
  wind?: Rect;
  garden?: Rect;
  cistern?: Rect;
  /** A point on the back wall supplying the cistern. */
  inlet?: [number, number];
};
/** Eligibility and rejection counts, independent of the drawing's level of detail. */
export type ProductionStats = { roofs: number; wings: number; homes: number; gardens: number; cisterns: number; crowded: number; unknown: number };

type Box = [number, number, number, number];
const bounds = (p: number[]): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); y0 = Math.min(y0, p[i + 1]); x1 = Math.max(x1, p[i]); y1 = Math.max(y1, p[i + 1]); }
  return [x0, y0, x1, y1];
};
const meets = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** A small spatial index for full footprints, including neighbours outside the sheet. */
export class GroundIndex {
  private cells = new Map<string, number[]>();
  private big: number[] = [];
  private rings: { p: number[]; box: Box }[] = [];
  add(p: number[]): void {
    const box = bounds(p), id = this.rings.push({ p, box }) - 1;
    if ((box[2] - box[0]) * (box[3] - box[1]) > 1e6) { this.big.push(id); return; }
    for (let x = Math.floor(box[0] / 40); x <= Math.floor(box[2] / 40); x++) for (let y = Math.floor(box[1] / 40); y <= Math.floor(box[3] / 40); y++) {
      const k = `${x},${y}`, ids = this.cells.get(k);
      if (ids) ids.push(id); else this.cells.set(k, [id]);
    }
  }
  clear(p: number[]): boolean {
    const box = bounds(p), ids = new Set(this.big);
    for (let x = Math.floor(box[0] / 40); x <= Math.floor(box[2] / 40); x++) for (let y = Math.floor(box[1] / 40); y <= Math.floor(box[3] / 40); y++) for (const id of this.cells.get(`${x},${y}`) ?? []) ids.add(id);
    for (const id of ids) { const r = this.rings[id]; if (meets(box, r.box) && overlaps(p, r.p)) return false; }
    return true;
  }
}

function crosses(a: number[], i: number, b: number[], j: number): boolean {
  const k = (i + 2) % a.length, l = (j + 2) % b.length;
  const ax = a[k] - a[i], ay = a[k + 1] - a[i + 1], bx = b[l] - b[j], by = b[l + 1] - b[j + 1];
  const d = ax * by - ay * bx;
  if (Math.abs(d) < 1e-8) return false;
  const dx = b[j] - a[i], dy = b[j + 1] - a[i + 1];
  const t = (dx * by - dy * bx) / d, u = (dx * ay - dy * ax) / d;
  return t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8;
}
function edgesMeet(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i += 2) for (let j = 0; j < b.length; j += 2) if (crosses(a, i, b, j)) return true;
  return false;
}
/** Full polygon overlap, including an obstacle entirely inside a proposed structure. */
export function overlaps(a: number[], b: number[]): boolean {
  return pointInRing(a[0], a[1], b) || pointInRing(b[0], b[1], a) || edgesMeet(a, b);
}
/** A rectangle fits wholly inside the roof or land parcel, including concavities and holes. */
export function fits(r: Rect, shape: Shape): boolean {
  const p = corners(r), outer = shape[0].pts;
  return p.every((_, i) => i % 2 || pointInRing(p[i], p[i + 1], outer)) && !edgesMeet(p, outer) && shape.slice(1).every((h) => !overlaps(p, h.pts));
}

/** Reserve the complete width of a mapped linear obstacle. */
export function corridor(index: GroundIndex, pts: number[], radius: number): void {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const dx = pts[i + 2] - pts[i], dy = pts[i + 3] - pts[i + 1], len = Math.hypot(dx, dy);
    if (!len) continue;
    index.add(corners({ cx: (pts[i] + pts[i + 2]) / 2, cy: (pts[i + 1] + pts[i + 3]) / 2, ux: dx / len, uy: dy / len, L: len + radius * 2, w: radius * 2 }));
  }
}

/**
 * Reserve roofs and rear gardens before context buildings are dropped. Ground proposals reach
 * at most 19 m from their owner and require a complete residential parcel in the loaded data.
 * Conflicting neighbours both decline the ground package, so input order never picks a winner.
 */
export function planProduction(town: Town, set: Settings): ProductionStats {
  const stats: ProductionStats = { roofs: 0, wings: 0, homes: 0, gardens: 0, cisterns: 0, crowded: 0, unknown: 0 };
  if (!set.solarpunk || !deeper(set, 'transform')) return stats;
  const ground = new GroundIndex();
  for (const b of town.buildings) {
    ground.add(b.shape[0].pts);
    // Keep a service strip round walls, including the space occupied by balcony frames.
    corridor(ground, [...b.shape[0].pts, ...b.shape[0].pts.slice(0, 2)], b.future?.addition === 'frame' ? 3.2 : 0.8);
    const f = b.future;
    if ((f?.addition === 'porch' || f?.addition === 'canopy') && f.side !== undefined && f.side >= 0) {
      const p = b.shape[0].pts, q = f.side * 2, j = (q + 2) % p.length;
      corridor(ground, [p[q], p[q + 1], p[j], p[j + 1]], 3.2);
    }
  }
  const context = town.productionContext;
  for (const s of context?.shapes ?? [...town.water, ...town.pools, ...town.wood, ...town.green, ...town.plazas, ...town.aprons, ...town.cover.map((a) => a.shape)]) ground.add(s[0].pts);
  for (const w of [...town.nearby.ways, ...(context?.runways ?? town.runways)]) corridor(ground, w.pts, Math.max(w.width / 2, 1) + 1);
  for (const w of context?.streams ?? town.streams) corridor(ground, w.pts, w.width / 2 + 2);
  const parcels = town.nearby.landuse.filter((a) => a.cls === 'residential').map((a) => a.shape);
  const skyline = town.buildings.map((b) => ({ b, box: bounds(b.shape[0].pts) }));
  const candidates: { b: Building; r: Rect; tank: boolean; inlet: [number, number] }[] = [];
  for (const b of town.buildings) {
    const f = b.future, i = b.info;
    if (!f || !i) continue;
    f.production = {};
    const { rect: r, fill } = bestRect(b.shape[0].pts);
    if (!r) continue;
    const visible = !b.context;
    if (i.roof === 'flat' && f.roofPv && !f.pavilion && !f.marketHall && b.h <= 60 && b.min === 0) {
      if (visible) stats.roofs++;
      // The wing shelters most of the terrace, leaving a strip for gardens and plant rooms.
      const wing = { ...r, cx: r.cx + r.uy * r.w * 0.12, cy: r.cy - r.ux * r.w * 0.12, L: Math.min(24, r.L - 3), w: Math.min(12, r.w * 0.65 - 1.5) };
      if (wing.L >= 6 && wing.w >= 4 && fits(wing, b.shape)) { f.production.wing = wing; if (visible) stats.wings++; }
    }
    // Reserve the complete rotor sweep and service frame, not just the mast footing.
    // A nearby taller building shelters the roof; context neighbours count as well.
    if (i.roof === 'flat' && f.roofPv && !f.pavilion && !f.marketHall && !i.hospital && b.h >= 6 && b.h <= 60 && b.min === 0) {
      const wing = f.production.wing;
      const occupied = wing ? corners({ ...wing, L: wing.L + 2, w: wing.w + 2 }) : null;
      for (const [u, v] of [[r.L / 2 - 4, 0], [-r.L / 2 + 4, 0], [0, r.w / 2 - 4], [0, -r.w / 2 + 4], [0, 0]]) {
        const wind = { ...r, cx: r.cx + r.ux * u - r.uy * v, cy: r.cy + r.uy * u + r.ux * v, L: 6, w: 6 };
        if (!fits(wind, b.shape) || (occupied && overlaps(corners(wind), occupied))) continue;
        const sheltered = skyline.some(({ b: other, box }) => {
          if (other === b || other.h * set.heightScale <= b.h * set.heightScale + 3) return false;
          return Math.hypot(Math.max(box[0] - wind.cx, 0, wind.cx - box[2]), Math.max(box[1] - wind.cy, 0, wind.cy - box[3])) < 24;
        });
        if (!sheltered) { f.production.wind = wind; break; }
      }
    }
    if (!set.ground || !['B01', 'B02'].includes(f.recipe) || !i.toStreet || b.min > 0 || fill < 0.8 || b.shape[0].seam.some(Boolean)) continue;
    if (visible) stats.homes++;
    // Prefer a full growing plot; a tight site can still collect water in a separate cistern.
    const [tx, ty] = i.toStreet;
    const p = b.shape[0].pts;
    let chosen: typeof candidates[number] | undefined;
    let known = false;
    const edges: { x: number; y: number; ux: number; uy: number; nx: number; ny: number; len: number; score: number }[] = [];
    for (let q = 0; q < p.length; q += 2) {
      const j = (q + 2) % p.length, dx = p[j] - p[q], dy = p[j + 1] - p[q + 1], len = Math.hypot(dx, dy);
      if (len < 5 || i.party[q / 2] > 0) continue;
      const ux = dx / len, uy = dy / len, nx = uy, ny = -ux;
      const score = -(nx * tx + ny * ty);
      if (score < 0.4) continue;
      edges.push({ x: (p[q] + p[j]) / 2, y: (p[q + 1] + p[j + 1]) / 2, ux, uy, nx, ny, len, score });
    }
    edges.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y);
    for (const tank of [false, true]) {
      for (const e of edges) {
        const w = tank ? 3.6 : 10, L = tank ? 3.6 : Math.min(9, e.len - 1);
        if (!tank && L < 7) continue;
        const gap = tank && f.addition !== 'frame' ? 1.2 : 4;
        const site = { cx: e.x + e.nx * (gap + w / 2), cy: e.y + e.ny * (gap + w / 2), ux: -e.ux, uy: -e.uy, L, w };
        if (!parcels.some((s) => fits(site, s))) continue;
        known = true;
        if (!ground.clear(corners(site))) continue;
        chosen = { b, r: site, tank, inlet: [e.x, e.y] };
        break;
      }
      if (chosen) break;
    }
    if (chosen) candidates.push(chosen);
    else if (visible) { if (known) stats.crowded++; else stats.unknown++; }
  }
  // Local conflict checks include context owners, but never depend on their traversal order.
  const boxes = candidates.map((c) => bounds(corners(c.r)));
  for (let j = 0; j < candidates.length; j++) {
    const c = candidates[j], foot = corners(c.r);
    if (candidates.some((other, k) => k !== j && meets(boxes[j], boxes[k]) && overlaps(foot, corners(other.r)))) { if (!c.b.context) stats.crowded++; continue; }
    const f = c.b.future!.production!;
    f.inlet = c.inlet;
    if (c.tank) f.cistern = c.r; else f.garden = c.r;
    if (!c.b.context) { stats.cisterns++; if (!c.tank) stats.gardens++; }
  }
  return stats;
}

/** Ground reserved by an accepted package, including the access path between its structures. */
export function productionFoot(b: Building): number[] | null {
  const p = b.future?.production, r = p?.garden ?? p?.cistern;
  return r ? corners(r) : null;
}

/** Roof space kept clear of plant rooms, panels and planting even when detail fades out. */
export function productionRoof(b: Building): number[][] {
  const p = b.future?.production;
  return [p?.wing, p?.wind].filter((r): r is Rect => !!r).map((r) => corners({ ...r, L: r.L + 1.2, w: r.w + 1.2 }));
}

/** An eight-metre rooftop wind assembly: braced frame, generator and two curved rotor blades. */
export function roofWind(B: Build, r: Rect, z: number, out: Solid): void {
  if (!shows(B.cam, LOD.roofWind, 8)) return;
  const P = (u: number, v: number, h: number) => [r.cx + r.ux * u - r.uy * v, r.cy + r.uy * u + r.ux * v, z + h];
  const line = (a: number[], b: number[]) => out.lines.push({ pen: LINEWORK, pts: [...a, ...b] });
  for (const u of [-1.8, 1.8]) for (const v of [-1.8, 1.8]) line(P(u, v, 0), P(u * 0.45, v * 0.45, 2));
  const deck = [P(-1, -1, 2), P(1, -1, 2), P(1, 1, 2), P(-1, 1, 2)].flat();
  out.faces.push([deck]);
  out.lines.push({ pen: LINEWORK, pts: deck, closed: true });
  line(P(0, 0, 2), P(0, 0, 8));
  // A pair of bowed, twisting blades gives the machine a recognisable silhouette without mesh hatching.
  for (const phase of [0, Math.PI]) {
    const left: number[][] = [], right: number[][] = [];
    for (let j = 0; j <= 10; j++) {
      const t = j / 10, a = phase + t * Math.PI * 0.65;
      const radius = 0.55 + 1.65 * Math.sin(t * Math.PI);
      left.push(P(Math.cos(a) * radius - Math.sin(a) * 0.22, Math.sin(a) * radius + Math.cos(a) * 0.22, 2.8 + t * 4.8));
      right.push(P(Math.cos(a) * radius + Math.sin(a) * 0.22, Math.sin(a) * radius - Math.cos(a) * 0.22, 2.8 + t * 4.8));
      if (j) out.faces.push([[...left[j - 1], ...right[j - 1], ...right[j], ...left[j]]]);
    }
    if (shows(B.cam, LOD.productionFrame, 0.44)) out.lines.push({ pen: LINEWORK, pts: [...left.flat(), ...right.reverse().flat()], closed: true });
    else out.lines.push({ pen: LINEWORK, pts: left.flat() });
    line(P(0, 0, 2.8), left[0]); line(P(0, 0, 7.6), left[10]);
  }
  if (shows(B.cam, LOD.productionFrame, 2.5)) {
    for (const v of [-1.8, 1.8]) line(P(-1.8, v, 0), P(0.81, v * 0.45, 2));
    const generator = [P(-0.45, -0.45, 2.05), P(0.45, -0.45, 2.05), P(0.45, -0.45, 2.7), P(-0.45, -0.45, 2.7)].flat();
    out.faces.push([generator]); out.lines.push({ pen: LINEWORK, pts: generator, closed: true });
  }
  out.casts.push({ ring: corners({ ...r, L: 1, w: 1 }), h: z + 8 });
}

/** A supported solar wing, three metres above a roof, with a clear terrace underneath. */
export function solarWing(B: Build, r: Rect, z: number, out: Solid): void {
  if (!shows(B.cam, LOD.solarWing, Math.min(r.L, r.w))) return;
  const P = (u: number, v: number, h: number) => [r.cx + r.ux * u - r.uy * v, r.cy + r.uy * u + r.ux * v, h];
  const a = r.L / 2, c = r.w / 2;
  const sign = -r.uy * B.sun[0] + r.ux * B.sun[1] > 0 ? -1 : 1;
  const top = (v: number) => z + 3.5 + sign * v * 0.18;
  panel(B, out, [P(-a, -c, top(-c)), P(a, -c, top(-c)), P(a, c, top(c)), P(-a, c, top(c))], r.L);
  const n = Math.max(1, Math.ceil(r.L / 9));
  for (let j = 0; j <= n; j++) {
    const u = -a + 0.5 + (r.L - 1) * j / n;
    for (const v of [-c + 0.5, c - 0.5]) {
      out.lines.push({ pen: LINEWORK, pts: [...P(u, v, z), ...P(u, v, top(v))] });
      if (shows(B.cam, LOD.productionFrame, 2.5)) out.lines.push({ pen: LINEWORK, pts: [...P(u, v, z + 1.8), ...P(u, v * 0.25, top(v * 0.25))] });
    }
  }
  out.shade = [[corners(r).flatMap((v, i, p) => i % 2 ? [] : [v, p[i + 1], z + 3.5])]];
}

/** Productive rear gardens: a growing house, substantial beds and a connected rain cistern. */
export function productiveGardens(B: Build, town: Town): Solid[] {
  const solids: Solid[] = [];
  if (!B.future || !B.set.ground || !deeper(B.set, 'transform')) return solids;
  for (const b of town.buildings) {
    const f = b.future, p = f?.production, r = p?.garden ?? p?.cistern;
    if (!r || f?.eave === undefined) continue;
    const s = newSolid();
    const P = (u: number, v: number, h: number) => [r.cx + r.ux * u - r.uy * v, r.cy + r.uy * u + r.ux * v, h];
    const garden = !!p?.garden;
    if (garden && shows(B.cam, LOD.growingHouse, 2.9)) {
      growingHouse(B, P, r.L / 2 - 0.3, B.future.climate, s);
      // Two broad beds face the growing house, with a 1.4 m path between them.
      if (shows(B.cam, LOD.productiveBed, 2.2)) for (const u of [-r.L / 2 + 1.4, r.L / 2 - 1.4]) {
        const ring = [P(u - 1.1, -4.6, 0.25), P(u + 1.1, -4.6, 0.25), P(u + 1.1, -1.4, 0.25), P(u - 1.1, -1.4, 0.25)].flat();
        s.faces.push([ring]);
        s.lines.push({ pen: GREENERY, pts: ring, closed: true });
        const step = spaced(B.cam, 0.8, 0.9);
        for (let v = -4.1; v < -1.7; v += step) s.lines.push({ pen: GREENERY, pts: [...P(u - 0.8, v, 0.3), ...P(u + 0.8, v, 0.3)] });
      }
    }
    const u = garden ? -r.L / 2 + 1.55 : 0, v = garden ? 0.25 : 0;
    if (shows(B.cam, LOD.cistern, 2.6)) {
      cistern(B, P, u, v, s);
      if (shows(B.cam, LOD.productionFrame, 2.5)) {
        const [ix, iy] = p!.inlet!;
        s.lines.push({ pen: WATER, pts: [ix, iy, f.eave - 0.2, ix, iy, 0.15, ...P(0, v, 0.15), ...P(u, v, 0.15), ...P(u, v, 2.4)] });
        if (garden) s.lines.push({ pen: WATER, pts: [...P(u, v, 2.4), ...P(u, 2.2, 2.4), ...P(u, 2.2, 2.8)] });
      }
    }
    if (s.lines.length) solids.push(s);
  }
  return solids;
}

type Place = (u: number, v: number, z: number) => number[];
function cistern(B: Build, P: Place, u: number, v: number, s: Solid): void {
  const n = 12, base: number[][] = [], top: number[][] = [];
  for (let q = 0; q < n; q++) {
    const a = q * Math.PI * 2 / n;
    base.push(P(u + Math.cos(a) * 1.3, v + Math.sin(a) * 1.3, 0.2));
    top.push(P(u + Math.cos(a) * 1.3, v + Math.sin(a) * 1.3, 2.4));
  }
  s.faces.push([top.flat()]);
  for (let q = 0; q < n; q++) s.faces.push([[...base[q], ...base[(q + 1) % n], ...top[(q + 1) % n], ...top[q]]]);
  s.lines.push({ pen: WATER, pts: top.flat(), closed: true }, { pen: LINEWORK, pts: base.flat(), closed: true });
  // Keep the cylindrical silhouette at every bearing; reinforcing ribs appear only close up.
  let left = 0, right = 0;
  const sx = (q: number) => B.cam.sx(base[q][0], base[q][1]);
  for (let q = 1; q < n; q++) { if (sx(q) < sx(left)) left = q; if (sx(q) > sx(right)) right = q; }
  const ribs = new Set([left, right]);
  if (shows(B.cam, LOD.productionFrame, 2.5)) for (let q = 0; q < n; q += 3) ribs.add(q);
  for (const q of ribs) s.lines.push({ pen: LINEWORK, pts: [...base[q], ...top[q]] });
  s.casts.push({ ring: base.flatMap(([x, y]) => [x, y]), h: 2.4 });
}
function growingHouse(B: Build, P: Place, a: number, climate: ClimateId, s: Solid): void {
  const open = climate === 'hot_dry' || climate === 'hot_humid' || climate === 'monsoonal';
  const y0 = 1.8, y1 = 4.7, mid = (y0 + y1) / 2, eave = 2.8, ridge = 4.1;
  for (const [v0, h0, v1, h1] of [[y0, eave, mid, ridge], [mid, ridge, y1, eave]]) {
    const quad = [P(-a, v0, h0), P(a, v0, h0), P(a, v1, h1), P(-a, v1, h1)];
    s.faces.push([quad.flat()]);
    s.lines.push({ pen: LINEWORK, pts: quad.flat(), closed: true });
  }
  // One broad photovoltaic slope powers the growing house; the other admits light.
  panel(B, s, [P(-a, mid, ridge + 0.08), P(a, mid, ridge + 0.08), P(a, y1, eave + 0.08), P(-a, y1, eave + 0.08)], a * 2);
  for (const u of [-a, a]) {
    const end = [P(u, y0, 0), P(u, y1, 0), P(u, y1, eave), P(u, mid, ridge), P(u, y0, eave)].flat();
    if (!open) s.faces.push([end]);
    s.lines.push({ pen: LINEWORK, pts: end, closed: true });
  }
  for (const v of [y0, y1]) {
    if (!open) s.faces.push([[...P(-a, v, 0), ...P(a, v, 0), ...P(a, v, eave), ...P(-a, v, eave)]]);
    s.lines.push({ pen: LINEWORK, pts: [...P(-a, v, 0), ...P(a, v, 0)] });
  }
  if (shows(B.cam, LOD.productionFrame, 2.5)) {
    const step = spaced(B.cam, 2, 1.4);
    for (let u = -a + step; u < a - 0.5; u += step) s.lines.push({ pen: LINEWORK, pts: [...P(u, y0, 0), ...P(u, y0, eave), ...P(u, mid, ridge)] });
    // An unmistakable access door and a long collection gutter on the glazed side.
    s.lines.push({ pen: LINEWORK, pts: [...P(-0.6, y0 - 0.02, 0), ...P(-0.6, y0 - 0.02, 2.2), ...P(0.6, y0 - 0.02, 2.2), ...P(0.6, y0 - 0.02, 0)] });
    s.lines.push({ pen: WATER, pts: [...P(-a, y0, eave + 0.04), ...P(a, y0, eave + 0.04)] });
  }
  s.casts.push({ ring: [P(-a, y0, 0), P(a, y0, 0), P(a, y1, 0), P(-a, y1, 0)].flatMap(([x, y]) => [x, y]), h: ridge });
}
