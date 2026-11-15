import { expect, test } from 'vitest';
import { Camera } from '@/camera';
import type { Build } from '@/buildings';
import type { Masks } from '@/nature';
import { Paper } from '@/raster';
import { DEFAULT_SETTINGS, WATER } from '@/settings';
import { STYLES } from '@/styles';
import type { Shape, Town } from '@/tiles';
import { channelField, surfaceKind, waves, waterKind } from '@/water';

const shape = (pts: number[]): Shape => [{ pts, seam: new Uint8Array(pts.length / 2) }];

test('water classes and narrow mapped channels get distinct surface characters', () => {
  expect(['ocean', 'lake', 'river', 'canal', 'pond', ''].map(waterKind)).toEqual(['ocean', 'lake', 'river', 'river', 'lake', 'lake']);
  const streams = [{ pts: [-100, 0, 100, 0], width: 7 }];
  expect(surfaceKind('lake', shape([-100, -15, 100, -15, 100, 15, -100, 15]), streams)).toBe('river');
  expect(surfaceKind('lake', shape([-100, -100, 100, -100, 100, 100, -100, 100]), streams)).toBe('lake');
});

test('channel tangents follow vertical channels and turn smoothly through bends', () => {
  const vertical = channelField([[10, 0, 10, 50]]);
  expect(vertical(12, 25)).toEqual([0, 1]);
  const bend = channelField([[0, 0, 20, 0, 40, 20, 40, 40]]);
  const a = bend(18, 0)!, b = bend(22, 2)!;
  expect(a[0] * b[0] + a[1] * b[1]).toBeGreaterThan(0.98);
  expect(bend(40, 38)![1]).toBeGreaterThan(0.9);
  expect(bend(200, 200)).toBeUndefined();
});

function sample(cls: string, penWidth = 0.35, block = false, bearing = 0, tributary = false) {
  const set = { ...DEFAULT_SETTINGS, scale: 1000, bearing, penWidth };
  const cam = new Camera(set), paper = new Paper(cam), town: Pick<Town, 'water' | 'waterCls' | 'streams'> = { water: [], waterCls: [], streams: [] };
  const B: Build = { set, cam, style: STYLES.alpine, seed: set.seed, sun: [1, 0], equator: [0, -1], left: false,
    key: (x, y) => [Math.round(x), Math.round(y)], toAbs: (x, y) => [x, y], cell: (x, y, size) => [Math.floor(x / size), Math.floor(y / size)] };
  const M = Object.fromEntries(['water', 'pool', 'road', 'under', 'calm', 'green', 'wood', 'foot', 'shadow', 'title'].map((k) => [k, paper.mask()])) as Masks;
  town.water = [shape([-30, -30, 30, -30, 30, 30, -30, 30])]; town.waterCls = [cls];
  if (cls === 'river') town.streams = [{ pts: [0, -40, 0, 40], width: 7 }];
  if (tributary) town.streams.push({ pts: [0, 15, 35, 15], width: 2.5 });
  paper.fillMask(M.water, town.water[0].map((r) => r.pts));
  if (block) paper.fillMask(M.calm, [[-8, -40, 8, -40, 8, 40, -8, 40]]);
  paper.finishDepth();
  waves(B, paper, M, town, []);
  return { lines: paper.pens[WATER], cam, paper, M };
}

test('sea crests are larger than lake ripples; rivers follow the channel instead of sheet rows', () => {
  const lake = sample('lake').lines, sea = sample('ocean').lines, river = sample('river').lines;
  const height = (l: number[]) => { const y = l.filter((_, i) => i % 2); return Math.max(...y) - Math.min(...y); };
  expect(Math.max(...sea.map(height))).toBeGreaterThan(Math.max(...lake.map(height)) * 5);
  expect(river.length).toBeGreaterThan(10);
  expect(river.every((l) => Math.abs(l[0] - l[l.length - 2]) < 0.01)).toBe(true);
  expect(sample('lake').lines).toEqual(lake);
  expect(sample('lake', 0.7).lines.length).toBeLessThan(lake.length);
});

test('ripples stay inside the water and leave wake masks clear', () => {
  for (const cls of ['lake', 'ocean', 'river']) {
    const { lines, paper, M } = sample(cls, 0.35, true);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) for (let i = 0; i < line.length; i += 2) {
      expect(paper.on(M.water, line[i], line[i + 1])).toBe(true);
      expect(paper.on(M.calm, line[i], line[i + 1])).toBe(false);
    }
  }
});


test('small tributaries do not turn hatching across the main river', () => {
  expect(sample('river', 0.35, false, 0, true).lines).toEqual(sample('river').lines);
});

test('river strokes stay long and coverage stays comparable as the channel rotates', () => {
  const counts: number[] = [];
  for (const bearing of [0, 20, 40, 60, 80]) {
    const { lines } = sample('river', 0.35, false, bearing);
    counts.push(lines.length);
    const lengths = lines.map((p) => {
      let n = 0;
      for (let i = 2; i < p.length; i += 2) n += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      return n;
    }).sort((a, b) => a - b);
    expect(lengths[Math.floor(lengths.length / 2)]).toBeGreaterThan(3);
  }
  expect(Math.max(...counts) / Math.min(...counts)).toBeLessThan(1.5);
});
