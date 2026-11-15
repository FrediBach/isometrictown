import { describe, expect, test } from 'vitest';
import { bedSize, DEFAULT_SETUP, gcodeFile, layersOf, machine, type PlotterSetup } from '@/gcode';
import { join, order, pathData, plan, recolor, toSvg } from '@/plot';
import { DEFAULT_SETTINGS, PEN_COUNT, type Settings } from '@/settings';

const set: Settings = structuredClone(DEFAULT_SETTINGS);
const empty = () => Array.from({ length: PEN_COUNT }, () => [] as number[][]);

describe('join', () => {
  test('chains strokes that meet, in either direction', () => {
    const out = join([[0, 0, 1, 0], [2, 0, 1, 0], [2, 0, 2, 1]]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual([0, 0, 1, 0, 2, 0, 2, 1]);
  });

  test('extends backwards from the first stroke too', () => {
    const out = join([[1, 0, 2, 0], [0, 0, 1, 0]]);
    expect(out).toEqual([[0, 0, 1, 0, 2, 0]]);
  });

  test('leaves strokes apart that do not meet', () => {
    expect(join([[0, 0, 1, 0], [5, 5, 6, 6]])).toHaveLength(2);
  });
});

describe('order', () => {
  test('visits every stroke once, nearest first, flipping when the far end is nearer', () => {
    const lines = [[50, 50, 60, 50], [11, 0, 10, 0], [0, 1, 0, 5]];
    const out = order(lines);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual([0, 1, 0, 5]);
    expect(out[1]).toEqual([10, 0, 11, 0]);
    expect(out[2]).toEqual([50, 50, 60, 50]);
  });
});

describe('plan', () => {
  test('keeps all ink, never adds lifts and costs time', () => {
    const raw = empty();
    raw[4] = [[0, 0, 10, 0], [10, 0, 10, 10], [30, 30, 40, 30]];
    raw[1] = [[5, 5, 5, 6]];
    const { pens, stats } = plan(raw, set);
    expect(stats.rawLifts).toBe(4);
    expect(stats.lifts).toBe(3);
    expect(stats.ink).toBeCloseTo(31, 9);
    expect(pens[4]).toHaveLength(2);
    expect(stats.seconds).toBeGreaterThan(stats.ink / set.speed);
  });

  test('mono puts every pen on the linework pen', () => {
    const raw = empty();
    raw[0] = [[0, 0, 1, 0]];
    raw[2] = [[5, 5, 6, 5]];
    const { pens } = plan(raw, { ...set, mono: true });
    expect(pens.map((p) => p.length)).toEqual([0, 0, 0, 0, 2]);
  });
});

describe('SVG and G-code', () => {
  const raw = empty();
  raw[0] = [[20, 20, 30.123, 25.456]];
  raw[4] = [[100, 100, 200, 100, 200, 150], [300, 200, 310, 210]];
  const planned = plan(raw, set);
  const svg = toSvg(planned.pens, set, [420, 297]);

  test('the SVG is a millimetre sheet with one Inkscape layer per used pen', () => {
    expect(svg).toContain('width="420mm" height="297mm" viewBox="0 0 420 297"');
    expect(svg.match(/inkscape:groupmode="layer"/g)).toHaveLength(2);
    expect(svg).toContain('Map data © OpenStreetMap contributors');
    expect(pathData([[1.005, 2, 3.333333, 4]])).toBe('M1 2L3.33 4');
  });

  test('place names are escaped', () => {
    expect(toSvg(planned.pens, { ...set, place: 'A & <B> "C"' }, [420, 297])).toContain('<title>A &amp; &lt;B&gt; &quot;C&quot;, Isometric Town</title>');
  });

  test('recolor swaps pen colours and the background without a redraw', () => {
    const next = { ...set, pens: ['#000001', '#000002', '#000003', '#000004', '#000005'] as Settings['pens'], customBackground: true, background: '#fafafa' };
    const out = recolor({ svg, stats: planned.stats }, next);
    expect(out.svg).toContain('stroke="#000001"');
    expect(out.svg).toContain('stroke="#000005"');
    expect(out.svg).toContain('style="background-color:#fafafa"');
    expect(out.stats.pens[4].color).toBe('#000005');
    // Doing it twice must not stack styles.
    expect(recolor(out, next).svg.match(/background-color/g)).toHaveLength(1);
    expect(out.svg.replace(/stroke="#[0-9a-f]{6}"/g, '').replace(/ style="[^"]*"/, '')).toBe(svg.replace(/stroke="#[0-9a-f]{6}"/g, ''));
  });

  test('layersOf reads back exactly what toSvg wrote', () => {
    const layers = layersOf(svg);
    expect(layers.map((l) => [l.pen, l.label, l.color])).toEqual([
      [0, 'Shadows', set.pens[0]],
      [4, 'Linework', set.pens[4]],
    ]);
    const round = (l: number[][]) => l.map((s) => s.map((v) => Math.round(v * 100) / 100));
    expect(layers[0].lines).toEqual(round(planned.pens[0]));
    expect(layers[1].lines).toEqual(round(planned.pens[4]));
  });

  test.each<[string, PlotterSetup, [number, number], [number, number]]>([
    ['top left', DEFAULT_SETUP, [10, 20], [10, 20]],
    ['bottom left', { ...DEFAULT_SETUP, corner: 'bottom-left' }, [10, 20], [10, 277]],
    ['turned', { ...DEFAULT_SETUP, turn: true }, [10, 20], [277, 10]],
    ['turned, bottom left', { ...DEFAULT_SETUP, turn: true, corner: 'bottom-left' }, [10, 20], [277, 410]],
  ])('machine coordinates: %s', (_n, setup, at, want) => {
    expect(machine([420, 297], setup)(...at)).toEqual(want);
  });

  test('every move stays on the bed, the pen is up for every travel and each pen gets a pause', () => {
    for (const setup of [DEFAULT_SETUP, { ...DEFAULT_SETUP, turn: true, corner: 'bottom-left' as const }]) {
      const code = gcodeFile(layersOf(svg), { title: 'T\nwo lines', sheet: [420, 297], setup, feed: 2400 });
      const lines = code.split('\n');
      expect(lines.slice(0, 2).every((l) => l.startsWith(';'))).toBe(true);
      expect(code).toContain('G21\nG90\nG1 Z0 F2500\nG92 X0 Y0');
      expect(lines.filter((l) => l.startsWith('M0'))).toHaveLength(1);
      expect(lines.at(-2)).toBe('G0 X0 Y0');
      const [bw, bh] = bedSize([420, 297], setup);
      let down = false;
      for (const l of lines) {
        if (l.startsWith(';') || !l) continue;
        if (/^G1 Z10\b/.test(l)) down = true;
        else if (/^G1 Z0\b/.test(l)) down = false;
        else if (l.startsWith('G0')) expect(down, `travel with the pen down: ${l}`).toBe(false);
        const x = /X(-?[\d.]+)/.exec(l);
        const y = /Y(-?[\d.]+)/.exec(l);
        if (x) expect(Number(x[1]), l).toSatisfy((v: number) => v >= 0 && v <= bw);
        if (y) expect(Number(y[1]), l).toSatisfy((v: number) => v >= 0 && v <= bh);
      }
      expect(down).toBe(false);
    }
  });
});
