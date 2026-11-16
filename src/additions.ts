import { newSolid, prism, tagLines, type Build, type Solid } from './buildings';
import { CLIMATES, doorEdge, motifBudget } from './future';
import { LOD, shows, spaced } from './lod';
import { hash } from './rng';
import { GREENERY, LINEWORK, ROOFS } from './settings';
import { onMask, place, rect, type Extra } from './infra';
import type { Masks } from './nature';
import type { Paper } from './raster';
import type { Building, Town } from './tiles';

/*
 * Solarpunk additions to buildings (docs/solarpunk/implementation-plan.md §7.2): balcony frames
 * on posts along apartment slabs, porches, verandas, arcades and vestibules over front doors,
 * entrance canopies, sun fins on towers and trellises on blank walls. Each stands on its own
 * supports or a planter, keeps the building behind it legible, and is planned by `planFuture()`.
 */

/** A frame along wall edge e: position at u along it, d out from it, height z. */
function along(p: number[], e: number) {
  const n = p.length / 2;
  const j = (e + 1) % n;
  const ax = p[e * 2];
  const ay = p[e * 2 + 1];
  const dx = p[j * 2] - ax;
  const dy = p[j * 2 + 1] - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Outward, away from the building (outer rings run counter-clockwise).
  const nx = uy;
  const ny = -ux;
  const P = (u: number, d: number, z: number) => [ax + ux * u + nx * d, ay + uy * u + ny * d, z];
  return { P, len, nx, ny, ux, uy };
}

/** The ground under a strip in front of an edge, as a ring for the footprint mask. */
function strip(P: (u: number, d: number, z: number) => number[], u0: number, u1: number, d: number): number[] {
  return [P(u0, 0, 0), P(u1, 0, 0), P(u1, d, 0), P(u0, d, 0)].flatMap(([x, y]) => [x, y]);
}

/** Wall height of a building as built, or a fair guess where the roof didn't record it. */
function eave(B: Build, b: Building): number {
  return b.future?.eave ?? b.h * B.set.heightScale * 0.85;
}

/** Whatever the plan adds to this building, appended to its solids. */
export function additions(B: Build, b: Building, out: Solid[]): void {
  const f = b.future;
  if (!B.future || !f?.addition || !b.info) return;
  const s = newSolid();
  switch (f.addition) {
    case 'frame':
      tagLines(B, 'additions', s, () => frame(B, b, s), f.wonder ? 'frame/wonder' : 'frame');
      break;
    case 'porch':
    case 'canopy':
      tagLines(B, 'additions', s, () => porch(B, b, s), f.addition === 'canopy' ? 'entrance-canopy' : CLIMATES[B.future.climate].porch);
      break;
    case 'fins':
      tagLines(B, 'additions', s, () => fins(B, b, s), 'fins');
      break;
    case 'trellis':
      tagLines(B, 'additions', s, () => trellis(B, b, s), 'trellis');
      break;
  }
  if (s.faces.length || s.lines.length) out.push(s);
}

/**
 * A balcony frame along a slab: posts down to the ground at every bay, a deck at every floor
 * with a rail, some bays closed in as winter gardens where it is cold, a shade rail under each
 * floor where it is hot. The district's wonder has planters along its rails.
 */
function frame(B: Build, b: Building, s: Solid): void {
  const f = b.future!;
  const { cam, style } = B;
  const { P, len } = along(b.shape[0].pts, f.side!);
  const D = 2.4;
  const H = eave(B, b);
  const floor = style.floor;
  const levels: number[] = [];
  for (let z = floor; z <= H - 1.2; z += floor) levels.push(z);
  if (!levels.length) return;
  f.strip = strip(P, 0.3, len - 0.3, D);
  if (!shows(cam, LOD.frame, D)) return;
  const C = CLIMATES[B.future!.climate];
  const top = levels[levels.length - 1];
  const nb = Math.max(2, Math.round((len - 0.6) / 3.4));
  const bw = (len - 0.6) / nb;
  const u = (k: number) => 0.3 + k * bw;
  const rail = shows(cam, LOD.balconyRail, 1.0);
  // Floors close together on paper keep every other rail; posts likewise keep every other bay.
  const every = shows(cam, LOD.floors, floor) ? 1 : 2;
  const postStep = Math.max(1, Math.ceil(spaced(cam, bw, 1.0) / bw - 1e-6));
  const flat = (pts: number[][]) => pts.flat();
  // Washing hung out on a few balconies, close up only: signs of life come last.
  const life = motifBudget(B, b) >= 3 && shows(cam, LOD.washing, bw);
  levels.forEach((z, li) => {
    s.faces.push([flat([P(u(0), 0, z), P(u(nb), 0, z), P(u(nb), D, z), P(u(0), D, z)])]);
    if (li % every && z !== top) return;
    s.lines.push({ pen: LINEWORK, pts: flat([P(u(0), 0, z), P(u(0), D, z), P(u(nb), D, z), P(u(nb), 0, z)]) });
    if (rail) s.lines.push({ pen: LINEWORK, pts: flat([P(u(0), 0, z + 1), P(u(0), D, z + 1), P(u(nb), D, z + 1), P(u(nb), 0, z + 1)]) });
    if (C.gallery && rail) s.lines.push({ pen: ROOFS, pts: flat([P(u(0), D, z + floor - 0.45), P(u(nb), D, z + floor - 0.45)]) });
    for (let k = 0; k < nb; k++) {
      const [k0, k1] = B.key(...(P(u(k + 0.5), D, 0).slice(0, 2) as [number, number]));
      const h = (salt: number) => hash(k0, k1, B.seed, salt + li * 7);
      // Winter gardens: a glazed bay with a mullion, hiding the wall behind it.
      if (z + floor - 0.3 <= top + floor && h(12150) < C.winter) {
        const z1 = z + floor - 0.3;
        s.faces.push([flat([P(u(k) + 0.05, D, z), P(u(k + 1) - 0.05, D, z), P(u(k + 1) - 0.05, D, z1), P(u(k) + 0.05, D, z1)])]);
        s.lines.push({ pen: LINEWORK, pts: flat([P(u(k), D, z1), P(u(k + 1), D, z1)]) }, { pen: LINEWORK, pts: flat([P(u(k + 0.5), D, z), P(u(k + 0.5), D, z1)]) });
      } else if (life && h(12155) < 0.2) {
        const a = u(k) + 0.3;
        const c = u(k + 1) - 0.3;
        const m = (a + c) / 2;
        s.lines.push({ pen: LINEWORK, pts: flat([P(a, D - 0.3, z + 1.95), P(m, D - 0.3, z + 1.8), P(c, D - 0.3, z + 1.95)]) });
        for (const t of [0.25, 0.5, 0.75]) {
          if (h(12156 + t * 4) < 0.25) continue;
          const x = a + (c - a) * t;
          const top = z + 1.95 - 0.6 * (1 - Math.abs(2 * t - 1)) * 0.25;
          s.lines.push({ pen: ROOFS, pts: flat([P(x - 0.25, D - 0.3, top), P(x - 0.25, D - 0.3, top - 0.55), P(x + 0.25, D - 0.3, top - 0.55), P(x + 0.25, D - 0.3, top)]) });
        }
      } else if (f.wonder && rail && h(12152) < 0.6) {
        // The wonder's planters: plants spilling over the rail.
        const g: number[] = [];
        for (let t = 0.15, q = 0; t <= 0.85 + 1e-6; t += 0.14, q++) g.push(...P(u(k + t), D + 0.05, z + 1 + (q % 2 ? 0.35 : 0.05)));
        s.lines.push({ pen: GREENERY, pts: g });
      }
    }
  });
  for (let k = 0; k <= nb; k += postStep) s.lines.push({ pen: LINEWORK, pts: flat([P(u(k), D, 0), P(u(k), D, top + 1)]) });
  if (nb % postStep) s.lines.push({ pen: LINEWORK, pts: flat([P(u(nb), D, 0), P(u(nb), D, top + 1)]) });
  s.shade = [[flat([P(u(0), 0, top), P(u(nb), 0, top), P(u(nb), D, top), P(u(0), D, top)])]];
}

/**
 * Over the front door: a porch on two posts, a veranda the length of the wall, a deep arcade,
 * a glazed vestibule (by climate), or a flat entrance canopy on civic buildings.
 */
function porch(B: Build, b: Building, s: Solid): void {
  const f = b.future!;
  const info = b.info!;
  const { cam } = B;
  if (!info.toStreet) return;
  const wall = f.wall ?? { ...b.shape[0], party: info.party };
  const e = doorEdge(wall, info.toStreet);
  if (e < 0) return;
  const { P, len } = along(wall.pts, e);
  // Where the facade drew the door: the middle bay, or the middle of a band of glazing.
  const fa = info.facade;
  const cols = Math.max(1, Math.floor(len / fa.bay));
  const door = fa.pattern === 'ribbon' || fa.pattern === 'curtain' ? len / 2 : ((Math.floor(cols / 2) + 0.5) * len) / cols;
  const kind = f.addition === 'canopy' ? 'canopy' : CLIMATES[B.future!.climate].porch;
  const He = eave(B, b);
  const half = kind === 'veranda' ? len / 2 - 0.3 : kind === 'arcade' ? 2.2 : kind === 'canopy' ? 1.6 : kind === 'vestibule' ? 1.1 : 1.3;
  const mid = kind === 'veranda' ? len / 2 : door;
  const u0 = Math.max(0.2, mid - half);
  const u1 = Math.min(len - 0.2, mid + half);
  if (u1 - u0 < 1.6) return;
  const D = kind === 'veranda' || kind === 'arcade' ? 2.4 : kind === 'canopy' ? 2.2 : kind === 'vestibule' ? 1.6 : 1.7;
  f.strip = strip(P, u0, u1, D);
  if (!shows(cam, LOD.porch, D)) return;
  const flat = (pts: number[][]) => pts.flat();
  if (kind === 'vestibule') {
    const ring = strip(P, u0, u1, D);
    prism(B, [{ pts: ring, seam: new Uint8Array(4) }], 0, Math.min(2.5, He - 0.2), { roof: true, windows: false, pen: LINEWORK }, s);
    s.casts.push({ ring, h: 2.5 });
    const zt = Math.min(2.5, He - 0.2);
    s.lines.push({ pen: LINEWORK, pts: flat([P((u0 + u1) / 2, D, 0), P((u0 + u1) / 2, D, zt)]) }, { pen: LINEWORK, pts: flat([P(u0, D, 2.0), P(u1, D, 2.0)]) });
    return;
  }
  const zw = Math.min(He - 0.25, kind === 'canopy' ? 3.3 : 2.8);
  if (zw < 2.2) return;
  const zf = kind === 'canopy' ? zw : zw - 0.4;
  const roof = [P(u0, 0, zw), P(u1, 0, zw), P(u1, D, zf), P(u0, D, zf)];
  s.faces.push([flat(roof)]);
  s.lines.push({ pen: LINEWORK, pts: flat(roof), closed: true });
  s.shade = [[flat(roof)]];
  // The roof's boards or slats, across it, where they keep apart on paper.
  const step = spaced(cam, 0.5, 1.0);
  if (step * 3 < u1 - u0)
    for (let t = u0 + step; t < u1 - step / 2; t += step) s.lines.push({ pen: ROOFS, pts: flat([P(t, 0, zw), P(t, D, zf)]) });
  const posts = kind === 'veranda' || kind === 'arcade' ? Math.max(2, Math.round((u1 - u0) / 2.5) + 1) : 2;
  for (let k = 0; k < posts; k++) {
    const t = u0 + 0.15 + ((u1 - u0 - 0.3) * k) / (posts - 1);
    s.lines.push({ pen: LINEWORK, pts: flat([P(t, D - 0.15, 0), P(t, D - 0.15, zf)]) });
  }
}

/** Fins on the sunny walls of a tower, every metre and a half from the first floor up. */
function fins(B: Build, b: Building, s: Solid): void {
  const { cam } = B;
  if (!shows(cam, LOD.fins, 1.5)) return;
  const ring = b.shape[0];
  const p = ring.pts;
  const H = eave(B, b);
  const [upx, upy] = cam.up;
  const [sx, sy] = B.sun;
  const step = spaced(cam, 1.5, 0.9);
  for (let e = 0; e < p.length / 2; e++) {
    if (ring.seam[e] || (b.info!.party[e] ?? 0) > 0) continue;
    const { P, len, nx, ny } = along(p, e);
    // Only walls turned towards the viewer show, and only those facing the sun need shading.
    if (nx * upx + ny * upy >= 0 || nx * sx + ny * sy < 0.2 || len < 4) continue;
    for (let u = 1; u <= len - 1 + 1e-6; u += step) {
      s.faces.push([[...P(u, 0, 4), ...P(u, 0.6, 4), ...P(u, 0.6, H - 0.5), ...P(u, 0, H - 0.5)]]);
      s.lines.push({ pen: LINEWORK, pts: [...P(u, 0.6, 4), ...P(u, 0.6, H - 0.5)] });
    }
  }
}

/** A trellis on a blank wall: a planter at its foot, a light grid, and climbers partway up it. */
function trellis(B: Build, b: Building, s: Solid): void {
  const f = b.future!;
  const { cam } = B;
  const { P, len } = along(b.shape[0].pts, f.side!);
  const zt = Math.min(eave(B, b) - 0.6, 4.5);
  if (zt < 2.5) return;
  f.strip = strip(P, 0.4, len - 0.4, 0.5);
  if (!shows(cam, LOD.trellis, 0.9)) return;
  const ring = strip(P, 0.4, len - 0.4, 0.45);
  prism(B, [{ pts: ring, seam: new Uint8Array(4) }], 0, 0.5, { roof: true, windows: false, pen: LINEWORK }, s);
  const step = spaced(cam, 0.9, 0.9);
  for (const z of [1.8, zt]) s.lines.push({ pen: LINEWORK, pts: [...P(0.6, 0.15, z), ...P(len - 0.6, 0.15, z)] });
  for (let u = 0.6; u <= len - 0.6 + 1e-6; u += step) {
    s.lines.push({ pen: LINEWORK, pts: [...P(u, 0.15, 0.5), ...P(u, 0.15, zt)] });
    const [k0, k1] = B.key(...(P(u, 0, 0).slice(0, 2) as [number, number]));
    const reach = 0.5 + (zt - 0.5) * (0.35 + 0.6 * hash(k0, k1, B.seed, 12160));
    const g: number[] = [];
    for (let z = 0.5, q = 0; z <= reach; z += 0.45, q++) g.push(...P(u + (q % 2 ? 0.18 : -0.18), 0.2, z));
    if (g.length >= 6) s.lines.push({ pen: GREENERY, pts: g });
  }
}

/**
 * A pergola: posts every three metres along both long sides, a beam on each, and slats across
 * where they keep apart on paper. Where it is hot and dry, shade cloth over it casts a shadow.
 * Centred on x, y, length L along ux, uy, width W, top at z.
 */
export function pergola(B: Build, s: Solid, x: number, y: number, ux: number, uy: number, L: number, W: number, z = 2.8): void {
  const P = (a: number, c: number, h: number) => [x + ux * a - uy * c, y + uy * a + ux * c, h];
  const n = Math.max(1, Math.round(L / 3));
  for (const c of [-W / 2, W / 2]) {
    s.lines.push({ pen: LINEWORK, pts: [...P(-L / 2, c, z), ...P(L / 2, c, z)] });
    for (let k = 0; k <= n; k++) s.lines.push({ pen: LINEWORK, pts: [...P(-L / 2 + (L * k) / n, c, 0), ...P(-L / 2 + (L * k) / n, c, z)] });
  }
  const step = spaced(B.cam, 0.6, 1.0);
  if (step * 4 < L) for (let a = -L / 2 + step / 2; a < L / 2; a += step) s.lines.push({ pen: ROOFS, pts: [...P(a, -W / 2 - 0.3, z + 0.12), ...P(a, W / 2 + 0.3, z + 0.12)] });
  if (B.future?.climate === 'hot_dry') {
    const top = [P(-L / 2, -W / 2, z + 0.15), P(L / 2, -W / 2, z + 0.15), P(L / 2, W / 2, z + 0.15), P(-L / 2, W / 2, z + 0.15)].flat();
    s.faces.push([top]);
    s.shade = [...(s.shade ?? []), [top]];
  }
}

/** A market stall: a table on legs under a striped cloth roof sloping to the front, like an awning. */
export function stall(s: Solid, x: number, y: number, ux: number, uy: number): void {
  const P = (a: number, c: number, h: number) => [x + ux * a - uy * c, y + uy * a + ux * c, h];
  const table = [P(-1.2, -0.6, 0.9), P(1.2, -0.6, 0.9), P(1.2, 0.6, 0.9), P(-1.2, 0.6, 0.9)].flat();
  s.faces.push([table]);
  s.lines.push({ pen: LINEWORK, pts: table, closed: true });
  for (const a of [-1.15, 1.15]) {
    s.lines.push({ pen: LINEWORK, pts: [...P(a, -0.6, 0), ...P(a, -0.6, 2.3)] }, { pen: LINEWORK, pts: [...P(a, 0.6, 0), ...P(a, 0.6, 0.9)] });
  }
  const roof = [P(-1.35, -0.75, 2.3), P(1.35, -0.75, 2.3), P(1.35, 0.95, 1.95), P(-1.35, 0.95, 1.95)].flat();
  s.faces.push([roof]);
  s.lines.push({ pen: LINEWORK, pts: roof, closed: true });
  for (let a = -1.35 + 0.45; a < 1.35; a += 0.9) s.lines.push({ pen: ROOFS, pts: [...P(a, -0.75, 2.3), ...P(a, 0.95, 1.95)] });
  s.shade = [...(s.shade ?? []), [roof]];
}

/** Places a shaded outdoor classroom goes: schools and kindergartens. */
const YARDS = new Set(['school', 'kindergarten']);

/** Pergolas in school yards: an outdoor classroom on the nearest clear ground, one per school. */
export function yardPergolas(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const solids: Solid[] = [];
  const none = { solids, draw: () => {} };
  if (!B.future || !shows(B.cam, LOD.pergola, 3)) return none;
  const f = Math.max(0, Math.min(1, B.set.future));
  const clear = (x: number, y: number) => !onMask(paper, M.road, x, y) && !onMask(paper, M.foot, x, y) && !onMask(paper, M.water, x, y);
  const placed: [number, number][] = [];
  for (const p of town.pois) {
    if (!YARDS.has(p.cls) || placed.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 80)) continue;
    const [k0, k1] = B.key(p.x, p.y);
    const h = (salt: number) => hash(k0, k1, B.set.seed, 12170 + salt);
    if (h(0) >= 0.5 + 0.4 * f) continue;
    search: for (let r = 10; r <= 50; r += 5)
      for (let q = 0; q < 12; q++) {
        const a = ((q + h(1)) / 12) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const y = p.y + Math.sin(a) * r;
        const ux = Math.cos(a + Math.PI / 2);
        const uy = Math.sin(a + Math.PI / 2);
        if (![-4.5, 0, 4.5].every((t) => [-2.6, 2.6].every((c) => clear(x + ux * t - uy * c, y + uy * t + ux * c)))) continue;
        const s = newSolid();
        pergola(B, s, x, y, ux, uy, 8, 4);
        // An outdoor classroom: two benches under it, children about.
        for (const c of [-0.9, 0.9]) {
          const P = (a: number, z: number) => [x + ux * a - uy * c, y + uy * a + ux * c, z];
          s.lines.push({ pen: LINEWORK, pts: [...P(-2.5, 0.45), ...P(2.5, 0.45)] });
          for (const a of [-2.2, 2.2]) s.lines.push({ pen: LINEWORK, pts: [...P(a, 0), ...P(a, 0.45)] });
        }
        solids.push(s);
        B.future.gather.push([x, y, 4 + Math.floor(h(2) * 4), 6, true]);
        // Racks and people keep out from under it.
        paper.fillMask(M.foot, [place(x, y, ux, uy, rect(-4, 4, -2, 2))]);
        placed.push([p.x, p.y]);
        break search;
      }
  }
  return none;
}
