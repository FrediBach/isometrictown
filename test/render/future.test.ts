/**
 * Solarpunk mode adds to the drawing only while it is on: with it off, the other solarpunk
 * settings change nothing at all.
 */
import { expect, test } from 'vitest';
import { isFuture } from '@/catalogue';
import { GATE_BASE, SOLARPUNK_BASE } from '../cases';
import { pinClock } from '../support/clock';
import { draw } from '../support/draw';

pinClock();

test('solarpunk settings do nothing while the mode is off', async () => {
  const today = await draw({ ...GATE_BASE, title: false });
  const still = await draw({ ...GATE_BASE, title: false, future: 1, climate: 'hot_dry', depth: 'visionary' });
  expect(still.svg).toBe(today.svg);
});

test('solarpunk mode draws panels and says so in the imprint', async () => {
  const future = await draw({ ...GATE_BASE, title: false, solarpunk: true });
  expect([...future.tally.keys()].some((k) => k.startsWith('solar'))).toBe(true);
  expect(future.svg).not.toBe((await draw({ ...GATE_BASE, title: false })).svg);
});

test('every stroke the mode adds is counted as new ink', async () => {
  // The new-ink share (lab, docs/solarpunk/bolder-plan.md §8) counts what the Solarpunk group of
  // the catalogue claims. Anything drawn only in the mode, or in its own layers, must be claimed.
  const future = await draw(SOLARPUNK_BASE);
  const today = await draw({ ...SOLARPUNK_BASE, solarpunk: false });
  const ours = /^(solar|planting|additions)\b/;
  // Buildings are filed with what the plan gave them, and their roofs are rebuilt around panels,
  // so a building's own layers aren't new; anything else that only the mode draws is.
  const building = (k: string) => k.includes('/future-');
  const loose = [...future.tally.keys()].filter((k) => (ours.test(k) || (!building(k) && !today.tally.has(k))) && !isFuture(k));
  expect(loose).toEqual([]);
});
