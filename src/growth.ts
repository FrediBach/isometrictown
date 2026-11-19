import type { Build, Solid } from './buildings';
import { DECAY, stretch } from './decay';
import { FIELD, GARDEN, MEADOW, ORCHARD, SCRUB, TUFT, TUFT_MM, VINEYARD, WILD, WILD_DEFAULT, type Ground } from './ground';
import { REF_NIB, type Camera } from './camera';
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

/** The exposed face a colony occupies, measured along the wall and up from its foot. */
type IvyWall = {
  cam: Camera; len: number; across: number; height: number; runs?: number[];
  point: (u: number, z: number, outward?: number) => number[];
  ink: (pts: number[], groundFoot?: boolean) => void;
};

/**
 * Climbers on a ground-floor wall. Roots and forks belong to the whole edge, even when
 * the wall breaks into runs. Each shoot keeps its lower bends as its growing tip climbs.
 */
export function ivy(B: Build, ax: number, ay: number, bx: number, by: number, height: number, out: Solid, face?: number[][], runs?: number[]): void {
  const p = B.fate?.p ?? 0;
  if (p <= 0.08 || B.set.trees <= 0) return;
  const { cam } = B;
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  if (len < 2) return;
  const [k0, k1] = B.key((ax + bx) / 2, (ay + by) / 2);
  const count = Math.max(1, Math.round(len / 9));
  const bay = len / count;
  const across = Math.abs((dx * cam.cb - dy * cam.sb) / len);
  const cover = 0.94 * (DECAY[B.style.id]?.grows ?? 1) * Math.min(1.4, B.set.trees / 0.7);
  // Work in metres along and up the wall until a stroke is ready for the depth pass.
  const wall: IvyWall = {
    cam, len, across, height, runs,
    point: (u, z, outward = 0) => [ax + (dx * u + dy * outward) / len, ay + (dy * u - dx * outward) / len, z],
    ink: (pts, groundFoot) => out.lines.push({ pen: GREENERY, pts, layer: 'trees', facet: 'ivy', on: face, groundFoot }),
  };
  cam.within('trees', () => {
    if (!shows(cam, LOD.ivyMat, height * cam.ca)) return;
    for (let i = 0; i < count; i++) {
      const g = (salt: number, joint = 0) => hash(k0, k1, B.seed, i, joint, salt);
      if (g(11670) >= cover) continue;
      const start = 0.08 + 0.2 * g(11671);
      if (p <= start) continue;
      const root = (i + 0.28 + 0.44 * g(11672)) * bay;
      const heightAtMaturity = 9 + 10 * g(11674);
      // Both side shoots fork from the same woody stem above the wall foot.
      const phase = g(11688) * 2 * Math.PI;
      const sway = Math.min(0.65, root * 0.2, (len - root) * 0.2);
      const leader = (z: number) => root + sway * (Math.sin(0.68 * z + phase) - Math.sin(phase));
      const collar = 0.55 + 0.55 * g(11689);
      const grown = stretch(p, start, start + 0.38);
      const centralTip = Math.min(heightAtMaturity * grown, ivyCeiling(wall, root - 2 * sway, root + 2 * sway));
      if (shows(cam, LOD.ivy, Math.min(centralTip * cam.ca, bay * across))) {
        const fork = Math.min(collar, centralTip);
        // Keep the foot and junction in the actual plotted polyline at every stage.
        ivyRunner(wall, leader, 0, centralTip, fork, bay, g);
        if (centralTip > collar) for (const side of [-1, 1]) {
          const rand = (salt: number, node = 0) => hash(k0, k1, B.seed, i, side, node, salt);
          const delay = 0.045 + 0.12 * rand(11681);
          const age = stretch(p, start + delay, start + delay + 0.38);
          if (age <= 0) continue;
          const base = leader(collar);
          const room = side < 0 ? base - i * bay : (i + 1) * bay - base;
          const lean = side * room * (0.64 + 0.23 * rand(11683));
          if (!shows(cam, LOD.ivyShoot, Math.abs(lean) * across)) continue;
          const curl = rand(11690) * Math.PI * 2;
          const at = (z: number) => {
            const h = z - collar;
            const fan = 1 - Math.exp(-h / (1.1 + Math.abs(lean) * 0.45));
            return base + lean * fan * (0.88 + 0.12 * Math.sin(h * 0.85 + curl));
          };
          const ceiling = ivyCeiling(wall, Math.min(base, base + lean), Math.max(base, base + lean));
          const tip = Math.min(ceiling, collar + age * heightAtMaturity * (0.52 + 0.38 * rand(11684)));
          if (shows(cam, LOD.ivy, (tip - collar) * cam.ca)) ivyRunner(wall, at, collar, tip, collar, bay * 0.8, rand);
        }
      }
      // Low mats occupy broken masonry where upright shoots no longer have room.
      if (runs) {
        const coverAge = stretch(p, start + 0.14, start + 0.52);
        const half = bay * (0.35 + 0.16 * g(11685)) * coverAge;
        const left = Math.max(i * bay, root - half), right = Math.min((i + 1) * bay, root + half);
        if (shows(cam, LOD.ivy, (right - left) * across)) {
          ivyMat(wall, left, right, (2.6 + 2.8 * g(11686)) * coverAge, g(11687) * 6);
        }
      }
    }
  });
}

/** The lowest surviving masonry beneath a stroke, including its clearance from the rim. */
function ivyCeiling({ height, runs, len }: IvyWall, lo: number, hi: number): number {
  if (runs) {
    const first = Math.max(0, Math.floor(lo / len * runs.length));
    const last = Math.min(runs.length - 1, Math.floor(hi / len * runs.length));
    for (let k = first; k <= last; k++) height = Math.min(height, runs[k]);
  }
  return height - 0.15;
}

/** Trace a climbing stem through its fork and leaf nodes. Leaves share their stalk's
 * first and last point so a plotter can draw each blade and continue up the same stem. */
function ivyRunner(wall: IvyWall, at: (z: number) => number, base: number, tip: number, fork: number, bay: number,
  rand: (salt: number, node?: number) => number): void {
  const { cam, across, len, point, ink } = wall;
  const pts: number[] = [];
  if (base === 0) {
    // A short runner lies on the soil, turns in at the footing, then climbs. All
    // three belong to one pen stroke, even when the ground portion alone is tiny.
    const u = at(0), side = rand(11692) < 0.5 ? -1 : 1;
    const toe = side * Math.min(0.6 + 0.4 * rand(11693), side < 0 ? u : len - u);
    pts.push(...point(u + toe, 0, 0.42), ...point(u + 0.56 * toe, 0, 0.34), ...point(u + 0.2 * toe, 0, 0.12));
  }
  pts.push(...point(at(base), base));
  const stride = Math.max(1.45 + 0.95 * rand(11675), cam.gap(1.8) / (cam.s * cam.ca)) * (base > 0 ? 1.2 : 1);
  const outward = Math.sign(at(base + 1) - at(base));
  const firstSide = base > 0 ? outward : rand(11676) < 0.5 ? -1 : 1;
  let z = base;
  // Sample the fixed curve on the same lattice as it grows, including each junction.
  const ascend = (to: number) => {
    for (let k = Math.floor(z / 0.45) + 1; k * 0.45 < to; k++) pts.push(...point(at(k * 0.45), k * 0.45));
    if (to > z) pts.push(...point(at(to), to));
    z = to;
  };
  ascend(fork);
  for (let j = 0; z < tip; j++) {
    const firstGap = base > 0 ? 0.8 : 0.28;
    const node = z + stride * (j === 0 ? firstGap : 1) * (0.78 + 0.48 * rand(11680, j));
    ascend(Math.min(node, tip));
    if (z === tip) break;
    const side = j % 2 ? firstSide : -firstSide;
    const u = at(z);
    // At small scales a single blade stands for a leafy spray. Give larger sprays
    // more room between nodes and leave the curved leader bare where even that cannot fit.
    const aspect = 0.82 + 0.17 * rand(11679, j);
    // Inward leaves on a fork have only the gap back to the parent stem.
    const room = base > 0 && side !== outward ? Math.abs(u - at(base)) * 0.65 : bay;
    const size = Math.min(room, bay * (base === 0 ? 0.53 : 0.38), side < 0 ? u : len - u,
      Math.max(1.1 + 1.12 * rand(11678, j), cam.gap(1.25) / (cam.s * Math.min(across, aspect * cam.ca))));
    const bladeH = Math.min(size * aspect, z * 1.25);
    const ceiling = ivyCeiling(wall, Math.min(u, u + side * size), Math.max(u, u + side * size));
    const growth = Math.min(1, (Math.min(tip, ceiling) - z) / bladeH);
    const readable = Math.min(size * across, bladeH * cam.ca) * growth;
    if (shows(cam, LOD.ivyLeaf, readable) && readable * cam.s >= cam.nib * 2.4) {
      ivyLeaf(pts, point, u, z, side * size * growth, bladeH * growth,
        0.95 * rand(11691, j) - 0.58, shows(cam, LOD.ivyLobes, readable));
    }
  }
  ink(pts, base === 0);
}

/** An ivy blade seen against the wall, with two basal lobes and a longer, drooping tip.
 * The same short stalk carries a simpler heart-shaped blade where the lobes close up. */
function ivyLeaf(pts: number[], point: IvyWall['point'], u: number, z: number, reach: number, h: number, tilt: number, lobed: boolean): void {
  const blade = (x: number, y: number) => pts.push(...point(u + reach * x, z + h * (y + tilt * x)));
  let x = 0, y = 0;
  // Quadratic arcs round the shoulders. The changes of tangent at the lobe tips
  // keep the juvenile leaf's outline recognisable at a pen's width.
  const arc = (cx: number, cy: number, ex: number, ey: number) => {
    for (let k = 1; k <= 3; k++) {
      const t = k / 3, v = 1 - t;
      blade(v * v * x + 2 * v * t * cx + t * t * ex, v * v * y + 2 * v * t * cy + t * t * ey);
    }
    x = ex; y = ey;
  };
  arc(0.11, 0.19, 0.28, 0.19);
  if (lobed) {
    arc(0.07, 0.60, 0.32, 0.53);
    arc(0.41, 0.56, 0.48, 0.73);
    arc(0.59, 0.56, 0.60, 0.36);
  } else arc(0.11, 0.78, 0.58, 0.40);
  arc(0.89, 0.17, 1, -0.22);
  arc(0.77, -0.10, 0.58, -0.20);
  if (lobed) {
    arc(0.49, -0.28, 0.42, -0.49);
    arc(0.32, -0.32, 0.19, -0.28);
  } else arc(0.31, -0.41, 0.18, -0.26);
  arc(0.09, -0.03, 0.28, 0.19);
  arc(0.11, 0.19, 0, 0);
}

/** The scalloped upper edge of a mat of older foliage. Its runners spread sideways even
 * where the masonry is too low for an upright stem. Each breach cuts it at the actual step. */
function ivyMat({ cam, len, height, runs, across, point, ink }: IvyWall, left: number, right: number, rise: number, phase: number): void {
  const width = right - left;
  const run = len / (runs?.length ?? 1);
  const first = Math.floor(left / run), last = Math.ceil(right / run);
  // Keep the notches between leaf clusters only while their spacing reads on paper.
  const pitch = Math.max(0.4, cam.gap(0.52) / (cam.s * across));
  const steps = Math.max(2, Math.ceil(width / pitch));
  let pts: number[] = [];
  for (let k = first; k < last; k++) {
    const ceiling = (runs ? runs[k] : height) - 0.12;
    const h = Math.min(rise, ceiling);
    if (!shows(cam, LOD.ivyMat, h * cam.ca)) {
      if (pts.length) { pts.push(...point(k * run, 0)); ink(pts); }
      pts = [];
      continue;
    }
    const lo = Math.max(left, k * run), hi = Math.min(right, (k + 1) * run);
    const crest = (u: number) => {
      const t = (u - left) / width;
      const arch = Math.sqrt(Math.max(0, 4 * t * (1 - t)));
      const lobe = 0.62 + 0.24 * Math.abs(Math.sin(8 * t + phase)) + 0.14 * Math.abs(Math.sin(21 * t - phase));
      pts.push(...point(u, 0.12 + (h - 0.12) * arch * lobe));
    };
    if (!pts.length) pts.push(...point(lo, 0));
    crest(lo);
    for (let j = Math.floor((lo - left) / width * steps) + 1; j < steps; j++) {
      const u = left + width * j / steps;
      if (u >= hi) break;
      crest(u);
    }
    crest(hi);
  }
  if (pts.length) { pts.push(...point(right, 0)); ink(pts); }
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
