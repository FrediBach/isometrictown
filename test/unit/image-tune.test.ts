import { expect, test } from 'vitest';
import { Camera } from '@/camera';
import { Frame } from '@/geo';
import { drawnAs, imageBuild, imageLayout, plausibility } from '@/image';
import { readImage } from '@/image-read';
import { LABELS } from '@/image-tone';
import { DEFAULT_SETTINGS } from '@/settings';
import { STYLES } from '@/styles';
import { paint } from '../support/pictures';

test('tuning changes the buildings along a street even when the plan has no block lots', () => {
  const set = drawnAs({ ...structuredClone(DEFAULT_SETTINGS), source: 'image', scale: 2500, tilt: 40, likeness: 1, imageColour: 0 });
  const cam = new Camera(set);
  const box: [number, number, number, number] = [-100, -100, 100, 100];
  const target = readImage(paint('Dark', () => [20, 20, 20], 8, 8), set, [cam.cx - 60, cam.cy - 60, cam.cx + 60, cam.cy + 60]);
  const cells = 50 * 50;
  const zones = {
    x0: -125, y0: -125, cell: 5, W: 50, H: 50,
    label: new Uint8Array(cells).fill(LABELS.indexOf('old')), level: new Float32Array(cells),
    warmth: new Float32Array(cells), sp: new Int32Array(cells),
  };
  const layout = imageLayout(zones, target, set, cam, new Frame(set.center), box, STYLES.central);
  layout.blocks = [];
  const plain = imageBuild(layout, target, set, cam);
  const tuned = imageBuild(layout, target, set, cam, undefined, true);

  expect(plain.town.buildings.length).toBeGreaterThan(10);
  expect(tuned.prediction!.lots).toHaveLength(plain.town.buildings.length);
  expect(tuned.prediction!.lots.some((l) => l.level > 0)).toBe(true);
  expect(tuned.town.buildings).not.toEqual(plain.town.buildings);
  expect(tuned.town.ways).toEqual(plain.town.ways);
  expect(tuned.town.green).not.toBe(layout.town.green);
  expect(plausibility(tuned.town)).toEqual([]);
  expect(imageBuild(layout, target, set, cam).town).toEqual(plain.town);
});
