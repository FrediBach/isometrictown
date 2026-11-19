import type { Build, Solid } from './buildings';
import { DECAY, stretch } from './decay';
import { FIELD, GARDEN, MEADOW, ORCHARD, SCRUB, TUFT, TUFT_MM, VINEYARD, WILD, WILD_DEFAULT, type Ground } from './ground';
import { REF_NIB } from './camera';
import { LOD, shows, thin } from './lod';
import type { Masks, Tree } from './nature';
import type { Paper } from './raster';
import { hash, patch } from './rng';
import type { Test } from './raster';
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
  ruin: { from: 0.4, to: 1, cover: 0.6, most: 2.6 },
  garden: { from: 0.12, to: 0.75, cover: 0.8, most: 3.6 },
  park: { from: 0.15, to: 0.85, cover: 0.7, most: 3.8 },
  /** Fallow fields and meadows turning to young woodland. */
  field: { from: 0.3, to: 0.95, cover: 0.65, most: 3.2 },
  /** Roads: later, and less. */
  road: { from: 0.45, to: 1, cover: 0.25, most: 2.4 },
  /** Yards, squares and other built ground. */
  town: { from: 0.35, to: 1, cover: 0.4, most: 3 },
  /** Open country the map says nothing about. */
  open: { from: 0.2, to: 0.95, cover: 0.45, most: 3.2 },
};

/** Spacing of the growth grid, in metres. */
const STEP = 6.5;
/** How far growth in a ruin keeps from its outline: the wall and a little more. */
const WALL = 1.2;
/** Directions sampled around a crown for wall clearance. */
const D = Math.SQRT1_2;
const CROWN = [[1, 0], [-1, 0], [0, 1], [0, -1], [D, D], [-D, D], [D, -D], [-D, -D]];

/** Use the same radius when reserving a bush's space and drawing its crown. */
function bushRadius(spread: number, grown: number): number {
  return 0.6 + spread * 0.6 * grown + 0.2;
}

/**
 * Trees and bushes growing back over an abandoned town. `ruin` marks the footprints of
 * roofless ruins; growth in them keeps clear of their walls. Returns nothing while the town is lived in or Trees is off.
 */
export function wildGrowth(B: Build, paper: Paper, G: Ground | null, M: Masks, ruin: Uint8Array, box: [number, number, number, number], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Tree[] {
  const { cam, set } = B;
  const out: Tree[] = [];
  const d = set.abandon;
  if (d <= 0.12 || set.trees <= 0) return out;
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
      // Reserve the mature crown when the spot germinates. A tree squeezed against
      // masonry stays a small bush throughout its life.
      const inRuin = kind === 'ruin';
      const clear = (radius: number) => {
        const reach = radius + (inRuin ? WALL : 0);
        return CROWN.every(([dx, dy]) => inRuin
          ? on(ruin, x + dx * reach, y + dy * reach)
          : !on(M.foot, x + dx * reach, y + dy * reach));
      };
      const scrubby = h(3) < scrub;
      const conifer = h(4) < region.conifer;
      const crown = 1.2 + (w.most - 1.2) * (0.7 + 0.3 * h(5));
      const mature = scrubby ? bushRadius(1.3, 1) : conifer ? Math.max(1.1, crown * 0.8) : crown;
      const room = clear(mature);
      if (!room && !clear(bushRadius(0.9, 1))) continue;
      const most = room ? w.most : 0.9;
      const bush = grown < 0.35 || !room || scrubby;
      if (bush) {
        const r = bushRadius(Math.min(most, 1.3), grown);
        out.push({ x, y, r, h: r, conifer: false, bush: true });
        continue;
      }
      const r = 1.2 + (crown - 1.2) * grown;
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
  const g = (s: number) => hash(k0, k1, B.seed, 9990 + s);
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

/**
 * Grass taking the ground back: tufts spreading over yards, roads, squares and the floors
 * of ruins, in patches, thicker as the town goes further, until by the end most ground is
 * grass and only the taller walls stand clear of it. Ground the map already textures
 * (fields, meadows, parks, woods) keeps its own texture.
 */
export function wildGrass(B: Build, paper: Paper, G: Ground | null, M: Masks, ruin: Uint8Array, toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): void {
  const { cam, set } = B;
  const s = stretch(set.abandon, 0.15, 0.95);
  if (s <= 0) return;
  const box = cam.region(0);
  const metre = toAbs(1, 0)[0] - toAbs(0, 0)[0];
  const step = (cam.gap(TUFT_MM * 1.5) / cam.s) * metre;
  const k = Math.max(1, cam.nib / REF_NIB);
  const [A0x, A0y] = toAbs(box[0], box[1]);
  const [A1x, A1y] = toAbs(box[2], box[3]);
  const i0 = Math.floor(A0x / step);
  const i1 = Math.ceil(A1x / step);
  const j0 = Math.floor(A0y / step);
  const j1 = Math.ceil(A1y / step);
  if ((i1 - i0) * (j1 - j0) > 800000) return;
  const keep: Test = (x, y, d) => !paper.on(M.water, x, y) && (!paper.on(M.foot, x, y) || paper.on(ruin, x, y)) && paper.seen(x, y, d);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const r = (q: number) => hash(i, j, set.seed, 10060 + q);
      const X = (i + 0.1 + 0.8 * r(1)) * step;
      const Y = (j + 0.1 + 0.8 * r(2)) * step;
      // In patches: thick in some places long before others.
      const cover = Math.min(1, Math.max(0, (patch(X / (step * 6), Y / (step * 6), set.seed, 10068) - 0.2) * 1.6 + s * 0.9 - 0.3)) * s;
      if (r(0) >= cover) continue;
      const [x, y] = fromAbs(X, Y);
      const sx = cam.sx(x, y);
      const sy = cam.sy(x, y, 0);
      if (paper.on(M.water, sx, sy) || paper.on(M.wood, sx, sy) || paper.on(M.green, sx, sy) || paper.on(M.pool, sx, sy) || paper.on(M.title, sx, sy)) continue;
      if (paper.on(M.foot, sx, sy) && !paper.on(ruin, sx, sy)) continue;
      // Fields, meadows and the like keep the texture they have; gardens and bare ground take grass.
      const land = G ? paper.at(G.land, sx, sy) : 0;
      if (land && land !== GARDEN) continue;
      // Out of shadows, as other ground textures are, and drawn whole or not at all: a tuft
      // half hidden by a tree or a wall would leave a speck.
      if (paper.on(M.shadow, sx, sy)) continue;
      // The full tuft only: the small one is under two pen widths across, a speck.
      const shape = TUFT;
      const d = cam.depth(x, y, 0);
      const pts = shape.flatMap(([dx, dy]) => [sx + dx * k, sy + dy * k, d]);
      let whole = true;
      for (let q = 0; q < pts.length && whole; q += 3) whole = keep(pts[q], pts[q + 1], d) && !paper.on(M.shadow, pts[q], pts[q + 1]);
      if (whole) paper.sheet(GREENERY, pts, () => true);
    }
}
