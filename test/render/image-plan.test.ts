/**
 * Image mode's planning on whole scenes: zoning, the town laid out on it, and the street rules
 * on every test picture. Slower than the unit tests, so they live with the drawings.
 */
import { describe, expect, test } from 'vitest';
import { Camera } from '@/camera';
import { classify } from '@/classify';
import { drawnAs, imageRegion, imageScene, plausibility, type Scene } from '@/image';
import { centre } from '@/image-check';
import { readImage } from '@/image-read';
import { streetRules } from '@/image-streets';
import { BUILT, LABELS } from '@/image-tone';
import { labelAt, zone } from '@/image-zones';
import { reachHeight } from '@/render';
import { STYLES } from '@/styles';
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

  test('old-town lanes are the same after adjusting Detail and pen width and after a reload', () => {
    const ramp = PICTURES.gradient();
    const start = { ...base, image: ramp.id };
    const first = imageScene(ramp, start).town;
    expect(first.ways.some((w) => w.cls === 'service')).toBe(true);
    const set = { ...start, detail: 0.25, penWidth: 0.7 };
    const warm = imageScene(ramp, set).town;
    imageScene(pic, base); // Evict the gradient so the next visit lays it out afresh.
    const cold = imageScene(ramp, set).town;
    expect(cold.ways).toEqual(warm.ways);
    expect(cold.buildings).toEqual(warm.buildings);
  });

  test('a narrow blue stream through built land keeps its banks clear', () => {
    const pic = paint('Stream', (u, v) => {
      const g = 90 + 80 * u;
      return Math.abs(u - v) < 0.005 ? [12, 28, 80] : [g, g + 4, g + 12];
    });
    const town = imageScene(pic, { ...base, image: pic.id }).town;
    expect(town.streams.length).toBeGreaterThan(0);
    expect(town.buildings.length).toBeGreaterThan(0);
    expect(plausibility(town)).toEqual([]);
  });

  test('matching lightness alone, the pens never move a street or a house', () => {
    const grey = { ...base, imageColour: 0 };
    expect(lay({ ...grey, pens: ['#000000', '#111111', '#222222', '#333333', '#444444'] })).toEqual(lay(grey));
    const mono = { ...base, mono: true };
    expect(lay({ ...mono, pens: ['#000000', '#111111', '#222222', '#333333', '#444444'] })).toEqual(lay(mono));
  });

  test('switching pens and paper recolours the same town that a fresh session would draw', () => {
    const pic = PICTURES.bands();
    const baseTown = imageScene(pic, base).town;
    const changed = { ...base, pens: ['#464500', '#7292d0', '#317061', '#822b2e', '#04263f'] as Settings['pens'], customBackground: true, background: '#aaaabb' };
    const cached = imageScene(pic, changed);
    imageScene(PICTURES.disc(), base);
    const fresh = imageScene(pic, changed);
    expect(fresh.town).toEqual(baseTown);
    expect(cached.town).toEqual(fresh.town);
    expect(cached.target.L).toEqual(fresh.target.L);
  });

  test('image height raises the dark end of a gradient through intermediate skylines and leaves the light end low', () => {
    const ramp = PICTURES.gradient();
    const at = (imageRelief: number) => imageScene(ramp, { ...base, image: ramp.id, imageRelief });
    const heights = (scene: Scene, low: number, high: number) => {
      const { cam, target: t } = scene;
      const result: number[] = [];
      for (const b of scene.town.buildings) {
        const [x, y] = centre(b.shape[0].pts);
        const col = Math.floor((cam.sx(x, y) - t.x0) / t.cell);
        const row = Math.floor((cam.sy(x, y, 0) - t.y0) / t.cell);
        if (col < 0 || row < 0 || col >= t.W || row >= t.H) continue;
        const i = row * t.W + col;
        if (t.weight[i] > 0.95 && t.tone[i] >= low && t.tone[i] <= high) result.push(b.h);
      }
      return result;
    };
    const ordinary = at(0);
    const half = at(0.5);
    const full = at(1);
    const [low, mid, peak] = [ordinary, half, full].map((s) => Math.max(...heights(s, 0, 0.2)));
    expect(mid).toBeGreaterThan(low + 15);
    expect(peak).toBeGreaterThan(mid + 15);
    expect(peak).toBeGreaterThan(75);
    const light = heights(full, 0.8, 1);
    expect(light.length).toBeGreaterThan(0);
    expect(Math.max(...light)).toBeLessThan(15);
    expect(full.town.ways).toEqual(ordinary.town.ways);
    expect(plausibility(full.town)).toEqual([]);
    expect(at(0).town).toEqual(ordinary.town);
  });

  test('towers rooted in a black patch leave the white band above it visible', () => {
    const pic = paint('Dark ground', (_u, v) => v < 0.25 ? [0, 0, 0, 0] : v < 0.5 ? [255, 255, 255] : [0, 0, 0]);
    const { cam, town, target: t } = imageScene(pic, { ...base, image: pic.id, imageRelief: 1 });
    const edge = (cam.rect[1] + cam.rect[3]) / 2;
    let towers = 0;
    for (const b of town.buildings) {
      if (b.h < 60) continue;
      const [x, y] = centre(b.shape[0].pts);
      const sx = cam.sx(x, y);
      const sy = cam.sy(x, y, 0);
      if (sx < cam.rect[0] || sx > cam.rect[2] || sy < edge || sy > cam.rect[3]) continue;
      towers++;
      expect(cam.sy(x, y, b.h * base.heightScale)).toBeGreaterThan(edge - 4 * t.cell);
    }
    expect(towers).toBeGreaterThan(0);
  });

  test('coarse-scale tower sites keep clear of the surrounding plots', () => {
    const pic = PICTURES.disc();
    const scene = imageScene(pic, { ...base, image: pic.id, imageRelief: 1, sheet: 'a3', scale: 8000, tilt: 55, style: 'eastAsian' });
    expect(plausibility(scene.town)).toEqual([]);
    classify(scene.town, scene.style, scene.set, (x, y) => [Math.round(x), Math.round(y)]);
    expect(scene.town.buildings.some((b) => b.h > 75 && b.info?.kind === 'tall' && b.info.roof === 'flat')).toBe(true);
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

  test('rows share their walls, and the town has a church and a town hall', () => {
    const sc = imageScene({ ...pic, id: `copy-${n++}` }, base);
    const town = structuredClone(sc.town);
    classify(town, STYLES[imageRegion(sc.set).style], sc.set, (x, y) => [Math.round(x), Math.round(y)]);
    const terraces = town.buildings.filter((b, i) => !b.context && town.tagged[i].building === 'terrace');
    expect(terraces.length).toBeGreaterThan(100);
    expect(terraces.filter((b) => b.info!.party.some((h) => h > 0)).length / terraces.length).toBeGreaterThan(0.85);
    expect(town.buildings.some((b) => b.info!.kind === 'worship')).toBe(true);
    expect(town.buildings.some((b) => b.info!.townHall)).toBe(true);
  });

  test('fields come as a patchwork, and courtyards get trees of their own', () => {
    const ramp = PICTURES.gradient();
    const sc = imageScene(ramp, { ...base, image: ramp.id, scale: 5000 });
    expect(sc.town.trees.length).toBeGreaterThan(0);
    expect(sc.town.cover.filter((a) => a.cls === 'farmland').length).toBeGreaterThan(1);
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

  test('neighbourhoods as in real towns rearrange the plan, and the town still keeps every rule', () => {
    const pic = PICTURES.landscape();
    const set: Settings = { ...base, image: pic.id };
    const before = plan(pic, set).zones.label;
    const after = plan(pic, { ...set, imageNeighbours: 1 }).zones.label;
    let moved = 0;
    for (let c = 0; c < before.length; c++) if (before[c] !== after[c]) moved++;
    expect(moved).toBeGreaterThan(0);
    const sc = imageScene({ ...pic, id: 'neighbours' }, { ...set, imageNeighbours: 1 });
    expect(streetRules(sc.streets)).toEqual([]);
    expect(plausibility(sc.town)).toEqual([]);
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
      test(`${name}, ${fabric}: the streets keep every rule, and the town is plausible`, () => {
        const pic = PICTURES[name]();
        const sc = imageScene(pic, { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id, scale: 2500, tilt: 40, sheet: 'a4', fabric });
        expect(streetRules(sc.streets)).toEqual([]);
        expect(sc.streets.edges.length).toBeGreaterThan(10);
        expect(plausibility(sc.town)).toEqual([]);
      });
});
