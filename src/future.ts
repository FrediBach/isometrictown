import type { Build } from './buildings';
import type { Kind } from './classify';
import { pointInRing, ringArea } from './geo';
import { bestRect } from './shape';
import { LOD, shows } from './lod';
import { hash } from './rng';
import { seedFor, type Settings } from './settings';
import type { StyleId } from './styles';
import type { Building, Town, Way } from './tiles';

/*
 * Solarpunk mode: the same place as a settled, repaired and inhabited future (see
 * docs/solarpunk/). The planner decides, from what classify() worked out and without looking at
 * the camera, what each building and street becomes; drawing code then shows as much of that
 * future as the scale allows. It never changes what a building is, how tall it is or its roof.
 */

/** Climate profiles the future is designed for. */
export type ClimateId = 'temperate' | 'hot_dry' | 'hot_humid' | 'monsoonal' | 'cold' | 'mountain' | 'coastal';

/** What a climate asks of the future: chances and multipliers the planner and drawing code read. */
export type Climate = {
  label: string;
  /** Share of eligible flat roofs that get low planting. */
  greenRoof: number;
  /** Share of houses that get a rain tank by the back wall. */
  tanks: number;
  /** How much more often streets are lined with trees: fewer where water is short or wind exposes them. */
  streetTrees: number;
  /** What a house gets over its front door: a porch, a full-width veranda, a deep arcade or a glazed vestibule. */
  porch: 'porch' | 'veranda' | 'arcade' | 'vestibule';
  /** Share of balcony-frame bays closed in as winter gardens. */
  winter: number;
  /** Frames carry a shade rail under each floor, as open galleries. */
  gallery: boolean;
  /** Water is short: kerb rain gardens become dry stone channels, without plants. */
  dry: boolean;
};

export const CLIMATES: Record<ClimateId, Climate> = {
  temperate: { label: 'Temperate, seasonally wet', greenRoof: 0.55, tanks: 0.5, streetTrees: 1.5 , porch: 'porch', winter: 0.25, gallery: false , dry: false },
  hot_dry: { label: 'Hot and dry', greenRoof: 0, tanks: 0.8, streetTrees: 0.6 , porch: 'arcade', winter: 0, gallery: true , dry: true },
  hot_humid: { label: 'Hot and humid', greenRoof: 0.5, tanks: 0.7, streetTrees: 1.5 , porch: 'veranda', winter: 0, gallery: true , dry: false },
  monsoonal: { label: 'Monsoonal', greenRoof: 0.4, tanks: 0.8, streetTrees: 1.4 , porch: 'veranda', winter: 0, gallery: true , dry: false },
  cold: { label: 'Cold, high latitude', greenRoof: 0.2, tanks: 0.25, streetTrees: 1 , porch: 'vestibule', winter: 0.6, gallery: false , dry: false },
  mountain: { label: 'Mountainous', greenRoof: 0.35, tanks: 0.4, streetTrees: 1 , porch: 'porch', winter: 0.2, gallery: false , dry: false },
  coastal: { label: 'Windy or coastal', greenRoof: 0.3, tanks: 0.45, streetTrees: 0.8 , porch: 'porch', winter: 0.15, gallery: false , dry: false },
};
export const CLIMATE_IDS = Object.keys(CLIMATES) as ClimateId[];

/**
 * The climate worked out from the region: the building style and the latitude and longitude of
 * the centre, which pick the style too, so it doesn't change as the view pans. Coastal exposure
 * needs more than the loaded area can tell, so it is only chosen by hand.
 */
export function climateOf(style: StyleId, [lng, lat]: readonly [number, number]): ClimateId {
  const a = Math.abs(lat);
  if (style === 'arid') return 'hot_dry';
  if ((style === 'american' || style === 'antipodean') && a < 36 && (lng < -97 || style === 'antipodean')) return 'hot_dry';
  // South and South-east Asia: the monsoon belt.
  if (lng > 65 && lng < 125 && lat > 0 && lat < 30 && (style === 'tropical' || style === 'eastAsian')) return 'monsoonal';
  if (style === 'tropical' || a < 23.5) return 'hot_humid';
  if (style === 'nordic' || a > 58) return 'cold';
  if (style === 'alpine') return 'mountain';
  return 'temperate';
}

/** The climate in force: the one chosen, or the region's. */
export function climateFor(set: Pick<Settings, 'climate' | 'center'>, style: StyleId): ClimateId {
  return set.climate !== 'auto' && CLIMATES[set.climate] ? set.climate : climateOf(style, set.center);
}

/** Recipes from docs/solarpunk/Solarpunk Recipes.json that the planner can tell apart. */
export type RecipeId = 'B01' | 'B02' | 'B03' | 'B04' | 'B05' | 'B07' | 'B12' | 'B14' | 'B16' | 'B19' | 'B22' | 'B27' | 'B28';

/** What the future does with one building. Written by `planFuture()`; `classify()` never reads it. */
export type Future = {
  recipe: RecipeId;
  /** Solar panels on the roof: a patch on the sunny slope, rows on a flat roof, or modules on sawtooth slopes. */
  roofPv: boolean;
  /** Low planting on a flat roof, around the panels and plant rooms. */
  greenRoof: boolean;
  /** A rain tank by the back wall, fed by a downpipe. */
  tank: boolean;
  /** The one addition the building gets beside its roof, if any. */
  addition?: Addition;
  /** Outer-ring edge a balcony frame or trellis stands along. */
  side?: number;
  /** A district's moment of wonder: the one balcony frame in its 200 m cell that is planted and lived in. */
  wonder?: boolean;
  /** Wall height the downpipe comes down from, set when the building is built; unset means it wasn't drawn. */
  eave?: number;
  /** The walls as built, set by house(), so a porch finds the same front door the facade drew. */
  wall?: { pts: number[]; seam: Uint8Array; party?: Float32Array };
  /** Ground an addition stands on, set when it is built, so trees and cars keep off it. */
  strip?: number[];
};

/** Supported additions to a building (docs/solarpunk/implementation-plan.md §7.2). */
export type Addition = 'frame' | 'porch' | 'canopy' | 'fins' | 'trellis';

/** District decisions shared by many features. */
export type FutureTown = {
  climate: ClimateId;
  /**
   * Places where people gather, filled in as the drawing makes them: in front of market stalls,
   * under pergolas, in school yards. [x, y, how many, spread in metres, child]. people() draws them.
   */
  gather: [number, number, number, number, boolean][];
};

/** Heritage and landmarks keep their roofs as they are. */
function recipeOf(kind: Kind, b: Building): RecipeId {
  const i = b.info!;
  if (i.castle) return 'B28';
  if (kind === 'worship') return 'B16';
  if (i.hospital) return 'B12';
  if (i.townHall) return 'B14';
  if (i.shop) return 'B07';
  switch (kind) {
    case 'house':
      return 'B01';
    case 'terrace':
      return 'B02';
    case 'apartment':
      // Perimeter blocks of a dense core keep their street fronts; free-standing blocks are slabs.
      return i.party.some((v) => v > 0) ? 'B03' : 'B04';
    case 'tall':
      return 'B05';
    case 'industrial':
      return 'B19';
    case 'shed':
      return 'B22';
    case 'civic':
      return 'B14';
    default:
      return 'B27';
  }
}

/** Recipes whose roofs stay untouched. */
const KEEP_ROOF = new Set<RecipeId>(['B12', 'B16', 'B28']);

/**
 * Plan the future of every classified building, context buildings included, so that district
 * decisions agree from every view. Call straight after `classify()`, before context buildings
 * are dropped. Keyed to each building's seed (lock-aware) and position, never to the camera.
 */
export function planFuture(town: Town, set: Settings, style: StyleId, key: (x: number, y: number) => [number, number], cell: (x: number, y: number, size: number) => [number, number] = (x, y, size) => [Math.round(x / size), Math.round(y / size)]): FutureTown {
  const climate = climateFor(set, style);
  const C = CLIMATES[climate];
  const f = Math.max(0, Math.min(1, set.future));
  const ground = new Obstacles(town);
  /** The best balcony frame in each 200 m cell, by its hash, becomes the district's wonder. */
  const wonders = new Map<string, [Building, number]>();
  for (const b of town.buildings) {
    const i = b.info;
    if (!i) continue;
    const p = b.shape[0].pts;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let q = 0; q < p.length; q += 2) {
      x0 = Math.min(x0, p[q]);
      x1 = Math.max(x1, p[q]);
      y0 = Math.min(y0, p[q + 1]);
      y1 = Math.max(y1, p[q + 1]);
    }
    const k = key((x0 + x1) / 2, (y0 + y1) / 2);
    const own = seedFor(set, i.seed);
    // Rows decide together (coordinated roof modules); single buildings by their own position.
    const row = (salt: number) => hash(i.seed[0], i.seed[1], own, 12000 + salt);
    const mine = (salt: number) => hash(k[0], k[1], own, 12000 + salt);
    const recipe = recipeOf(i.kind, b);
    const area = Math.abs(ringArea(p));
    const flat = i.roof === 'flat';
    const pitched = i.roof === 'gabled' || i.roof === 'hipped' || i.roof === 'halfHipped' || i.roof === 'sawtooth';
    let roofPv = false;
    let greenRoof = false;
    if (!KEEP_ROOF.has(recipe) && recipe !== 'B22') {
      const pv = recipe === 'B19' ? 0.6 + 0.35 * f : 0.4 + 0.5 * f;
      if (pitched || (flat && area > 120)) roofPv = (i.kind === 'terrace' ? row(1) : mine(1)) < pv;
      // Low planting on flat roofs where the climate suits it; on big roofs beside the panels.
      if (flat && area > 80 && (!roofPv || area > 500)) greenRoof = mine(2) < C.greenRoof * (0.4 + 0.6 * f);
    }
    const tank = (recipe === 'B01' || recipe === 'B02') && mine(3) < C.tanks * (0.3 + 0.6 * f);
    b.future = { recipe, roofPv, greenRoof, tank };
    const add = addition(b, recipe, ground, C, (salt) => (i.kind === 'terrace' ? row(salt) : mine(salt)), f);
    if (add) {
      b.future.addition = add[0];
      b.future.side = add[1];
      if (add[0] === 'frame') {
        const [c0, c1] = cell((x0 + x1) / 2, (y0 + y1) / 2, 200);
        const id = `${c0},${c1}`;
        const h = mine(9);
        const best = wonders.get(id);
        if (!best || h > best[1]) wonders.set(id, [b, h]);
      }
    }
  }
  for (const [b] of wonders.values()) b.future!.wonder = true;
  return { climate, gather: [] };
}

/** Recipes that take a balcony frame, a porch, an entrance canopy, fins or a trellis, and the chance they do at Intensity 0 and 1. */
const ADDS: Partial<Record<RecipeId, [Addition, number, number]>> = {
  B01: ['porch', 0.35, 0.8],
  B02: ['porch', 0.2, 0.55],
  B04: ['frame', 0.35, 0.9],
  B05: ['fins', 0.4, 0.9],
  B12: ['canopy', 0.5, 0.9],
  B14: ['canopy', 0.4, 0.85],
  B19: ['trellis', 0.2, 0.6],
};

/** Outward unit normal and length of outer-ring edge e (rings run counter-clockwise). */
function edge(p: number[], e: number): [number, number, number] {
  const n = p.length / 2;
  const j = (e + 1) % n;
  const dx = p[j * 2] - p[e * 2];
  const dy = p[j * 2 + 1] - p[e * 2 + 1];
  const len = Math.hypot(dx, dy) || 1;
  return [dy / len, -dx / len, len];
}

/** The front-door wall as prism() picks it: the longest outside wall facing the street. */
export function doorEdge(ring: { pts: number[]; seam: Uint8Array; party?: Float32Array }, toStreet: [number, number]): number {
  const p = ring.pts;
  let best = 0;
  let door = -1;
  for (let e = 0; e < p.length / 2; e++) {
    const [nx, ny, len] = edge(p, e);
    if (ring.seam[e] || (ring.party?.[e] ?? 0) > 0 || len < 2.6) continue;
    const dot = nx * toStreet[0] + ny * toStreet[1];
    if (dot > 0.55 && dot * len > best) {
      best = dot * len;
      door = e;
    }
  }
  return door;
}

/** Which addition a building gets, and along which edge, if there is room for it on the ground. */
function addition(b: Building, recipe: RecipeId, ground: Obstacles, C: Climate, r: (salt: number) => number, f: number): [Addition, number] | null {
  const i = b.info!;
  // Rows of three storeys or more and perimeter blocks take a frame on their back wall, as rear galleries.
  const want = (recipe === 'B02' && b.h >= 9) || recipe === 'B03' ? (['frame', 0.25, 0.75] as [Addition, number, number]) : ADDS[recipe];
  if (!want || r(20) >= want[1] + (want[2] - want[1]) * f) return null;
  const [kind] = want;
  const ring = b.shape[0];
  const p = ring.pts;
  const n = p.length / 2;
  const usable = (e: number) => !ring.seam[e] && !(i.party[e] > 0);
  if (kind === 'fins') return b.h > 30 ? ['fins', -1] : null;
  if (kind === 'porch' || kind === 'canopy') {
    if (!i.toStreet) return null;
    const e = doorEdge({ ...ring, party: i.party }, i.toStreet);
    if (e < 0) return null;
    const [, , len] = edge(p, e);
    const deep = kind === 'canopy' ? 2.3 : C.porch === 'veranda' || C.porch === 'arcade' ? 2.6 : 1.9;
    const span = C.porch === 'veranda' && kind === 'porch' ? len / 2 - 0.3 : 1.7;
    return ground.clear(b, p, e, len / 2 - span, len / 2 + span, deep) ? [kind, e] : null;
  }
  // Frames and trellises stand along a long wall, the one turned most from the street, where the ground is free.
  const { rect } = bestRect(p);
  const joined = recipe === 'B02' || recipe === 'B03';
  if (kind === 'frame' && (!rect || b.h > 36 || (!joined && (rect.L < 22 || rect.L / rect.w < 2)))) return null;
  const order: [number, number][] = [];
  for (let e = 0; e < n; e++) {
    if (!usable(e)) continue;
    const [nx, ny, len] = edge(p, e);
    if (len < (kind === 'frame' && !joined ? 15 : 8)) continue;
    const toward = i.toStreet ? Math.max(0, nx * i.toStreet[0] + ny * i.toStreet[1]) : 0;
    order.push([e, len * (1 - 0.8 * toward)]);
  }
  order.sort((a, c) => c[1] - a[1] || a[0] - c[0]);
  const deep = kind === 'frame' ? 2.7 : 0.7;
  for (const [e] of order.slice(0, 3)) {
    const [, , len] = edge(p, e);
    if (ground.clear(b, p, e, 0.3, len - 0.3, deep)) return [kind, e];
  }
  return null;
}

/**
 * What stands on the ground, in world metres, for testing where an addition can go without
 * looking at the view: other buildings, roads and railways, and water.
 */
class Obstacles {
  private cells = new Map<string, number[]>();
  private items: ({ kind: 'ring'; pts: number[]; owner?: Building } | { kind: 'seg'; ax: number; ay: number; bx: number; by: number; r: number })[] = [];
  constructor(town: Town) {
    for (const b of town.buildings) this.ring(b.shape[0].pts, b);
    for (const w of town.water) this.ring(w[0].pts);
    for (const w of town.ways) {
      if (w.kind === 'path') continue;
      const r = (w.kind === 'rail' ? 2 : w.width / 2) + 0.2;
      for (let q = 0; q + 3 < w.pts.length; q += 2) this.add({ kind: 'seg', ax: w.pts[q], ay: w.pts[q + 1], bx: w.pts[q + 2], by: w.pts[q + 3], r }, [Math.min(w.pts[q], w.pts[q + 2]) - r, Math.min(w.pts[q + 1], w.pts[q + 3]) - r, Math.max(w.pts[q], w.pts[q + 2]) + r, Math.max(w.pts[q + 1], w.pts[q + 3]) + r]);
    }
  }
  private ring(pts: number[], owner?: Building): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let q = 0; q < pts.length; q += 2) {
      x0 = Math.min(x0, pts[q]);
      x1 = Math.max(x1, pts[q]);
      y0 = Math.min(y0, pts[q + 1]);
      y1 = Math.max(y1, pts[q + 1]);
    }
    this.add({ kind: 'ring', pts, owner }, [x0, y0, x1, y1]);
  }
  private add(item: Obstacles['items'][number], [x0, y0, x1, y1]: number[]): void {
    const id = this.items.push(item) - 1;
    // Huge water bodies are tested by their own rings; their boxes would fill every cell.
    if ((x1 - x0) * (y1 - y0) > 4e6) return void this.big.push(id);
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
      for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
        const k = `${i},${j}`;
        const c = this.cells.get(k);
        if (c) c.push(id);
        else this.cells.set(k, [id]);
      }
  }
  private big: number[] = [];
  /** Whether a point is on something other than `self`. */
  blocked(x: number, y: number, self: Building): boolean {
    const ids = [...(this.cells.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? []), ...this.big];
    for (const id of ids) {
      const it = this.items[id];
      if (it.kind === 'ring') {
        if (it.owner !== self && pointInRing(x, y, it.pts)) return true;
      } else {
        const dx = it.bx - it.ax;
        const dy = it.by - it.ay;
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - it.ax) * dx + (y - it.ay) * dy) / l2));
        if (Math.hypot(it.ax + dx * t - x, it.ay + dy * t - y) < it.r) return true;
      }
    }
    return false;
  }
  /** Whether a strip in front of edge e, from u0 to u1 along it and `deep` metres out, is clear. */
  clear(self: Building, p: number[], e: number, u0: number, u1: number, deep: number): boolean {
    const [nx, ny, len] = edge(p, e);
    const ax = p[e * 2];
    const ay = p[e * 2 + 1];
    const ux = -ny;
    const uy = nx;
    const a = Math.max(0, u0);
    const z = Math.min(len, u1);
    if (z - a < 1) return false;
    for (let u = a; u <= z + 1e-6; u += Math.min(1.5, (z - a) / 2))
      for (const d of [0.4, deep / 2, deep])
        if (this.blocked(ax + ux * u + nx * d, ay + uy * u + ny * d, self)) return false;
    return true;
  }
}

const CELL = 32;

/**
 * How much of a building's future shows at this scale: 1 only the main change, simplified; 2
 * with its supporting system; 3 with close-scale fittings and life as well.
 */
export function motifBudget(B: Build, b: Building): 1 | 2 | 3 {
  const size = Math.sqrt(Math.abs(ringArea(b.shape[0].pts)));
  if (!shows(B.cam, LOD.futureTwo, size)) return 1;
  if (!shows(B.cam, LOD.futureDetail, size)) return 2;
  return 3;
}

/**
 * Whether a solarpunk main road has a planted strip down its middle: two-way primary roads wide
 * enough to give it room, most of them, decided per road by the cell its middle lies in.
 */
export function hasMedian(B: Build, w: Way): boolean {
  if (!B.future || w.kind !== 'road' || w.oneway || w.bridge || w.cls !== 'primary' || w.width < 13) return false;
  const p = w.pts;
  const mid = Math.floor(p.length / 4) * 2;
  const [c0, c1] = B.cell(p[mid], p[mid + 1], 20);
  return hash(c0, c1, B.set.seed, 12270) < 0.3 + 0.5 * Math.max(0, Math.min(1, B.set.future));
}

/** Half the width of a planted median, metres. */
export const MEDIAN = 1.1;
