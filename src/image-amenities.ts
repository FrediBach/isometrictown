/** Civic buildings, parking and neighbourhood amenities for the shared renderer in a fictional town. */
import { pointInRing, ringArea } from './geo';
import type { BuildContext, Built } from './image-buildings';
import type { Occupancy } from './image-blocks';
import { toneAt, type Target } from './image-read';
import { centre, containsSite, Footprints, inShape } from './image-check';
import { labelAt, type Zones } from './image-zones';
import { pathLength, walk } from './streets';
import { bestRect, corners } from './shape';
import type { Building, Town, Way } from './tiles';

const CIVIC_CANDIDATES = new Set(['apartments', 'terrace', 'industrial', 'warehouse']);

/** Keep enough ground between sites of the same use. */
function catchments() {
  const sites = new Map<string, [number, number][]>();
  return (kind: string, x: number, y: number, radius: number) => {
    const near = sites.get(kind) ?? [];
    if (near.some(([a, b]) => Math.hypot(x - a, y - b) < radius)) return false;
    near.push([x, y]);
    sites.set(kind, near);
    return true;
  };
}

/** Give neighbourhoods civic services on suitable existing plots, before density changes ordinary houses. */
export function civicSites(town: Built, { vary, style }: Pick<BuildContext, 'vary' | 'style'>): void {
  const spaced = catchments();
  const worship = style.id === 'arid' ? 'mosque' : style.id === 'eastAsian' ? 'temple' : 'church';
  for (const tag of town.tagged) if (tag.building === worship) spaced('worship', tag.x, tag.y, 0);
  for (let i = 0; i < town.buildings.length; i++) {
    const b = town.buildings[i], tag = town.tagged[i];
    const { x, y, building } = tag;
    if (b.context || !CIVIC_CANDIDATES.has(building ?? '')) continue;
    const p = b.shape[0].pts;
    if (!pointInRing(x, y, p)) continue;
    const area = ringArea(p);
    let cls: string;
    if (building === 'apartments' && b.h <= 35 && area >= 600 && vary(x, y, 14700) < 0.25 && spaced('hospital', x, y, 800)) {
      cls = 'hospital';
      tag.building = cls;
      tag.roof = 'flat';
    } else if (area >= 140 && area < 700 && b.h <= 15 && vary(x, y, 14701) < 0.045 && spaced('fire_station', x, y, 480)) {
      cls = 'fire_station';
      tag.building = 'civic';
      tag.roof = 'flat';
    } else if (building === 'terrace' && p.length === 8 && area >= 90 && b.h < 16 &&
        vary(x, y, 14709) < 0.06 && spaced('worship', x, y, 390)) {
      // A small street chapel serves rows too narrow to merge into a church precinct.
      tag.building = worship;
      tag.roof = undefined;
      b.h = Math.max(10, b.h);
      continue;
    } else continue;
    town.pois.push({ x, y, cls, sub: cls });
  }
}

const EUROPEAN = new Set(['alpine', 'dutch', 'central', 'nordic', 'british', 'french', 'mediterranean', 'eastern']);
const HOMES = new Set(['house', 'apartments', 'terrace']);
const PARISH_HOMES = 30;

/** The palest tone behind the projected church, treating transparency as bare paper. */
function churchTone(t: Target, x0: number, y0: number, x1: number, y1: number): number {
  const left = Math.floor((x0 - t.x0) / t.cell), right = Math.floor((x1 - t.x0) / t.cell);
  const top = Math.floor((y0 - t.y0) / t.cell), bottom = Math.floor((y1 - t.y0) / t.cell);
  let lightest = 0;
  for (let j = top; j <= bottom; j++) for (let i = left; i <= right; i++) {
    const k = j * t.W + i;
    if (t.weight[k] < 0.5) return 1;
    lightest = Math.max(lightest, t.tone[k]);
  }
  return lightest;
}

/** Give a visible European settlement a parish church if the finished layout lacks one. */
export function parishChurch(town: Built, { cam, target, style, set, cores }: Pick<BuildContext, 'cam' | 'target' | 'style' | 'set' | 'cores'>): Building | undefined {
  if (!EUROPEAN.has(style.id)) return;
  const [left, top, right, bottom] = cam.rect;
  const homes = [];
  for (let i = 0; i < town.buildings.length; i++) {
    const b = town.buildings[i], tag = town.tagged[i];
    if (b.context) continue;
    const sx = cam.sx(tag.x, tag.y), sy = cam.sy(tag.x, tag.y, 0);
    if (sx < left || sx >= right || sy < top || sy >= bottom) continue;
    if (toneAt(target, sx, sy) === null) continue;
    if (tag.building === 'church') return;
    if (HOMES.has(tag.building ?? '')) homes.push({ b, tag });
  }
  if (homes.length < PARISH_HOMES) return;

  const candidates = [];
  for (const { b, tag } of homes) {
    const p = b.shape[0].pts;
    if (p.length !== 8 || b.h > 18) continue;
    const { rect, fill } = bestRect(p);
    if (!rect || fill < 0.95 || rect.w < 6 || rect.w > 16 || rect.L < 10 || rect.L > 36 || rect.L < 1.15 * rect.w) continue;
    // Allow for the nave, belfry and spire whichever end of the church faces the street.
    const towerWidth = Math.max(3.5, rect.w * 0.45);
    const height = Math.max(15, b.h);
    const nave = Math.min(22, height * set.heightScale) + rect.w * 0.6;
    const tip = Math.max(height * set.heightScale, nave + 5 + towerWidth * 0.8) + towerWidth * 2.4;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < p.length; k += 2) {
      const x = cam.sx(p[k], p[k + 1]);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, cam.sy(p[k], p[k + 1], tip));
      y1 = Math.max(y1, cam.sy(p[k], p[k + 1], 0));
    }
    if (x0 < left || x1 >= right || y0 < top || y1 >= bottom) continue;
    const lightest = churchTone(target, x0, y0, x1, y1);
    if (lightest >= 0.88) continue;
    // Prefer a long nave near a town centre, where the steeple fits the image's darker tone.
    const distance = cores.reduce((d, [x, y]) => Math.min(d, Math.hypot(tag.x - x, tag.y - y)), 300);
    const score = lightest + distance / 600 + Math.abs(rect.L - 22) / 45 + (tag.building === 'house' ? 0 : 0.4);
    candidates.push({ b, tag, height, score });
  }
  for (const site of candidates.sort((a, b) => a.score - b.score)) {
    let neighbours = 0;
    for (const { tag } of homes) {
      if (Math.hypot(tag.x - site.tag.x, tag.y - site.tag.y) > 180) continue;
      if (++neighbours === PARISH_HOMES) {
        site.tag.building = 'church';
        site.tag.roof = undefined;
        site.tag.across = undefined;
        site.b.h = site.height;
        return site.b;
      }
    }
  }
}

/** Reserve small car parks off urban streets, including the bays on both sides of each aisle. */
export function parkingSites(town: Town, z: Zones, occ: Occupancy, vary: BuildContext['vary']): void {
  const spaced = catchments();
  const drives: Way[] = [];
  // Narrow paths and rails can pass between the occupancy raster's cell centres.
  const paths = new Footprints();
  for (const w of town.ways) {
    if (w.kind === 'road' || w.bridge) continue;
    const p = w.pts;
    for (let i = 2; i < p.length; i += 2) {
      const dx = p[i] - p[i - 2], dy = p[i + 1] - p[i - 1], L = Math.hypot(dx, dy);
      if (L > 0) paths.add(corners({ cx: p[i] - dx / 2, cy: p[i + 1] - dy / 2, ux: dx / L, uy: dy / L, L, w: Math.max(2, w.width) }));
    }
  }
  for (const w of town.ways) {
    if (w.kind !== 'road' || w.bridge || w.streetTram || w.cls === 'service') continue;
    walk(w.pts, 12, 45, 12, (x, y, dx, dy) => {
      if (vary(x, y, 14750) >= 0.16) return;
      const side = vary(x, y, 14751) < 0.5 ? -1 : 1;
      const ux = -dy * side, uy = dx * side;
      const entry = w.width / 2 + 3, cx = x + ux * (entry + 12), cy = y + uy * (entry + 12);
      const label = labelAt(z, cx, cy);
      if (label !== 'works' && label !== 'blocks' && !(label === 'rows' && w.cls !== 'minor')) return;
      const yard = corners({ cx, cy, ux, uy, L: 24, w: 17 });
      const driveway = corners({ cx: x + ux * entry / 2, cy: y + uy * entry / 2, ux, uy, L: entry, w: 4 });
      if (![0, 2, 4, 6].every(k => labelAt(z, yard[k], yard[k + 1]) === label) || !occ.allows(yard, 0) ||
          paths.touches(yard) || paths.touches(driveway) || !spaced('parking', cx, cy, 220)) return;
      const ax = x + ux * entry, ay = y + uy * entry;
      drives.push({ kind: 'road', cls: 'service', service: 'driveway', width: 4, pts: [x, y, ax, ay] },
        { kind: 'road', cls: 'service', service: 'parking_aisle', width: 5, pts: [ax, ay, ax + ux * 24, ay + uy * 24] });
      occ.fill([yard]);
      occ.fill([driveway]);
      town.landuse.push({ cls: 'parking', shape: [{ pts: yard, seam: new Uint8Array(4) }] });
    });
  }
  town.ways.push(...drives);
}

// Half the site's length and breadth in metres, including room beyond the markings.
const PARK_SITES = {
  tennis: [13, 7], basketball: [15, 8.5], track: [45, 22], playground: [7, 4],
} as const;

/** Put a recreation site beside a path or park entrance, reserving room for the whole site. */
function parkSites(town: Town, { vary, ground, laid, z }: Pick<BuildContext, 'vary' | 'ground' | 'laid' | 'z'>): void {
  if (!town.green.length) return;
  const spaced = catchments(), grounds = new Footprints();
  for (const a of town.landuse) {
    if (a.cls !== 'pitch' && a.cls !== 'track' && a.cls !== 'playground') continue;
    const p = a.shape[0].pts;
    grounds.add(p);
    spaced('recreation', ...centre(p), 0);
  }
  const place = (mx: number, my: number, ux: number, uy: number, verge: number) => {
    if (vary(mx, my, 14760) >= 0.55) return;
    const roll = vary(mx, my, 14707);
    const sport = roll < 0.28 ? 'tennis' : roll < 0.56 ? 'basketball' : roll < 0.66 ? 'track' : 'playground';
    const [half, deep] = PARK_SITES[sport];
    const first = vary(mx, my, 14703) < 0.5 ? -1 : 1;
    for (const side of [first, -first]) {
      const back = (Math.max(16, deep + 7) + verge) * side;
      const cx = mx - uy * back, cy = my + ux * back;
      if (labelAt(z, cx, cy) !== 'park') continue;
      const q = corners({ cx, cy, ux, uy, L: half * 2, w: deep * 2 });
      if (!town.green.some(park => containsSite(park, q)) || ground.crossesStream(q) || grounds.touches(q) || laid.touches(q)) continue;
      // Overlapping discs cover the site without rejecting its own approach path.
      const strips = Math.ceil(half / deep), step = half / strips;
      const clearance = Math.hypot(step, deep);
      let clear = true;
      for (let i = 0; i < strips; i++) {
        const d = -half + (2 * i + 1) * step;
        if (ground.front(cx + ux * d, cy + uy * d) < clearance || ground.under(cx + ux * d, cy + uy * d) !== 'a park') clear = false;
      }
      if (!clear || !spaced('recreation', cx, cy, 140)) continue;
      const cls = sport === 'tennis' || sport === 'basketball' ? 'pitch' : sport;
      grounds.add(q);
      town.landuse.push({ cls, shape: [{ pts: q, seam: new Uint8Array(4) }] });
      if (cls === 'pitch') town.pois.push({ x: cx, y: cy, cls, sub: sport });
      return;
    }
  };
  for (const w of town.ways) {
    if (w.bridge || (w.kind !== 'path' && w.kind !== 'road') || w.cls === 'service') continue;
    const length = pathLength(w.pts);
    if (length < 9) continue;
    const step = length / Math.max(1, Math.round(length / 100));
    walk(w.pts, step / 2, step, 0, (x, y, ux, uy) => place(x, y, ux, uy, w.width / 2));
  }
}

/** Give finished streets shops and stops, and lay out recreation grounds beside paths. */
export function amenitiesOf(town: Town, { vary, ground, laid, z }: Pick<BuildContext, 'vary' | 'ground' | 'laid' | 'z'>): void {
  parkSites(town, { vary, ground, laid, z });
  const spaced = catchments();
  for (const tag of town.tagged) {
    const { x, y, building } = tag;
    if ((building === 'terrace' || building === 'apartments') && ground.front(x, y) < 14 && vary(x, y, 14702) < 0.10)
      town.pois.push({ x, y, cls: 'shop', sub: 'shop' });
  }
  const rough = town.cover.filter(a => a.cls === 'wetland' || a.cls === 'scrub' || a.cls === 'rock');
  rough.push(...town.landuse.filter(a => a.cls === 'quarry'));
  for (const w of town.ways) {
    if (w.bridge || (w.kind === 'road' && (w.cls === 'minor' || w.cls === 'service'))) continue;
    const p = w.pts;
    for (let k = 2; k < p.length; k += 2) {
      const dx = p[k] - p[k - 2], dy = p[k + 1] - p[k - 1];
      const len = Math.hypot(dx, dy);
      if (len < 9) continue;
      const mx = (p[k] + p[k - 2]) / 2, my = (p[k + 1] + p[k - 1]) / 2;
      const ux = dx / len, uy = dy / len;
      const side = vary(mx, my, 14703) < 0.5 ? -1 : 1;
      const at = (along: number, back: number) => [mx + ux * along - uy * back * side, my + uy * along + ux * back * side];
      if (w.kind === 'road') {
        const [x, y] = at(0, w.width / 2 + 2);
        if (ground.under(x, y) || laid.covers(x, y)) continue;
        if (labelAt(z, x, y) === 'works' && vary(x, y, 14704) < 0.15 && spaced('fuel', x, y, 350)) {
          town.pois.push({ x, y, cls: 'fuel', sub: 'fuel' });
        } else if (vary(x, y, 14705) < 0.24 && spaced('bus', x, y, 150)) {
          town.pois.push({ x, y, cls: 'bus', sub: 'bus_stop' });
        }
        continue;
      }
      if (w.kind !== 'path' || vary(mx, my, 14706) >= 0.20) continue;
      const [x, y] = at(0, 16);
      const label = labelAt(z, x, y);
      if (label === 'meadow' && w.cls === 'track' && !ground.under(x, y) && !laid.covers(x, y) && !rough.some(a => inShape(a.shape, x, y)) && spaced('campsite', x, y, 550)) {
        town.pois.push({ x, y, cls: 'campsite', sub: 'camp_site' });
      }
    }
  }
}
