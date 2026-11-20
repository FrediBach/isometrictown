import { expect, test } from 'vitest';
import { Camera } from '@/camera';
import { ringArea } from '@/geo';
import { onLot } from '@/image-blocks';
import { simpleFootprint } from '@/image-check';
import { PLAN_GRID, PLANS } from '@/image-floorplan-data';
import { FloorplanGuides, learntPlan, planFill } from '@/image-floorplans';
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

test('every learnt plan is a simple counter-clockwise ring filling its grid box, and each zone shares add up', () => {
  for (const [label, plans] of Object.entries(PLANS)) {
    const total = plans!.reduce((s, p) => s + p.share, 0);
    expect(total, label).toBeCloseTo(1, 1);
    for (const p of plans!) {
      expect(simpleFootprint(p.ring), label).toBe(true);
      expect(ringArea(p.ring), label).toBeGreaterThan(0);
      const xs = p.ring.filter((_, i) => i % 2 === 0), ys = p.ring.filter((_, i) => i % 2 === 1);
      expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, PLAN_GRID, 0, PLAN_GRID]);
    }
  }
});

test('a learnt plan starts on the street front, keeps to its box, and gives way to the plain box where its walls would not show', () => {
  let shaped = 0;
  for (let k = 0; k < 200; k++) {
    const plan = learntPlan('suburb', 11, 9, 1, false, k / 200, (k * 7 % 200) / 200);
    if (!plan) continue;
    shaped++;
    const r = plan.ring;
    expect(simpleFootprint(r)).toBe(true);
    expect(ringArea(r)).toBeGreaterThan(0);
    expect(r[1]).toBe(0);
    expect(r[3]).toBe(0);
    expect(r[2]).toBeGreaterThan(r[0]);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...r)).toBeLessThanOrEqual(1);
    expect(planFill(r)).toBeLessThan(1);
  }
  // About half of real suburban houses are not plain boxes.
  expect(shaped).toBeGreaterThan(60);
  expect(shaped).toBeLessThan(140);
  // At 1:8000 a few metres' notch is a fraction of a millimetre: none survive on a small house.
  for (let k = 0; k < 50; k++) expect(learntPlan('suburb', 11, 9, 1 / 8, false, k / 50, 0.7)).toBeNull();
  expect(learntPlan('meadow', 11, 9, 1, false, 0.9, 0.7)).toBeNull();
});

test('a row plan laid on a lot keeps the lot front and both party walls where the plain strip has them', () => {
  // A lot bending once along its front, 6 m wide and 20 m deep.
  const lot = { o: [0, 0, 3, 0.4, 6, 0], i: [0, 20, 3, 20.4, 6, 20], depth: 20 };
  const row = PLANS.rows!.find((p) => p.ring.length > 8 && p.ring.includes(0) && p.ring.length <= 12)!;
  const ring = row.ring.map((v) => v / PLAN_GRID);
  const p = onLot(lot, ring, 1, 14);
  expect(simpleFootprint(p)).toBe(true);
  expect(ringArea(p)).toBeGreaterThan(0);
  // The front follows the lot's bend: one corner on the bend, a metre behind the front.
  expect(p.some((v, i) => i % 2 === 0 && Math.abs(v - 3) < 1e-9 && Math.abs(p[i + 1] - 1.4) < 1e-9)).toBe(true);
  // Every corner lies between the lot's sides, and both sides are reached.
  const xs = p.filter((_, i) => i % 2 === 0);
  expect(Math.min(...xs)).toBeCloseTo(0);
  expect(Math.max(...xs)).toBeCloseTo(6);
});
