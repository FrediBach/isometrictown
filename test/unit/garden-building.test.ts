import { describe, expect, test } from 'vitest';
import { newSolid, type Build } from '@/buildings';
import { Camera } from '@/camera';
import type { Info } from '@/classify';
import { planFuture } from '@/future';
import { gardenCrown, planGardenCrown } from '@/garden-building';
import { Paper } from '@/raster';
import { fits, planProduction } from '@/production';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { corners } from '@/shape';
import { STYLES } from '@/styles';
import type { Building, Town } from '@/tiles';

function setup(dx = 0, more: Partial<Settings> = {}) {
  const set = { ...structuredClone(DEFAULT_SETTINGS), solarpunk: true, depth: 'visionary' as const, ...more };
  const b: Building = { shape: [{ pts: corners({ cx: -dx, cy: 0, L: 60, w: 40, ux: 1, uy: 0 }), seam: new Uint8Array(4) }], h: 20, min: 0,
    info: { kind: 'apartment', roof: 'flat', seed: [0, 0], party: new Float32Array(4), facade: { pattern: 'grid' } } as Info };
  const town = { buildings: [b], water: [], ways: [], productionContext: { shapes: [], streams: [], runways: [] }, nearby: { ways: [], landuse: [] } } as unknown as Town;
  const key = (x: number, y: number): [number, number] => [Math.round(x + dx), Math.round(y)];
  const cell = (x: number, y: number, n: number): [number, number] => [Math.floor((x + dx) / n), Math.floor(y / n)];
  const future = set.solarpunk ? planFuture(town, set, 'alpine', key, cell) : null;
  const B: Build = { set, cam: new Camera(set), seed: set.seed, style: STYLES.alpine, key, cell, toAbs: (x, y) => [x + dx, y], sun: [1, 0], equator: [0, -1], left: false, future };
  return { b, town, set, B };
}

describe('stepped rooftop farms', () => {
  test('terraces and solar overhang stay wholly supported and replace other roof compositions', () => {
    const { b } = setup(), plan = b.future!.gardenCrown!;
    expect(plan.levels).toHaveLength(3);
    expect(b.future!.pavilion).toBeUndefined();
    let deck = plan.deck;
    for (const room of plan.levels) {
      expect(deck.w - room.w).toBe(8);
      expect(fits(room, b.shape)).toBe(true);
      expect(fits({ ...room, L: room.L + 2, w: room.w + 2 }, [{ pts: corners(deck), seam: new Uint8Array(4) }])).toBe(true);
      deck = room;
    }
  });
  test('rejects holes, cut footprints, narrow roofs and unsuitable heights', () => {
    for (const kind of ['hole', 'seam', 'narrow', 'low', 'high', 'raised']) {
      const { b } = setup();
      if (kind === 'hole') b.shape.push({ pts: [-1, -1, 1, -1, 1, 1, -1, 1], seam: new Uint8Array(4) });
      if (kind === 'seam') b.shape[0].seam[0] = 1;
      if (kind === 'narrow') b.shape[0].pts = [-20, -8, 20, -8, 20, 8, -20, 8];
      if (kind === 'low') b.h = 8;
      if (kind === 'high') b.h = 61;
      if (kind === 'raised') b.min = 3;
      expect(planGardenCrown(b)).toBeUndefined();
    }
  });
  test('plan is independent of pan, projection and detail; earlier depths keep their roofs', () => {
    const original = setup().b.future!.gardenCrown!;
    for (const dx of [30, 47, 310]) {
      const { b } = setup(dx, { scale: 8000, bearing: 180, detail: 0.5 });
      const p = b.future!.gardenCrown!;
      expect({ ...p.deck, cx: p.deck.cx + dx }).toEqual(original.deck);
      expect(p.levels.map(r => ({ ...r, cx: r.cx + dx }))).toEqual(original.levels);
    }
    for (const more of [{ solarpunk: false }, { depth: 'retrofit' as const }, { depth: 'transform' as const }]) expect(setup(0, more).b.future?.gardenCrown).toBeUndefined();
  });
  test('finite, bounded geometry retains the stepped silhouette at distant scale', () => {
    for (const scale of [1000, 4000, 8000]) {
      const { B, b } = setup(0, { scale });
      const s = newSolid();
      gardenCrown(B, b.future!.gardenCrown!, 20, s);
      expect(s.faces.length).toBeGreaterThan(20);
      expect(s.lines.every(l => l.pts.every(Number.isFinite))).toBe(true);
      const heights = s.faces.flat(2).filter((_, i) => i % 3 === 2);
      expect(Math.max(...heights)).toBeGreaterThan(32);
      expect(Math.max(...heights)).toBeLessThan(35);
      expect(s.lines.some(l => l.facet === 'terrace-food')).toBe(true);
    }
  });
  test('greenhouse volumes hide their interiors while stepped terrace routes stay open', () => {
    const { B, b } = setup(0, { scale: 1000, tilt: 90 });
    const s = newSolid(), paper = new Paper(B.cam);
    gardenCrown(B, b.future!.gardenCrown!, 20, s);
    for (const face of s.faces) paper.fillFace(face);
    paper.finishDepth();
    const visible = (y: number, z: number) => paper.seen(B.cam.sx(0, y), B.cam.sy(0, y, z), B.cam.depth(0, y, z));
    expect(visible(0, 20)).toBe(false);
    expect(visible(16, 20)).toBe(true);
    expect(visible(12, 23.8)).toBe(true);
  });
  test('coordinated roof farms exclude solar wings and wind equipment', () => {
    const { town, set, b } = setup();
    planProduction(town, set);
    expect(b.future!.production?.wing).toBeUndefined();
    expect(b.future!.production?.wind).toBeUndefined();
  });
});
