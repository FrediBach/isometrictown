import { clampChroma, converter, differenceEuclidean, formatHex, modeOklab, modeOklch, modeRgb, useMode as registerMode, type Oklch } from 'culori/fn';
import { LINEWORK, ROOFS, SHADOWS, type Settings } from './settings';

registerMode(modeRgb);
registerMode(modeOklab);
registerMode(modeOklch);

const toOklch = converter('oklch');
const distance = differenceEuclidean('oklab');

type Pens = Settings['pens'];
export type Locks = readonly boolean[];

/** Hue wheels, as offsets in degrees from a base hue. */
const SCHEMES = [
  { name: 'Analogous', offsets: [0, 32, -32] },
  { name: 'Complementary', offsets: [0, 180] },
  { name: 'Split complementary', offsets: [0, 150, 210] },
  { name: 'Triadic', offsets: [0, 120, 240] },
  { name: 'Square', offsets: [0, 90, 180, 270] },
  { name: 'Rectangle', offsets: [0, 60, 180, 240] },
] as const;

type Range = readonly [number, number];
type Role = {
  l: Range;
  c: Range;
  /** Hue arcs this pen reads naturally in on a map: [from, to] in degrees. */
  hues: readonly Range[];
};

/**
 * Where each pen sits in OKLCH, measured from the hand-tuned palettes in palettes.ts
 * and widened a little. The roofs carry the most colour; the linework is a dark,
 * barely tinted ink. Shadows are dark, just above the linework, so hatching reads
 * as shade, not as a thing; water and greenery sit in the middle.
 * In pen order: shadows, water, greenery, roofs, linework.
 */
const ROLES: readonly Role[] = [
  { l: [0.34, 0.48], c: [0.01, 0.12], hues: [[220, 330]] },
  { l: [0.42, 0.7], c: [0.05, 0.15], hues: [[175, 265]] },
  { l: [0.45, 0.72], c: [0.04, 0.15], hues: [[75, 170]] },
  { l: [0.42, 0.7], c: [0.11, 0.21], hues: [[340, 360], [0, 85]] },
  { l: [0.16, 0.31], c: [0.005, 0.06], hues: [] },
];

/** Any two pens in a set should be at least this far apart in OKLab, like the curated sets. */
const MIN_DISTANCE = 0.19;
/** Below this chroma a colour reads as grey, so its hue carries no weight. */
const NEUTRAL = 0.035;
const CANDIDATES = 1500;

const lerp = ([a, b]: Range, t: number) => a + (b - a) * t;
const wrap = (h: number) => ((h % 360) + 360) % 360;
const hueGap = (a: number, b: number) => {
  const d = Math.abs(wrap(a) - wrap(b));
  return Math.min(d, 360 - d);
};
const inArcs = (h: number, arcs: readonly Range[]) => arcs.some(([a, b]) => h >= a && h <= b);
const pick = <T>(xs: readonly T[], r = Math.random): T => xs[Math.floor(r() * xs.length)];

function shuffle<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

function inGamut(c: Oklch): Oklch {
  return clampChroma(c, 'oklch');
}

type Candidate = { pens: Oklch[]; scheme: string; score: number };

function candidate(fixed: (Oklch | null)[]): Candidate {
  const scheme = pick(SCHEMES);
  const anchors = fixed.filter((c): c is Oklch => !!c && c.c >= NEUTRAL).map((c) => c.h ?? 0);

  // Turn the wheel so a locked colour sits on one of its spokes; with nothing locked, anywhere.
  const base = anchors.length ? anchors[0] - pick(scheme.offsets) : Math.random() * 360;
  const spokes = scheme.offsets.map((o) => wrap(base + o + (Math.random() - 0.5) * 14));
  // How far the other locked colours fall from the nearest spoke.
  const harmonyError = anchors.slice(1).reduce((sum, h) => sum + Math.min(...spokes.map((s) => hueGap(h, s))), 0);

  // One mood for the whole set: quiet and dusty, or saturated and bright.
  const mood = 0.5 + Math.random() * 0.6;
  const brightness = Math.random();
  const free = shuffle([...spokes]);

  const pens = fixed.map((locked, i) => {
    if (locked) return locked;
    const role = ROLES[i];
    if (i === LINEWORK) {
      // A dark ink, tinted toward one of the spokes so it belongs to the set.
      return inGamut({ mode: 'oklch', l: lerp(role.l, Math.random()), c: lerp(role.c, Math.random() * mood), h: pick(spokes) });
    }
    // Spread the colour pens over the spokes before doubling up on any.
    const h = free.length ? free.pop()! : pick(spokes);
    const l = lerp(role.l, Math.min(1, Math.max(0, brightness + (Math.random() - 0.5) * 0.7)));
    let c = lerp(role.c, Math.random()) * (i === ROOFS ? Math.max(mood, 0.85) : mood);
    // Now and then a quiet grey pen, as in Newsprint, lets the others sing.
    if (i !== ROOFS && Math.random() < 0.12) c *= 0.15;
    return inGamut({ mode: 'oklch', l, c, h });
  });

  return { pens, scheme: scheme.name, score: score(pens, harmonyError) };
}

function score(pens: Oklch[], harmonyError: number): number {
  let s = -harmonyError / 25;

  let closest = Infinity;
  for (let i = 0; i < pens.length; i++) for (let j = i + 1; j < pens.length; j++) closest = Math.min(closest, distance(pens[i], pens[j]));
  s += closest < MIN_DISTANCE ? -20 * (MIN_DISTANCE - closest) - 1 : Math.min(closest - MIN_DISTANCE, 0.1) * 4;

  // The linework must stay the darkest pen, clearly.
  const ink = pens[LINEWORK].l;
  for (let i = 0; i < LINEWORK; i++) if (pens[i].l < ink + 0.12) s -= 3;

  // Small nudges toward map sense: warm roofs, green parks, cool shadows. Small, so surprises survive.
  pens.forEach((p, i) => {
    if (p.c >= NEUTRAL ? inArcs(wrap(p.h ?? 0), ROLES[i].hues) : i === SHADOWS) s += 0.35;
  });

  // The colour pens should not all share one lightness.
  const ls = pens.slice(0, LINEWORK).map((p) => p.l);
  s += Math.min(Math.max(...ls) - Math.min(...ls), 0.25) * 2;

  // Taste is a little random; keep it that way so each press feels fresh.
  return s + Math.random() * 0.5;
}

/**
 * A new set of pens that harmonise with each other and with any locked pens.
 * Many candidate sets are built on colour-wheel schemes turned to fit the locked
 * colours, then scored on separation, legibility and fit; the best one wins.
 */
export function harmonise(current: Pens, locks: Locks): { pens: Pens; scheme: string } {
  const fixed = current.map((hex, i) => (locks[i] ? (toOklch(hex) ?? null) : null));
  let best = candidate(fixed);
  for (let n = 1; n < CANDIDATES; n++) {
    const next = candidate(fixed);
    if (next.score > best.score) best = next;
  }
  const pens = best.pens.map((c, i) => (locks[i] ? current[i] : formatHex(c))) as unknown as Pens;
  return { pens, scheme: best.scheme };
}

/** The pens as a line ready to paste into PALETTES in palettes.ts. */
export function paletteSource(pens: Pens, name = 'Untitled'): string {
  return `{ name: '${name}', pens: [${pens.map((c) => `'${c.toLowerCase()}'`).join(', ')}] },`;
}
