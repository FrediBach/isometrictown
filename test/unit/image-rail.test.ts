import { expect, test } from 'vitest';
import { Camera } from '@/camera';
import { Occupancy } from '@/image-blocks';
import { Footprints, Ground, Index } from '@/image-check';
import { railApproach, trackBed } from '@/image-rail-route';
import { villageRailway } from '@/image-rail';
import { readImage } from '@/image-read';
import { LABELS } from '@/image-tone';
import { DEFAULT_SETTINGS } from '@/settings';
import { empty, type Way } from '@/tiles';
import { PICTURES } from '../support/pictures';

const set = { ...DEFAULT_SETTINGS, source: 'image' as const, scale: 2500, bearing: 0, tilt: 40 };
const cam = new Camera(set);
const road: Way = { pts: [-25, 0, 25, 0], kind: 'road', cls: 'minor', width: 6 };
const crossing: Way = { ...road, pts: [-100, -140, 100, -140] };

function village(other: Way, transparent = false, valley = false) {
  const town = empty();
  town.ways.push(road, other);
  const bank = valley ? 1200 : 200;
  town.water.push([{ pts: [-bank, 42, bank, 42, bank, 65, -bank, 65], seam: new Uint8Array(4) }]);
  if (valley) town.water.push([{ pts: [-1200, -105, 1200, -105, 1200, -83, -1200, -83], seam: new Uint8Array(4) }]);
  const W = 100, H = 100, cell = 20, label = new Uint8Array(W * H).fill(LABELS.indexOf('meadow'));
  for (let i = 48; i <= 51; i++) label[50 * W + i] = LABELS.indexOf('rows');
  const z = { x0: -1000, y0: -1000, W, H, cell, label, level: new Float32Array(W * H), warmth: new Float32Array(W * H), sp: new Int32Array(W * H) };
  const target = readImage(PICTURES.gradient(), set, cam.rect);
  if (transparent) target.weight.fill(0);
  const occ = new Occupancy(-1000, -1000, 2, 2000, 2000);
  villageRailway(town, [[0, 0]], z, cam, target, occ, [], () => 0);
  return town;
}

test('a routed railway keeps a straight platform and a walk from the street to the station', () => {
  const town = village(crossing);
  expect(town.ways.slice(0, 2)).toEqual([road, crossing]);
  const [, , rail, platform, walk, door] = town.ways;
  expect(rail.kind).toBe('rail');
  const p = rail.pts;
  expect(p.length).toBeGreaterThan(8);
  const sx = cam.sx(p.at(-2)!, p.at(-1)!), sy = cam.sy(p.at(-2)!, p.at(-1)!, 0);
  expect(sx < cam.rect[0] || sx > cam.rect[2] || sy < cam.rect[1] || sy > cam.rect[3]).toBe(true);
  expect(platform.sub).toBe('platform');
  expect(walk.pts[1]).toBeCloseTo(0);
  const [ax, ay, bx, by] = platform.pts, len = Math.hypot(bx - ax, by - ay);
  for (const pt of [walk.pts.slice(2), door.pts.slice(0, 2)]) {
    expect(((pt[0] - ax) * (by - ay) - (pt[1] - ay) * (bx - ax)) / len).toBeCloseTo(0);
    expect(Math.hypot(pt[0] - ax, pt[1] - ay)).toBeLessThanOrEqual(len + 0.01);
  }
  expect(town.tagged.map(t => t.building)).toEqual(['train_station']);
  expect(town.pois.map(p => p.sub)).toEqual(['station']);
  expect(new Ground(town).under((p[2] + p[4]) / 2, (p[3] + p[5]) / 2)).toBe('a railway');
  expect(village(crossing)).toEqual(town);
  expect(village(crossing, true).ways).toHaveLength(2);
});

test('a narrow valley can carry a through railway along the village street with the platform on the straight', () => {
  const town = village(crossing, false, true);
  const rail = town.ways.find(w => w.kind === 'rail')!;
  const platform = town.ways.find(w => w.sub === 'platform')!;
  const p = rail.pts, [ax, ay, bx, by] = platform.pts;
  expect(ay).toBeCloseTo(by);
  const exits = [cam.sx(p[0], p[1]), cam.sx(p.at(-2)!, p.at(-1)!)];
  expect(Math.min(...exits)).toBeLessThan(cam.rect[0]);
  expect(Math.max(...exits)).toBeGreaterThan(cam.rect[2]);
  const mx = (ax + bx) / 2;
  expect(p.some((x, i) => i % 2 === 0 && i >= 2 && (x - mx) * (p[i - 2] - mx) <= 0 &&
    Math.abs(p[i + 1] - p[i - 1]) < 0.01 && Math.abs(Math.abs(p[i + 1] - ay) - 4.3) < 0.01)).toBe(true);
});

test('a blocked straight alignment finds a broad curve around the obstruction and keeps the entire track bed clear', () => {
  const W = 200, H = 200;
  const z = { x0: -2000, y0: -2000, W, H, cell: 20, label: new Uint8Array(W * H).fill(LABELS.indexOf('meadow')), level: new Float32Array(W * H), warmth: new Float32Array(W * H), sp: new Int32Array(W * H) };
  const target = readImage(PICTURES.gradient(), set, cam.rect);
  target.coherence.fill(0);
  const obstacles = new Footprints(), ways = new Index();
  const open = { z, cam, target, obstacles, ways, segments: [] };
  // The same station tangent can serve two different destinations across open ground.
  const north = railApproach(open, 0, 0, 0, 0.65)!;
  const south = railApproach(open, 0, 0, 0, -0.65)!;
  expect(north.at(-1)!).toBeGreaterThan(100);
  expect(south.at(-1)!).toBeLessThan(-100);
  obstacles.add([150, -32, 165, -32, 165, 32, 150, 32]);
  const route = railApproach(open, 0, 0, 0, 0)!;
  expect(route).not.toBeNull();
  expect(obstacles.touches(trackBed(route))).toBe(false);
  expect(route.some((v, i) => i % 2 === 1 && Math.abs(v) > 35)).toBe(true);
  let heading = 0;
  for (let i = 2; i < route.length; i += 2) {
    const dx = route[i] - route[i - 2], dy = route[i + 1] - route[i - 1];
    const next = Math.atan2(dy, dx);
    expect(Math.abs(next - heading) / Math.hypot(dx, dy)).toBeLessThan(1 / 130);
    heading = next;
  }
  expect(railApproach(open, 0, 0, 0, 0)).toEqual(route);
  // There is no at-grade route through a continuous bridge across the entire approach.
  const bridge = { ...road, bridge: true, pts: [98, -1500, 98, 1500] };
  ways.add(0, bridge.pts, 8);
  expect(railApproach({ ...open, segments: [{ w: bridge, k: 2 }] }, 0, 0, 0, 0)).toBeNull();
});
