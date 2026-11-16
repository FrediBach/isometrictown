import { describe, expect, test } from 'vitest';
import type { Build } from '@/buildings';
import { Camera } from '@/camera';
import type { Info } from '@/classify';
import { fits, overlaps, planProduction, productiveGardens, solarWing } from '@/production';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { corners, type Rect } from '@/shape';
import { STYLES } from '@/styles';
import type { Building, Shape, Town } from '@/tiles';

const rect = (cx: number, cy: number, L: number, w: number): Rect => ({ cx, cy, L, w, ux: 1, uy: 0 });
const shape = (r: Rect): Shape => [{ pts: corners(r), seam: new Uint8Array(4) }];
function setup(dx = 0, more: Partial<Settings> = {}) {
  const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), solarpunk: true, depth: 'transform', ...more };
  const town: Town = { buildings: [], water: [], waterCls: [], green: [], wood: [], plazas: [], ways: [], pois: [], numbers: [], landuse: [], cover: [], streams: [], culverts: [], tagged: [], tunnels: [], lifts: [], ferries: [], pools: [], runways: [], aprons: [], peaks: [], helipads: [], airports: [], density: { built: [], shops: [] }, nearby: { landuse: [], pois: [], numbers: [], helipads: [], ways: [] } };
  const b: Building = { shape: shape(rect(-dx, 0, 12, 10)), h: 8, min: 0,
    info: { kind: 'house', roof: 'gabled', toStreet: [0, -1], party: new Float32Array(4) } as Info,
    future: { recipe: 'B01', roofPv: true, greenRoof: false, tank: true, eave: 8 } };
  town.buildings.push(b);
  town.nearby.landuse.push({ cls: 'residential', shape: shape(rect(-dx, 0, 120, 120)) });
  const B: Build = { set, cam: new Camera(set), style: STYLES.alpine, seed: set.seed, sun: [1, 0], equator: [0, -1], left: false,
    key: (x, y) => [Math.round(x + dx), Math.round(y)], toAbs: (x, y) => [x + dx, y], cell: (x, y, size) => [Math.floor((x + dx) / size), Math.floor(y / size)], future: { climate: 'temperate', gather: [] } };
  return { set, town, b, B };
}

describe('productive property geometry', () => {
  test('rejects a roof hole, a narrow crossing and a wholly enclosed obstacle', () => {
    const r = rect(0, 0, 10, 10);
    expect(fits(r, shape(rect(0, 0, 12, 12)))).toBe(true);
    expect(fits(r, [...shape(rect(0, 0, 12, 12)), ...shape(rect(1, 1, 1, 1))])).toBe(false);
    expect(overlaps(corners(r), corners(rect(0, 1, 20, 0.1)))).toBe(true);
    expect(overlaps(corners(r), corners(rect(1, 1, 1, 1)))).toBe(true);
    expect(overlaps(corners(r), corners(rect(20, 0, 1, 1)))).toBe(false);
    const concave = [{ pts: [-6, -6, 6, -6, 6, 6, 1, 6, 1, 0, -1, 0, -1, 6, -6, 6], seam: new Uint8Array(8) }];
    expect(fits(r, concave)).toBe(false);
  });
  test('reserves a full productive garden and a connected cistern', () => {
    const { town, set, b, B } = setup();
    expect(planProduction(town, set)).toMatchObject({ homes: 1, gardens: 1, cisterns: 1 });
    const p = b.future!.production!;
    expect(p.garden).toBeDefined();
    expect(overlaps(corners(p.garden!), b.shape[0].pts)).toBe(false);
    const solids = productiveGardens(B, town);
    expect(solids.length).toBe(1);
    expect(solids[0].faces.length).toBeGreaterThan(10);
    expect(solids[0].lines.every((l) => l.pts.every(Number.isFinite))).toBe(true);
  });
  test('unknown ground and a crossing path cannot become a garden', () => {
    const a = setup();
    a.town.nearby.landuse = [];
    expect(planProduction(a.town, a.set)).toMatchObject({ gardens: 0, cisterns: 0, unknown: 1 });
    const b = setup();
    b.town.nearby.ways.push({ pts: [-30, 13, 30, 13], kind: 'path', width: 2, cls: 'path' });
    planProduction(b.town, b.set);
    expect(b.b.future!.production!.garden).toBeUndefined();
    // A small cistern can still fit closer to the house, leaving the mapped path clear.
    expect(b.b.future!.production!.cistern).toBeDefined();
  });
  test('water, woods and buildings inside a proposed plot are excluded', () => {
    for (const obstacle of ['water', 'wood', 'buildings'] as const) {
      const { town, set, b } = setup();
      const ring = shape(rect(0, 15, 4, 4));
      if (obstacle === 'buildings') town.buildings.push({ shape: ring, h: 4, min: 0 });
      else town[obstacle].push(ring);
      planProduction(town, set);
      expect(b.future!.production!.garden).toBeUndefined();
    }
  });
  test('an off-sheet obstacle stays excluded through uncropped tile context', () => {
    const { town, set, b } = setup();
    town.productionContext = { shapes: [shape(rect(0, 15, 4, 4))], streams: [], runways: [] };
    planProduction(town, set);
    expect(b.future!.production!.garden).toBeUndefined();
    const before = structuredClone(b.future!.production);
    town.water.push(shape(rect(0, 15, 4, 4)));
    planProduction(town, set);
    expect(b.future!.production).toEqual(before);
  });
  test.each([30, 47, 310])('planning and drawing stay fixed across a %i metre pan', (dx) => {
    const a = setup(), b = setup(dx);
    planProduction(a.town, a.set); planProduction(b.town, b.set);
    const lines = (s: ReturnType<typeof setup>, shift: number) => productiveGardens(s.B, s.town).flatMap((v) => v.lines.map((l) => l.pts.map((n, i) => Math.round((n + (i % 3 === 0 ? shift : 0)) * 1000) / 1000)));
    expect(lines(a, 0).length).toBeGreaterThan(0);
    expect(lines(a, 0)).toEqual(lines(b, dx));
  });
  test('the physical package does not change with scale, bearing or input order', () => {
    const a = setup(), b = setup(0, { scale: 8000, bearing: 200, tilt: 50, detail: 2 });
    const neighbour = structuredClone(a.b);
    neighbour.shape = shape(rect(10, 0, 8, 10));
    a.town.buildings.push(structuredClone(neighbour)); b.town.buildings.unshift(structuredClone(neighbour));
    planProduction(a.town, a.set); planProduction(b.town, b.set);
    expect(a.b.future!.production).toEqual(b.b.future!.production);
    expect(a.town.buildings[1].future!.production).toEqual(b.town.buildings[0].future!.production);
  });
  test('opposing houses cannot claim the same productive garden', () => {
    const { town, set, b } = setup();
    const other = structuredClone(b);
    other.shape = shape(rect(0, 28, 12, 10));
    other.info!.toStreet = [0, 1];
    town.buildings.push(other);
    expect(planProduction(town, set)).toMatchObject({ gardens: 0, cisterns: 0, crowded: 2 });
    expect(b.future!.production!.garden).toBeUndefined();
    expect(other.future!.production!.garden).toBeUndefined();
  });
  test('Solarpunk, depth and Ground gates preserve the original mode', () => {
    for (const more of [{ solarpunk: false }, { depth: 'retrofit' as const }, { ground: false }]) {
      const { town, set, b, B } = setup(0, more);
      planProduction(town, set);
      expect(b.future?.production?.garden).toBeUndefined();
      expect(productiveGardens(B, town)).toEqual([]);
    }
  });
  test('roof wings have real supports, keep holes free and reserve the same footprint at every scale', () => {
    const { town, set, b, B } = setup();
    b.shape = shape(rect(0, 0, 30, 14)); b.info!.roof = 'flat';
    expect(planProduction(town, set).wings).toBe(1);
    const r = b.future!.production!.wing!;
    expect(fits(r, b.shape)).toBe(true);
    const out = { faces: [], lines: [], casts: [] } as Parameters<typeof solarWing>[3];
    solarWing(B, r, 8, out);
    expect(out.lines.some((l) => l.pts[2] === 8)).toBe(true);
    expect(out.faces.length).toBeGreaterThan(0);
    b.shape.push(...shape(rect(r.cx, r.cy, 1, 1)));
    expect(planProduction(town, set).wings).toBe(0);
  });
});
