import type { Build } from './buildings';
import type { Paper } from './raster';
import { hash } from './rng';
import { GREENERY } from './settings';

/** A bush is a low dome sitting on the ground, with no trunk. */
/** `form` gives a few trees a regional shape: palms in hot places, cypresses round the Mediterranean. */
export type Tree = { x: number; y: number; r: number; h: number; conifer: boolean; bush?: boolean; form?: 'palm' | 'cypress' };

/** Share of broadleaf trees that are palms, and of conifers that are cypresses, by region. */
const PALMS: Partial<Record<string, number>> = { tropical: 0.65, arid: 0.45, mediterranean: 0.18, antipodean: 0.08 };
const CYPRESSES: Partial<Record<string, number>> = { mediterranean: 0.55, arid: 0.3 };

/** Turn some trees into the region's own kinds, keyed to where they stand. */
export function regionalTrees(B: Build, trees: Tree[], inWood: (t: Tree) => boolean): Tree[] {
  // Palms also grow with warmth: in the tropics anywhere, and in the warm south of the US and Australia.
  const lat = Math.abs(B.set.center[1]);
  const warm = lat < 24 ? 0.5 : lat < 33 && (B.style.id === 'american' || B.style.id === 'antipodean') ? 0.3 : 0;
  const palm = Math.max(PALMS[B.style.id] ?? 0, warm);
  const cypress = CYPRESSES[B.style.id] ?? 0;
  if (!palm && !cypress) return trees;
  return trees.map((t) => {
    // Bushes and the small trees of orchards stay as they are.
    if (t.bush || t.h < 4.5) return t;
    const [k0, k1] = B.key(t.x, t.y);
    const u = hash(k0, k1, B.set.seed, 64);
    const v = hash(k0, k1, B.set.seed, 65);
    // Palms are planted in town, not grown in the woods.
    if (!t.conifer && u < palm && !inWood(t)) return { ...t, form: 'palm', r: 2.4 + v * 0.8, h: 7 + v * 5 };
    if (t.conifer && u < cypress) return { ...t, form: 'cypress', r: 1.0 + v * 0.4, h: 9 + v * 6 };
    return t;
  });
}
/** `under` is the sheet area hidden by the sides and arches of bridges over water. */
export type Masks = Record<'road' | 'water' | 'green' | 'wood' | 'foot' | 'shadow' | 'pool' | 'under', Uint8Array>;

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
  if (t.form === 'palm') {
    // A leaning trunk and a crown of drooping fronds.
    const R = t.r * s;
    const lean = (hash(Math.round(t.x), Math.round(t.y), 66) - 0.5) * 0.5 * R;
    const yb = cam.sy(t.x, t.y, 0);
    const yt = cam.sy(t.x, t.y, t.h);
    const tx = sx + lean;
    const depth = cam.depth(t.x, t.y, t.h) - t.r;
    const ring = circle(tx, yt + R * 0.15, R * 0.75, 12);
    return {
      ring,
      depth,
      draw: () => {
        const trunk: number[] = [];
        for (let k = 0; k <= 6; k++) {
          const f = k / 6;
          trunk.push(sx + lean * f * f, yb + (yt - yb) * f, cam.depth(t.x, t.y, t.h * f));
        }
        paper.sheet(GREENERY, trunk);
        for (let q = 0; q < 7; q++) {
          const a = Math.PI * (0.05 + (0.9 * q) / 6);
          const dx = -Math.cos(a) * R;
          const pts: number[] = [];
          for (let k = 0; k <= 5; k++) {
            const f = k / 5;
            // Up and out, then down: the frond arches over.
            pts.push(tx + dx * f, yt - Math.sin(a) * R * 0.45 * f + R * 0.9 * f * f, depth - 0.01);
          }
          paper.sheet(GREENERY, pts);
        }
      },
    };
  }
  if (t.form === 'cypress') {
    // Tall and narrow, pointed at the top.
    const w = t.r * s;
    const yb = cam.sy(t.x, t.y, 0.6);
    const yt = cam.sy(t.x, t.y, t.h);
    const depth = cam.depth(t.x, t.y, t.h / 2) - t.r * 0.6;
    const ring: number[] = [];
    for (let k = 0; k <= 8; k++) {
      const f = k / 8;
      ring.push(sx + w * Math.sin(Math.PI * Math.pow(f, 0.8)), yb + (yt - yb) * f);
    }
    for (let k = 7; k >= 1; k--) {
      const f = k / 8;
      ring.push(sx - w * Math.sin(Math.PI * Math.pow(f, 0.8)), yb + (yt - yb) * f);
    }
    return {
      ring,
      depth,
      draw: () => {
        paper.sheet(GREENERY, withDepth(ring, depth), paper.seen, true);
        paper.line3(GREENERY, [t.x, t.y, 0, t.x, t.y, 0.6]);
      },
    };
  }
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
  if (t.bush) {
    const R = t.r * s;
    const yb = cam.sy(t.x, t.y, 0);
    const ring = circle(sx, yb, R, 9, Math.PI, Math.PI * 2);
    const depth = cam.depth(t.x, t.y, t.r * 0.5) - t.r;
    return { ring, depth, draw: () => paper.sheet(GREENERY, withDepth(ring, depth), paper.seen, true) };
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
