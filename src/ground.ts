import { newSolid, prism, type Build, type Solid } from './buildings';
import { pointInRing, ringArea } from './geo';
import type { Masks, Tree } from './nature';
import type { Paper, Test } from './raster';
import { hash } from './rng';
import { GREENERY, LINEWORK, SHADOWS, WATER } from './settings';
import { bestRect, turn, type Rect } from './shape';
import { outline } from './streets';
import type { Shape, Town } from './tiles';

/**
 * Ground textures for land with a character of its own: furrowed fields, vineyard rows,
 * orchards, meadow tufts, marsh, sand, headstones in cemeteries and markings on sports
 * pitches. Area textures are pen strokes like the park hatching; things that stand up
 * (stakes, headstones, goals, nets) are small 3D line objects like the street lamps.
 */

export const FIELD = 1;
export const MEADOW = 2;
const WETLAND = 3;
const SAND = 4;
const ORCHARD = 5;
const VINEYARD = 6;
const CEMETERY = 7;
/** Grass pitches keep a light hatch under their markings; hard courts and tracks stay clear. */
const PITCH = 8;
const COURT = 9;
/** Open ground in leafy residential areas, where the map has no gardens drawn: lawns and garden trees. */
export const GARDEN = 10;
/** Residential areas whose buildings cover less than this share of the land count as gardens. */
const GARDEN_COVERAGE = 0.3;
/** Scrub: bushes over the grass. */
const SCRUB = 11;
/** Allotments: a grid of little plots with sheds. */
const ALLOTMENT = 12;
/** Bare rock and scree: boulders. */
const ROCK = 13;
/** Glaciers: crevasses. */
const ICE = 14;
/** Beaches: sand, stippled more lightly so the parasols on them read. */
const BEACH = 15;
const CODES: Record<string, number> = { farmland: FIELD, meadow: MEADOW, wetland: WETLAND, sand: SAND, orchard: ORCHARD, vineyard: VINEYARD, scrub: SCRUB, allotments: ALLOTMENT, rock: ROCK, ice: ICE, beach: BEACH };
/** Allotment plot size in metres, across and along the rows. */
const PLOT: [number, number] = [9, 16];

/** Furrow spacing on paper, mm, varied per field. */
const FURROW_MM: [number, number] = [1.8, 2.6];
/** Dash and gap for stubble fields, mm on paper. */
const STUBBLE_MM: [number, number] = [1.2, 1.0];
/** Symbol grid for tufts and marsh, and for sand stipple, mm on paper. */
const TUFT_MM = 3.2;
const SAND_MM = 2.4;

type Sport = 'soccer' | 'tennis' | 'basketball' | 'track' | 'multi';
type Pitch = { rect: Rect; sport: Sport };
export type Cover = { shape: Shape; code: number; rect: Rect };

export type Ground = {
  /** Per pixel: which texture the ground gets, 0 for none. */
  land: Uint8Array;
  /** Fields, orchards and vineyards, for their outlines. */
  farms: Uint8Array;
  farmShapes: Shape[];
  covers: Cover[];
  cemeteries: { shape: Shape; rect: Rect }[];
  pitches: Pitch[];
  /** Whether any residential land was taken to be gardens. */
  gardens: boolean;
  /** Whether ground (local metres, and where it falls on the sheet) belongs to the town: near buildings, or on built-up land. Open country is the rest. */
  inTown: (x: number, y: number, sx: number, sy: number) => boolean;
};

const SPORTS: [RegExp, Sport][] = [
  [/soccer|football|rugby|hockey|gaelic|lacrosse/, 'soccer'],
  [/tennis|padel/, 'tennis'],
  [/basketball/, 'basketball'],
  [/athletics|running/, 'track'],
];

/** Guess a sport from a pitch's size when the map doesn't say. */
function guessSport(r: Rect): Sport {
  const { L, w } = r;
  if (L >= 70 && w >= 40) return 'soccer';
  if (L >= 22 && L <= 40 && w >= 10 && L / w > 1.9) return 'tennis';
  if (L >= 24 && L <= 34 && w >= 13) return 'basketball';
  return 'multi';
}

/** Paper millimetres per metre along a ground direction. */
function mmPer(B: Build, vx: number, vy: number): number {
  const c = B.cam;
  return c.s * Math.hypot(vx * c.cb - vy * c.sb, c.sa * (vx * c.sb + vy * c.cb));
}

/** Work out where each texture goes and paint the land mask. Call before the trees are placed. */
export function planGround(B: Build, paper: Paper, town: Town): Ground {
  const s = B.cam.s;
  const G: Ground = { land: paper.mask(), farms: paper.mask(), farmShapes: [], covers: [], cemeteries: [], pitches: [], gardens: false, inTown: townTest(paper, town) };
  // First, so anything mapped explicitly paints over it.
  if (B.style.id !== 'arid') G.gardens = paintGardens(paper, town, G.land);
  for (const a of town.cover) {
    const code = CODES[a.cls];
    const { rect } = bestRect(a.shape[0].pts);
    if (!code || !rect) continue;
    const rings = a.shape.map((r) => r.pts);
    paper.fillMask(G.land, rings, code);
    G.covers.push({ shape: a.shape, code, rect });
    if (code === FIELD || code === ORCHARD || code === VINEYARD) {
      paper.fillMask(G.farms, rings);
      G.farmShapes.push(a.shape);
    }
  }
  const sporty = town.landuse.filter((a) => a.cls === 'pitch' || a.cls === 'track');
  const centres = sporty.map((a) => bestRect(a.shape[0].pts).rect);
  for (const a of town.landuse) {
    const { rect, fill } = bestRect(a.shape[0].pts);
    if (!rect) continue;
    const rings = a.shape.map((r) => r.pts);
    if (a.cls === 'cemetery' && s >= 0.6) {
      paper.fillMask(G.land, rings, CEMETERY);
      G.cemeteries.push({ shape: a.shape, rect });
    } else if ((a.cls === 'pitch' || a.cls === 'track') && rect.L * s >= 10) {
      // Only roughly rectangular pitches get markings, and not a big lawn that holds smaller pitches.
      const holdsOthers = sporty.some((b, k) => b !== a && centres[k] && centres[k]!.L * centres[k]!.w < rect.L * rect.w && pointInRing(centres[k]!.cx, centres[k]!.cy, a.shape[0].pts));
      if (holdsOthers || fill < (a.cls === 'track' ? 0.6 : 0.75)) continue;
      let sport: Sport | undefined = a.cls === 'track' ? 'track' : undefined;
      for (const p of town.pois) {
        if (sport || p.cls !== 'pitch' || !pointInRing(p.x, p.y, a.shape[0].pts)) continue;
        sport = SPORTS.find(([re]) => re.test(p.sub))?.[1] ?? 'multi';
      }
      sport ??= guessSport(rect);
      paper.fillMask(G.land, rings, sport === 'soccer' || sport === 'multi' ? PITCH : COURT);
      G.pitches.push({ rect, sport });
    }
  }
  return G;
}

/** Land uses that make ground part of the town rather than open country. */
const TOWN_LAND = new Set(['residential', 'industrial', 'commercial', 'retail', 'railway', 'school', 'university', 'college', 'hospital', 'military', 'garages', 'cemetery', 'pitch', 'track', 'stadium', 'playground', 'quarry']);
/** How far round a building the ground still counts as town, in metres. */
const TOWN_REACH = 30;

/** Cell size (m) of the grid that records which ground lies near a building. */
const TOWN_CELL = 10;

/**
 * Town ground: built-up land use, painted on the sheet (a few polygons), and the ground
 * within reach of any building, kept on a coarse grid in metres (thousands of buildings).
 */
function townTest(paper: Paper, town: Town): Ground['inTown'] {
  const land = paper.mask();
  for (const a of town.landuse) if (TOWN_LAND.has(a.cls)) paper.fillMask(land, a.shape.map((r) => r.pts));
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  const boxes = town.buildings.map((b) => {
    const p = b.shape[0].pts;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i]);
      x1 = Math.max(x1, p[i]);
      y0 = Math.min(y0, p[i + 1]);
      y1 = Math.max(y1, p[i + 1]);
    }
    gx0 = Math.min(gx0, x0 - TOWN_REACH);
    gy0 = Math.min(gy0, y0 - TOWN_REACH);
    gx1 = Math.max(gx1, x1 + TOWN_REACH);
    gy1 = Math.max(gy1, y1 + TOWN_REACH);
    return [x0, y0, x1, y1];
  });
  if (!boxes.length) return (_x, _y, sx, sy) => paper.on(land, sx, sy);
  const W = Math.ceil((gx1 - gx0) / TOWN_CELL) + 1;
  const H = Math.ceil((gy1 - gy0) / TOWN_CELL) + 1;
  const grid = new Uint8Array(W * H);
  for (const [x0, y0, x1, y1] of boxes) {
    const i0 = Math.floor((x0 - TOWN_REACH - gx0) / TOWN_CELL);
    const i1 = Math.floor((x1 + TOWN_REACH - gx0) / TOWN_CELL);
    const j0 = Math.floor((y0 - TOWN_REACH - gy0) / TOWN_CELL);
    const j1 = Math.floor((y1 + TOWN_REACH - gy0) / TOWN_CELL);
    for (let j = j0; j <= j1; j++) grid.fill(1, j * W + i0, j * W + i1 + 1);
  }
  return (x, y, sx, sy) => {
    const i = Math.floor((x - gx0) / TOWN_CELL);
    const j = Math.floor((y - gy0) / TOWN_CELL);
    if (i >= 0 && j >= 0 && i < W && j < H && grid[j * W + i]) return true;
    return paper.on(land, sx, sy);
  };
}

/** Open country the map says nothing about: not town, not water, not any mapped cover. */
function wild(G: Ground, M: Masks, paper: Paper, x: number, y: number, sx: number, sy: number): boolean {
  return paper.at(G.land, sx, sy) === 0 && !G.inTown(x, y, sx, sy) && !paper.on(M.green, sx, sy) && !paper.on(M.wood, sx, sy) && !paper.on(M.water, sx, sy) && !paper.on(M.road, sx, sy) && !paper.on(M.foot, sx, sy);
}

/** What open country looks like by region: tuft and dot chances for the texture, and how many trees or bushes stand on it. */
const WILD: Record<string, { tuft: number; dot: number; trees: number; bush: number; conifer: number }> = {
  arid: { tuft: 0.08, dot: 0.6, trees: 0.01, bush: 0.12, conifer: 0 },
  tropical: { tuft: 0.55, dot: 0, trees: 0.3, bush: 0.15, conifer: 0 },
  mediterranean: { tuft: 0.3, dot: 0.3, trees: 0.12, bush: 0.18, conifer: 0.4 },
  nordic: { tuft: 0.4, dot: 0, trees: 0.12, bush: 0.05, conifer: 0.7 },
  alpine: { tuft: 0.45, dot: 0.05, trees: 0.06, bush: 0.04, conifer: 0.7 },
  eastAsian: { tuft: 0.4, dot: 0, trees: 0.1, bush: 0.1, conifer: 0.3 },
  american: { tuft: 0.35, dot: 0.05, trees: 0.06, bush: 0.08, conifer: 0.3 },
  antipodean: { tuft: 0.3, dot: 0.15, trees: 0.08, bush: 0.1, conifer: 0 },
};
const WILD_DEFAULT = { tuft: 0.4, dot: 0, trees: 0.06, bush: 0.06, conifer: 0.2 };

/** A light texture of tufts and dots over open country the map leaves blank. */
function wildGround(B: Build, paper: Paper, M: Masks, G: Ground, toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): void {
  const { cam, set } = B;
  const w = WILD[B.style.id] ?? WILD_DEFAULT;
  const box = cam.region(0);
  const metre = toAbs(1, 0)[0] - toAbs(0, 0)[0];
  const step = ((TUFT_MM * 1.7) / cam.s) * metre;
  const [A0x, A0y] = toAbs(box[0], box[1]);
  const [A1x, A1y] = toAbs(box[2], box[3]);
  const i0 = Math.floor(A0x / step);
  const i1 = Math.ceil(A1x / step);
  const j0 = Math.floor(A0y / step);
  const j1 = Math.ceil(A1y / step);
  if ((i1 - i0) * (j1 - j0) > 600000) return;
  const keep: Test = (x, y, d) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && paper.seen(x, y, d);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const r = (k: number) => hash(i, j, set.seed, 140 + k);
      const [x, y] = fromAbs((i + 0.1 + 0.8 * r(1)) * step, (j + 0.1 + 0.8 * r(2)) * step);
      const sx = cam.sx(x, y);
      const sy = cam.sy(x, y, 0);
      if (!wild(G, M, paper, x, y, sx, sy) || paper.on(M.shadow, sx, sy)) continue;
      const d = cam.depth(x, y, 0);
      const u = r(3);
      if (u < w.tuft) paper.sheet(GREENERY, (r(4) < 0.5 ? TUFT : SMALL_TUFT).flatMap(([dx, dy]) => [sx + dx, sy + dy, d]), keep);
      else if (u < w.tuft + w.dot) paper.sheet(LINEWORK, DOT.flatMap(([dx, dy]) => [sx + dx, sy + dy, d]), keep);
    }
}

/** Trees and bushes standing about in open country, by region. */
export function wildTrees(B: Build, paper: Paper, G: Ground, M: Masks, box: [number, number, number, number], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Tree[] {
  const { cam, set } = B;
  const out: Tree[] = [];
  if (set.trees <= 0) return out;
  const w = WILD[B.style.id] ?? WILD_DEFAULT;
  const step = 16 * (toAbs(1, 0)[0] - toAbs(0, 0)[0]);
  const [A0x, A0y] = toAbs(box[0], box[1]);
  const [A1x, A1y] = toAbs(box[2], box[3]);
  const i0 = Math.floor(A0x / step);
  const i1 = Math.ceil(A1x / step);
  const j0 = Math.floor(A0y / step);
  const j1 = Math.ceil(A1y / step);
  if ((i1 - i0) * (j1 - j0) > 400000) return out;
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const h = (k: number) => hash(i, j, set.seed, 190 + k);
      const u = h(0);
      if (u >= (w.trees + w.bush) * set.trees * 1.4) continue;
      const [x, y] = fromAbs((i + 0.15 + 0.7 * h(1)) * step, (j + 0.15 + 0.7 * h(2)) * step);
      if (!wild(G, M, paper, x, y, cam.sx(x, y), cam.sy(x, y, 0))) continue;
      if (u < w.trees * set.trees * 1.4) {
        const conifer = h(3) < w.conifer;
        const r = conifer ? 1.6 + h(4) * 1.0 : 2.0 + h(4) * 1.6;
        out.push({ x, y, r, h: conifer ? 7 + h(5) * 5 : r + 2.8 + h(5) * 2.4, conifer });
      } else {
        const r = 0.8 + h(4) * 0.8;
        out.push({ x, y, r, h: r, conifer: false, bush: true });
      }
    }
  return out;
}

/**
 * Villages and suburbs often map only "residential" round their houses, with no gardens
 * drawn, though the ground between the houses is mostly lawn. Treat residential areas
 * whose buildings cover little of the land as gardens. Dense blocks stay as they are.
 */
function paintGardens(paper: Paper, town: Town, land: Uint8Array): boolean {
  const homes = town.landuse.filter((a) => a.cls === 'residential');
  if (!homes.length) return false;
  const centres = town.buildings.map((b) => {
    const p = b.shape[0].pts;
    let x = 0;
    let y = 0;
    for (let i = 0; i < p.length; i += 2) {
      x += p[i];
      y += p[i + 1];
    }
    const n = p.length / 2;
    return [x / n, y / n, Math.abs(ringArea(p))];
  });
  let any = false;
  for (const a of homes) {
    const outer = a.shape[0].pts;
    const area = Math.abs(ringArea(outer)) - a.shape.slice(1).reduce((t, r) => t + Math.abs(ringArea(r.pts)), 0);
    if (area < 2000) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      x0 = Math.min(x0, outer[i]);
      x1 = Math.max(x1, outer[i]);
      y0 = Math.min(y0, outer[i + 1]);
      y1 = Math.max(y1, outer[i + 1]);
    }
    let built = 0;
    for (const [x, y, ba] of centres) if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && pointInRing(x, y, outer)) built += ba;
    if (built / area >= GARDEN_COVERAGE) continue;
    paper.fillMask(land, a.shape.map((r) => r.pts), GARDEN);
    any = true;
  }
  return any;
}

/** A few trees in the gardens, on a grid fixed to the map. Kept clear of houses and streets. */
export function gardenTrees(B: Build, paper: Paper, G: Ground, M: Masks, box: [number, number, number, number], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Tree[] {
  const { set, cam } = B;
  const out: Tree[] = [];
  if (!G.gardens || set.trees <= 0) return out;
  const step = 13 * (toAbs(1, 0)[0] - toAbs(0, 0)[0]);
  const [A0x, A0y] = toAbs(box[0], box[1]);
  const [A1x, A1y] = toAbs(box[2], box[3]);
  const i0 = Math.floor(A0x / step);
  const i1 = Math.ceil(A1x / step);
  const j0 = Math.floor(A0y / step);
  const j1 = Math.ceil(A1y / step);
  if ((i1 - i0) * (j1 - j0) > 400000) return out;
  const clear = (x: number, y: number) => {
    const sx = cam.sx(x, y);
    const sy = cam.sy(x, y, 0);
    return paper.at(G.land, sx, sy) === GARDEN && !paper.on(M.foot, sx, sy) && !paper.on(M.road, sx, sy) && !paper.on(M.water, sx, sy) && !paper.on(M.green, sx, sy);
  };
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const h = (k: number) => hash(i, j, set.seed, 90 + k);
      if (h(0) >= 0.32 * set.trees) continue;
      const [x, y] = fromAbs((i + 0.15 + 0.7 * h(1)) * step, (j + 0.15 + 0.7 * h(2)) * step);
      const r = 1.6 + h(3) * 1.4;
      // The whole crown's footprint must be clear, so trees don't stand in walls.
      if (!clear(x, y) || !clear(x + r, y) || !clear(x - r, y) || !clear(x, y + r) || !clear(x, y - r)) continue;
      const conifer = h(4) < 0.2;
      out.push({ x, y, r: conifer ? r * 0.8 : r, h: conifer ? 6 + h(5) * 4 : r + 2.4 + h(5) * 2, conifer });
    }
  return out;
}

/** Where the plain park hatching should give way to a texture. */
export function textured(G: Ground, paper: Paper, x: number, y: number): boolean {
  const c = paper.at(G.land, x, y);
  return c === MEADOW || c === WETLAND || c === CEMETERY || c === PITCH || c === COURT || c === ALLOTMENT;
}

/** Grass under headstones and pitch markings: the park hatch at half density, so the detail on top still reads. */
export function lightly(G: Ground, paper: Paper, x: number, y: number): boolean {
  const c = paper.at(G.land, x, y);
  return c === CEMETERY || c === PITCH;
}

/** Park trees stay off marked pitches and thin out to a few over meadows and marsh. */
export function keepTree(B: Build, G: Ground, paper: Paper, t: Tree): boolean {
  const c = paper.cam;
  const code = paper.at(G.land, c.sx(t.x, t.y), c.sy(t.x, t.y, 0));
  if (code === PITCH || code === COURT || code === ALLOTMENT) return false;
  if (code !== MEADOW && code !== WETLAND) return true;
  const [k0, k1] = B.key(t.x, t.y);
  return hash(k0, k1, B.set.seed, 62) < 0.12;
}

/** Call fn for each piece of a line parallel to (ux, uy) that lies inside a shape, row by row across it. */
function rows(shape: Shape, r: Rect, spacing: number, fn: (ax: number, ay: number, bx: number, by: number, row: number) => void): void {
  const { ux, uy } = r;
  const vx = -uy;
  const vy = ux;
  const outer = shape[0].pts;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < outer.length; i += 2) {
    const v = outer[i] * vx + outer[i + 1] * vy;
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  let row = 0;
  for (let t = v0 + spacing / 2; t < v1; t += spacing, row++) {
    const us: number[] = [];
    for (const ring of shape) {
      const p = ring.pts;
      const n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const va = p[i * 2] * vx + p[i * 2 + 1] * vy;
        const vb = p[j * 2] * vx + p[j * 2 + 1] * vy;
        if (va <= t === vb <= t) continue;
        const ua = p[i * 2] * ux + p[i * 2 + 1] * uy;
        const ub = p[j * 2] * ux + p[j * 2 + 1] * uy;
        us.push(ua + ((t - va) / (vb - va)) * (ub - ua));
      }
    }
    us.sort((a, b) => a - b);
    for (let k = 0; k + 1 < us.length; k += 2) fn(ux * us[k] + vx * t, uy * us[k] + vy * t, ux * us[k + 1] + vx * t, uy * us[k + 1] + vy * t, row);
  }
}

/** Orchards are drawn as little trees when they're big enough on paper and trees are on. */
function orchardsAsTrees(B: Build): boolean {
  return B.set.trees > 0 && B.cam.s >= 0.2;
}

/** Little fruit trees in rows over orchards. */
export function orchardTrees(B: Build, paper: Paper, G: Ground, M: Masks): Tree[] {
  const out: Tree[] = [];
  if (!orchardsAsTrees(B)) return out;
  const { set, cam } = B;
  for (const c of G.covers) {
    if (c.code !== ORCHARD) continue;
    const { ux, uy } = c.rect;
    rows(c.shape, c.rect, 6, (ax, ay, bx, by) => {
      const len = Math.hypot(bx - ax, by - ay);
      for (let t = 2.5; t < len - 2; t += 5) {
        const x = ax + ux * t;
        const y = ay + uy * t;
        const sx = cam.sx(x, y);
        const sy = cam.sy(x, y, 0);
        if (paper.at(G.land, sx, sy) !== ORCHARD || paper.on(M.road, sx, sy) || paper.on(M.water, sx, sy) || paper.on(M.foot, sx, sy)) continue;
        const [k0, k1] = B.key(x, y);
        const r = 1.2 + hash(k0, k1, set.seed, 60) * 0.5;
        out.push({ x, y, r, h: r + 1.6 + hash(k0, k1, set.seed, 61) * 0.8, conifer: false });
      }
    });
  }
  return out;
}

/** Draw every ground texture. Call after the depth buffer is finished. */
export function drawGround(B: Build, paper: Paper, M: Masks, G: Ground, toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): void {
  const open = (x: number, y: number) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y);
  const flat = (code: number): Test => (x, y, d) => paper.at(G.land, x, y) === code && open(x, y) && !paper.on(M.shadow, x, y) && paper.seen(x, y, d);
  const standing: Test = (x, y, d) => open(x, y) && paper.seen(x, y, d);

  outline(paper, GREENERY, G.farmShapes, G.farms, open);

  for (const c of G.covers) {
    if (c.code === ALLOTMENT) allotment(B, paper, c, flat(ALLOTMENT));
    if (c.code === FIELD) field(B, paper, c, flat(FIELD));
    else if (c.code === VINEYARD) vineyard(B, paper, c, flat(VINEYARD), standing);
    else if (c.code === ORCHARD && !orchardsAsTrees(B)) dotted(B, paper, c, flat(ORCHARD));
  }

  symbols(B, paper, M, G, toAbs, fromAbs);
  wildGround(B, paper, M, G, toAbs, fromAbs);
  for (const c of G.cemeteries) cemetery(B, paper, M, G, c.shape, c.rect, standing);
  for (const p of G.pitches) pitch(paper, p, open);
}

/** A field: furrows along its length, solid when ploughed, dashed when it's stubble. */
function field(B: Build, paper: Paper, c: Cover, test: Test): void {
  const { ux, uy } = c.rect;
  const [k0, k1] = B.key(c.rect.cx, c.rect.cy);
  const r = (salt: number) => hash(k0, k1, B.set.seed, 50 + salt);
  const spacing = (FURROW_MM[0] + (FURROW_MM[1] - FURROW_MM[0]) * r(1)) / mmPer(B, -uy, ux);
  const along = mmPer(B, ux, uy);
  const stubble = r(2) < 0.3 && along > 0;
  rows(c.shape, c.rect, spacing, (ax, ay, bx, by, row) => {
    if (!stubble) {
      paper.line3(GREENERY, [ax, ay, 0, bx, by, 0], test);
      return;
    }
    const len = Math.hypot(bx - ax, by - ay);
    const dash = STUBBLE_MM[0] / along;
    const period = dash + STUBBLE_MM[1] / along;
    // Stagger alternate rows so the dashes don't line up into stripes.
    for (let t = (row % 2) * period * 0.5; t < len; t += period) {
      const t1 = Math.min(len, t + dash);
      paper.line3(GREENERY, [ax + ux * t, ay + uy * t, 0, ax + ux * t1, ay + uy * t1, 0], test);
    }
  });
}

/** Orchards too small for tree sprites: dotted rows where the trees stand. */
function dotted(B: Build, paper: Paper, c: Cover, test: Test): void {
  const { ux, uy } = c.rect;
  const along = mmPer(B, ux, uy);
  if (along <= 0) return;
  const spacing = Math.max(6, 1.8 / mmPer(B, -uy, ux));
  const dot = 0.35 / along;
  const period = Math.max(5, 1.2 / along);
  rows(c.shape, c.rect, spacing, (ax, ay, bx, by, row) => {
    const len = Math.hypot(bx - ax, by - ay);
    for (let t = (row % 2) * period * 0.5 + dot; t < len - dot; t += period) {
      paper.line3(GREENERY, [ax + ux * t, ay + uy * t, 0, ax + ux * (t + dot), ay + uy * (t + dot), 0], test);
    }
  });
}

/** Vineyards: rows of vines on wires between stakes, or plain rows when small on paper. */
function vineyard(B: Build, paper: Paper, c: Cover, ground: Test, standing: Test): void {
  const { ux, uy } = c.rect;
  const across = mmPer(B, -uy, ux);
  const spacing = Math.max(2.4, 2.2 / across);
  const tall = B.cam.s >= 0.35;
  rows(c.shape, c.rect, spacing, (ax, ay, bx, by) => {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 3) return;
    const sx = ax + ux * 0.8;
    const sy = ay + uy * 0.8;
    const ex = bx - ux * 0.8;
    const ey = by - uy * 0.8;
    if (!tall) {
      paper.line3(GREENERY, [sx, sy, 0, ex, ey, 0], ground);
      return;
    }
    paper.line3(GREENERY, [sx, sy, 1.0, ex, ey, 1.0], standing);
    const n = Math.max(1, Math.round((len - 1.6) / 8));
    for (let k = 0; k <= n; k++) {
      const x = sx + ((ex - sx) * k) / n;
      const y = sy + ((ey - sy) * k) / n;
      paper.line3(GREENERY, [x, y, 0, x, y, 1.2], standing);
    }
  });
}

/** Tufts on meadows, marsh dashes on wetland and stipple on sand, on a grid fixed to the map. */
function symbols(B: Build, paper: Paper, M: Masks, G: Ground, toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): void {
  const { cam, set } = B;
  const box = cam.region(0);
  const has = new Set<number>(G.covers.map((c) => c.code));
  const keep: Test = (x, y, d) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && paper.seen(x, y, d);
  const mark = (pen: number, sx: number, sy: number, d: number, shape: number[][]) =>
    paper.sheet(
      pen,
      shape.flatMap(([dx, dy]) => [sx + dx, sy + dy, d]),
      keep,
    );
  const passes: [number, number, number[]][] = [];
  if (has.has(MEADOW) || has.has(WETLAND) || G.gardens) passes.push([TUFT_MM, 11, [MEADOW, WETLAND, GARDEN]]);
  if (has.has(SAND) || has.has(BEACH)) passes.push([SAND_MM, 12, [SAND, BEACH]]);
  if (has.has(ROCK) || has.has(ICE)) passes.push([ROCK_MM, 13, [ROCK, ICE]]);
  const metre = toAbs(1, 0)[0] - toAbs(0, 0)[0];
  const [A0x, A0y] = toAbs(box[0], box[1]);
  const [A1x, A1y] = toAbs(box[2], box[3]);
  for (const [mm, salt, codes] of passes) {
    const step = (mm / cam.s) * metre;
    const i0 = Math.floor(A0x / step);
    const i1 = Math.ceil(A1x / step);
    const j0 = Math.floor(A0y / step);
    const j1 = Math.ceil(A1y / step);
    if ((i1 - i0) * (j1 - j0) > 600000) continue;
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const r = (k: number) => hash(i, j, set.seed, salt * 10 + k);
        const [x, y] = fromAbs((i + 0.1 + 0.8 * r(1)) * step, (j + 0.1 + 0.8 * r(2)) * step);
        const sx = cam.sx(x, y);
        const sy = cam.sy(x, y, 0);
        const code = paper.at(G.land, sx, sy);
        if (!codes.includes(code) || paper.on(M.shadow, sx, sy) || paper.on(M.foot, sx, sy)) continue;
        const d = cam.depth(x, y, 0);
        if (code === MEADOW) {
          if (r(3) < 0.85) mark(GREENERY, sx, sy, d, TUFT);
        } else if (code === GARDEN) {
          // Lawns: a little sparser than meadows, and never over a mapped park's hatching.
          if (r(3) < 0.6 && !paper.on(M.green, sx, sy)) mark(GREENERY, sx, sy, d, TUFT);
        } else if (code === WETLAND) {
          mark(SHADOWS, sx, sy, d, [
            [-0.8, 0],
            [0.8, 0],
          ]);
          if (r(3) < 0.6) mark(GREENERY, sx, sy - 0.15, d, SMALL_TUFT);
        } else if (code === ROCK) {
          if (r(3) < 0.7) mark(LINEWORK, sx, sy, d, r(4) < 0.5 ? BOULDER : BOULDER.map(([x, y]) => [-x * 0.7, y * 0.7]));
          if (r(5) < 0.6) mark(LINEWORK, sx + 1.1 * (r(6) - 0.5), sy + 0.8 * (r(7) - 0.5), d, DOT);
        } else if (code === ICE) {
          if (r(3) < 0.55) mark(WATER, sx, sy, d, r(4) < 0.5 ? CREVASSE : CREVASSE.map(([x, y]) => [x * 0.6, y]));
        } else if (code === BEACH) {
          if (r(3) < 0.55) mark(LINEWORK, sx, sy, d, DOT);
        } else if (code === SAND) {
          mark(LINEWORK, sx, sy, d, DOT);
          if (r(3) < 0.5) mark(LINEWORK, sx + 0.9 * (r(4) - 0.5), sy + 0.9 * (r(5) - 0.5), d, DOT);
        }
      }
  }
}

const TUFT = [
  [-0.45, -0.42],
  [-0.22, 0],
  [0, -0.55],
  [0.22, 0],
  [0.45, -0.42],
];
const BOULDER = [
  [-0.5, 0],
  [-0.38, -0.36],
  [-0.05, -0.5],
  [0.34, -0.3],
  [0.5, 0],
  [-0.5, 0],
];
const CREVASSE = [
  [-1.0, 0.1],
  [-0.5, -0.05],
  [0, 0.08],
  [0.5, -0.06],
  [1.0, 0.1],
];
/** Symbol grid for boulders and crevasses, mm on paper. */
const ROCK_MM = 3.6;
const SMALL_TUFT = TUFT.map(([x, y]) => [x * 0.7, y * 0.7]);
const DOT = [
  [-0.12, 0],
  [0.12, 0],
];

/** Rows of headstones, with crosses among them where that's the custom. */
function cemetery(B: Build, paper: Paper, M: Masks, G: Ground, shape: Shape, r: Rect, test: Test): void {
  const { cam, set, style } = B;
  const crosses = !['arid', 'eastAsian', 'tropical'].includes(style.id);
  const { ux, uy } = r;
  // Stones stand in a grid; turn their faces to whichever grid axis reads broader on paper.
  const wide = Math.abs(ux * cam.cb - uy * cam.sb) >= Math.abs(-uy * cam.cb - ux * cam.sb);
  const fx = wide ? ux : -uy;
  const fy = wide ? uy : ux;
  rows(shape, r, 3.6, (ax, ay, bx, by) => {
    const len = Math.hypot(bx - ax, by - ay);
    for (let t = 1.6; t < len - 1.4; t += 2.4) {
      const x = ax + ux * t;
      const y = ay + uy * t;
      const sx = cam.sx(x, y);
      const sy = cam.sy(x, y, 0);
      if (paper.at(G.land, sx, sy) !== CEMETERY || paper.on(M.foot, sx, sy) || paper.on(M.road, sx, sy)) continue;
      const [k0, k1] = B.key(x, y);
      const h = (salt: number) => hash(k0, k1, set.seed, 80 + salt);
      if (h(0) < 0.3) continue;
      if (crosses && h(1) < 0.3) {
        paper.line3(LINEWORK, [x, y, 0, x, y, 1.1], test);
        paper.line3(LINEWORK, [x - fx * 0.3, y - fy * 0.3, 0.78, x + fx * 0.3, y + fy * 0.3, 0.78], test);
      } else {
        const a = 0.4;
        const top = 0.5 + h(2) * 0.2;
        const P = (o: number, z: number) => [x + fx * o, y + fy * o, z];
        paper.line3(LINEWORK, [...P(-a, 0), ...P(-a, top), ...P(-a * 0.55, top + 0.15), ...P(a * 0.55, top + 0.15), ...P(a, top), ...P(a, 0)], test);
      }
    }
  });
}

/** Markings on a sports pitch, with goals, nets or hoops, fitted to the pitch. */
function pitch(paper: Paper, p: Pitch, open: (x: number, y: number) => boolean): void {
  const { cx, cy, ux, uy, L, w } = p.rect;
  const vx = -uy;
  const vy = ux;
  const markTest: Test = (x, y, d) => open(x, y) && paper.seen(x, y, d);
  const at = (u: number, v: number, z = 0) => [cx + ux * u + vx * v, cy + uy * u + vy * v, z];
  const line = (pts: [number, number][], closed = false) => paper.line3(GREENERY, pts.flatMap(([u, v]) => at(u, v)), markTest, closed);
  const kit = (pts: [number, number, number][]) => paper.line3(LINEWORK, pts.flatMap(([u, v, z]) => at(u, v, z)), markTest);
  const box = (u0: number, v0: number, u1: number, v1: number) =>
    line(
      [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ],
      true,
    );
  const arc = (cu: number, cv: number, r: number, a0: number, a1: number) => {
    const n = Math.max(6, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 32));
    const pts: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n;
      pts.push([cu + Math.cos(a) * r, cv + Math.sin(a) * r]);
    }
    line(pts);
  };

  const soccer = (FL: number, FW: number, ou = 0) => {
    const k = Math.min(1, FW / 68, FL / 105);
    box(ou - FL / 2, -FW / 2, ou + FL / 2, FW / 2);
    line([
      [ou, -FW / 2],
      [ou, FW / 2],
    ]);
    arc(ou, 0, 9.15 * k, 0, Math.PI * 2);
    for (const sk of [-1, 1]) {
      const g = ou + (sk * FL) / 2;
      const area = (depth: number, width: number) =>
        line([
          [g, -width / 2],
          [g - sk * depth, -width / 2],
          [g - sk * depth, width / 2],
          [g, width / 2],
        ]);
      area(16.5 * k, Math.min(40.3 * k, FW - 2));
      area(5.5 * k, Math.min(18.3 * k, FW - 4));
      const spot = g - sk * 11 * k;
      const half = Math.acos(Math.min(1, (5.5 * k) / (9.15 * k)));
      const dir = sk > 0 ? Math.PI : 0;
      arc(spot, 0, 9.15 * k, dir - half, dir + half);
      const gw = 3.66 * k;
      kit([
        [g, -gw, 0],
        [g, -gw, 2.44],
        [g, gw, 2.44],
        [g, gw, 0],
      ]);
      kit([
        [g, -gw, 2.44],
        [g + sk * 1.5, -gw, 0],
      ]);
      kit([
        [g, gw, 2.44],
        [g + sk * 1.5, gw, 0],
      ]);
    }
  };

  /** One tennis court centred at (cu, cv), its length along u or v. */
  const court = (cu: number, cv: number, alongU: boolean, k: number) => {
    const T = (a: number, b: number): [number, number] => (alongU ? [cu + a, cv + b] : [cu + b, cv + a]);
    const hl = 11.885 * k;
    const hw = 5.485 * k;
    const hs = 4.115 * k;
    const sv = 6.4 * k;
    line([T(-hl, -hw), T(hl, -hw), T(hl, hw), T(-hl, hw)], true);
    line([T(-hl, -hs), T(hl, -hs)]);
    line([T(-hl, hs), T(hl, hs)]);
    line([T(-sv, -hs), T(-sv, hs)]);
    line([T(sv, -hs), T(sv, hs)]);
    line([T(-sv, 0), T(sv, 0)]);
    const post = hw + 0.9 * k;
    const n = (b: number, z: number): [number, number, number] => [...T(0, b), z];
    kit([n(-post, 0), n(-post, 1.07), n(0, 0.914), n(post, 1.07), n(post, 0)]);
  };

  switch (p.sport) {
    case 'soccer': {
      const FL = Math.min(L - 3, 110);
      const FW = Math.min(w - 3, 75);
      if (FL >= 30 && FW >= 18) soccer(FL, FW);
      else box(-L / 2 + 1, -w / 2 + 1, L / 2 - 1, w / 2 - 1);
      break;
    }
    case 'tennis': {
      // Courts with room to run round them, tiled whichever way fits more.
      const CL = 36.6;
      const CW = 18.3;
      const a = Math.floor(L / CL) * Math.floor(w / CW);
      const b = Math.floor(L / CW) * Math.floor(w / CL);
      const alongU = a >= b;
      const nu = Math.max(1, alongU ? Math.floor(L / CL) : Math.floor(L / CW));
      const nv = Math.max(1, alongU ? Math.floor(w / CW) : Math.floor(w / CL));
      const k = Math.min(1, alongU ? (L - 1) / 23.77 : (L - 1) / 10.97, alongU ? (w - 1) / 10.97 : (w - 1) / 23.77);
      if (k < 0.5) {
        box(-L / 2 + 0.5, -w / 2 + 0.5, L / 2 - 0.5, w / 2 - 0.5);
        break;
      }
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) court(-L / 2 + (L / nu) * (i + 0.5), -w / 2 + (w / nv) * (j + 0.5), alongU, k);
      break;
    }
    case 'basketball': {
      const k = Math.min(1, (L - 2) / 28, (w - 2) / 15);
      const hl = 14 * k;
      const hw = 7.5 * k;
      box(-hl, -hw, hl, hw);
      line([
        [0, -hw],
        [0, hw],
      ]);
      arc(0, 0, 1.8 * k, 0, Math.PI * 2);
      for (const sk of [-1, 1]) {
        const base = sk * hl;
        const key = base - sk * 5.8 * k;
        line([
          [base, -2.45 * k],
          [key, -2.45 * k],
          [key, 2.45 * k],
          [base, 2.45 * k],
        ]);
        arc(key, 0, 1.8 * k, 0, Math.PI * 2);
        const hoop = base - sk * 1.575 * k;
        const r = 6.75 * k;
        const side = 6.6 * k;
        const half = Math.asin(Math.min(1, side / r));
        const dir = sk > 0 ? Math.PI : 0;
        arc(hoop, 0, r, dir - half, dir + half);
        const reach = hoop - sk * Math.cos(half) * r;
        line([
          [base, -side],
          [reach, -side],
        ]);
        line([
          [base, side],
          [reach, side],
        ]);
        const pole = base + sk * 1;
        const board = base - sk * 1.2 * k;
        kit([
          [pole, 0, 0],
          [pole, 0, 3.3],
          [board, 0, 3.3],
        ]);
        kit([
          [board, -0.9, 2.9],
          [board, -0.9, 3.95],
          [board, 0.9, 3.95],
          [board, 0.9, 2.9],
        ]);
      }
      break;
    }
    case 'track': {
      const R = w / 2 - 0.5;
      const S = L / 2 - w / 2;
      if (S < 5 || R < 12) {
        box(-L / 2 + 1, -w / 2 + 1, L / 2 - 1, w / 2 - 1);
        break;
      }
      const lanes = Math.min(6, Math.floor((R - 10) / 1.22) + 1);
      for (let i = 0; i < lanes; i++) {
        const r = R - i * 1.22;
        const pts: [number, number][] = [];
        for (let k = 0; k <= 16; k++) {
          const a = -Math.PI / 2 + (Math.PI * k) / 16;
          pts.push([S + Math.cos(a) * r, Math.sin(a) * r]);
        }
        for (let k = 0; k <= 16; k++) {
          const a = Math.PI / 2 + (Math.PI * k) / 16;
          pts.push([-S + Math.cos(a) * r, Math.sin(a) * r]);
        }
        line(pts, true);
      }
      const inner = R - lanes * 1.22 - 1;
      const FW = Math.min(68, 2 * inner - 4);
      const FL = Math.min(105, 2 * S + inner * 1.1);
      if (FL > 40 && FW > 25) soccer(FL, FW);
      break;
    }
    default: {
      const m = Math.min(1, w * 0.08);
      box(-L / 2 + m, -w / 2 + m, L / 2 - m, w / 2 - m);
      line([
        [0, -w / 2 + m],
        [0, w / 2 - m],
      ]);
      arc(0, 0, Math.min(w / 5, 3), 0, Math.PI * 2);
    }
  }
}

/** Bushes scattered over scrub, on a grid fixed to the map. */
export function scrubBushes(B: Build, paper: Paper, G: Ground, M: Masks, box: [number, number, number, number], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Tree[] {
  const { set, cam } = B;
  const out: Tree[] = [];
  if (set.trees <= 0 || !G.covers.some((c) => c.code === SCRUB)) return out;
  const step = 5.5 * (toAbs(1, 0)[0] - toAbs(0, 0)[0]);
  const [A0x, A0y] = toAbs(box[0], box[1]);
  const [A1x, A1y] = toAbs(box[2], box[3]);
  const i0 = Math.floor(A0x / step);
  const i1 = Math.ceil(A1x / step);
  const j0 = Math.floor(A0y / step);
  const j1 = Math.ceil(A1y / step);
  if ((i1 - i0) * (j1 - j0) > 600000) return out;
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const h = (k: number) => hash(i, j, set.seed, 150 + k);
      if (h(0) >= 0.5 + 0.3 * set.trees) continue;
      const [x, y] = fromAbs((i + 0.1 + 0.8 * h(1)) * step, (j + 0.1 + 0.8 * h(2)) * step);
      const sx = cam.sx(x, y);
      const sy = cam.sy(x, y, 0);
      if (paper.at(G.land, sx, sy) !== SCRUB || paper.on(M.foot, sx, sy) || paper.on(M.road, sx, sy) || paper.on(M.water, sx, sy) || paper.on(M.wood, sx, sy)) continue;
      const r = 0.8 + h(3) * 0.9;
      out.push({ x, y, r, h: r, conifer: false, bush: true });
    }
  return out;
}

/** Plot boundaries and rows of vegetables over allotments. */
function allotment(B: Build, paper: Paper, c: Cover, test: Test): void {
  const r = c.rect;
  rows(c.shape, r, PLOT[0], (ax, ay, bx, by) => paper.line3(GREENERY, [ax, ay, 0, bx, by, 0], test));
  rows(c.shape, turn(r), PLOT[1], (ax, ay, bx, by) => paper.line3(GREENERY, [ax, ay, 0, bx, by, 0], test));
  if (mmPer(B, -r.uy, r.ux) * 1.3 < 0.45) return;
  // Vegetable rows, dashed, kept back from the plot edges.
  const { ux, uy } = r;
  const v0 = r.cx * -uy + r.cy * ux;
  rows(c.shape, r, 1.3, (ax, ay, bx, by) => {
    const v = ((((ax * -uy + ay * ux - v0) % PLOT[0]) + PLOT[0] * 1.5) % PLOT[0]);
    if (v < 1.2 || v > PLOT[0] - 1.2) return;
    const len = Math.hypot(bx - ax, by - ay);
    for (let t = 1; t < len - 1; t += 2.4) {
      const t1 = Math.min(len - 1, t + 1.5);
      paper.line3(GREENERY, [ax + ux * t, ay + uy * t, 0, ax + ux * t1, ay + uy * t1, 0], test);
    }
  });
}

/** A garden shed in some allotment plots. */
export function allotmentSheds(B: Build, paper: Paper, G: Ground, M: Masks): Solid[] {
  const out: Solid[] = [];
  const { cam, set } = B;
  for (const c of G.covers) {
    if (c.code !== ALLOTMENT) continue;
    const r = c.rect;
    const vx = -r.uy;
    const vy = r.ux;
    for (let a = -r.L / 2 + PLOT[1] / 2; a < r.L / 2; a += PLOT[1])
      for (let b = -r.w / 2 + PLOT[0] / 2; b < r.w / 2; b += PLOT[0]) {
        const x = r.cx + r.ux * (a + PLOT[1] / 2 - 2.2) + vx * (b + PLOT[0] / 2 - 2);
        const y = r.cy + r.uy * (a + PLOT[1] / 2 - 2.2) + vy * (b + PLOT[0] / 2 - 2);
        const [k0, k1] = B.key(x, y);
        if (hash(k0, k1, set.seed, 160) > 0.45) continue;
        const sx = cam.sx(x, y);
        const sy = cam.sy(x, y, 0);
        if (paper.at(G.land, sx, sy) !== ALLOTMENT || paper.on(M.foot, sx, sy) || paper.on(M.road, sx, sy)) continue;
        const hl = 1.0 + hash(k0, k1, set.seed, 161) * 0.4;
        const hw = 0.8 + hash(k0, k1, set.seed, 162) * 0.3;
        const pts = [x - r.ux * hl - vx * hw, y - r.uy * hl - vy * hw, x + r.ux * hl - vx * hw, y + r.uy * hl - vy * hw, x + r.ux * hl + vx * hw, y + r.uy * hl + vy * hw, x - r.ux * hl + vx * hw, y - r.uy * hl + vy * hw];
        const s = newSolid();
        prism(B, [{ pts, seam: new Uint8Array(4) }], 0, 2.2, { roof: true, windows: false, pen: LINEWORK }, s);
        s.casts.push({ ring: pts, h: 2.2 });
        out.push(s);
      }
  }
  return out;
}

/** Square bales lying in rows on stubble fields, the same fields that are drawn dashed. */
export function bales(B: Build, paper: Paper, G: Ground, M: Masks): Solid[] {
  const out: Solid[] = [];
  const { cam, set } = B;
  if (cam.s < 0.3) return out;
  for (const c of G.covers) {
    if (c.code !== FIELD) continue;
    const { ux, uy } = c.rect;
    const [k0, k1] = B.key(c.rect.cx, c.rect.cy);
    // The same draw as the field's own texture, so bales lie only on stubble.
    if (!(hash(k0, k1, set.seed, 52) < 0.3 && mmPer(B, ux, uy) > 0)) continue;
    rows(c.shape, c.rect, 22, (ax, ay, bx, by, row) => {
      const len = Math.hypot(bx - ax, by - ay);
      for (let t = 6 + (row % 2) * 14; t < len - 6; t += 28) {
        const x = ax + ux * t;
        const y = ay + uy * t;
        const [b0, b1] = B.key(x, y);
        if (hash(b0, b1, set.seed, 170) > 0.45) continue;
        const sx = cam.sx(x, y);
        const sy = cam.sy(x, y, 0);
        if (paper.at(G.land, sx, sy) !== FIELD || paper.on(M.road, sx, sy) || paper.on(M.foot, sx, sy)) continue;
        const vx = -uy * 0.6;
        const vy = ux * 0.6;
        const pts = [x - ux * 1.2 - vx, y - uy * 1.2 - vy, x + ux * 1.2 - vx, y + uy * 1.2 - vy, x + ux * 1.2 + vx, y + uy * 1.2 + vy, x - ux * 1.2 + vx, y - uy * 1.2 + vy];
        const s = newSolid();
        prism(B, [{ pts, seam: new Uint8Array(4) }], 0, 0.9, { roof: true, windows: false, pen: LINEWORK }, s);
        s.casts.push({ ring: pts, h: 0.9 });
        out.push(s);
      }
    });
  }
  return out;
}

/** Where cows graze, and where sheep do. */
const COWS = new Set(['alpine', 'central', 'dutch', 'french', 'eastern', 'american', 'generic']);
const SHEEP = new Set(['british', 'nordic', 'antipodean', 'mediterranean', 'arid']);

/** Small herds of cows or sheep out on the meadows. */
export function livestock(B: Build, paper: Paper, G: Ground, M: Masks, box: [number, number, number, number], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Solid[] {
  const out: Solid[] = [];
  const { cam, set, style } = B;
  const cows = COWS.has(style.id);
  if (cam.s < 0.6 || !set.life || (!cows && !SHEEP.has(style.id)) || !G.covers.some((c) => c.code === MEADOW)) return out;
  const step = 70 * (toAbs(1, 0)[0] - toAbs(0, 0)[0]);
  const [A0x, A0y] = toAbs(box[0], box[1]);
  const [A1x, A1y] = toAbs(box[2], box[3]);
  const i0 = Math.floor(A0x / step);
  const i1 = Math.ceil(A1x / step);
  const j0 = Math.floor(A0y / step);
  const j1 = Math.ceil(A1y / step);
  if ((i1 - i0) * (j1 - j0) > 200000) return out;
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const h = (k: number) => hash(i, j, set.seed, 180 + k);
      if (h(0) > 0.25) continue;
      const [hx, hy] = fromAbs((i + 0.5) * step, (j + 0.5) * step);
      const count = 3 + Math.floor(h(1) * 5);
      for (let a = 0; a < count; a++) {
        const x = hx + (h(2 + a * 3) - 0.5) * 16;
        const y = hy + (h(3 + a * 3) - 0.5) * 16;
        const sx = cam.sx(x, y);
        const sy = cam.sy(x, y, 0);
        if (paper.at(G.land, sx, sy) !== MEADOW || paper.on(M.road, sx, sy) || paper.on(M.foot, sx, sy) || paper.on(M.water, sx, sy) || paper.on(M.wood, sx, sy)) continue;
        const ang = h(4 + a * 3) * Math.PI * 2;
        out.push(animal(B, x, y, Math.cos(ang), Math.sin(ang), cows));
      }
    }
  return out;
}

/** A cow or a sheep: a body on four legs, and a head held forward. */
function animal(B: Build, x: number, y: number, ux: number, uy: number, cow: boolean): Solid {
  const s = newSolid();
  const L = cow ? 1.1 : 0.6;
  const W = cow ? 0.4 : 0.35;
  const z0 = cow ? 0.75 : 0.4;
  const z1 = cow ? 1.45 : 0.95;
  const vx = -uy;
  const vy = ux;
  const P = (a: number, b: number) => [x + ux * a + vx * b, y + uy * a + vy * b];
  const body = [P(-L, -W), P(L, -W), P(L, W), P(-L, W)].flat();
  prism(B, [{ pts: body, seam: new Uint8Array(4) }], z0, z1, { roof: true, windows: false, pen: LINEWORK }, s);
  const hd = cow ? 0.3 : 0.2;
  const head = [P(L, -hd), P(L + hd * 1.8, -hd), P(L + hd * 1.8, hd), P(L, hd)].flat();
  prism(B, [{ pts: head, seam: new Uint8Array(4) }], z1 - hd * 2.2, z1 + hd * 0.3, { roof: true, windows: false, pen: LINEWORK }, s);
  for (const [a, b] of [
    [-L * 0.8, -W * 0.7],
    [-L * 0.8, W * 0.7],
    [L * 0.8, -W * 0.7],
    [L * 0.8, W * 0.7],
  ]) {
    const [lx, ly] = P(a, b);
    s.lines.push({ pen: LINEWORK, pts: [lx, ly, 0, lx, ly, z0] });
  }
  s.casts.push({ ring: body, h: z1 * 0.8 });
  return s;
}
