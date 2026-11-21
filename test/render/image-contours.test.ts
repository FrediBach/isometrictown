import { expect, test } from 'vitest';
import { imageScene, plausibility, type Picture, type Scene } from '@/image';
import { fitImage } from '@/image-fit';
import { streetRules } from '@/image-streets';
import { DEFAULT_SETTINGS } from '@/settings';
import { paint } from '../support/pictures';

const lay = (pic: Picture, imageContours: number, imageFit: 'fill' | 'fit' = 'fill') => imageScene(pic, {
  ...DEFAULT_SETTINGS, source: 'image', image: pic.id, imageName: pic.name, sheet: 'a4', scale: 2500,
  tilt: 40, likeness: 0.4, fabric: 1, imageContours, imageFit,
});
const curveY = (u: number) => 0.5 + 0.18 * Math.sin((u - 0.1) * 2 * Math.PI);

/** Fraction of the curve followed within 2 mm by a road or path pointing within 30° of its tangent. */
function followed({ cam, set, town }: Scene, pic: Picture): number {
  const p = fitImage(cam.rect, pic.w, pic.h, set.imageFit, set.imageFocus);
  const samples = Array.from({ length: 50 }, (_, i) => {
    const u = 0.05 + 0.9 * i / 49;
    const slope = p.h / p.w * 0.18 * 2 * Math.PI * Math.cos((u - 0.1) * 2 * Math.PI);
    return { x: p.x + p.w * u, y: p.y + p.h * curveY(u), slope, hit: false };
  });
  for (const { pts } of town.ways) {
    for (let i = 2; i < pts.length; i += 2) {
      const x = cam.sx(pts[i - 2], pts[i - 1]), y = cam.sy(pts[i - 2], pts[i - 1], 0);
      const dx = cam.sx(pts[i], pts[i + 1]) - x, dy = cam.sy(pts[i], pts[i + 1], 0) - y;
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      for (const sample of samples) {
        if (sample.hit || Math.abs(dx + dy * sample.slope) < 0.866 * length * Math.hypot(1, sample.slope)) continue;
        const t = Math.max(0, Math.min(1, ((sample.x - x) * dx + (sample.y - y) * dy) / length ** 2));
        if (Math.hypot(sample.x - x - t * dx, sample.y - y - t * dy) <= 2) sample.hit = true;
      }
    }
  }
  return samples.filter((s) => s.hit).length / samples.length;
}

test('increasing the control follows more of a curved boundary through a gridded town', () => {
  const pic = paint('Curved boundary', (u, v) => v > curveY(u) ? [65, 65, 65] : [225, 225, 225]);
  const ordinary = lay(pic, 0);
  const half = lay(pic, 0.5);
  const full = lay(pic, 1);
  const a = followed(ordinary, pic), b = followed(half, pic), c = followed(full, pic);
  expect(b).toBeGreaterThan(a + 0.2);
  expect(c).toBeGreaterThan(b + 0.2);
  expect(c).toBeGreaterThan(0.85);
  expect(streetRules(full.streets)).toEqual([]);
  expect(plausibility(full.town)).toEqual([]);
  expect(lay(pic, 0).town.ways).toEqual(ordinary.town.ways);
});

test('an alpha boundary or the edge of a fitted image does not lay an extra street', () => {
  const pic = paint('Fitted grey', (u) => [130, 130, 130, u > 0.5 ? 255 : 0], 120, 240);
  const plain = lay(pic, 0, 'fit');
  expect(lay(pic, 1, 'fit').town.ways).toEqual(plain.town.ways);
});
