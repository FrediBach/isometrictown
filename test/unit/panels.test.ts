import { describe, expect, test } from 'vitest';
import { Camera } from '@/camera';
import { layersOf } from '@/gcode';
import { clipToRects, layout, panelAt, panelCount, panelOrigin, panelSvg, planDrawing, trimToPanels } from '@/panels';
import { toSvg } from '@/plot';
import { DEFAULT_SETTINGS, PEN_COUNT, type Settings } from '@/settings';

const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), sheet: 'a4', landscape: true, panelCols: 3, panelRows: 2, panelGap: 30 };
const empty = () => Array.from({ length: PEN_COUNT }, () => [] as number[][]);

describe('layout', () => {
  test('hangs the sheets with the gap between their edges', () => {
    const l = layout(set);
    expect(l.sheet).toEqual([297, 210]);
    expect(l.wall).toEqual([3 * 297 + 2 * 30, 2 * 210 + 30]);
    expect(panelCount(l)).toBe(6);
    expect(panelOrigin(l, 4)).toEqual([327, 240]);
    expect(panelAt(l, 330, 250)).toBe(4);
    expect(panelAt(l, 310, 100)).toBe(-1);
  });

  test('one sheet has no gap and keeps the sheet as it was', () => {
    const one = layout({ ...set, panelCols: 1, panelRows: 1 });
    expect(one.gap).toBe(0);
    expect(one.wall).toEqual([297, 210]);
    const a = new Camera({ ...DEFAULT_SETTINGS });
    expect(a.panels).toEqual([a.rect]);
    expect(a.sheet).toEqual([420, 297]);
  });

  test('every sheet of a set has the same margins, and the drawing runs on across the gaps', () => {
    const cam = new Camera(set);
    const [m, foot] = cam.margins;
    expect(cam.panels).toHaveLength(6);
    expect(cam.panels[0]).toEqual([m, m, 297 - m, 210 - m - foot]);
    expect(cam.panels[5]).toEqual([2 * 327 + m, 240 + m, 2 * 327 + 297 - m, 240 + 210 - m - foot]);
    // One metre on the ground is as long on every sheet, and the camera is the one for the whole wall.
    const single = new Camera({ ...set, panelCols: 1, panelRows: 1 });
    expect(cam.s).toBe(single.s);
    expect(cam.cx).toBe(cam.sheet[0] / 2);
  });
});

describe('clipToRects', () => {
  const rects = [[0, 0, 10, 10], [20, 0, 30, 10]] as const;

  test('keeps a stroke inside one rectangle as it is', () => {
    const line = [1, 1, 5, 5];
    expect(clipToRects(line, rects)[0]).toBe(line);
  });

  test('cuts a stroke across a gap into the pieces on either side', () => {
    expect(clipToRects([5, 5, 25, 5], rects)).toEqual([[5, 5, 10, 5], [20, 5, 25, 5]]);
  });

  test('drops what lies only in the gap', () => {
    expect(clipToRects([12, 2, 18, 8], rects)).toEqual([]);
  });

  test('breaks a polyline where it leaves and comes back', () => {
    expect(clipToRects([2, 5, 8, 5, 8, 15, 4, 15, 4, 5, 6, 5], [[0, 0, 10, 10]])).toEqual([[2, 5, 8, 5, 8, 10], [4, 10, 4, 5, 6, 5]]);
  });

  test('trimming keeps the catalogue on the same strokes', () => {
    const pens = empty();
    const inside = [1, 1, 2, 2];
    const across = [5, 5, 25, 5];
    pens[4].push(inside, across);
    const tally = new Map([['streets', [inside, across]]]);
    trimToPanels(pens, tally, rects);
    expect(pens[4]).toEqual([inside, [5, 5, 10, 5], [20, 5, 25, 5]]);
    expect(tally.get('streets')).toEqual(pens[4]);
    expect(tally.get('streets')![0]).toBe(pens[4][0]);
  });
});

describe('planDrawing and panelSvg', () => {
  test('one sheet writes what toSvg always wrote', () => {
    const pens = empty();
    pens[4].push([10, 10, 20, 20]);
    const one = { ...set, panelCols: 1, panelRows: 1 };
    expect(planDrawing(pens, one, layout(one)).svg).toBe(toSvg(pens, one, [297, 210]));
    expect(panelSvg(toSvg(pens, one, [297, 210]), layout(one), 0)).toBe(toSvg(pens, one, [297, 210]));
  });

  test('each sheet gets its own file, at its own size, with its strokes from its own corner', () => {
    const l = layout(set);
    const pens = empty();
    pens[0].push([340, 260, 350, 270]); // sheet 5
    pens[4].push([10, 10, 20, 20], [700, 300, 710, 300]); // sheets 1 and 6
    const { svg, stats } = planDrawing(pens, set, l);
    expect(svg).toContain(`viewBox="0 0 ${l.wall[0]} ${l.wall[1]}"`);
    expect(stats.lifts).toBe(3);
    expect(stats.ink).toBeCloseTo(Math.hypot(10, 10) * 2 + 10, 6);

    const first = panelSvg(svg, l, 0);
    expect(first).toContain('width="297mm" height="210mm" viewBox="0 0 297 210"');
    expect(first).toContain('sheet 1 of 6 (row 1, column 1)</title>');
    expect(first).not.toContain('data-panel');
    expect(layersOf(first).map((x) => [x.pen, x.lines])).toEqual([[4, [[10, 10, 20, 20]]]]);

    const fifth = layersOf(panelSvg(svg, l, 4));
    expect(fifth.map((x) => [x.pen, x.lines])).toEqual([[0, [[13, 20, 23, 30]]]]);
    const last = layersOf(panelSvg(svg, l, 5));
    expect(last.map((x) => [x.pen, x.lines])).toEqual([[4, [[700 - 654, 60, 710 - 654, 60]]]]);
    expect(layersOf(panelSvg(svg, l, 1))).toEqual([]);
  });
});
