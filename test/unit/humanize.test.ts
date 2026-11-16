import { expect, test } from 'vitest';
import { humanize } from '@/humanize';

const bounds = [0, 0, 100, 100];
const stroke = [10, 20, 40, 20, 40, 50];
const draw = (amount: number, seed = 7, source = stroke) => {
  const line = source.slice();
  humanize(line, amount, [123, 456, 789, 123], seed, bounds);
  return line;
};

test('zero is an exact no-op; the same seed repeats and a different seed varies', () => {
  expect(draw(0)).toEqual(stroke);
  expect(draw(1)).toEqual(draw(1));
  expect(draw(1)).not.toEqual(draw(1, 8));
  expect(stroke).toEqual([10, 20, 40, 20, 40, 50]);
});

test('strokes wobble and can start and finish both early and late', () => {
  const starts: number[] = [], ends: number[] = [];
  for (let seed = 1; seed <= 30; seed++) {
    const line = draw(1, seed, [10, 20, 70, 20]);
    starts.push(line[0] - 10);
    ends.push(line.at(-2)! - 70);
    expect(new Set(line.filter((_, i) => i % 2)).size).toBeGreaterThan(10);
  }
  for (const values of [starts, ends]) {
    expect(Math.min(...values)).toBeLessThan(0);
    expect(Math.max(...values)).toBeGreaterThan(0);
  }
});

test('short, repeated, closed and edge strokes stay finite and inside the bounds', () => {
  for (const source of [[10, 10, 10, 10], [20, 20, 20.001, 20], [0, 0, 100, 0, 100, 100, 0, 0], [20, 20, 20, 20, 40, 40]]) {
    const line = draw(1, 1, source);
    expect(line.length % 2).toBe(0);
    expect(line.every((v) => Number.isFinite(v) && v >= 0 && v <= 100)).toBe(true);
  }
});

test('moving a stroke with the same map key moves its imperfections with it', () => {
  const shifted = stroke.map((v) => v + 5);
  const a = draw(1), b = draw(1, 7, shifted);
  expect(b.length).toBe(a.length);
  b.forEach((v, i) => expect(v).toBeCloseTo(a[i] + 5, 10));
});
