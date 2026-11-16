import type { Build } from './buildings';
import type { Kind } from './classify';
import { ringArea } from './geo';
import { LOD, shows } from './lod';
import { hash } from './rng';
import { seedFor, type Settings } from './settings';
import type { StyleId } from './styles';
import type { Building, Town } from './tiles';

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
};

export const CLIMATES: Record<ClimateId, Climate> = {
  temperate: { label: 'Temperate, seasonally wet', greenRoof: 0.55, tanks: 0.5 },
  hot_dry: { label: 'Hot and dry', greenRoof: 0, tanks: 0.8 },
  hot_humid: { label: 'Hot and humid', greenRoof: 0.5, tanks: 0.7 },
  monsoonal: { label: 'Monsoonal', greenRoof: 0.4, tanks: 0.8 },
  cold: { label: 'Cold, high latitude', greenRoof: 0.2, tanks: 0.25 },
  mountain: { label: 'Mountainous', greenRoof: 0.35, tanks: 0.4 },
  coastal: { label: 'Windy or coastal', greenRoof: 0.3, tanks: 0.45 },
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
  /** Wall height the downpipe comes down from, set when the building is built; unset means it wasn't drawn. */
  eave?: number;
};

/** District decisions shared by many features. */
export type FutureTown = { climate: ClimateId };

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
export function planFuture(town: Town, set: Settings, style: StyleId, key: (x: number, y: number) => [number, number]): FutureTown {
  const climate = climateFor(set, style);
  const C = CLIMATES[climate];
  const f = Math.max(0, Math.min(1, set.future));
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
  }
  return { climate };
}

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
