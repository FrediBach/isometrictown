import { describe, expect, test } from 'vitest';
import type { Build } from '@/buildings';
import { Camera } from '@/camera';
import { gone, kept, LEAVES, left, parkedCar, past, phaseName, resistance } from '@/decay';
import { DEFAULT_SETTINGS } from '@/settings';
import { STYLES } from '@/styles';

/** A Build whose local origin sits at (ox, oy) in map metres, as a pan would move it. */
function build(abandon: number, ox = 0, oy = 0): Build {
  const set = { ...DEFAULT_SETTINGS, abandon };
  const toAbs = (x: number, y: number): [number, number] => [x + ox, y + oy];
  return {
    set, cam: new Camera(set), style: STYLES.alpine, seed: set.seed, sun: [1, 0], equator: [0, -1], left: false, toAbs,
    key: (x, y) => [Math.round(x + ox), Math.round(y + oy)],
    cell: (x, y, size) => [Math.round((x + ox) / size), Math.round((y + oy) / size)],
  };
}

const SPOTS: [number, number][] = Array.from({ length: 400 }, (_, i) => [((i * 37) % 911) * 3.1 - 1400, ((i * 53) % 677) * 2.9 - 980]);
const STEPS = Array.from({ length: 21 }, (_, i) => i / 20);

describe('abandonment', () => {
  test('names the phases', () => {
    expect(phaseName(0.1)).toBe('Emptying');
    expect(phaseName(0.4)).toBe('Neglect');
    expect(phaseName(0.7)).toBe('Collapse');
    expect(phaseName(1)).toBe('Overgrown ruins');
  });

  test('at 0 nothing has gone, and at the end of its span everything has', () => {
    for (const kind of Object.keys(LEAVES) as (keyof typeof LEAVES)[]) {
      const [, end] = LEAVES[kind];
      for (const [x, y] of SPOTS) {
        expect(left(build(0), kind, x, y, 9900)).toBe(false);
        expect(left(build(end), kind, x, y, 9900)).toBe(true);
      }
    }
    for (const [x, y] of SPOTS) expect(parkedCar(build(0), x, y)).toBe('car');
  });

  test('nothing comes back as the slider rises', () => {
    for (const [x, y] of SPOTS) {
      let was = false;
      let car: ReturnType<typeof parkedCar> = 'car';
      for (const d of STEPS) {
        const now = gone(build(d), x, y, 0.1, 0.6, 9900);
        if (was) expect(now).toBe(true);
        was = now;
        // A parked car goes from car to wreck to nothing, or straight from car to nothing.
        const fate = parkedCar(build(d), x, y);
        if (car === 'wreck') expect(fate).not.toBe('car');
        if (car === null) expect(fate).toBe(null);
        car = fate;
      }
    }
    for (let r = 0; r < 1; r += 0.05) {
      let was = false;
      for (const d of STEPS) {
        const now = past(build(d), 'traffic', r);
        if (was) expect(now).toBe(true);
        was = now;
      }
    }
  });

  test('things go over the span, not all at once', () => {
    const share = SPOTS.filter(([x, y]) => gone(build(0.35), x, y, 0.1, 0.6, 9900)).length / SPOTS.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.8);
  });

  test('fates stay put on the map when the view pans', () => {
    const [ox, oy] = [123, -457];
    for (const [x, y] of SPOTS) {
      expect(resistance(build(0.4, ox, oy), x - ox, y - oy, 9900)).toBeCloseTo(resistance(build(0.4), x, y, 9900), 9);
      expect(parkedCar(build(0.4, ox, oy), x - ox, y - oy)).toBe(parkedCar(build(0.4), x, y));
    }
  });

  test('kept runs of a line only shrink, and are the line itself at 0', () => {
    const line = [0, 0, 40, 0, 40, 30, 90, 30];
    expect(kept(build(0), line, 'paths', 9900)).toEqual([line]);
    const length = (ps: number[][]) => ps.reduce((a, p) => a + p.reduce((l, _, i) => (i >= 2 && i % 2 === 0 ? l + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]) : l), 0), 0);
    let last = Infinity;
    for (const d of STEPS) {
      const l = length(kept(build(d), line, 'paths', 9900));
      expect(l).toBeLessThanOrEqual(last + 1e-9);
      last = l;
    }
    expect(last).toBe(0);
  });
});
