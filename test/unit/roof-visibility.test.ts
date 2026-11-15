import { expect, test } from 'vitest';
import { newSolid, type Build, type Solid } from '@/buildings';
import { Camera } from '@/camera';
import { Paper } from '@/raster';
import { finishRoofEdges, pitchedRoof, type End } from '@/roofs';
import { DEFAULT_SETTINGS, ROOFS } from '@/settings';
import { STYLES } from '@/styles';
import rim from '../fixtures/roof-rim.json';

function build(): Build {
  const set = { ...DEFAULT_SETTINGS, bearing: 90, scale: 1000 };
  return { set, cam: new Camera(set), style: STYLES.alpine, seed: set.seed, sun: [1, 0], equator: [0, -1], left: false,
    key: (x, y) => [Math.round(x), Math.round(y)], toAbs: (x, y) => [x, y], cell: (x, y, size) => [Math.floor(x / size), Math.floor(y / size)] };
}

function roof(B: Build, x: number, height: number, ends: [End, End], width = 12): Solid {
  const solid = newSolid();
  pitchedRoof(B, { rect: { cx: x, cy: 0, ux: 1, uy: 0, L: 20, w: width }, He: height, tan: 0.6, ends, sides: [0, 0], o: 0, hatch: false }, solid);
  return solid;
}

function surface(B: Build, solids: Solid[]) {
  const paper = new Paper(B.cam), ids = new Map<number[][], number>();
  for (const solid of solids) for (const face of solid.faces) {
    const id = ids.size;
    ids.set(face, id);
    paper.fillFace(face, 0, id);
  }
  paper.finishDepth();
  return { paper, ids };
}

function length(lines: number[][]) {
  let total = 0;
  for (const p of lines) for (let i = 2; i < p.length; i += 2) total += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return total;
}

test.each(['party', 'inner'] as const)('%s roof ends survive above a lower neighbour and hide behind a taller one', (end) => {
  const B = build();
  for (const height of [6, 20]) {
    const main = roof(B, 0, 10, [end, 'gable']), neighbour = roof(B, -20, height, ['gable', end]);
    finishRoofEdges([main, neighbour]);
    const lines = main.lines.filter((l) => l.roofJoin);
    expect(lines).toHaveLength(2);
    const { paper, ids } = surface(B, [main, neighbour]);
    for (const l of lines) paper.line3(ROOFS, l.pts, paper.onEdge(l.edge!.map((f) => ids.get(f)!)));
    if (height === 20) expect(paper.pens[ROOFS]).toHaveLength(0);
    else {
      const expected = lines.map((l) => l.pts.flatMap((_, i, p) => i % 3 === 0 ? [B.cam.sx(p[i], p[i + 1]), B.cam.sy(p[i], p[i + 1], p[i + 2])] : []));
      expect(length(paper.pens[ROOFS])).toBeCloseTo(length(expected), 6);
    }
  }
});

test('coplanar roof continuations remove only the shared portion of an end', () => {
  for (const shift of [0, 37.23]) {
    const B = build();
    const main = roof(B, shift, 10, ['inner', 'gable']);
    const neighbour = roof(B, shift - 20, 11.8, ['gable', 'inner'], 6);
    finishRoofEdges([main, neighbour]);
    const lines = main.lines.filter((l) => l.roofJoin);
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(Math.abs(l.pts[1])).toBeCloseTo(6, 6);
      expect(Math.abs(l.pts[4])).toBeCloseTo(3, 6);
    }
    expect(neighbour.lines.filter((l) => l.roofJoin)).toHaveLength(0);
  }
});

test('equal adjoining roofs have no internal end seam, while a real gap keeps both rims', () => {
  const B = build();
  for (const angle of [0, 37, 90]) for (const gap of [0, 0.01]) {
    const a = roof(B, 0, 10, ['party', 'gable']), b = roof(B, -20 - gap, 10, ['gable', 'party']);
    const sin = Math.sin(angle * Math.PI / 180), cos = Math.cos(angle * Math.PI / 180);
    for (const solid of [a, b]) for (const points of [...solid.faces.flat(), ...solid.lines.map((l) => l.pts)]) {
      for (let i = 0; i < points.length; i += 3) {
        const x = points[i], y = points[i + 1];
        points[i] = x * cos - y * sin;
        points[i + 1] = x * sin + y * cos;
      }
    }
    const faces = JSON.stringify([a.faces, b.faces]);
    finishRoofEdges([a, b]);
    expect([...a.lines, ...b.lines].filter((l) => l.roofJoin)).toHaveLength(gap ? 4 : 0);
    expect(JSON.stringify([a.faces, b.faces])).toBe(faces);
  }
});

test('an exact supporting plane rescues a rim from its own pixel depth but not from an occluder', () => {
  const B = build(), paper = new Paper(B.cam);
  const face = [[-10, -10, 0, 10, -10, 0, 10, 10, 20, -10, 10, 20]];
  paper.fillFace(face, 0, 0);
  paper.finishDepth();
  const x = B.cam.sx(0, 0), y = B.cam.sy(0, 0, 10), d = B.cam.depth(0, 0, 10);
  // A neighbouring pixel on a sloped face can be nearer than the exact point on the rim.
  paper.far[paper.index(x, y)] = d - 0.3;
  expect(paper.seen(x, y, d)).toBe(false);
  expect(paper.onEdge([0])(x, y, d)).toBe(true);
  expect(paper.onEdge([0])(x, y, d + 1)).toBe(false);
  paper.owner[paper.index(x, y)] = 1;
  expect(paper.onEdge([0])(x, y, d)).toBe(false);
  paper.owner[paper.index(x, y)] = -1;
  expect(paper.onEdge([0])(x, y, d)).toBe(false);
});


test('the recorded Mollis roof rim is visible at the exact face depth', () => {
  const cam = new Camera({ ...DEFAULT_SETTINGS, bearing: 35, scale: 1000 });
  const paper = new Paper(cam);
  rim.faces.forEach((face, i) => paper.fillFace(face, 0, i));
  rim.sprites.forEach(({ ring, depth }) => paper.fillSprite(ring, depth));
  paper.finishDepth();
  const [px, py, pz] = rim.point;
  const x = cam.sx(px, py), y = cam.sy(px, py, pz), d = cam.depth(px, py, pz);
  expect(paper.owner[paper.index(x, y)]).toBe(rim.owner);
  expect(paper.seen(x, y, d)).toBe(false);
  expect(paper.onEdge([rim.owner])(x, y, d)).toBe(true);
});
