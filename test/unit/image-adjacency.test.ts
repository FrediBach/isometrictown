import { describe, expect, test } from 'vitest';
import { expected, learnCompat } from '@/image-adjacency';
import { PAIRS } from '@/image-adjacency-data';
import { LABELS, type Label } from '@/image-tone';
import { compat, compatTable } from '@/image-zones';

const K = LABELS.length;
const at = (t: number[][], a: Label, b: Label) => t[LABELS.indexOf(a)][LABELS.indexOf(b)];

describe('neighbours as in real towns', () => {
  test('the measured borders are a symmetric table over the labels', () => {
    expect(PAIRS).toHaveLength(K);
    for (let a = 0; a < K; a++) {
      expect(PAIRS[a]).toHaveLength(K);
      expect(PAIRS[a][a]).toBe(0);
      for (let b = 0; b < K; b++) {
        expect(PAIRS[a][b]).toBeGreaterThanOrEqual(0);
        expect(PAIRS[a][b]).toBe(PAIRS[b][a]);
      }
    }
  });

  test('chance borders add up to what was measured', () => {
    const E = expected(PAIRS);
    for (let a = 0; a < K; a++) {
      const seen = PAIRS[a].reduce((s, v) => s + v, 0);
      const chance = E[a].reduce((s, v) => s + v, 0);
      expect(chance).toBeCloseTo(seen, 0);
      expect(E[a][a]).toBe(0);
    }
  });

  test('learnt costs are symmetric, free between like labels and in range, and sand keeps its own', () => {
    const t = learnCompat(PAIRS, compat);
    for (let a = 0; a < K; a++)
      for (let b = 0; b < K; b++) {
        expect(t[a][b]).toBeCloseTo(t[b][a], 9);
        if (a === b) expect(t[a][b]).toBe(0);
        else expect(t[a][b] >= 0 && t[a][b] <= 2).toBe(true);
      }
    for (const l of LABELS) expect(at(t, 'sand', l)).toBe(compat('sand', l));
  });

  test('water stays cheap beside anything, but works on the water cost least', () => {
    const t = learnCompat(PAIRS, compat);
    for (const l of LABELS) if (l !== 'water') expect(at(t, 'water', l)).toBeLessThan(0.25);
    expect(at(t, 'water', 'works')).toBeLessThan(at(t, 'water', 'blocks'));
  });

  test('the table says what real towns show', () => {
    const t = learnCompat(PAIRS, compat);
    // Squares lie among towers, not in meadows; suburbs, not old towns, meet the fields.
    expect(at(t, 'towers', 'plaza')).toBeLessThan(at(t, 'towers', 'meadow'));
    expect(at(t, 'suburb', 'field')).toBeLessThan(at(t, 'old', 'field'));
    // Woods border meadows and fields, not squares; parks lie in town, not among fields.
    expect(at(t, 'wood', 'meadow')).toBeLessThan(at(t, 'wood', 'plaza'));
    expect(at(t, 'park', 'suburb')).toBeLessThan(at(t, 'park', 'field'));
    expect(at(t, 'towers', 'blocks')).toBeLessThan(at(t, 'towers', 'suburb'));
  });

  test('counts that say nothing give an even table, not a broken one', () => {
    const even = LABELS.map((_, a) => LABELS.map((_, b) => (a === b ? 0 : 10)));
    const t = learnCompat(even, compat);
    for (const row of t) for (const v of row) expect(Number.isFinite(v)).toBe(true);
  });

  test('at 0 zoning uses the hand-made table exactly, and at 1 the learnt one', () => {
    const hand = compatTable(0);
    const learnt = learnCompat(PAIRS, compat);
    const full = compatTable(1);
    for (let a = 0; a < K; a++)
      for (let b = 0; b < K; b++) {
        expect(hand[a * K + b]).toBe(Math.fround(compat(LABELS[a], LABELS[b])));
        expect(full[a * K + b]).toBeCloseTo(learnt[a][b], 5);
      }
  });
});
