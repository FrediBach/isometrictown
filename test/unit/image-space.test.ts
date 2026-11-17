import { expect, test } from 'vitest';
import { ImageSpace } from '@/image-space';
import { pickAt } from '@/render';

test('a long plotter stroke splits across a transparent hole with clearance for both pen caps', () => {
  const grid = { W: 5, H: 1, cell: 1, x0: 10, y0: 5, weight: Float32Array.of(1, 1, 0, 1, 1), tone: Float32Array.of(0, 1, 0, 1, 0) };
  const space = new ImageSpace(grid, 1, 0.4);
  const line = [10, 5.5, 15, 5.5];
  const pens = [[line]];
  const tally = new Map([['walls', [line]]]);
  space.trim(pens, tally);
  const [left, right] = pens[0];
  expect(pens[0]).toHaveLength(2);
  expect(left.at(-2)).toBeLessThanOrEqual(11.8);
  expect(left.at(-2)).toBeGreaterThan(11.65);
  expect(right[0]).toBeGreaterThanOrEqual(13.2);
  expect(right[0]).toBeLessThan(13.35);
  expect(tally.get('walls')![0]).toBe(left);
  expect(tally.get('walls')![1]).toBe(right);

  const picks = { ...grid, ppm: 1, ids: new Int32Array(5), keys: ['roof'], space };
  expect(pickAt(picks, 12.5, 5.5)).toBeNull();
  expect(pickAt(picks, 11.5, 5.5)).toBe('roof');
});

test('the highlight cutoff is independent of alpha and preserves fully visible paths', () => {
  const grid = { W: 3, H: 1, cell: 4, x0: 0, y0: 0, weight: Float32Array.of(1, 1, 0.3), tone: Float32Array.of(0.9, 0.6, 0.2) };
  const pens = [[[0.5, 2, 3.5, 2], [4.5, 2, 7.5, 2], [8.5, 2, 11.5, 2]]];
  const original = [...pens[0]];
  new ImageSpace(grid, 1, 0.35).trim(pens, null);
  expect(pens[0]).toEqual(original);
  new ImageSpace(grid, 0.75, 0.35).trim(pens, null);
  expect(pens[0]).toEqual(original.slice(1));
  expect(pens[0][0]).toBe(original[1]);
});
