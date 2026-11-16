/**
 * Made-up detail is fixed to the map, and so is everything worked out from the map, so panning
 * the view must move it with the map, not reshuffle it. With the view facing north a pan east is a plain shift across the sheet, so
 * away from the edges the two drawings must lay the same strokes, shifted.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import { EARTH } from '@/geo';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { pinClock } from '../support/clock';
import { draw, type Sheet } from '../support/draw';

pinClock();

const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), osmTags: false, bearing: 0, marginalia: false, frame: false };
const lat = set.center[1];
const pan = (m: number, from: Settings = set): Settings => ({ ...from, center: [from.center[0] + (m / (EARTH * Math.cos((lat * Math.PI) / 180))) * 360, lat] });

/** Segments of a feature inside a window, rounded to 0.05 mm, as a set of keys. */
function segments(s: Sheet, prefix: string, dx: number, win: [number, number, number, number]): Set<string> {
  const out = new Set<string>();
  const q = (v: number) => Math.round(v * 20);
  for (const [name, lines] of s.tally) {
    if (!name.startsWith(prefix)) continue;
    for (const l of lines)
      for (let i = 2; i < l.length; i += 2) {
        const x0 = l[i - 2] + dx;
        const x1 = l[i] + dx;
        const y0 = l[i - 1];
        const y1 = l[i + 1];
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        if (mx < win[0] || mx > win[2] || my < win[1] || my > win[3]) continue;
        const k = [q(x0), q(y0), q(x1), q(y1)];
        out.add(k[0] < k[2] || (k[0] === k[2] && k[1] < k[3]) ? k.join() : [k[2], k[3], k[0], k[1]].join());
      }
  }
  return out;
}

let base: Sheet;
beforeAll(async () => {
  base = await draw(set);
});

/** The same window test for one feature: what is near the middle of `a` is in `b`, shifted by `m` metres. */
function staysPut(a: Sheet, b: Sheet, m: number, prefix: string): void {
  const [x0, y0, x1, y1] = a.cam.rect;
  const dx = m * a.cam.s;
  // In the panned drawing's sheet mm, and 40 mm inside both drawings, clear of edge effects.
  const win: [number, number, number, number] = [x0 + 40, y0 + 30, x1 - 40 - dx, y1 - 30];
  const here = segments(a, prefix, -dx, win);
  const there = segments(b, prefix, 0, win);
  const same = [...here].filter((k) => there.has(k)).length;
  expect(here.size).toBeGreaterThan(20);
  expect(same / Math.max(here.size, there.size)).toBeGreaterThan(0.995);
}

// Shifts of whole raster pixels (7 per mm at most at 1:1000), so the depth buffers line up too.
// 47 m is a multiple of no grid the drawing uses, so a grid tied to the view would show.
describe.each([30, 47])('panned %i m east', (m) => {
  let b: Sheet;
  beforeAll(async () => {
    b = await draw(pan(m));
  });

  // Not shadows, park grass or water waves: they are tone hatching laid on the sheet's own grid.
  test.each(['trees', 'cars', 'life', 'details', 'windows', 'ground', 'buildings', 'roofs', 'roofHatch', 'streets'])('%s stay put on the map', (prefix) => {
    staysPut(base, b, m, prefix);
  });
});

// The solarpunk future is planned from the map too, so it pans with it.
describe.each([30, 47])('solarpunk, panned %i m east', (m) => {
  const future: Settings = { ...set, solarpunk: true };
  let a: Sheet;
  let b: Sheet;
  beforeAll(async () => {
    a = await draw(future);
    b = await draw(pan(m, future));
  });

  test.each(['solar', 'planting', 'roofHatch', 'rooftops', 'trees', 'cars'])('%s stay put on the map', (prefix) => {
    staysPut(a, b, m, prefix);
  });
});
