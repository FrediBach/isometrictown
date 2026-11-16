import { describe, expect, test } from 'vitest';
import { newSolid, type Build } from '@/buildings';
import { Camera } from '@/camera';
import type { Info } from '@/classify';
import { growingFrame, planGrowingFrames } from '@/growing-frames';
import { Paper } from '@/raster';
import { overlaps } from '@/production';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { corners } from '@/shape';
import { STYLES } from '@/styles';
import type { Building, Shape, Town } from '@/tiles';

const shape = (x: number, y: number, L: number, w: number): Shape => [{ pts: corners({ cx: x, cy: y, L, w, ux: 1, uy: 0 }), seam: new Uint8Array(4) }];
function setup(dx = 0, more: Partial<Settings> = {}) {
  const set = { ...structuredClone(DEFAULT_SETTINGS), solarpunk: true, depth: 'transform' as const, ...more };
  const b: Building = { shape: shape(-dx, 0, 40, 14), h: 18, min: 0,
    info: { kind: 'apartment', roof: 'flat', party: new Float32Array(4), toStreet: [0, -1] } as Info,
    future: { recipe: 'B04', roofPv: true, greenRoof: false, tank: false } };
  const town = { buildings: [b], nearby: { ways: [] }, productionContext: { shapes: [], streams: [], runways: [] } } as unknown as Town;
  const B: Build = { set, cam: new Camera(set), style: STYLES.alpine, future: { climate: 'temperate', gather: [] }, seed: set.seed, left: false, sun: [1, 0], equator: [0, -1], key: (x, y) => [Math.round(x + dx), Math.round(y)], toAbs: (x, y) => [x + dx, y], cell: (x, y, n) => [Math.floor((x + dx) / n), Math.floor(y / n)] };
  return { set, b, town, B };
}

describe('productive apartment frames', () => {
  test('reserves two deep galleries without overlapping the host', () => {
    const { b, town, set } = setup();
    Object.assign(b.future!, { addition: 'frame', side: 0, side2: 2 });
    planGrowingFrames(town, set);
    expect(b.future!.growingFrames).toHaveLength(2);
    expect(b.future!.addition).toBe('frame');
    for (const r of b.future!.growingFrames!) {
      expect(r.w).toBe(5);
      // The inner edge attaches to the wall; the interior stays outside it.
      const inset = { ...r, w: 4.8 };
      expect(overlaps(corners(inset), b.shape[0].pts)).toBe(false);
    }
  });
  test('full context catches paths, water, enclosed obstacles and off-sheet neighbours', () => {
    for (const kind of ['path', 'stream', 'water', 'neighbour', 'old-frame']) {
      const { b, town, set } = setup();
      if (kind === 'path') town.nearby.ways.push({ pts: [-30, 10, 30, 10], kind: 'path', cls: 'footway', width: 1 });
      if (kind === 'stream') town.productionContext!.streams.push({ pts: [-30, 10, 30, 10], width: 1 });
      if (kind === 'water') town.productionContext!.shapes.push(shape(0, 10, 0.2, 0.2));
      if (kind === 'neighbour') town.buildings.push({ shape: shape(0, 10, 1, 1), h: 9, min: 0, context: true });
      if (kind === 'old-frame') town.buildings.push({ shape: shape(0, 16.5, 20, 2), h: 9, min: 0, context: true, future: { recipe: 'B04', roofPv: false, greenRoof: false, tank: false, addition: 'frame', side: 0 } });
      planGrowingFrames(town, set);
      expect(b.future!.growingFrames).toHaveLength(1);
      expect(b.future!.growingFrames![0].cy).toBeLessThan(0);
    }
  });
  test('competing frames both decline regardless of source order', () => {
    for (const reverse of [false, true]) {
      const { b, town, set } = setup();
      const other = structuredClone(b); other.shape = shape(0, 23, 40, 14); other.context = true;
      town.buildings.push(other); if (reverse) town.buildings.reverse();
      planGrowingFrames(town, set);
      expect(b.future!.growingFrames).toBeUndefined();
      expect(other.future!.growingFrames).toBeUndefined();
    }
  });
  test('plans stay fixed under pan, projection, detail and ground visibility', () => {
    const a = setup(); planGrowingFrames(a.town, a.set);
    for (const dx of [30, 47, 310]) {
      const b = setup(dx, { scale: 8000, bearing: 180, detail: 0.4, ground: false }); planGrowingFrames(b.town, b.set);
      const rs = b.b.future!.growingFrames!;
      expect(rs.length).toBe(a.b.future!.growingFrames!.length);
      rs.forEach((r, i) => {
        expect(r.cx + dx).toBeCloseTo(a.b.future!.growingFrames![i].cx, 8);
        expect(r.cy).toBeCloseTo(a.b.future!.growingFrames![i].cy, 8);
        expect(r.L).toBe(a.b.future!.growingFrames![i].L);
      });
    }
  });
  test('Today, Retrofit, raised buildings and cut or party walls do not acquire galleries', () => {
    for (const more of [{ solarpunk: false }, { depth: 'retrofit' as const }]) {
      const a = setup(0, more); planGrowingFrames(a.town, a.set); expect(a.b.future!.growingFrames).toBeUndefined();
    }
    for (const kind of ['raised', 'seam', 'party']) {
      const a = setup();
      if (kind === 'raised') a.b.min = 3;
      if (kind === 'seam') a.b.shape[0].seam[0] = 1;
      if (kind === 'party') a.b.info!.party.fill(20);
      planGrowingFrames(a.town, a.set); expect(a.b.future!.growingFrames).toBeUndefined();
    }
  });
  test('greenhouse faces hide the host windows and hot climates keep open bays', () => {
    const a = setup(); planGrowingFrames(a.town, a.set);
    a.B.cam = new Camera({ ...a.set, scale: 1000, bearing: 0, tilt: 5 });
    const r = a.b.future!.growingFrames!.find(r => r.cy < 0)!, closed = newSolid(), open = newSolid();
    growingFrame(a.B, r, 18, closed);
    a.B.future!.climate = 'hot_humid'; growingFrame(a.B, r, 18, open);
    expect(closed.faces.length).toBeGreaterThan(open.faces.length);
    const u = -r.L / 2 + 1.5 * r.L / Math.round(r.L / 7);
    for (const [s, visible] of [[closed, false], [open, true]] as const) {
      const paper = new Paper(a.B.cam);
      for (const face of s.faces) paper.fillFace(face);
      paper.finishDepth();
      const x = r.cx + u, y = r.cy, z = a.B.style.floor + 1;
      expect(paper.seen(a.B.cam.sx(x, y), a.B.cam.sy(x, y, z), a.B.cam.depth(x, y, z))).toBe(visible);
    }
    for (const s of [closed, open]) {
      expect(s.lines.every(l => l.pts.every(Number.isFinite))).toBe(true);
      expect(s.lines.some(l => l.pts.some((v, i) => i % 3 === 2 && v === 0))).toBe(true);
      expect(s.shade).toHaveLength(1);
      for (const f of s.faces) for (const p of f) for (let i = 0; i < p.length; i += 3) {
        expect(Math.abs((p[i] - r.cx) * r.ux + (p[i + 1] - r.cy) * r.uy)).toBeLessThanOrEqual(r.L / 2 + 1e-6);
        expect(Math.abs(-(p[i] - r.cx) * r.uy + (p[i + 1] - r.cy) * r.ux)).toBeLessThanOrEqual(r.w / 2 + 1e-6);
      }
    }
  });
});
