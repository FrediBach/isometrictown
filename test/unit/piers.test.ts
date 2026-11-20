import { expect, test } from 'vitest';
import type { Build } from '@/buildings';
import { Camera } from '@/camera';
import { bridges, ferries, pierOutline } from '@/infra';
import type { Masks } from '@/nature';
import { Paper } from '@/raster';
import { DEFAULT_SETTINGS } from '@/settings';
import { STYLES } from '@/styles';
import type { Town, Way } from '@/tiles';
import piers from '../fixtures/lake-piers.json';

function setup(bearing = 35, penWidth = DEFAULT_SETTINGS.penWidth) {
  const set = { ...DEFAULT_SETTINGS, scale: 1000, bearing, penWidth }, cam = new Camera(set), paper = new Paper(cam);
  const B: Build = { set, cam, style: STYLES.alpine, seed: set.seed, sun: [1, 0], equator: [0, -1], left: false,
    key: (x, y) => [Math.round(x), Math.round(y)], toAbs: (x, y) => [x, y], cell: (x, y, size) => [Math.floor(x / size), Math.floor(y / size)] };
  const M = Object.fromEntries(['water', 'pool', 'road', 'under', 'calm', 'green', 'wood', 'foot', 'shadow', 'title'].map(k => [k, paper.mask()])) as Masks;
  M.water.fill(1);
  return { B, paper, M };
}

test('closed marina footprints produce one outline per deck, within their mapped bounds', () => {
  for (const bearing of [0, 35, 90]) {
    const { B, paper, M } = setup(bearing), ways = piers as Way[];
    expect(ways.every(pierOutline)).toBe(true);
    const result = bridges(B, paper, { ways } as Town, M);
    expect(result.solids).toHaveLength(ways.length);
    for (const [i, s] of result.solids.entries()) {
      expect(s.lines).toHaveLength(1);
      expect(s.faces).toHaveLength(1);
      expect(s.faces[0]).toHaveLength(1);
      expect(s.faces[0][0].length).toBe((ways[i].pts.length - 2) / 2 * 3);
      expect(s.lines[0].closed).toBe(true);
      expect(s.lines[0].pts.filter((_, k) => k % 3 !== 2)).toEqual(ways[i].pts.slice(0, -2));
    }
    paper.finishDepth(); result.draw(paper);
    expect(paper.pens.flat()).toHaveLength(0);
  }
});

test('pier decks really occlude water, while open pier centre lines retain their supports', () => {
  const { B, paper, M } = setup();
  const deck: Way = { kind: 'path', cls: 'pier', sub: 'pier', bridge: true, width: 0, pts: [-10, -3, 10, -3, 10, 3, -10, 3, -10, -3] };
  const result = bridges(B, paper, { ways: [deck] } as Town, M);
  for (const s of result.solids) for (const f of s.faces) paper.fillFace(f);
  paper.finishDepth();
  const x = B.cam.sx(0, 0), y = B.cam.sy(0, 0, 0.35);
  expect(paper.seen(x, y, B.cam.groundDepth(y))).toBe(false);
  expect(paper.on(M.under, x, y)).toBe(true);
  const open = { ...deck, pts: [-20, 0, 20, 0] };
  expect(pierOutline(open)).toBe(false);
  const other = setup();
  const bridge = bridges(other.B, other.paper, { ways: [open] } as Town, other.M);
  expect(bridge.solids).toHaveLength(0);
  other.paper.finishDepth(); bridge.draw(other.paper);
  expect(other.paper.pens.flat().length).toBeGreaterThan(2);
});

test.each(['map', 'image'] as const)('%s ferries use the crossing for placement without drawing its route', source => {
  const { B, paper, M } = setup(0, 0.2);
  B.set.source = source;
  B.set.life = false; // Turn off wakes so any marks on the water would be route strokes.
  const result = ferries(B, paper, { ferries: [[-90, 0, 90, 0]] } as Town, M);
  expect(result.solids).toHaveLength(1);
  expect(result.solids[0].lines.length).toBeGreaterThan(0);
  paper.finishDepth();
  result.draw(paper);
  expect(paper.pens.flat()).toHaveLength(0);
});
