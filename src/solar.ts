import { newSolid, tagLines, type Build, type Solid } from './buildings';
import { BAY_D, BAY_W, parkingBays, slab, type Bay, type Extra } from './infra';
import type { Masks } from './nature';
import type { Paper } from './raster';
import { REF_NIB } from './camera';
import type { Info } from './classify';
import { pointInRing, ringArea } from './geo';
import { LOD, shows, spaced } from './lod';
import { hash } from './rng';
import type { Pitched } from './roofs';
import { GREENERY, LINEWORK, SHADOWS } from './settings';
import { bestRect, type Part, type Rect } from './shape';
import type { Building, Town } from './tiles';

/*
 * Solarpunk roofs (docs/solarpunk/implementation-plan.md §7.1): coherent panel groups on the
 * sunny slope of pitched roofs, ordered rows with access aisles around the plant rooms of flat
 * roofs, modules on the opaque slopes of sawtooth roofs, and low planting on flat roofs that
 * suit it. Panels sit a little above the roof, so the roof hatching under them is hidden; their
 * module divisions are drawn in the shadow pen, which reads as dark glass.
 */

/** Height panels stand off a roof: enough that the depth buffer tells them from the roof under them. */
function standoff(B: Build): number {
  return Math.max(0.25, 0.14 / Math.max(0.2, B.cam.sa));
}

/** A panel quad from four 3D corners, its outline and, where they read, module divisions along its length. */
function panel(B: Build, s: Solid, c: number[][], length: number): void {
  const quad = c.flat();
  s.faces.push([quad]);
  s.lines.push({ pen: LINEWORK, pts: quad, closed: true });
  // A sparse grid, every two modules, so panels read as glass and not as shadow hatching.
  if (!shows(B.cam, LOD.pvGrid, 2.1)) return;
  const step = spaced(B.cam, 2.1, 1.6);
  const n = Math.floor(length / step);
  // Divisions run across the panel, from the first edge (c0 → c1) to the opposite one (c3 → c2).
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const a = c[0].map((v, j) => v + (c[1][j] - v) * t);
    const b = c[3].map((v, j) => v + (c[2][j] - v) * t);
    s.lines.push({ pen: SHADOWS, pts: [...a, ...b] });
  }
}

/** Solar panels on the main roof of a pitched house: one group on the slope that faces the sun best. */
export function roofPanels(B: Build, info: Info, main: Part, P: Pitched, He: number, tan: number, out: Solid): void {
  tagLines(B, 'solar', out, () => roofPanelLines(B, info, main, P, He, tan, out), 'pv-roof');
}

function roofPanelLines(B: Build, info: Info, main: Part, P: Pitched, He: number, tan: number, out: Solid): void {
  const { rect: r, party } = main;
  const hw = r.w / 2;
  const vx = -r.uy;
  const vy = r.ux;
  const [sx, sy] = B.sun;
  const [k0, k1] = info.seed;
  // The slope whose outward side faces the sun; a ridge pointing at the sun takes either.
  const dot = vx * sx + vy * sy;
  let side = Math.abs(dot) < 0.25 ? (hash(k0, k1, B.seed, 12030) < 0.5 ? -1 : 1) : dot > 0 ? 1 : -1;
  // Dormers and party walls along a side leave no room there; try the other side.
  const blocked = (sv: number) => !!party[sv < 0 ? 0 : 2] || info.dormers;
  if (blocked(side)) side = -side;
  if (blocked(side)) return;
  // Along the ridge: over the walls, clear of hips, verges and stacks on party walls.
  let lo = Math.max(P.a0, -r.L / 2) + (party[3] ? (info.chimney ? 1.0 : 0.3) : 0.6);
  let hi = Math.min(P.a1, r.L / 2) - (party[1] ? (info.chimney ? 1.0 : 0.3) : 0.6);
  // Keep clear of a free-standing chimney on this slope, placed as roofDetailsLines places it.
  if (info.chimney && !party[1] && !party[3]) {
    const own = B.key(r.cx, r.cy);
    const u = P.a0 + (P.a1 - P.a0) * (0.2 + 0.6 * hash(own[0], own[1], B.seed, 321));
    const sv = hash(k0, k1, B.seed, 302) < 0.5 ? -1 : 1;
    if (sv === side && u > lo && u < hi) {
      if (u - 0.8 - lo >= hi - (u + 0.8)) hi = u - 0.8;
      else lo = u + 0.8;
    }
  }
  // Keep the outline clear of the eaves and ridge on paper too, so it doesn't run into them at coarse scales.
  const pad = Math.max(0, B.cam.gap(0.7) / B.cam.s - 0.45);
  lo += pad;
  hi -= pad;
  const t0 = 0.45 + pad;
  const t1 = hw - 0.45 - pad;
  if (hi - lo < 2 || t1 - t0 < 1.4) return;
  const length = Math.min(hi - lo, info.kind === 'industrial' ? Infinity : 9);
  const mid = (lo + hi) / 2;
  const lift = standoff(B);
  const z = (t: number) => He + (hw - t) * tan + lift;
  const s = out;
  // Long barn roofs get groups of at most 10 m with an access gap between them.
  const groups = Math.max(1, Math.ceil(length / 10.8));
  const gap = 0.8;
  const each = (length - gap * (groups - 1)) / groups;
  for (let g = 0; g < groups; g++) {
    const a = mid - length / 2 + g * (each + gap);
    const b = a + each;
    // The shorter side decides: a long, shallow strip would close up into a line.
    if (!shows(B.cam, LOD.pvPatch, Math.min(each, t1 - t0))) continue;
    const c = [P.at(a, side * t1, z(t1)), P.at(b, side * t1, z(t1)), P.at(b, side * t0, z(t0)), P.at(a, side * t0, z(t0))];
    panel(B, s, c, each);
  }
}

/** A ring grown by `d` metres round a point set, as a box, for keeping panels off it. */
function grown(ring: number[], d: number): number[] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    x0 = Math.min(x0, ring[i]);
    x1 = Math.max(x1, ring[i]);
    y0 = Math.min(y0, ring[i + 1]);
    y1 = Math.max(y1, ring[i + 1]);
  }
  return [x0 - d, y0 - d, x1 + d, y0 - d, x1 + d, y1 + d, x0 - d, y1 + d];
}

/**
 * A solarpunk flat roof: rows of panels with access aisles, kept clear of the plant rooms already
 * on it (`taken`, rings in local metres), and low planting on the rest where the plan says so.
 */
export function futureRoof(B: Build, b: Building, z: number, roofFace: number[][], taken: number[][], out: Solid[]): void {
  const plan = b.future!;
  const outer = b.shape[0].pts;
  const { rect } = bestRect(outer);
  if (!rect) return;
  const keepOff = taken.map((t) => grown(t, 0.6));
  const free = (x: number, y: number) => pointInRing(x, y, outer) && b.shape.slice(1).every((hole) => !pointInRing(x, y, hole.pts)) && !keepOff.some((t) => pointInRing(x, y, t));
  const arrays: number[][] = [];
  if (plan.roofPv) {
    const s: Solid = { faces: [], lines: [], casts: [] };
    tagLines(B, 'solar', s, () => flatArrays(B, rect, z, free, arrays, s), 'pv-array');
    if (s.lines.length) out.push(s);
  }
  if (plan.greenRoof) {
    const area = Math.abs(ringArea(outer));
    if (shows(B.cam, LOD.greenRoof, Math.sqrt(area))) {
      const s = out[0];
      const avoid = arrays.map((a) => grown(a, 0.4));
      tagLines(B, 'planting', s, () => greenRoof(B, b, z, roofFace, (x, y) => free(x, y) && !avoid.some((a) => pointInRing(x, y, a)), s), 'green-roof');
    }
  }
}

/** Rows of tilted panels facing the sun, every third row left out as an aisle, broken round obstacles. */
function flatArrays(B: Build, rect: Rect, z: number, free: (x: number, y: number) => boolean, arrays: number[][], s: Solid): void {
  const [sx, sy] = B.sun;
  const along = Math.abs(rect.ux * sx + rect.uy * sy) < Math.abs(-rect.uy * sx + rect.ux * sy);
  const r = along ? rect : { ...rect, ux: -rect.uy, uy: rect.ux, L: rect.w, w: rect.L };
  let vx = -r.uy;
  let vy = r.ux;
  if (vx * sx + vy * sy > 0) {
    vx = -vx;
    vy = -vy;
  }
  const P = (a: number, d: number) => [r.cx + r.ux * a + vx * d, r.cy + r.uy * a + vy * d];
  const D = 1.4;
  const step = 0.5;
  /** Panel rows as [u0, u1, c]: along the rows from u0 to u1, at c across them. */
  const rows: [number, number, number][] = [];
  let row = 0;
  for (let c = -r.w / 2 + 1.6; c + D < r.w / 2 - 1.2; c += 3.4, row++) {
    if (row % 3 === 2) continue;
    const ok = (a: number) => [P(a, c), P(a, c + D)].every(([x, y]) => free(x, y));
    const runs: [number, number][] = [];
    let start: number | null = null;
    for (let a = -r.L / 2 + 1.5; a <= r.L / 2 - 1.5 + 1e-6; a += step) {
      if (ok(a)) start ??= a;
      else if (start !== null) {
        runs.push([start, a - step]);
        start = null;
      }
    }
    if (start !== null) runs.push([start, r.L / 2 - 1.5]);
    for (const [a0, a1] of runs) {
      // Long rows break every 14 m for access across them.
      const n = Math.max(1, Math.ceil((a1 - a0) / 14));
      const each = (a1 - a0 - (n - 1)) / n;
      if (each < 2) continue;
      for (let i = 0; i < n; i++) rows.push([a0 + i * (each + 1), a0 + i * (each + 1) + each, c]);
    }
  }
  if (!rows.length) return;
  // The same panels at every scale, so planting keeps off them whether or not they show.
  const quad = (u0: number, u1: number, c0: number, c1: number) => [...P(u0, c0), ...P(u1, c0), ...P(u1, c1), ...P(u0, c1)];
  for (const [u0, u1, c] of rows) arrays.push(quad(u0, u1, c, c + D));
  if (!shows(B.cam, LOD.pvRows, 3.4)) {
    // Rows too close to tell apart on paper close up into a band: one outlined patch reads better.
    // Inset far enough on paper that the outline stays clear of the roof edge.
    const pad = Math.max(0, B.cam.gap(0.9) / B.cam.s - 1.5);
    const u0 = Math.min(...rows.map((q) => q[0])) + pad;
    const u1 = Math.max(...rows.map((q) => q[1])) - pad;
    const c0 = Math.min(...rows.map((q) => q[2])) + pad;
    const c1 = Math.max(...rows.map((q) => q[2])) + D - pad;
    if (!shows(B.cam, LOD.pvPatch, Math.min(u1 - u0, c1 - c0))) return;
    const q = quad(u0, u1, c0, c1);
    const pts = [0, 1, 2, 3].flatMap((k) => [q[k * 2], q[k * 2 + 1], z + 0.6]);
    s.faces.push([pts]);
    s.lines.push({ pen: LINEWORK, pts, closed: true });
    return;
  }
  for (const [u0, u1, c] of rows) {
    const each = u1 - u0;
    if (!shows(B.cam, LOD.pvPatch, each)) continue;
    const [p0x, p0y] = P(u0, c);
    const [p1x, p1y] = P(u1, c);
    const [q1x, q1y] = P(u1, c + D);
    const [q0x, q0y] = P(u0, c + D);
    panel(B, s, [[p0x, p0y, z + 1.0], [p1x, p1y, z + 1.0], [q1x, q1y, z + 0.3], [q0x, q0y, z + 0.3]], each);
    // A short back leg at each end tells a tilted panel from a skylight.
    s.lines.push({ pen: LINEWORK, pts: [p0x, p0y, z, p0x, p0y, z + 1.0] }, { pen: LINEWORK, pts: [p1x, p1y, z, p1x, p1y, z + 1.0] });
  }
}

/** Grass tufts in the roof's own symbol size, on a grid fixed to the map, shown only where the roof face is. */
function greenRoof(B: Build, b: Building, z: number, roofFace: number[][], free: (x: number, y: number) => boolean, s: Solid): void {
  const { cam } = B;
  const outer = b.shape[0].pts;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < outer.length; i += 2) {
    x0 = Math.min(x0, outer[i]);
    x1 = Math.max(x1, outer[i]);
    y0 = Math.min(y0, outer[i + 1]);
    y1 = Math.max(y1, outer[i + 1]);
  }
  const step = cam.gap(TUFT_MM) / cam.s;
  const [ox, oy] = B.toAbs(0, 0);
  const metre = B.toAbs(1, 0)[0] - ox;
  const i0 = Math.floor((ox + x0 * metre) / (step * metre));
  const i1 = Math.ceil((ox + x1 * metre) / (step * metre));
  const j0 = Math.floor((oy + y0 * metre) / (step * metre));
  const j1 = Math.ceil((oy + y1 * metre) / (step * metre));
  if ((i1 - i0) * (j1 - j0) > 40000) return;
  const k = Math.max(1, cam.nib / REF_NIB);
  const margin = 1.2;
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const r = (salt: number) => hash(i, j, B.seed, 12040 + salt);
      if (r(0) > 0.6) continue;
      const x = ((i + 0.15 + 0.7 * r(1)) * step * metre - ox) / metre;
      const y = ((j + 0.15 + 0.7 * r(2)) * step * metre - oy) / metre;
      if (![[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([dx, dy]) => free(x + dx, y + dy))) continue;
      const pts: number[] = [];
      for (const [dx, dy] of TUFT) pts.push(x + (cam.cb * dx * k) / cam.s, y - (cam.sb * dx * k) / cam.s, z - (dy * k) / (cam.s * cam.ca));
      s.lines.push({ pen: GREENERY, pts, on: roofFace });
    }
}

/** Tufts a little bigger than ground.ts draws them, in sheet mm: smaller ones plot as dots. */
const TUFT_MM = 3.2 * 1.6;
const TUFT = [
  [-0.45, -0.42],
  [-0.22, 0],
  [0, -0.55],
  [0.22, 0],
  [0.45, -0.42],
].map(([x, y]) => [x * 1.2, y * 1.2]);

/** Modules on the opaque slope of each tooth of a sawtooth roof, leaving the glazed north lights clear. */
export function sawtoothPanels(B: Build, rect: Rect, He: number, out: Solid): void {
  tagLines(B, 'solar', out, () => sawtoothPanelLines(B, rect, He, out), 'pv-saw');
}

function sawtoothPanelLines(B: Build, rect: Rect, He: number, out: Solid): void {
  // The same teeth as roofs.ts sawtoothRoof().
  const { cx, cy, ux, uy, L, w } = rect;
  const vx = -uy;
  const vy = ux;
  const at = (u: number, v: number, z: number) => [cx + ux * u + vx * v, cy + uy * u + vy * v, z];
  const n = Math.max(2, Math.round(L / 7));
  const tl = L / n;
  const ht = Math.min(2.6, tl * 0.38);
  const b = w / 2 - 0.8;
  if (b * 2 < 2) return;
  const lift = standoff(B);
  const groups = Math.max(1, Math.ceil((b * 2) / 12.8));
  const each = (b * 2 - 0.8 * (groups - 1)) / groups;
  for (let k = 0; k < n; k++) {
    const u0 = -L / 2 + k * tl;
    const ua = u0 + tl * 0.15;
    const ub = u0 + tl * 0.85;
    const za = He + 0.15 * ht + lift;
    const zb = He + 0.85 * ht + lift;
    for (let g = 0; g < groups; g++) {
      const v0 = -b + g * (each + 0.8);
      const v1 = v0 + each;
      if (!shows(B.cam, LOD.pvPatch, Math.min(each, tl * 0.7))) continue;
      panel(B, out, [at(ua, v0, za), at(ua, v1, za), at(ub, v1, zb), at(ub, v0, zb)], each);
    }
  }
}

/** Runs of side-by-side bays in one straight row, for a canopy each. */
function bayRuns(bays: Bay[]): Bay[][] {
  const runs: Bay[][] = [];
  let run: Bay[] = [];
  for (const b of bays) {
    const prev = run[run.length - 1];
    const next = prev && b.nx === prev.nx && b.ny === prev.ny && Math.abs(b.ux * prev.ux + b.uy * prev.uy) > 0.995 && Math.abs(Math.hypot(b.x - prev.x, b.y - prev.y) - BAY_W) < 0.15;
    if (!next && run.length) {
      runs.push(run);
      run = [];
    }
    run.push(b);
  }
  if (run.length) runs.push(run);
  return runs;
}

/**
 * Solar canopies over rows of car park bays: a thin roof on a line of posts at the back of the
 * bays, its modules divided every two bays. Rows are chosen whole, by a cell fixed to the map.
 */
export function lotCanopies(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const solids: Solid[] = [];
  const none = { solids, draw: () => {} };
  if (!B.future || !shows(B.cam, LOD.canopy, BAY_D)) return none;
  const f = Math.max(0, Math.min(1, B.set.future));
  for (const run of bayRuns(parkingBays(B, paper, town.ways, M))) {
    if (run.length < 3) continue;
    const a = run[0];
    const z = run[run.length - 1];
    const [c0, c1] = B.cell(a.x + a.nx * (a.v0 + BAY_D / 2), a.y + a.ny * (a.v0 + BAY_D / 2), 30);
    if (hash(c0, c1, B.set.seed, 12122) >= 0.35 + 0.35 * f) continue;
    const s = newSolid();
    const P = (b: Bay, u: number, d: number): [number, number] => [b.x + b.ux * u + b.nx * (b.v0 + d), b.y + b.uy * u + b.ny * (b.v0 + d)];
    const ring = [...P(a, 0, 0.2), ...P(z, BAY_W, 0.2), ...P(z, BAY_W, BAY_D + 0.2), ...P(a, 0, BAY_D + 0.2)];
    const h0 = 3.0;
    const h1 = 3.2;
    slab(B, s, ring, h0, h1);
    s.casts.push({ ring, h: h1 });
    // Posts along the back of the bays, every two bays and at both ends.
    for (let i = 0; i <= run.length; i += 2) {
      const b = run[Math.min(i, run.length - 1)];
      const [px, py] = P(b, i >= run.length ? BAY_W : 0, BAY_D - 0.3);
      s.lines.push({ pen: LINEWORK, pts: [px, py, 0, px, py, h0] });
    }
    if (shows(B.cam, LOD.pvGrid, BAY_W * 2)) {
      for (let i = 2; i < run.length; i += 2) {
        const [x0, y0] = P(run[i], 0, 0.2);
        const [x1, y1] = P(run[i], 0, BAY_D + 0.2);
        s.lines.push({ pen: SHADOWS, pts: [x0, y0, h1, x1, y1, h1] });
      }
    }
    solids.push(s);
  }
  return none;
}
