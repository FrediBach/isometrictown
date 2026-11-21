import { describe, expect, test } from 'vitest';
import { Camera } from '@/camera';
import { Frame, latOf, lngOf, mercX, mercY, pointInRing, ringArea, ringTest } from '@/geo';
import { hash, sequence } from '@/rng';
import { DEFAULT_SETTINGS } from '@/settings';
import { bestRect, corners, offsetRing, turn } from '@/shape';

describe('rng', () => {
  test('hash is pinned: every made-up thing in every drawing depends on these values', () => {
    expect([hash(), hash(0), hash(1), hash(1, 2), hash(2, 1), hash(-5, 123456, 1, 9100)]).toMatchInlineSnapshot(`
      [
        0.5043428998906165,
        0.24960504355840385,
        0.6064289838541299,
        0.49677479756064713,
        0.48204909660853446,
        0.26416704221628606,
      ]
    `);
  });

  test('hash stays in [0, 1) and spreads evenly', () => {
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 20000; i++) {
      const h = hash(i, i * 7, 1, 42);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      bins[Math.floor(h * 10)]++;
    }
    for (const b of bins) expect(Math.abs(b - 2000)).toBeLessThan(200);
  });

  test('every argument and the salt matter', () => {
    expect(hash(1, 2, 3, 4)).not.toBe(hash(1, 2, 3, 5));
    expect(hash(1, 2, 3, 4)).not.toBe(hash(2, 1, 3, 4));
  });

  test('sequence repeats for a seed and differs between seeds', () => {
    const a = sequence(7);
    const b = sequence(7);
    const c = sequence(8);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
});

describe('geo', () => {
  test('Mercator round trips', () => {
    for (const [lng, lat] of [[9.0744, 47.0934], [-73.984, 40.7549], [151.2, -33.86], [0, 0]]) {
      expect(lngOf(mercX(lng))).toBeCloseTo(lng, 9);
      expect(latOf(mercY(lat))).toBeCloseTo(lat, 9);
    }
  });

  test('Frame measures true metres near its centre', () => {
    const f = new Frame([9.0744, 47.0934]);
    const [lng, lat] = f.toLngLat(0, 1000);
    // One kilometre north is about 0.009° of latitude.
    expect(lat - 47.0934).toBeCloseTo(1000 / 111_195, 4);
    expect(lng).toBeCloseTo(9.0744, 9);
    const [x, y] = [f.x(mercX(9.08)), f.y(mercY(47.1))];
    const back = f.toLngLat(x, y);
    expect(back[0]).toBeCloseTo(9.08, 9);
    expect(back[1]).toBeCloseTo(47.1, 9);
  });

  test('ringArea is positive counter-clockwise', () => {
    const ccw = [0, 0, 10, 0, 10, 5, 0, 5];
    expect(ringArea(ccw)).toBe(50);
    expect(ringArea([0, 0, 0, 5, 10, 5, 10, 0])).toBe(-50);
  });

  test('pointInRing', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(pointInRing(5, 5, sq)).toBe(true);
    expect(pointInRing(15, 5, sq)).toBe(false);
    expect(pointInRing(-1, -1, sq)).toBe(false);
  });

  test('indexed containment agrees at vertices, horizontal edges and across bands of a concave ring', () => {
    const p = [-24, -16, 24, -16];
    for (let x = 24; x >= -24; x -= 3) p.push(x, 16, x - 1, 16, x - 1, 0);
    const contains = ringTest(p, -16, 16);
    for (let y = -17; y <= 17; y += 0.5)
      for (let x = -26; x <= 25; x++) expect(contains(x, y)).toBe(pointInRing(x, y, p));
  });
});

describe('shape', () => {
  test('bestRect fits a rotated rectangle exactly', () => {
    const a = 0.4;
    const r = { cx: 3, cy: -2, ux: Math.cos(a), uy: Math.sin(a), L: 20, w: 8 };
    const { rect, fill } = bestRect(corners(r));
    expect(fill).toBeCloseTo(1, 9);
    expect(rect!.L).toBeCloseTo(20, 9);
    expect(rect!.w).toBeCloseTo(8, 9);
    expect(rect!.cx).toBeCloseTo(3, 9);
    expect(rect!.cy).toBeCloseTo(-2, 9);
  });

  test('bestRect of an L shape fills less', () => {
    const { fill } = bestRect([0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10]);
    expect(fill).toBeCloseTo(64 / 100, 9);
  });

  test('corners are counter-clockwise and turn keeps the area', () => {
    const r = { cx: 0, cy: 0, ux: 1, uy: 0, L: 6, w: 2 };
    expect(ringArea(corners(r))).toBeCloseTo(12, 9);
    const t = turn(r);
    expect([t.L, t.w]).toEqual([2, 6]);
    expect(ringArea(corners(t))).toBeCloseTo(12, 9);
  });

  test('offsetRing insets a square and refuses to fold one', () => {
    const sq = [0, 0, 10, 0, 10, 10, 0, 10];
    const inner = offsetRing(sq, () => 1)!;
    expect(ringArea(inner)).toBeCloseTo(64, 9);
    expect(inner.slice(0, 2).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 1]);
    expect(offsetRing(sq, () => 6)).toBeNull();
  });
});

describe('camera', () => {
  const cam = new Camera(DEFAULT_SETTINGS);

  test('scale: 1:1000 is one millimetre per metre', () => {
    expect(cam.s).toBe(1);
    expect(new Camera({ ...DEFAULT_SETTINGS, scale: 4000 }).s).toBe(0.25);
  });

  test('the drawing area sits inside the sheet, with a deeper foot for map notes', () => {
    const [x0, y0, x1, y1] = cam.rect;
    expect(cam.sheet).toEqual([420, 297]);
    expect(x0).toBe(20);
    expect(y0).toBe(20);
    expect(x1).toBe(400);
    expect(297 - y1).toBeGreaterThan(20);
    expect(new Camera({ ...DEFAULT_SETTINGS, marginalia: false }).rect[3]).toBe(277);
  });

  test('ground() inverts the projection at z = 0', () => {
    for (const [x, y] of [[0, 0], [120, -40], [-300, 250]]) {
      const [gx, gy] = cam.ground(cam.sx(x, y), cam.sy(x, y, 0));
      expect(gx).toBeCloseTo(x, 9);
      expect(gy).toBeCloseTo(y, 9);
    }
  });

  test('sheet y points down: height lifts a point up the sheet, and further away is deeper', () => {
    expect(cam.sy(0, 0, 10)).toBeLessThan(cam.sy(0, 0, 0));
    const [ux, uy] = cam.up;
    expect(cam.sy(ux * 10, uy * 10, 0)).toBeLessThan(cam.sy(0, 0, 0));
    expect(cam.depth(ux * 10, uy * 10, 0)).toBeGreaterThan(cam.depth(0, 0, 0));
    expect(cam.depth(0, 0, 10)).toBeLessThan(cam.depth(0, 0, 0));
  });

  test('the centre of the drawing area looks at the place', () => {
    const [x0, y0, x1, y1] = cam.rect;
    const [gx, gy] = cam.ground((x0 + x1) / 2, (y0 + y1) / 2);
    expect(Math.hypot(gx, gy)).toBeLessThan(1e-9);
  });

  test('region() covers the footprint, and more for tall buildings', () => {
    const box = cam.region(0);
    for (const [x, y] of cam.footprint()) {
      expect(x).toBeGreaterThanOrEqual(box[0]);
      expect(x).toBeLessThanOrEqual(box[2]);
      expect(y).toBeGreaterThanOrEqual(box[1]);
      expect(y).toBeLessThanOrEqual(box[3]);
    }
    const tall = cam.region(300);
    expect((tall[2] - tall[0]) * (tall[3] - tall[1])).toBeGreaterThan((box[2] - box[0]) * (box[3] - box[1]));
  });

  test('Detail and pen width move level of detail, not the scale', () => {
    const fine = new Camera({ ...DEFAULT_SETTINGS, detail: 2 });
    const broad = new Camera({ ...DEFAULT_SETTINGS, penWidth: 0.7 });
    expect(fine.s).toBe(cam.s);
    expect(fine.lod).toBeCloseTo(cam.lod * 2, 12);
    expect(broad.lod).toBeCloseTo(cam.lod / 2, 12);
    expect(fine.gap(1)).toBeCloseTo(0.5, 12);
    expect(broad.gap(1)).toBeCloseTo(2, 12);
    expect(fine.tone(1)).toBeCloseTo(1, 12);
    expect(broad.tone(1)).toBeCloseTo(2, 12);
  });

  test('within() switches a layer to its own Detail and always puts it back', () => {
    const c = new Camera({ ...DEFAULT_SETTINGS, customLayerDetail: true, layerDetail: { trees: 2 } });
    const lod = c.lod;
    expect(c.within('trees', () => c.detail)).toBe(2);
    expect(c.within('windows', () => c.detail)).toBe(1);
    expect(() => c.within('trees', () => { throw new Error('boom'); })).toThrow('boom');
    expect(c.lod).toBe(lod);
    expect(c.detail).toBe(1);
  });
});
