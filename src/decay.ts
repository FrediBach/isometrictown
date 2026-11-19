import type { Build } from './buildings';
import { hash, patch } from './rng';

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
} as const satisfies Record<string, readonly [number, number]>;

/** Share of parked cars left behind as wrecks rather than driven away. */
export const WRECKED = 0.3;
/** Share of moored boats left at their moorings. */
export const LEFT_MOORED = 0.5;

/** Whether a kind of life with resistance `r` in [0, 1) has left by now, for things keyed on their own cells. */
export function past(B: Build, kind: keyof typeof LEAVES, r: number): boolean {
  const [start, end] = LEAVES[kind];
  return B.set.abandon > start && stretch(B.set.abandon, start, end) > r;
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
 * run's first point. With nothing gone it is the polyline itself.
 */
export function kept(B: Build, pts: number[], kind: keyof typeof LEAVES, salt: number, run = 8, own = 0.7): number[][] {
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
        keep = !left(B, kind, x0, y0, salt, own);
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
