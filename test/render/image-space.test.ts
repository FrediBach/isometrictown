import { expect, test } from 'vitest';
import { DEFAULT_SETUP, layerCode, layersOf } from '@/gcode';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { drawImage } from '../support/draw';
import { paint } from '../support/pictures';

test('a fully transparent picture exports bare paper while the frame and marginalia can still be plotted', () => {
  const pic = paint('Blank', () => [0, 0, 0, 0], 32, 32);
  const set: Settings = { ...DEFAULT_SETTINGS, source: 'image', image: pic.id, imageName: pic.name, sheet: 'a4', scale: 1000, imagePreserveSpace: true, humanize: 1 };
  const framed = drawImage(set, pic);
  expect(framed.tally.size).toBe(0);
  expect(framed.stats.ink).toBeGreaterThan(0);
  const blank = drawImage({ ...set, frame: false, marginalia: false }, pic);
  expect(blank.stats.ink).toBe(0);
  expect(blank.pens.flat()).toHaveLength(0);
});

/** Millimetres of stroke inside a rectangle, including segments whose endpoints are both outside. */
function inkIn(lines: number[][], [left, top, right, bottom]: number[], pad = 0): number {
  let ink = 0;
  for (const line of lines) for (let i = 2; i < line.length; i += 2) {
    const ax = line[i - 2], ay = line[i - 1], dx = line[i] - ax, dy = line[i + 1] - ay;
    let first = 0, last = 1;
    for (const [start, delta, lo, hi] of [[ax, dx, left - pad, right + pad], [ay, dy, top - pad, bottom + pad]]) {
      if (delta === 0) {
        if (start < lo || start > hi) last = -1;
      } else {
        const a = (lo - start) / delta, b = (hi - start) / delta;
        first = Math.max(first, Math.min(a, b));
        last = Math.min(last, Math.max(a, b));
      }
    }
    ink += Math.max(0, last - first) * Math.hypot(dx, dy);
  }
  return ink;
}

test('a transparent window stays clear up to the pen edge in the humanised drawing and its G-code', () => {
  const hole = [120, 85, 170, 120];
  // One source pixel per half millimetre of the A4 drawing area, with the window aligned to cells.
  const pic = paint('Transparent window', (u, v) => {
    const x = 20 + 257 * u, y = 20 + 170 * v, grey = 40 + 100 * u;
    const blank = x >= hole[0] && x < hole[2] && y >= hole[1] && y < hole[3];
    return [grey, grey, grey, blank ? 0 : 255];
  }, 514, 340);
  const set: Settings = { ...DEFAULT_SETTINGS, source: 'image', image: pic.id, sheet: 'a4', landscape: true, margin: 20, frame: false, marginalia: false, scale: 1500, humanize: 1 };
  const plain = drawImage(set, pic);
  expect(inkIn(plain.pens.flat(), hole, -5)).toBeGreaterThan(10);

  const protectedSheet = drawImage({ ...set, imagePreserveSpace: true }, pic);
  const plotted: number[][] = [];
  for (const layer of layersOf(protectedSheet.svg)) {
    for (const command of layerCode(layer, protectedSheet.cam.sheet, DEFAULT_SETUP, 2400)) {
      const move = /^G([01]) X([\d.-]+) Y([\d.-]+)/.exec(command);
      if (!move) continue;
      if (move[1] === '0') plotted.push([]);
      plotted[plotted.length - 1].push(Number(move[2]), Number(move[3]));
    }
  }
  for (const lines of [protectedSheet.pens.flat(), plotted]) {
    expect(inkIn(lines, hole, set.penWidth / 2)).toBe(0);
    expect(inkIn(lines, hole, 2)).toBeGreaterThan(10);
  }
});
