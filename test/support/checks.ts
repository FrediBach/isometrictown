/**
 * Rules every drawn sheet must keep, map or image: strokes are finite and on the sheet, features
 * stay in the drawing area and are filed and catalogued, planning loses no ink, and the SVG
 * reads back as plotted. Call inside a `describe` once the sheet is drawn in `beforeAll`.
 */
import { expect, test } from 'vitest';
import { ENTRIES, filed, matcher } from '@/catalogue';
import { layersOf } from '@/gcode';
import type { Settings } from '@/settings';
import { length, type Sheet } from './draw';

/** Every catalogue stroke pattern that names a feature or a facet (a bare `*` takes anything, so it proves nothing). */
const claims = ENTRIES.flatMap((e) => (e.strokes ?? []).filter((p) => p !== '*').map(matcher));

export function sheetChecks(sheet: () => Sheet, set: Settings): void {
  test('draws something with every pen it should', () => {
    const s = sheet();
    expect(s.stats.lifts).toBeGreaterThan(1000);
    const used = s.pens.map((p) => p.length > 0);
    if (set.mono) expect(used).toEqual([false, false, false, false, true]);
    else expect(used[4]).toBe(true);
  });

  test('every stroke is a finite polyline on the sheet', () => {
    const s = sheet();
    const [w, h] = s.cam.sheet;
    for (const pen of s.raw)
      for (const l of pen) {
        expect(l.length % 2).toBe(0);
        expect(l.length).toBeGreaterThanOrEqual(4);
        for (let i = 0; i < l.length; i += 2) {
          const x = l[i];
          const y = l[i + 1];
          if (!(Number.isFinite(x) && Number.isFinite(y) && x >= -0.01 && y >= -0.01 && x <= w + 0.01 && y <= h + 0.01)) expect.fail(`stroke off the sheet or not finite: (${x}, ${y})`);
        }
      }
  });

  test('features stay inside the drawing area', () => {
    const s = sheet();
    const [x0, y0, x1, y1] = s.cam.rect;
    const tol = 0.05;
    const out: string[] = [];
    for (const [name, lines] of s.tally)
      for (const l of lines)
        for (let i = 0; i < l.length; i += 2)
          if (l[i] < x0 - tol || l[i] > x1 + tol || l[i + 1] < y0 - tol || l[i + 1] > y1 + tol) {
            out.push(`${name} (${l[i].toFixed(2)}, ${l[i + 1].toFixed(2)})`);
            break;
          }
    expect(out.slice(0, 10)).toEqual([]);
  });

  test('every stroke is filed under a feature, except the frame and map notes', () => {
    const s = sheet();
    const filedCount = [...s.tally.values()].reduce((n, l) => n + l.length, 0);
    const rawCount = s.raw.reduce((n, p) => n + p.length, 0);
    const margin = rawCount - filedCount;
    expect(margin).toBeGreaterThanOrEqual(0);
    if (!set.frame && !set.marginalia) expect(margin).toBe(0);
    // Frame and notes are a few hundred strokes at most, never a feature that lost its tally.
    expect(margin).toBeLessThan(1500);
  });

  test('every feature drawn has a catalogue entry', () => {
    const s = sheet();
    const orphans = [...s.tally.keys()].filter((name) => !claims.some((m) => m(filed(name))));
    expect(orphans).toEqual([]);
  });

  test('planning joins and orders strokes without losing ink', () => {
    const s = sheet();
    const rawInk = s.raw.reduce((t, p) => t + p.reduce((u, l) => u + length(l), 0), 0);
    // Joining snaps ends that meet within 0.03 mm, so ink moves by a hair at each join, never by a
    // stroke. Dense rows of buildings make tens of thousands of joins, so the hair is per join.
    const joins = s.stats.rawLifts - s.stats.lifts;
    expect(Math.abs(s.stats.ink - rawInk)).toBeLessThan(Math.max(1e-5 * rawInk, 2e-4 * joins));
    expect(s.stats.lifts).toBeLessThanOrEqual(s.stats.rawLifts);
    expect(s.stats.travel).toBeLessThan(s.stats.rawTravel);
  });

  test('the SVG reads back stroke for stroke, as the plotter will get it', () => {
    const s = sheet();
    const layers = layersOf(s.svg);
    expect(layers.reduce((n, l) => n + l.lines.length, 0)).toBe(s.stats.lifts);
    for (const l of layers) expect(l.color).toBe(set.mono ? '#000000' : set.pens[l.pen]);
  });
}
