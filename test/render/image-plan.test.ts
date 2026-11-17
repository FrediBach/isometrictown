/**
 * Image mode's planning on whole scenes: zoning, the town laid out on it, and the street rules
 * on every test picture. Slower than the unit tests, so they live with the drawings.
 */
import { describe, expect, test } from 'vitest';
import { Camera } from '@/camera';
import { drawnAs, imageScene } from '@/image';
import { readImage } from '@/image-read';
import { streetRules } from '@/image-streets';
import { BUILT, LABELS } from '@/image-tone';
import { labelAt, zone } from '@/image-zones';
import { reachHeight } from '@/render';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { paint, PICTURES } from '../support/pictures';

describe('the town', () => {
  const pic = PICTURES.landscape();
  const base: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id, scale: 2500, tilt: 40, sheet: 'a4' };
  // A copy of the picture under another id each time, so the scene's cache can't answer.
  let n = 0;
  const lay = (set: Settings) => imageScene({ ...pic, id: `copy-${n++}` }, set).town;

  test('the same picture and settings lay out the same town', () => {
    expect(lay(base)).toEqual(lay(base));
  });

  test('what only changes how it is drawn never moves a street or a house', () => {
    const town = lay(base);
    for (const more of [{ detail: 1.8 }, { penWidth: 0.7 }, { trees: 0.1 }, { shadows: false }, { sunHeight: 20 }]) {
      expect(lay({ ...base, ...more })).toEqual(town);
    }
  });

  test('matching lightness alone, the pens never move a street or a house', () => {
    const grey = { ...base, imageColour: 0 };
    expect(lay({ ...grey, pens: ['#000000', '#111111', '#222222', '#333333', '#444444'] })).toEqual(lay(grey));
    const mono = { ...base, mono: true };
    expect(lay({ ...mono, pens: ['#000000', '#111111', '#222222', '#333333', '#444444'] })).toEqual(lay(mono));
  });

  test('image-made tags are not OSM tags', () => {
    const town = lay(base);
    expect(town.tagged.length).toBeGreaterThan(0);
    expect(town.tagged.every((t) => t.from === 'image')).toBe(true);
  });

  test('a new seed keeps the land plan but lays out another town on it', () => {
    const a = imageScene({ ...pic, id: `copy-${n++}` }, base);
    const b = imageScene({ ...pic, id: `copy-${n++}` }, { ...base, seed: 2 });
    expect(b.zones.label).toEqual(a.zones.label);
    expect(b.town.buildings).not.toEqual(a.town.buildings);
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

describe('zoning', () => {
  const base: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image', scale: 2500, tilt: 40, sheet: 'a4' };
  const plan = (pic: ReturnType<typeof paint>, set = base) => {
    const d = drawnAs(set);
    const cam = new Camera(d);
    return { cam, zones: zone(readImage(pic, d, cam.rect), d, cam, cam.region(reachHeight(d))) };
  };

  test('a picture of two halves zones into town and country, split along the edge', () => {
    const { cam, zones } = plan(paint('Halves', (u) => (u < 0.5 ? [45, 45, 45] : [235, 235, 235])));
    let right = 0;
    let total = 0;
    for (let sy = 40; sy < 150; sy += 4) {
      for (let sx = 30; sx < 270; sx += 4) {
        if (Math.abs(sx - 148.5) < 8) continue;
        // Buildings are read where their roofs show, a little up the sheet from their footprints.
        const [x, y] = cam.ground(sx, sy);
        const l = labelAt(zones, x, y);
        total++;
        if (l && BUILT.has(l) === sx < 148.5) right++;
      }
    }
    expect(right / total).toBeGreaterThan(0.95);
  });

  test('specks smaller than a patch can be are absorbed', () => {
    const { zones } = plan(paint('Specks', (u, v) => (Math.hypot((u * 300) % 50 - 25, (v * 200) % 50 - 25) < 2 ? [30, 30, 30] : [230, 230, 230])));
    const built = [...zones.label].filter((k) => BUILT.has(LABELS[k])).length;
    expect(built / zones.label.length).toBeLessThan(0.01);
  });

  test('more likeness keeps smaller patches', () => {
    const pic = paint('Blots', (u, v) => (Math.hypot(u - 0.3, v - 0.5) < 0.04 || Math.hypot(u - 0.7, v - 0.5) < 0.04 ? [30, 30, 30] : [230, 230, 230]));
    const built = (likeness: number) => [...plan(pic, { ...base, likeness }).zones.label].filter((k) => BUILT.has(LABELS[k])).length;
    expect(built(1)).toBeGreaterThan(built(0));
  });
});

describe('the street graph', () => {
  const pics = ['gradient', 'disc', 'stripes', 'cross', 'landscape'] as const;
  // Each picture with one street pattern, the two taking turns.
  for (const [k, name] of pics.entries())
    for (const fabric of [k % 2 ? 'grid' : 'organic'] as const)
      test(`${name}, ${fabric}: the streets keep every rule, and buildings keep off the roads`, () => {
        const pic = PICTURES[name]();
        const sc = imageScene(pic, { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id, scale: 2500, tilt: 40, sheet: 'a4', fabric });
        expect(streetRules(sc.streets)).toEqual([]);
        expect(sc.streets.edges.length).toBeGreaterThan(10);
        const roads = sc.town.ways.filter((w) => w.kind === 'road');
        let onRoad = 0;
        for (const b of sc.town.buildings) {
          const p = b.shape[0].pts;
          const cx = (p[0] + p[4]) / 2;
          const cy = (p[1] + p[5]) / 2;
          for (const w of roads)
            for (let i = 2; i < w.pts.length; i += 2) {
              const [ax, ay, bx, by] = w.pts.slice(i - 2, i + 2);
              const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
              const t = Math.max(0, Math.min(1, ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / l2));
              if (Math.hypot(ax + (bx - ax) * t - cx, ay + (by - ay) * t - cy) < w.width / 2) onRoad++;
            }
        }
        expect(onRoad).toBe(0);
      });
});
