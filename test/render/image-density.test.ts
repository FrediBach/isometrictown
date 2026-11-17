import { expect, test } from 'vitest';
import { pointInRing, ringArea } from '@/geo';
import { imageScene, plausibility, type Scene } from '@/image';
import { centre, Footprints, Ground } from '@/image-check';
import { densityOf } from '@/image-density';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { PICTURES } from '../support/pictures';

const settings: Settings = { ...DEFAULT_SETTINGS, source: 'image', sheet: 'a4', scale: 2500, tilt: 40 };

/** Ground area occupied by buildings in the darkest and lightest quarters of the tone range. */
function coverage(scene: Scene): [number, number] {
  const density = densityOf(scene.target, scene.cam);
  let dark = 0, light = 0;
  scene.town.buildings.forEach((b, i) => {
    const tag = scene.town.tagged[i];
    const d = density(tag.x, tag.y);
    const area = ringArea(b.shape[0].pts);
    if (d > 0.5) dark += area;
    if (d < -0.5) light += area;
  });
  return [dark, light];
}

test('density deepens dark plots and opens light ones while retaining streets, civic sites and the ordinary drawing', () => {
  const pic = PICTURES.gradient();
  const at = (imageDensity: number) => imageScene(pic, { ...settings, image: pic.id, imageDensity });
  const plain = at(0), middle = at(0.5), full = at(1);
  const [d0, l0] = coverage(plain), [dm, lm] = coverage(middle), [d1, l1] = coverage(full);
  expect(dm).toBeGreaterThan(d0 * 1.05);
  expect(d1).toBeGreaterThan(dm * 1.05);
  expect(lm).toBeLessThan(l0 * 0.95);
  expect(l1).toBeLessThan(lm * 0.95);
  expect(full.town.ways).toEqual(plain.town.ways);
  const civic = (scene: Scene) => scene.town.tagged.filter((t) => ['school', 'church', 'civic'].includes(t.building ?? ''));
  expect(civic(full)).toEqual(civic(plain));
  expect(plausibility(full.town)).toEqual([]);
  expect(at(0).town).toEqual(plain.town);
});

test('negative density progressively opens plots in both dark and light areas', () => {
  const pic = PICTURES.gradient();
  const at = (imageDensity: number) => imageScene(pic, { ...settings, image: pic.id, imageDensity });
  const plain = at(0), half = at(-0.5), sparse = at(-1);
  const [d0, l0] = coverage(plain), [dh, lh] = coverage(half), [ds, ls] = coverage(sparse);
  expect(ds).toBeLessThan(dh);
  expect(dh).toBeLessThan(d0);
  expect(ls).toBeLessThan(lh);
  expect(lh).toBeLessThan(l0);
  expect(sparse.town.buildings.length).toBeLessThan(half.town.buildings.length);
  expect(half.town.buildings.length).toBeLessThan(plain.town.buildings.length);
  expect(sparse.town.ways).toEqual(plain.town.ways);
  expect(plausibility(sparse.town)).toEqual([]);
});

test('street-front rows fill more ground in a dark disc while keeping their sites', () => {
  const pic = PICTURES.disc();
  const at = (imageDensity: number) => imageScene(pic, { ...settings, image: pic.id, imageDensity });
  const plain = at(0), dense = at(1);
  const houses = (scene: Scene) => {
    const density = densityOf(scene.target, scene.cam);
    return scene.town.tagged.filter((tag) => density(tag.x, tag.y) > 0.9).length;
  };
  expect(houses(plain)).toBeGreaterThan(100);
  expect(houses(dense)).toBeGreaterThan(houses(plain) * 0.98);
  expect(coverage(dense)[0]).toBeGreaterThan(coverage(plain)[0] * 1.15);
  const tall = imageScene(pic, { ...settings, image: pic.id, imageDensity: 1, imageRelief: 1 });
  expect(tall.town.buildings.some((b) => b.h > 65)).toBe(true);
  expect(plausibility(tall.town)).toEqual([]);
});

test('garden pools keep clear of the finished houses and paths as density changes', () => {
  const pic = PICTURES.gradient();
  for (const imageDensity of [0, 1, -1, 0]) {
    const { town } = imageScene(pic, { ...settings, image: pic.id, sheet: 'a3', imageDensity });
    const occupied = new Footprints();
    const ground = new Ground(town);
    for (const b of town.buildings) occupied.add(b.shape[0].pts);
    if (!imageDensity) expect(town.pools.length).toBeGreaterThan(0);
    for (const pool of town.pools) {
      const p = pool[0].pts;
      expect(ringArea(p)).toBeCloseTo(28);
      expect(occupied.touches(p)).toBe(false);
      expect(ground.clear(p)).toBe(true);
      expect(ground.front(...centre(p))).toBeGreaterThan(5);
      occupied.add(p);
    }
  }
});

test('a courtyard keep retains its site as neighbouring plots thin or expand', () => {
  const pic = PICTURES.gradient();
  const keep = (imageDensity: number) => {
    const { town } = imageScene(pic, { ...settings, image: pic.id, sheet: 'a3', imageDensity });
    const sites = town.pois.filter(p => p.cls === 'castle');
    expect(sites).toHaveLength(1);
    const { x, y } = sites[0];
    const buildings = town.buildings.filter(b => pointInRing(x, y, b.shape[0].pts));
    expect(buildings).toHaveLength(1);
    expect(ringArea(buildings[0].shape[0].pts)).toBeGreaterThan(150);
    return buildings[0].shape;
  };
  const plain = keep(0);
  expect(keep(1)).toEqual(plain);
  expect(keep(-1)).toEqual(plain);
});
