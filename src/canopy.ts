import type { Build } from './buildings';
import { CLIMATES } from './future';
import { GARDEN, type Ground } from './ground';
import { LOD, thin } from './lod';
import type { Masks, Tree } from './nature';
import type { Paper } from './raster';
import { hash, patch } from './rng';
import type { Town } from './tiles';
import { urbanity } from './traffic';

/*
 * A real urban canopy (docs/solarpunk/bolder-plan.md §4): at depth Transform and beyond, trees
 * fill the free ground of town in groves of three to seven, mixed in size, on a grid fixed to
 * the map: backs of blocks, the open ground of plots, yards and works edges. Courtyards of
 * perimeter blocks get one to three big trees. How much of the town they cover follows the
 * climate's canopy target.
 */

/** Side of the grove grid, metres; one grove at most per cell. */
const CELL = 18;

/** Groves of trees on free town ground, and big trees in the courtyards of blocks. */
export function canopyTrees(B: Build, paper: Paper, town: Town, G: Ground | null, M: Masks, box: [number, number, number, number], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Tree[] {
  const { set, cam } = B;
  const out: Tree[] = [];
  if (set.trees <= 0 || !B.future) return out;
  const target = CLIMATES[B.future.climate].canopy;
  const f = Math.max(0, Math.min(1, set.future));
  // A grove covers about 120 m² of an 18 m cell; the chance is set so the groves meet the target on free ground.
  const chance = Math.min(0.95, target * 2.2 * (0.6 + 0.8 * f)) * Math.min(1, set.trees / 0.7);
  const urban = urbanity(town, toAbs);
  const clear = (x: number, y: number) => {
    const sx = cam.sx(x, y);
    const sy = cam.sy(x, y, 0);
    if (paper.on(M.foot, sx, sy) || paper.on(M.road, sx, sy) || paper.on(M.water, sx, sy) || paper.on(M.wood, sx, sy) || paper.on(M.green, sx, sy)) return false;
    // Fields, pitches, cemeteries and allotments keep their use; gardens and plain ground take trees.
    const code = G ? paper.at(G.land, sx, sy) : 0;
    return code === 0 || code === GARDEN;
  };
  const crown = (x: number, y: number, r: number) => clear(x, y) && clear(x + r, y) && clear(x - r, y) && clear(x, y + r) && clear(x, y - r);
  const step = CELL * (toAbs(1, 0)[0] - toAbs(0, 0)[0]);
  const [A0x, A0y] = toAbs(box[0], box[1]);
  const [A1x, A1y] = toAbs(box[2], box[3]);
  const i0 = Math.floor(A0x / step);
  const i1 = Math.ceil(A1x / step);
  const j0 = Math.floor(A0y / step);
  const j1 = Math.ceil(A1y / step);
  if ((i1 - i0) * (j1 - j0) > 400000) return out;
  // Trees in a grove stand about 4.5 m apart: closer than reads on paper, they thin out.
  const keep = thin(cam, LOD.treeSpacing, 4.5);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const h = (k: number) => hash(i, j, set.seed, 12320 + k);
      // Groves gather where a smooth patch fixed to the map says so, as canopy does, rather than evenly.
      const lump = Math.min(1, Math.max(0.2, (patch(i / 5, j / 5, set.seed, 12329) - 0.15) * 1.6));
      if (h(0) >= chance * lump) continue;
      const [cx, cy] = fromAbs((i + 0.3 + 0.4 * h(1)) * step, (j + 0.3 + 0.4 * h(2)) * step);
      if (urban(cx, cy) < 0.12 || (G && !G.inTown(cx, cy, cam.sx(cx, cy), cam.sy(cx, cy, 0)))) continue;
      const n = 3 + Math.floor(h(3) * 5);
      for (let t = 0; t < n; t++) {
        const ht = (k: number) => hash(i * 8 + t, j, set.seed, 12330 + k);
        if (ht(0) >= keep) continue;
        // Round the grove's centre on a loose spiral, so trees don't stack.
        const a = t * 2.4 + h(4) * 6.28;
        const d = t ? 2.6 + Math.sqrt(t) * 2.2 + ht(1) * 1.2 : 0;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        const big = ht(2) < 0.45;
        const r = big ? 2.4 + ht(3) * 1.1 : 1.3 + ht(3) * 0.8;
        if (!crown(x, y, r * 0.8)) continue;
        const conifer = ht(4) < 0.12;
        out.push({ x, y, r: conifer ? r * 0.75 : r, h: conifer ? 6 + r * 2 : r + 2.8 + ht(5) * 2.4, conifer, from: 'canopy-trees' });
      }
    }
  // Courtyards of perimeter blocks: one to three big trees in a court over 300 m².
  for (const b of town.buildings) {
    if (b.info?.kind !== 'apartment' || b.shape.length < 2) continue;
    for (let k = 1; k < b.shape.length; k++) {
      const p = b.shape[k].pts;
      let area = 0;
      let cx = 0;
      let cy = 0;
      for (let q = 0; q < p.length; q += 2) {
        const r = (q + 2) % p.length;
        const c = p[q] * p[r + 1] - p[r] * p[q + 1];
        area += c;
        cx += (p[q] + p[r]) * c;
        cy += (p[q + 1] + p[r + 1]) * c;
      }
      if (Math.abs(area / 2) < 300) continue;
      cx /= 3 * area;
      cy /= 3 * area;
      const [k0, k1] = B.key(cx, cy);
      const n = 1 + Math.floor(hash(k0, k1, set.seed, 12340) * 3);
      for (let t = 0; t < n; t++) {
        const a = t * 2.1 + hash(k0, k1, set.seed, 12341) * 6.28;
        const d = t ? 4.5 : 0;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        const r = 2.6 + hash(k0, k1, set.seed, 12342 + t) * 1;
        if (!crown(x, y, r * 0.9)) continue;
        out.push({ x, y, r, h: r + 4 + hash(k0, k1, set.seed, 12345 + t) * 2, conifer: false, from: 'courtyard-trees' });
      }
    }
  }
  return out;
}
