import { describe, expect, test } from 'vitest';
import { harmonise, paletteSource } from '@/harmony';
import { letter, letterable, measure } from '@/lettering';
import { currentPalette, PALETTES } from '@/palettes';
import { DEFAULT_SETTINGS, DETAIL_LAYERS, layerDetail, layerPen, lockKey, PEN_COUNT, seedFor, sheetSize, SHEETS } from '@/settings';
import { detectRegion, STYLES } from '@/styles';
import { titleText } from '@/title';

describe('settings', () => {
  test('defaults are valid', () => {
    expect(DEFAULT_SETTINGS.pens).toHaveLength(PEN_COUNT);
    for (const c of DEFAULT_SETTINGS.pens) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(SHEETS[DEFAULT_SETTINGS.sheet]).toBeDefined();
    expect(DETAIL_LAYERS).not.toContain('margin');
    expect(DETAIL_LAYERS).not.toContain('shadeWalls');
  });

  test('sheets are landscape and turn for portrait', () => {
    for (const s of Object.values(SHEETS)) expect(s.size[0]).toBeGreaterThanOrEqual(s.size[1]);
    expect(sheetSize({ sheet: 'a4', landscape: false })).toEqual([210, 297]);
  });

  test('per-layer Detail and pens only apply when switched on', () => {
    const s = { ...DEFAULT_SETTINGS, layerDetail: { trees: 2 }, layerPens: { trees: 1 } };
    expect(layerDetail(s, 'trees')).toBe(1);
    expect(layerDetail({ ...s, customLayerDetail: true }, 'trees')).toBe(2);
    expect(layerDetail({ ...s, customLayerDetail: true }, 'windows')).toBe(1);
    expect(layerPen(s, 'trees', 2)).toBe(2);
    expect(layerPen({ ...s, customLayerPens: true }, 'trees', 2)).toBe(1);
    expect(layerPen({ ...s, customLayerPens: true }, 'roofs', 3)).toBe(3);
  });

  test('seed locks', () => {
    const s = { ...DEFAULT_SETTINGS, seed: 5, seedLocks: { [lockKey([3, -4])]: 9 } };
    expect(seedFor(s, [3, -4])).toBe(9);
    expect(seedFor(s, [3, 4])).toBe(5);
    expect(seedFor(s, undefined)).toBe(5);
  });
});

describe('regions', () => {
  test.each([
    [[9.0744, 47.0934], 'CH', 'alpine', false],
    [[4.8862, 52.3727], 'NL', 'dutch', false],
    [[0.7335, 50.9503], 'GB', 'british', true],
    [[-73.984, 40.7549], 'US', 'american', false],
    [[10.4878, 48.8518], 'DE', 'central', false],
    [[139.7, 35.68], 'JP', 'eastAsian', true],
    [[0, -60], '', 'generic', false],
  ] as const)('%j is %s, %s', async (at, code, style, left) => {
    const r = await detectRegion([...at]);
    expect([r.code, r.style, r.left]).toEqual([code, style, left]);
    expect(STYLES[r.style]).toBeDefined();
  });
});

describe('lettering', () => {
  test('letterable knows its glyphs, accents included', () => {
    expect(letterable('Nördlingen')).toBe(true);
    expect(letterable('Zürich 2')).toBe(true);
    expect(letterable('東京')).toBe(false);
  });

  test('measure scales with cap height and letter makes strokes within it', () => {
    const w = measure('MOLLIS', 6);
    expect(w).toBeGreaterThan(0);
    expect(measure('MOLLIS', 12)).toBeCloseTo(w * 2, 9);
    expect(measure('', 6)).toBe(0);
    const lines = letter('MOLLIS', 100, 50, { h: 6, align: 'center' });
    const xs = lines.flatMap((l) => l.filter((_, i) => i % 2 === 0));
    const ys = lines.flatMap((l) => l.filter((_, i) => i % 2 === 1));
    expect(Math.min(...xs)).toBeCloseTo(100 - w / 2, 6);
    expect(Math.max(...xs)).toBeCloseTo(100 + w / 2, 6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(44 - 1e-9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(50 + 1e-9);
  });

  test('titleText keeps only what can be lettered', () => {
    expect(titleText('', 'Mollis')).toBe('Mollis');
    expect(titleText('  Big   Town 東 ', 'x')).toBe('Big Town');
  });
});

describe('palettes', () => {
  test('every palette has five valid pens, linework the darkest', () => {
    for (const p of PALETTES) {
      expect(p.pens).toHaveLength(PEN_COUNT);
      for (const c of p.pens) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(currentPalette(p.pens.map((c) => c.toUpperCase()))).toBe(p);
    }
  });

  test('harmonise keeps locked pens and returns valid colours', () => {
    const pens = PALETTES[0].pens;
    for (let i = 0; i < 10; i++) {
      const { pens: out, scheme } = harmonise(pens, [true, false, false, true, false]);
      expect(out[0]).toBe(pens[0]);
      expect(out[3]).toBe(pens[3]);
      for (const c of out) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(scheme).not.toBe('');
    }
    expect(paletteSource(pens, 'X')).toBe(`{ name: 'X', pens: [${pens.map((c) => `'${c}'`).join(', ')}] },`);
  });
});
