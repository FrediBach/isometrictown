import { expect, test } from 'vitest';
import { newSolid, type Build } from '@/buildings';
import { Camera } from '@/camera';
import { pointInRing } from '@/geo';
import { frame, gable, ragged, shell } from '@/ruins';
import { DEFAULT_SETTINGS } from '@/settings';
import { STYLES } from '@/styles';

function build(scale = 500): Build {
  const set = { ...DEFAULT_SETTINGS, scale, abandon: 0.6 };
  return { set, cam: new Camera(set), style: STYLES.alpine, seed: 1, sun: [1, 0], equator: [0, -1], left: false,
    key: (x, y) => [Math.round(x), Math.round(y)], toAbs: (x, y) => [x, y], cell: (x, y, size) => [Math.round(x / size), Math.round(y / size)] };
}

const box = { pts: [0, 0, 12, 0, 12, 8, 0, 8], seam: new Uint8Array(4) };

test('a shell is a band of walls: the inside ring lies within the outside one, and nothing stands above its walls', () => {
  const s = newSolid();
  expect(shell(build(), [box], 6, 0.35, { windows: false, pen: 4 }, s)).toBe(true);
  // The top face is the outside ring with the inside one as its hole.
  const top = s.faces.find((f) => f.length === 2)!;
  expect(top).toBeDefined();
  for (let i = 0; i < top[1].length; i += 3) {
    expect(pointInRing(top[1][i], top[1][i + 1], box.pts)).toBe(true);
    expect(top[1][i + 2]).toBe(6);
  }
  for (const l of s.lines) for (let i = 2; i < l.pts.length; i += 3) expect(l.pts[i]).toBeLessThanOrEqual(6 + 1e-9);
  // One shadow per wall, as tall as the walls.
  expect(s.casts).toHaveLength(4);
  expect(s.casts.every((c) => c.h === 6)).toBe(true);
});

test('a footprint too thin to inset is left to the caller', () => {
  const sliver = { pts: [0, 0, 12, 0, 12, 0.3, 0, 0.3], seam: new Uint8Array(4) };
  expect(shell(build(), [sliver], 6, 0.35, { windows: false, pen: 4 }, newSolid())).toBe(false);
});

test('a gable rises to the ridge over the end wall, and a half-hipped one stops short', () => {
  const r = { cx: 6, cy: 4, ux: 1, uy: 0, L: 12, w: 8 };
  const full = newSolid();
  gable(build(), r, 1, 5, 1, 0.35, 1, full);
  const zs = (s: ReturnType<typeof newSolid>) => s.lines.flatMap((l) => l.pts.filter((_, i) => i % 3 === 2));
  expect(Math.max(...zs(full))).toBeCloseTo(9);
  expect(Math.min(...zs(full))).toBeCloseTo(5);
  const half = newSolid();
  gable(build(), r, -1, 5, 1, 0.35, 0.6, half);
  expect(Math.max(...zs(half))).toBeCloseTo(7.4);
  // It stands on the end wall: every point at x = 0 or just inside it.
  for (const l of half.lines) for (let i = 0; i < l.pts.length; i += 3) expect(l.pts[i]).toBeLessThan(1);
});

const top = (s: ReturnType<typeof newSolid>) => Math.max(...s.lines.flatMap((l) => l.pts.filter((_, i) => i % 3 === 2)));
const ink = (s: ReturnType<typeof newSolid>) => s.lines.reduce((a, l) => a + l.pts.length, 0);

test('ruined walls only come lower as they fall, never above the eaves, with rubble once height has gone', () => {
  let last = Infinity;
  for (const stand of [0.95, 0.8, 0.6, 0.4, 0.2, 0.12]) {
    const s = newSolid();
    expect(ragged(build(), [box], 6, 0.35, stand, { windows: false, pen: 4 }, s)).toBe(true);
    const walls = s.lines.filter((l) => l.facet !== 'rubble');
    const z = Math.max(...walls.flatMap((l) => l.pts.filter((_, i) => i % 3 === 2)));
    expect(z).toBeLessThanOrEqual(6 + 1e-9);
    expect(z).toBeLessThanOrEqual(last + 1e-9);
    last = z;
    if (stand <= 0.6) expect(s.lines.some((l) => l.facet === 'rubble')).toBe(true);
  }
});

test('a gutted tower keeps fewer floors as it comes down', () => {
  const tall = { pts: [0, 0, 20, 0, 20, 20, 0, 20], seam: new Uint8Array(4) };
  const whole = newSolid();
  frame(build(), [tall], 60, 3, 1, whole);
  const low = newSolid();
  frame(build(), [tall], 60, 3, 0.3, low);
  expect(top(low)).toBeLessThan(top(whole));
  expect(top(whole)).toBeLessThanOrEqual(60 + 1e-9);
  expect(ink(low)).toBeLessThan(ink(whole));
});
