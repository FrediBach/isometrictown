/**
 * Whole drawings in image mode, from pictures made in code. Each is checked against its golden
 * (`test/golden/image-<id>.json`, with its likeness) and against the rules every sheet keeps.
 * Image mode fetches nothing, so here any fetch fails the drawing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { plausibility } from '@/image';
import { predict } from '@/image-tune';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { sheetChecks } from '../support/checks';
import { pinClock } from '../support/clock';
import { drawImage, pretty, summary, type ImageSheet } from '../support/draw';
import { PICTURES } from '../support/pictures';

pinClock();

const OUT = path.resolve(import.meta.dirname, '../out');
mkdirSync(OUT, { recursive: true });

/** The settings on first switching to image mode, on A4, at the scale image mode starts at. */
const at = (name: string, more: Partial<Settings> = {}): Settings => {
  const pic = PICTURES[name]();
  return { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id, imageName: pic.name, scale: 2500, tilt: 40, power: false, sheet: 'a4', ...more };
};

/**
 * Likeness floors (§18.2): each case's score as its golden was accepted at M5, less a little. A
 * change that makes a picture read worse fails here even when its golden is updated.
 */
const FLOOR: Record<string, number> = { gradient: 0.649, disc: 0.445, bands: 0.393, stripes: 0.494, cross: 0.723, landscape: 0.651 };

const CASES: { id: string; picture: string; what: string; set: Settings }[] = [
  { id: 'gradient', picture: 'gradient', what: 'A ramp from light to dark', set: at('gradient') },
  { id: 'disc', picture: 'disc', what: 'A dark disc on light, fitted with free ground beside it', set: at('disc', { imageFit: 'fit' }) },
  { id: 'bands', picture: 'bands', what: 'Three bands of colour, in British style', set: at('bands', { style: 'british' }) },
  { id: 'stripes', picture: 'stripes', what: 'Diagonal stripes, turned and seen from higher up', set: at('stripes', { bearing: 70, tilt: 50 }) },
  { id: 'cross', picture: 'cross', what: 'A white cross on grey, one pen', set: at('cross', { mono: true }) },
  { id: 'landscape', picture: 'landscape', what: 'A soft landscape at 1:5000, cropped off-centre', set: at('landscape', { scale: 5000, imageFocus: [0.7, 0.6] }) },
];

beforeAll(() => {
  vi.stubGlobal('fetch', (input: unknown) => {
    throw new Error(`Image mode fetched ${String(input)}`);
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const sheets = new Map<string, ImageSheet>();
const r3 = (v: number) => Math.round(v * 1000) / 1000;

describe.each(CASES)('image $id', ({ id, picture, what, set }) => {
  let s: ImageSheet;
  beforeAll(() => {
    s = drawImage(set, PICTURES[picture]());
    sheets.set(id, s);
    writeFileSync(path.join(OUT, `image-${id}.svg`), s.svg);
  });

  test(`matches its golden: ${what}`, async () => {
    const l = s.likeness;
    const golden = { likeness: { score: r3(l.score), dE: l.dE.map(r3), ssim: r3(l.ssim) }, ...summary(s) };
    await expect(`${pretty(golden)}\n`).toMatchFileSnapshot(`../golden/image-${id}.json`);
  });

  test('is a fictional place in the chosen style, with no map credit', () => {
    expect(s.region.country).toBe('Image');
    if (set.style !== 'auto') expect(s.region.style).toBe(set.style);
    expect(s.svg).not.toMatch(/OpenStreetMap/i);
    expect(s.svg).toContain(`<title>${set.imageName}, Isometric Town</title>`);
  });

  test('lays out a plausible town (§11.4)', () => {
    expect(plausibility(s.scene.town)).toEqual([]);
  });

  test('scores above its likeness floor', () => {
    expect(s.likeness.score).toBeGreaterThan(FLOOR[id]);
  });

  test('the calibration still predicts the ink each pen lays down (§7.3)', () => {
    // The materials, laid on the town as built, against the strokes drawn, over the image.
    const p = predict(structuredClone(s.scene.blocks), s.scene.zones, s.scene.target, s.scene.cam, s.scene.set, s.scene.box);
    const w = s.scene.target.weight;
    const drawn = s.cov.map((plane) => {
      let [sum, n] = [0, 0];
      for (let i = 0; i < plane.length; i++) if (w[i] > 0) [sum, n] = [sum + plane[i], n + 1];
      return sum / n;
    });
    const total = (v: number[]) => v.reduce((a, x) => a + x, 0);
    // The whole ink closely; each pen loosely, since how much roof against wall shows depends on
    // which way the rows run, which the materials average over.
    const close = (predicted: number, real: number, share: number, least: number) => expect(Math.abs(predicted - real), `predicted ${predicted.toFixed(3)}, drawn ${real.toFixed(3)}`).toBeLessThan(Math.max(least, share * real));
    close(total(p.pens), total(drawn), 0.2, 0.015);
    if (!set.mono) p.pens.forEach((v, k) => close(v, drawn[k], 0.5, 0.02));
  });

  sheetChecks(() => s, set);
});

test('drawing from a picture is repeatable', () => {
  const first = sheets.get('gradient')!;
  // Another copy of the same picture, after other pictures were laid out in between.
  const again = drawImage(first.set, PICTURES.gradient());
  expect(again.svg === first.svg).toBe(true);
});
