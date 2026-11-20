import { expect, test } from 'vitest';
import { controlOf, crossingsOf, makeRoundabout } from '@/image-junctions';
import { streetRules, type Graph } from '@/image-streets';
import type { Way } from '@/tiles';

/** A junction at the origin with arms of the given lengths at the given bearings, degrees. */
function junction(arms: [number, number][], cls = 'tertiary'): Graph {
  const nodes = [0, 0];
  const edges: Graph['edges'] = [];
  for (const [deg, len] of arms) {
    const a = (deg * Math.PI) / 180;
    nodes.push(len * Math.cos(a), len * Math.sin(a));
    const end = nodes.length / 2 - 1;
    const pts: number[] = [];
    for (let s = 0; s <= 6; s++) pts.push(((len * s) / 6) * Math.cos(a), ((len * s) / 6) * Math.sin(a));
    edges.push({ a: 0, b: end, pts, cls, main: false });
  }
  return { nodes, edges };
}
const dry = () => false;

test('a crossroads becomes a roundabout: arms cut at the ring, the ring closed, and the streets still keep their rules', () => {
  const g = junction([[0, 80], [90, 80], [180, 80], [270, 80]]);
  const o = makeRoundabout(g, 0, 14, 'tertiary', dry)!;
  expect(o).not.toBeNull();
  const p = o.pts;
  expect(Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1])).toBeLessThan(1e-9);
  for (let k = 0; k < p.length; k += 2) expect(Math.hypot(p[k], p[k + 1])).toBeCloseTo(14);
  expect(g.edges.filter((e) => e.ring)).toHaveLength(4);
  // Every arm now starts on the ring, and nothing is left at the old junction.
  for (const e of g.edges.filter((e) => !e.ring)) expect(Math.hypot(e.pts[0], e.pts[1])).toBeCloseTo(14);
  expect(g.edges.some((e) => e.a === 0 || e.b === 0)).toBe(false);
  expect(streetRules(g)).toEqual([]);
});

test('a roundabout that would not fit leaves the graph as it was', () => {
  const cases: [[number, number][], (x: number, y: number) => boolean][] = [
    // Water beside it.
    [[[0, 80], [120, 80], [240, 80]], (x) => x > 15],
    // An arm too short to keep a dead end or the next junction far enough off.
    [[[0, 80], [120, 30], [240, 80]], dry],
    // Two arms too close together along the ring.
    [[[0, 80], [28, 80], [180, 80]], dry],
  ];
  for (const [arms, water] of cases) {
    const g = junction(arms);
    const before = structuredClone(g);
    expect(makeRoundabout(g, 0, 14, 'tertiary', water)).toBeNull();
    expect(g).toEqual(before);
  }
});

test('busy junctions are controlled more often than quiet ones', () => {
  const share = (arms: string[], label: 'blocks' | 'suburb', what: string) => {
    let n = 0;
    for (let k = 0; k < 1000; k++) if (controlOf(arms, label, 'central', (k + 0.5) / 1000) === what) n++;
    return n / 1000;
  };
  expect(share(['primary', 'primary', 'secondary', 'secondary'], 'blocks', 'signals')).toBeGreaterThan(share(['minor', 'minor', 'minor'], 'suburb', 'signals'));
  // A style the corpus says nothing of falls back to the pooled habits.
  expect(controlOf(['minor', 'minor', 'minor'], 'suburb', 'no-such-style', 0.999)).toBe('none');
});

test('more roundabouts raises their odds and leaves real rates alone at 0', () => {
  const arms = ['secondary', 'tertiary', 'minor', 'minor'];
  const count = (more: number) => {
    let n = 0;
    for (let k = 0; k < 2000; k++) if (controlOf(arms, 'suburb', 'british', (k + 0.5) / 2000, more) === 'roundabout') n++;
    return n;
  };
  expect(count(0)).toBe([...Array(2000).keys()].filter((k) => controlOf(arms, 'suburb', 'british', (k + 0.5) / 2000) === 'roundabout').length);
  expect(count(0.5)).toBeGreaterThan(count(0));
  expect(count(1)).toBeGreaterThan(3 * count(0));
  // At 200% even a junction of two quiet streets, which real towns never make one, nearly always is.
  expect(controlOf(['minor', 'minor', 'minor'], 'suburb', 'central', 0.9, 2)).toBe('roundabout');
});

test('crossings at a junction with signals have signals, and stand beyond the kerb of the widest street there', () => {
  const ways: Way[] = [
    { pts: [0, 0, 100, 0], kind: 'road', width: 13, cls: 'primary' },
    { pts: [0, 0, -100, 0], kind: 'road', width: 13, cls: 'primary' },
    { pts: [0, 0, 0, 100], kind: 'road', width: 8, cls: 'minor' },
  ];
  const all = crossingsOf(ways, [0, 0], [], () => 'blocks', 'central', () => 0);
  const atJunction = all.filter((c) => Math.hypot(c.x, c.y) < 20);
  expect(atJunction.length).toBe(3);
  for (const c of atJunction) {
    expect(c.kind).toBe('signals');
    expect(Math.hypot(c.x, c.y)).toBeGreaterThanOrEqual(13 / 2 + 2.5 - 1e-9);
  }
});
