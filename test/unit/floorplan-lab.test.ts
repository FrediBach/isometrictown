/** The floorplan lab's straightening and grid keys, which decide what counts as one learnt plan. */
import { expect, test } from 'vitest';
import { ringArea } from '@/geo';
import { canonical, GRID, straighten } from '../../lab/plan-shapes';

test('a footprint drawn a little off square comes out square, its short jogs folded away', () => {
  // An L, 12 × 10 m, its walls a few degrees off and a 0.4 m step along the front.
  const p = straighten([0, 0, 5, 0.2, 5, -0.2, 12, 0.1, 12.2, 6, 6, 6.1, 6, 10, -0.1, 10.2]);
  expect(p).not.toBeNull();
  expect(p!).toHaveLength(12);
  for (let k = 0; k < p!.length; k += 2) {
    const j = (k + 2) % p!.length;
    expect(p![k] === p![j] || p![k + 1] === p![j + 1]).toBe(true);
  }
  expect(ringArea(p!)).toBeCloseTo(12 * 6 + 6 * 4, -1);
  // A footprint leaning well off its axes is left out.
  expect(straighten([0, 0, 10, 0, 14, 8, 4, 8])).toBeNull();
});

test('a plan and its mirror image share one key', () => {
  const l = [0, 0, 1, 0, 1, 0.5, 0.5, 0.5, 0.5, 1, 0, 1];
  const mirror = [0, 0, 1, 0, 1, 1, 0.5, 1, 0.5, 0.5, 0, 0.5];
  const a = canonical(l)!;
  const b = canonical(mirror)!;
  expect(a.key).toBe(b.key);
  expect(Math.max(...a.ring)).toBe(GRID);
  // Corners on one line are dropped, so a box drawn with extra points is still a box.
  expect(canonical([0, 0, 0.5, 0, 1, 0, 1, 1, 0, 1])!.ring).toHaveLength(8);
});
