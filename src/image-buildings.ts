/**
 * Buildings for image mode (§12 of docs/plans/image-mode.md): a footprint on every lot the way
 * its zone builds, explicit heights kept smooth along a row, the evidence `classify()` reads to
 * make each one what it should be, and a few landmarks: churches by the squares and across the
 * town, a town hall on the largest square, schools with a pitch beside the parks. Streets the
 * blocks don't reach (dead ends, the town's outer edge) get buildings set along them.
 */
import { pointInRing, ringArea, toRing } from './geo';
import { civicSites, parishChurch } from './image-amenities';
import { CORNER, frontage, lotDepth, lotRing, merge, Occupancy, onLot, pavementOf, ROWS, strip, type Block, type Lot, type Vary } from './image-blocks';
import { centre, Footprints, inShape, simpleFootprint, type Ground } from './image-check';
import { footprintAtDensity, vacant, type Density } from './image-density';
import { learntPlan, planFill, type FloorplanGuides } from './image-floorplans';
import { LABELS, type Label } from './image-tone';
import { labelAt, type Zones } from './image-zones';
import { hash } from './rng';
import { bestRect, corners } from './shape';
import { walk } from './streets';
import type { Camera } from './camera';
import type { Target } from './image-read';
import type { Settings } from './settings';
import type { Style } from './styles';
import type { Area, Building, Poi, Shape, Tagged, Town, Way } from './tiles';

/** Buildings are laid out this far beyond the ground that can show, m; those beyond it are context only. */
const MARGIN = 60;
/** The most buildings a town gets (§17). */
export const MAX_BUILDINGS = 30000;
/** Storeys of each built label at its lowest and highest level. */
const STOREYS: Partial<Record<Label, [number, number]>> = { suburb: [1, 2], rows: [2, 3], old: [3, 5], blocks: [4, 7], towers: [10, 24], works: [2, 4] };
/** Rows: how far the building stands back from the front of its lot and how deep it is, m, at the zone's sparsest level and its densest. */
const ROW: Partial<Record<Label, { back: [number, number]; depth: [number, number] }>> = {
  old: { back: [0.5, 0], depth: [11, 14] },
  rows: { back: [2.5, 1], depth: [9, 12] },
  blocks: { back: [2, 0], depth: [13, 16] },
};
/** The narrowest plot in a row on paper, mm: at coarse scales rows are drawn as fewer, longer buildings. */
export const ROW_LOT_MM = 1.4;
/** How often a street side of each row zone repeats one learnt plan, as builders put up a terrace, rather than each house going its own way. */
const UNIFORM: Partial<Record<Label, number>> = { rows: 0.8, blocks: 0.5, old: 0.3 };
/** Churches stand at least this far apart, m, and one is sought in every cell this size of built town. */
const CHURCH_SPACING = 350;
const PARISH = 500;
/** What the frontage rows mark in the occupancy raster: they share walls only with each other. */
const SHARED = 2;
/** And what lots mark: they share their cut lines only with each other. */
const LOT = 3;
/** Schools stand at least this far apart, m. */
const SCHOOL_SPACING = 700;

/** What the buildings come to: footprints with their evidence, points of interest, and land use for schools and pitches. */
export type Built = { buildings: Building[]; tagged: Tagged[]; pois: Poi[]; landuse: Area[]; pools: Shape[] };
export type BuildContext = { cam: Camera; target: Target; z: Zones; set: Settings; style: Style; box: number[]; vary: Vary; occ: Occupancy; ground: Ground; laid: Footprints; plazas: Shape[]; parks: Shape[]; paths: Way[]; ways: Way[]; cores: [number, number][]; mmPerMetre: number; density?: Density; /** How fully `density` applies at a ground position, where masks set it for part of the picture; else Building density's own strength. */ densityAmount?: Density; guides?: FloorplanGuides };

const rect = (F: [number, number], u: [number, number], v: [number, number], w: number, d: number): number[] => [
  F[0], F[1], F[0] + u[0] * w, F[1] + u[1] * w, F[0] + u[0] * w + v[0] * d, F[1] + u[1] * w + v[1] * d, F[0] + v[0] * d, F[1] + v[1] * d,
];
/** A pool fitted across the back garden, three metres beyond the furthest wall. */
function poolBehind(house: number[], r: (salt: number) => number): number[] {
  const dx = house[2] - house[0], dy = house[3] - house[1], width = Math.hypot(dx, dy);
  const u: [number, number] = [dx / width, dy / width], v: [number, number] = [-u[1], u[0]];
  let depth = 0;
  for (let i = 4; i < house.length; i += 2)
    depth = Math.max(depth, (house[i] - house[0]) * v[0] + (house[i + 1] - house[1]) * v[1]);
  const length = Math.min(width, 5.5 + 4 * r(14731)), breadth = 2.8 + 2 * r(14732);
  const along = (width - length) * (0.25 + 0.5 * r(14733));
  const start: [number, number] = [house[0] + along * u[0] + (depth + 3) * v[0], house[1] + along * u[1] + (depth + 3) * v[1]];
  const form = r(14734);
  if (form < 0.35) return rect(start, u, v, length, breadth);
  // The same curve ranges from an oval plunge pool to a lap pool with softly rounded corners.
  const exponent = 0.32 + 0.68 * r(14735);
  const round = (n: number) => Math.sign(n) * Math.abs(n) ** exponent;
  const pts: number[] = [];
  for (let i = 0; i < 20; i++) {
    const a = i * Math.PI / 10;
    const dx = length * (1 + round(Math.cos(a))) / 2, dy = breadth * (1 + round(Math.sin(a))) / 2;
    pts.push(start[0] + dx * u[0] + dy * v[0], start[1] + dx * u[1] + dy * v[1]);
  }
  return pts;
}

function poolClearance(pts: number[], x: number, y: number): number {
  let radius = 0;
  for (let i = 0; i < pts.length; i += 2) radius = Math.max(radius, Math.hypot(pts[i] - x, pts[i + 1] - y));
  return radius + 1;
}
/** A unit-box plan laid on a rectangle: `F` its front corner, `u` along the street, `v` in from it, `W` × `D` m. */
function placed(plan: readonly number[], F: readonly number[], u: readonly number[], v: readonly number[], W: number, D: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < plan.length; i += 2) out.push(F[0] + u[0] * plan[i] * W + v[0] * plan[i + 1] * D, F[1] + u[1] * plan[i] * W + v[1] * plan[i + 1] * D);
  return out;
}

/**
 * Lay a street-facing rectangle out as a plan its zone builds: one learnt from real towns, or now
 * and then a bevelled tower or a works pair of halls round a service court. Sawtooth halls stay plain.
 */
function shapedPlan(q: number[], label: Label, roof: string | undefined, r: (salt: number) => number, mmPerMetre: number): number[] {
  if (roof === 'sawtooth') return q;
  const pick = r(14680);
  const ux = q[2] - q[0], uy = q[3] - q[1];
  const vx = q[6] - q[0], vy = q[7] - q[1];
  const width = Math.hypot(ux, uy), depth = Math.hypot(vx, vy);
  const cut = 0.26 + 0.10 * r(14681);
  let outline: number[];
  if (label === 'towers' && pick < 0.2) {
    // Equal setbacks in metres keep the corner facets square on long slabs too.
    const setback = Math.min(width, depth) * (0.16 + 0.08 * r(14682));
    const a = setback / width, b = setback / depth;
    outline = [a, 0, 1 - a, 0, 1, b, 1, 1 - b, 1 - a, 1, a, 1, 0, 1 - b, 0, b];
  } else if (label === 'works' && width >= 24 && depth >= 8 && pick < 0.12) {
    // Two parallel halls can share a central link, leaving loading courts at both ends.
    const front = depth >= 22 && pick < 0.06 ? [0.32, 0, 0.32, cut, 0.68, cut, 0.68, 0] : [];
    outline = [0, 0, ...front, 1, 0, 1, 1, 0.68, 1, 0.68, 1 - cut, 0.32, 1 - cut, 0.32, 1, 0, 1];
  } else {
    const plan = learntPlan(label, width, depth, mmPerMetre, false, r(14940), r(14941));
    if (!plan) return q;
    outline = plan.ring;
  }
  return placed(outline, q, [ux / width, uy / width], [vx / depth, vy / depth], width, depth);
}

/** Place gabled barns beside rural routes, with an open yard for silos and farm machinery. */
export function fieldBarns(town: Town, { box, vary, ground, laid, z }: Pick<BuildContext, 'box' | 'vary' | 'ground' | 'laid' | 'z'>): void {
  const fields = town.cover.filter(a => a.cls === 'farmland' || a.cls === 'meadow');
  if (!fields.length) return;
  const barns: [number, number][] = [];
  for (const w of town.ways) {
    if (w.bridge || w.service || (w.cls !== 'track' && w.kind !== 'road')) continue;
    walk(w.pts, 8, 60, 6, (mx, my, ux, uy) => {
      if (town.buildings.length >= MAX_BUILDINGS || vary(mx, my, 14752) >= 0.45) return;
      const side = vary(mx, my, 14753) < 0.5 ? -1 : 1;
      const back = w.width / 2 + 22 + 10 * vary(mx, my, 14754);
      // A wider verge or another building may leave the first clear field farther from the road.
      for (const offset of [back * side, -back * side, (back + 24) * side, -(back + 24) * side]) {
        const x = mx - uy * offset, y = my + ux * offset;
        if (x < box[0] || y < box[1] || x > box[2] || y > box[3]) continue;
        const label = labelAt(z, x, y);
        if ((label !== 'field' && label !== 'meadow') || barns.some(([a, b]) => Math.hypot(x - a, y - b) < 220)) continue;
        const site = { cx: x, cy: y, ux, uy };
        const yard = corners({ ...site, L: 29, w: 26 });
        const reach = Math.hypot(14.5, 13);
        if (ground.front(x, y) < reach || !ground.clear(yard) || laid.touches(yard)) continue;
        if (!fields.some(a => inShape(a.shape, x, y) && a.shape.every(r => toRing(x, y, r.pts) > reach))) continue;
        const pts = corners({ ...site, L: 24, w: 12 });
        town.buildings.push({ shape: [{ pts, seam: new Uint8Array(4) }], h: 7, min: 0 });
        town.tagged.push({ x, y, building: 'barn', roof: 'gabled', from: 'image' });
        town.landuse.push({ cls: 'farmyard', shape: [{ pts: yard, seam: new Uint8Array(4) }] });
        laid.add(yard);
        barns.push([x, y]);
        break;
      }
    });
  }
}

const within = (ring: number[], lot: number[]) => {
  for (let k = 0; k < ring.length; k += 2) if (!pointInRing(ring[k], ring[k + 1], lot) && toRing(ring[k], ring[k + 1], lot) > 0.05) return false;
  const [cx, cy] = centre(ring);
  return pointInRing(cx, cy, lot);
};
/**
 * A lot's front, along the street: where it starts, the unit along it, the unit inwards, and its
 * length. A lot spanning a corner fronts along its longer leg.
 */
function frontOf(l: Lot): { A: [number, number]; u: [number, number]; v: [number, number]; L: number } {
  const o = l.o;
  const n = o.length / 2;
  let split = -1;
  let sharpest = (CORNER * Math.PI) / 180;
  for (let k = 1; k < n - 1; k++) {
    const a = Math.atan2(o[k * 2 + 1] - o[k * 2 - 1], o[k * 2] - o[k * 2 - 2]);
    const b = Math.atan2(o[k * 2 + 3] - o[k * 2 + 1], o[k * 2 + 2] - o[k * 2]);
    let t = Math.abs(b - a);
    if (t > Math.PI) t = 2 * Math.PI - t;
    if (t > sharpest) [sharpest, split] = [t, k];
  }
  let [s, e] = [0, n - 1];
  if (split > 0) {
    const first = Math.hypot(o[split * 2] - o[0], o[split * 2 + 1] - o[1]);
    const second = Math.hypot(o[(n - 1) * 2] - o[split * 2], o[(n - 1) * 2 + 1] - o[split * 2 + 1]);
    [s, e] = first >= second ? [0, split] : [split, n - 1];
  }
  const ax = o[s * 2];
  const ay = o[s * 2 + 1];
  const L = Math.hypot(o[e * 2] - ax, o[e * 2 + 1] - ay) || 1;
  const u: [number, number] = [(o[e * 2] - ax) / L, (o[e * 2 + 1] - ay) / L];
  return { A: [ax, ay], u, v: [-u[1], u[0]], L };
}

/** Whether a lot's back is about as long as its front, so a plan laid on it isn't squeezed into a wedge. */
function squareish(l: Lot): boolean {
  let o = 0;
  let i = 0;
  for (let k = 2; k < l.o.length; k += 2) {
    o += Math.hypot(l.o[k] - l.o[k - 2], l.o[k + 1] - l.o[k - 1]);
    i += Math.hypot(l.i[k] - l.i[k - 2], l.i[k + 1] - l.i[k - 1]);
  }
  return i > 0.75 * o && i < 1.33 * o;
}

/** How much a pitched roof adds over the walls, as `classify()` reckons it, for a building this wide. */
const allowance = (w: number, style: Style) => Math.min((w / 2) * Math.tan(((style.pitch[0] + style.pitch[1]) * Math.PI) / 360), 13) * 0.45;

type Plan = { ring: number[]; pool?: number[]; h: number; building: string; roof?: string; across?: boolean; poi?: Poi; deepen?: (more: number) => number[] };

/** A building plot on a street the blocks don't reach. Its index follows the street walk, even where a plot is skipped. */
export type FrontageLot = { ring: number[]; label: Label; level: number; warmth: number; way: number; side: number; index: number };

type FrontageOptions = { record?: FrontageLot[]; tuned?: ReadonlyMap<number, FrontageLot> };

type DensityPlot = { empty: boolean; row: boolean; fits: (ring: number[]) => boolean; record?: FrontageLot; deepen?: (more: number) => number[] };

/** Lay out the buildings on the blocks' lots, then along the streets the blocks don't reach. */
export function buildingsOf(blocks: Block[], c: BuildContext, frontageOptions?: FrontageOptions): Built {
  const { set, style, vary, occ, laid } = c;
  const [bx0, by0, bx1, by1] = c.box;
  const inBox = (x: number, y: number, pad: number) => x >= bx0 - pad && x <= bx1 + pad && y >= by0 - pad && y <= by1 + pad;
  const out: Built = { buildings: [], tagged: [], pois: [], landuse: [], pools: [] };
  const plots: (DensityPlot | undefined)[] | undefined = c.density ? [] : undefined;
  const likeness = Math.max(0, Math.min(1, set.likeness));
  const worship = style.id === 'arid' ? 'mosque' : style.id === 'eastAsian' ? 'temple' : 'church';


  // Lots in order: landmarks first, then block by block; each takes its ground or is dropped.
  const all: Lot[] = blocks.flatMap((b) => b.lots).filter((l) => {
    const [x, y] = centre(lotRing(l));
    return inBox(x, y, MARGIN);
  });
  all.sort((a, b) => (b.use ? 1 : 0) - (a.use ? 1 : 0));
  const kept = all.filter((l) => {
    const ring = lotRing(l);
    if (!occ.free(ring, LOT)) return false;
    occ.take(ring, LOT);
    return true;
  });
  kept.sort((a, b) => a.block - b.block || a.side - b.side || a.index - b.index);

  const gardenPools = new Map<Building, number[]>();
  const towers: [number, number, number][] = [];
  const add = (p: Plan): boolean => {
    if (out.buildings.length >= MAX_BUILDINGS || !simpleFootprint(p.ring) || !c.ground.clear(p.ring) || laid.clash(p.ring)) return false;
    laid.add(p.ring);
    const [cx, cy] = centre(p.ring);
    const b: Building = { shape: [{ pts: p.ring, seam: new Uint8Array(p.ring.length / 2) }], h: p.h, min: 0 };
    if (!inBox(cx, cy, 0)) b.context = true;
    out.buildings.push(b);
    if (p.pool) gardenPools.set(b, p.pool);
    out.tagged.push({ x: cx, y: cy, building: p.building, roof: p.roof, across: p.across, from: 'image' });
    if (p.poi) out.pois.push({ ...p.poi, x: cx, y: cy });
    return true;
  };

  // Storeys along each street side, kept smooth: neighbours differ by one at full realism, three at full likeness.
  const step = Math.round(1 + 2 * likeness);
  let prev: Lot | null = null;
  let prevSt = 0;
  for (const l of kept) {
    const [lo, hi] = STOREYS[l.label] ?? [1, 2];
    const [fx, fy] = [l.o[0], l.o[1]];
    let st = Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * l.level + (vary(fx, fy, 14042) - 0.5) * 0.9)));
    const next = prev && prev.block === l.block && prev.side === l.side && l.index === prev.index + 1;
    if (next && !l.use && !prev!.use) st = Math.max(prevSt - step, Math.min(prevSt + step, st));
    prev = l;
    prevSt = st;
    const plans = footprints(l, st);
    if (c.density && plots && plans.length && !l.use) {
      const lot = lotRing(l);
      const [x, y] = centre(lot);
      const densityPlot = { empty: vacant((c.densityAmount ? c.densityAmount(x, y) : Math.abs(set.imageDensity)) * c.density(x, y), x, y, vary), row: ROWS.has(l.label), fits: (ring: number[]) => within(ring, lot) };
      for (const p of plans) if (add(p)) plots[out.buildings.length - 1] = p.deepen ? { ...densityPlot, deepen: p.deepen } : densityPlot;
    } else for (const p of plans) add(p);
  }

  /** The footprints on one lot. */
  function footprints(l: Lot, st: number): Plan[] {
    const ring = lotRing(l);
    const D = lotDepth(l);
    const { A, u, v, L } = frontOf(l);
    const [mx, my] = centre(ring);
    const r = (salt: number) => vary(mx, my, salt);
    // Rows keep one roof habit, building line and depth along a street side.
    const side = (salt: number) => hash(l.block, l.side, set.seed, salt);
    const at = (range: [number, number]) => range[0] + (range[1] - range[0]) * l.level;
    const pitched = (salt: number) => (ROWS.has(l.label) ? side(salt) : r(salt)) < l.warmth;

    /** The first of some rectangles, centred on the front (along it, into the lot, set back, m), that fits on the lot. */
    const fit = (sizes: [number, number, number][]) => {
      for (const [along, into, back] of sizes) {
        if (along < 6 || into < 6) continue;
        const q = rect([A[0] + u[0] * (L - along) * 0.5 + v[0] * back, A[1] + u[1] * (L - along) * 0.5 + v[1] * back], u, v, along, into);
        if (within(q, ring)) return q;
      }
      return null;
    };
    if (l.use === 'church') {
      // A nave into a deep lot, or along a shallow one, or a chapel where only that fits.
      const nave = 12 + 3 * r(14043);
      const q = fit([
        [Math.min(L - 4, nave), Math.min(D - 4, 32), 2],
        [Math.min(L - 4, 30), Math.min(D - 1.5, 14), 0.5],
        [10, Math.min(D - 3, 20), 2],
        [Math.min(L - 3, 20), 10, 1],
      ]);
      if (q && (bestRect(q).rect?.L ?? 0) >= 16) {
        // A churchyard round it, where the lot has room for one.
        if (ringArea(ring) > 2.2 * ringArea(q)) out.landuse.push({ shape: [{ pts: ring, seam: new Uint8Array(ring.length / 2) }], cls: 'cemetery' });
        return [{ ring: q, h: 13 + 4 * r(14044), building: worship }];
      }
      // In a row on a bend, the church takes the row's own strip.
      if (ROWS.has(l.label)) return [{ ring: strip(l, 0.05, Math.min(1, 14 / l.depth)), h: 13 + 4 * r(14044), building: worship }];
    }
    if (l.use === 'school') {
      // A hall set back on a deep lot; in a row, the row's own strip, three storeys and flat.
      const len = Math.min(L - 6, 50);
      const dep = Math.min(D - 6, 14);
      const F: [number, number] = [A[0] + u[0] * (L - len) * 0.5 + v[0] * 4, A[1] + u[1] * (L - len) * 0.5 + v[1] * 4];
      const q = len >= 20 && dep >= 9 ? rect(F, u, v, len, dep) : ROWS.has(l.label) ? strip(l, 0, Math.min(1, 12 / l.depth)) : null;
      if (q && within(q, ring)) {
        out.landuse.push({ shape: [{ pts: ring, seam: new Uint8Array(ring.length / 2) }], cls: 'school' });
        const pitch = pitchBy(q, u, c);
        if (pitch) out.landuse.push({ shape: [{ pts: pitch, seam: new Uint8Array(4) }], cls: 'pitch' });
        return [{ ring: q, h: (2 + Math.round(r(14045))) * style.floor, building: 'school', roof: 'flat' }];
      }
    }
    const hall = l.use === 'townhall' ? { building: 'civic', poi: { x: 0, y: 0, cls: 'town_hall', sub: 'townhall' } } : null;

    if (ROWS.has(l.label)) {
      const R = ROW[l.label]!;
      const back = at(R.back);
      const dep = R.depth[0] + (R.depth[1] - R.depth[0]) * side(14046);
      // Fractions of the block's depth, the same on every lot, so neighbours share their corners.
      const f0 = Math.min(0.3, back / l.depth);
      const f1 = Math.min(1, (back + dep) / l.depth);
      let q = strip(l, f0, f1);
      let deepest = Math.min(dep, l.depth - back);
      let deepen: ((more: number) => number[]) | undefined;
      const guided = c.guides && !hall ? c.guides.row(q, (p) => within(p, ring) && c.ground.clear(p) && !laid.clash(p)) : q;
      if (guided !== q) q = guided;
      else if (!hall) {
        // A plan learnt from real terraces: wings reaching back into the yard, a stair tower, a
        // narrower rear range. A street side often repeats one, mirrored house by house in pairs.
        const run = side(14942) < (UNIFORM[l.label] ?? 0);
        const pick = run ? side(14943) : r(14943);
        const flip = run ? ((l.index + (side(14944) < 0.5 ? 0 : 1)) % 2 ? 0.25 : 0.75) : r(14944);
        const main = (f1 - f0) * l.depth;
        const plan = squareish(l) ? learntPlan(l.label, frontage(l), main, c.mmPerMetre, true, pick, flip) : null;
        // Wings reach as far back as the lot lets them, so long as the main range keeps most of its depth.
        const reach = plan && Math.min(plan.depth, l.depth - back - 1);
        if (plan && reach && reach >= main) {
          const p = onLot(l, plan.ring, back, reach);
          if (within(p, ring)) {
            q = p;
            deepest = reach;
            deepen = (more) => onLot(l, plan.ring, back, reach * (1 + more));
          }
        }
      }
      const s = hall ? st + 1 : st;
      const roof = pitched(14047) ? undefined : 'flat';
      const h = s * style.floor + (roof ? 0 : allowance(Math.min(dep, D), style));
      const building = hall?.building ?? (l.label === 'old' && s > 3 ? 'apartments' : l.label === 'blocks' ? 'apartments' : 'terrace');
      const plans: Plan[] = [{ ring: q, h, building, roof, poi: hall?.poi, deepen }];
      // A back building behind a yard, on a plot deep enough, the more often the denser the zone.
      const yard = 3 + 3 * side(14096);
      const rear0 = back + Math.max(dep, deepest) + yard;
      const rearDepth = Math.min(l.depth - rear0 - 1, 8 + 6 * side(14097));
      if (!hall && rearDepth >= 5 && r(14098) < l.level) {
        const rs = Math.max(1, s - 2);
        plans.push({ ring: strip(l, rear0 / l.depth, (rear0 + rearDepth) / l.depth), h: rs * style.floor + (roof ? 0 : allowance(rearDepth, style)), building: 'terrace', roof });
      }
      // On less built-up plots a small workshop stands at the far end of the yard.
      if (!hall && plans.length === 1 && D > rear0 + 7 && L >= 6 && r(14710) < 0.22) {
        const w = Math.min(6, L - 2), d = 4;
        const back = Math.min(D - d - 1, rear0 + 4);
        const q = rect([A[0] + u[0] + v[0] * back, A[1] + u[1] + v[1] * back], u, v, w, d);
        if (within(q, ring)) plans.push({ ring: q, h: 3, building: 'shed', roof: style.id === 'arid' ? 'flat' : 'skillion' });
      }
      return plans;
    }
    if (l.label === 'suburb') {
      if (hall) {
        const q = fit([
          [24, 14, 6],
          [20, 12, 4],
          [16, 12, 3],
          [Math.min(L - 5, 14), 11, 3],
        ]);
        if (q) return [{ ring: q, h: 3 * style.floor, building: 'civic', poi: hall.poi }];
      }
      const plans: Plan[] = [];
      let ww = Math.min(9 + 3 * r(14048), L - 5);
      let dd = 8 + 3 * r(14049);
      let sb = 7 - 3 * l.level + 3 * (r(14050) - 0.5);
      if (ww < 6) return [];
      const m = L / 2 + (r(14051) - 0.5) * Math.max(0, L - ww - 5) * 0.6;
      const right = r(14053) < 0.5;
      // A plan learnt from real suburbs. One that leaves part of its box empty (an L, a porch
      // recess) first tries a box a little larger, so the house keeps about its floor area.
      const plan = learntPlan('suburb', ww, dd, c.mmPerMetre, false, r(14940), r(14941));
      const grow = plan ? Math.min(1.2, 1 / Math.sqrt(planFill(plan.ring))) : 1;
      let house: number[] | null = null;
      let houseDepth = dd;
      for (let tries = 0; tries < 3 && !house; tries++) {
        const [w, d] = tries === 0 ? [ww * grow, dd * grow] : [ww, dd];
        const F: [number, number] = [A[0] + u[0] * (m - w / 2) + v[0] * sb, A[1] + u[1] * (m - w / 2) + v[1] * sb];
        const q = plan ? placed(plan.ring, F, u, v, w, d) : rect(F, u, v, w, d);
        if (within(q, ring)) [house, houseDepth] = [q, d];
        else if (tries > 0) {
          sb *= 0.6;
          dd *= 0.85;
          ww *= 0.9;
        }
      }
      if (!house) return [];
      const roof = pitched(14056) ? undefined : 'flat';
      const s = Math.min(st, 2);
      if (c.guides) house = c.guides.detached(house, (p) => within(p, ring) && c.ground.clear(p) && !laid.clash(p));
      plans.push({ ring: house, h: s * style.floor + (roof ? 0 : allowance(Math.min(ww, dd), style)), building: 'house', roof });
      if (r(14730) < 0.16) {
        const pool = poolBehind(plans[0].ring, r);
        const [cx, cy] = centre(pool);
        if (pointInRing(cx, cy, ring) && toRing(cx, cy, ring) > poolClearance(pool, cx, cy)) plans[0].pool = pool;
      }
      if (r(14057) < 0.25) {
        const back = sb + houseDepth + 3;
        const off = right ? m - ww / 2 : m + ww / 2 - 3;
        const q = rect([A[0] + u[0] * off + v[0] * back, A[1] + u[1] * off + v[1] * back], u, v, 3, 3.5);
        if (within(q, ring)) plans.push({ ring: q, h: 2.6, building: 'shed' });
      }
      return plans;
    }
    if (l.label === 'works') {
      const gap = 5 + 3 * r(14058);
      const ww = L - 2 * gap;
      const sb = 8 + 4 * r(14059);
      let dd = Math.min(D - sb - 5, 28 + 17 * r(14060));
      if (dd < 12) dd = D - sb - 2;
      if (ww < 15 || dd < 10) return [];
      const q = rect([A[0] + u[0] * gap + v[0] * sb, A[1] + u[1] * gap + v[1] * sb], u, v, ww, dd);
      if (!within(q, ring)) return [];
      const roof = r(14062) < l.warmth ? 'sawtooth' : 'flat';
      return [{ ring: shapedPlan(q, l.label, roof, r, c.mmPerMetre), h: 6 + 2.5 * st, building: r(14061) < 0.4 ? 'warehouse' : 'industrial', roof }];
    }
    if (l.label === 'towers') {
      const slab = r(14063) < 0.4;
      let a = slab ? 36 + 14 * r(14064) : 18 + 6 * r(14064);
      let b = slab ? 14 + 2 * r(14065) : a;
      for (let tries = 0; tries < 2; tries++) {
        const cx = A[0] + u[0] * (L / 2) + v[0] * (D / 2);
        const cy = A[1] + u[1] * (L / 2) + v[1] * (D / 2);
        const q = rect([cx - u[0] * (a / 2) - v[0] * (b / 2), cy - u[1] * (a / 2) - v[1] * (b / 2)], u, v, a, b);
        const rad = Math.max(a, b) / 2;
        if (within(q, ring) && towers.every(([x, y, r2]) => Math.hypot(x - cx, y - cy) >= r2 + rad + 20)) {
          towers.push([cx, cy, rad]);
          return [{ ring: shapedPlan(q, l.label, 'flat', r, c.mmPerMetre), h: st * style.floor, building: 'apartments', roof: 'flat' }];
        }
        a = b = 18;
      }
    }
    return [];
  }

  frontages(c, out, add, frontageOptions, plots);
  // One freestanding keep can occupy a spacious old-town or terraced courtyard.
  for (const { court, label } of blocks) {
    if (!court || (label !== 'old' && label !== 'rows')) continue;
    const [x, y] = centre(court);
    if (!inBox(x, y, 0) || (label === 'rows' && vary(x, y, 14740) >= 0.5) || labelAt(c.z, x, y) !== label) continue;
    if (!pointInRing(x, y, court) || c.ground.front(x, y) > 75) continue;
    const room = toRing(x, y, court) - 2;
    if (room < Math.hypot(8, 6)) continue;
    const axis = bestRect(court).rect;
    if (!axis) continue;
    const large = room >= Math.hypot(10.5, 8);
    const q = corners({ ...axis, cx: x, cy: y, L: large ? 21 : 16, w: large ? 16 : 12 });
    if (add({ ring: q, h: 16, building: 'civic', roof: 'flat', poi: { x, y, cls: 'castle', sub: 'castle' } })) break;
  }
  civicSites(out, c);
  const parish = parishChurch(out, c);
  if (parish) gardenPools.delete(parish);
  if (c.density && plots) {
    // Reserve all accepted sites before extending any of them. A deep house may take up
    // its own back garden, but it should never knock a neighbour out of the street front.
    const occupied = new Footprints();
    const extensions = new Footprints();
    const { buildings, tagged } = out;
    out.buildings = [];
    out.tagged = [];
    for (let i = 0; i < buildings.length; i++) {
      const use = tagged[i].building;
      const civic = use === worship || use === 'hospital' || use === 'civic';
      const plot = civic ? undefined : plots[i];
      if (plot?.empty) continue;
      const b = buildings[i], tag = tagged[i];
      let ring = b.shape[0].pts;
      if (plot && tag.building !== 'shed') {
        const fits = (p: number[]) => simpleFootprint(p) && plot.fits(p) && c.ground.clear(p) && !laid.clash(p, i, i) && !extensions.clash(p);
        const full = footprintAtDensity(ring, plot.row, c.density, fits, plot.deepen);
        if (full !== ring) {
          // Find the room each plot has at full strength first. A house with little room
          // behind it then deepens gradually over the same slider range as its neighbours.
          const amount = c.densityAmount ? c.densityAmount(...centre(ring)) : Math.abs(set.imageDensity);
          if (amount === 1) ring = full;
          else {
            const blended = ring.map((v, k) => v + (full[k] - v) * amount);
            if (fits(blended)) {
              ring = blended;
              extensions.add(ring);
            }
          }
          extensions.add(full);
        }
        if (ring !== b.shape[0].pts) {
          b.shape[0].pts = ring;
          [tag.x, tag.y] = centre(ring);
          if (!inBox(tag.x, tag.y, 0)) b.context = true;
          else delete b.context;
        }
      }
      if (plot?.record) frontageOptions?.record?.push({ ...plot.record, ring });
      occupied.add(ring);
      out.buildings.push(b);
      out.tagged.push(tag);
    }
    c.laid = occupied;
  }
  // Density may vacate a plot or extend a house into the lawn. Check its final neighbours.
  for (const b of out.buildings) {
    const pts = gardenPools.get(b);
    if (!pts) continue;
    const [x, y] = centre(pts);
    if (c.ground.front(x, y) <= poolClearance(pts, x, y) || !c.ground.clear(pts) || c.laid.touches(pts)) continue;
    out.pools.push([{ pts, seam: new Uint8Array(pts.length / 2) }]);
    c.laid.add(pts);
  }
  return out;
}

/**
 * Lots made over into landmarks: a church beside every square of the old town, rows or blocks,
 * and one in every parish of built town that has none near; a town hall on the largest square
 * with lots beside it, or else at the middle of the main core;
 * a school beside each large park in suburbs and rows. A landmark takes a run of neighbouring
 * lots on one side, merged until its frontage is long enough.
 */
export function landmarks(blocks: Block[], c: BuildContext): void {
  // Every lot once, with where it is, filed by 50 m cell; `live` holds those not yet merged away.
  type Entry = { b: Block; l: Lot; at: [number, number] };
  // Only lots on the ground that shows: a landmark laid out of sight is no landmark.
  const [bx0, by0, bx1, by1] = c.box;
  const entries: Entry[] = blocks
    .flatMap((b) => b.lots.map((l) => ({ b, l, at: centre(lotRing(l)) })))
    .filter(({ at: [x, y] }) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1);
  const live = new Set(entries.map((x) => x.l));
  const open = (x: Entry) => live.has(x.l) && !x.l.use;
  /** Whether a lot's front runs straight, within a metre of its chord, so a church or school fits square on it. */
  const straight = (x: Entry) => {
    const o = x.l.o;
    const n = o.length;
    const L = Math.hypot(o[n - 2] - o[0], o[n - 1] - o[1]) || 1;
    for (let k = 2; k < n - 2; k += 2) if (Math.abs((o[k] - o[0]) * (o[n - 1] - o[1]) - (o[k + 1] - o[1]) * (o[n - 2] - o[0])) / L > 1) return false;
    return true;
  };
  const homely = (x: Entry) => x.l.label !== 'works' && x.l.label !== 'towers';
  const CELL = 50;
  const grid = new Map<number, Entry[]>();
  const id = (i: number, j: number) => (i + 32768) * 65536 + j + 32768;
  for (const x of entries) {
    const k = id(Math.floor(x.at[0] / CELL), Math.floor(x.at[1] / CELL));
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(x);
  }
  /** Open lots whose middles are within `d` of a ring's outline, nearest first: each stretch of the outline measured only to the lots in the cells beside it. */
  const beside = (ring: number[], d: number, want: (x: Entry) => boolean) => {
    const dist = new Map<Entry, number>();
    for (let a = 0, b = ring.length - 2; a < ring.length; b = a, a += 2) {
      const [ax, ay, bx, by] = [ring[b], ring[b + 1], ring[a], ring[a + 1]];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      for (let i = Math.floor((Math.min(ax, bx) - d) / CELL); i <= Math.floor((Math.max(ax, bx) + d) / CELL); i++)
        for (let j = Math.floor((Math.min(ay, by) - d) / CELL); j <= Math.floor((Math.max(ay, by) + d) / CELL); j++)
          for (const x of grid.get(id(i, j)) ?? []) {
            const t = Math.max(0, Math.min(1, ((x.at[0] - ax) * dx + (x.at[1] - ay) * dy) / l2));
            const e = Math.hypot(x.at[0] - ax - dx * t, x.at[1] - ay - dy * t);
            if (e < d && e < (dist.get(x) ?? Infinity)) dist.set(x, e);
          }
    }
    return [...dist].filter(([x]) => open(x) && want(x)).map(([x, e]) => ({ ...x, d: e })).sort((p, q) => p.d - q.d);
  };
  /** Merge a lot with its neighbours on the same side until its frontage is at least `need`. */
  const run = (b: Block, l: Lot, need: number, use: Lot['use']): Lot | null => {
    let m = l;
    const take = [l];
    for (let k = 1; k <= 6 && frontage(m) < need; k++) {
      const after = b.lots.find((x) => x.side === l.side && x.index === take[take.length - 1].index + 1 && !x.use);
      const before = b.lots.find((x) => x.side === l.side && x.index === take[0].index - 1 && !x.use);
      if (after && (k % 2 || !before)) {
        m = merge(m, after);
        take.push(after);
      } else if (before) {
        m = merge(before, m);
        take.unshift(before);
      } else break;
    }
    // Only ground a lot may take: a landmark refused later would leave the town without it.
    if (frontage(m) < need || !c.occ.free(lotRing(m), LOT)) return null;
    m.index = take[0].index;
    m.use = use;
    for (const t of take) live.delete(t);
    b.lots = b.lots.filter((x) => !take.includes(x));
    b.lots.push(m);
    b.lots.sort((p, q) => p.side - q.side || p.index - q.index);
    return m;
  };
  const churches: [number, number][] = [];
  const near = (list: [number, number][], x: number, y: number, d: number) => list.some(([px, py]) => Math.hypot(px - x, py - y) < d);

  // Squares, the largest first: a church beside each in town, the town hall beside the largest.
  const squares = c.plazas.map((s) => ({ s, area: ringArea(s[0].pts) })).filter((q) => q.area >= 600);
  squares.sort((a, b) => b.area - a.area);
  let halled = false;
  for (const { s } of squares) {
    const ring = s[0].pts;
    const by = beside(ring, 40, homely);
    if (!by.length) continue;
    const [sx, sy] = centre(ring);
    let church: Lot | null = null;
    if (by[0].l.label !== 'suburb' && !near(churches, sx, sy, CHURCH_SPACING)) {
      church = run(by[0].b, by[0].l, 22, 'church');
      if (church) churches.push(centre(lotRing(church)));
    }
    if (!halled) {
      const at = church ? centre(lotRing(church)) : null;
      const hall = by.find((x) => open(x) && (!at || Math.hypot(x.at[0] - at[0], x.at[1] - at[1]) > 30));
      if (hall) halled = !!run(hall.b, hall.l, 18, 'townhall');
    }
  }
  // With no square to stand on, the town hall stands nearest the middle of the main core.
  if (!halled && c.cores.length) {
    const [mx, my] = c.cores[0];
    const by = entries.filter((x) => open(x) && homely(x)).sort((a, b) => Math.hypot(a.at[0] - mx, a.at[1] - my) - Math.hypot(b.at[0] - mx, b.at[1] - my));
    for (const x of by.slice(0, 8)) if (run(x.b, x.l, 18, 'townhall')) break;
  }

  // A church in every parish of built town with none near, at the lot nearest a point the seed picks.
  const parishes = new Map<number, Entry[]>();
  for (const x of entries) {
    if (!open(x) || !homely(x)) continue;
    const k = id(Math.floor(x.at[0] / PARISH), Math.floor(x.at[1] / PARISH));
    (parishes.get(k) ?? parishes.set(k, []).get(k)!).push(x);
  }
  for (const [k, list] of [...parishes].sort(([a], [b]) => a - b)) {
    if (list.length < 30) continue;
    const i = Math.floor(k / 65536) - 32768;
    const j = (k % 65536) - 32768;
    const tx = (i + 0.25 + 0.5 * hash(i, j, c.set.seed, 14066)) * PARISH;
    const ty = (j + 0.25 + 0.5 * hash(i, j, c.set.seed, 14067)) * PARISH;
    if (near(churches, tx, ty, CHURCH_SPACING)) continue;
    const dist = (x: Entry) => Math.hypot(x.at[0] - tx, x.at[1] - ty) + (straight(x) ? 0 : 150);
    const best = list.filter(open).sort((a, b) => dist(a) - dist(b));
    for (const x of best.slice(0, 8)) {
      if (near(churches, x.at[0], x.at[1], CHURCH_SPACING)) break;
      const ch = run(x.b, x.l, 22, 'church');
      if (ch) {
        churches.push(centre(lotRing(ch)));
        break;
      }
    }
  }

  // A school beside each park of a hectare or more in suburbs and rows.
  const schools: [number, number][] = [];
  for (const park of c.parks) {
    const ring = park[0].pts;
    if (ringArea(ring) < 10000) continue;
    const [px, py] = centre(ring);
    if (near(schools, px, py, SCHOOL_SPACING)) continue;
    for (const x of beside(ring, 50, (x) => x.l.label === 'suburb' || x.l.label === 'rows').slice(0, 6)) {
      if (!open(x)) continue;
      const s = run(x.b, x.l, ROWS.has(x.l.label) ? 28 : 40, 'school');
      if (s) {
        schools.push(centre(lotRing(s)));
        break;
      }
    }
  }
}

/** A pitch in a park beside a school, square to it either way round, clear of the park's paths and edges, as near the school as it fits; null if none does. */
function pitchBy(school: number[], u: [number, number], c: BuildContext): number[] | null {
  const [sx, sy] = centre(school);
  let best: number[] | null = null;
  let bestD = Infinity;
  const v: [number, number] = [-u[1], u[0]];
  const fits = (q: number[], park: Shape) => {
    const ring = park[0].pts;
    for (let k = 0; k < 8; k += 2) if (!pointInRing(q[k], q[k + 1], ring) || toRing(q[k], q[k + 1], ring) < 2) return false;
    for (const hole of park.slice(1)) if (pointInRing(hole.pts[0], hole.pts[1], q) || [0, 2, 4, 6].some((k) => pointInRing(q[k], q[k + 1], hole.pts))) return false;
    for (const w of c.paths) {
      const p = w.pts;
      for (let k = 0; k < p.length; k += 2) if (pointInRing(p[k], p[k + 1], q) || toRing(p[k], p[k + 1], q) < 2) return false;
      // Long path segments can cross without a point inside: test their middles too.
      for (let k = 2; k < p.length; k += 2) {
        const mx = (p[k] + p[k - 2]) / 2;
        const my = (p[k + 1] + p[k - 1]) / 2;
        if (pointInRing(mx, my, q)) return false;
      }
    }
    return true;
  };
  for (const park of c.parks) {
    const ring = park[0].pts;
    if (ringArea(ring) < 10000 || toRing(sx, sy, ring) > 60) continue;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k < ring.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, ring[k]), Math.min(y0, ring[k + 1]), Math.max(x1, ring[k]), Math.max(y1, ring[k + 1])];
    for (let y = y0; y <= y1; y += 6)
      for (let x = x0; x <= x1; x += 6) {
        const d = Math.hypot(x - sx, y - sy);
        if (d >= bestD || d > 160 || !pointInRing(x, y, ring)) continue;
        for (const [a, b] of [[50, 32], [32, 50], [36, 22], [22, 36]]) {
          const q = rect([x - u[0] * (a / 2) - v[0] * (b / 2), y - u[1] * (a / 2) - v[1] * (b / 2)], u, v, a, b);
          if (fits(q, park)) {
            best = q;
            bestD = d;
            break;
          }
        }
      }
  }
  return best;
}

/**
 * How each built zone stands along streets the blocks don't reach, at its sparsest level and its
 * densest: plot width along the street, building width (0 for the whole plot, so neighbours
 * share their walls), depth and set-back, m, and the OSM building type it is said to be.
 */
type Frontage = { lot: [number, number]; width: [number, number]; depth: [number, number]; back: [number, number]; building: string };
const FRONTAGE: Partial<Record<Label, Frontage>> = {
  suburb: { lot: [28, 18], width: [9, 12], depth: [8, 11], back: [7, 4], building: 'house' },
  rows: { lot: [7.5, 6], width: [0, 0], depth: [9, 12], back: [2.5, 1], building: 'terrace' },
  old: { lot: [9, 6], width: [0, 0], depth: [12, 16], back: [0.5, 0], building: 'terrace' },
  blocks: { lot: [36, 24], width: [0, 0], depth: [13, 16], back: [2, 0], building: 'apartments' },
  towers: { lot: [95, 70], width: [18, 24], depth: [18, 24], back: [20, 14], building: 'apartments' },
  works: { lot: [75, 55], width: [40, 55], depth: [28, 45], back: [12, 8], building: 'industrial' },
};

/**
 * Buildings set along both sides of every street, the busiest first, where the blocks left the
 * ground free: up dead ends, along the town's outer edge, and in blocks too awkward to inset.
 * The occupancy raster keeps them off roads, lots and each other; houses in a row share walls.
 */
function frontages(c: BuildContext, out: Built, add: (p: Plan) => boolean, options?: FrontageOptions, plots?: (DensityPlot | undefined)[]): void {
  const { z, style, occ, vary } = c;
  const zoneAt = (x: number, y: number) => {
    const i = Math.floor((x - z.x0) / z.cell);
    const j = Math.floor((y - z.y0) / z.cell);
    return i < 0 || j < 0 || i >= z.W || j >= z.H ? -1 : j * z.W + i;
  };
  /** Whether a plot is free, and on land of `label` at its middle and near each corner. */
  const free = (q: number[], label: number, resizing = false) => {
    const [cx, cy] = centre(q);
    for (let k = -2; k < q.length; k += 2) {
      const [x, y] = k < 0 ? [cx, cy] : [q[k] + (cx - q[k]) * 0.15, q[k + 1] + (cy - q[k + 1]) * 0.15];
      const zc = zoneAt(x, y);
      if (zc < 0 || z.label[zc] !== label) return false;
    }
    // Once the original sites are reserved, their exact rings guard against neighbours.
    return resizing ? occ.allows(q, SHARED) : occ.free(q, SHARED);
  };
  const [bx0, by0, bx1, by1] = c.box;
  const inBox = (x: number, y: number, pad: number) => x >= bx0 - pad && x <= bx1 + pad && y >= by0 - pad && y <= by1 + pad;
  const RANKS: Record<string, number> = { primary: 4, secondary: 3, tertiary: 2, minor: 1 };
  const ways = c.ways;
  const order = ways.map((_, i) => i).sort((a, b) => (RANKS[ways[b].cls] ?? 0) - (RANKS[ways[a].cls] ?? 0) || a - b);
  const workshops: { ring: number[]; zone: number; parent: number }[] = [];
  const wings: { lot: Pick<Lot, 'o' | 'i' | 'depth'>; plan: number[]; depth: number; parent: number; laid: number; zone: number; record?: FrontageLot }[] = [];
  let index = 0;
  for (const wi of order) {
    const w = ways[wi];
    if (w.bridge) continue;
    const p = w.pts;
    // Distance along the street at each point, and the point at any distance.
    const cum = [0];
    for (let i = 2; i < p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
    const total = cum[cum.length - 1];
    let seg = 0;
    const pointAt = (d: number): [number, number] => {
      while (seg > 0 && cum[seg] > d) seg--;
      while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
      const t = (d - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
      return [p[seg * 2] + (p[seg * 2 + 2] - p[seg * 2]) * t, p[seg * 2 + 1] + (p[seg * 2 + 3] - p[seg * 2 + 1]) * t];
    };
    for (const sideSign of [1, -1]) {
      // A row keeps one depth and building line along a street side, and often one learnt plan.
      const rowHash = vary(p[0], p[1], sideSign > 0 ? 14020 : 14021);
      const runPlan = vary(p[0], p[1], sideSign > 0 ? 14945 : 14946);
      const runPick = vary(p[0], p[1], sideSign > 0 ? 14947 : 14948);
      let s = 4;
      while (s < total - 4 && out.buildings.length < MAX_BUILDINGS) {
        const plot = index++;
        // The street's way here: along the chord a few metres either side.
        const [fx, fy] = pointAt(s);
        const [gx, gy] = pointAt(Math.min(total, s + 6));
        const len = Math.hypot(gx - fx, gy - fy) || 1;
        const ux = (gx - fx) / len;
        const uy = (gy - fy) / len;
        const probe = zoneAt(fx - uy * sideSign * (w.width / 2 + pavementOf(w.cls) + 6), fy + ux * sideSign * (w.width / 2 + pavementOf(w.cls) + 6));
        const label = probe < 0 ? undefined : LABELS[z.label[probe]];
        const f = label && FRONTAGE[label];
        if (!f || !label) {
          s += 6;
          continue;
        }
        // The plot's frontage stays fixed when tuning changes its building's depth, height or roof.
        const home = z.level[probe];
        const tuned = options?.tuned?.get(plot);
        const level = tuned?.level ?? home;
        const at = (r: [number, number]) => r[0] + (r[1] - r[0]) * level;
        const row = f.width[1] === 0;
        const span = f.lot[0] + (f.lot[1] - f.lot[0]) * home;
        const lot = row ? Math.max(span, ROW_LOT_MM / c.mmPerMetre) : span;
        if (s + lot > total - 4) break;
        const [ax, ay] = pointAt(s);
        const [bx, by] = pointAt(s + lot);
        const chord = Math.hypot(bx - ax, by - ay);
        // Where the street bends sharply under a plot, there is no room for one.
        if (chord < lot * 0.9) {
          s += lot;
          continue;
        }
        const cx0 = (bx - ax) / chord;
        const cy0 = (by - ay) / chord;
        const nx = -cy0 * sideSign;
        const ny = cx0 * sideSign;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const r = (salt: number) => vary(mx, my, salt);
        const depth = at(f.depth) + (row ? 2 * rowHash : 2 * r(14023));
        const back = w.width / 2 + pavementOf(w.cls) + at(f.back) * (row ? 1 : 0.7 + 0.6 * r(14024));
        let q: number[];
        if (row) {
          // Rows are cut square to the street at each end, so on a bend neighbours share the cut
          // line and fan apart rather than overlap.
          const normal = (d: number): [number, number] => {
            const [p0x, p0y] = pointAt(Math.max(0, d - 3));
            const [p1x, p1y] = pointAt(Math.min(total, d + 3));
            const l = Math.hypot(p1x - p0x, p1y - p0y) || 1;
            return [(-(p1y - p0y) / l) * sideSign, ((p1x - p0x) / l) * sideSign];
          };
          const [n0x, n0y] = normal(s);
          const [n1x, n1y] = normal(s + lot);
          q = [ax + n0x * back, ay + n0y * back, bx + n1x * back, by + n1y * back, bx + n1x * (back + depth), by + n1y * (back + depth), ax + n0x * (back + depth), ay + n0y * (back + depth)];
        } else {
          const width = Math.min(chord - 2, at(f.width) + 2 * (r(14022) - 0.5));
          const s0 = (chord - width) / 2;
          const fr = [ax + cx0 * s0 + nx * back, ay + cy0 * s0 + ny * back, ax + cx0 * (s0 + width) + nx * back, ay + cy0 * (s0 + width) + ny * back];
          q = [...fr, fr[2] + nx * depth, fr[3] + ny * depth, fr[0] + nx * depth, fr[1] + ny * depth];
        }
        // Corners counter-clockwise, still starting on the street side.
        if (ringArea(q) < 0) q = [q[2], q[3], q[0], q[1], q[6], q[7], q[4], q[5]];
        const [qx, qy] = [(q[0] + q[4]) / 2, (q[1] + q[5]) / 2];
        if (inBox(qx, qy, MARGIN) && free(q, z.label[probe])) {
          const [lo, hi] = STOREYS[label] ?? [1, 2];
          const st = Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * level + (r(14025) - 0.5) * 0.9)));
          const warm = tuned?.warmth ?? z.warmth[probe];
          const roof = label === 'works' ? (r(14026) < warm ? 'sawtooth' : 'flat') : label === 'towers' || r(14027) >= warm ? 'flat' : undefined;
          const h = label === 'works' ? 6 + 2.5 * st : st * style.floor + (roof ? 0 : allowance(depth, style));
          const building = label === 'old' && st > 3 ? 'apartments' : label === 'works' && r(14028) < 0.4 ? 'warehouse' : f.building;
          if (!row) q = shapedPlan(q, label, roof, r, c.mmPerMetre);
          if (c.guides && (row || label === 'suburb')) {
            const fits = (p: number[]) => free(p, z.label[probe]) && c.ground.clear(p) && !c.laid.clash(p);
            q = row ? c.guides.row(q, fits) : c.guides.detached(q, fits);
          }
          // A plan learnt from real terraces, laid on the plot as on a block's lot once every street front is laid.
          let wing: { lot: Pick<Lot, 'o' | 'i' | 'depth'>; plan: number[]; depth: number } | undefined;
          if (row && q.length === 8 && !c.guides) {
            const run = runPlan < (UNIFORM[label] ?? 0);
            const plan = learntPlan(label, chord, depth, c.mmPerMetre, true, run ? runPick : r(14943), run ? (plot % 2 ? 0.25 : 0.75) : r(14944));
            if (plan) {
              const nx0 = (q[6] - q[0]) / depth, ny0 = (q[7] - q[1]) / depth;
              const nx1 = (q[4] - q[2]) / depth, ny1 = (q[5] - q[3]) / depth;
              wing = { lot: { o: q.slice(0, 4), i: [q[0] + nx0 * plan.depth, q[1] + ny0 * plan.depth, q[2] + nx1 * plan.depth, q[3] + ny1 * plan.depth], depth: plan.depth }, plan: plan.ring, depth: plan.depth };
            }
          }
          const pool = label === 'suburb' && r(14730) < 0.16 ? poolBehind(q, r) : undefined;
          if (add({ ring: q, h, building, roof, pool: pool && free(pool, z.label[probe]) ? pool : undefined })) {
            occ.take(q, SHARED);
            if ((label === 'rows' || label === 'suburb') && r(14711) < 0.08) {
              // A detached workshop across a back yard. Reserve all street fronts before trying it.
              const w = Math.min(5.5, chord - 2);
              const d = back + depth + 5;
              const F: [number, number] = [mx - cx0 * w * sideSign / 2 + nx * d, my - cy0 * w * sideSign / 2 + ny * d];
              workshops.push({ ring: rect(F, [cx0 * sideSign, cy0 * sideSign], [nx, ny], w, 4), zone: z.label[probe], parent: out.buildings.length - 1 });
            }
            const record = options?.record && { ring: q, label, level, warmth: roof === 'flat' ? 0 : 1, way: wi, side: sideSign, index: plot };
            if (wing) wings.push({ ...wing, parent: out.buildings.length - 1, laid: c.laid.count - 1, zone: z.label[probe], record });
            if (c.density && plots) {
              plots[out.buildings.length - 1] = { empty: vacant((c.densityAmount ? c.densityAmount(qx, qy) : Math.abs(c.set.imageDensity)) * c.density(qx, qy), qx, qy, vary), row, fits: (p) => free(p, z.label[probe], true), record };
            } else if (record) options?.record?.push(record);
          }
        }
        s += lot;
      }
    }
  }
  // Rear wings reach into yards only once every street front is laid, so no row loses a house to the wings of the row behind it.
  for (const { lot, plan, depth, parent, laid, zone, record } of wings) {
    const ring = onLot(lot, plan, 0, depth);
    if (!simpleFootprint(ring) || !free(ring, zone, true) || !c.ground.clear(ring) || c.laid.clash(ring, laid, laid)) continue;
    const b = out.buildings[parent];
    const tag = out.tagged[parent];
    b.shape[0] = { pts: ring, seam: new Uint8Array(ring.length / 2) };
    [tag.x, tag.y] = centre(ring);
    if (inBox(tag.x, tag.y, 0)) delete b.context;
    else b.context = true;
    c.laid.add(ring);
    occ.take(ring, SHARED);
    if (record) record.ring = ring;
    const plot = plots?.[parent];
    if (plot) plot.deepen = (more) => onLot(lot, plan, 0, depth * (1 + more));
  }
  for (const { ring, zone, parent } of workshops) {
    if (!free(ring, zone) || !add({ ring, h: 3, building: 'shed', roof: style.id === 'arid' ? 'flat' : 'skillion' })) continue;
    occ.take(ring, SHARED);
    const plot = plots?.[parent];
    if (plots && plot) plots[out.buildings.length - 1] = { ...plot, record: undefined };
  }
}
