import { expect, test } from 'vitest';
import { Camera } from '@/camera';
import { ringArea } from '@/geo';
import { FloorplanGuides } from '@/image-floorplans';
import { readImage } from '@/image-read';
import { DEFAULT_SETTINGS } from '@/settings';
import { paint } from '../support/pictures';

test('a sustained contrast boundary turns a house as a whole, within the room its plot allows', () => {
  const cam = new Camera({ ...DEFAULT_SETTINGS, scale: 1000, bearing: 20, tilt: 40 });
  const x = cam.sx(0, 0), y = cam.sy(0, 0, 0);
  const rect = [x - 16, y - 16, x + 16, y + 16];
  const target = readImage(paint('Boundary', (u) =>
    u > 0.5 ? [20, 20, 20] : [200, 200, 200], 128, 128), DEFAULT_SETTINGS, rect);
  const ring = [-5, -4, 5, -4, 5, 4, -5, 4];
  const full = new FloorplanGuides(target, cam, 1).detached(ring, () => true);
  const half = new FloorplanGuides(target, cam, 0.5).detached(ring, () => true);
  const turn = (p: number[]) => Math.atan2(p[3] - p[1], p[2] - p[0]);
  expect(Math.abs(turn(full))).toBeGreaterThan(0.1);
  expect(turn(half)).toBeCloseTo(turn(full) / 2);
  expect(cam.sx(full[2], full[3])).toBeCloseTo(cam.sx(full[4], full[5]));
  expect(ringArea(full)).toBeCloseTo(ringArea(ring));
  expect(full).toHaveLength(ring.length);
  expect(new FloorplanGuides(target, cam, 1).detached(ring, () => false)).toBe(ring);
  // A small isolated mark near the house has no sustained boundary across its site.
  const spot = paint('Spot', (u, v) => Math.hypot(u - 0.5, v - 0.5) < 0.025 ? [0, 0, 0] : [200, 200, 200], 128, 128);
  expect(new FloorplanGuides(readImage(spot, DEFAULT_SETTINGS, rect), cam, 1).detached(ring, () => true)).toBe(ring);
});
