/**
 * Solarpunk mode adds to the drawing only while it is on: with it off, the other solarpunk
 * settings change nothing at all.
 */
import { expect, test } from 'vitest';
import { GATE_BASE } from '../cases';
import { pinClock } from '../support/clock';
import { draw } from '../support/draw';

pinClock();

test('solarpunk settings do nothing while the mode is off', async () => {
  const today = await draw({ ...GATE_BASE, title: false });
  const still = await draw({ ...GATE_BASE, title: false, future: 1, climate: 'hot_dry' });
  expect(still.svg).toBe(today.svg);
});

test('solarpunk mode draws panels and says so in the imprint', async () => {
  const future = await draw({ ...GATE_BASE, title: false, solarpunk: true });
  expect([...future.tally.keys()].some((k) => k.startsWith('solar'))).toBe(true);
  expect(future.svg).not.toBe((await draw({ ...GATE_BASE, title: false })).svg);
});
