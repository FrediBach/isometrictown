/**
 * Image mode's planning on whole scenes: zoning, the town laid out on it, and the street rules
 * on every test picture. Slower than the unit tests, so they live with the drawings.
 */
import { describe, expect, test } from 'vitest';
import { Camera } from '@/camera';
import { classify } from '@/classify';
import { drawnAs, imageRegion, imageScene, plausibility, type Scene } from '@/image';
import { centre, meet } from '@/image-check';
import { fitImage, toImage } from '@/image-fit';
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

  test('intermediate street patterns produce distinct networks that keep the street rules', () => {
    const layouts = [0, 0.25, 0.5, 0.75, 1].map(fabric => {
      const { streets } = imageScene(pic, { ...base, fabric });
      expect(streetRules(streets)).toEqual([]);
      return JSON.stringify(streets.edges);
    });
    expect(new Set(layouts).size).toBe(layouts.length);
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

  test('a river between dark letters keeps the far-bank letter built and connected by a bridge', () => {
    const river = (v: number) => 0.66 + 0.10 * (1 - v) + 0.018 * Math.cos(2 * Math.PI * v);
    const inC = (u: number, v: number) => u > 0.66 && u < 0.90 && v > 0.30 && v < 0.70 && (u <= 0.76 || v <= 0.40 || v >= 0.60);
    const pic = paint('Letters on two banks', (u, v) => {
      if (Math.abs(u - river(v)) < 0.03) return [45, 128, 214];
      const U = u > 0.10 && u < 0.30 && (v > 0.61 || u < 0.16 || u > 0.24);
      const N = u > 0.34 && u < 0.55 && (u < 0.39 || u > 0.50 || Math.abs((u - 0.34) / 0.21 - (v - 0.30) / 0.40) < 0.20);
      const I = u > 0.59 && u < 0.65;
      if ((v > 0.30 && v < 0.70 && (U || N || I)) || inC(u, v)) return [0, 0, 0];
      return [105 - 45 * u, 105 + 55 * u, 75];
    });
    const { cam, town, streets, set } = imageScene(pic, { ...base, sheet: 'a3', scale: 3350, seed: 12163, bearing: 35,
      imageContrast: 0.95, imageContours: 0.55, imageFloorplans: 0.88, imageNeighbours: 0.8, imageRoundabouts: 0.78, likeness: 0.8 });
    const fit = fitImage(cam.rect, pic.w, pic.h, set.imageFit, set.imageFocus);
    const uv = (x: number, y: number): [number, number] => {
      const [px, py] = toImage(fit, cam.sx(x, y), cam.sy(x, y, 0));
      return [px / pic.w, py / pic.h];
    };
    const bank = (x: number, y: number) => {
      const [u, v] = uv(x, y);
      return u - river(v);
    };
    expect(town.ways.some(w => {
      if (!w.bridge) return false;
      const p = w.pts;
      const a = bank(p[0], p[1]), b = bank(p[p.length - 2], p[p.length - 1]);
      return Math.min(a, b) < -0.02 && Math.max(a, b) > 0.02;
    })).toBe(true);
    expect(town.buildings.filter(b => inC(...uv(...centre(b.shape[0].pts)))).length).toBeGreaterThan(50);
    expect(streetRules(streets)).toEqual([]);
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
    const a = imageScene(pic, base);
    const next = { ...base, seed: 2 };
    const b = imageScene(pic, next);
    expect(b.zones).toBe(a.zones);
    expect(b.town.buildings).not.toEqual(a.town.buildings);
    const cold = imageScene({ ...pic, id: `copy-${n++}` }, next);
    expect(cold.zones.label).toEqual(a.zones.label);
    expect(cold.town).toEqual(b.town);
  });

  test('seeds vary the sheet edges reached by the main road and the railway around a lake', () => {
    const lake = paint('Lake', (u, v) => {
      const r = Math.hypot((u - 0.5) * 1.55, v - 0.5);
      return r < 0.16 ? [45, 128, 214] : r < 0.29 ? [86, 76, 73] : [182, 206, 145];
    });
    const roads = new Set<string>(), rails = new Set<string>();
    for (const seed of [1, 2, 3, 5]) {
      const { cam, town } = imageScene(lake, { ...base, image: lake.id, sheet: 'a3', scale: 2750, bearing: 35, seed });
      const [l, t, r, b] = cam.rect;
      const edges: [number, number, number, number][] = [[l, t, r, t], [r, t, r, b], [r, b, l, b], [l, b, l, t]];
      for (const cls of ['primary', 'rail']) {
        const ways = town.ways.filter(w => w.cls === cls);
        const exits = edges.map(edge => ways.some(({ pts }) => {
          for (let k = 2; k < pts.length; k += 2) {
            if (meet(cam.sx(pts[k - 2], pts[k - 1]), cam.sy(pts[k - 2], pts[k - 1], 0),
              cam.sx(pts[k], pts[k + 1]), cam.sy(pts[k], pts[k + 1], 0), ...edge)) return true;
          }
          return false;
        }));
        expect(exits.filter(Boolean).length).toBeGreaterThanOrEqual(cls === 'primary' ? 2 : 1);
        (cls === 'primary' ? roads : rails).add(exits.join(','));
      }
    }
    expect(roads.size).toBeGreaterThanOrEqual(3);
    expect(rails.size).toBeGreaterThanOrEqual(3);
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

  test('a dark patch keeps regional roofs as the drawing moves from 1:3000 to 1:4000', () => {
    const pic = paint('Black bar on green', (u, v) => u > 0.4 && u < 0.6 && v > 0.2 && v < 0.8 ? [0, 0, 0] : [95, 130, 90]);
    for (const scale of [3000, 3500, 4000]) {
      const { cam, zones } = plan(pic, { ...base, scale, likeness: 0.8, imageContrast: 1.2 });
      const [x, y] = cam.ground(cam.sheet[0] / 2, cam.sheet[1] / 2);
      const c = Math.floor((y - zones.y0) / zones.cell) * zones.W + Math.floor((x - zones.x0) / zones.cell);
      expect(BUILT.has(LABELS[zones.label[c]])).toBe(true);
      expect(zones.warmth[c]).toBeGreaterThan(0.25);
      if (scale === 4000) expect(zones.warmth[c]).toBeLessThan(1);
    }
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
  test('more roundabouts lays more of them, and the streets still keep every rule', () => {
    const pic = PICTURES.gradient();
    const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id, scale: 2500, tilt: 40, sheet: 'a4', style: 'british' };
    const rings = (sc: Scene) => sc.town.ways.filter((w) => w.kind === 'road' && w.pts.length > 8 && Math.hypot(w.pts[0] - w.pts[w.pts.length - 2], w.pts[1] - w.pts[w.pts.length - 1]) < 0.5).length;
    const real = imageScene(pic, set);
    const more = imageScene({ ...pic, id: 'roundabouts' }, { ...set, imageRoundabouts: 1 });
    expect(rings(more)).toBeGreaterThan(rings(real) + 3);
    expect(streetRules(more.streets)).toEqual([]);
    expect(plausibility(more.town)).toEqual([]);
  });

  const pics = ['gradient', 'disc', 'stripes', 'cross', 'landscape'] as const;
  // Each picture with one street pattern, the two taking turns.
  for (const [k, name] of pics.entries())
    for (const fabric of [k % 2] as const)
      test(`${name}, ${fabric}: the streets keep every rule, and the town is plausible`, () => {
        const pic = PICTURES[name]();
        const sc = imageScene(pic, { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id, scale: 2500, tilt: 40, sheet: 'a4', fabric });
        expect(streetRules(sc.streets)).toEqual([]);
        expect(sc.streets.edges.length).toBeGreaterThan(10);
        expect(plausibility(sc.town)).toEqual([]);
      });
});
