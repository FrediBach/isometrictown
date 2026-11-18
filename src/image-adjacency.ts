/**
 * Neighbours as in real towns: how badly two zone labels sit side by side, learnt from which
 * labels border which in real places (`PAIRS`, measured by the adjacency lab, `npm run
 * adjacency`). Zoning blends this with its hand-made table by the Real-town neighbours setting.
 *
 * A pair that borders more often than chance in real towns gets a low cost, and one that
 * borders rarely a high cost. The learnt costs are scaled to the same mean and spread as the
 * hand-made ones, so the smoothing keeps its strength and only the pattern changes, and pairs
 * the real towns say little about stay close to the hand-made cost.
 */
import { LABELS, type Label } from './image-tone';

/** How the counts become costs. */
export type LearnOptions = {
  /** Boundary added to both what was seen and what chance predicts, so rare pairs aren't judged on a handful of cells. */
  prior: number;
  /** Expected boundary at which the learnt cost and the hand-made one count the same. */
  trust: number;
};

/** Chosen by cross-validation over the places in the adjacency lab (`npm run adjacency -- --eval`). */
export const LEARN: LearnOptions = { prior: 4, trust: 25 };
/** Labels whose costs stay hand-made: sand is only laid along water, after the solve. */
const KEEP = new Set<Label>(['sand']);
/**
 * Labels that keep the hand-made level of their costs and learn only which neighbours suit them
 * better or worse: water stays cheap beside anything, so zone edges can follow a shore in the
 * image, but works on the water cost less than blocks.
 */
const LEVEL = new Set<Label>(['water']);
/** The learnt costs stay within these. */
const LOWEST = 0.02;
const HIGHEST = 2;

/**
 * The boundary each pair would share by chance, given how much boundary each label has and that
 * no label borders itself (quasi-independence: `E[a][b] = r[a] r[b]`, fitted so rows sum as seen).
 */
export function expected(pairs: readonly (readonly number[])[]): number[][] {
  const K = pairs.length;
  const m = pairs.map((row) => row.reduce((s, v) => s + v, 0));
  const total = m.reduce((s, v) => s + v, 0);
  const r = m.map((v) => v / Math.sqrt(Math.max(1e-9, total)));
  // Damped, as the plain update swings between two answers rather than settling.
  for (let round = 0; round < 500; round++) {
    const sum = r.reduce((s, v) => s + v, 0);
    for (let a = 0; a < K; a++) r[a] = Math.sqrt(r[a] * (m[a] / Math.max(1e-9, sum - r[a])));
  }
  return r.map((ra, a) => r.map((rb, b) => (a === b ? 0 : ra * rb)));
}

/**
 * Costs between every pair of labels, as `LABELS` orders them, learnt from boundary counts and
 * put on the scale of `hand`.
 */
export function learnCompat(pairs: readonly (readonly number[])[], hand: (a: Label, b: Label) => number, o: LearnOptions = LEARN): number[][] {
  const K = LABELS.length;
  const E = expected(pairs);
  const pmi = (a: number, b: number) => Math.log((pairs[a][b] + o.prior) / (E[a][b] + o.prior));
  const kept = (a: number, b: number) => KEEP.has(LABELS[a]) || KEEP.has(LABELS[b]);
  const levelled = (a: number, b: number) => LEVEL.has(LABELS[a]) || LEVEL.has(LABELS[b]);
  /** The E-weighted mean of `f` over the pairs `which` picks. */
  const mean = (f: (a: number, b: number) => number, which: (a: number, b: number) => boolean) => {
    let w = 0;
    let s = 0;
    for (let a = 0; a < K; a++)
      for (let b = a + 1; b < K; b++) {
        if (!which(a, b)) continue;
        w += E[a][b];
        s += E[a][b] * f(a, b);
      }
    return s / Math.max(1e-9, w);
  };
  const h = (a: number, b: number) => hand(LABELS[a], LABELS[b]);
  // Match the weighted mean and spread of the hand-made costs between kinds of land, weighting each pair by how often zoning meets it.
  const land = (a: number, b: number) => !kept(a, b) && !levelled(a, b);
  const mp = mean(pmi, land);
  const mh = mean(h, land);
  const slope = Math.sqrt(mean((a, b) => (h(a, b) - mh) ** 2, land) / Math.max(1e-9, mean((a, b) => (pmi(a, b) - mp) ** 2, land)));
  const learnt = (a: number, b: number) => Math.max(LOWEST, Math.min(HIGHEST, mh - slope * (pmi(a, b) - mp)));
  // Water and the like: the learnt pattern, scaled to the hand-made level.
  const levels = LABELS.map((_, a) => {
    if (!LEVEL.has(LABELS[a])) return 1;
    const row = (x: number, y: number) => (x === a || y === a) && !kept(x, y);
    return mean(h, row) / Math.max(1e-9, mean(learnt, row));
  });
  return LABELS.map((_, a) =>
    LABELS.map((_, b) => {
      if (a === b) return 0;
      if (kept(a, b)) return h(a, b);
      const t = E[a][b] / (E[a][b] + o.trust);
      return t * learnt(a, b) * levels[a] * levels[b] + (1 - t) * h(a, b);
    }),
  );
}
