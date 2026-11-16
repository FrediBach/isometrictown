import { describe, expect, test } from 'vitest';
import type { Build } from '@/buildings';
import { Camera } from '@/camera';
import { pointInRing } from '@/geo';
import { Paper } from '@/raster';
import { fits, overlaps } from '@/production';
import { planSharedWater, sharedWater } from '@/shared-water';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { corners } from '@/shape';
import { STYLES } from '@/styles';
import type { Shape, Town } from '@/tiles';

const shape = (x: number, y: number, L: number, w: number): Shape => [{ pts: corners({ cx: x, cy: y, L, w, ux: 1, uy: 0 }), seam: new Uint8Array(4) }];
function setup(dx = 0, more: Partial<Settings> = {}) {
  const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), solarpunk: true, depth: 'visionary', scale: 1000, ...more };
  const context: NonNullable<Town['publicContext']> = { squares: [shape(-dx, 0, 32, 30)], obstacles: [], buildings: [], ways: [], streams: [] };
  const town = { publicContext: context } as Town;
  const B: Build = { set, cam: new Camera(set), style: STYLES.alpine, seed: set.seed, sun: [1, 0], equator: [0, -1], left: false,
    key: (x, y) => [Math.round(x + dx), Math.round(y)], toAbs: (x, y) => [x + dx, y], cell: (x, y, n) => [Math.floor((x + dx) / n), Math.floor(y / n)],
    future: set.solarpunk ? { climate: 'temperate', gather: [] } : null };
  return { B, town, context };
}

describe('shared rainwater courts', () => {
  test('complete courts share a stable site; Visionary raises an explicitly supported vessel', () => {
    const a = setup(), plans = planSharedWater(a.B, a.town);
    expect(plans).toHaveLength(1);
    expect(plans[0].tower).toBe(true);
    expect(fits({ ...plans[0].envelope, L: 20, w: 18 }, a.context.squares[0])).toBe(true);
    const s = sharedWater(a.B, plans)[0];
    expect(Math.max(...s.lines.flatMap(l => l.pts.filter((_, i) => i % 3 === 2)))).toBe(22);
    a.B.set.depth = 'transform';
    const lower = planSharedWater(a.B, a.town);
    expect(lower[0].envelope).toEqual(plans[0].envelope);
    expect(lower[0].tower).toBe(false);
    expect(Math.max(...sharedWater(a.B, lower)[0].lines.flatMap(l => l.pts.filter((_, i) => i % 3 === 2)))).toBe(9);
  });
  test.each(['hole', 'notch', 'building', 'water', 'path', 'road', 'rail', 'bridge', 'stream', 'reserved'])('rejects a full-footprint conflict with %s', kind => {
    const a = setup(), tiny = shape(2, 2, 0.2, 0.2);
    if (kind === 'hole') a.context.squares[0].push(...tiny);
    if (kind === 'notch') a.context.squares[0][0] = { pts: [-16, -15, 16, -15, 16, 15, 1, 15, 1, 0, -1, 0, -1, 15, -16, 15], seam: new Uint8Array(8) };
    if (kind === 'building') a.context.buildings.push(tiny);
    if (kind === 'water') a.context.obstacles.push(tiny);
    if (['path', 'road', 'rail', 'bridge'].includes(kind)) a.context.ways.push({ pts: [-30, 0, 30, 0], width: 2, kind: kind === 'rail' ? 'rail' : kind === 'road' ? 'road' : 'path', cls: 'service', bridge: kind === 'bridge' });
    if (kind === 'stream') a.context.streams.push({ pts: [-30, 0, 30, 0], width: 2 });
    const reserved = kind === 'reserved' ? [{ envelope: { cx: 0, cy: 0, ux: 1, uy: 0, L: 2, w: 2 } }] : [];
    expect(planSharedWater(a.B, a.town, reserved)).toEqual([]);
  });
  test('searches remaining space beside solar roofs without touching their envelope', () => {
    const a = setup(); a.context.squares = [shape(0, 0, 80, 40)];
    const roof = { envelope: { cx: 0, cy: 0, ux: 1, uy: 0, L: 20, w: 20 } };
    const plans = planSharedWater(a.B, a.town, [roof]);
    expect(plans).toHaveLength(1);
    expect(overlaps(corners(plans[0].envelope), corners(roof.envelope))).toBe(false);
  });
  test('duplicate and reversed polygons agree, while overlapping courts both decline', () => {
    const a = setup(), original = planSharedWater(a.B, a.town);
    const p = a.context.squares[0][0].pts;
    a.context.squares.push([{ pts: Array.from({ length: p.length / 2 }, (_, i) => p.slice(p.length - 2 - i * 2, p.length - i * 2)).flat(), seam: new Uint8Array(4) }]);
    expect(planSharedWater(a.B, a.town)).toEqual(original);
    a.context.squares.reverse(); expect(planSharedWater(a.B, a.town)).toEqual(original);
    a.context.squares.push(shape(1, 0, 32, 30));
    expect(planSharedWater(a.B, a.town)).toEqual([]);
    a.context.squares.reverse(); expect(planSharedWater(a.B, a.town)).toEqual([]);
  });
  test('plans stay fixed under panning, projection and detail', () => {
    const a = setup(), plan = planSharedWater(a.B, a.town)[0];
    for (const dx of [30, 47, 310]) {
      const b = setup(dx, { scale: 8000, bearing: 180, detail: 0.4, life: false });
      const p = planSharedWater(b.B, b.town)[0];
      expect(p.key).toBe(plan.key);
      expect({ ...p.envelope, cx: p.envelope.cx + dx }).toEqual(plan.envelope);
    }
  });
  test('campus interiors qualify but playing fields and natural cover stay clear', () => {
    const a = setup();
    a.context.waterSites = a.context.squares; a.context.squares = [];
    a.context.waterSites[0][0].seam[0] = 1;
    const plan = planSharedWater(a.B, a.town);
    expect(plan).toHaveLength(1);
    expect(fits({ ...plan[0].envelope, L: 20, w: 18 }, a.context.waterSites[0])).toBe(true);
    a.context.waterObstacles = [shape(0, 0, 30, 28)];
    expect(planSharedWater(a.B, a.town)).toEqual([]);
  });
  test('requires explicit pedestrian ground and the appropriate mode and depth', () => {
    for (const set of [{ solarpunk: false }, { depth: 'retrofit' as const }, { ground: false }]) { const a = setup(0, set); expect(planSharedWater(a.B, a.town)).toEqual([]); }
    const a = setup(); a.context.squares = [];
    Object.assign(a.town, { plazas: [shape(0, 0, 100, 100)] });
    expect(planSharedWater(a.B, a.town)).toEqual([]);
  });
  test('all geometry fits the maintenance court and tank volumes occlude their interiors', () => {
    for (const depth of ['transform', 'visionary'] as const) for (const scale of [1000, 4000]) {
      const a = setup(0, { depth, scale, bearing: 0, tilt: 5 }), plans = planSharedWater(a.B, a.town), s = sharedWater(a.B, plans)[0], r = plans[0].envelope;
      expect(s.lines.every(l => l.pts.every(Number.isFinite))).toBe(true);
      for (const f of s.faces) for (const p of f) for (let i = 0; i < p.length; i += 3) {
        expect(Math.abs(p[i] - r.cx)).toBeLessThanOrEqual(r.L / 2);
        expect(Math.abs(p[i + 1] - r.cy)).toBeLessThanOrEqual(r.w / 2);
        expect(p[i + 2]).toBeGreaterThanOrEqual(0);
      }
      const paper = new Paper(a.B.cam);
      for (const f of s.faces) paper.fillFace(f);
      paper.finishDepth();
      const visible = (x: number, z: number) => paper.seen(a.B.cam.sx(x, 0), a.B.cam.sy(x, 0, z), a.B.cam.depth(x, 0, z));
      if (depth === 'visionary') {
        expect(visible(1, 15)).toBe(false); expect(visible(1, 4)).toBe(true);
        expect(s.casts.every(c => !pointInRing(r.cx, r.cy, c.ring))).toBe(true);
        expect(s.shade!.some(f => f[0].every((v, i) => i % 3 !== 2 || v === 18))).toBe(true);
      }
      else expect(visible(-3.5, 2)).toBe(false);
    }
  });
});
