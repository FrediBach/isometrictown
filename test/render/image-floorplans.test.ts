import { expect, test } from 'vitest';
import { imageScene, plausibility, type Scene } from '@/image';
import { DEFAULT_SETTINGS } from '@/settings';
import { PICTURES } from '../support/pictures';

/** Depth of visible four-corner buildings in sheet millimetres, keyed by their street fronts. */
function depths({ cam, town }: Scene) {
  const result = new Map<string, number>();
  const [left, top, right, bottom] = cam.rect;
  for (const b of town.buildings) {
    const p = b.shape[0].pts;
    if (p.length !== 8) continue;
    const x = cam.sx(p[0], p[1]), y = cam.sy(p[0], p[1], 0);
    if (x < left || x > right || y < top || y > bottom) continue;
    const rearX = cam.sx(p[6], p[7]), rearY = cam.sy(p[6], p[7], 0);
    result.set(p.slice(0, 4).join(','), Math.hypot(rearX - x, rearY - y));
  }
  return result;
}

test('the floorplan slider visibly reshapes rows along stripes while keeping their street fronts', () => {
  const pic = PICTURES.stripes();
  const set = { ...DEFAULT_SETTINGS, source: 'image', image: pic.id, sheet: 'a4', scale: 2500, tilt: 40 } as const;
  const plain = imageScene(pic, set);
  const off = depths(plain);
  const moved = (s: Scene) => [...depths(s)].filter(([front, d]) => Math.abs(d - (off.get(front) ?? d)) > 0.8).length;
  const half = moved(imageScene(pic, { ...set, imageFloorplans: 0.5 }));
  const full = imageScene(pic, { ...set, imageFloorplans: 1 });
  expect(half).toBeGreaterThan(0);
  expect(moved(full)).toBeGreaterThan(Math.max(half, off.size * 0.15));
  expect(full.town.ways).toEqual(plain.town.ways);
  expect(plausibility(full.town)).toEqual([]);
  expect(depths(imageScene(pic, set))).toEqual(off);
});
