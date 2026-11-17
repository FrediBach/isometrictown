/**
 * Image mode's pure parts: where the image lies on the sheet, colour and tone, reading the
 * picture, the drawn-as settings, the town's layout and the likeness score.
 */
import { describe, expect, test } from 'vitest';
import { decodePicture, encodePicture, nameOf, pictureId } from '@/app/image-store';
import { drawnAs, imageRegion, STYLE_PLACE } from '@/image';
import { dragFocus, fitImage, toImage, toSheet } from '@/image-fit';
import { readImage, toneAt } from '@/image-read';
import { coverage, fromOklab, hexToLinear, LABELS, likeness, material, mix, oklab } from '@/image-tone';
import { compat, slic } from '@/image-zones';
import { clean, degrees, planar, streetRules, type Graph } from '@/image-streets';
import { blocksOf, facesOf, lotRing, MIN_FILL, Occupancy, PARCEL, strip, type Lot } from '@/image-blocks';
import type { Zones } from '@/image-zones';
import { classify } from '@/classify';
import { bestRect } from '@/shape';
import { STYLES } from '@/styles';
import { empty, type Tagged } from '@/tiles';
import { chaikin, contours, simplify, waterOf } from '@/image-water';
import { ringArea } from '@/geo';
import { toSvg } from '@/plot';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
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

describe('reading structure', () => {
  const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image' };
  const rect = [0, 0, 100, 60];
  const mid = (t: ReturnType<typeof readImage>) => Math.floor(t.H / 2) * t.W;

  test('a step makes one edge, where the step is, and no thin lines', () => {
    const t = readImage(paint('Step', (u) => (u < 0.5 ? [40, 40, 40] : [230, 230, 230])), set, rect);
    const xs = [...Array(t.W).keys()].filter((x) => t.edge[mid(t) + x] > 0);
    expect(xs.length).toBeGreaterThan(0);
    expect(xs.length).toBeLessThanOrEqual(2);
    expect(Math.abs((xs[0] + 0.5) * t.cell - 50)).toBeLessThan(1);
    expect(t.ridge.every((r) => r === 0)).toBe(true);
    // Contours run down the step, a quarter turn from across it.
    expect(Math.abs(Math.cos(t.dir[mid(t) + Math.round(t.W / 2)]))).toBeLessThan(0.05);
    expect(t.coherence[mid(t) + Math.round(t.W / 2)]).toBeGreaterThan(0.9);
  });

  test('thin lines are found in their middle, bright or dark', () => {
    for (const [v, sign] of [[250, 1], [20, -1]] as const) {
      const t = readImage(paint('Line', (u) => (Math.abs(u - 0.5) < 0.004 ? [v, v, v] : [128, 128, 128])), set, rect);
      const xs = [...Array(t.W).keys()].filter((x) => t.ridge[mid(t) + x] !== 0);
      expect(xs.length).toBeGreaterThan(0);
      expect(xs.every((x) => t.ridge[mid(t) + x] === sign && Math.abs((x + 0.5) * t.cell - 50) < 1)).toBe(true);
    }
  });

  test("Fit's margins make no edge", () => {
    const t = readImage(PICTURES.gradient(), { ...set, imageFit: 'fit' }, [0, 0, 400, 100]);
    expect(t.edge.every((e) => e === 0)).toBe(true);
  });
});

describe('zoning', () => {
  test('compat is symmetric and free between like labels', () => {
    for (const a of LABELS) for (const b of LABELS) expect(compat(a, b)).toBe(compat(b, a));
    for (const a of LABELS) expect(compat(a, a)).toBe(0);
  });

  test('materials grow darker with level and stay on the paper', () => {
    for (const l of LABELS) {
      for (const w of [0, 1]) for (const v of [0, 0.5, 1]) for (const c of material(l, v, w)) expect(c >= 0 && c <= 1).toBe(true);
    }
    const ink = (l: (typeof LABELS)[number], v: number) => material(l, v).reduce((a, c) => a + c, 0);
    expect(ink('old', 0.5)).toBeGreaterThan(ink('meadow', 0.5));
  });

  test('superpixels cover the grid, connected, about the size asked', () => {
    const W = 60;
    const H = 40;
    const lab = new Float32Array(W * H * 3).map((_, i) => (i % 3 ? 0 : Math.floor(i / 3) % W < 30 ? 0.5 : 0.9));
    const sp = slic(lab, W, H, 6);
    const count = Math.max(...sp) + 1;
    expect(sp.every((v) => v >= 0)).toBe(true);
    expect(count).toBeGreaterThan(30);
    expect(count).toBeLessThan(120);
    // None straddles the step.
    for (let s = 0; s < count; s++) {
      const xs = [...sp.keys()].filter((c) => sp[c] === s).map((c) => c % W);
      expect(Math.max(...xs) < 30 || Math.min(...xs) >= 30).toBe(true);
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

describe('outlines and water', () => {
  const g = { x0: 0, y0: 0, cell: 1, W: 6, H: 5 };
  const grid = (rows: string[]) => Uint8Array.from(rows.reverse().join(''), (c) => (c === '#' ? 1 : 0));

  test('outlines run counter-clockwise round land and clockwise round holes, and corners keep cells apart', () => {
    const rings = contours(grid(['######', '#....#', '#.##.#', '#....#', '######']), g);
    expect(rings.map((r) => Math.sign(ringArea(r))).sort()).toEqual([-1, 1, 1]);
    expect(rings.map((r) => Math.abs(ringArea(r))).sort((a, b) => a - b)).toEqual([2, 12, 30]);
    const diag = contours(grid(['......', '.#....', '..#...', '......', '......']), g);
    expect(diag.length).toBe(2);
  });

  test('simplify keeps corners and drops what is within tolerance; Chaikin keeps the ends of an open line', () => {
    expect(simplify([0, 0, 1, 0.01, 2, 0, 2, 2], 0.1)).toEqual([0, 0, 2, 0, 2, 2]);
    const c = chaikin([0, 0, 10, 0, 10, 10], 2);
    expect(c.slice(0, 2)).toEqual([0, 0]);
    expect(c.slice(-2)).toEqual([10, 10]);
  });

  test('water is a river when thin, the sea when it runs off the plan, else a lake', () => {
    const z = (fill: (i: number, j: number) => boolean) => {
      const W = 100;
      const H = 100;
      const label = new Uint8Array(W * H).fill(LABELS.indexOf('meadow'));
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (fill(i, j)) label[j * W + i] = LABELS.indexOf('water');
      return { x0: 0, y0: 0, cell: 4, W, H, label, level: new Float32Array(W * H), warmth: new Float32Array(W * H), sp: new Int32Array(W * H) };
    };
    expect(waterOf(z((i, j) => Math.hypot(i - 50, j - 50) < 20)).cls).toEqual(['lake']);
    expect(waterOf(z((i) => Math.abs(i - 50) < 3)).cls).toEqual(['river']);
    expect(waterOf(z((_, j) => j < 30)).cls).toEqual(['ocean']);
  });
});

describe('the street graph', () => {
  const line = (pts: number[], cls = 'minor', main = false) => ({ pts, cls, main });

  test('lines are split where they cross and where one ends on another', () => {
    const g = planar([line([0, 50, 100, 50]), line([50, 0, 50, 100]), line([80, 50.8, 80, 120])]);
    expect(g.nodes.length / 2).toBe(7);
    expect(g.edges.length).toBe(6);
    const deg = degrees(g);
    expect([...deg].sort()).toEqual([1, 1, 1, 1, 1, 3, 4]);
  });

  test('cleaning mends what breaks the rules and keeps one network', () => {
    const g = planar([
      line([0, 0, 300, 0], 'primary', true),
      line([100, 0, 100, 200]),
      line([106, 0, 106, -150]), // a junction 6 m from another
      line([200, 0, 200, 12]), // a dead end of 12 m
      line([300, 0, 150, 30]), // a sharp angle with the main road
      line([0, 400, 200, 400]), // a separate piece 200 m off
    ]);
    expect(streetRules(g).length).toBeGreaterThan(0);
    const c = clean(g, () => false);
    expect(streetRules(c)).toEqual([]);
    expect(c.edges.some((e) => e.main)).toBe(true);
  });

});

describe('blocks and lots', () => {
  // Streets on a 120 m grid, four by four, so nine blocks, and a dead end into one of them.
  const lines = [];
  for (let k = 0; k <= 3; k++) lines.push({ pts: [0, k * 120, 360, k * 120], cls: 'minor', main: false }, { pts: [k * 120, 0, k * 120, 360], cls: 'minor', main: false });
  lines.push({ pts: [180, 120, 180, 170], cls: 'minor', main: false });
  const grid: Graph = planar(lines);
  /** A land plan of one label everywhere, at a middling level. */
  const plan = (label: (typeof LABELS)[number]): Zones => {
    const cell = 4;
    const W = 120;
    const H = 120;
    return { x0: -60, y0: -60, cell, W, H, label: new Uint8Array(W * H).fill(LABELS.indexOf(label)), level: new Float32Array(W * H).fill(0.5), warmth: new Float32Array(W * H).fill(0.5), sp: new Int32Array(W * H) };
  };
  const vary = (x: number, y: number, salt: number) => (Math.abs(Math.sin(x * 12.9898 + y * 78.233 + salt)) * 43758.5453) % 1;

  test('the faces of a street grid are its blocks, counter-clockwise, without the outside or the dead end', () => {
    const faces = facesOf(grid);
    expect(faces.length).toBe(9);
    for (const f of faces) {
      expect(ringArea(f.pts)).toBeGreaterThan(100 * 100);
      expect(ringArea(f.pts)).toBeLessThan(121 * 121);
    }
  });

  test('lots front the street, are no slivers, and neighbours share their cut lines exactly', () => {
    for (const label of ['old', 'rows', 'suburb', 'works'] as const) {
      const blocks = blocksOf(grid, plan(label), vary, 4);
      expect(blocks.length).toBe(9);
      for (const b of blocks) {
        expect(b.lots.length).toBeGreaterThan(label === 'works' ? 2 : 6);
        for (const l of b.lots) {
          expect(bestRect(lotRing(l)).fill).toBeGreaterThanOrEqual(MIN_FILL);
          expect(ringArea(lotRing(l))).toBeGreaterThan(0);
          // The front is on the rim: half the street and a pavement in from the nearest street line.
          for (let k = 0; k < l.o.length; k += 2) {
            const d = Math.min(...[0, 120, 240, 360].flatMap((g) => [Math.abs(l.o[k] - g), Math.abs(l.o[k + 1] - g)]));
            expect(d).toBeCloseTo(6.5, 3);
          }
        }
        const sides = new Map<number, Lot[]>();
        for (const l of b.lots) (sides.get(l.side) ?? sides.set(l.side, []).get(l.side)!).push(l);
        for (const list of sides.values())
          for (let k = 1; k < list.length; k++) {
            if (list[k].index !== list[k - 1].index + 1) continue;
            const [a, c] = [list[k - 1], list[k]];
            expect(c.o.slice(0, 2)).toEqual(a.o.slice(-2));
            expect(c.i.slice(0, 2)).toEqual(a.i.slice(-2));
            // Buildings cut at one depth share their corners too.
            const pa = strip(a, 0.1, 0.8);
            const pc = strip(c, 0.1, 0.8);
            expect(pc.slice(0, 2)).toEqual(pa.slice(a.o.length - 2, a.o.length));
          }
      }
    }
  });

  test('lots take their depth from the zone, and the corner lots span the corner', () => {
    const blocks = blocksOf(grid, plan('suburb'), vary, 4);
    for (const b of blocks) {
      expect(b.depth).toBeGreaterThanOrEqual(PARCEL.suburb!.depth[0] * 0.75 ** 2);
      expect(b.depth).toBeLessThanOrEqual(PARCEL.suburb!.depth[1]);
      // Four corners, each inside one lot's front.
      const corners = b.lots.filter((l) => {
        for (let k = 2; k < l.o.length - 2; k += 2) {
          const a = Math.atan2(l.o[k + 1] - l.o[k - 1], l.o[k] - l.o[k - 2]);
          const c = Math.atan2(l.o[k + 3] - l.o[k + 1], l.o[k + 2] - l.o[k]);
          if (Math.abs(Math.abs(c - a) - Math.PI / 2) < 0.1 || Math.abs(Math.abs(c - a) - (3 * Math.PI) / 2) < 0.1) return true;
        }
        return false;
      });
      expect(corners.length).toBe(4);
    }
  });

  test('the occupancy raster lets neighbours share a line, never overlap', () => {
    const occ = new Occupancy(0, 0, 0.75, 100, 100);
    const a = [10, 10, 30, 10, 30, 30, 10, 30];
    const b = [30, 10, 50, 10, 50, 30, 30, 30];
    const c = [28, 12, 48, 12, 48, 28, 28, 28];
    expect(occ.free(a, 3)).toBe(true);
    occ.take(a, 3);
    expect(occ.free(b, 3)).toBe(true);
    expect(occ.free(c, 3)).toBe(false);
    // Ground that may not be shared blocks even the outline.
    occ.fill([[50.2, 0, 60, 0, 60, 60, 50.2, 60]]);
    expect(occ.free(b, 3)).toBe(false);
  });
});

describe('evidence for classify', () => {
  const style = STYLES.central;
  const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image', osmTags: false };
  /** One building of a size, tagged as image mode tags it, classified alone. */
  const one = (w: number, d: number, h: number, tag: Omit<Tagged, 'x' | 'y'>, poi?: { cls: string; sub: string }) => {
    const town = empty();
    town.buildings = [{ shape: [{ pts: [0, 0, w, 0, w, d, 0, d], seam: new Uint8Array(4) }], h, min: 0 }];
    town.tagged = [{ x: w / 2, y: d / 2, from: 'image', ...tag }];
    town.landuse = [{ shape: [{ pts: [-50, -50, 150, -50, 150, 150, -50, 150], seam: new Uint8Array(4) }], cls: tag.building === 'industrial' || tag.building === 'warehouse' ? 'industrial' : 'residential' }];
    if (poi) town.pois = [{ x: w / 2, y: d / 2, ...poi }];
    town.nearby = { landuse: town.landuse, pois: town.pois, numbers: [], helipads: [], ways: [] };
    classify(town, style, set, (x, y) => [Math.round(x), Math.round(y)]);
    return town.buildings[0].info!;
  };

  test('each building type image mode gives becomes the kind it means', () => {
    expect(one(10, 9, 6, { building: 'house' }).kind).toBe('house');
    expect(one(6, 11, 9, { building: 'terrace' }).kind).toBe('terrace');
    expect(one(30, 14, 18, { building: 'apartments' }).kind).toBe('apartment');
    expect(one(20, 20, 70, { building: 'apartments', roof: 'flat' }).kind).toBe('apartment');
    expect(one(50, 35, 14, { building: 'industrial', roof: 'sawtooth' }).kind).toBe('industrial');
    expect(one(50, 35, 14, { building: 'warehouse', roof: 'flat' }).kind).toBe('industrial');
    expect(one(40, 13, 9, { building: 'school', roof: 'flat' }).kind).toBe('civic');
    expect(one(14, 30, 15, { building: 'church' }).kind).toBe('worship');
    expect(one(3, 3.5, 2.6, { building: 'shed' }).kind).toBe('shed');
  });

  test('roof tags are kept, a town hall flies its flag, and none of it counts as OSM tags', () => {
    expect(one(50, 35, 14, { building: 'industrial', roof: 'sawtooth' }).roof).toBe('sawtooth');
    expect(one(30, 14, 18, { building: 'apartments', roof: 'flat' }).roof).toBe('flat');
    const hall = one(24, 14, 12, { building: 'civic' }, { cls: 'town_hall', sub: 'townhall' });
    expect(hall.kind).toBe('civic');
    expect(hall.townHall).toBe(true);
    expect(one(10, 9, 6, { building: 'house', roof: 'gabled' }).tagged).toBe(false);
  });
});

