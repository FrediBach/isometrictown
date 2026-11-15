import { expect, test } from 'vitest';
import { newSolid, prism, type Build } from '@/buildings';
import { Camera } from '@/camera';
import { DEFAULT_SETTINGS, LINEWORK, sunBearing, type Settings } from '@/settings';
import { STYLES } from '@/styles';

function wall(width: number, height: number, more: Partial<Settings> = {}, sun: [number, number] = [0, 1], neighbour = 0) {
  const set = { ...DEFAULT_SETTINGS, bearing: 0, scale: 1000, ...more };
  const B: Build = { set, cam: new Camera(set), style: STYLES.alpine, seed: set.seed, sun, equator: [0, -1], left: false,
    key: (x, y) => [Math.round(x), Math.round(y)], toAbs: (x, y) => [x, y], cell: (x, y, size) => [Math.floor(x / size), Math.floor(y / size)] };
  const solid = newSolid();
  prism(B, [{ pts: [0, 0, width, 0, width, 20, 0, 20], seam: new Uint8Array(4), party: new Float32Array([neighbour, 0, 0, 0]) }], 0, height, { roof: true, windows: false, pen: LINEWORK }, solid);
  return solid.lines.filter(l => l.layer === 'shadeWalls');
}

test('wall height does not change hatch density, including small walls', () => {
  for (const height of [3, 6, 20]) expect(wall(12, height)).toHaveLength(15);
  expect(wall(2, 30)).toHaveLength(1);
});

test('tone spacing follows scale and nib width but not Detail', () => {
  expect(wall(12, 6, { scale: 4000 })).toHaveLength(3);
  expect(wall(12, 6, { penWidth: 0.7 })).toHaveLength(7);
  expect(wall(12, 6, { detail: 2 })).toEqual(wall(12, 6, { detail: 0.5 }));
  expect(wall(12, 20, { shadeWalls: false })).toHaveLength(0);
});

test('sunlit and grazing south walls stay plain, including a due-east sun', () => {
  expect(wall(30, 30, {}, [0, -1])).toHaveLength(0);
  expect(wall(30, 30, {}, [Math.sin(Math.PI / 2), Math.cos(Math.PI / 2)])).toHaveLength(0);
  expect(wall(30, 30, {}, [Math.sqrt(0.99), 0.1])).toHaveLength(0);
  expect(wall(30, 30, {}, [Math.sqrt(0.84), 0.4]).length).toBeLessThan(wall(30, 30).length);
});

test('a neighbour clips the hatch height without changing its density', () => {
  const lines = wall(30, 30, {}, [0, 1], 28);
  expect(lines).toHaveLength(wall(30, 30).length);
  expect(lines.every(l => l.pts[2] === 28 && l.pts[5] === 30)).toBe(true);
});

test('automatic sun stays south-east in the north and north-east in the south as the view turns', () => {
  for (const bearing of [0, 35, 180, 300]) {
    expect(sunBearing({ ...DEFAULT_SETTINGS, bearing, center: [9, 47] })).toBe(135);
    expect(sunBearing({ ...DEFAULT_SETTINGS, bearing, center: [18, -34] })).toBe(45);
  }
  const angle = sunBearing(DEFAULT_SETTINGS) * Math.PI / 180;
  expect(wall(30, 30, {}, [Math.sin(angle), Math.cos(angle)])).toHaveLength(0);
  expect(sunBearing({ ...DEFAULT_SETTINGS, autoSun: false, bearing: 300, sunAngle: 140 })).toBe(80);
});
