/**
 * Image mode's pure parts: where the image lies on the sheet, colour and tone, reading the
 * picture, the drawn-as settings, the town's layout and the likeness score.
 */
import { describe, expect, test } from 'vitest';
import { decodePicture, encodePicture, nameOf, pictureId } from '@/app/image-store';
import { Camera } from '@/camera';
import { Frame } from '@/geo';
import { drawnAs, imageRegion, imageTown, STYLE_PLACE } from '@/image';
import { dragFocus, fitImage, toImage, toSheet } from '@/image-fit';
import { readImage, toneAt } from '@/image-read';
import { coverage, fromOklab, hexToLinear, likeness, mix, oklab } from '@/image-tone';
import { toSvg } from '@/plot';
import { reachHeight } from '@/render';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { STYLES } from '@/styles';
import { paint, PICTURES } from '../support/pictures';

const RECT = [20, 20, 400, 260] as const;

describe('fitImage', () => {
  test('Fill covers the drawing area and Fit shows the whole image inside it', () => {
    const fill = fitImage(RECT, 200, 200, 'fill');
    expect(fill.w).toBeCloseTo(380);
    expect(fill.h).toBeCloseTo(380);
    expect(fill.x).toBeCloseTo(20);
    expect(fill.y).toBeCloseTo(140 - 190);
    const fit = fitImage(RECT, 200, 200, 'fit');
    expect(fit.h).toBeCloseTo(240);
    expect(fit.y).toBeCloseTo(20);
    expect(fit.x).toBeCloseTo(210 - 120);
  });

  test('the focus comes to the middle, as far as the image reaches', () => {
    const top = fitImage(RECT, 200, 200, 'fill', [0.5, 0]);
    expect(top.y).toBeCloseTo(20);
    const lower = fitImage(RECT, 200, 200, 'fill', [0.5, 0.6]);
    const [, py] = toImage(lower, 210, 140);
    expect(py / 200).toBeCloseTo(0.6);
  });

  test('sheet and image coordinates map both ways', () => {
    const p = fitImage(RECT, 640, 480, 'fill', [0.3, 0.7]);
    const [px, py] = toImage(p, 123, 77);
    const [sx, sy] = toSheet(p, px, py);
    expect(sx).toBeCloseTo(123);
    expect(sy).toBeCloseTo(77);
  });

  test('dragging moves the image with the pointer and stops at its edge', () => {
    const p = fitImage(RECT, 200, 200, 'fill', [0.5, 0.5]);
    const [fx, fy] = dragFocus(p, RECT, 0, 38);
    expect(fx).toBe(0.5);
    expect(fy).toBeCloseTo(0.5 - 38 / 380);
    expect(dragFocus(p, RECT, 0, 1000)[1]).toBeCloseTo(120 / 380);
    // Nothing to move across a side the image only just fills.
    expect(dragFocus(p, RECT, 50, 0)[0]).toBe(0.5);
  });
});

describe('colour', () => {
  test('OKLab: white is L 1 with no chroma, and the conversion goes both ways', () => {
    const lab = [0, 0, 0];
    oklab(1, 1, 1, lab);
    expect(lab[0]).toBeCloseTo(1, 4);
    expect(Math.hypot(lab[1], lab[2])).toBeLessThan(1e-4);
    const rgb = hexToLinear('#d42f3a');
    oklab(rgb[0], rgb[1], rgb[2], lab);
    const back = [0, 0, 0];
    fromOklab(lab[0], lab[1], lab[2], back);
    back.forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 5));
  });

  test('pens mix with the paper by how much of it they cover', () => {
    const paper = [1, 1, 1];
    const ink = [0.1, 0.2, 0.3];
    const out = [0, 0, 0];
    mix(paper, [ink], [0], out);
    expect(out).toEqual([1, 1, 1]);
    mix(paper, [ink], [1], out);
    out.forEach((v, i) => expect(v).toBeCloseTo(ink[i]));
    mix(paper, [ink], [0.5], out);
    out.forEach((v, i) => expect(v).toBeCloseTo((1 + ink[i]) / 2));
  });

  test('a stroke lays its length times the pen width', () => {
    const g = { x0: 0, y0: 0, cell: 0.5, W: 40, H: 40 };
    const [c] = coverage([[[1, 5.1, 11, 5.1]]], g, 0.35);
    expect(c.reduce((a, v) => a + v, 0) * 0.25).toBeCloseTo(10 * 0.35, 5);
  });
});

describe('readImage', () => {
  const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image' };

  test('a ramp stays a ramp, from paper down to the darkest the drawing gets', () => {
    const t = readImage(PICTURES.gradient(), set, RECT);
    const row = Math.floor(t.H / 2) * t.W;
    let last = Infinity;
    for (let x = 0; x < t.W; x += 20) {
      expect(t.L[row + x]).toBeLessThanOrEqual(last + 1e-6);
      last = t.L[row + x];
    }
    expect(t.L[row]).toBeLessThanOrEqual(t.paper + 1e-6);
    expect(t.L[row + t.W - 1]).toBeGreaterThanOrEqual(t.dark - 1e-6);
    expect(toneAt(t, RECT[0] + 1, 140)!).toBeGreaterThan(0.85);
    expect(toneAt(t, RECT[2] - 1, 140)!).toBeLessThan(0.15);
  });

  test('brightness lightens and contrast spreads the middle', () => {
    const pic = PICTURES.landscape();
    const mean = (s: Settings) => readImage(pic, s, RECT).L.reduce((a, v) => a + v, 0);
    expect(mean({ ...set, imageLight: 0.5 })).toBeGreaterThan(mean(set));
  });

  test("Fit's margins and transparent pixels carry no weight", () => {
    const t = readImage(PICTURES.gradient(), { ...set, imageFit: 'fit' }, [0, 0, 400, 100]);
    expect(t.weight[Math.floor(t.H / 2) * t.W + 2]).toBe(0);
    expect(t.weight[Math.floor(t.H / 2) * t.W + Math.floor(t.W / 2)]).toBe(1);
    expect(toneAt(t, 1, 50)).toBeNull();
    const clear = paint('Clear', () => [0, 0, 0, 0]);
    expect(readImage(clear, set, RECT).weight.every((w) => w === 0)).toBe(true);
  });

  test('one pen matches lightness only', () => {
    const t = readImage(PICTURES.bands(), { ...set, mono: true }, RECT);
    expect(t.a.every((v) => v === 0) && t.b.every((v) => v === 0)).toBe(true);
  });
});

describe('the drawn-as place', () => {
  test('a fictional centre for the style, the image name and no OSM tags', () => {
    const d = drawnAs({ ...structuredClone(DEFAULT_SETTINGS), source: 'image', imageName: 'Harbour', style: 'nordic' });
    expect(d.center).toEqual(STYLE_PLACE.nordic);
    expect(d.place).toBe('Harbour');
    expect(d.osmTags).toBe(false);
    expect(drawnAs({ ...DEFAULT_SETTINGS, source: 'image' }).place).toBe('Image');
    expect(imageRegion({ ...DEFAULT_SETTINGS, style: 'british' })).toEqual({ country: 'Image', code: '', style: 'british', left: true });
  });

  test('the SVG names no coordinates and no map data in image mode', () => {
    const set = drawnAs({ ...structuredClone(DEFAULT_SETTINGS), source: 'image', imageName: 'Harbour' });
    const svg = toSvg([[], [], [], [], [[0, 0, 1, 1]]], set, [297, 210]);
    expect(svg).not.toMatch(/OpenStreetMap|\d+\.\d{5}/);
    expect(toSvg([[], [], [], [], [[0, 0, 1, 1]]], DEFAULT_SETTINGS, [297, 210])).toMatch(/OpenStreetMap/);
  });
});

describe('the town', () => {
  const base: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image', scale: 2500, tilt: 40, sheet: 'a4' };
  const lay = (set: Settings) => {
    const d = drawnAs(set);
    const cam = new Camera(d);
    const t = readImage(PICTURES.landscape(), d, cam.rect);
    return imageTown(t, d, cam, new Frame(d.center), cam.region(reachHeight(d)), STYLES.central);
  };

  test('the same picture and settings lay out the same town', () => {
    expect(lay(base)).toEqual(lay(base));
  });

  test('what only changes how it is drawn never moves a street or a house', () => {
    const town = lay(base);
    for (const more of [{ detail: 1.8 }, { penWidth: 0.7 }, { trees: 0.1 }, { shadows: false }, { pens: ['#000000', '#111111', '#222222', '#333333', '#444444'] as Settings['pens'] }]) {
      expect(lay({ ...base, ...more })).toEqual(town);
    }
  });

  test('a new seed varies the houses but not the streets', () => {
    const a = lay(base);
    const b = lay({ ...base, seed: 2 });
    expect(b.ways).toEqual(a.ways);
    expect(b.buildings).not.toEqual(a.buildings);
  });

  test('every house has an explicit height and a counter-clockwise footprint', () => {
    for (const b of lay(base).buildings) {
      expect(b.guess).toBeUndefined();
      const p = b.shape[0].pts;
      let a = 0;
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) a += (p[j] - p[i]) * (p[j + 1] + p[i + 1]);
      expect(a).toBeGreaterThan(0);
    }
  });
});

describe('likeness', () => {
  test('blank paper scores 0, and a darker drawing of a dark picture scores more', () => {
    const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image' };
    const t = readImage(paint('Dark', () => [40, 40, 40]), set, [0, 0, 60, 40]);
    const blank = [0, 1, 2, 3, 4].map(() => new Float32Array(t.W * t.H));
    const score = (c: number) => likeness(blank.map((p, i) => (i === 4 ? p.map(() => c) : p)), t, set, t.paper - t.dark).likeness.score;
    expect(score(0)).toBeCloseTo(0, 6);
    expect(score(0.05)).toBeGreaterThan(0);
    expect(score(0.3)).toBeGreaterThan(Math.max(0.5, score(0.05)));
  });

  test('a flat picture keeps how light it is', () => {
    const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image' };
    const tone = (v: number) => toneAt(readImage(paint('Flat', () => [v, v, v]), set, [0, 0, 60, 40]), 30, 20)!;
    expect(tone(40)).toBeLessThan(0.4);
    expect(tone(240)).toBeGreaterThan(0.85);
  });
});

describe('the image store', () => {
  test('a picture is stored and read back exactly', () => {
    const p = PICTURES.disc();
    expect(decodePicture(p.id, encodePicture(p))).toEqual(p);
    expect(decodePicture(p.id, new ArrayBuffer(8))).toBeNull();
  });

  test('ids follow the pixels, not the name', async () => {
    const p = PICTURES.disc();
    const id = await pictureId(p.rgba, p.w, p.h);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(await pictureId(p.rgba.slice(), p.w, p.h)).toBe(id);
    expect(await pictureId(PICTURES.gradient().rgba, p.w, p.h)).not.toBe(id);
  });

  test('names come from file names', () => {
    expect(nameOf('harbour_at-dusk.final.JPEG')).toBe('harbour at dusk.final');
    expect(nameOf('IMG 0042.heic')).toBe('IMG 0042');
  });
});
