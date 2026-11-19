import { expect, test } from 'vitest';
import { newSolid, type Build } from '@/buildings';
import { Camera } from '@/camera';
import { pointInRing } from '@/geo';
import { frame, gable, ragged, shell } from '@/ruins';
import { DEFAULT_SETTINGS, LINEWORK, ROOFS } from '@/settings';
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

test('each wall run starts at the eaves and only gets lower', () => {
  let last: number[] | undefined;
  for (const stand of [0.9999, 0.95, 0.75, 0.5, 0.3, 0.12]) {
    const ruin = newSolid();
    ragged(build(), [box], 6, 0.35, stand, { windows: false, pen: LINEWORK }, ruin);
    const heights = ruin.faces.map(face => face[0]).filter(p =>
      p.length === 12 && p[2] === p[5] && p[2] === p[8] && p[2] === p[11]).map(p => p[2]);
    expect(heights.length).toBeGreaterThan(4);
    if (last) {
      expect(heights).toHaveLength(last.length);
      heights.forEach((z, i) => expect(z).toBeLessThanOrEqual(last![i]));
    } else expect(Math.min(...heights)).toBeCloseTo(6, 2);
    last = heights;
  }
});

test('a thinning façade reveals fixed slab levels, each casting its own shadow', () => {
  const B = build(2500);
  let previous: number[] = [];
  for (const walls of [0.8, 0.65, 0.5, 0.25, 0]) {
    const s = newSolid();
    frame(B, [box], 60, 3, 1, s, 0, { pen: LINEWORK, windows: false }, walls);
    const slabs = s.faces.filter(f => f[0].every((v, i) => i % 3 !== 2 || v === f[0][2]));
    const levels = slabs.map(f => f[0][2]);
    expect(levels.length).toBeGreaterThan(0);
    for (const z of previous) expect(levels).toContain(z);
    for (const slab of slabs) expect(s.shade).toContain(slab);
    expect(s.casts).toHaveLength(0);
    previous = levels;
  }
});

test('tiles stay on the same roofed part of the plot when the view pans', () => {
  const court = [6, 4, 6, 12, 18, 12, 18, 4];
  function floorTiles(pan: number) {
    const B = build();
    B.key = (x, y) => [Math.round(x + pan), Math.round(y)];
    const rings = [[0, 0, 24, 0, 24, 16, 0, 16], court].map(p => ({
      pts: p.map((v, i) => i % 2 ? v : v - pan), seam: new Uint8Array(4),
    }));
    const s = newSolid();
    expect(shell(B, rings, 6, 0.35, { pen: LINEWORK, windows: false }, s, 0, false, true)).toBe(true);
    return s.lines.filter(l => l.pen === ROOFS && l.pts.length === 6 && l.pts[2] > 0)
      .map(l => l.pts.map((v, i) => Number((i % 3 === 0 ? v + pan : v).toFixed(6))));
  }
  const tiles = floorTiles(0);
  expect(tiles.length).toBeGreaterThan(4);
  for (const [ax, ay, , bx, by] of tiles) {
    for (const t of [0, 0.5, 1]) expect(pointInRing(ax + (bx - ax) * t, ay + (by - ay) * t, court)).toBe(false);
  }
  expect(floorTiles(47)).toEqual(tiles);
});
