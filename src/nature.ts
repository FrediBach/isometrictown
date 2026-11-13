import type { Build } from './buildings';
import type { Paper } from './raster';
import { hash } from './rng';
import { GREENERY } from './settings';

export type Tree = { x: number; y: number; r: number; h: number; conifer: boolean };
export type Masks = Record<'road' | 'water' | 'green' | 'wood' | 'foot' | 'shadow', Uint8Array>;

/**
 * Scatter trees over parks and woods on a grid fixed to the map,
 * so they stay put when the view moves.
 */
export function placeTrees(B: Build, paper: Paper, M: Masks, box: [number, number, number, number], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Tree[] {
  const { set, cam } = B;
  const trees: Tree[] = [];
  if (set.trees <= 0) return trees;
  const passes: { mask: Uint8Array; cell: number; chance: number; conifer: number; salt: number }[] = [
    { mask: M.wood, cell: 6.5, chance: 0.92 * set.trees, conifer: 0.55, salt: 1 },
    { mask: M.green, cell: 12, chance: 0.55 * set.trees, conifer: 0.15, salt: 2 },
  ];
  const [A0x, A0y] = toAbs(box[0], box[1]);
  const [A1x, A1y] = toAbs(box[2], box[3]);
  for (const pass of passes) {
    const step = pass.cell * (toAbs(1, 0)[0] - toAbs(0, 0)[0]);
    const i0 = Math.floor(A0x / step);
    const i1 = Math.ceil(A1x / step);
    const j0 = Math.floor(A0y / step);
    const j1 = Math.ceil(A1y / step);
    if ((i1 - i0) * (j1 - j0) > 400000) continue;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        if (hash(i, j, set.seed, pass.salt) >= pass.chance) continue;
        const X = (i + 0.15 + 0.7 * hash(i, j, set.seed, pass.salt + 10)) * step;
        const Y = (j + 0.15 + 0.7 * hash(i, j, set.seed, pass.salt + 20)) * step;
        const [x, y] = fromAbs(X, Y);
        const sx = cam.sx(x, y);
        const sy = cam.sy(x, y, 0);
        if (!paper.on(pass.mask, sx, sy) || paper.on(M.road, sx, sy) || paper.on(M.water, sx, sy) || paper.on(M.foot, sx, sy)) continue;
        if (pass.mask === M.green && paper.on(M.wood, sx, sy)) continue;
        const r0 = hash(i, j, set.seed, pass.salt + 30);
        const conifer = hash(i, j, set.seed, pass.salt + 40) < pass.conifer;
        const r = conifer ? 1.6 + r0 * 1.1 : 1.9 + r0 * 1.7;
        const h = conifer ? 7 + r0 * 5 : r + 2.6 + hash(i, j, set.seed, pass.salt + 50) * 2.4;
        trees.push({ x, y, r, h, conifer });
      }
    }
  }
  return trees;
}

function circle(cx: number, cy: number, r: number, n: number, from = 0, to = Math.PI * 2): number[] {
  const pts: number[] = [];
  const full = to - from >= Math.PI * 2 - 1e-9;
  const m = full ? n : n + 1;
  for (let k = 0; k < m; k++) {
    const a = from + ((to - from) * k) / n;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

function withDepth(pts: number[], d: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(pts[i], pts[i + 1], d);
  return out;
}

type Sprite = { ring: number[]; depth: number; draw: () => void };

/** Trees are flat cut-outs facing the viewer. */
export function treeSprite(B: Build, paper: Paper, t: Tree): Sprite {
  const { cam } = B;
  const s = cam.s;
  const sx = cam.sx(t.x, t.y);
  if (t.conifer) {
    const zb = 1.4;
    const yb = cam.sy(t.x, t.y, zb);
    const yt = cam.sy(t.x, t.y, t.h);
    const w = t.r * s;
    const depth = cam.depth(t.x, t.y, (zb + t.h) / 2) - t.r * 0.6;
    const ring = [sx - w, yb, sx + w, yb, sx, yt];
    return {
      ring,
      depth,
      draw: () => {
        paper.sheet(GREENERY, withDepth(ring, depth), paper.seen, true);
        const ym = yb + (yt - yb) * 0.42;
        paper.sheet(GREENERY, withDepth([sx - w * 0.6, ym, sx, ym + (yt - yb) * 0.22, sx + w * 0.6, ym], depth - 0.01));
        paper.line3(GREENERY, [t.x, t.y, 0, t.x, t.y, zb]);
      },
    };
  }
  const cy = cam.sy(t.x, t.y, t.h);
  const R = t.r * s;
  const depth = cam.depth(t.x, t.y, t.h) - t.r;
  const ring = circle(sx, cy, R, R > 2 ? 22 : 14);
  return {
    ring,
    depth,
    draw: () => {
      paper.sheet(GREENERY, withDepth(ring, depth), paper.seen, true);
      if (R > 0.9) paper.sheet(GREENERY, withDepth(circle(sx - R * 0.12, cy - R * 0.12, R * 0.62, 7, 0.15, 1.75), depth - 0.01));
      paper.line3(GREENERY, [t.x, t.y, 0, t.x, t.y, t.h]);
    },
  };
}
