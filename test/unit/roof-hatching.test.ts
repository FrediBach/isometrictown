import { expect, test } from 'vitest';
import { building, newSolid, prism, type Build } from '@/buildings';
import { Camera } from '@/camera';
import { Frame } from '@/geo';
import { pitchedRoof, type End } from '@/roofs';
import { DEFAULT_SETTINGS, LINEWORK } from '@/settings';
import { corners } from '@/shape';
import { STYLES } from '@/styles';
import type { Building } from '@/tiles';
import bauma from '../fixtures/bauma-roof.json';

function build(): Build {
  const set = { ...DEFAULT_SETTINGS, center: [8.8858, 47.3653] as [number, number], bearing: 90, scale: 1000 };
  const frame = new Frame(set.center);
  const toAbs = (x: number, y: number): [number, number] => [frame.mx0 + x / frame.k, frame.my0 + y / frame.k];
  return { set, cam: new Camera(set), style: STYLES.alpine, seed: set.seed, sun: [1, 0], equator: [0, -1], left: false,
    toAbs, key: (x, y) => { const [a, b] = toAbs(x, y); return [Math.round(a), Math.round(b)]; },
    cell: (x, y, size) => { const [a, b] = toAbs(x, y); return [Math.round(a / size), Math.round(b / size)]; } };
}

test.each(['gable', 'half', 'inner', 'party'] as End[])('%s wall shading continues from the wall to the roof profile', (end) => {
  const B = build(), solid = newSolid();
  const rect = { cx: 0, cy: 0, ux: 1, uy: 0, L: 20, w: 12 };
  prism(B, [{ pts: corners(rect), seam: new Uint8Array(4) }], 0, 6, { roof: false, windows: false, pen: LINEWORK }, solid);
  const before = solid.lines.filter(l => l.layer === 'shadeWalls');
  expect(before.length).toBeGreaterThan(0);
  pitchedRoof(B, { rect, He: 6, tan: 0.6, ends: [end, end], sides: [1, 1], o: 1, hatch: true }, solid);
  const after = solid.lines.filter(l => l.layer === 'shadeWalls');
  expect(after).toHaveLength(before.length);
  for (const l of after) {
    expect(l.pts[2]).toBe(0);
    const cap = end === 'half' ? 2.4 : 0;
    expect(l.pts[5]).toBeCloseTo(6 + (6 - Math.max(Math.abs(l.pts[1]), cap)) * 0.6, 8);
  }
});

test('gable shading obeys the shade switch and sunlight', () => {
  for (const disabled of [true, false]) {
    const B = build(), solid = newSolid();
    if (disabled) B.set.shadeWalls = false;
    else B.sun = [-1, 0];
    pitchedRoof(B, { rect: { cx: 0, cy: 0, ux: 1, uy: 0, L: 20, w: 12 }, He: 6, tan: 0.6, ends: ['gable', 'gable'], sides: [1, 1], o: 1, hatch: true }, solid);
    expect(solid.lines.filter(l => l.layer === 'shadeWalls')).toHaveLength(0);
  }
});

test('the Bauma wing roof and every hatch stroke lie on their supporting planes', () => {
  const B = build();
  const b = structuredClone(bauma) as unknown as Building;
  b.shape.forEach(r => { r.seam = Uint8Array.from(Object.values(r.seam)); });
  b.info!.party = Float32Array.from(Object.values(b.info!.party));
  const solids = building(B, b);
  let checked = 0;
  for (const solid of solids) for (const line of solid.lines) {
    if (line.layer !== 'roofHatch' || !line.on) continue;
    const p = line.on[0];
    const a = [p[3] - p[0], p[4] - p[1], p[5] - p[2]];
    let normal = [0, 0, 0], length = 0;
    for (let i = 6; i < p.length && length < 1e-8; i += 3) {
      const b = [p[i] - p[0], p[i + 1] - p[1], p[i + 2] - p[2]];
      normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      length = Math.hypot(...normal);
    }
    expect(length).toBeGreaterThan(1e-8);
    for (const points of [p, line.pts]) for (let i = 0; i < points.length; i += 3) {
      const distance = normal.reduce((sum, n, j) => sum + n * (points[i + j] - p[j]), 0) / length;
      expect(distance).toBeCloseTo(0, 8);
    }
    checked++;
  }
  expect(checked).toBeGreaterThan(20);
});
