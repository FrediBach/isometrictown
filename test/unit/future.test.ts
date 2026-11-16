import { describe, expect, test } from 'vitest';
import type { Info } from '@/classify';
import { climateFor, climateOf, planFuture } from '@/future';
import { DEFAULT_SETTINGS, lockKey, type Settings } from '@/settings';
import type { Building, Town } from '@/tiles';

/** A square building of `size` metres at (x, y), as classify() would leave it. */
function building(x: number, y: number, size: number, info: Partial<Info>): Building {
  const h = size / 2;
  return {
    shape: [{ pts: [x - h, y - h, x + h, y - h, x + h, y + h, x - h, y + h], seam: new Uint8Array(4) }],
    h: 8,
    min: 0,
    info: { kind: 'house', roof: 'gabled', party: new Float32Array(4), shop: false, castle: false, hospital: false, townHall: false, seed: [Math.round(x), Math.round(y)], ...info } as Info,
  };
}

const key = (x: number, y: number): [number, number] => [Math.round(x), Math.round(y)];
const set = (more: Partial<Settings> = {}): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), solarpunk: true, ...more });

/** A street of houses, a church, a castle and a block of flats. */
function town(): Town {
  const buildings: Building[] = [];
  for (let i = 0; i < 60; i++) buildings.push(building(i * 20, 0, 10, {}));
  buildings.push(building(0, 100, 20, { kind: 'worship', roof: 'church' }));
  buildings.push(building(40, 100, 30, { kind: 'house', roof: 'flat', castle: true }));
  buildings.push(building(80, 100, 25, { kind: 'apartment', roof: 'flat' }));
  return { buildings } as Town;
}

const plans = (t: Town) => t.buildings.map((b) => JSON.stringify(b.future));

describe('climate', () => {
  test('follows the region', () => {
    expect(climateOf('arid', [30, 30])).toBe('hot_dry');
    expect(climateOf('tropical', [-60, -3])).toBe('hot_humid');
    expect(climateOf('tropical', [100, 14])).toBe('monsoonal');
    expect(climateOf('nordic', [18, 60])).toBe('cold');
    expect(climateOf('alpine', [9, 47])).toBe('mountain');
    expect(climateOf('central', [10, 50])).toBe('temperate');
    expect(climateOf('american', [-112, 33])).toBe('hot_dry');
    expect(climateOf('american', [-74, 40.7])).toBe('temperate');
  });

  test('a chosen climate wins over the region', () => {
    expect(climateFor({ climate: 'coastal', center: [9, 47] }, 'alpine')).toBe('coastal');
    expect(climateFor({ climate: 'auto', center: [9, 47] }, 'alpine')).toBe('mountain');
  });
});

describe('planFuture', () => {
  test('is the same however the drawing is viewed', () => {
    const a = town();
    const b = town();
    planFuture(a, set(), 'central', key);
    planFuture(b, set({ scale: 8000, bearing: 200, tilt: 50, detail: 2, penWidth: 0.7 }), 'central', key);
    expect(plans(a)).toEqual(plans(b));
  });

  test('gives most houses panels, and keeps landmarks and churches as they are', () => {
    const t = town();
    planFuture(t, set(), 'central', key);
    const houses = t.buildings.slice(0, 60);
    const pv = houses.filter((b) => b.future!.roofPv).length;
    expect(pv).toBeGreaterThan(30);
    expect(pv).toBeLessThan(60);
    const [church, castle, flats] = t.buildings.slice(60);
    expect(church.future).toMatchObject({ recipe: 'B16', roofPv: false, greenRoof: false });
    expect(castle.future).toMatchObject({ recipe: 'B28', roofPv: false, greenRoof: false });
    expect(flats.future!.recipe).toBe('B04');
  });

  test('intensity adds changes without taking any away', () => {
    const low = town();
    const high = town();
    planFuture(low, set({ future: 0.1 }), 'central', key);
    planFuture(high, set({ future: 0.9 }), 'central', key);
    for (let i = 0; i < low.buildings.length; i++) {
      const a = low.buildings[i].future!;
      const b = high.buildings[i].future!;
      if (a.roofPv) expect(b.roofPv).toBe(true);
      if (a.tank) expect(b.tank).toBe(true);
    }
    expect(high.buildings.filter((b) => b.future!.roofPv).length).toBeGreaterThan(low.buildings.filter((b) => b.future!.roofPv).length);
  });

  test('a hot, dry climate plants no roofs and stores more rain', () => {
    const dry = town();
    const wet = town();
    planFuture(dry, set({ climate: 'hot_dry' }), 'central', key);
    planFuture(wet, set({ climate: 'temperate' }), 'central', key);
    expect(dry.buildings.some((b) => b.future!.greenRoof)).toBe(false);
    expect(dry.buildings.filter((b) => b.future!.tank).length).toBeGreaterThan(wet.buildings.filter((b) => b.future!.tank).length);
  });

  test('a locked building rerolls its own future and no other', () => {
    const a = town();
    const b = town();
    planFuture(a, set(), 'central', key);
    // Find a lock that changes the first house's plan.
    let locked: Settings | undefined;
    for (let seed = 2; seed < 40 && !locked; seed++) {
      const s = set({ seedLocks: { [lockKey(b.buildings[0].info!.seed)]: seed } });
      const c = town();
      planFuture(c, s, 'central', key);
      if (JSON.stringify(c.buildings[0].future) !== JSON.stringify(a.buildings[0].future)) locked = s;
    }
    expect(locked).toBeDefined();
    planFuture(b, locked!, 'central', key);
    expect(plans(b).slice(1)).toEqual(plans(a).slice(1));
  });
});
