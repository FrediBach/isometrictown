/**
 * Made-up detail is fixed to the map, so panning the view must move it with the map, not
 * reshuffle it. With the view facing north a pan east is a plain shift across the sheet, so
 * away from the edges the two drawings must lay the same strokes, shifted.
 */
import { beforeAll, expect, test } from 'vitest';
import { EARTH } from '@/geo';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { pinClock } from '../support/clock';
import { draw, type Sheet } from '../support/draw';

pinClock();

// A shift of whole raster pixels (7 per mm at most), so the depth buffer lines up too.
const SHIFT_M = 30;
const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), osmTags: false, bearing: 0, sheet: 'a4', marginalia: false, frame: false };
const lat = set.center[1];
const panned: Settings = { ...set, center: [set.center[0] + (SHIFT_M / (EARTH * Math.cos((lat * Math.PI) / 180))) * 360, lat] };

let a: Sheet;
let b: Sheet;
beforeAll(async () => {
  [a, b] = [await draw(set), await draw(panned)];
});

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

function stayPut(prefix: string) {
  const [x0, y0, x1, y1] = a.cam.rect;
  const dx = SHIFT_M * a.cam.s;
  // Well inside both drawings, clear of edge effects.
  const win: [number, number, number, number] = [x0 + 40, y0 + 30, x1 - 40 - dx, y1 - 30];
  const here = segments(a, prefix, -dx, [win[0] - dx, win[1], win[2] - dx, win[3]]);
  const there = segments(b, prefix, 0, [win[0] - dx, win[1], win[2] - dx, win[3]]);
  const same = [...here].filter((k) => there.has(k)).length;
  expect(here.size).toBeGreaterThan(20);
  expect(same / Math.max(here.size, there.size)).toBeGreaterThan(0.98);
}

test.each(['trees', 'life', 'details', 'windows', 'ground'])('%s stay put on the map when the view pans', stayPut);

// Known bug: traffic is spaced along each way from its first point, and ways are cut where
// the loaded area ends, so a pan that moves the cut reshuffles every car on that road (about
// a third of them here). Flip to `test` once cars are keyed to the map.
test.fails('cars stay put on the map when the view pans', () => stayPut('cars'));
