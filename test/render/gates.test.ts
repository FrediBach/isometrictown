/**
 * Every setting that switches something on is switched off in turn, on one small sheet. What
 * the catalogue says needs that setting must then be gone, and the setting must have had
 * something to switch off.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { ENTRIES, filed, GATE_LABEL, matcher, type Gate } from '@/catalogue';
import type { Settings } from '@/settings';
import { CASES, GATE_BASE, RURAL_BASE } from '../cases';
import { pinClock } from '../support/clock';
import { draw, type Sheet } from '../support/draw';

pinClock();

/** The frame and notes are not filed in the tally; OSM tags need the network. They are checked elsewhere. */
const SKIP = new Set<Gate>(['frame', 'marginalia', 'osmTags']);
const GATES = (Object.keys(GATE_LABEL) as Gate[]).filter((g) => !SKIP.has(g));

const off = (set: Settings, g: Gate): Settings => ({ ...set, [g]: typeof set[g] === 'number' ? 0 : false });

/** Tally names on a sheet that some entry needing this gate claims. */
function gated(s: Sheet, g: Gate): string[] {
  const ms = ENTRIES.filter((e) => e.needs?.includes(g))
    .flatMap((e) => (e.strokes ?? []).filter((p) => p !== '*'))
    .map(matcher);
  return [...s.tally.keys()].filter((n) => ms.some((m) => m(filed(n))));
}

/** Switches the village doesn't have anything for. */
const RURAL = new Set<Gate>(['rails']);
// This recorded city has supported roadside wires; rural transmission runs may be rejected.
const POWER_BASE = CASES.find(c => c.id === 'midtown')!.set;
const baseSet = (g: Gate) => g === 'power' ? POWER_BASE : (RURAL.has(g) ? RURAL_BASE : GATE_BASE);
const bases = new Map<Settings, Promise<Sheet>>();
const baseFor = (g: Gate) => bases.get(baseSet(g)) ?? bases.set(baseSet(g), draw(baseSet(g))).get(baseSet(g))!;

let base: Sheet;
beforeAll(async () => {
  base = await baseFor('windows');
});

describe.each(GATES)('%s off', (g) => {
  let s: Sheet;
  let base: Sheet;
  beforeAll(async () => {
    base = await baseFor(g);
    s = await draw(off(baseSet(g), g));
  });

  test('takes away what needs it', () => {
    expect(gated(s, g)).toEqual([]);
  });

  test('had something to take away', () => {
    // Where the catalogue files the gate's strokes, they must have been there; otherwise the
    // sheet must at least lose strokes. (Not both: the title clears buildings, so taking it
    // away draws more.)
    if (gated(base, g).length) return;
    expect(s.stats.lifts).toBeLessThan(base.stats.lifts);
  });
});

test('wall hatching survives switching windows off', async () => {
  const bare = await draw({ ...GATE_BASE, windows: false });
  const hatching = (s: Sheet) => gated(s, 'shadeWalls').map((name) => s.tally.get(name));
  expect(hatching(base).length).toBeGreaterThan(0);
  expect(hatching(bare)).toEqual(hatching(base));
});

test('the frame and map notes only draw in the margin', async () => {
  const bare = await draw({ ...GATE_BASE, frame: false, marginalia: false });
  // Without notes the drawing area grows, so compare stroke counts, not drawings.
  const filed = (s: Sheet) => [...s.tally.values()].reduce((n, l) => n + l.length, 0);
  const raw = (s: Sheet) => s.raw.reduce((n, p) => n + p.length, 0);
  expect(raw(bare)).toBe(filed(bare));
  expect(raw(base) - filed(base)).toBeGreaterThan(10);
});
