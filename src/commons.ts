import { newSolid, prism, type Build, type Solid } from './buildings';
import { motifBudget } from './future';
import { hash } from './rng';
import { onMask, type Extra } from './infra';
import { LOD, shows } from './lod';
import type { Masks } from './nature';
import type { Paper } from './raster';
import { LINEWORK, WATER } from './settings';
import type { Town } from './tiles';

/*
 * Solarpunk things on the ground beside buildings and along streets
 * (docs/solarpunk/implementation-plan.md §7.3).
 */

const NONE: Extra = { solids: [], draw: () => {} };

/**
 * Rain tanks: a drum at a back corner of the house, away from the street, with a downpipe
 * from the eaves into it. Only for houses that were built (the plan records their eaves) and
 * that show their supporting change at this scale.
 */
export function rainTanks(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  if (!B.future) return NONE;
  const solids: Solid[] = [];
  for (const b of town.buildings) {
    const f = b.future;
    const i = b.info;
    if (!f?.tank || f.eave === undefined || !i) continue;
    if (motifBudget(B, b) < 2) continue;
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
    const [tx, ty] = i.toStreet ?? [0, 0];
    // The corner furthest from the street, ties broken by position.
    let best = -1;
    let far = -Infinity;
    for (let q = 0; q < n; q++) {
      if (b.shape[0].seam[q] || b.shape[0].seam[(q - 1 + n) % n]) continue;
      const [k0, k1] = B.key(p[q * 2], p[q * 2 + 1]);
      const d = -((p[q * 2] - cx) * tx + (p[q * 2 + 1] - cy) * ty) + hash(k0, k1, B.set.seed, 12050) * 0.5;
      if (d > far) {
        far = d;
        best = q;
      }
    }
    if (best < 0) continue;
    const vx = p[best * 2];
    const vy = p[best * 2 + 1];
    let ox = vx - cx;
    let oy = vy - cy;
    const ol = Math.hypot(ox, oy) || 1;
    ox /= ol;
    oy /= ol;
    const R = 0.55;
    const x = vx + ox * (R + 0.3);
    const y = vy + oy * (R + 0.3);
    const [k0, k1] = B.key(x, y);
    if (!shows(B.cam, LOD.rainTank, R * 2, hash(k0, k1, B.set.seed, 9200))) continue;
    const clear = (qx: number, qy: number) => !onMask(paper, M.road, qx, qy) && !onMask(paper, M.water, qx, qy) && !onMask(paper, M.foot, qx, qy);
    if (![[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]].every(([dx, dy]) => clear(x + dx, y + dy))) continue;
    const s = newSolid();
    const ring: number[] = [];
    for (let q = 0; q < 12; q++) ring.push(x + Math.cos((q / 12) * Math.PI * 2) * R, y + Math.sin((q / 12) * Math.PI * 2) * R);
    const top = 1.5;
    prism(B, [{ pts: ring, seam: new Uint8Array(12) }], 0, top, { roof: true, windows: false, pen: LINEWORK }, s);
    s.casts.push({ ring, h: top });
    // The downpipe runs down the corner of the house and bends over into the tank.
    const px = vx + ox * 0.12;
    const py = vy + oy * 0.12;
    const zEave = Math.max(top + 0.6, f.eave - 0.15);
    s.lines.push({ pen: WATER, pts: [px, py, zEave, px, py, top + 0.35, x, y, top + 0.35, x, y, top] });
    solids.push(s);
  }
  return { solids, draw: () => {} };
}
