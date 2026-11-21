/**
 * Masks in image mode on whole drawings: a mask that sets nothing changes nothing, and what a
 * mask sets changes the drawing only where it lies.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { imageScene, plausibility } from '@/image';
import { streetRules } from '@/image-streets';
import { newMask, type ImageMask } from '@/image-masks';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { drawImage } from '../support/draw';
import { PICTURES } from '../support/pictures';

const pic = PICTURES.gradient();
const base: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id, imageName: pic.name, scale: 2500, tilt: 40, power: false, sheet: 'a4' };
/** A sharp-edged rectangle over the left half of the picture. */
const left = (values: ImageMask['values'], more: Partial<ImageMask> = {}): ImageMask => ({ ...newMask('rect', [], pic.w, pic.h), pts: [0.25, 0.5, 0.25, 0.5], feather: 0, values, ...more });
// The scene cache keys on the picture's id: a fresh copy each time keeps one test from answering another.
let n = 0;
const fresh = () => ({ ...pic, id: `masks-${n++}` });

beforeAll(() => {
  vi.stubGlobal('fetch', (input: unknown) => {
    throw new Error(`Image mode fetched ${String(input)}`);
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('masks', () => {
  test('a mask that sets nothing, or is hidden, leaves the drawing as it was', () => {
    const plain = drawImage(base, pic).svg;
    expect(drawImage({ ...base, imageMasks: [left({})] }, pic).svg).toBe(plain);
    expect(drawImage({ ...base, imageMasks: [left({ trees: 0, abandon: 1, imageLight: 1 }, { off: true })] }, pic).svg).toBe(plain);
  });

  test('a street pattern mask can put the grid on either side of the picture', () => {
    const picture = fresh();
    for (const fabric of [0, 1]) {
      const mask = left({ fabric: 1 - fabric }, { feather: 0.08 });
      const { streets, cam } = imageScene(picture, { ...base, fabric, imageMasks: [mask] });
      expect(streetRules(streets)).toEqual([]);
      const [x0, y0, x1, y1] = cam.rect;
      const mid = (x0 + x1) / 2;
      const aligned = [0, 0], length = [0, 0];
      for (const { pts } of streets.edges) {
        for (let i = 2; i < pts.length; i += 2) {
          const sx = cam.sx(pts[i], pts[i + 1]), sy = cam.sy(pts[i], pts[i + 1], 0);
          if (sx < x0 || sx > x1 || sy < y0 || sy > y1 || Math.abs(sx - mid) < 12) continue;
          const side = sx < mid ? 0 : 1;
          const dx = pts[i] - pts[i - 2], dy = pts[i + 1] - pts[i - 1];
          const metres = Math.hypot(dx, dy);
          // Both grid axes score 1. Diagonal streets in this gradient picture score −1.
          aligned[side] += metres * Math.cos(4 * Math.atan2(dy, dx));
          length[side] += metres;
        }
      }
      expect(aligned[fabric] / length[fabric]).toBeGreaterThan(0.3);
      expect(aligned[1 - fabric] / length[1 - fabric]).toBeLessThan(-0.3);
    }
  });

  test('height from image rises only inside the mask', () => {
    const flat = imageScene(fresh(), base);
    const masked = imageScene(fresh(), { ...base, imageMasks: [left({ imageRelief: 1 })] });
    const { cam } = flat;
    const mid = (cam.rect[0] + cam.rect[2]) / 2;
    const keyOf = (pts: number[]) => `${pts[0].toFixed(2)},${pts[1].toFixed(2)}`;
    const heights = new Map(masked.town.buildings.map((b) => [keyOf(b.shape[0].pts), b.h]));
    let inside = 0;
    let raised = 0;
    for (const [i, b] of flat.town.buildings.entries()) {
      const t = flat.town.tagged[i];
      const sx = cam.sx(t.x, t.y);
      const h = heights.get(keyOf(b.shape[0].pts));
      if (sx > mid + 2) {
        // Outside, every building stands as it did.
        if (sx < cam.rect[2]) expect(h).toBe(b.h);
      } else if (sx < mid - 2 && sx > cam.rect[0]) {
        inside++;
        if (h === undefined || h > b.h + 0.5) raised++;
      }
    }
    expect(inside).toBeGreaterThan(0);
    expect(raised).toBeGreaterThan(0);
  });

  test('abandonment set in a mask ruins buildings there and nowhere else', () => {
    const s = drawImage({ ...base, imageMasks: [left({ abandon: 0.9 })] }, fresh());
    const mid = (s.cam.rect[0] + s.cam.rect[2]) / 2;
    let ruined = 0;
    for (const [name, lines] of s.tally) {
      if (!/\/(closed-up|derelict|shell|broken-shell|footprint-ruin)\b/.test(name)) continue;
      for (const l of lines) {
        ruined++;
        // A building is ruined by where it stands; its strokes reach a little beyond.
        for (let i = 0; i < l.length; i += 2) expect(l[i]).toBeLessThan(mid + 15);
      }
    }
    expect(ruined).toBeGreaterThan(0);
  });

  test('fewer trees inside a mask thin out only the trees there', () => {
    const all = drawImage(base, fresh());
    const thinned = drawImage({ ...base, imageMasks: [left({ trees: 0 })] }, fresh());
    expect(thinned.counts.trees).toBeLessThan(all.counts.trees);
    const mid = (all.cam.rect[0] + all.cam.rect[2]) / 2;
    // Only trees drawn on the right stay, and those are the same strokes as before.
    const strokes = (s: typeof all) => [...s.tally].filter(([k]) => k.startsWith('trees')).flatMap(([, ls]) => ls).filter((l) => l[0] > mid + 10).map((l) => l.map((v) => v.toFixed(2)).join(','));
    expect(new Set(strokes(thinned)).size).toBeGreaterThan(0);
    for (const l of strokes(thinned)) expect(strokes(all)).toContain(l);
  });

  test('brightness in a mask changes the target only under it', () => {
    const plain = imageScene(fresh(), base).target;
    const lit = imageScene(fresh(), { ...base, imageMasks: [left({ imageLight: 0.8 })] }).target;
    const { W, H } = plain;
    let lighter = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (x > W / 2 + 2) expect(lit.tone[i]).toBe(plain.tone[i]);
        else if (x < W / 2 - 2 && lit.tone[i] > plain.tone[i] + 1e-4) lighter++;
      }
    expect(lighter).toBeGreaterThan((W * H) / 4);
  });

  test('every setting a mask can change, in feathered, turned and rounded shapes, keeps a plausible town', () => {
    const ellipse = { ...newMask('ellipse', [], pic.w, pic.h), angle: 30, feather: 0.2, values: { likeness: 1, imageNeighbours: 1, imageContours: 1, imageRoundabouts: 2, imageDensity: -1, imageFloorplans: 1, imageHatching: 1, cars: 0, heightScale: 2.5, windows: 0, details: 0 } };
    const polygon = { ...newMask('polygon', [ellipse], pic.w, pic.h), round: 0.6, feather: 0.1, invert: true, values: { imageContrast: 1.6, imageRelief: 0.7, imageDensity: 1, imageHighlight: 0.6, pitched: 0, trees: 1, abandon: 0.4, humanize: 0.6, rooftops: 0, shadeWalls: 0 } };
    const s = drawImage({ ...base, imageMasks: [ellipse, polygon] }, fresh());
    expect(plausibility(s.scene.town)).toEqual([]);
    expect(s.counts.buildings).toBeGreaterThan(0);
  });

  test('windows and roof hatching switched off in a mask go only there', () => {
    const near = { ...base, scale: 1500 };
    const s = drawImage({ ...near, imageMasks: [left({ windows: 0, roofHatch: 0 })] }, fresh());
    const mid = (s.cam.rect[0] + s.cam.rect[2]) / 2;
    for (const layer of ['windows', 'roofHatch']) {
      const lines = [...s.tally].filter(([k]) => k.split(/[:/]/)[0] === layer).flatMap(([, ls]) => ls);
      expect(lines.some((l) => l[0] > mid + 15), `${layer} on the right`).toBe(true);
      expect(lines.filter((l) => l[0] < mid - 15), `${layer} on the left`).toEqual([]);
    }
  });

  test('a mask that humanizes leaves the strokes outside it precise', () => {
    const plain = drawImage(base, fresh());
    const loose = drawImage({ ...base, imageMasks: [left({ humanize: 1 })] }, fresh());
    const mid = (plain.cam.rect[0] + plain.cam.rect[2]) / 2;
    const right = (s: typeof plain) => new Set(s.raw.flatMap((pen) => pen.filter((l) => l[0] > mid + 1).map((l) => l.map((v) => v.toFixed(3)).join(','))));
    expect(right(loose)).toEqual(right(plain));
    expect(loose.svg).not.toBe(plain.svg);
  });
});
