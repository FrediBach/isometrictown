import type { Build } from './buildings';
import type { Kind } from './classify';
import { pointInRing } from './geo';
import { hash, patch } from './rng';
import type { Building } from './tiles';

/*
 * Abandonment: how far the town has been left, from lived in (0) to overgrown ruins (1).
 * See docs/plans/abandonment.md. Every decision here keeps three rules: at 0 nothing changes,
 * raising the slider never brings anything back, and fates are fixed to the map, so panning
 * doesn't change which car has gone or which house has fallen.
 */

/** The phases the slider runs through, each with where it ends. */
export const PHASES: readonly (readonly [string, number])[] = [
  ['Emptying', 0.25],
  ['Neglect', 0.5],
  ['Collapse', 0.75],
  ['Overgrown ruins', 1],
];

/** The name of the phase the slider is in. */
export function phaseName(d: number): string {
  for (const [name, end] of PHASES) if (d <= end) return name;
  return PHASES[PHASES.length - 1][0];
}

/** Side of the neighbourhoods that empty together, in Web Mercator metres. */
const NEIGHBOURHOOD = 150;

/** How far the slider has gone from `start` to `end`, as 0 to 1. */
export function stretch(d: number, start: number, end: number): number {
  return d <= start ? 0 : d >= end ? 1 : (d - start) / (end - start);
}

/**
 * How long a thing at (x, y) holds out, in [0, 1): mostly its neighbourhood, so whole streets
 * empty together, and partly its own hash, so neighbours differ. `own` is the share of its own.
 */
export function resistance(B: Build, x: number, y: number, salt: number, own = 0.4): number {
  const [X, Y] = B.toAbs(x, y);
  const [k0, k1] = B.key(x, y);
  // The smooth patch keeps to the middle; stretch it back out towards 0 and 1.
  const area = Math.min(0.999, Math.max(0, (patch(X / NEIGHBOURHOOD, Y / NEIGHBOURHOOD, B.set.seed, salt) - 0.5) * 1.7 + 0.5));
  return area * (1 - own) + hash(k0, k1, B.set.seed, salt + 1) * own;
}

/**
 * Whether a thing at (x, y) has gone: it goes at its own point between `start` and `end` of the
 * slider, and once gone stays gone. Uses salts `salt` and `salt + 1`.
 */
export function gone(B: Build, x: number, y: number, start: number, end: number, salt: number, own = 0.4): boolean {
  const d = B.set.abandon;
  if (d <= start) return false;
  if (d >= end) return true;
  return stretch(d, start, end) > resistance(B, x, y, salt, own);
}

/** When each kind of life has left the town, as [start, end] of the slider. */
export const LEAVES = {
  /** Cars, buses and lorries on the move. */
  traffic: [0, 0.2],
  /** Cars parked at the kerb that are driven away; the rest are left as wrecks. */
  parked: [0, 0.25],
  /** Wrecks rusting away and lost under the growth. */
  wrecks: [0.6, 0.9],
  /** People in the streets, on beaches and pitches. */
  people: [0, 0.15],
  /** Herds and farm work. */
  farms: [0, 0.2],
  /** Trains, trams and lifts running. */
  trains: [0, 0.2],
  /** Aircraft on the move or parked. */
  aircraft: [0, 0.1],
  /** Ships, ferries and boats under way. */
  ships: [0, 0.2],
  /** Boats at their moorings: half are taken away. */
  moored: [0, 0.3],
  /** Beach things, tents and playground swings. */
  leisure: [0, 0.15],
  /** Paint on roads, pitches and runways, dash by dash. */
  paint: [0.05, 0.5],
  /** Footpaths worn by feet, dash by dash. */
  paths: [0.2, 0.6],
  /** Kerbs breaking up, a stretch at a time; see `KERBS_KEPT`. */
  kerbs: [0.3, 0.95],
  /** Cracks in the carriageway, and weeds in them. */
  cracks: [0.2, 0.8],
  /** Ploughed fields left fallow, as meadow. */
  fields: [0.2, 0.5],
  /** Fence rails falling, bay by bay, then the posts. */
  fences: [0.25, 0.9],
  /** Street lamps: heads off, posts leaning, then lying down, then gone. */
  lamps: [0.35, 1],
} as const satisfies Record<string, readonly [number, number]>;

/** Share of kerb stretches that still stand at the end, so the street pattern stays readable: main roads, other roads. */
export const KERBS_KEPT = { main: 0.5, other: 0.3 };

/** Share of parked cars left behind as wrecks rather than driven away. */
export const WRECKED = 0.3;
/** Share of moored boats left at their moorings. */
export const LEFT_MOORED = 0.5;

/** Whether a kind of life with resistance `r` in [0, 1) has left by now, for things keyed on their own cells. */
export function past(B: Build, kind: keyof typeof LEAVES, r: number): boolean {
  const [start, end] = LEAVES[kind];
  return B.set.abandon > start && stretch(B.set.abandon, start, end) > r;
}

/**
 * How far a thing at (x, y) has gone through a run of `steps` changes over its kind's span, as
 * 0 (none yet) to `steps` (all of them). Each thing makes the changes in order, at its own pace.
 */
export function stepsGone(B: Build, kind: keyof typeof LEAVES, x: number, y: number, steps: number, salt: number): number {
  const [start, end] = LEAVES[kind];
  const s = stretch(B.set.abandon, start, end);
  if (s <= 0) return 0;
  const r = resistance(B, x, y, salt, 0.6) * 0.6;
  let n = 0;
  while (n < steps && s > r + ((1 - 0.6) * (n + 1)) / steps - 1e-9) n++;
  return n;
}

/** Whether a kind of life at (x, y) has left by now. Salts are the caller's, as in `gone()`. */
export function left(B: Build, kind: keyof typeof LEAVES, x: number, y: number, salt: number, own = 0.4): boolean {
  const [start, end] = LEAVES[kind];
  return gone(B, x, y, start, end, salt, own);
}

/**
 * What has become of a car parked at (x, y): still there, left as a wreck, or gone. Each car
 * is either driven away or left behind, decided once by its own hash.
 */
export function parkedCar(B: Build, x: number, y: number): 'car' | 'wreck' | null {
  if (B.set.abandon <= 0 || !left(B, 'parked', x, y, 9802)) return 'car';
  const [k0, k1] = B.key(x, y);
  if (hash(k0, k1, B.set.seed, 9804) >= WRECKED || left(B, 'wrecks', x, y, 9805)) return null;
  return 'wreck';
}

/** Twist for a wreck at (x, y), in [0, 1). */
export function wreckTwist(B: Build, x: number, y: number): number {
  const [k0, k1] = B.key(x, y);
  return hash(k0, k1, B.set.seed, 9807);
}

/**
 * The pieces of a 2D polyline still there: it is cut into runs of `run` metres along its length,
 * counted from its own start, and each run goes on its own, as `left(B, kind, …)` decides at the
 * run's first point. With nothing gone it is the polyline itself. Only a share `most` of runs
 * ever go (salt + 2 picks them).
 */
export function kept(B: Build, pts: number[], kind: keyof typeof LEAVES, salt: number, run = 8, own = 0.7, most = 1): number[][] {
  if (B.set.abandon <= LEAVES[kind][0]) return [pts];
  const out: number[][] = [];
  let cur: number[] | null = null;
  let s = 0;
  let idx = -1;
  let keep = true;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const l = Math.hypot(pts[i + 2] - ax, pts[i + 3] - ay);
    if (l < 1e-9) continue;
    const ux = (pts[i + 2] - ax) / l;
    const uy = (pts[i + 3] - ay) / l;
    let t = 0;
    while (t < l) {
      const n = Math.floor((s + t) / run + 1e-9);
      const t1 = Math.min(l, (n + 1) * run - s);
      const x0 = ax + ux * t;
      const y0 = ay + uy * t;
      if (n !== idx) {
        idx = n;
        keep = !runGone(B, kind, x0, y0, salt, own, most);
        if (!keep) cur = null;
      }
      if (keep) {
        if (!cur) {
          cur = [x0, y0];
          out.push(cur);
        }
        cur.push(ax + ux * t1, ay + uy * t1);
      }
      t = Math.max(t1, t + 1e-6);
    }
    s += l;
  }
  return out;
}

/** Where each building stage starts, in its progress: closed, derelict, shell, broken shell, footprint ruin. */
export const STAGES = [0.12, 0.3, 0.5, 0.65, 0.85] as const;
/** The building stages that change how it is built, rather than its details. */
export const RUIN_STAGE = { shell: 3, broken: 4, footprint: 5 } as const;
/**
 * How far apart the first and the last building go. Progress is `d · (1 + SPREAD) − SPREAD · u`,
 * so a typical house (u about 0.5) closes up near 0.3, loses its roof near 0.5 and is a
 * footprint by 0.75, while the sturdiest hold out to the end.
 */
const SPREAD = 1.2;
/** How long each kind of building holds out, 0 to 1: sheds go first, churches last. */
const STURDY: Record<Kind, number> = { shed: 0.1, industrial: 0.35, house: 0.45, terrace: 0.5, apartment: 0.6, tall: 0.65, civic: 0.8, worship: 0.95 };

/**
 * What has become of one building. `p` is its progress, 0 (lived in) to 1 (footprint ruin),
 * `stage` the stage that falls in (see `STAGES`), and `key` its position key for its own
 * decisions. `holes` holds the holes in its roof as x, y, radius in local metres, and
 * `strokes` counts its roof hatching as it is drawn, to pick the rafters left in a hole.
 */
export type Fate = { p: number; stage: number; key: [number, number]; holes: number[]; strokes: number };

/** A building's fate, or undefined when the town is lived in. */
export function fateOf(B: Build, b: Building): Fate | undefined {
  const d = B.set.abandon;
  if (d <= 0) return undefined;
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
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const key = B.key(cx, cy);
  const seed = B.set.seed;
  // A terraced row mostly goes together: half of each house's own part is the row's.
  const row = b.info?.kind === 'terrace' ? b.info.seed : null;
  const own = row ? (hash(key[0], key[1], seed, 9861) + hash(row[0], row[1], seed, 9861)) / 2 : hash(key[0], key[1], seed, 9861);
  const area = resistance(B, cx, cy, 9862, 0);
  const u = area * 0.5 + own * 0.3 + (b.info ? STURDY[b.info.kind] : 0.45) * 0.2;
  const prog = Math.max(0, Math.min(1, d * (1 + SPREAD) - SPREAD * u));
  let stage = 0;
  while (stage < STAGES.length && prog >= STAGES[stage]) stage++;
  const fate: Fate = { p: prog, stage, key, holes: [], strokes: 0 };
  // Holes open in the roof of a derelict building, more of them and wider as it goes on.
  for (let i = 0; i < 3; i++) {
    const h = (k: number) => hash(key[0], key[1], seed, 9870 + i * 4 + k);
    const from = STAGES[1] + 0.05 * i + 0.08 * h(0);
    if (prog <= from) continue;
    const x = x0 + (x1 - x0) * (0.2 + 0.6 * h(1));
    const y = y0 + (y1 - y0) * (0.2 + 0.6 * h(2));
    if (!pointInRing(x, y, p)) continue;
    const most = Math.min(x1 - x0, y1 - y0) * (0.12 + 0.12 * h(3));
    fate.holes.push(x, y, most * Math.min(1, 0.4 + ((prog - from) / 0.15) * 0.6));
  }
  return fate;
}

/** The catalogue facet for a building's stage, or undefined while it is lived in. Broken shells and footprint ruins come with M4. */
export function wornAs(f: Fate): string | undefined {
  return f.stage === 0 ? undefined : f.stage === 1 ? 'closed-up' : f.stage === 2 ? 'derelict' : 'shell';
}

/** Whether the building being drawn has lost a thing by now, at its own point from `from` to `from + span` of its progress. */
export function lost(B: Build, salt: number, from: number = STAGES[1], span = 0.2): boolean {
  const f = B.fate;
  if (!f) return false;
  return f.p > from + span * hash(f.key[0], f.key[1], B.set.seed, salt);
}

/** Whether a run of a line starting at (x, y) has gone: see `kept()`. */
export function runGone(B: Build, kind: keyof typeof LEAVES, x: number, y: number, salt: number, own = 0.7, most = 1): boolean {
  if (most < 1) {
    const [k0, k1] = B.key(x, y);
    if (hash(k0, k1, B.set.seed, salt + 2) >= most) return false;
  }
  return left(B, kind, x, y, salt, own);
}
