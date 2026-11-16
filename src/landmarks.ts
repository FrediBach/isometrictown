import { newSolid, type Build, type Solid } from './buildings';
import { FIELD, MEADOW, WETLAND, type Ground } from './ground';
import type { Extra } from './infra';
import { LOD, shows } from './lod';
import type { Masks } from './nature';
import type { Paper } from './raster';
import { hash } from './rng';
import { LINEWORK } from './settings';
import type { Town } from './tiles';

/*
 * District landmarks at depth Visionary (docs/solarpunk/bolder-plan.md §7): rare by design, and
 * labelled in the catalogue as made up. For now, community wind turbines on open land.
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
