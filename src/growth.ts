import type { Build, Solid } from './buildings';
import { DECAY, stretch } from './decay';
import { FIELD, GARDEN, MEADOW, ORCHARD, SCRUB, VINEYARD, WILD, WILD_DEFAULT, type Ground } from './ground';
import { LOD, shows, thin } from './lod';
import type { Masks, Tree } from './nature';
import type { Paper } from './raster';
import { hash } from './rng';
import { GREENERY } from './settings';

/*
 * Growth in an abandoned town (docs/plans/abandonment.md §8): bushes, then saplings, then
 * trees taking back gardens, parks, fallow fields, ruins and roads, each ground at its own
 * pace. Everything grows on a grid fixed to the map, and only ever comes in and gets bigger
 * as the slider rises. Growth keeps clear of standing walls, so the footprints stay readable.
 */

/** How ground goes wild: from and to where on the slider, how much of it ends up grown over, and how big things get. */
type Wilding = { from: number; to: number; cover: number; most: number };

const WILDING: Record<'ruin' | 'garden' | 'park' | 'field' | 'road' | 'town' | 'open', Wilding> = {
  /** Inside a roofless ruin, once its floor is open to the sky. */
  ruin: { from: 0.5, to: 1, cover: 0.4, most: 2.2 },
  garden: { from: 0.25, to: 0.85, cover: 0.5, most: 3.4 },
  park: { from: 0.3, to: 0.95, cover: 0.45, most: 3.6 },
  /** Fallow fields and meadows turning to young woodland. */
  field: { from: 0.45, to: 1, cover: 0.4, most: 3 },
  /** Roads: a little, late. */
  road: { from: 0.65, to: 1, cover: 0.1, most: 2 },
  /** Yards, squares and other built ground. */
  town: { from: 0.5, to: 1, cover: 0.18, most: 2.6 },
  /** Open country the map says nothing about. */
  open: { from: 0.35, to: 1, cover: 0.22, most: 3 },
};

/** Spacing of the growth grid, in metres. */
const STEP = 6.5;
/** How far growth in a ruin keeps from its outline: the wall and a little more. */
const WALL = 1.2;

/**
 * Trees and bushes growing back over an abandoned town. `ruin` marks the footprints of
 * roofless ruins; growth in them keeps clear of their walls. Returns nothing while the town is lived in or Trees is off.
 */
export function wildGrowth(B: Build, paper: Paper, G: Ground | null, M: Masks, ruin: Uint8Array, box: [number, number, number, number], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Tree[] {
  const { cam, set } = B;
  const out: Tree[] = [];
  const d = set.abandon;
  if (d <= 0.25 || set.trees <= 0) return out;
  const region = WILD[B.style.id] ?? WILD_DEFAULT;
  const local = DECAY[B.style.id];
  const amount = Math.min(1.4, set.trees / 0.7) * (local?.grows ?? 1);
  const scrub = local?.scrub ?? 0.35;
  const step = STEP * (toAbs(1, 0)[0] - toAbs(0, 0)[0]);
  const spread = thin(cam, LOD.treeSpacing, STEP);
  // Grown as close on paper at coarse scales as at 1:1000 would be a darker sheet: thinned
  // so the growth keeps about the same tone at any scale.
  const sparse = Math.min(1, (cam.size(STEP) / 4) ** 2);
  const [A0x, A0y] = toAbs(box[0], box[1]);
  const [A1x, A1y] = toAbs(box[2], box[3]);
  const i0 = Math.floor(A0x / step);
  const i1 = Math.ceil(A1x / step);
  const j0 = Math.floor(A0y / step);
  const j1 = Math.ceil(A1y / step);
  if ((i1 - i0) * (j1 - j0) > 1500000) return out;
  const on = (mask: Uint8Array, x: number, y: number) => paper.on(mask, cam.sx(x, y), cam.sy(x, y, 0));
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const h = (k: number) => hash(i, j, set.seed, 9980 + k);
      if (hash(i, j, set.seed, 9979) >= spread) continue;
      const [x, y] = fromAbs((i + 0.15 + 0.7 * h(1)) * step, (j + 0.15 + 0.7 * h(2)) * step);
      const sx = cam.sx(x, y);
      const sy = cam.sy(x, y, 0);
      if (sx < paper.x0 - 10 || sx > paper.x1 + 10 || sy < paper.y0 - 10 || sy > paper.y1 + 30) continue;
      if (paper.on(M.water, sx, sy) || paper.on(M.wood, sx, sy) || paper.on(M.title, sx, sy) || paper.on(M.pool, sx, sy)) continue;
      // What ground it is, and so how it goes wild.
      let kind: keyof typeof WILDING;
      if (paper.on(ruin, sx, sy)) kind = 'ruin';
      else if (paper.on(M.foot, sx, sy)) continue;
      else if (paper.on(M.road, sx, sy)) kind = 'road';
      else if (paper.on(M.green, sx, sy)) kind = 'park';
      else {
        const land = G ? paper.at(G.land, sx, sy) : 0;
        // Orchards and vineyards run wild like fields; scrub thickens like open country.
        kind = land === GARDEN ? 'garden' : land === FIELD || land === MEADOW || land === ORCHARD || land === VINEYARD ? 'field' : land === SCRUB || land ? 'open' : G?.inTown(x, y, sx, sy) ? 'town' : 'open';
      }
      const w = WILDING[kind];
      const s = stretch(d, w.from, w.to);
      // It comes up once the ground has gone far enough wild for it, and grows from there.
      const come = h(0) / (w.cover * amount * sparse);
      if (s <= come) continue;
      const grown = Math.min(1, (s - come) / 0.45);
      let most = w.most;
      // A crown that would reach over a standing wall stays a bush.
      const reach = 0.5 + (most - 0.5) * grown;
      // In a ruin, everything within the walls' reach (`WALL`) of the crown must still be inside it.
      const inRuin = kind === 'ruin';
      const clear = (r: number) => [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].every(([dx, dy]) => inRuin ? on(ruin, x + dx * (r + WALL), y + dy * (r + WALL)) : !on(M.foot, x + dx * r, y + dy * r));
      if (!clear(reach * 0.8)) most = 0.9;
      if (!clear(Math.min(reach, most) * 0.7)) continue;
      const bush = grown < 0.35 || most < 1.2 || h(3) < scrub;
      if (bush) {
        const r = 0.6 + Math.min(most, 1.3) * 0.6 * grown + 0.2;
        out.push({ x, y, r, h: r, conifer: false, bush: true });
        continue;
      }
      const conifer = h(4) < region.conifer;
      const r = 1.2 + (most - 1.2) * grown * (0.7 + 0.3 * h(5));
      // A young conifer is never narrower than the bush it grew from.
      out.push({ x, y, r: conifer ? Math.max(1.1, r * 0.8) : r, h: conifer ? 3 + 7 * grown : r + 1.5 + 3 * grown, conifer });
    }
  return out;
}

/**
 * Ivy up a ruined wall from a to b, standing to z: a wavy stroke or two climbing from its
 * foot, more of them as the town goes further. Only on walls facing the viewer.
 */
export function ivy(B: Build, ax: number, ay: number, bx: number, by: number, z0: number, z: number, out: Solid): void {
  const f = B.fate;
  if (!f || !B.set.trees) return;
  const share = 0.35 * stretch(f.p, 0.45, 1);
  if (share <= 0 || !shows(B.cam, LOD.ivy, z - z0)) return;
  const len = Math.hypot(bx - ax, by - ay);
  const [k0, k1] = B.key((ax + bx) / 2, (ay + by) / 2);
  const g = (s: number) => hash(k0, k1, B.set.seed, 9990 + s);
  if (g(0) >= share) return;
  const u0 = 0.2 + 0.6 * g(1);
  const top = z0 + (z - z0) * (0.5 + 0.4 * g(2));
  const pts: number[] = [];
  const n = 6;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const u = Math.max(0, Math.min(1, u0 + (Math.sin(t * 9 + g(3) * 6) * 0.6) / Math.max(1, len)));
    pts.push(ax + (bx - ax) * u, ay + (by - ay) * u, z0 + (top - z0) * t);
  }
  out.lines.push({ pen: GREENERY, pts, layer: 'trees', facet: 'ivy' });
}
