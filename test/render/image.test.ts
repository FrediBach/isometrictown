/**
 * Whole drawings in image mode, from pictures made in code. Each is checked against its golden
 * (`test/golden/image-<id>.json`, with its likeness) and against the rules every sheet keeps.
 * Image mode fetches nothing, so here any fetch fails the drawing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
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

  sheetChecks(() => s, set);
});

test('drawing from a picture is repeatable', () => {
  const first = sheets.get('gradient')!;
  // Another copy of the same picture, after other pictures were laid out in between.
  const again = drawImage(first.set, PICTURES.gradient());
  expect(again.svg === first.svg).toBe(true);
});
