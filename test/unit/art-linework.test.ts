import { expect, test, vi } from 'vitest';
import { car, newSolid, type Build } from '@/buildings';
import { Camera } from '@/camera';
import { markings } from '@/infra';
import { parkGrass } from '@/ground';
import type { Masks } from '@/nature';
import { Paper } from '@/raster';
import { pitchedRoof } from '@/roofs';
import { patch } from '@/rng';
import { DEFAULT_SETTINGS, GREENERY, LINEWORK, type Settings } from '@/settings';
import { curbs, fillRoads } from '@/streets';
import { STYLES } from '@/styles';
import type { Way } from '@/tiles';

function build(more: Partial<Settings> = {}): Build {
  const set = { ...DEFAULT_SETTINGS, ...more };
  return {
    set, cam: new Camera(set), style: STYLES.alpine, seed: set.seed,
    sun: [1, 0], equator: [0, -1], left: false,
    key: (x, y) => [Math.round(x), Math.round(y)],
    cell: (x, y, size) => [Math.floor(x / size), Math.floor(y / size)],
    toAbs: (x, y) => [x, y],
  };
}

test.each([0.35, 0.7])('park hatch leaves a visible gap at lawn and road edges with a %s mm pen', (penWidth) => {
  const B = build({ penWidth });
  const paper = new Paper(B.cam);
  const M = Object.fromEntries(['road', 'water', 'green', 'wood', 'foot', 'shadow', 'pool', 'under', 'calm', 'title'].map((key) => [key, paper.mask()])) as Masks;
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].flatMap(([x, y]) => B.cam.ground(x, y));
  paper.fillMask(M.green, [rect(180, 120, 220, 150)]);
  paper.fillMask(M.road, [rect(199, 110, 201, 160)]);
  paper.finishDepth();
  parkGrass(paper, M);
  const lines = paper.pens[GREENERY];
  expect(lines.length).toBeGreaterThan(5);
  for (const line of lines) {
    for (let i = 0; i < line.length; i += 2) {
      const x = line[i], y = line[i + 1];
      const gap = Math.min(x - 180, 220 - x, y - 120, 150 - y, Math.abs(x - 200) - 1);
      expect(gap).toBeGreaterThan(penWidth * 0.8);
    }
  }
});

test('texture patches stay bounded and continuous across positive and negative cell edges', () => {
  for (let i = -5; i <= 5; i++) {
    for (let j = -5; j <= 5; j++) {
      const value = patch(i + 0.37, j + 0.63, 42, 7931);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(patch(i - 1e-6, j + 0.4, 42, 7931)).toBeCloseTo(patch(i + 1e-6, j + 0.4, 42, 7931), 8);
      expect(patch(i + 0.4, j - 1e-6, 42, 7931)).toBeCloseTo(patch(i + 0.4, j + 1e-6, 42, 7931), 8);
    }
  }
});

test('texture patches repeat for the same seed and vary independently by seed and salt', () => {
  const samples = (seed: number, salt: number) => Array.from({ length: 30 }, (_, i) => patch(i * 0.37, i * -0.23, seed, salt));
  expect(samples(42, 7931)).toEqual(samples(42, 7931));
  expect(samples(42, 7931)).not.toEqual(samples(43, 7931));
  expect(samples(42, 7931)).not.toEqual(samples(42, 7932));
});

test.each([0.35, 0.7])('roof hatch leaves clear ends with a %s mm pen without changing the roof', (penWidth) => {
  const B = build({ penWidth });
  const out = newSolid();
  const plain = newSolid();
  const spec = {
    rect: { cx: 0, cy: 0, ux: 1, uy: 0, L: 20, w: 12 },
    He: 10, tan: 1, ends: ['gable', 'gable'] as ['gable', 'gable'],
    sides: [0, 0] as [number, number], o: 0, hatch: true,
  };
  pitchedRoof(B, spec, out);
  pitchedRoof(B, { ...spec, hatch: false }, plain);
  expect(out.faces).toEqual(plain.faces);
  expect(out.lines.filter((l) => l.layer !== 'roofHatch')).toEqual(plain.lines);
  const hatch = out.lines.filter((l) => l.layer === 'roofHatch');
  expect(hatch.length).toBeGreaterThan(0);
  const { cam } = B;
  for (const { pts: p } of hatch) {
    const eave = Math.sign(p[1]) * 6;
    const startGap = Math.hypot(cam.sx(p[0], p[1]) - cam.sx(p[0], eave), cam.sy(p[0], p[1], p[2]) - cam.sy(p[0], eave, 10));
    const endGap = Math.hypot(cam.sx(p[3], p[4]) - cam.sx(p[3], 0), cam.sy(p[3], p[4], p[5]) - cam.sy(p[3], 0, 16));
    expect(startGap).toBeGreaterThan(penWidth);
    expect(endGap).toBeGreaterThan(penWidth);
    expect(p[2]).toBeLessThan(p[5]);
  }
});

test('small cars keep an outline and windscreen instead of stacked rims', () => {
  const full = car(build({ scale: 500 }), 0, 0, 1, 0, 0.4);
  const small = car(build({ scale: 2000 }), 0, 0, 1, 0, 0.4);
  expect(small.lines).toHaveLength(2);
  expect(small.lines.filter((l) => l.closed)).toHaveLength(1);
  expect(full.lines.length).toBeGreaterThan(small.lines.length);
  expect(small.faces.length).toBeGreaterThan(0);
  expect(small.casts).toEqual(full.casts);
});

test('foreshortened road dashes disappear before equally long transverse dashes', () => {
  const strokes = (pts: number[]) => {
    const B = build({ scale: 3000, bearing: 0 });
    const paper = new Paper(B.cam);
    const M = Object.fromEntries(['road', 'water', 'green', 'wood', 'foot', 'shadow', 'pool', 'under', 'calm', 'title'].map((key) => [key, paper.mask()])) as Masks;
    const ways: Way[] = [{ kind: 'road', cls: 'primary', width: 12, pts }];
    fillRoads(paper, ways, [], M.road);
    paper.finishDepth();
    markings(B, paper, ways, M);
    return paper.pens[LINEWORK].length;
  };
  expect(strokes([-50, 0, 50, 0])).toBeGreaterThan(0);
  expect(strokes([0, -50, 0, 50])).toBe(0);
});

test('a right-angle kerb emits only the outside arc at its bend', () => {
  const B = build();
  const paper = new Paper(B.cam);
  const M = { road: paper.mask() } as Masks;
  const ways: Way[] = [{ kind: 'road', cls: 'minor', width: 10, pts: [-30, 0, 0, 0, 0, 30] }];
  fillRoads(paper, ways, [], M.road);
  paper.finishDepth();
  const seg = vi.spyOn(paper, 'seg');
  curbs(paper, ways, M);
  let arcs = 0;
  for (const [, ax, ay, , bx, by] of seg.mock.calls) {
    const a = B.cam.ground(ax, ay);
    const b = B.cam.ground(bx, by);
    if (Math.hypot(...a) > 6 || Math.hypot(...b) > 6) continue;
    if (Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) continue;
    arcs++;
    for (const [x, y] of [a, b]) {
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(1e-6);
    }
  }
  expect(arcs).toBeGreaterThan(0);
});
