import { newSolid, prism, tagLines, type Build, type Solid } from './buildings';
import { chords, FIELD, fieldStrips, type Ground } from './ground';
import { BAY_D, BAY_W, parkingBays, slab, type Bay, type Extra } from './infra';
import type { Masks, Tree } from './nature';
import { onMask } from './infra';
import { showpiece } from './future';
import type { Paper } from './raster';
import { REF_NIB } from './camera';
import type { Info } from './classify';
import { pointInRing, ringArea } from './geo';
import { LOD, shows, spaced } from './lod';
import { hash } from './rng';
import type { Pitched } from './roofs';
import { deeper, GREENERY, LINEWORK, ROOFS, SHADOWS } from './settings';
import { bestRect, type Part, type Rect } from './shape';
import type { Building, Town } from './tiles';
import { roofWind, solarWing } from './production';

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
export function panel(B: Build, s: Solid, c: number[][], length: number): void {
  const quad = c.flat();
  const face = [quad];
  s.faces.push(face);
  s.lines.push({ pen: LINEWORK, pts: quad, closed: true });
  // From depth Transform panels are a dark field of tone, so a roof that makes power reads at any scale.
  const bold = deeper(B.set, 'transform');
  if (bold) tone(B, s, c, face);
  // A sparse grid, every two modules, so panels read as glass and not as shadow hatching; over tone, in the line pen.
  // Over tone the grid needs more room, or the two close up into solid ink.
  if (!shows(B.cam, LOD.pvGrid, bold ? 4.2 : 2.1)) return;
  const step = spaced(B.cam, bold ? 4.2 : 2.1, 1.6);
  const n = Math.floor(length / step);
  // Divisions run across the panel, from the first edge (c0 → c1) to the opposite one (c3 → c2).
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const a = c[0].map((v, j) => v + (c[1][j] - v) * t);
    const b = c[3].map((v, j) => v + (c[2][j] - v) * t);
    s.lines.push({ pen: bold ? LINEWORK : SHADOWS, pts: [...a, ...b] });
  }
}

/** Spacing of the tone on panels, mm on paper before `cam.tone()`: a little more open than shaded walls, as panels come with outlines and a grid. */
const PV_TONE_MM = 0.7;

/**
 * Tone hatching across a panel quad (corners c0 → c1 → c2 → c3), parallel to its c0 → c3 edge,
 * spaced on paper and shown only where the panel's face is. Lines too short to read are left
 * out, so a small panel stays a clean outline rather than a row of dots.
 */
function tone(B: Build, s: Solid, c: number[][], face: number[][]): void {
  const { cam } = B;
  const P = (p: number[]) => [cam.sx(p[0], p[1]), cam.sy(p[0], p[1], p[2])];
  const [ax, ay] = P(c[0]);
  const [bx, by] = P(c[1]);
  const [dx, dy] = P(c[3]);
  const lx = dx - ax;
  const ly = dy - ay;
  const ll = Math.hypot(lx, ly);
  if (ll < cam.nib * 2) return;
  const across = Math.abs((bx - ax) * ly - (by - ay) * lx) / ll;
  const n = Math.floor(across / cam.tone(PV_TONE_MM));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const a = c[0].map((v, j) => v + (c[1][j] - v) * t);
    const b = c[3].map((v, j) => v + (c[2][j] - v) * t);
    s.lines.push({ pen: SHADOWS, pts: [...a, ...b], on: face });
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
  // From depth Transform, panels on a row run up to the party walls, so the row reads as one band.
  const flush = deeper(B.set, 'transform') ? 0.05 : 0.3;
  let lo = Math.max(P.a0, -r.L / 2) + (party[3] ? (info.chimney ? 1.0 : flush) : 0.6);
  let hi = Math.min(P.a1, r.L / 2) - (party[1] ? (info.chimney ? 1.0 : flush) : 0.6);
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
  if (plan.production?.wing) {
    const s = newSolid();
    tagLines(B, 'solar', s, () => solarWing(B, plan.production!.wing!, z, s), 'solar-wing');
    if (s.lines.length) out.push(s);
  }
  if (plan.production?.wind) {
    const s = newSolid();
    tagLines(B, 'solar', s, () => roofWind(B, plan.production!.wind!, z, s), 'roof-wind');
    if (s.lines.length) out.push(s);
  }
  if (plan.pavilion) {
    const ring = pavilion(B, b, rect, z, out);
    if (ring) taken.push(ring);
  }
  const keepOff = taken.map((t) => grown(t, 0.6));
  const free = (x: number, y: number) => pointInRing(x, y, outer) && b.shape.slice(1).every((hole) => !pointInRing(x, y, hole.pts)) && !keepOff.some((t) => pointInRing(x, y, t));
  if (plan.marketHall) {
    const s = newSolid();
    tagLines(B, 'additions', s, () => rooflights(B, rect, z, free, s), 'market-hall');
    if (s.lines.length) out.push(s);
    return;
  }
  // A roof garden shares the roof with the panels: they take one half along its length, the garden the other.
  const along = (x: number, y: number) => (x - rect.cx) * rect.ux + (y - rect.cy) * rect.uy;
  const split = !!plan.roofGarden && plan.roofPv;
  const arrays: number[][] = [];
  if (plan.roofPv) {
    const s: Solid = { faces: [], lines: [], casts: [] };
    const pv = split ? (x: number, y: number) => free(x, y) && along(x, y) < -0.8 : free;
    tagLines(B, 'solar', s, () => flatArrays(B, rect, z, pv, arrays, s), 'pv-array');
    if (s.lines.length) out.push(s);
  }
  if (plan.roofGarden) {
    const area = Math.abs(ringArea(outer));
    if (shows(B.cam, LOD.greenRoof, Math.sqrt(area))) {
      const s = out[0];
      const garden = (x: number, y: number) => free(x, y) && (!split || along(x, y) > 0.8);
      tagLines(B, 'planting', s, () => roofGarden(B, b, rect, z, roofFace, garden, s), 'roof-garden');
    }
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

/**
 * A market hall's roof: rows of glazed ridge rooflights along the roof, 6 m apart, with glazing
 * bars down their slopes, where the roof is free.
 */
function rooflights(B: Build, rect: Rect, z: number, free: (x: number, y: number) => boolean, s: Solid): void {
  const { cx, cy, ux, uy, L, w } = rect;
  if (!shows(B.cam, LOD.pavilion, 2.4)) return;
  const vx = -uy;
  const vy = ux;
  const P = (u: number, v: number, h: number) => [cx + ux * u + vx * v, cy + uy * u + vy * v, h];
  const a = L / 2 - 2.5;
  const bars = spaced(B.cam, 1.5, 0.9);
  for (let v = -w / 2 + 4; v <= w / 2 - 4 + 1e-6; v += 6) {
    if (!free(...(P(-a, v, 0).slice(0, 2) as [number, number])) || !free(...(P(a, v, 0).slice(0, 2) as [number, number]))) continue;
    const ridge = [P(-a, v, z + 1.3), P(a, v, z + 1.3)];
    const lo = [P(-a, v - 1.2, z), P(a, v - 1.2, z)];
    const hi = [P(-a, v + 1.2, z), P(a, v + 1.2, z)];
    s.faces.push([[...lo[0], ...lo[1], ...ridge[1], ...ridge[0]]], [[...hi[0], ...hi[1], ...ridge[1], ...ridge[0]]]);
    s.lines.push({ pen: LINEWORK, pts: [...ridge[0], ...ridge[1]] }, { pen: LINEWORK, pts: [...lo[0], ...lo[1]] }, { pen: LINEWORK, pts: [...hi[0], ...hi[1]] });
    for (const e of [0, 1]) s.lines.push({ pen: LINEWORK, pts: [...lo[e], ...ridge[e], ...hi[e]] });
    for (let u = -a + bars; u < a; u += bars) for (const side of [-1.2, 1.2]) s.lines.push({ pen: SHADOWS, pts: [...P(u, v + side, z), ...P(u, v, z + 1.3)] });
  }
}

/**
 * A roof pavilion: a glazed timber box at the middle of the roof under a pergola reaching out
 * over a terrace. Returns its footprint, so panels and planting keep off it.
 */
function pavilion(B: Build, b: Building, rect: Rect, z: number, out: Solid[]): number[] | null {
  const { cx, cy, ux, uy, L, w } = rect;
  const a = Math.min(4, L / 2 - 2.5);
  const c = Math.min(2.6, w / 2 - 2.5);
  if (a < 2 || c < 1.6) return null;
  const vx = -uy;
  const vy = ux;
  const P = (u: number, v: number, h: number) => [cx + ux * u + vx * v, cy + uy * u + vy * v, h];
  const foot = [P(-a, -c, 0), P(a, -c, 0), P(a, c, 0), P(-a, c, 0)].flatMap(([x, y]) => [x, y]);
  if (![0, 2, 4, 6].every((i) => pointInRing(foot[i], foot[i + 1], b.shape[0].pts))) return null;
  if (!shows(B.cam, LOD.pavilion, c * 2)) return foot;
  const s = newSolid();
  tagLines(B, 'additions', s, () => {
    const H = z + 3;
    prism(B, [{ pts: foot, seam: new Uint8Array(4) }], z, H, { roof: true, windows: false, pen: LINEWORK }, s);
    // Glazing: mullions round the box.
    for (const [u0, v0, u1, v1, len] of [[-a, -c, a, -c, 2 * a], [a, -c, a, c, 2 * c], [a, c, -a, c, 2 * a], [-a, c, -a, -c, 2 * c]]) {
      const n = Math.max(1, Math.round(len / 1.4));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const [x, y] = P(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t, 0);
        s.lines.push({ pen: LINEWORK, pts: [x, y, z, x, y, H] });
      }
    }
    // The pergola over the box and a terrace beside it: posts, two beams, slats across.
    const pa = a + 2.2;
    const pc = c + 1.4;
    const top = H + 0.5;
    for (const [u, v] of [[-pa, -pc], [pa, -pc], [pa, pc], [-pa, pc]]) s.lines.push({ pen: LINEWORK, pts: [...P(u, v, z), ...P(u, v, top)] });
    for (const v of [-pc, pc]) s.lines.push({ pen: LINEWORK, pts: [...P(-pa, v, top), ...P(pa, v, top)] });
    const step = spaced(B.cam, 0.8, 0.9);
    for (let u = -pa + step / 2; u < pa; u += step) s.lines.push({ pen: ROOFS, pts: [...P(u, -pc, top + 0.1), ...P(u, pc, top + 0.1)] });
  }, 'roof-pavilion');
  out.push(s);
  return foot;
}

/**
 * Raised solar rows over some fields (agrivoltaics, depth Visionary): every other strip of a
 * field carries rows of tilted panels on posts high enough for crops or sheep beneath.
 */
export function agrivoltaics(B: Build, paper: Paper, G: Ground, M: Masks): Extra {
  const solids: Solid[] = [];
  const none = { solids, draw: () => {} };
  if (!B.future || !shows(B.cam, LOD.agrivoltaic, 12)) return none;
  const [sx, sy] = B.sun;
  for (const c of G.covers) {
    if (c.code !== FIELD || c.rect.w < 45) continue;
    const [k0, k1] = B.key(c.rect.cx, c.rect.cy);
    if (hash(k0, k1, B.set.seed, 12440) >= 0.35) continue;
    const { ux, uy } = c.rect;
    const { vx, vy, v0, n, w } = fieldStrips(B, c);
    // Panels tilt towards the sun, across the rows.
    const toSun = vx * sx + vy * sy >= 0 ? 1 : -1;
    const s = newSolid();
    for (let i = 1; i < n; i += 2) {
      for (let v = v0 + i * w + 4; v < v0 + (i + 1) * w - 3; v += 8) {
        chords(c.shape, ux, uy, vx, vy, v, (ax, ay, bx, by) => {
          const len = Math.hypot(bx - ax, by - ay);
          for (let t0 = 3; t0 + 4 < len - 3; t0 += 13) {
            const t1 = Math.min(len - 3, t0 + 12);
            const ok = [t0, t1].every((t) => {
              const x = ax + ux * t;
              const y = ay + uy * t;
              const px = B.cam.sx(x, y);
              const py = B.cam.sy(x, y, 0);
              return paper.at(G.land, px, py) === FIELD && !paper.on(M.road, px, py) && !paper.on(M.water, px, py) && !paper.on(M.foot, px, py);
            });
            if (!ok) continue;
            const Q = (t: number, d: number, z: number) => [ax + ux * t + vx * d * toSun, ay + uy * t + vy * d * toSun, z];
            panel(B, s, [Q(t0, 1, 3.6), Q(t1, 1, 3.6), Q(t1, -1, 2.6), Q(t0, -1, 2.6)], t1 - t0);
            for (let t = t0 + 0.5; t <= t1; t += 6) s.lines.push({ pen: LINEWORK, pts: [...Q(t, 0, 0), ...Q(t, 0, 3.1)] });
          }
        });
      }
    }
    if (s.lines.length) solids.push(s);
  }
  return none;
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
    const face = [pts];
    s.faces.push(face);
    s.lines.push({ pen: LINEWORK, pts, closed: true });
    if (deeper(B.set, 'transform')) tone(B, s, [0, 1, 2, 3].map((k) => pts.slice(k * 3, k * 3 + 3)), face);
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

/**
 * A roof garden: low planting hatched across the roof, planters along its edge and a few small
 * trees in tubs. Everything is laid out from the roof's own rectangle and position, so it stays
 * put on the map.
 */
function roofGarden(B: Build, b: Building, rect: Rect, z: number, roofFace: number[][], garden: (x: number, y: number) => boolean, s: Solid): void {
  const { cam } = B;
  const outer = b.shape[0].pts;
  const inset = 0.9;
  const ok = (x: number, y: number) => garden(x, y) && garden(x + inset, y) && garden(x - inset, y) && garden(x, y + inset) && garden(x, y - inset);
  // Planting: lines across the roof at 45° to it, as dense as the planted strips of garden streets.
  const dx = (rect.ux - rect.uy) / Math.SQRT2;
  const dy = (rect.uy + rect.ux) / Math.SQRT2;
  const gap = cam.gap(0.9) / cam.s;
  const R = Math.hypot(rect.L, rect.w) / 2 + 1;
  const step = 0.4;
  for (let o = -R; o <= R; o += gap) {
    const ox = rect.cx - dy * o;
    const oy = rect.cy + dx * o;
    let start: number | null = null;
    const flush = (t: number) => {
      if (start !== null && t - start > 0.6) s.lines.push({ pen: GREENERY, pts: [ox + dx * start, oy + dy * start, z, ox + dx * t, oy + dy * t, z], on: roofFace });
      start = null;
    };
    for (let t = -R; t <= R; t += step) {
      if (ok(ox + dx * t, oy + dy * t)) start ??= t;
      else flush(t - step);
    }
    flush(R);
  }
  // Planters along the roof edge, where the garden reaches it: their top edge, a little inside the parapet line.
  const n = outer.length / 2;
  for (let e = 0; e < n; e++) {
    const j = (e + 1) % n;
    const ax = outer[e * 2];
    const ay = outer[e * 2 + 1];
    const ex = outer[j * 2] - ax;
    const ey = outer[j * 2 + 1] - ay;
    const len = Math.hypot(ex, ey);
    if (len < 3) continue;
    const ux = ex / len;
    const uy = ey / len;
    // Rings run counter-clockwise, so the roof is to the left.
    const nx = -uy * 0.6;
    const ny = ux * 0.6;
    let start: number | null = null;
    const flush = (t: number) => {
      if (start !== null && t - start > 1.5) {
        const p = (u: number, z1: number) => [ax + ux * u + nx, ay + uy * u + ny, z1];
        s.lines.push({ pen: LINEWORK, pts: [...p(start, z + 0.45), ...p(t, z + 0.45)] }, { pen: LINEWORK, pts: [...p(start, z), ...p(start, z + 0.45)] }, { pen: LINEWORK, pts: [...p(t, z), ...p(t, z + 0.45)] });
      }
      start = null;
    };
    for (let u = 0.8; u <= len - 0.8; u += 0.5) {
      if (garden(ax + ux * u + nx * 2, ay + uy * u + ny * 2)) start ??= u;
      else flush(u - 0.5);
    }
    flush(len - 0.8);
  }
  // Small trees in tubs, on a 7 m grid fixed to the map.
  if (!shows(cam, LOD.tree, 3)) return;
  const [ox, oy] = B.toAbs(0, 0);
  const metre = B.toAbs(1, 0)[0] - ox;
  const cell = 7;
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
  const big = cell * metre;
  for (let i = Math.floor((ox + x0 * metre) / big); i <= Math.ceil((ox + x1 * metre) / big); i++)
    for (let j = Math.floor((oy + y0 * metre) / big); j <= Math.ceil((oy + y1 * metre) / big); j++) {
      const r = (salt: number) => hash(i, j, B.seed, 12350 + salt);
      if (r(0) > 0.45) continue;
      const x = ((i + 0.25 + 0.5 * r(1)) * big - ox) / metre;
      const y = ((j + 0.25 + 0.5 * r(2)) * big - oy) / metre;
      const cr = 0.9 + r(3) * 0.6;
      if (!ok(x, y) || !ok(x + cr, y) || !ok(x - cr, y)) continue;
      const trunk = 1.2 + r(4) * 0.6;
      // A crown facing the viewer, round on paper, and a tub at its foot.
      const ring: number[] = [];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        ring.push(x + cam.cb * Math.cos(a) * cr, y - cam.sb * Math.cos(a) * cr, z + trunk + (cr + Math.sin(a) * cr) / Math.max(0.3, cam.ca));
      }
      s.faces.push([ring]);
      s.lines.push({ pen: GREENERY, pts: ring, closed: true }, { pen: GREENERY, pts: [x, y, z + 0.5, x, y, z + trunk] });
      const t = 0.45;
      s.lines.push({ pen: LINEWORK, pts: [x - cam.cb * t, y + cam.sb * t, z + 0.5, x + cam.cb * t, y - cam.sb * t, z + 0.5] });
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

/**
 * A station forecourt in solarpunk mode: a canopy of panels on posts on the nearest clear ground
 * by the station, a sheltered place to wait and to leave a bicycle. One per station.
 */
export function forecourtCanopies(B: Build, paper: Paper, town: Town, M: Masks, trees: Tree[] = []): Extra {
  const solids: Solid[] = [];
  const none = { solids, draw: () => {} };
  if (!B.future || !shows(B.cam, LOD.canopy, 5)) return none;
  const clear = (x: number, y: number) => !onMask(paper, M.road, x, y) && !onMask(paper, M.foot, x, y) && !onMask(paper, M.water, x, y);
  const placed: [number, number][] = [];
  for (const p of town.pois) {
    if (p.cls !== 'railway' || placed.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 120)) continue;
    const [k0, k1] = B.key(p.x, p.y);
    const h = (salt: number) => hash(k0, k1, B.set.seed, 12190 + salt);
    // A showpiece station gets a big canopy on branching posts, a public room; if it doesn't fit, the usual one.
    const big = showpiece(B, p.x, p.y);
    for (const [A, V] of big ? [[8, 4], [6, 3]] : [[6, 3]]) {
      if (placed.some(([x, y]) => x === p.x && y === p.y)) break;
      search: for (let r = 8; r <= 40; r += 4)
        for (let q = 0; q < 12; q++) {
          const a = ((q + h(0)) / 12) * Math.PI * 2;
          const x = p.x + Math.cos(a) * r;
          const y = p.y + Math.sin(a) * r;
          const ux = Math.cos(a + Math.PI / 2);
          const uy = Math.sin(a + Math.PI / 2);
          const P = (u: number, v: number): [number, number] => [x + ux * u - uy * v, y + uy * u + ux * v];
          if (![-A, 0, A].every((u) => [-V, V].every((v) => clear(...P(u, v))))) continue;
          // Clear of the crowns of trees already standing there.
          if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < Math.hypot(A, V) + t.r)) continue;
          const s = newSolid();
          const ring = [...P(-A, -V), ...P(A, -V), ...P(A, V), ...P(-A, V)];
          const z = A > 6 ? 4.2 : 3.4;
          slab(B, s, ring, z, z + 0.25);
          s.casts.push({ ring, h: z + 0.25 });
          if (A > 6) {
            // Posts that branch like trees to hold the roof.
            for (const u of [-A / 2, A / 2]) for (const v of [-V / 2, V / 2]) {
              const [px, py] = P(u, v);
              s.lines.push({ pen: LINEWORK, pts: [px, py, 0, px, py, z - 1.4] });
              for (const [du, dv] of [[-1.4, -0.8], [1.4, -0.8], [0, 1.2]]) {
                const [tx, ty] = P(u + du, v + dv);
                s.lines.push({ pen: LINEWORK, pts: [px, py, z - 1.4, tx, ty, z] });
              }
            }
            for (const l of s.lines) l.facet = 'showpiece';
          } else
            for (const u of [-5.5, 0, 5.5]) for (const v of [-2.5, 2.5]) {
              const [px, py] = P(u, v);
              s.lines.push({ pen: LINEWORK, pts: [px, py, 0, px, py, z] });
            }
          if (shows(B.cam, LOD.pvGrid, 2.4))
            for (let u = -A + 2.4; u < A - 0.1; u += 2.4) {
              const [ax, ay] = P(u, -V);
              const [bx, by] = P(u, V);
              s.lines.push({ pen: SHADOWS, pts: [ax, ay, z + 0.25, bx, by, z + 0.25] });
            }
          solids.push(s);
          placed.push([p.x, p.y]);
          // Racks and people keep out from under it; people gather under a showpiece.
          paper.fillMask(M.foot, [ring]);
          if (A > 6) B.future.gather.push([x, y, 6, 5, false]);
          break search;
        }
    }
  }
  return none;
}

/**
 * A branching energy canopy (docs/solarpunk/bolder-plan.md §7): a solar "tree" on a big square,
 * a steel trunk branching twice into a ring of panel sectors, as wide as the square allows. It
 * casts its shadow like a roof. Placed on the square's own rectangle, so it stays put on the map.
 */
export function energyCanopy(B: Build, x: number, y: number, R: number): Solid {
  const s = newSolid();
  tagLines(B, undefined, s, () => {
    // High enough that the trunk and branches show under the front of the rim, from any tilt drawn.
    const z0 = 6 + R * 0.08;
    const z1 = 8 + R * 0.18;
    const z2 = 10 + R * 0.22;
    const inner = R * 0.38;
    const n = shows(B.cam, LOD.publicRoofRibs, Math.PI * inner / 6) ? 12 : 6;
    const at = (a: number, r: number, z: number) => [x + Math.cos(a) * r, y + Math.sin(a) * r, z];
    // Trunk, then six branches, each forking in two under the panel ring.
    s.lines.push({ pen: LINEWORK, pts: [x - 0.3, y, 0, x - 0.3, y, z0] }, { pen: LINEWORK, pts: [x + 0.3, y, 0, x + 0.3, y, z0] });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const mid = at(a, inner * 0.7, z1 - 0.6);
      // Broad roofs share the load between six branching perimeter columns.
      if (R >= 12) {
        s.lines.push({ pen: LINEWORK, pts: [...at(a, inner * 0.7, 0), ...mid] });
        const [cx, cy] = mid;
        s.casts.push({ ring: [cx - 0.25, cy - 0.25, cx + 0.25, cy - 0.25, cx + 0.25, cy + 0.25, cx - 0.25, cy + 0.25], h: z1 - 0.6 });
      }
      s.lines.push({ pen: LINEWORK, pts: [x, y, z0, ...mid] });
      for (const d of [-1, 1]) s.lines.push({ pen: LINEWORK, pts: [...mid, ...at(a + (d * Math.PI) / n, R * 0.8, z2 - 0.5)] });
    }
    // An open central skylight reveals the branches. Chordwise tone keeps the sectors
    // readable without converging into a dense star at the centre.
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      panel(B, s, [at(a0, R, z2), at(a0, inner, z1 + 0.3), at(a1, inner, z1 + 0.3), at(a1, R, z2)], R - inner);
    }
    const rim: number[] = [];
    for (let k = 0; k < n; k++) rim.push(...at((k / n) * Math.PI * 2, R, z2));
    const opening: number[] = [];
    for (let k = n - 1; k >= 0; k--) opening.push(...at((k / n) * Math.PI * 2, inner, z1 + 0.3));
    s.shade = [[rim, opening]];
    const foot: number[] = [];
    for (let k = 0; k < 8; k++) foot.push(...at((k / 8) * Math.PI * 2, 0.4, 0).slice(0, 2));
    s.casts.push({ ring: foot, h: z0 });
  }, 'energy-canopy');
  return s;
}

