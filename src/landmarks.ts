import { newSolid, type Build, type Solid } from './buildings';
import type { Extra } from './infra';
import { LOD, shows } from './lod';
import { hash } from './rng';
import { deeper, GREENERY, LINEWORK } from './settings';
import { pointInRing } from './geo';
import { at, measure } from './infra';
import type { Area, Town } from './tiles';
import { corridor, fits, GroundIndex, productionFoot } from './production';
import { corners, type Rect } from './shape';

/*
 * Productive wind infrastructure from Transform, and Visionary garden bridges,
 * labelled in the catalogue as made up: community wind turbines on productive land, and planted
 * footbridges between tall buildings across side streets.
 */

/** A wind site and its complete swept-ground clearance, planned before masks and trees. */
export type WindSite = { x: number; y: number; phase: number; hub: number; blade: number; envelope: Rect };

/** Cell spacing in Web Mercator metres; neighbours also obey a true-metre separation. */
const CELL = 360;
const productive = (a: Area) => ['farmland', 'farmyard', 'industrial'].includes(a.cls) || (a.cls === 'meadow' && a.sub === 'meadow');

/** Map-fixed wind sites on mapped productive land, with no sheet-ranked count limit. */
export function planWind(B: Build, town: Town): WindSite[] {
  if (!B.future || !B.set.ground || !deeper(B.set, 'transform')) return [];
  const context = town.windContext;
  const land = context?.land ?? [...town.nearby.landuse, ...town.cover];
  const parcels = land.filter(productive);
  if (!parcels.length) return [];
  const ground = new GroundIndex();
  for (const s of context?.obstacles ?? [...town.water, ...town.pools, ...town.wood, ...town.green, ...town.plazas, ...town.aprons,
    ...town.cover.filter((a) => !productive(a)).map((a) => a.shape)]) ground.add(s[0].pts);
  // An industrial land-use polygon may overlap residential or protected ground: decline it.
  for (const a of land) if (!productive(a)) ground.add(a.shape[0].pts);
  for (const w of context?.ways ?? [...town.nearby.ways, ...town.runways]) corridor(ground, w.pts, Math.max(w.width / 2, 2) + 5);
  for (const w of context?.streams ?? town.streams) corridor(ground, w.pts, w.width / 2 + 5);
  for (const b of town.buildings) { const foot = productionFoot(b); if (foot) ground.add(foot); }
  const buildings = (context?.buildings ?? town.buildings.map((b) => b.shape)).map((s) => {
    const p = s[0].pts;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let q = 0; q < p.length; q += 2) { x0 = Math.min(x0, p[q]); y0 = Math.min(y0, p[q + 1]); x1 = Math.max(x1, p[q]); y1 = Math.max(y1, p[q + 1]); }
    return [x0, y0, x1, y1];
  });
  const [ox, oy] = B.toAbs(0, 0), metre = B.toAbs(1, 0)[0] - ox;
  const point = (i: number, j: number) => {
    const h = (k: number) => hash(i, j, B.set.seed, 12520 + k);
    return { x: ((i + 0.35 + 0.3 * h(1)) * CELL - ox) / metre, y: ((j + 0.35 + 0.3 * h(2)) * CELL - oy) / metre, rank: h(0), phase: h(3), large: h(4) < 0.4 };
  };
  const [x0, y0, x1, y1] = B.cam.region(80);
  const [ax, ay] = B.toAbs(x0, y0), [bx, by] = B.toAbs(x1, y1);
  const sites: WindSite[] = [], reach = Math.ceil(100 * metre / CELL) + 1;
  for (let i = Math.floor(Math.min(ax, bx) / CELL); i <= Math.ceil(Math.max(ax, bx) / CELL); i++) {
    for (let j = Math.floor(Math.min(ay, by) / CELL); j <= Math.ceil(Math.max(ay, by) / CELL); j++) {
      const p = point(i, j);
      if (p.rank >= 0.8) continue;
      // Compare even ineligible neighbours: removing a map feature never promotes another site.
      let crowded = false;
      for (let di = -reach; di <= reach && !crowded; di++) for (let dj = -reach; dj <= reach; dj++) {
        if (!di && !dj) continue;
        const q = point(i + di, j + dj);
        if ((q.rank < p.rank || (q.rank === p.rank && (di < 0 || (!di && dj < 0)))) && Math.hypot(p.x - q.x, p.y - q.y) < 100) { crowded = true; break; }
      }
      if (crowded) continue;
      for (const large of deeper(B.set, 'visionary') && p.large ? [true, false] : [false]) {
        const hub = large ? 48 : 24, blade = large ? 24 : 11, radius = blade + 6;
        const envelope = { cx: p.x, cy: p.y, ux: 1, uy: 0, L: radius * 2, w: radius * 2 };
        if (!parcels.some((a) => (!large || a.cls === 'farmland' || (a.cls === 'meadow' && a.sub === 'meadow')) && fits(envelope, a.shape)) || !ground.clear(corners(envelope))) continue;
        const clearance = large ? 80 : 35;
        if (buildings.some(([a, b, c, d]) => Math.hypot(Math.max(a - p.x, 0, p.x - c), Math.max(b - p.y, 0, p.y - d)) < clearance)) continue;
        sites.push({ x: p.x, y: p.y, phase: p.phase, hub, blade, envelope });
        break;
      }
    }
  }
  return sites;
}

/** Draw the planned machines; changing level of detail never selects another site. */
export function windTurbines(B: Build, sites: WindSite[]): Extra {
  const solids = sites.filter((p) => shows(B.cam, LOD.turbine, p.blade)).map((p) => turbine(B, p.x, p.y, p.phase, p.hub, p.blade));
  return { solids, draw: () => {} };
}

/** A turbine: a tapering tower, the nacelle, and three blades turned to the wind, at an angle fixed by `v`. */
function turbine(B: Build, x: number, y: number, v: number, HUB: number, BLADE: number): Solid {
  const s = newSolid();
  const { cam } = B;
  const scale = HUB / 78;
  // The rotor faces the prevailing wind; its disc is drawn edge-on to that direction.
  const wx = 0.8;
  const wy = 0.6;
  const px = -wy;
  const py = wx;
  // Tower: two tapering lines, as seen across the view.
  const ax = cam.cb;
  const ay = -cam.sb;
  if (shows(cam, LOD.turbineDetail, 2.2 * scale)) {
    for (const sign of [-1, 1]) s.lines.push({ pen: LINEWORK, pts: [x + sign * ax * 2.2 * scale, y + sign * ay * 2.2 * scale, 0, x + sign * ax * 1.1 * scale, y + sign * ay * 1.1 * scale, HUB - 1.6 * scale] });
  } else {
    // Put the single stroke on the near surface, so the shaft does not hide its own centre line.
    s.lines.push({ pen: LINEWORK, pts: [x - cam.sb * 2.2 * scale, y - cam.cb * 2.2 * scale, 0, x - cam.sb * 1.1 * scale, y - cam.cb * 1.1 * scale, HUB - 1.6 * scale] });
  }
  const foot: number[] = [];
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, b = (k + 1) * Math.PI / 4;
    const at = (a: number, r: number, z: number) => [x + Math.cos(a) * r * scale, y + Math.sin(a) * r * scale, z];
    foot.push(...at(a, 2.2, 0).slice(0, 2));
    s.faces.push([[...at(a, 2.2, 0), ...at(b, 2.2, 0), ...at(b, 1.1, HUB), ...at(a, 1.1, HUB)]]);
  }
  s.casts.push({ ring: foot, h: HUB });
  // Nacelle: a box along the wind.
  const box = (u: number, w: number, z: number) => [x + (wx * u + px * w) * scale, y + (wy * u + py * w) * scale, HUB + (z - HUB) * scale];
  const corners = [box(-5, -1.6, HUB - 1.6), box(5, -1.6, HUB - 1.6), box(5, 1.6, HUB - 1.6), box(-5, 1.6, HUB - 1.6)];
  const tops = corners.map(([cx, cy]) => [cx, cy, HUB + 1.6 * scale]);
  if (shows(cam, LOD.turbineDetail, 3.2 * scale)) {
    for (const ring of [corners, tops]) s.lines.push({ pen: LINEWORK, pts: ring.flat(), closed: true });
    for (let k = 0; k < 4; k++) s.lines.push({ pen: LINEWORK, pts: [...corners[k], ...tops[k]] });
    s.faces.push([corners.flat()], [tops.flat()]);
    for (let k = 0; k < 4; k++) s.faces.push([[...corners[k], ...corners[(k + 1) % 4], ...tops[(k + 1) % 4], ...tops[k]]]);
  } else {
    // A narrow nacelle becomes a coupling stroke, keeping rotor and shaft visibly joined.
    s.lines.push({ pen: LINEWORK, pts: [x - cam.sb * 1.1 * scale, y - cam.cb * 1.1 * scale, HUB - 1.6 * scale, ...box(5.6, 0, HUB)] });
  }
  // Blades in the rotor plane (across the wind, vertical), from the hub in front of the nacelle.
  const hx = x + wx * 5.6 * scale;
  const hy = y + wy * 5.6 * scale;
  const phase = v * Math.PI * 2;
  for (let k = 0; k < 3; k++) {
    const a = phase + (k / 3) * Math.PI * 2;
    const at = (r: number, off: number) => {
      const c = Math.cos(a);
      const sn = Math.sin(a);
      // Along the blade (r) and across it (off), in the rotor plane.
      return [hx + px * (c * r - sn * off * scale), hy + py * (c * r - sn * off * scale), HUB + sn * r + c * off * scale];
    };
    const blade = [...at(1, 0.9), ...at(BLADE * 0.3, 1.4), ...at(BLADE, 0.2), ...at(BLADE, -0.2), ...at(BLADE * 0.3, -0.6), ...at(1, -0.9)];
    s.faces.push([blade]);
    if (shows(cam, LOD.turbineDetail, 2 * scale)) s.lines.push({ pen: LINEWORK, pts: blade, closed: true });
    else s.lines.push({ pen: LINEWORK, pts: [...at(0, 0), ...at(BLADE, 0)] });
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
