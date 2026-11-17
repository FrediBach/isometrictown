/**
 * Whole drawings of the golden cases, from recorded map data. Each case is checked against
 * its golden file (`test/golden/<id>.json`) and against rules every drawing must keep.
 *
 * A golden that changes is not a failure in itself: it says the drawing changed. If the change
 * is meant, look at the SVGs written to `test/out/` (and the LOD lab for close-ups), then
 * accept it with `npm run test:update`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { CASES } from '../cases';
import { sheetChecks } from '../support/checks';
import { pinClock } from '../support/clock';
import { draw, pretty, summary, type Sheet } from '../support/draw';

pinClock();

const OUT = path.resolve(import.meta.dirname, '../out');
mkdirSync(OUT, { recursive: true });

const sheets = new Map<string, Sheet>();

describe.each(CASES)('$id', ({ id, what, set }) => {
  let s: Sheet;
  beforeAll(async () => {
    s = await draw(set);
    sheets.set(id, s);
    writeFileSync(path.join(OUT, `${id}.svg`), s.svg);
  });

  test(`matches its golden: ${what}`, async () => {
    await expect(`${pretty(summary(s))}\n`).toMatchFileSnapshot(`../golden/${id}.json`);
  });

  sheetChecks(() => s, set);
});

test('drawing is repeatable, and earlier drawings leave nothing behind', async () => {
  // mollis-default was drawn first; drawing it again after every other Mollis case shares
  // its cached tiles and classified buildings, so any leak between drawings shows here.
  const first = sheets.get('mollis-default')!;
  const again = await draw(first.set);
  expect(again.svg === first.svg).toBe(true);
});
