import { expect, test } from 'vitest';
import type { Build } from '@/buildings';
import { Camera } from '@/camera';
import { wildGrowth } from '@/growth';
import type { Masks, Tree } from '@/nature';
import { Paper } from '@/raster';
import { DEFAULT_SETTINGS } from '@/settings';
import { STYLES } from '@/styles';

function grow(abandon: number, trees = 0.7): Tree[] {
  const set = { ...DEFAULT_SETTINGS, scale: 1000, abandon, trees };
  const cam = new Camera(set);
  const paper = new Paper(cam);
  const B: Build = { set, cam, style: STYLES.alpine, seed: 1, sun: [1, 0], equator: [0, -1], left: false,
    key: (x, y) => [Math.round(x), Math.round(y)], toAbs: (x, y) => [x, y], cell: (x, y, size) => [Math.round(x / size), Math.round(y / size)] };
  const M = Object.fromEntries(['road', 'water', 'green', 'wood', 'foot', 'shadow', 'pool', 'under', 'calm', 'title'].map((k) => [k, paper.mask()])) as Masks;
  return wildGrowth(B, paper, null, M, paper.mask(), cam.region(0), (x, y) => [x, y], (X, Y) => [X, Y]);
}

test('nothing grows while the town is lived in, or with Trees off', () => {
  expect(grow(0)).toEqual([]);
  expect(grow(1, 0)).toEqual([]);
});

test('growth only comes in and gets bigger as the slider rises', () => {
  let last: Tree[] = [];
  for (const d of [0.4, 0.55, 0.7, 0.85, 1]) {
    const now = grow(d);
    const at = new Map(now.map((t) => [`${t.x},${t.y}`, t]));
    for (const t of last) {
      const n = at.get(`${t.x},${t.y}`);
      expect(n).toBeDefined();
      expect(n!.r).toBeGreaterThanOrEqual(t.r - 1e-9);
    }
    expect(now.length).toBeGreaterThanOrEqual(last.length);
    last = now;
  }
  expect(last.length).toBeGreaterThan(0);
});
