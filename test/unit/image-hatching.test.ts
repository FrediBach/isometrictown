import { expect, test } from 'vitest';
import { Camera } from '@/camera';
import { ImageHatching } from '@/image-hatching';
import { Paper } from '@/raster';
import { DEFAULT_SETTINGS, GREENERY } from '@/settings';

test('ground hatching gains real strokes in dark bands and leaves highlights open along the same line', () => {
  const cam = new Camera({ ...DEFAULT_SETTINGS, sheet: 'a4' });
  const [x0, y0, x1, y1] = cam.rect;
  const cell = 1, W = Math.ceil(x1 - x0), H = Math.ceil(y1 - y0);
  const band = (i: number) => Math.min(3, Math.floor((i % W) * 4 / W));
  const tone = Float32Array.from({ length: W * H }, (_, i) => [0, 0.5, 1, 0][band(i)]);
  const weight = Float32Array.from(tone, (_, i) => band(i) === 3 ? 0 : 1);
  const grid = { x0, y0, cell, W, H, tone, weight };
  const hatching = new ImageHatching(grid, 1, cam.nib);
  const paper = new Paper(cam, 1e5);
  paper.hatchGround(GREENERY, 0, 1, () => true, hatching);
  const linesAt = (x: number) => paper.pens[GREENERY].filter((p) => p[0] <= x && p[p.length - 2] >= x).map((p) => p[1]);
  const [dark, mid, light, clear] = [1, 3, 5, 7].map((n) => linesAt(x0 + W * n / 8));
  expect(dark.length).toBeGreaterThan(mid.length * 1.8);
  expect(light.length).toBeLessThan(mid.length / 4);
  expect(clear).toEqual(mid);
  expect(dark.slice(1).every((y, i) => y - dark[i] >= hatching.minGap)).toBe(true);
  expect(hatching.gap(0.7, x0 + 1, y0 + 1)).toBe(hatching.minGap);
  expect(hatching.gap(0.7, x0 + W * 7 / 8, y0 + 1)).toBe(0.7);
  const half = new ImageHatching(grid, 0.5, cam.nib);
  expect(half.at(x0 + W / 8, y0 + 1)).toBe(1.5);
  expect(half.at(x0 + W * 5 / 8, y0 + 1)).toBe(0.5625);
});
