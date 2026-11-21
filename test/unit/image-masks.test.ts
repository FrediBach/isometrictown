import { describe, expect, test } from 'vitest';
import { fitImage } from '@/image-fit';
import { activeMasks, MaskField, masksKey, maskWeights, newMask, NO_SPACE, roundCorners, sheetOutline, validMasks, type ImageMask } from '@/image-masks';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';

const rect = [0, 0, 100, 50];
const pic = { w: 200, h: 100 };
const placed = fitImage(rect, pic.w, pic.h, 'fill');
const grid = { x0: 0, y0: 0, cell: 0.5, W: 200, H: 100 };
const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image', trees: 0.7 };
const at = (w: Float32Array, x: number, y: number) => w[Math.floor(y / grid.cell) * grid.W + Math.floor(x / grid.cell)];

/** A rectangle over the left half of the picture, sharp-edged. */
const left = (more: Partial<ImageMask> = {}): ImageMask => ({ ...newMask('rect', [], pic.w, pic.h), pts: [0.25, 0.5, 0.25, 0.5], feather: 0, ...more });

describe('mask weights', () => {
  test('a sharp mask is full inside and off outside', () => {
    const m = left();
    const w = maskWeights(m, sheetOutline(m, placed, pic.w, pic.h), 0, grid);
    expect(at(w, 20, 25)).toBe(1);
    expect(at(w, 80, 25)).toBe(0);
  });

  test('the feather fades across the outline, half way on it', () => {
    const m = left();
    const w = maskWeights(m, sheetOutline(m, placed, pic.w, pic.h), 10, grid);
    expect(at(w, 40, 25)).toBe(1);
    expect(at(w, 50.1, 25)).toBeCloseTo(0.5, 1);
    expect(at(w, 52, 25)).toBeLessThan(0.5);
    expect(at(w, 52, 25)).toBeGreaterThan(0);
    expect(at(w, 60, 25)).toBe(0);
  });

  test('invert and amount', () => {
    const m = left({ invert: true, amount: 0.5 });
    const w = maskWeights(m, sheetOutline(m, placed, pic.w, pic.h), 0, grid);
    expect(at(w, 20, 25)).toBe(0);
    expect(at(w, 80, 25)).toBe(0.5);
  });

  test('a new ellipse is round on the picture, whatever its proportions', () => {
    const m = newMask('ellipse', [], pic.w, pic.h);
    const p = sheetOutline(m, placed, pic.w, pic.h);
    const xs = p.filter((_, i) => i % 2 === 0), ys = p.filter((_, i) => i % 2 === 1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 5);
  });

  test('rounding corners keeps the outline inside its corners and leaves sharp ones alone', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10];
    expect(roundCorners(square, 0)).toEqual(square);
    const round = roundCorners(square, 1);
    expect(round.length).toBeGreaterThan(square.length);
    for (let i = 0; i < round.length; i += 2) expect(Math.hypot(round[i] - 5, round[i + 1] - 5)).toBeLessThanOrEqual(5 * Math.SQRT2);
    // Fully rounded, the middle of each corner is pulled well in from it.
    expect(Math.min(...round.map((_, i) => (i % 2 ? Infinity : Math.hypot(round[i], round[i + 1]))))).toBeGreaterThan(1);
  });
});

describe('the field of settings', () => {
  test('keys no mask sets read as the drawing’s own', () => {
    const f = new MaskField([left({ values: { trees: 0.1 } })], set, grid, placed, pic);
    expect(f.varies('cars')).toBe(false);
    expect(f.field('cars')).toBeNull();
    expect(f.at('cars', 20, 25)).toBe(set.cars);
  });

  test('inside the mask its value, outside the drawing’s', () => {
    const f = new MaskField([left({ values: { trees: 0.1 } })], set, grid, placed, pic);
    expect(f.at('trees', 20, 25)).toBeCloseTo(0.1, 6);
    expect(f.at('trees', 80, 25)).toBeCloseTo(0.7, 6);
    expect(f.peak('trees')).toBeCloseTo(0.7, 6);
  });

  test('masks stack in order, the later one mixing over the earlier', () => {
    const a = left({ id: 'a', values: { trees: 0.1 } });
    const b = left({ id: 'b', values: { trees: 0.4 }, amount: 0.5 });
    expect(new MaskField([a, b], set, grid, placed, pic).at('trees', 20, 25)).toBeCloseTo(0.25, 6);
    expect(new MaskField([b, a], set, grid, placed, pic).at('trees', 20, 25)).toBeCloseTo(0.1, 6);
  });

  test('preserve empty space off is a cutoff nothing reaches; a mask can turn it on', () => {
    const f = new MaskField([left({ values: { imageHighlight: 0.8 } })], set, grid, placed, pic);
    expect(f.at('imageHighlight', 80, 25)).toBe(NO_SPACE);
    expect(f.at('imageHighlight', 20, 25)).toBeCloseTo(0.8, 6);
  });

  test('hidden masks, masks set to nothing and masks at no amount take no part', () => {
    expect(activeMasks([left({ off: true, values: { trees: 0 } }), left({ values: {} }), left({ amount: 0, values: { trees: 0 } })])).toEqual([]);
  });
});

describe('cache keys', () => {
  test('a stage is keyed only on the masks that change its own settings', () => {
    const trees = left({ values: { trees: 0.1 } });
    expect(masksKey([trees], ['imageLight'])).toBe('');
    const light = left({ values: { imageLight: 0.5, trees: 0.1 } });
    const k = masksKey([light], ['imageLight']);
    expect(k).not.toBe('');
    expect(masksKey([{ ...light, values: { imageLight: 0.5, trees: 0.9 } }], ['imageLight'])).toBe(k);
    expect(masksKey([{ ...light, id: 'other' }], ['imageLight'])).toBe(k);
    expect(masksKey([{ ...light, off: true }], ['imageLight'])).toBe('');
  });
});

describe('masks from storage or a link', () => {
  test('keep good masks and drop what is broken', () => {
    const good = left({ values: { trees: 0.3 } });
    const out = validMasks([good, null, { shape: 'star', pts: [0, 0] }, { ...good, pts: [0, 0, 1] }, { ...good, shape: 'polygon', pts: [0, 0, 1, 1] }]);
    expect(out).toEqual([good]);
  });

  test('clamp numbers into range, drop unknown keys and give clashing ids new ones', () => {
    const raw = { ...left(), id: 'x', feather: 9, amount: -1, round: 2, values: { trees: 5, scale: 100, imageLight: -3 } };
    const [a, b] = validMasks([raw, raw]);
    expect(a.feather).toBe(0.5);
    expect(a.amount).toBe(0);
    expect(a.round).toBe(1);
    expect(a.values).toEqual({ trees: 1, imageLight: -1 });
    expect(b.id).not.toBe(a.id);
  });

  test('survive a round trip through JSON', () => {
    const masks = [left({ values: { abandon: 0.8 } }), { ...newMask('polygon', [], pic.w, pic.h), id: 'p2', round: 0.4, values: { likeness: 1 } }];
    expect(validMasks(JSON.parse(JSON.stringify(masks)))).toEqual(masks);
  });
});
