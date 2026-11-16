import { describe, expect, test } from 'vitest';
import type { Build } from '@/buildings';
import { Paper } from '@/raster';
import { Camera } from '@/camera';
import { planPublicEnergy, publicEnergy, underPublicRoof } from '@/public-energy';
import { fits, overlaps } from '@/production';
import { hash } from '@/rng';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { corners } from '@/shape';
import { STYLES } from '@/styles';
import type { Shape, Town } from '@/tiles';

const shape = (x: number, y: number, L: number, w: number): Shape => [{ pts: corners({ cx: x, cy: y, L, w, ux: 1, uy: 0 }), seam: new Uint8Array(4) }];
function setup(dx = 0, more: Partial<Settings> = {}) {
  const set = { ...structuredClone(DEFAULT_SETTINGS), solarpunk: true, depth: 'visionary', scale: 1000, ...more } as Settings;
  while (hash(0, 0, set.seed, 12400) >= 0.8) set.seed++;
  const context: NonNullable<Town['publicContext']> = { squares: [shape(-dx, 0, 110, 50)], obstacles: [], buildings: [], ways: [], streams: [] };
  const town = { publicContext: context } as Town;
  const B: Build = { set, cam: new Camera(set), style: STYLES.alpine, seed: set.seed, sun: [1, 0], equator: [0, -1], left: false,
    key: (x, y) => [Math.round(x + dx), Math.round(y)], toAbs: (x, y) => [x + dx, y],
    cell: (x, y, size) => [Math.floor((x + dx) / size), Math.floor(y / size)], future: set.solarpunk ? { climate: 'temperate', gather: [] } : null };
  return { B, town, context };
}

describe('connected public energy roofs', () => {
  test('Visionary links five bays across 96 m; Transform retains a branching canopy', () => {
    const a = setup(), plans = planPublicEnergy(a.B, a.town);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ kind: 'arcade', bays: 5, envelope: { L: 96, w: 32 } });
    expect(plans[0].posts).toHaveLength(10);
    expect(fits(plans[0].envelope, a.context.squares[0])).toBe(true);
    const s = publicEnergy(a.B, plans)[0];
    expect(s.shade).toHaveLength(10);
    expect(s.lines.every((l) => l.pts.every(Number.isFinite))).toBe(true);
    expect(Math.max(...s.lines.flatMap((l) => l.pts.filter((_, i) => i % 3 === 2)))).toBe(15.5);
    a.B.set.depth = 'transform';
    expect(planPublicEnergy(a.B, a.town)[0]).toMatchObject({ kind: 'tree', envelope: { L: 40, w: 40 } });
  });
  test('the roof depth leaves the central skylight open while panels hide the ground below', () => {
    const a = setup(0, { tilt: 90 }), plan = planPublicEnergy(a.B, a.town)[0], paper = new Paper(a.B.cam);
    for (const s of publicEnergy(a.B, [plan])) for (const f of s.faces) paper.fillFace(f);
    paper.finishDepth();
    const x = -plan.envelope.L / 2 + plan.envelope.L / plan.bays / 2;
    const visible = (y: number) => paper.seen(a.B.cam.sx(x, y), a.B.cam.sy(x, y, 0), a.B.cam.depth(x, y, 0));
    expect(visible(0)).toBe(true);
    expect(visible(6)).toBe(false);
  });
  test('a path can pass beneath the roof, but none can pass through a column', () => {
    const a = setup(); a.context.ways.push({ pts: [-70, 0, 70, 0], kind: 'path', cls: 'pedestrian', width: 4 });
    const plans = planPublicEnergy(a.B, a.town);
    expect(plans[0].kind).toBe('arcade');
    expect(plans[0].posts.every((p) => !overlaps(corners(p), shape(0, 0, 140, 6)[0].pts))).toBe(true);
    const post = plans[0].posts[0];
    a.context.ways.push({ pts: [post.cx - 2, post.cy, post.cx + 2, post.cy], kind: 'path', cls: 'footway', width: 2 });
    const blocked = shape(post.cx, post.cy, 8, 6)[0].pts;
    expect(planPublicEnergy(a.B, a.town).every((r) => r.posts.every((p) => !overlaps(corners(p), blocked)))).toBe(true);
  });
  test.each(['building', 'water', 'road', 'rail', 'bridge', 'stream', 'hole'])('a %s inside the roof envelope rejects it', (obstacle) => {
    const a = setup(), tiny = shape(2, 2, 1, 1);
    if (obstacle === 'building') a.context.buildings.push(tiny);
    if (obstacle === 'water') a.context.obstacles.push(tiny);
    if (obstacle === 'hole') a.context.squares[0].push(...tiny);
    if (['road', 'rail', 'bridge'].includes(obstacle)) a.context.ways.push({ pts: [-70, 0, 70, 0], width: 2, kind: obstacle === 'rail' ? 'rail' : obstacle === 'bridge' ? 'path' : 'road', cls: 'service', bridge: obstacle === 'bridge' });
    if (obstacle === 'stream') a.context.streams.push({ pts: [-70, 0, 70, 0], width: 2 });
    const roofs = planPublicEnergy(a.B, a.town);
    if (['building', 'water', 'hole'].includes(obstacle)) expect(roofs.every((r) => !overlaps(corners(r.envelope), tiny[0].pts))).toBe(true);
    else expect(roofs.every((r) => !overlaps(corners(r.envelope), shape(0, 0, 140, 4)[0].pts))).toBe(true);
  });
  test.each([30, 47, 310])('plans and linework stay fixed through a %s metre pan', (dx) => {
    const a = setup(), b = setup(dx);
    const lines = (s: ReturnType<typeof setup>, shift: number) => publicEnergy(s.B, planPublicEnergy(s.B, s.town)).flatMap((p) => p.lines.map((l) => l.pts.map((v, i) => Math.round((v + (i % 3 === 0 ? shift : 0)) * 1000) / 1000)));
    expect(lines(b, dx)).toEqual(lines(a, 0));
  });
  test('scale and bearing do not choose another footprint or move columns', () => {
    const a = setup(), b = setup(0, { scale: 8000, bearing: 140, trees: 0, life: false });
    expect(planPublicEnergy(b.B, b.town)).toEqual(planPublicEnergy(a.B, a.town));
    const plans = planPublicEnergy(a.B, a.town);
    expect(underPublicRoof(plans, 0, 0)).toBe(true);
    expect(underPublicRoof(plans, 60, 0)).toBe(false);
    expect(underPublicRoof(plans, 49, 0, 2)).toBe(true);
  });
  test('finds an interior square when connecting streets leave the bounding centre outside', () => {
    const a = setup();
    a.context.squares = [[{ pts: [-60, -40, 60, -40, 60, -10, -10, -10, -10, 40, -60, 40], seam: new Uint8Array(6) }]];
    const roofs = planPublicEnergy(a.B, a.town);
    expect(roofs).toHaveLength(1);
    expect(fits(roofs[0].envelope, a.context.squares[0])).toBe(true);
    expect(Math.hypot(roofs[0].envelope.cx, roofs[0].envelope.cy)).toBeGreaterThan(0);
  });
  test('duplicates are harmless and overlapping proposals decline independently of order', () => {
    const a = setup(); a.context.squares.push(structuredClone(a.context.squares[0]));
    const before = planPublicEnergy(a.B, a.town);
    expect(before).toHaveLength(1);
    const p = a.context.squares[0][0].pts;
    a.context.squares[0][0].pts = Array.from({ length: p.length / 2 }, (_, i) => p.slice(p.length - 2 - i * 2, p.length - i * 2)).flat();
    expect(planPublicEnergy(a.B, a.town)).toEqual(before);
    a.context.squares.push(shape(1, 0, 110, 50));
    while (hash(1, 0, a.B.set.seed, 12400) >= 0.8 || hash(0, 0, a.B.set.seed, 12400) >= 0.8) a.B.set.seed++;
    expect(planPublicEnergy(a.B, a.town)).toEqual([]);
    a.context.squares.reverse(); expect(planPublicEnergy(a.B, a.town)).toEqual([]);
  });
  test('generic plazas, Today and Retrofit do not acquire roofs', () => {
    for (const set of [{ solarpunk: false }, { depth: 'retrofit' as const }]) { const a = setup(0, set); expect(planPublicEnergy(a.B, a.town)).toEqual([]); }
    const a = setup(); a.town.publicContext = undefined;
    Object.assign(a.town, { plazas: a.context.squares, water: [], pools: [], wood: [], green: [], aprons: [], helipads: [], buildings: [], nearby: { ways: [] }, runways: [], streams: [] });
    expect(planPublicEnergy(a.B, a.town)).toEqual([]);
  });
});
