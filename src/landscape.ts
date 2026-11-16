import type { Build, Solid } from './buildings';
import { REF_NIB } from './camera';
import { motifBudget } from './future';
import { GARDEN, MEADOW, WETLAND, textured, type Ground } from './ground';
import { onMask, type Extra } from './infra';
import { LOD, shows } from './lod';
import type { Masks, Tree } from './nature';
import type { Paper, Test } from './raster';
import { hash, patch } from './rng';
import { GREENERY } from './settings';
import { groundSeg } from './streets';
import type { Town } from './tiles';

/*
 * Solarpunk landscape (docs/solarpunk/implementation-plan.md, M4): meadow patches in parks,
 * reeds on soft banks and in marshes, food beds behind houses and planted edges round works.
 * Everything sits on grids or cells fixed to the map, so it stays put as the view pans.
 */

const NONE: Extra = { solids: [], draw: () => {} };

/** Symbols in sheet mm: a grass tuft as ground.ts draws it, and a fanned cluster of reeds. */
const TUFT = [
  [-0.45, -0.42],
  [-0.22, 0],
  [0, -0.55],
  [0.22, 0],
  [0.45, -0.42],
];
const REED = [
  [[-0.3, 0], [-0.6, -1.1]],
  [[0, 0], [0, -1.4]],
  [[0.3, 0], [0.6, -1.1]],
];

/** Visit a grid of `mm` paper millimetres (scaled by Detail and pen), fixed to the map, over the area that can show. */
function grid(B: Build, mm: number, fn: (x: number, y: number, i: number, j: number) => void): void {
  const { cam } = B;
  const box = cam.region(0);
  const [ox, oy] = B.toAbs(0, 0);
  const metre = B.toAbs(1, 0)[0] - ox;
  const step = (cam.gap(mm) / cam.s) * metre;
  const [A0x, A0y] = B.toAbs(box[0], box[1]);
  const [A1x, A1y] = B.toAbs(box[2], box[3]);
  const i0 = Math.floor(A0x / step);
  const i1 = Math.ceil(A1x / step);
  const j0 = Math.floor(A0y / step);
  const j1 = Math.ceil(A1y / step);
  if ((i1 - i0) * (j1 - j0) > 600000) return;
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const r = (salt: number) => hash(i, j, B.set.seed, salt);
      fn(((i + 0.1 + 0.8 * r(12201)) * step - ox) / metre, ((j + 0.1 + 0.8 * r(12202)) * step - oy) / metre, i, j);
    }
}

/**
 * Where a solarpunk park is left to grow as meadow: smooth patches fixed to the map, about a
 * third of the park, in sheet coordinates. The lawn hatch leaves them out; `parkMeadow()` draws them.
 */
export function meadowPatches(B: Build): (sx: number, sy: number) => boolean {
  const { cam } = B;
  return (sx, sy) => {
    const [x, y] = cam.ground(sx, sy);
    const [X, Y] = B.toAbs(x, y);
    return patch(X / 40, Y / 40, B.set.seed, 12210) > 0.62;
  };
}

/** Grass tufts over the meadow patches of parks, clear of paths, pitches, buildings and shadow. */
export function parkMeadow(B: Build, paper: Paper, M: Masks, G: Ground | null, meadow: (sx: number, sy: number) => boolean, paths?: Uint8Array): void {
  const { cam } = B;
  const k = Math.max(1, cam.nib / REF_NIB);
  const keep: Test = (x, y, d) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && paper.seen(x, y, d);
  grid(B, 3.2 * 1.5, (x, y, i, j) => {
    const sx = cam.sx(x, y);
    const sy = cam.sy(x, y, 0);
    if (!paper.on(M.green, sx, sy) || paper.on(M.wood, sx, sy) || paper.on(M.foot, sx, sy) || paper.on(M.shadow, sx, sy) || !meadow(sx, sy)) return;
    if ((paths && paper.on(paths, sx, sy)) || (G && textured(G, paper, sx, sy)) || hash(i, j, B.set.seed, 12211) < 0.25) return;
    paper.sheet(GREENERY, TUFT.flatMap(([dx, dy]) => [sx + dx * k, sy + dy * k, cam.depth(x, y, 0)]), keep);
    paper.end();
  });
}

/**
 * Reeds: fanned clusters along soft banks, a metre or two from the water, where the ground is
 * park, meadow, marsh, garden or open country; never along quays, roads or buildings. Marshes
 * get them all over, sparsely.
 */
export function reeds(B: Build, paper: Paper, M: Masks, G: Ground | null, paths?: Uint8Array): void {
  const { cam } = B;
  if (!B.future || !shows(cam, LOD.reed)) return;
  const k = Math.max(1, cam.nib / REF_NIB);
  const keep: Test = (x, y, d) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && paper.seen(x, y, d);
  const reach = 1.8;
  const dirs = [0, 1, 2, 3, 4, 5].map((q) => [Math.cos((q * Math.PI) / 3) * reach, Math.sin((q * Math.PI) / 3) * reach]);
  grid(B, 2.6, (x, y, i, j) => {
    const sx = cam.sx(x, y);
    const sy = cam.sy(x, y, 0);
    if (paper.on(M.water, sx, sy) || paper.on(M.road, sx, sy) || paper.on(M.foot, sx, sy) || paper.on(M.pool, sx, sy)) return;
    if (paths && paper.on(paths, sx, sy)) return;
    const land = G ? paper.at(G.land, sx, sy) : 0;
    const soft = paper.on(M.green, sx, sy) || land === MEADOW || land === WETLAND || land === GARDEN || (!!G && !G.inTown(x, y, sx, sy));
    if (!soft || paper.on(M.wood, sx, sy)) return;
    // A bank beside a road is a quay or an embankment, not a shore for reeds.
    if (dirs.some(([dx, dy]) => onMask(paper, M.road, x + dx * 1.7, y + dy * 1.7))) return;
    const bank = dirs.some(([dx, dy]) => onMask(paper, M.water, x + dx, y + dy));
    const h = hash(i, j, B.set.seed, 12212);
    if (!(bank ? h < 0.6 : land === WETLAND && h < 0.22)) return;
    const d = cam.depth(x, y, 0);
    for (const [[ax, ay], [bx, by]] of REED) {
      paper.sheet(GREENERY, [sx + ax * k, sy + ay * k, d, sx + bx * k, sy + by * k, d], keep);
      paper.end();
    }
  });
}

/**
 * Food beds behind houses: three long beds side by side in the back garden, with a row marked
 * down each. Only on garden ground, clear of buildings, roads and water.
 */
export function gardenBeds(B: Build, paper: Paper, town: Town, G: Ground | null, M: Masks): Extra {
  if (!B.future || !G) return NONE;
  const { cam } = B;
  const f = Math.max(0, Math.min(1, B.set.future));
  const beds: number[][][] = [];
  for (const b of town.buildings) {
    const i = b.info;
    if (b.future?.recipe !== 'B01' || b.future.eave === undefined || !i?.toStreet) continue;
    const p = b.shape[0].pts;
    const n = p.length / 2;
    let cx = 0;
    let cy = 0;
    for (let q = 0; q < n; q++) {
      cx += p[q * 2];
      cy += p[q * 2 + 1];
    }
    cx /= n;
    cy /= n;
    const [k0, k1] = B.key(cx, cy);
    if (hash(k0, k1, B.set.seed, 12230) >= 0.2 + 0.4 * f || motifBudget(B, b) < 2) continue;
    // Behind the house: past its back wall, away from the street.
    const [tx, ty] = i.toStreet;
    let back = 0;
    for (let q = 0; q < n; q++) back = Math.max(back, -((p[q * 2] - cx) * tx + (p[q * 2 + 1] - cy) * ty));
    const ox = cx - tx * (back + 3.4);
    const oy = cy - ty * (back + 3.4);
    const ax = -ty;
    const ay = tx;
    const group: number[][] = [];
    for (const s of [-1.8, 0, 1.8]) {
      const P = (a: number, t: number) => [ox + ax * (s + a) - tx * t, oy + ay * (s + a) - ty * t];
      group.push([...P(-0.55, -1.8), ...P(0.55, -1.8), ...P(0.55, 1.8), ...P(-0.55, 1.8)]);
    }
    const ok = group.every((r) => [0, 1, 2, 3].every((q) => {
      const x = r[q * 2];
      const y = r[q * 2 + 1];
      const sx = cam.sx(x, y);
      const sy = cam.sy(x, y, 0);
      return paper.at(G.land, sx, sy) === GARDEN && !paper.on(M.foot, sx, sy) && !paper.on(M.road, sx, sy) && !paper.on(M.water, sx, sy);
    }));
    if (ok) beds.push(group);
  }
  return {
    solids: [] as Solid[],
    draw: () => {
      if (!beds.length || !shows(cam, LOD.bed, 1.1)) return;
      const test: Test = (x, y, d) => paper.seen(x, y, d);
      for (const group of beds)
        for (const r of group) {
          for (let q = 0; q < 4; q++) {
            groundSeg(paper, GREENERY, r[q * 2], r[q * 2 + 1], r[((q + 1) % 4) * 2], r[((q + 1) % 4) * 2 + 1], test);
            paper.end();
          }
          // A crop row down the middle of the bed.
          groundSeg(paper, GREENERY, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2, (r[4] + r[6]) / 2, (r[5] + r[7]) / 2, test);
          paper.end();
        }
    },
  };
}

/**
 * Planted edges round works: a hedge of bushes with the odd small tree, just inside the edges of
 * industrial land, wherever the ground is free. Each mapped edge decides as a whole.
 */
export function worksHedges(B: Build, paper: Paper, town: Town, M: Masks): Tree[] {
  const out: Tree[] = [];
  const { cam, set } = B;
  if (!B.future || set.trees <= 0 || !shows(cam, LOD.hedgerow)) return out;
  const f = Math.max(0, Math.min(1, set.future));
  const clear = (x: number, y: number) => !onMask(paper, M.road, x, y) && !onMask(paper, M.water, x, y) && !onMask(paper, M.foot, x, y) && !onMask(paper, M.wood, x, y);
  for (const a of town.landuse) {
    if (a.cls !== 'industrial') continue;
    const ring = a.shape[0];
    const p = ring.pts;
    const n = p.length / 2;
    for (let e = 0; e < n; e++) {
      // Edges cut at a tile boundary aren't real edges; their ends would move with the view.
      if (ring.seam[e]) continue;
      const g = (e + 1) % n;
      const ax = p[e * 2];
      const ay = p[e * 2 + 1];
      const len = Math.hypot(p[g * 2] - ax, p[g * 2 + 1] - ay);
      if (len < 10) continue;
      const ux = (p[g * 2] - ax) / len;
      const uy = (p[g * 2 + 1] - ay) / len;
      const [m0, m1] = B.cell(ax + ux * len * 0.5, ay + uy * len * 0.5, 2);
      if (hash(m0, m1, set.seed, 12240) >= 0.3 + 0.4 * f) continue;
      // Inside the area: to the left of a counter-clockwise ring.
      const nx = -uy;
      const ny = ux;
      for (let t = 1.5; t < len - 1.5; t += 3) {
        const x = ax + ux * t + nx * 1.6;
        const y = ay + uy * t + ny * 1.6;
        if (!clear(x, y)) continue;
        const [k0, k1] = B.key(x, y);
        const h = (salt: number) => hash(k0, k1, set.seed, 12241 + salt);
        const tree = h(0) < 0.15;
        const r = tree ? 1.8 + h(1) * 0.8 : 1.1 + h(1) * 0.4;
        out.push({ x, y, r, h: tree ? r + 3 + h(2) * 1.5 : 1.6 + h(2) * 0.6, conifer: false, bush: !tree, from: 'works-hedges' });
      }
    }
  }
  return out;
}
