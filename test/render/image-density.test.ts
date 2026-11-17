import { expect, test } from 'vitest';
import { ringArea } from '@/geo';
import { imageScene, plausibility, type Scene } from '@/image';
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
