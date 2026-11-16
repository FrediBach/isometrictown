import { expect, test } from 'vitest';
import type { Build, Solid } from '@/buildings';
import { Camera } from '@/camera';
import { coreMarkets, pocketCommons } from '@/commons';
import type { Masks, Tree } from '@/nature';
import { Paper } from '@/raster';
import type { Reshaped } from '@/reshape';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { STYLES } from '@/styles';
import type { Town, Way } from '@/tiles';

function setup(dx = 0, more: Partial<Settings> = {}) {
  const set = { ...DEFAULT_SETTINGS, solarpunk: true, depth: 'visionary' as const, scale: 500, bearing: 0, ...more };
  const B: Build = {
    set, cam: new Camera(set), style: STYLES.alpine, seed: set.seed, sun: [1, 0], equator: [0, -1], left: false,
    key: (x, y) => [Math.round(x + dx), Math.round(y)],
    toAbs: (x, y) => [x + dx, y], cell: (x, y, size) => [Math.floor((x + dx) / size), Math.floor(y / size)],
    future: { climate: 'temperate', gather: [] },
  };
  const paper = new Paper(B.cam);
  const M = Object.fromEntries(['road', 'water', 'green', 'wood', 'foot', 'shadow', 'pool', 'under', 'calm', 'title', 'strip'].map((k) => [k, paper.mask()])) as Masks;
  const path = [-30 - dx, 0, 30 - dx, 0];
  const R = { paths: [path], lots: [[{ pts: [-35 - dx, -8, 35 - dx, -8, 35 - dx, 8, -35 - dx, 8], seam: new Uint8Array(4) }]] } as Reshaped;
  const way: Way = { pts: path, kind: 'road', cls: 'minor', future: 'pedestrian', width: 8 };
  const town = { ways: [way] } as Town;
  return { B, paper, M, R, town };
}

const worldLines = (solids: Solid[], dx: number) => solids.flatMap((s) => s.lines.map((line) => line.pts.map((n, i) => Math.round((n + (i % 3 === 0 ? dx : 0)) * 1000) / 1000)));

test('pocket park food beds and benches leave the retained path clear', () => {
  const { B, paper, M, R } = setup();
  const result = pocketCommons(B, paper, R, M, []);
  expect(result.solids.length).toBeGreaterThan(0);
  expect(result.solids.some((s) => s.faces.length === 2)).toBe(true);
  expect(result.solids.some((s) => s.faces.length === 0)).toBe(true);
  for (const s of result.solids) for (const line of s.lines) for (let i = 1; i < line.pts.length; i += 3) expect(Math.abs(line.pts[i])).toBeGreaterThanOrEqual(2);
});

test.each([30, 47])('public furnishings stay fixed when the view moves %i metres', (dx) => {
  const a = setup(), b = setup(dx);
  expect(worldLines(pocketCommons(a.B, a.paper, a.R, a.M, []).solids, 0)).toEqual(worldLines(pocketCommons(b.B, b.paper, b.R, b.M, []).solids, dx));
  const c = setup(), d = setup(dx);
  const here = coreMarkets(c.B, c.paper, c.town, c.M, []).solids;
  expect(here.length).toBeGreaterThan(0);
  expect(worldLines(here, 0)).toEqual(worldLines(coreMarkets(d.B, d.paper, d.town, d.M, []).solids, dx));
});

test('market stalls preserve the service lane and keep clear of crossing roads', () => {
  const { B, paper, M, town } = setup();
  town.ways.push({ pts: [0, -30, 0, 30], kind: 'road', cls: 'minor', width: 8 });
  const result = coreMarkets(B, paper, town, M, []);
  expect(result.solids.length).toBeGreaterThan(0);
  for (const s of result.solids) for (const line of s.lines) for (let i = 0; i < line.pts.length; i += 3) {
    expect(Math.abs(line.pts[i + 1])).toBeGreaterThanOrEqual(1.8);
    expect(Math.abs(line.pts[i])).toBeGreaterThan(5);
  }
});

test('depth, feature switches and coarse scale omit public furnishings', () => {
  for (const settings of [{ depth: 'retrofit' as const }, { scale: 8000 }, { parks: false, life: false }]) {
    const { B, paper, M, R, town } = setup(0, settings);
    expect(pocketCommons(B, paper, R, M, []).solids).toEqual([]);
    expect(coreMarkets(B, paper, town, M, []).solids).toEqual([]);
  }
});

test('footprints and tree crowns exclude beds, benches and stalls', () => {
  for (const obstacle of ['foot', 'water', 'tree']) {
    const { B, paper, M, R, town } = setup();
    const trees: Tree[] = obstacle === 'tree' ? [{ x: 0, y: 0, r: 100, h: 10, conifer: false }] : [];
    if (obstacle === 'foot' || obstacle === 'water') M[obstacle].fill(1);
    expect(pocketCommons(B, paper, R, M, trees).solids).toEqual([]);
    expect(coreMarkets(B, paper, town, M, trees).solids).toEqual([]);
  }
});
