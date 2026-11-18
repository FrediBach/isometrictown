import { expect, test, vi } from 'vitest';
import { car, newSolid, type Build } from '@/buildings';
import { Camera } from '@/camera';
import { facadeLines, PLAIN, type Wall } from '@/facades';
import { markings } from '@/infra';
import { castShadows, drawGround, FIELD, GARDEN, parkGrass, type Ground } from '@/ground';
import { treeSprite, type Masks } from '@/nature';
import { Paper } from '@/raster';
import { pitchedRoof } from '@/roofs';
import { hash, patch } from '@/rng';
import { DEFAULT_SETTINGS, GREENERY, LINEWORK, ROOFS, SHADOWS, type Settings } from '@/settings';
import { curbs, fillRoads, footpaths, pathClearance, railways } from '@/streets';
import { STYLES } from '@/styles';
import { empty, type Way } from '@/tiles';
import { quarries } from '@/sites';

function build(more: Partial<Settings> = {}): Build {
  const set = { ...DEFAULT_SETTINGS, ...more };
  return {
    set, cam: new Camera(set), style: STYLES.alpine, seed: set.seed,
    sun: [1, 0], equator: [0, -1], left: false,
    key: (x, y) => [Math.round(x), Math.round(y)],
    cell: (x, y, size) => [Math.floor(x / size), Math.floor(y / size)],
    toAbs: (x, y) => [x, y],
  };
}

test('equal-sized image quarries in one town have reproducible, structurally different workings', () => {
  const B = build({ scale: 2500, source: 'image', seed: 17 });
  const town = empty(), paper = new Paper(B.cam);
  for (let i = 0; i < 8; i++) {
    const x = i * 100;
    const pts = [x - 30, -25, x + 30, -25, x + 30, 25, x - 30, 25];
    town.landuse.push({ cls: 'quarry', shape: [{ pts, seam: new Uint8Array(4) }], quarryAccess: [x + 40, 0] });
  }
  const masks = { road: paper.mask(), water: paper.mask(), foot: paper.mask() } as Masks;
  const draw = () => quarries(B, paper, town, masks).solids;
  const solids = draw();
  expect(solids).toHaveLength(8);
  expect(draw()).toEqual(solids);
  expect(new Set(solids.map(s => s.shade?.length)).size).toBeGreaterThan(3);
});

function shutterWall(scale: number, penWidth = 0.35, seed = 1, height = 30) {
  const B = build({ scale, penWidth, seed, bearing: 0 });
  const out = newSolid();
  const wall: Wall = { ax: 0, ay: 0, bx: 3.4, by: 0, len: 3.4, z0: 0, z1: height, ground: true, street: false, door: false, balconies: 0, shutters: ROOFS };
  facadeLines(B, wall, PLAIN, out);
  return { B, out };
}

test.each([0.35, 0.7])('open shutters step from panels to strokes to clear frames with a %s mm pen', (penWidth) => {
  for (const scale of [250, 500, 1000]) {
    const { B, out } = shutterWall(scale * 0.35 / penWidth, penWidth);
    const windows = out.lines.filter((l) => l.pen === LINEWORK && l.closed);
    expect(windows.length).toBeGreaterThan(0);
    for (const { pts: w } of windows) {
      const shutters = out.lines.filter(({ pen, pts: p }) => pen === ROOFS && p[2] === w[2]);
      expect(shutters.length).toBe(scale === 1000 ? 0 : 2);
      for (const { pts: p, closed } of shutters) {
        expect(!!closed).toBe(scale === 250);
        for (let i = 0; i < p.length; i += 3) {
          const gap = Math.min(Math.abs(p[i] - w[0]), Math.abs(p[i] - w[3])) * B.cam.s;
          expect(gap).toBeGreaterThanOrEqual(penWidth * 1.5 - 1e-8);
        }
      }
    }
  }
});

test('closed shutters drop their centre seam before it crowds the panels', () => {
  const seed = Array.from({ length: 64 }, (_, i) => i).find((s) => shutterWall(1000, 0.35, s, 3).out.lines.some((l) => l.pen === ROOFS && l.closed));
  expect(seed).toBeDefined();
  const small = shutterWall(1000, 0.35, seed!, 3).out.lines.filter((l) => l.pen === ROOFS);
  const large = shutterWall(250, 0.35, seed!, 3).out.lines.filter((l) => l.pen === ROOFS);
  expect(small).toHaveLength(1);
  expect(small[0].closed).toBe(true);
  expect(large).toHaveLength(2);
});

test('small balcony railings keep a single top outline and preserve their depth faces', () => {
  const draw = (scale: number) => {
    const B = build({ scale, bearing: 0 });
    const out = newSolid();
    const wall: Wall = { ax: 0, ay: 0, bx: 20, by: 0, len: 20, z0: 0, z1: 12, ground: true, street: false, door: false, balconies: 1, shutters: -1 };
    facadeLines(B, wall, PLAIN, out);
    return out;
  };
  const small = draw(1000), large = draw(500);
  expect(small.faces.length).toBeGreaterThan(0);
  expect(small.faces).toEqual(large.faces);
  const rails = small.lines.filter(({ pts }) => pts.some((v, i) => i % 3 === 1 && v < -0.01));
  expect(rails.length).toBe(small.faces.length / 3);
  for (const { pts, closed } of rails) {
    expect(pts).toHaveLength(12);
    expect(closed).not.toBe(true);
    expect(new Set(pts.filter((_, i) => i % 3 === 2)).size).toBe(1);
  }
});

test.each([0.35, 0.7])('balcony uprights keep clear spacing with a %s mm pen', (penWidth) => {
  const B = build({ scale: 250, bearing: 0, penWidth });
  const out = newSolid();
  const wall: Wall = { ax: 0, ay: 0, bx: 20, by: 0, len: 20, z0: 0, z1: 12, ground: true, street: false, door: false, balconies: 1, shutters: -1 };
  facadeLines(B, wall, PLAIN, out);
  const fronts = out.lines.filter(({ pts: p, closed }) => closed && p[1] < -0.01);
  expect(fronts.length).toBeGreaterThan(0);
  let uprights = 0;
  for (const { pts: f } of fronts) {
    const xs = [f[0], f[3]];
    for (const { pts: p } of out.lines) {
      if (p.length !== 6 || p[0] !== p[3] || p[1] !== p[4] || p[1] !== f[1] || p[2] !== f[2] || p[0] <= f[0] || p[0] >= f[3]) continue;
      xs.push(p[0]);
      uprights++;
    }
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect((xs[i] - xs[i - 1]) * B.cam.s).toBeGreaterThanOrEqual(B.cam.gap(1.2) - 1e-8);
  }
  expect(uprights).toBeGreaterThan(0);
});

test.each([0.35, 0.7])('oblique window frames become upright strokes with a %s mm pen', (penWidth) => {
  const B = build({ scale: 500 * 0.35 / penWidth, bearing: 0, penWidth });
  const draw = (angle: number) => {
    const out = newSolid();
    const a = angle * Math.PI / 180;
    const wall: Wall = { ax: 0, ay: 0, bx: 20 * Math.cos(a), by: 20 * Math.sin(a), len: 20, z0: 0, z1: 12, ground: true, street: false, door: false, balconies: 0, shutters: -1 };
    facadeLines(B, wall, PLAIN, out);
    return out;
  };
  expect(draw(0).lines.some((l) => l.closed)).toBe(true);
  const oblique = draw(75);
  expect(oblique.lines.length).toBeGreaterThan(0);
  expect(oblique.faces).toHaveLength(0);
  for (const { pts: p, closed } of oblique.lines) {
    expect(closed).not.toBe(true);
    expect(p).toHaveLength(6);
    expect(p[0]).toBe(p[3]);
    expect(p[1]).toBe(p[4]);
  }
});

test('wide but shallow windows omit glazing bars until both dimensions have room', () => {
  const draw = (scale: number, bars: boolean) => {
    const B = build({ scale, bearing: 0 });
    const out = newSolid();
    const wall: Wall = { ax: 0, ay: 0, bx: 20, by: 0, len: 20, z0: 0, z1: 12, ground: true, street: false, door: false, balconies: 0, shutters: -1 };
    facadeLines(B, wall, { ...PLAIN, w: 3, h: 1, bay: 5, bars }, out);
    return out.lines;
  };
  expect(draw(500, true)).toEqual(draw(500, false));
  expect(draw(400, true).length).toBeGreaterThan(draw(400, false).length);
});

test('window frames reserve space for the ink as well as the opening', () => {
  const draw = (width: number) => {
    const B = build({ scale: 1000, bearing: 0 });
    const out = newSolid();
    const wall: Wall = { ax: 0, ay: 0, bx: 20, by: 0, len: 20, z0: 0, z1: 12, ground: true, street: false, door: false, balconies: 0, shutters: -1 };
    facadeLines(B, wall, { ...PLAIN, w: width }, out);
    return out.lines;
  };
  const narrow = draw(1.1);
  expect(narrow.length).toBeGreaterThan(0);
  expect(narrow.every((l) => !l.closed)).toBe(true);
  expect(draw(1.5).some((l) => l.closed)).toBe(true);
});

test.each([0.35, 0.7])('curtain grids keep projected spacing and corner clearance with a %s mm pen', (penWidth) => {
  const B = build({ scale: 500, bearing: 0, tilt: 75, penWidth });
  const len = 40, dx = Math.SQRT1_2, dy = Math.SQRT1_2;
  const wall: Wall = { ax: 0, ay: 0, bx: dx * len, by: dy * len, len, z0: 3, z1: 60, ground: false, street: false, door: false, balconies: 0, shutters: -1 };
  const out = newSolid();
  facadeLines(B, wall, { ...PLAIN, pattern: 'curtain', storey: 3, bay: 1.5 }, out);
  const horizontal = out.lines.filter(({ pts: p }) => p.length === 6 && p[2] === p[5]);
  const vertical = out.lines.filter(({ pts: p }) => p.length === 6 && p[0] === p[3] && p[1] === p[4]);
  expect(horizontal.length).toBeGreaterThan(2);
  expect(vertical.length).toBeGreaterThan(2);
  const { cam } = B;
  const ux = cam.sx(wall.bx, wall.by) - cam.sx(0, 0);
  const uy = cam.sy(wall.bx, wall.by, 0) - cam.sy(0, 0, 0);
  const offsets = horizontal.map(({ pts: p }) => (ux * cam.sy(p[0], p[1], p[2]) - uy * cam.sx(p[0], p[1])) / Math.hypot(ux, uy)).sort((a, b) => a - b);
  for (let i = 1; i < offsets.length; i++) expect(offsets[i] - offsets[i - 1]).toBeGreaterThanOrEqual(cam.gap(1.5) - 1e-8);
  const xs = vertical.map(({ pts: p }) => cam.sx(p[0], p[1])).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(cam.gap(1.2) - 1e-8);
  expect(xs[0] - cam.sx(0, 0)).toBeGreaterThanOrEqual(penWidth * 1.5 - 1e-8);
  expect(cam.sx(wall.bx, wall.by) - xs[xs.length - 1]).toBeGreaterThanOrEqual(penWidth * 1.5 - 1e-8);
});

test.each([false, true])('tree crowns simplify at small print sizes (conifer: %s)', (conifer) => {
  const tree = { x: 0, y: 0, r: 3, h: 10, conifer };
  const large = build({ scale: 1000 });
  const small = build({ scale: 8000 });
  const largeSprite = treeSprite(large, new Paper(large.cam), tree);
  const paper = new Paper(small.cam);
  const smallSprite = treeSprite(small, paper, tree);
  expect(largeSprite.ring.length).toBeGreaterThan(smallSprite.ring.length);
  const sheet = vi.spyOn(paper, 'sheet');
  paper.fillSprite(smallSprite.ring, smallSprite.depth);
  paper.finishDepth();
  smallSprite.draw();
  // The only sheet-space stroke is the crown outline; the trunk uses line3.
  expect(sheet).toHaveBeenCalledTimes(1);
  expect(sheet.mock.calls[0][3]).toBe(true);
});

test('broadleaf crowns vary by map position and stay inside their placement radius', () => {
  const B = build({ scale: 500 });
  const paper = new Paper(B.cam);
  const tree = { x: 0, y: 0, r: 3, h: 8, conifer: false };
  const ring = treeSprite(B, paper, tree).ring;
  expect(treeSprite(B, paper, tree).ring).toEqual(ring);
  const radii = ring.filter((_, i) => i % 2 === 0).map((x, i) => Math.hypot(x - B.cam.sx(0, 0), ring[i * 2 + 1] - B.cam.sy(0, 0, tree.h)));
  expect(Math.max(...radii)).toBeLessThanOrEqual(tree.r * B.cam.s);
  expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.1);
  const moved = treeSprite(B, paper, { ...tree, x: 20 }).ring;
  const shift = B.cam.sx(20, 0) - B.cam.sx(0, 0);
  expect(moved.some((x, i) => i % 2 === 0 && Math.abs(x - shift - ring[i]) > 0.01)).toBe(true);
});

test.each([0.35, 0.7])('park hatch leaves a visible gap at lawn and road edges with a %s mm pen', (penWidth) => {
  const B = build({ penWidth });
  const paper = new Paper(B.cam);
  const M = Object.fromEntries(['road', 'water', 'green', 'wood', 'foot', 'shadow', 'pool', 'under', 'calm', 'title'].map((key) => [key, paper.mask()])) as Masks;
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].flatMap(([x, y]) => B.cam.ground(x, y));
  paper.fillMask(M.green, [rect(180, 120, 220, 150)]);
  paper.fillMask(M.road, [rect(199, 110, 201, 160)]);
  paper.finishDepth();
  parkGrass(paper, M);
  const lines = paper.pens[GREENERY];
  expect(lines.length).toBeGreaterThan(5);
  for (const line of lines) {
    for (let i = 0; i < line.length; i += 2) {
      const x = line[i], y = line[i + 1];
      const gap = Math.min(x - 180, 220 - x, y - 120, 150 - y, Math.abs(x - 200) - 1);
      expect(gap).toBeGreaterThan(penWidth * 0.8);
    }
  }
});

test('texture patches stay bounded and continuous across positive and negative cell edges', () => {
  for (let i = -5; i <= 5; i++) {
    for (let j = -5; j <= 5; j++) {
      const value = patch(i + 0.37, j + 0.63, 42, 7931);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(patch(i - 1e-6, j + 0.4, 42, 7931)).toBeCloseTo(patch(i + 1e-6, j + 0.4, 42, 7931), 8);
      expect(patch(i + 0.4, j - 1e-6, 42, 7931)).toBeCloseTo(patch(i + 0.4, j + 1e-6, 42, 7931), 8);
    }
  }
});

test('texture patches repeat for the same seed and vary independently by seed and salt', () => {
  const samples = (seed: number, salt: number) => Array.from({ length: 30 }, (_, i) => patch(i * 0.37, i * -0.23, seed, salt));
  expect(samples(42, 7931)).toEqual(samples(42, 7931));
  expect(samples(42, 7931)).not.toEqual(samples(43, 7931));
  expect(samples(42, 7931)).not.toEqual(samples(42, 7932));
});

test.each([0.35, 0.7])('roof hatch leaves clear ends with a %s mm pen without changing the roof', (penWidth) => {
  const B = build({ penWidth });
  const out = newSolid();
  const plain = newSolid();
  const spec = {
    rect: { cx: 0, cy: 0, ux: 1, uy: 0, L: 20, w: 12 },
    He: 10, tan: 1, ends: ['gable', 'gable'] as ['gable', 'gable'],
    sides: [0, 0] as [number, number], o: 0, hatch: true,
  };
  pitchedRoof(B, spec, out);
  pitchedRoof(B, { ...spec, hatch: false }, plain);
  expect(out.faces).toEqual(plain.faces);
  expect(out.lines.filter((l) => l.layer !== 'roofHatch')).toEqual(plain.lines);
  const hatch = out.lines.filter((l) => l.layer === 'roofHatch');
  expect(hatch.length).toBeGreaterThan(0);
  const { cam } = B;
  for (const { pts: p } of hatch) {
    const eave = Math.sign(p[1]) * 6;
    const startGap = Math.hypot(cam.sx(p[0], p[1]) - cam.sx(p[0], eave), cam.sy(p[0], p[1], p[2]) - cam.sy(p[0], eave, 10));
    const endGap = Math.hypot(cam.sx(p[3], p[4]) - cam.sx(p[3], 0), cam.sy(p[3], p[4], p[5]) - cam.sy(p[3], 0, 16));
    expect(startGap).toBeGreaterThan(penWidth);
    expect(endGap).toBeGreaterThan(penWidth);
    expect(p[2]).toBeLessThan(p[5]);
  }
});

test('small cars keep an outline and windscreen instead of stacked rims', () => {
  const full = car(build({ scale: 500 }), 0, 0, 1, 0, 0.4);
  const small = car(build({ scale: 2000 }), 0, 0, 1, 0, 0.4);
  expect(small.lines).toHaveLength(2);
  expect(small.lines.filter((l) => l.closed)).toHaveLength(1);
  expect(full.lines.length).toBeGreaterThan(small.lines.length);
  expect(small.faces.length).toBeGreaterThan(0);
  expect(small.casts).toEqual(full.casts);
});

test('foreshortened road dashes disappear before equally long transverse dashes', () => {
  const strokes = (pts: number[]) => {
    const B = build({ scale: 3000, bearing: 0 });
    const paper = new Paper(B.cam);
    const M = Object.fromEntries(['road', 'water', 'green', 'wood', 'foot', 'shadow', 'pool', 'under', 'calm', 'title'].map((key) => [key, paper.mask()])) as Masks;
    const ways: Way[] = [{ kind: 'road', cls: 'primary', width: 12, pts }];
    fillRoads(paper, ways, [], M.road);
    paper.finishDepth();
    markings(B, paper, ways, M);
    return paper.pens[LINEWORK].length;
  };
  expect(strokes([-50, 0, 50, 0])).toBeGreaterThan(0);
  expect(strokes([0, -50, 0, 50])).toBe(0);
});

test('a right-angle kerb emits only the outside arc at its bend', () => {
  const B = build();
  const paper = new Paper(B.cam);
  const M = { road: paper.mask() } as Masks;
  const ways: Way[] = [{ kind: 'road', cls: 'minor', width: 10, pts: [-30, 0, 0, 0, 0, 30] }];
  fillRoads(paper, ways, [], M.road);
  paper.finishDepth();
  const seg = vi.spyOn(paper, 'seg');
  curbs(paper, ways, M);
  let arcs = 0;
  for (const [, ax, ay, , bx, by] of seg.mock.calls) {
    const a = B.cam.ground(ax, ay);
    const b = B.cam.ground(bx, by);
    if (Math.hypot(...a) > 6 || Math.hypot(...b) > 6) continue;
    if (Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) continue;
    arcs++;
    for (const [x, y] of [a, b]) {
      expect(x).toBeGreaterThanOrEqual(-1e-6);
      expect(y).toBeLessThanOrEqual(1e-6);
    }
  }
  expect(arcs).toBeGreaterThan(0);
});


test.each([0.35, 0.7])('park tone leaves a continuous path corridor with a %s mm pen', (penWidth) => {
  const B = build({ penWidth, paths: true });
  const paper = new Paper(B.cam);
  const M = Object.fromEntries(['road', 'water', 'green', 'wood', 'foot', 'shadow', 'pool', 'under', 'calm', 'title'].map((key) => [key, paper.mask()])) as Masks;
  const rect = [180, 120, 220, 120, 220, 150, 180, 150];
  paper.fillMask(M.green, [rect.flatMap((v, i) => i % 2 ? [] : B.cam.ground(v, rect[i + 1]))]);
  const ways: Way[] = [{ kind: 'path', cls: 'path', width: 1, pts: [...B.cam.ground(200, 110), ...B.cam.ground(200, 160)] }];
  const mask = pathClearance(B, paper, ways);
  paper.finishDepth();
  parkGrass(paper, M, null, mask);
  expect(paper.pens[GREENERY].length).toBeGreaterThan(5);
  for (const line of paper.pens[GREENERY]) {
    for (let i = 0; i < line.length; i += 2) expect(Math.abs(line[i] - 200)).toBeGreaterThan(penWidth * 1.5);
  }
  expect(paper.on(mask, 200, 135)).toBe(true);
  expect(paper.on(mask, 200 + penWidth * 3, 135)).toBe(false);
  B.set.paths = false;
  expect(pathClearance(B, paper, ways).some(Boolean)).toBe(false);
  B.set.paths = true;
  expect(pathClearance(B, paper, [{ ...ways[0], sub: 'platform' }]).some(Boolean)).toBe(false);
  expect(pathClearance(B, paper, [{ ...ways[0], pts: [0, 0, 0.1, 0] }]).some(Boolean)).toBe(false);
});


function textureGround(paper: Paper): Ground {
  return { land: paper.mask(), farms: paper.mask(), farmShapes: [], covers: [], cemeteries: [], pitches: [], gardens: false, inTown: () => false };
}

test.each([0.35, 0.7])('paths omit whole lawn and wild-country symbols with a %s mm pen', (penWidth) => {
  for (const garden of [false, true]) {
    const B = build({ penWidth, paths: true });
    const draw = (clear: boolean) => {
      const paper = new Paper(B.cam);
      const M = Object.fromEntries(['road', 'water', 'green', 'wood', 'foot', 'shadow', 'pool', 'under', 'calm', 'title'].map((key) => [key, paper.mask()])) as Masks;
      const G = textureGround(paper);
      if (garden) { G.land.fill(GARDEN); G.gardens = true; }
      const ways: Way[] = [{ kind: 'path', cls: 'path', width: 1, pts: [...B.cam.ground(200, 20), ...B.cam.ground(200, 263)] }];
      const mask = clear ? pathClearance(B, paper, ways) : undefined;
      paper.finishDepth();
      drawGround(B, paper, M, G, B.toAbs, B.toAbs, mask);
      return paper.pens.flat();
    };
    const before = draw(false), after = draw(true);
    expect(after.length).toBeGreaterThan(10);
    expect(after.length).toBeLessThan(before.length);
    const whole = new Set(before.map((line) => JSON.stringify(line)));
    for (const line of after) {
      expect(whole.has(JSON.stringify(line))).toBe(true);
      for (let i = 0; i < line.length; i += 2) expect(Math.abs(line[i] - 200)).toBeGreaterThan(penWidth * 1.5);
    }
  }
});

test('field rows break at path corridors while field boundaries stay intact', () => {
  const B = build({ paths: true, scale: 1000 });
  const paper = new Paper(B.cam);
  const M = Object.fromEntries(['road', 'water', 'green', 'wood', 'foot', 'shadow', 'pool', 'under', 'calm', 'title'].map((key) => [key, paper.mask()])) as Masks;
  const G = textureGround(paper);
  const shape = [{ pts: [-50, -50, 50, -50, 50, 50, -50, 50], seam: new Uint8Array(4) }];
  G.covers.push({ shape, code: FIELD, rect: { cx: 0, cy: 0, ux: 1, uy: 0, L: 100, w: 100 } });
  G.farmShapes.push(shape);
  paper.fillMask(G.land, [shape[0].pts], FIELD);
  paper.fillMask(G.farms, [shape[0].pts]);
  const mask = pathClearance(B, paper, [{ kind: 'path', cls: 'path', width: 1, pts: [...B.cam.ground(210, 20), ...B.cam.ground(210, 263)] }]);
  paper.tally = new Map();
  paper.layer = 'ground';
  paper.finishDepth();
  drawGround(B, paper, M, G, B.toAbs, B.toAbs, mask);
  const rows = paper.tally.get('ground/fields')!;
  expect(rows.length).toBeGreaterThan(10);
  for (const line of rows) {
    for (let i = 0; i < line.length; i += 2) expect(Math.abs(line[i] - 210)).toBeGreaterThan(B.cam.nib * 1.5);
  }
  expect(paper.tally.get('ground/farm-edges')!.some((line) => {
    const xs = line.filter((_, i) => i % 2 === 0);
    return Math.min(...xs) < 210 && Math.max(...xs) > 210;
  })).toBe(true);
});


function pathLines(B: Build, pts: number[], road = false, sub?: string) {
  const paper = new Paper(B.cam);
  const M = { road: paper.mask(), water: paper.mask() } as Masks;
  if (road) paper.fillMask(M.road, [[...B.cam.ground(198, 100), ...B.cam.ground(202, 100), ...B.cam.ground(202, 160), ...B.cam.ground(198, 160)]]);
  paper.finishDepth();
  footpaths(B, paper, [{ kind: 'path', cls: 'path', width: 1, pts, sub }], M);
  return paper.pens[LINEWORK];
}

function strokeLength(p: number[]): number {
  let length = 0;
  for (let i = 2; i < p.length; i += 2) length += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return length;
}

test.each([0.35, 0.7])('path dash lengths and gaps survive every direction with a %s mm pen', (penWidth) => {
  for (const scale of [1000, 4000]) for (const tilt of [20, 60]) for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
    const B = build({ penWidth, scale, tilt });
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const pts = [...B.cam.ground(180, 120), ...B.cam.ground(180 + dx * 40, 120 + dy * 40)];
    const lines = pathLines(B, pts);
    expect(lines.length).toBeGreaterThan(9);
    for (let i = 0; i < lines.length - 1; i++) {
      expect(strokeLength(lines[i])).toBeCloseTo(B.cam.tone(1.1), 5);
      const p = lines[i], q = lines[i + 1];
      expect(Math.hypot(p[p.length - 2] - q[0], p[p.length - 1] - q[1])).toBeCloseTo(B.cam.tone(0.8), 5);
    }
  }
});

test('dash phase crosses vertices and repeated points without restarting', () => {
  const B = build({ scale: 4000 });
  const ground = (x: number, y: number) => B.cam.ground(x, y);
  const simple = pathLines(B, [...ground(180, 120), ...ground(220, 120)]);
  const split = pathLines(B, [...ground(180, 120), ...ground(180.4, 120), ...ground(180.4, 120), ...ground(193.2, 120), ...ground(220, 120)]);
  expect(split.length).toBe(simple.length);
  for (let i = 0; i < simple.length; i++) {
    expect(split[i][0]).toBeCloseTo(simple[i][0], 5);
    expect(strokeLength(split[i])).toBeCloseTo(strokeLength(simple[i]), 5);
  }
  const bent = pathLines(B, [...ground(180, 120), ...ground(180.4, 120), ...ground(180.4, 160)]);
  expect(strokeLength(bent[0])).toBeCloseTo(B.cam.tone(1.1), 5);
});

test('projected path dashes still stop at road masks', () => {
  const B = build({ scale: 4000 });
  const lines = pathLines(B, [...B.cam.ground(180, 130), ...B.cam.ground(220, 130)], true);
  expect(lines.length).toBeGreaterThan(10);
  for (const line of lines) for (let i = 0; i < line.length; i += 2) expect(Math.abs(line[i] - 200)).toBeGreaterThan(1.8);
});


test.each([0.35, 0.7])('stair treads keep perpendicular print clearance with a %s mm pen', (penWidth) => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
    const B = build({ scale: 250, tilt: 25, penWidth, bearing: 0 });
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const lines = pathLines(B, [-10 * ux, -10 * uy, 10 * ux, 10 * uy], false, 'steps');
    expect(lines.length).toBeGreaterThan(5);
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1], b = lines[i];
      const dx = a[a.length - 2] - a[0], dy = a[a.length - 1] - a[1];
      const separation = Math.abs(dx * (b[1] - a[1]) - dy * (b[0] - a[0])) / Math.hypot(dx, dy);
      expect(separation).toBeGreaterThanOrEqual(Math.max(B.cam.gap(0.8), B.cam.nib * 2) - 1e-6);
      expect(strokeLength(b)).toBeGreaterThan(B.cam.nib * 2);
    }
  }
});

test('narrow projected stairs fall back to the same readable dashes and corridor as a path', () => {
  const B = build({ scale: 1000, tilt: 20, bearing: 0 });
  const pts = [-30, 0, 30, 0];
  const steps = pathLines(B, pts, false, 'steps');
  expect(steps.length).toBeGreaterThan(10);
  expect(steps).toEqual(pathLines(B, pts));
  const paper = new Paper(B.cam);
  const way: Way = { kind: 'path', cls: 'path', width: 1, pts };
  expect(pathClearance(B, paper, [{ ...way, sub: 'steps' }])).toEqual(pathClearance(B, paper, [way]));
});


function railLines(B: Build, pts: number[], sub?: string) {
  B.style = STYLES.arid;
  const paper = new Paper(B.cam);
  paper.finishDepth();
  railways(B, paper, [{ kind: 'rail', cls: 'rail', width: 2, pts, sub }]);
  return paper.pens[LINEWORK];
}

test('rail pairs use projected clear gauge and distinguish narrow gauge', () => {
  const B = build({ scale: 1000, bearing: 0, tilt: 30 });
  const sideways = railLines(B, [-20, 0, 20, 0]);
  expect(sideways).toHaveLength(1);
  expect(railLines(B, [0, -20, 0, 20]).length).toBeGreaterThan(2);
  expect(railLines(B, [0, -20, 0, 20], 'narrow_gauge')).toHaveLength(1);
});

test.each([0.35, 0.7])('rail pairs and sleepers keep visible separation with a %s mm pen', (penWidth) => {
  let pairs = 0;
  for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
    const B = build({ scale: 500, bearing: 0, tilt: 20, penWidth });
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const lines = railLines(B, [-20 * ux, -20 * uy, 20 * ux, 20 * uy]);
    if (lines.length === 1) continue;
    pairs++;
    const a = lines[0], b = lines[1];
    const dx = a[a.length - 2] - a[0], dy = a[a.length - 1] - a[1];
    const gauge = Math.abs(dx * (b[1] - a[1]) - dy * (b[0] - a[0])) / Math.hypot(dx, dy);
    expect(gauge - penWidth).toBeGreaterThanOrEqual(0.7 * penWidth / 0.35 - 1e-6);
    expect(lines.length).toBeGreaterThan(4);
    for (let i = 3; i < lines.length; i++) {
      const p = lines[i - 1], q = lines[i];
      const tx = p[p.length - 2] - p[0], ty = p[p.length - 1] - p[1];
      const separation = Math.abs(tx * (q[1] - p[1]) - ty * (q[0] - p[0])) / Math.hypot(tx, ty);
      expect(separation).toBeGreaterThanOrEqual(Math.max(B.cam.gap(1.2), penWidth * 2) - 1e-6);
    }
  }
  expect(pairs).toBeGreaterThan(0);
});


function overheadLines(B: Build, pts: number[], sub?: string) {
  const paper = new Paper(B.cam);
  paper.finishDepth();
  const line = vi.spyOn(paper, 'line3');
  railways(B, paper, [{ kind: 'rail', cls: 'rail', width: 2, pts, sub }]);
  return line.mock.calls.map((call) => call[1]).filter((p) => p.some((z, i) => i % 3 === 2 && z > 0));
}

test.each([0.35, 0.7])('overhead wires need clear projected separation with a %s mm pen', (penWidth) => {
  for (const sub of [undefined, 'tram']) {
    const B = build({ scale: 1000, tilt: 30, bearing: 0, penWidth });
    const wire = (p: number[]) => p.every((z, i) => i % 3 !== 2 || z === 5.6);
    const endOn = overheadLines(B, [0, -40, 0, 40], sub);
    expect(endOn.some(wire)).toBe(false);
    expect(endOn.length).toBeGreaterThan(0);
    const sideOn = overheadLines(B, [-40, 0, 40, 0], sub);
    expect(sideOn.filter(wire)).toHaveLength(1);
    expect(sideOn.filter((p) => !wire(p))).toHaveLength(endOn.length);
    // One compressed section simplifies the complete wire rather than leaving loose ends.
    expect(overheadLines(B, [-40, 0, 0, 0, 0, 40], sub).some(wire)).toBe(false);
  }
});


test.each([0.35, 0.7])('tiny shadow islands disappear without changing retained tone with a %s mm pen', (penWidth) => {
  const B = build({ penWidth });
  const paper = new Paper(B.cam);
  const M = { shadow: paper.mask(), water: paper.mask() } as Masks;
  const rect = (x: number, y: number, w: number, h: number) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].flatMap(([a, b]) => B.cam.ground(a, b));
  const k = penWidth / 0.35;
  paper.fillMask(M.shadow, [rect(180, 120, 20, 15)]);
  paper.fillMask(M.shadow, [rect(210, 120, k, k)]);
  const original = M.shadow.slice();
  paper.finishDepth();
  paper.hatchGround(SHADOWS, 62, B.cam.tone(0.95), (x, y) => paper.on(M.shadow, x, y));
  const before = paper.pens[SHADOWS].splice(0);
  expect(before.some((line) => line[0] > 205)).toBe(true);
  castShadows(paper, M);
  const after = paper.pens[SHADOWS];
  expect(after.length).toBeGreaterThan(5);
  expect(after).toEqual(before.filter((line) => line[0] < 205));
  expect(M.shadow).toEqual(original);
});

test('hidden and water-covered shadow areas cannot keep a tiny visible island alive', () => {
  const B = build();
  const paper = new Paper(B.cam);
  const M = { shadow: paper.mask(), water: paper.mask() } as Masks;
  const rect = (x: number, y: number, w: number, h: number) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].flatMap(([a, b]) => B.cam.ground(a, b));
  paper.fillMask(M.shadow, [rect(180, 120, 1, 20), rect(210, 120, 1, 20)]);
  paper.fillMask(M.water, [rect(180, 121, 1, 19)]);
  paper.fillSprite([209, 121, 212, 121, 212, 141, 209, 141], -1e6);
  paper.finishDepth();
  castShadows(paper, M);
  expect(paper.pens[SHADOWS]).toHaveLength(0);
});


test.each([0.35, 0.7])('shadow hatching leaves a continuous path corridor with a %s mm pen', (penWidth) => {
  const B = build({ penWidth, paths: true });
  const paper = new Paper(B.cam);
  const M = { shadow: paper.mask(), water: paper.mask(), road: paper.mask() } as Masks;
  const rect = [[180, 120], [200, 120], [200, 140], [180, 140]].flatMap(([x, y]) => B.cam.ground(x, y));
  paper.fillMask(M.shadow, [rect]);
  const ways: Way[] = [{ kind: 'path', cls: 'path', width: 1, pts: [...B.cam.ground(190, 110), ...B.cam.ground(190, 150)] }];
  const mask = pathClearance(B, paper, ways);
  paper.finishDepth();
  castShadows(paper, M, mask);
  expect(paper.pens[SHADOWS].length).toBeGreaterThan(5);
  for (const line of paper.pens[SHADOWS]) {
    const xs = line.filter((_, i) => i % 2 === 0);
    expect(xs.every((x) => x < 190 - penWidth * 1.5) || xs.every((x) => x > 190 + penWidth * 1.5)).toBe(true);
  }
  paper.pens[SHADOWS].splice(0);
  B.set.paths = false;
  castShadows(paper, M, pathClearance(B, paper, ways));
  const disabled = paper.pens[SHADOWS].splice(0);
  castShadows(paper, M);
  expect(paper.pens[SHADOWS]).toEqual(disabled);
  paper.pens[SHADOWS].splice(0);
  M.road.fill(1);
  castShadows(paper, M, mask);
  expect(paper.pens[SHADOWS]).toEqual(disabled);
});

test('path clearance removes the tiny shadow fragments it separates', () => {
  const B = build({ paths: true });
  const paper = new Paper(B.cam);
  const M = { shadow: paper.mask(), water: paper.mask(), road: paper.mask() } as Masks;
  paper.fillMask(M.shadow, [[[180, 120], [182.5, 120], [182.5, 122], [180, 122]].flatMap(([x, y]) => B.cam.ground(x, y))]);
  paper.finishDepth();
  castShadows(paper, M);
  expect(paper.pens[SHADOWS].length).toBeGreaterThan(0);
  paper.pens[SHADOWS].splice(0);
  const mask = pathClearance(B, paper, [{ kind: 'path', cls: 'path', width: 1, pts: [...B.cam.ground(181.25, 110), ...B.cam.ground(181.25, 150)] }]);
  castShadows(paper, M, mask);
  expect(paper.pens[SHADOWS]).toHaveLength(0);
});

/** A single eligible crossing, with unmarked branches establishing its junction. */
function zebraSample(penWidth: number, bearing: number, detail = 1, tilt = 32) {
  const seed = Array.from({ length: 64 }, (_, i) => i).find((i) => hash(0, 0, i, 430) <= 0.6)!;
  const B = build({ scale: 500, penWidth, bearing, detail, seed, tilt });
  B.key = () => [0, 0];
  const paper = new Paper(B.cam);
  const M = { road: paper.mask(), foot: paper.mask() } as Masks;
  M.road.fill(1);
  paper.finishDepth();
  const lines = vi.spyOn(paper, 'line3');
  markings(B, paper, [
    { kind: 'road', cls: 'tertiary', width: 12, pts: [0, 0, 60, 0] },
    { kind: 'road', cls: 'minor', width: 6, pts: [0, 0, 0, 60] },
    { kind: 'road', cls: 'minor', width: 6, pts: [0, 0, -60, 0] },
  ], M);
  return { B, lines: lines.mock.calls.map((call) => call[1]) };
}

test.each([0.35, 0.7])('crossings keep centred, separated stripes with a %s mm pen', (penWidth) => {
  for (const detail of [1, 2]) for (const bearing of [0, 30, 90]) {
    const { B, lines } = zebraSample(penWidth, bearing, detail);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines[0][1] + lines.at(-1)![1]).toBeCloseTo(0);
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1], b = lines[i], c = B.cam;
      const dx = c.sx(a[3], a[4]) - c.sx(a[0], a[1]);
      const dy = c.sy(a[3], a[4], 0) - c.sy(a[0], a[1], 0);
      const nx = c.sx(b[0], b[1]) - c.sx(a[0], a[1]);
      const ny = c.sy(b[0], b[1], 0) - c.sy(a[0], a[1], 0);
      expect(Math.abs(dx * ny - dy * nx) / Math.hypot(dx, dy)).toBeGreaterThanOrEqual(2 * penWidth - 1e-8);
    }
  }
});

test('crossings omit groups with too few stripes or too little projected length', () => {
  expect(zebraSample(2, 0, 2, 15).lines).toHaveLength(0);
  expect(zebraSample(0.7, 90, 2, 5).lines).toHaveLength(0);
});
