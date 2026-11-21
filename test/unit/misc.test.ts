import { describe, expect, test, vi } from 'vitest';
import { Camera } from '@/camera';
import { Frame } from '@/geo';
import * as lettering from '@/lettering';
import { marginalia } from '@/marginalia';
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

test('image notes give the seed and byline, with optional ticks around the chosen centre', () => {
  const set = { ...DEFAULT_SETTINGS, source: 'image' as const, seed: 673, imageCreator: 'Fredi Bach', imageLatitude: -32, imageLongitude: -68 };
  const cam = new Camera(set);
  const frame = new Frame(set.center);
  const letters = vi.spyOn(lettering, 'letter');
  try {
    const date = new Date(2026, 10, 15);
    marginalia(set, cam, frame, date);
    const notes = letters.mock.calls.map(([line]) => line.toUpperCase());
    expect(notes.some((line) => line.startsWith('SEED 673 ·'))).toBe(true);
    expect(notes).toContain('DRAWN WITH ISOMETRICTOWN.COM BY FREDI BACH · NOVEMBER 2026');
    const ticks = () => letters.mock.calls.filter((call) => call[3].dir);
    expect(ticks()).toHaveLength(0);
    letters.mockClear();
    marginalia({ ...set, imageCoordinates: true }, cam, frame, date);
    const imageTicks = ticks();
    expect(imageTicks.length).toBeGreaterThan(0);
    letters.mockClear();
    marginalia({ ...set, source: 'map' }, cam, new Frame([set.imageLongitude, set.imageLatitude]), date);
    expect(ticks()).toEqual(imageTicks);
  } finally {
    letters.mockRestore();
  }
});

test.each([true, false])('frame coordinates stay readable with a broad pen (landscape %s)', (landscape) => {
  const draw = (penWidth: number, margin = 20) => {
    const set = { ...DEFAULT_SETTINGS, sheet: 'a4' as const, penWidth, margin, landscape };
    const cam = new Camera(set);
    const text = vi.spyOn(lettering, 'letter');
    marginalia(set, cam, new Frame(set.center), new Date('2026-11-15T12:00:00Z'));
    const labels = text.mock.calls.filter((call) => call[3].dir);
    text.mockRestore();
    return { cam, labels };
  };
  const regular = draw(0.35), broad = draw(0.7);
  expect(broad.labels.length).toBeGreaterThan(0);
  expect(broad.labels.length).toBeLessThan(regular.labels.length);
  for (const [text, x, y, options] of broad.labels) {
    expect(options.h).toBeGreaterThanOrEqual(4.8 * broad.cam.nib);
    for (const line of letter(text, x, y, options)) {
      for (let i = 0; i < line.length; i++) {
        expect(line[i]).toBeGreaterThanOrEqual(broad.cam.nib / 2);
        expect(line[i]).toBeLessThanOrEqual(broad.cam.sheet[i % 2] - broad.cam.nib / 2);
      }
    }
  }
  expect(draw(2, 6).labels).toHaveLength(0);
});


test.each([true, false])('broad-pen footer keeps readable credit and stays on the sheet (landscape %s)', (landscape) => {
  for (const margin of [10, 20, 30]) {
    const set = { ...DEFAULT_SETTINGS, sheet: 'a4' as const, landscape, margin, penWidth: 0.7 };
    const cam = new Camera(set);
    const text = vi.spyOn(lettering, 'letter');
    marginalia(set, cam, new Frame(set.center), new Date('2026-11-15T12:00:00Z'));
    const labels = text.mock.calls.filter((call) => !call[3].dir);
    text.mockRestore();
    expect(labels.some(([line]) => line.includes('OPENSTREETMAP'))).toBe(true);
    expect(labels.some(([line]) => line.includes('CONTRIBUTORS'))).toBe(true);
    const boxes = labels.map(([line, x, y, options]) => {
      const points = letter(line, x, y, options).flat();
      const xs = points.filter((_, i) => i % 2 === 0), ys = points.filter((_, i) => i % 2 === 1);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    });
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(a[2] + cam.nib <= b[0] || b[2] + cam.nib <= a[0] || a[3] + cam.nib <= b[1] || b[3] + cam.nib <= a[1], JSON.stringify({ margin, a: labels[i][0], b: labels[j][0] })).toBe(true);
    }
    for (const [line, x, y, options] of labels) {
      expect(options.h).toBeGreaterThanOrEqual(4.8 * cam.nib);
      for (const points of letter(line, x, y, options)) for (let i = 0; i < points.length; i++) {
        expect(points[i]).toBeGreaterThanOrEqual(cam.nib / 2);
        expect(points[i]).toBeLessThanOrEqual(cam.sheet[i % 2] - cam.nib / 2);
      }
    }
  }
});
