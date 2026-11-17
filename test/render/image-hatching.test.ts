import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { drawImage } from '../support/draw';
import { PICTURES } from '../support/pictures';

test('hatching restores local contrast on the high-rise disc with the same buildings and streets', () => {
  const pic = PICTURES.disc();
  const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id, imageName: pic.name, scale: 2500, tilt: 40, power: false, imageRelief: 1, sheet: 'a3' };
  const plain = drawImage(set, pic);
  const hatched = drawImage({ ...set, imageHatching: 1 }, pic);
  expect(hatched.counts).toEqual(plain.counts);
  expect(hatched.scene.town.buildings.map((b) => b.h)).toEqual(plain.scene.town.buildings.map((b) => b.h));
  expect(plain.tally.get('streets:kerbs')?.length).toBeGreaterThan(0);
  expect(hatched.tally.get('streets:kerbs')).toEqual(plain.tally.get('streets:kerbs'));
  expect(hatched.likeness.score).toBeGreaterThan(plain.likeness.score + 0.05);
});
