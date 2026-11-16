import { newSolid, type Build, type Solid } from './buildings';
import { FIELD, MEADOW, WETLAND, type Ground } from './ground';
import type { Extra } from './infra';
import { LOD, shows } from './lod';
import type { Masks } from './nature';
import type { Paper } from './raster';
import { hash } from './rng';
import { GREENERY, LINEWORK } from './settings';
import { pointInRing } from './geo';
import { at, measure } from './infra';
import type { Town } from './tiles';

/*
 * District landmarks at depth Visionary (docs/solarpunk/bolder-plan.md §7): rare by design, and
 * labelled in the catalogue as made up: community wind turbines on open land, and planted
 * footbridges between tall buildings across side streets.
 */

/** Side of the cells turbines are placed in, Web Mercator metres: at most one per cell. */
const CELL = 700;
/** Clearance from any building, metres. */
const CLEAR = 300;
/** Hub height and blade length, metres. */
const HUB = 78;
const BLADE = 38;

/**
 * One to three community wind turbines on open land at the edge of town, at least 300 m from
 * any building, one per 700 m cell at most, on cells fixed to the map. The guide warns against
 * inventing wind farms, so there are never more than three on a sheet.
 */
export function windTurbines(B: Build, paper: Paper, town: Town, G: Ground | null, M: Masks): Extra {
  const solids: Solid[] = [];
  const none = { solids, draw: () => {} };
  if (!B.future || !G || !shows(B.cam, LOD.turbine)) return none;
  const { cam } = B;
  const [x0, y0, x1, y1] = cam.region(0);
  const [A0x, A0y] = B.toAbs(x0, y0);
  const [A1x, A1y] = B.toAbs(x1, y1);
  const metre = B.toAbs(1, 0)[0] - B.toAbs(0, 0)[0];
  const built = town.density.built;
  const sites: [number, number, number][] = [];
  for (let i = Math.floor(Math.min(A0x, A1x) / CELL); i <= Math.ceil(Math.max(A0x, A1x) / CELL); i++)
    for (let j = Math.floor(Math.min(A0y, A1y) / CELL); j <= Math.ceil(Math.max(A0y, A1y) / CELL); j++) {
      const h = (k: number) => hash(i, j, B.set.seed, 12430 + k);
      if (h(0) > 0.55) continue;
      const X = (i + 0.2 + 0.6 * h(1)) * CELL;
      const Y = (j + 0.2 + 0.6 * h(2)) * CELL;
      const x = (X - B.toAbs(0, 0)[0]) / metre;
      const y = (Y - B.toAbs(0, 0)[1]) / metre;
      const sx = cam.sx(x, y);
      const sy = cam.sy(x, y, 0);
      if (sx < paper.x0 || sx > paper.x1 || sy < paper.y0 || sy > paper.y1) continue;
      const code = paper.at(G.land, sx, sy);
      if (!(code === 0 || code === FIELD || code === MEADOW || code === WETLAND)) continue;
      if (paper.on(M.road, sx, sy) || paper.on(M.water, sx, sy) || paper.on(M.wood, sx, sy) || paper.on(M.foot, sx, sy) || G.inTown(x, y, sx, sy)) continue;
      let near = false;
      for (let q = 0; q < built.length && !near; q += 3) near = Math.hypot(built[q] - x, built[q + 1] - y) < CLEAR;
      if (!near) sites.push([x, y, h(3)]);
    }
  sites.sort((a, b) => a[2] - b[2]);
  for (const [x, y, v] of sites.slice(0, 3)) solids.push(turbine(B, x, y, v));
  return none;
}

/** A turbine: a tapering tower, the nacelle, and three blades turned to the wind, at an angle fixed by `v`. */
function turbine(B: Build, x: number, y: number, v: number): Solid {
  const s = newSolid();
  const { cam } = B;
  // The rotor faces the prevailing wind; its disc is drawn edge-on to that direction.
  const wx = 0.8;
  const wy = 0.6;
  const px = -wy;
  const py = wx;
  // Tower: two tapering lines, as seen across the view.
  const ax = cam.cb;
  const ay = -cam.sb;
  s.lines.push({ pen: LINEWORK, pts: [x - ax * 2.2, y - ay * 2.2, 0, x - ax * 1.1, y - ay * 1.1, HUB - 1.6] });
  s.lines.push({ pen: LINEWORK, pts: [x + ax * 2.2, y + ay * 2.2, 0, x + ax * 1.1, y + ay * 1.1, HUB - 1.6] });
  s.casts.push({ ring: [x - 2, y - 2, x + 2, y - 2, x + 2, y + 2, x - 2, y + 2], h: HUB });
  // Nacelle: a box along the wind.
  const box = (u: number, w: number, z: number) => [x + wx * u + px * w, y + wy * u + py * w, z];
  const corners = [box(-5, -1.6, HUB - 1.6), box(5, -1.6, HUB - 1.6), box(5, 1.6, HUB - 1.6), box(-5, 1.6, HUB - 1.6)];
  const tops = corners.map(([cx, cy]) => [cx, cy, HUB + 1.6]);
  for (const ring of [corners, tops]) s.lines.push({ pen: LINEWORK, pts: ring.flat(), closed: true });
  for (let k = 0; k < 4; k++) s.lines.push({ pen: LINEWORK, pts: [...corners[k], ...tops[k]] });
  s.faces.push([corners.flat()], [tops.flat()]);
  // Blades in the rotor plane (across the wind, vertical), from the hub in front of the nacelle.
  const hx = x + wx * 5.6;
  const hy = y + wy * 5.6;
  const phase = v * Math.PI * 2;
  for (let k = 0; k < 3; k++) {
    const a = phase + (k / 3) * Math.PI * 2;
    const at = (r: number, off: number) => {
      const c = Math.cos(a);
      const sn = Math.sin(a);
      // Along the blade (r) and across it (off), in the rotor plane.
      return [hx + px * (c * r - sn * off), hy + py * (c * r - sn * off), HUB + sn * r + c * off];
    };
    s.lines.push({ pen: LINEWORK, pts: [...at(1, 0.9), ...at(BLADE * 0.3, 1.4), ...at(BLADE, 0.2), ...at(BLADE, -0.2), ...at(BLADE * 0.3, -0.6), ...at(1, -0.9)], closed: true });
  }
  return s;
}

/** Streets a garden bridge may cross. */
const BRIDGED = new Set(['minor', 'service', 'tertiary']);

/**
 * Garden bridges: across a side street, between two buildings at least 18 m tall standing 12 to
 * 30 m apart, one planted footbridge at mid-height on a truss. Looked for at the middle of each
 * street, square across it, and decided by that point, so it stays put on the map.
 */
export function gardenBridges(B: Build, town: Town): Extra {
  const solids: Solid[] = [];
  const none = { solids, draw: () => {} };
  if (!B.future || !shows(B.cam, LOD.gardenBridge)) return none;
  const tall = town.buildings.filter((b) => b.info && b.h * B.set.heightScale >= 18).map((b) => {
    const p = b.shape[0].pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]);
      y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]);
    }
    return { p, h: b.h * B.set.heightScale, box: [x0, y0, x1, y1] };
  });
  if (!tall.length) return none;
  /** The first tall building a ray from (x, y) along (nx, ny) meets within 20 m: its distance and height. */
  const hit = (x: number, y: number, nx: number, ny: number): [number, number] | null => {
    for (let d = 1; d <= 20; d += 0.5) {
      const px = x + nx * d;
      const py = y + ny * d;
      for (const t of tall) if (px >= t.box[0] && px <= t.box[2] && py >= t.box[1] && py <= t.box[3] && pointInRing(px, py, t.p)) return [d, t.h];
    }
    return null;
  };
  for (const w of town.ways) {
    if (w.kind !== 'road' || !BRIDGED.has(w.cls) || w.bridge) continue;
    const cum = measure(w.pts);
    const L = cum[cum.length - 1];
    if (L < 24) continue;
    const [x, y, ux, uy] = at(w.pts, cum, L / 2);
    const [k0, k1] = B.key(x, y);
    if (hash(k0, k1, B.set.seed, 12460) >= 0.5) continue;
    const a = hit(x, y, -uy, ux);
    const b = hit(x, y, uy, -ux);
    if (!a || !b || a[0] + b[0] < 12 || a[0] + b[0] > 30) continue;
    const z = Math.round((Math.min(a[1], b[1]) * 0.5) / 3.5) * 3.5;
    if (z < 7) continue;
    solids.push(bridge(x + uy * a[0], y - ux * a[0], x - uy * b[0], y + ux * b[0], ux, uy, z));
  }
  return none;
}

/** A planted footbridge from (ax, ay) to (bx, by) at height z, 3 m wide along (ux, uy): deck, rails, a truss below and a hedge along it. */
function bridge(ax: number, ay: number, bx: number, by: number, ux: number, uy: number, z: number): Solid {
  const s = newSolid();
  const hw = 1.5;
  const P = (t: number, side: number, h: number) => [ax + (bx - ax) * t + ux * hw * side, ay + (by - ay) * t + uy * hw * side, h];
  s.faces.push([[...P(0, -1, z), ...P(1, -1, z), ...P(1, 1, z), ...P(0, 1, z)]]);
  s.shade = [[[...P(0, -1, z), ...P(1, -1, z), ...P(1, 1, z), ...P(0, 1, z)]]];
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(3, Math.round(len / 2.5));
  for (const side of [-1, 1]) {
    s.lines.push({ pen: LINEWORK, pts: [...P(0, side, z), ...P(1, side, z)] });
    s.lines.push({ pen: LINEWORK, pts: [...P(0, side, z + 1.1), ...P(1, side, z + 1.1)] });
    s.lines.push({ pen: LINEWORK, pts: [...P(0, side, z - 1.4), ...P(1, side, z - 1.4)] });
    // A Warren truss under each edge.
    const zig: number[] = [];
    for (let k = 0; k <= n; k++) zig.push(...P(k / n, side, k % 2 ? z - 1.4 : z));
    s.lines.push({ pen: LINEWORK, pts: zig });
  }
  // A low hedge down the middle of the deck.
  const hedge: number[] = [];
  for (let k = 0; k <= n * 2; k++) hedge.push(...P(k / (n * 2), 0, z + (k % 2 ? 0.9 : 0.55)));
  s.lines.push({ pen: GREENERY, pts: hedge });
  return s;
}
