/**
 * Image mode: a town laid out from an image instead of the map, so that the drawing seen from a
 * step away looks like the image. See docs/plans/image-mode.md.
 *
 * The image is read into a target (`image-read.ts`) and the ground zoned to match it
 * (`image-zones.ts`). Water, parks, woods, fields and squares take the zones' own outlines
 * (`image-water.ts`), the streets are laid out over the built zones (`image-streets.ts`), and
 * buildings stand along the streets the way each zone's buildings do, in rows, round
 * courtyards, in gardens or on open ground. Blocks and parcels (M3) replace that last step.
 */
import { Camera } from './camera';
import { Frame, type LngLat } from './geo';
import { readImage, type Target } from './image-read';
import { streets, type Graph } from './image-streets';
import { LABELS, type Label } from './image-tone';
import { maskOf, shapesOf, waterOf } from './image-water';
import { colourCounts, zone, type Zones } from './image-zones';
import { reachHeight } from './render';
import { hash } from './rng';
import type { Settings } from './settings';
import { IMAGE_STYLE, STYLES, type Region, type Style, type StyleId } from './styles';
import { empty, type Area, type Building, type Tagged, type Town, type Way } from './tiles';

/** An image, normalised on the main thread: at most 1024 px on its long side, as straight RGBA. `id` names its content. */
export type Picture = { id: string; name: string; w: number; h: number; rgba: Uint8ClampedArray };

/**
 * A nominal centre for each style. Only the latitude matters: it sets the sun, the side that gets
 * more windows and where palms grow, so they suit the style. The fictional `Frame` is built from it.
 */
export const STYLE_PLACE: Record<StyleId, LngLat> = {
  alpine: [9, 47],
  dutch: [5, 52],
  central: [10, 50],
  nordic: [15, 60],
  british: [-2, 53],
  french: [2, 47],
  mediterranean: [14, 40],
  eastern: [30, 50],
  arid: [8, 31],
  eastAsian: [135, 35],
  tropical: [100, 8],
  american: [-90, 40],
  antipodean: [150, -34],
  generic: [0, 48],
};

/** Styles that drive on the left. */
const LEFT = new Set<StyleId>(['british', 'antipodean']);

/** The settings an image-mode drawing is made with: a fictional place for the style, the image's name, and no OSM tags. */
export function drawnAs(set: Settings): Settings {
  const style = set.style === 'auto' ? IMAGE_STYLE : set.style;
  return { ...set, center: STYLE_PLACE[style], place: set.imageName || 'Image', osmTags: false };
}

/** The region an image-mode town stands in: no country, the chosen style. */
export function imageRegion(set: Settings): Region {
  const style = set.style === 'auto' ? IMAGE_STYLE : set.style;
  return { country: 'Image', code: '', style, left: LEFT.has(style) };
}

/** Everything a drawing from an image needs: the drawn-as settings, the camera, the target, the land plan and the town. */
export type Scene = { set: Settings; cam: Camera; frame: Frame; box: [number, number, number, number]; target: Target; zones: Zones; streets: Graph; town: Town; region: Region; style: Style };

/**
 * Settings the town's layout depends on, besides the pens when colour counts (see
 * `colourCounts()`). Detail, pen width, sun, shadows and the layer switches only change how it
 * is drawn, so they never move a street.
 */
const STRUCTURE: (keyof Settings)[] = ['imageFit', 'imageFocus', 'imageLight', 'imageContrast', 'imageColour', 'mono', 'likeness', 'fabric', 'style', 'seed', 'sheet', 'landscape', 'margin', 'marginalia', 'scale', 'bearing', 'tilt', 'heightScale'];
/** And the target, on what decides how the drawing should look. */
const LOOK: (keyof Settings)[] = ['imageFit', 'imageFocus', 'imageLight', 'imageContrast', 'imageColour', 'mono', 'pens', 'customBackground', 'background', 'sheet', 'landscape', 'margin', 'marginalia'];

const keyOf = (pic: Picture, set: Settings, keys: (keyof Settings)[], more: unknown = null) => JSON.stringify([pic.id, ...keys.map((k) => set[k]), more]);

/** The last town laid out and the last target read, kept pristine: rendering writes into buildings. */
let laid: { key: string; town: Town; zones: Zones; streets: Graph } | null = null;
let read: { key: string; target: Target } | null = null;

/** Lay out the town for a picture (or take the last one, if nothing it depends on changed), reporting each step. */
export function imageScene(pic: Picture, set: Settings, note: (text: string) => void = () => {}): Scene {
  const drawn = drawnAs(set);
  const cam = new Camera(drawn);
  const frame = new Frame(drawn.center);
  const box = cam.region(reachHeight(drawn));
  const region = imageRegion(drawn);
  const style = STYLES[region.style];
  const lookKey = keyOf(pic, drawn, LOOK);
  if (read?.key !== lookKey) {
    note('Reading the image');
    read = { key: lookKey, target: readImage(pic, drawn, cam.rect) };
  }
  const target = read.target;
  const townKey = keyOf(pic, drawn, STRUCTURE, colourCounts(drawn) ? [drawn.pens, drawn.customBackground, drawn.background] : null);
  if (laid?.key !== townKey) {
    note('Zoning the ground');
    const zones = zone(target, drawn, cam, [box[0] - PLAN_MARGIN, box[1] - PLAN_MARGIN, box[2] + PLAN_MARGIN, box[3] + PLAN_MARGIN]);
    note('Laying out streets');
    laid = { key: townKey, zones, ...imageTown(zones, target, drawn, cam, frame, box, style) };
  }
  return { set: drawn, cam, frame, box, target, zones: laid.zones, streets: laid.streets, town: structuredClone(laid.town), region, style };
}

/** The land plan reaches this far beyond the ground that can show, m, so streets run off the sheet and buildings at its edge have neighbours. */
const PLAN_MARGIN = 150;
/** Buildings are laid out this far beyond the ground that can show, m; those beyond it are context only. */
const MARGIN = 60;
/** The most buildings a town gets (§17). */
const MAX_BUILDINGS = 30000;
/** Pavement between the road and the front of a plot, m. */
const PAVEMENT = 2;
/** Storeys of each built label at its lowest and highest level. */
const STOREYS: Partial<Record<Label, [number, number]>> = { suburb: [1, 2], rows: [2, 3], old: [3, 5], blocks: [4, 7], towers: [10, 24], works: [2, 4] };

/**
 * How each built zone stands along its streets, at its sparsest level and its densest: plot width
 * along the street, building width (0 for the whole plot, so neighbours share their walls),
 * depth and set-back, m, and the OSM building type it is said to be.
 */
type Frontage = { lot: [number, number]; width: [number, number]; depth: [number, number]; back: [number, number]; building: string };
const FRONTAGE: Partial<Record<Label, Frontage>> = {
  suburb: { lot: [28, 18], width: [9, 12], depth: [8, 11], back: [7, 4], building: 'house' },
  rows: { lot: [7.5, 6], width: [0, 0], depth: [9, 12], back: [2.5, 1], building: 'terrace' },
  old: { lot: [9, 6], width: [0, 0], depth: [12, 16], back: [0.5, 0], building: 'terrace' },
  blocks: { lot: [36, 24], width: [0, 0], depth: [13, 16], back: [2, 0], building: 'apartments' },
  towers: { lot: [95, 70], width: [18, 24], depth: [18, 24], back: [20, 14], building: 'apartments' },
  works: { lot: [75, 55], width: [40, 55], depth: [28, 45], back: [12, 8], building: 'industrial' },
};

/** The narrowest plot in a row on paper, mm: at coarse scales rows are drawn as fewer, longer buildings. */
const ROW_LOT_MM = 1.4;

/** Cells of the occupancy raster that keeps buildings off roads and each other, m, at the finest. */
const OCCUPY = 0.75;

/**
 * The town for a land plan: the zones' outlines for water, parks, woods, fields and squares;
 * streets over the built zones; and along every street, buildings the way the zone it passes
 * through has them.
 */
export function imageTown(zones: Zones, target: Target, set: Settings, cam: Camera, frame: Frame, box: [number, number, number, number], style: Style): { town: Town; streets: Graph } {
  const town = empty();
  // Map-fixed keys, as `B.key` gives them, from the fictional frame.
  const key = (x: number, y: number): [number, number] => [Math.round(frame.mx0 + x / frame.k), Math.round(frame.my0 + y / frame.k)];

  // Ground: each kind of open land from its zones' outline.
  const water = waterOf(zones);
  town.water = water.shapes;
  town.waterCls = water.cls;
  town.plazas = shapesOf(maskOf(zones, ['plaza']), zones, 4);
  const parks = shapesOf(maskOf(zones, ['park']), zones, 4);
  town.green = parks;
  town.wood = shapesOf(maskOf(zones, ['wood']), zones, 4);
  const cover: [Label, string][] = [['field', 'farmland'], ['meadow', 'meadow'], ['allot', 'allotments'], ['sand', 'beach']];
  for (const [l, cls] of cover) for (const shape of shapesOf(maskOf(zones, [l]), zones, 4)) town.cover.push({ shape, cls });

  // Streets, paths and streams.
  const st = streets(zones, target, cam, { likeness: set.likeness, fabric: set.fabric, seed: set.seed, style: style.id }, parks);
  town.ways = [...st.ways, ...st.paths];
  town.plazas.push(...st.circles);
  town.streams = st.streams;

  // Land use, so gardens, fences and works yards come with the buildings.
  const landuse: Area[] = [
    ...shapesOf(maskOf(zones, ['suburb', 'rows', 'old', 'blocks', 'towers']), zones, 4).map((shape) => ({ shape, cls: 'residential' })),
    ...shapesOf(maskOf(zones, ['works']), zones, 4).map((shape) => ({ shape, cls: 'industrial' })),
  ];
  town.landuse = landuse;

  // Buildings along the streets.
  const { buildings, tagged } = frontages(zones, st.ways, set, style, box, key);
  town.buildings = buildings;
  town.tagged = tagged;
  for (const b of buildings) {
    const p = b.shape[0].pts;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < p.length; i += 2) {
      cx += p[i] / (p.length / 2);
      cy += p[i + 1] / (p.length / 2);
    }
    const area = Math.abs((p[2] - p[0]) * (p[5] - p[3]) - (p[3] - p[1]) * (p[4] - p[2]));
    town.density.built.push(cx, cy, area);
  }
  town.nearby = { landuse, pois: [], numbers: [], helipads: [], ways: town.ways };
  return { town, streets: st.graph };
}

/**
 * Buildings set along both sides of every street, the busiest first, each the way the zone it
 * stands in has them. A raster of what is taken keeps them off roads and each other, so rows
 * break at corners and bends; houses in a row share their walls exactly.
 */
function frontages(z: Zones, ways: Way[], set: Settings, style: Style, box: number[], key: (x: number, y: number) => [number, number]): { buildings: Building[]; tagged: Tagged[] } {
  const mmPerMetre = 1000 / set.scale;
  const [bx0, by0, bx1, by1] = box;
  const ox = z.x0;
  const oy = z.y0;
  // Fine enough that a cell marked well inside one house never reaches past the wall it shares.
  const cs = Math.max(OCCUPY, z.cell / 4);
  const OW = Math.ceil((z.W * z.cell) / cs);
  const OH = Math.ceil((z.H * z.cell) / cs);
  const taken = new Uint8Array(OW * OH);
  const cellOf = (x: number, y: number) => {
    const i = Math.floor((x - ox) / cs);
    const j = Math.floor((y - oy) / cs);
    return i < 0 || j < 0 || i >= OW || j >= OH ? -1 : j * OW + i;
  };
  const zoneAt = (x: number, y: number) => {
    const i = Math.floor((x - z.x0) / z.cell);
    const j = Math.floor((y - z.y0) / z.cell);
    return i < 0 || j < 0 || i >= z.W || j >= z.H ? -1 : j * z.W + i;
  };
  // Roads and their pavements are taken, a cell short so a front wall on the pavement's edge is free.
  for (const w of ways) {
    const r = w.width / 2 + PAVEMENT - cs;
    const p = w.pts;
    for (let i = 2; i < p.length; i += 2) {
      const len = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      const n = Math.max(1, Math.ceil(len / cs));
      for (let k = 0; k <= n; k++) {
        const x = p[i - 2] + ((p[i] - p[i - 2]) * k) / n;
        const y = p[i - 1] + ((p[i + 1] - p[i - 1]) * k) / n;
        for (let dy = -r; dy <= r; dy += cs * 0.7)
          for (let dx = -r; dx <= r; dx += cs * 0.7) {
            if (dx * dx + dy * dy > r * r) continue;
            const c = cellOf(x + dx, y + dy);
            if (c >= 0) taken[c] = 1;
          }
      }
    }
  }
  /** Points over a rectangle (corners a, b, c, d), `inset` m inside its outline, about `step` m apart. */
  const over = (q: number[], inset: number, step: number, fn: (x: number, y: number) => boolean) => {
    const [ax, ay, bx, by, , , dx, dy] = q;
    const along = Math.hypot(bx - ax, by - ay);
    const across = Math.hypot(dx - ax, dy - ay);
    const nu = Math.max(1, Math.ceil((along - 2 * inset) / step));
    const nv = Math.max(1, Math.ceil((across - 2 * inset) / step));
    for (let u = 0; u <= nu; u++)
      for (let v = 0; v <= nv; v++) {
        const s = (inset + ((along - 2 * inset) * u) / nu) / along;
        const t = (inset + ((across - 2 * inset) * v) / nv) / across;
        if (!fn(ax + (bx - ax) * s + (dx - ax) * t, ay + (by - ay) * s + (dy - ay) * t)) return false;
      }
    return true;
  };
  /** Whether a rectangle is free and all on land of `label`: tested just inside its outline, so neighbours in a row may share their walls. */
  const free = (q: number[], label: number) =>
    over(q, 0.4 * cs, Math.min(1.2, cs), (x, y) => {
      const c = cellOf(x, y);
      const zc = zoneAt(x, y);
      return c >= 0 && zc >= 0 && !taken[c] && z.label[zc] === label;
    });
  /** Mark a rectangle taken, only well inside its outline, so the next house in the row can still share the wall. */
  const take = (q: number[]) =>
    over(q, 1.4 * cs, cs * 0.5, (x, y) => {
      const c = cellOf(x, y);
      if (c >= 0) taken[c] = 1;
      return true;
    });
  const inBox = (x: number, y: number, pad: number) => x >= bx0 - pad && x <= bx1 + pad && y >= by0 - pad && y <= by1 + pad;
  const RANKS: Record<string, number> = { primary: 4, secondary: 3, tertiary: 2, minor: 1 };
  const order = ways.map((_, i) => i).sort((a, b) => (RANKS[ways[b].cls] ?? 0) - (RANKS[ways[a].cls] ?? 0) || a - b);
  const buildings: Building[] = [];
  const tagged: Tagged[] = [];
  for (const wi of order) {
    const w = ways[wi];
    if (w.bridge) continue;
    const p = w.pts;
    // Distance along the street at each point, and the point at any distance.
    const cum = [0];
    for (let i = 2; i < p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
    const total = cum[cum.length - 1];
    let seg = 0;
    const pointAt = (d: number): [number, number] => {
      while (seg > 0 && cum[seg] > d) seg--;
      while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
      const t = (d - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
      return [p[seg * 2] + (p[seg * 2 + 2] - p[seg * 2]) * t, p[seg * 2 + 1] + (p[seg * 2 + 3] - p[seg * 2 + 1]) * t];
    };
    for (const side of [1, -1]) {
      // A row keeps one depth and building line along a street side.
      const ks = key(p[0], p[1]);
      const rowHash = hash(ks[0], ks[1], set.seed, side > 0 ? 14020 : 14021);
      let s = 4;
      while (s < total - 4 && buildings.length < MAX_BUILDINGS) {
        // The street's way here: along the chord a few metres either side.
        const [fx, fy] = pointAt(s);
        const [gx, gy] = pointAt(Math.min(total, s + 6));
        const len = Math.hypot(gx - fx, gy - fy) || 1;
        const ux = (gx - fx) / len;
        const uy = (gy - fy) / len;
        const probe = zoneAt(fx - uy * side * (w.width / 2 + PAVEMENT + 6), fy + ux * side * (w.width / 2 + PAVEMENT + 6));
        const label = probe < 0 ? undefined : LABELS[z.label[probe]];
        const f = label && FRONTAGE[label];
        if (!f || !label) {
          s += 6;
          continue;
        }
        const level = z.level[probe];
        const at = (r: [number, number]) => r[0] + (r[1] - r[0]) * level;
        const lot = f.width[1] === 0 ? Math.max(at(f.lot), ROW_LOT_MM / mmPerMetre) : at(f.lot);
        if (s + lot > total - 4) break;
        const row = f.width[1] === 0;
        const [ax, ay] = pointAt(s);
        const [bx, by] = pointAt(s + lot);
        const chord = Math.hypot(bx - ax, by - ay);
        // Where the street bends sharply under a plot, there is no room for one.
        if (chord < lot * 0.9) {
          s += lot;
          continue;
        }
        const cx0 = (bx - ax) / chord;
        const cy0 = (by - ay) / chord;
        const nx = -cy0 * side;
        const ny = cx0 * side;
        const k = key((ax + bx) / 2, (ay + by) / 2);
        const vary = (salt: number) => hash(k[0], k[1], set.seed, salt);
        const width = row ? chord : Math.min(chord - 2, at(f.width) + 2 * (vary(14022) - 0.5));
        const depth = at(f.depth) + (row ? 2 * rowHash : 2 * vary(14023));
        const back = w.width / 2 + PAVEMENT + at(f.back) * (row ? 1 : 0.7 + 0.6 * vary(14024));
        const s0 = (chord - width) / 2;
        const fr = [ax + cx0 * s0 + nx * back, ay + cy0 * s0 + ny * back, ax + cx0 * (s0 + width) + nx * back, ay + cy0 * (s0 + width) + ny * back];
        let q = [...fr, fr[2] + nx * depth, fr[3] + ny * depth, fr[0] + nx * depth, fr[1] + ny * depth];
        // Corners counter-clockwise, still starting on the street side.
        if ((q[2] - q[0]) * (q[7] - q[1]) - (q[3] - q[1]) * (q[6] - q[0]) < 0) q = [q[2], q[3], q[0], q[1], q[6], q[7], q[4], q[5]];
        const cx = (q[0] + q[4]) / 2;
        const cy = (q[1] + q[5]) / 2;
        if (inBox(cx, cy, MARGIN) && free(q, z.label[probe])) {
          take(q);
          const [lo, hi] = STOREYS[label] ?? [1, 2];
          const st = Math.max(lo, Math.min(hi, Math.round(lo + (hi - lo) * level + (vary(14025) - 0.5) * 0.9)));
          const h = label === 'works' ? 6 + 2.5 * st : st * style.floor;
          const b: Building = { shape: [{ pts: q, seam: new Uint8Array(4) }], h, min: 0 };
          if (!inBox(cx, cy, 0)) b.context = true;
          buildings.push(b);
          const warm = z.warmth[probe];
          const roof = label === 'works' ? (vary(14026) < warm ? 'sawtooth' : 'flat') : label === 'towers' || vary(14027) >= warm ? 'flat' : undefined;
          const kind = label === 'old' && st > 3 ? 'apartments' : label === 'works' && vary(14028) < 0.4 ? 'warehouse' : f.building;
          tagged.push({ x: cx, y: cy, building: kind, roof, from: 'image' });
        }
        s += lot;
      }
    }
  }
  return { buildings, tagged };
}
