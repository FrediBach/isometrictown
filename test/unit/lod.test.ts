import { describe, expect, test } from 'vitest';
import { Camera } from '@/camera';
import { atLeast, coarsest, LOD, shows, spaced, thin } from '@/lod';
import { DEFAULT_SETTINGS } from '@/settings';

const camAt = (scale: number, more = {}) => new Camera({ ...DEFAULT_SETTINGS, scale, ...more });
const rules = Object.entries(LOD);

describe('LOD rules', () => {
  test.each(rules)('%s is a sane rule', (_id, r) => {
    expect(r.m).toBeGreaterThan(0);
    expect(r.mm).toBeGreaterThan(0);
    expect(r.what.length).toBeGreaterThan(5);
  });

  test.each(rules)('%s shows finer than coarsest() and not beyond it', (_id, r) => {
    const n = coarsest(r);
    expect(shows(camAt(n / 1.05), r)).toBe(true);
    expect(shows(camAt(n * 1.05), r)).toBe(false);
  });

  test('a fade hash spreads the cut over one doubling of scale', () => {
    const r = LOD.chimney;
    const n = coarsest(r);
    // A low hash holds on longest, a high one drops out first.
    expect(shows(camAt(n * 1.3), r, r.m, 0.01)).toBe(true);
    expect(shows(camAt(n * 1.3), r, r.m, 0.99)).toBe(false);
    expect(shows(camAt(n / 1.5), r, r.m, 0.99)).toBe(true);
    expect(shows(camAt(n * 1.5), r, r.m, 0.01)).toBe(false);
  });

  test('bigger things last to coarser scales', () => {
    const r = LOD.chimney;
    const cam = camAt(coarsest(r) * 1.5);
    expect(shows(cam, r)).toBe(false);
    expect(shows(cam, r, r.m * 2)).toBe(true);
  });

  test('Detail and pen width shift where rules cut in', () => {
    const r = LOD.window;
    expect(coarsest(r, 2)).toBeCloseTo(coarsest(r) * 2, 9);
    expect(coarsest(r, 1, 0.7)).toBeCloseTo(coarsest(r) / 2, 9);
    const n = coarsest(r);
    expect(shows(camAt(n * 1.5, { detail: 2 }), r)).toBe(true);
    expect(shows(camAt(n / 1.5, { penWidth: 0.7 }), r)).toBe(false);
  });

  test('thin keeps everything when big enough and thins with the square below', () => {
    const r = LOD.tree;
    const n = coarsest(r);
    expect(thin(camAt(n / 2), r, r.m)).toBe(1);
    expect(thin(camAt(n * 2), r, r.m)).toBeCloseTo(0.25, 9);
  });

  test('atLeast widens up to its limit and spaced keeps marks apart on paper', () => {
    const r = LOD.window;
    const coarse = camAt(coarsest(r) * 10);
    expect(atLeast(coarse, r, 1, 2)).toBe(2);
    expect(atLeast(camAt(500), r, 1, 2)).toBe(1);
    const cam = camAt(1000);
    expect(spaced(cam, 0.1, 1)).toBeCloseTo(1, 9);
    expect(spaced(cam, 5, 1)).toBe(5);
  });
});
