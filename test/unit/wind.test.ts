import { describe, expect, test } from 'vitest';
import type { Build } from '@/buildings';
import { Paper } from '@/raster';
import { Camera } from '@/camera';
import { planWind, windTurbines, type WindSite } from '@/landmarks';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { corners } from '@/shape';
import { STYLES } from '@/styles';
import type { Shape, Town } from '@/tiles';

const shape = (x: number, y: number, L: number, w: number): Shape => [{ pts: corners({ cx: x, cy: y, L, w, ux: 1, uy: 0 }), seam: new Uint8Array(4) }];
function setup(dx = 0, more: Partial<Settings> = {}, metre = 1.5) {
  const set = { ...structuredClone(DEFAULT_SETTINGS), solarpunk: true, depth: 'transform', scale: 4000, ...more } as Settings;
  const context: NonNullable<Town['windContext']> = { land: [{ cls: 'farmland', shape: shape(-dx, 0, 6000, 6000) }], obstacles: [], buildings: [], ways: [], streams: [] };
  const town = { windContext: context, buildings: [] } as unknown as Town;
  const B: Build = { set, cam: new Camera(set), style: STYLES.alpine, seed: set.seed, sun: [1, 0], equator: [0, -1], left: false,
    key: (x, y) => [Math.round((x + dx) * metre), Math.round(y * metre)], toAbs: (x, y) => [(x + dx) * metre, y * metre],
    cell: (x, y, size) => [Math.floor((x + dx) * metre / size), Math.floor(y * metre / size)], future: set.solarpunk ? { climate: 'temperate', gather: [] } : null };
  return { B, town, context };
}
const id = (p: WindSite, dx = 0) => [p.x + dx, p.y, p.phase].map((v) => Math.round(v * 1e6) / 1e6);
const core = (sites: WindSite[], dx = 0) => sites.filter((p) => Math.abs(p.x + dx) < 300 && Math.abs(p.y) < 300).map((p) => id(p, dx));

describe('map-fixed wind infrastructure', () => {
  test.each([1.5, 12])('has no sheet cap and keeps rotor separation at Mercator scale %s', (metre) => {
    const a = setup(0, {}, metre), sites = planWind(a.B, a.town);
    expect(sites.length).toBeGreaterThan(3);
    for (let i = 0; i < sites.length; i++) for (let j = 0; j < i; j++) expect(Math.hypot(sites[i].x - sites[j].x, sites[i].y - sites[j].y)).toBeGreaterThanOrEqual(100);
  });
  test.each([30, 47, 310])('the shared map keeps the same sites through a %s metre pan', (dx) => {
    const a = setup(), b = setup(dx);
    const expected = core(planWind(a.B, a.town));
    expect(expected.length).toBeGreaterThan(0);
    expect(core(planWind(b.B, b.town), dx)).toEqual(expected);
  });
  test('scale, bearing, source order and power-line context do not reroll the shared sites', () => {
    const a = setup(), b = setup(0, { scale: 8000, bearing: 145, power: false });
    b.context.land.push({ cls: 'industrial', shape: shape(2200, 2200, 100, 100) });
    b.context.land.reverse();
    expect(core(planWind(b.B, b.town))).toEqual(core(planWind(a.B, a.town)));
  });
  test('Visionary upgrades farm machines in place and retains industrial neighbourhood machines', () => {
    const a = setup(), b = setup(0, { depth: 'visionary' });
    const small = planWind(a.B, a.town), large = planWind(b.B, b.town);
    expect(large.map((p) => id(p))).toEqual(small.map((p) => id(p)));
    expect(large.some((p) => p.hub + p.blade === 72)).toBe(true);
    b.context.land[0].cls = 'industrial';
    expect(planWind(b.B, b.town).every((p) => p.hub + p.blade === 35)).toBe(true);
  });
  test.each(['building', 'water', 'road', 'rail', 'stream', 'hole', 'wetland'])('rejects a %s inside the complete clearance envelope', (kind) => {
    const a = setup(), site = planWind(a.B, a.town).find((p) => Math.abs(p.x) < 300 && Math.abs(p.y) < 300)!;
    expect(site).toBeDefined();
    const x = site.x + 9, y = site.y;
    if (kind === 'building') a.context.buildings.push(shape(x, y, 1, 1));
    if (kind === 'water') a.context.obstacles.push(shape(x, y, 1, 1));
    if (kind === 'hole') a.context.land[0].shape.push(...shape(x, y, 1, 1));
    if (kind === 'wetland') a.context.land.push({ cls: 'wetland', shape: shape(x, y, 1, 1) });
    if (kind === 'road' || kind === 'rail') a.context.ways.push({ pts: [x, y - 30, x, y + 30], kind: kind === 'rail' ? 'rail' : 'road', cls: 'service', width: 2, bridge: true });
    if (kind === 'stream') a.context.streams.push({ pts: [x, y - 30, x, y + 30], width: 1 });
    expect(planWind(a.B, a.town).some((p) => p.x === site.x && p.y === site.y)).toBe(false);
  });
  test('only explicit mapped meadows qualify; protected-area obstacles still exclude them', () => {
    const a = setup(); a.context.land[0].cls = 'meadow'; a.context.land[0].sub = 'meadow';
    expect(planWind(a.B, a.town).length).toBeGreaterThan(3);
    for (const sub of ['grassland', 'heath', 'fell', '']) {
      a.context.land[0].sub = sub; expect(planWind(a.B, a.town)).toEqual([]);
    }
    a.context.land[0].sub = 'meadow'; a.context.obstacles.push(shape(0, 0, 6000, 6000));
    expect(planWind(a.B, a.town)).toEqual([]);
  });
  test('unknown and non-productive land, Today, Retrofit and Ground-off have no sites', () => {
    for (const cls of ['wetland', 'meadow', 'residential', '']) {
      const a = setup(); a.context.land[0].cls = cls;
      expect(planWind(a.B, a.town)).toEqual([]);
    }
    for (const set of [{ solarpunk: false }, { depth: 'retrofit' as const }, { ground: false }]) {
      const a = setup(0, set); expect(planWind(a.B, a.town)).toEqual([]);
    }
  });
  test('the simplified shaft remains visible against its own depth faces', () => {
    const a = setup(), site = { ...planWind(a.B, a.town)[0], x: 0, y: 0 };
    const solid = windTurbines(a.B, [site]).solids[0], paper = new Paper(a.B.cam);
    for (const f of solid.faces) paper.fillFace(f);
    paper.finishDepth();
    for (const l of solid.lines) paper.line3(l.pen, l.pts, undefined, l.closed);
    paper.end();
    const longest = Math.max(...paper.pens.flat().map((p) => {
      let length = 0;
      for (let i = 2; i < p.length; i += 2) length += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      return length;
    }));
    expect(longest).toBeGreaterThan(a.B.cam.s * a.B.cam.ca * site.hub * 0.8);
  });
  test('LOD simplifies a machine without moving it, including a base outside the sheet', () => {
    const a = setup(), sites = planWind(a.B, a.town);
    const outside = sites.find((p) => a.B.cam.sy(p.x, p.y, 0) > a.B.cam.sheet[1]);
    expect(outside).toBeDefined();
    const solid = windTurbines(a.B, [outside!]).solids[0];
    expect(solid.faces.length).toBeGreaterThan(10);
    expect(solid.lines.length).toBeGreaterThanOrEqual(4);
    expect(solid.lines.every((l) => l.pts.every(Number.isFinite))).toBe(true);
    a.B.cam = new Camera({ ...a.B.set, scale: 20000 });
    expect(windTurbines(a.B, sites).solids).toEqual([]);
  });
});
