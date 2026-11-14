import { VectorTile, type VectorTileFeature } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { Info } from './classify';
import { EARTH, ringArea, type Frame } from './geo';

/** A ring as flat [x, y, ...] coordinates. seam[i] marks edge i -> i+1 as a cut along a tile edge. */
export type Ring = { pts: number[]; seam: Uint8Array };
/** Outer ring (counter-clockwise) followed by holes (clockwise). */
export type Shape = Ring[];

/** `guess` marks a building whose height is OpenMapTiles' 5 m default, i.e. the map gives none. */
export type Building = { shape: Shape; h: number; min: number; guess?: boolean; info?: Info };
/** Building tags from OpenStreetMap, at the building's centre. */
export type Tagged = { x: number; y: number; building?: string; roof?: string; across?: boolean };
export type WayKind = 'road' | 'rail' | 'path';
/** `sub` is the OpenMapTiles subclass (tram, narrow_gauge, steps…), `service` the kind of service road (parking_aisle, driveway…). */
export type Way = { pts: number[]; kind: WayKind; width: number; cls: string; sub?: string; service?: string; unpaved?: boolean; bridge?: boolean };
/** A cable car, gondola, chair lift or drag lift. */
export type Lift = { pts: number[]; cls: string };
/** A point of interest, e.g. a place of worship with its religion as `sub`. */
export type Poi = { x: number; y: number; cls: string; sub: string };
/** A land-use area such as residential or industrial. */
export type Area = { shape: Shape; cls: string };
/** A waterway centre line: canal, stream, ditch. */
export type Stream = { pts: number[]; width: number };

export type Town = {
  buildings: Building[];
  water: Shape[];
  green: Shape[];
  wood: Shape[];
  plazas: Shape[];
  ways: Way[];
  pois: Poi[];
  /** House-number points as flat [x, y, ...]. */
  numbers: number[];
  landuse: Area[];
  /** Land cover drawn with its own texture: farmland, vineyard, orchard, meadow, wetland, sand. */
  cover: Area[];
  streams: Stream[];
  /** Buildings with real OSM roof or type tags, when they could be fetched. */
  tagged: Tagged[];
  /** Roads and railways where they run underground, for portals where they come out. */
  tunnels: Way[];
  lifts: Lift[];
  /** Ferry routes as flat [x, y, ...]. */
  ferries: number[][];
  /** Swimming pools, kept apart from open water. */
  pools: Shape[];
  /** Runways and taxiways, with their widths. */
  runways: Way[];
  aprons: Shape[];
  /** Mountain summits, with their height in metres where known. */
  peaks: { x: number; y: number; ele: number }[];
};

const ZOOM = 14;
/** OpenMapTiles' render_height for buildings with no height or levels tagged. */
const DEFAULT_H = 5;
/** Extra margin (m) for buildings around the area drawn; more than the classifier's density radius. */
const BUILDING_PAD = 60;
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const MAX_TILES = 36;
const MAX_CACHED = 64;

export const ROAD_WIDTH: Record<string, number> = {
  motorway: 18,
  trunk: 15,
  primary: 13,
  secondary: 12,
  tertiary: 10,
  minor: 8,
  busway: 7,
  raceway: 8,
  service: 5,
};
const PATHS = new Set(['path', 'track', 'bridleway', 'cycleway', 'footway', 'steps']);
const GREEN_LANDUSE = new Set(['cemetery', 'pitch', 'playground', 'grass', 'park', 'garden', 'recreation_ground', 'village_green']);
const GREEN_COVER = new Set(['grass', 'wetland']);
/** Land uses that say something about the buildings standing on them. */
const BUILT_LANDUSE = new Set(['residential', 'industrial', 'commercial', 'retail', 'railway', 'school', 'university', 'college', 'hospital', 'military', 'garages', 'cemetery', 'pitch', 'track', 'stadium', 'playground', 'quarry']);
/** Shops, cafés and the like: a street of them gets shop fronts. */
export const SHOP_POIS = new Set(['shop', 'grocery', 'clothing_store', 'bakery', 'cafe', 'restaurant', 'bar', 'fast_food', 'beer', 'ice_cream', 'alcohol_shop', 'jewelry', 'bank', 'pharmacy', 'hairdresser', 'florist', 'butcher', 'optician', 'books', 'gift', 'shoes', 'music', 'mobile_phone', 'laundry']);
/** Points of interest that tell us what a building is, or what stands nearby. */
const KEY_POIS = new Set(['place_of_worship', 'school', 'college', 'kindergarten', 'town_hall', 'hospital', 'library', 'museum', 'castle', 'theatre', 'police', 'fire_station', 'post', 'lodging', 'railway', 'pitch', 'aerialway', 'harbor', 'fuel', 'campsite', 'bus', ...SHOP_POIS]);
const AERO_WIDTH: Record<string, number> = { runway: 45, taxiway: 18 };
const STREAM_WIDTH: Record<string, number> = { river: 9, canal: 7, stream: 2.5, drain: 1.6, ditch: 1.4 };

let template: Promise<string> | null = null;
const cache = new Map<string, Promise<Town>>();

function tileTemplate(): Promise<string> {
  template ??= fetch(TILEJSON)
    .then((r) => {
      if (!r.ok) throw new Error(`Tile index failed (${r.status})`);
      return r.json() as Promise<{ tiles: string[] }>;
    })
    .then((j) => j.tiles[0])
    .catch((e) => {
      template = null;
      throw e;
    });
  return template;
}

export class TooBigError extends Error {}

/** Load everything inside a local-metre bounding box, converted to local metres. */
export async function loadTown(frame: Frame, box: [number, number, number, number], onProgress?: (done: number, total: number) => void): Promise<Town> {
  const n = 2 ** ZOOM;
  const toTileX = (x: number) => Math.floor(((frame.mx0 + x / frame.k) / EARTH + 0.5) * n);
  const toTileY = (y: number) => Math.floor((0.5 - (frame.my0 + y / frame.k) / EARTH) * n);
  const tx0 = toTileX(box[0]);
  const tx1 = toTileX(box[2]);
  const ty0 = toTileY(box[3]);
  const ty1 = toTileY(box[1]);
  const count = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
  if (count > MAX_TILES) throw new TooBigError(`That needs ${count} map tiles. Zoom in a little (a larger scale) or pick a smaller sheet.`);

  const url = await tileTemplate();
  let done = 0;
  const jobs: Promise<Town>[] = [];
  for (let x = tx0; x <= tx1; x++) {
    for (let y = ty0; y <= ty1; y++) {
      const job = readTile(url, ((x % n) + n) % n, y);
      job.then(() => onProgress?.(++done, count)).catch(() => {});
      jobs.push(job);
    }
  }
  const tiles = await Promise.all(jobs);
  return assemble(tiles, frame, box);
}

function readTile(url: string, x: number, y: number): Promise<Town> {
  const key = `${x}/${y}`;
  let job = cache.get(key);
  if (!job) {
    job = fetch(url.replace('{z}', String(ZOOM)).replace('{x}', String(x)).replace('{y}', String(y)))
      .then((r) => {
        if (r.status === 204 || r.status === 404) return null;
        if (!r.ok) throw new Error(`Map tile failed (${r.status})`);
        return r.arrayBuffer();
      })
      .then((buf) => decode(buf, x, y));
    job.catch(() => cache.delete(key));
    cache.set(key, job);
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  }
  return job;
}

function empty(): Town {
  return { buildings: [], water: [], green: [], wood: [], plazas: [], ways: [], pois: [], numbers: [], landuse: [], cover: [], streams: [], tagged: [], tunnels: [], lifts: [], ferries: [], pools: [], runways: [], aprons: [], peaks: [] };
}

/** Decode one tile into absolute Web Mercator metres. */
function decode(buf: ArrayBuffer | null, tx: number, ty: number): Town {
  const town = empty();
  if (!buf) return town;
  const tile = new VectorTile(new PbfReader(new Uint8Array(buf)));
  const n = 2 ** ZOOM;
  const layers = tile.layers;

  const each = (name: string, fn: (f: VectorTileFeature, toMerc: (r: { x: number; y: number }[]) => number[] | null, ext: number) => void) => {
    const layer = layers[name];
    if (!layer) return;
    const ext = layer.extent;
    const toMerc = (r: { x: number; y: number }[]) => {
      if (r.length < 2) return null;
      const out = new Array<number>(r.length * 2);
      for (let i = 0; i < r.length; i++) {
        out[i * 2] = ((tx + r[i].x / ext) / n - 0.5) * EARTH;
        out[i * 2 + 1] = (0.5 - (ty + r[i].y / ext) / n) * EARTH;
      }
      return out;
    };
    for (let i = 0; i < layer.length; i++) fn(layer.feature(i), toMerc, ext);
  };

  const polygons = (f: VectorTileFeature, ext: number): Shape[] => {
    if (f.type !== 3) return [];
    const shapes: Shape[] = [];
    let outerSign = 0;
    for (const raw of f.loadGeometry()) {
      const flat: number[] = [];
      for (const p of raw) flat.push(p.x, p.y);
      if (flat.length > 2 && flat[0] === flat[flat.length - 2] && flat[1] === flat[flat.length - 1]) flat.length -= 2;
      const a = ringArea(flat);
      if (a === 0) continue;
      const sign = Math.sign(a);
      if (!outerSign) outerSign = sign;
      const clipped = clipRing(flat, ext);
      if (!clipped) continue;
      if (sign === outerSign) shapes.push([clipped]);
      else if (shapes.length) shapes[shapes.length - 1].push(clipped);
    }
    return shapes;
  };

  const toMercRing = (r: Ring): Ring => {
    const pts = r.pts.slice();
    for (let i = 0; i < pts.length; i += 2) {
      pts[i] = ((tx + pts[i] / 4096) / n - 0.5) * EARTH;
      pts[i + 1] = (0.5 - (ty + pts[i + 1] / 4096) / n) * EARTH;
    }
    return { pts, seam: r.seam };
  };
  const scaleShape = (s: Shape, ext: number): Shape =>
    s.map((r) => {
      if (ext !== 4096) for (let i = 0; i < r.pts.length; i++) r.pts[i] = (r.pts[i] / ext) * 4096;
      return toMercRing(r);
    });

  each('building', (f, _m, ext) => {
    const p = f.properties;
    if (p.hide_3d) return;
    const h = Number(p.render_height ?? DEFAULT_H) || DEFAULT_H;
    const min = Number(p.render_min_height ?? 0) || 0;
    const guess = (h === DEFAULT_H && min === 0) || undefined;
    for (const s of polygons(f, ext)) town.buildings.push({ shape: scaleShape(s, ext), h, min, guess });
  });

  const point = (f: VectorTileFeature, ext: number, fn: (x: number, y: number) => void) => {
    if (f.type !== 1) return;
    for (const ring of f.loadGeometry()) {
      for (const q of ring) {
        if (q.x < 0 || q.y < 0 || q.x >= ext || q.y >= ext) continue;
        fn(((tx + q.x / ext) / n - 0.5) * EARTH, (0.5 - (ty + q.y / ext) / n) * EARTH);
      }
    }
  };

  each('poi', (f, _m, ext) => {
    const cls = String(f.properties.class);
    if (!KEY_POIS.has(cls)) return;
    const sub = String(f.properties.subclass ?? '');
    point(f, ext, (x, y) => town.pois.push({ x, y, cls, sub }));
  });

  each('housenumber', (f, _m, ext) => point(f, ext, (x, y) => town.numbers.push(x, y)));

  each('mountain_peak', (f, _m, ext) => {
    const cls = String(f.properties.class);
    if (cls !== 'peak' && cls !== 'volcano') return;
    const ele = Number(f.properties.ele) || 0;
    point(f, ext, (x, y) => town.peaks.push({ x, y, ele }));
  });

  each('waterway', (f, toMerc, ext) => {
    const p = f.properties;
    const width = STREAM_WIDTH[String(p.class)];
    if (!width || p.brunnel === 'tunnel' || f.type !== 2) return;
    for (const line of f.loadGeometry()) {
      for (const piece of clipLine(line, ext)) {
        const pts = toMerc(piece);
        if (pts) town.streams.push({ pts, width });
      }
    }
  });

  each('water', (f, _m, ext) => {
    if (f.properties.brunnel === 'tunnel') return;
    const target = f.properties.class === 'swimming_pool' ? town.pools : town.water;
    for (const s of polygons(f, ext)) target.push(scaleShape(s, ext));
  });

  // The park layer also holds national parks and protected areas, which can cover a whole town; only real parks count.
  each('park', (f, _m, ext) => {
    if (f.properties.class !== 'park') return;
    for (const s of polygons(f, ext)) town.green.push(scaleShape(s, ext));
  });

  each('aeroway', (f, toMerc, ext) => {
    const cls = String(f.properties.class);
    if (f.type === 3) {
      // Aprons get parked planes; runway and helipad areas are plain hard standing.
      const target = cls === 'apron' ? town.aprons : cls === 'runway' || cls === 'helipad' ? town.plazas : null;
      if (target) for (const s of polygons(f, ext)) target.push(scaleShape(s, ext));
      return;
    }
    const width = AERO_WIDTH[cls];
    if (!width || f.type !== 2) return;
    for (const line of f.loadGeometry()) {
      for (const piece of clipLine(line, ext)) {
        const pts = toMerc(piece);
        if (pts) town.runways.push({ pts, kind: 'road', width, cls });
      }
    }
  });

  each('landcover', (f, _m, ext) => {
    const c = String(f.properties.class);
    const cover = coverKind(c, String(f.properties.subclass ?? ''));
    if (cover) for (const s of polygons(f, ext)) town.cover.push({ shape: scaleShape(s, ext), cls: cover });
    const target = c === 'wood' ? town.wood : GREEN_COVER.has(c) ? town.green : null;
    if (!target) return;
    for (const s of polygons(f, ext)) target.push(scaleShape(s, ext));
  });

  each('landuse', (f, _m, ext) => {
    const cls = String(f.properties.class);
    if (BUILT_LANDUSE.has(cls)) for (const s of polygons(f, ext)) town.landuse.push({ shape: scaleShape(s, ext), cls });
    if (!GREEN_LANDUSE.has(cls)) return;
    for (const s of polygons(f, ext)) town.green.push(scaleShape(s, ext));
  });

  each('transportation', (f, toMerc, ext) => {
    const p = f.properties;
    const cls = String(p.class);
    const lines = (fn: (pts: number[]) => void) => {
      for (const line of f.loadGeometry())
        for (const piece of clipLine(line, ext)) {
          const pts = toMerc(piece);
          if (pts) fn(pts);
        }
    };
    if (f.type === 2 && cls === 'aerialway') return lines((pts) => town.lifts.push({ pts, cls: String(p.subclass ?? '') }));
    if (f.type === 2 && cls === 'ferry') return lines((pts) => town.ferries.push(pts));
    if (cls === 'ferry' || cls === 'aerialway') return;
    const tunnel = p.brunnel === 'tunnel';
    const bridge = p.brunnel === 'bridge' || cls === 'pier' || undefined;
    if (f.type === 3) {
      if (cls === 'bridge' || tunnel) return;
      for (const s of polygons(f, ext)) town.plazas.push(scaleShape(s, ext));
      return;
    }
    if (f.type !== 2) return;
    let kind: WayKind;
    let width = 0;
    // Trams and light rail come as 'transit'; monorails would need pillars, so they're left out.
    if (cls === 'rail' || (cls === 'transit' && p.subclass !== 'monorail')) kind = 'rail';
    else if (cls === 'pier') kind = 'path';
    else if (PATHS.has(cls) || PATHS.has(String(p.subclass))) kind = 'path';
    else if (ROAD_WIDTH[cls]) {
      kind = 'road';
      width = ROAD_WIDTH[cls];
      if (p.ramp) width *= 0.7;
    } else return;
    const sub = cls === 'pier' ? 'pier' : p.subclass ? String(p.subclass) : undefined;
    const service = p.service ? String(p.service) : undefined;
    const unpaved = p.surface === 'unpaved' || undefined;
    lines((pts) => (tunnel ? town.tunnels : town.ways).push({ pts, kind, width, cls, sub, service, unpaved, bridge }));
  });

  return town;
}

/** Land cover that gets its own ground texture, by OpenMapTiles class and subclass. */
function coverKind(cls: string, sub: string): string | null {
  // Farmyards come as farmland of subclass 'farm': yards round the barns, not ploughed fields.
  if (cls === 'farmland') return sub === 'vineyard' ? 'vineyard' : sub === 'orchard' ? 'orchard' : sub === 'farm' ? 'farmyard' : 'farmland';
  if (cls === 'grass' && (sub === 'meadow' || sub === 'grassland' || sub === 'heath' || sub === 'fell')) return 'meadow';
  if (cls === 'grass' && (sub === 'scrub' || sub === 'shrubbery')) return 'scrub';
  if (cls === 'grass' && sub === 'allotments') return 'allotments';
  if (cls === 'wetland') return 'wetland';
  if (cls === 'sand') return sub === 'beach' ? 'beach' : 'sand';
  if (cls === 'rock') return 'rock';
  if (cls === 'ice') return 'ice';
  return null;
}

/** Sutherland–Hodgman clip of a ring to the tile square, marking edges that lie on the tile border. */
function clipRing(flat: number[], ext: number): Ring | null {
  let pts = flat;
  const edges: [number, number, boolean][] = [
    [0, 0, false],
    [0, ext, true],
    [1, 0, false],
    [1, ext, true],
  ];
  for (const [axis, bound, max] of edges) {
    const out: number[] = [];
    const n = pts.length;
    if (!n) break;
    const inside = (i: number) => (max ? pts[i + axis] <= bound : pts[i + axis] >= bound);
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      const ai = inside(i);
      const bi = inside(j);
      if (ai) out.push(pts[i], pts[i + 1]);
      if (ai !== bi) {
        const t = (bound - pts[i + axis]) / (pts[j + axis] - pts[i + axis]);
        const x = pts[i] + (pts[j] - pts[i]) * t;
        const y = pts[i + 1] + (pts[j + 1] - pts[i + 1]) * t;
        out.push(axis === 0 ? bound : x, axis === 1 ? bound : y);
      }
    }
    pts = out;
  }
  if (pts.length < 6 || Math.abs(ringArea(pts)) < 1) return null;
  const n = pts.length / 2;
  const seam = new Uint8Array(n);
  const onEdge = (v: number) => v === 0 || v === ext;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, ay, bx, by] = [pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1]];
    if ((ax === bx && onEdge(ax)) || (ay === by && onEdge(ay))) seam[i] = 1;
  }
  return { pts, seam };
}

/** Clip a polyline to the tile square so neighbouring tiles don't draw the same piece twice. */
function clipLine(line: { x: number; y: number }[], ext: number): { x: number; y: number }[][] {
  const pieces: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] | null = null;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    let t0 = 0;
    let t1 = 1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x, ext - a.x, a.y, ext - a.y];
    let ok = true;
    for (let k = 0; k < 4 && ok; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) ok = false;
      } else {
        const r = q[k] / p[k];
        if (p[k] < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
    }
    if (!ok || t0 >= t1) {
      cur = null;
      continue;
    }
    const pa = { x: a.x + dx * t0, y: a.y + dy * t0 };
    const pb = { x: a.x + dx * t1, y: a.y + dy * t1 };
    if (!cur || t0 > 0) {
      cur = [pa];
      pieces.push(cur);
    }
    cur.push(pb);
    if (t1 < 1) cur = null;
  }
  return pieces.filter((p) => p.length > 1);
}

/** Convert absolute-Mercator tiles to local metres, keeping what touches the box. */
function assemble(tiles: Town[], frame: Frame, box: [number, number, number, number]): Town {
  const town = empty();
  const [bx0, by0, bx1, by1] = box;
  const local = (pts: number[], pad = 0): number[] | null => {
    const out = new Array<number>(pts.length);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const x = frame.x(pts[i]);
      const y = frame.y(pts[i + 1]);
      out[i] = x;
      out[i + 1] = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return maxX < bx0 - pad || minX > bx1 + pad || maxY < by0 - pad || minY > by1 + pad ? null : out;
  };
  const shape = (s: Shape, pad = 0): Shape | null => {
    const outer = local(s[0].pts, pad);
    if (!outer) return null;
    const rings: Shape = [];
    for (let k = 0; k < s.length; k++) {
      const pts = k === 0 ? outer : s[k].pts.map((v, i) => (i % 2 ? frame.y(v) : frame.x(v)));
      rings.push(orient({ pts, seam: s[k].seam }, k === 0));
    }
    return rings;
  };
  for (const t of tiles) {
    for (const b of t.buildings) {
      // A wider margin than the rest, so every building in view has all its neighbours
      // for the density that sets guessed heights, and panning doesn't change them.
      const s = shape(b.shape, BUILDING_PAD);
      if (s) town.buildings.push({ shape: s, h: b.h, min: b.min, guess: b.guess });
    }
    for (const key of ['landuse', 'cover'] as const) {
      for (const a of t[key]) {
        const s = shape(a.shape);
        if (s) town[key].push({ shape: s, cls: a.cls });
      }
    }
    const inside = (x: number, y: number) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
    for (const p of t.pois) {
      const x = frame.x(p.x);
      const y = frame.y(p.y);
      if (inside(x, y)) town.pois.push({ ...p, x, y });
    }
    for (const p of t.peaks) {
      const x = frame.x(p.x);
      const y = frame.y(p.y);
      if (inside(x, y)) town.peaks.push({ x, y, ele: p.ele });
    }
    for (let i = 0; i < t.numbers.length; i += 2) {
      const x = frame.x(t.numbers[i]);
      const y = frame.y(t.numbers[i + 1]);
      if (inside(x, y)) town.numbers.push(x, y);
    }
    for (const w of t.streams) {
      const pts = local(w.pts);
      if (pts) town.streams.push({ ...w, pts });
    }
    for (const key of ['water', 'green', 'wood', 'plazas', 'pools', 'aprons'] as const) {
      for (const sh of t[key]) {
        const s = shape(sh);
        if (s) town[key].push(s);
      }
    }
    for (const key of ['ways', 'tunnels', 'runways', 'lifts'] as const) {
      for (const w of t[key]) {
        const pts = local(w.pts);
        if (pts) (town[key] as { pts: number[] }[]).push({ ...w, pts });
      }
    }
    for (const f of t.ferries) {
      const pts = local(f);
      if (pts) town.ferries.push(pts);
    }
  }
  return town;
}

/** Outer rings counter-clockwise, holes clockwise, seam flags following their edges. */
function orient(r: Ring, outer: boolean): Ring {
  const ccw = ringArea(r.pts) > 0;
  if (ccw === outer) return r;
  const n = r.pts.length / 2;
  const pts = new Array<number>(r.pts.length);
  const seam = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    const i = n - 1 - j;
    pts[j * 2] = r.pts[i * 2];
    pts[j * 2 + 1] = r.pts[i * 2 + 1];
    seam[j] = r.seam[(n - 2 - j + n) % n];
  }
  return { pts, seam };
}

