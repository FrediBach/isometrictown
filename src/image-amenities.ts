/** Sites for the shared renderer in a fictional town, chosen after its buildings and paths are fixed. */
import { pointInRing, ringArea } from './geo';
import type { BuildContext, Built } from './image-buildings';
import { Footprints, inShape } from './image-check';
import { labelAt } from './image-zones';
import type { Town } from './tiles';

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

/** Give finished streets shops and stops, and lay out recreation grounds beside paths. */
export function amenitiesOf(town: Town, { vary, ground, laid, z }: Pick<BuildContext, 'vary' | 'ground' | 'laid' | 'z'>): void {
  const spaced = catchments();
  for (const tag of town.tagged) {
    const { x, y, building } = tag;
    if ((building === 'terrace' || building === 'apartments') && ground.front(x, y) < 14 && vary(x, y, 14702) < 0.10)
      town.pois.push({ x, y, cls: 'shop', sub: 'shop' });
  }
  const rough = town.cover.filter(a => a.cls === 'wetland' || a.cls === 'scrub');
  const grounds = new Footprints();
  for (const a of town.landuse) if (a.cls === 'pitch') grounds.add(a.shape[0].pts);
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
      if (label !== 'park') continue;
      const court = vary(mx, my, 14707) < 0.4;
      const half = court ? 13 : 7, deep = court ? 7 : 4;
      const a = half * side;
      const q = [...at(-a, 16 - deep), ...at(a, 16 - deep), ...at(a, 16 + deep), ...at(-a, 16 + deep)];
      // Keep the whole court inside the park and off neighbouring paths and school pitches.
      if (ground.under(x, y) !== 'a park' || ground.front(x, y) < Math.hypot(half, deep) || ground.crossesStream(q) || grounds.clash(q)) continue;
      if (![0, 2, 4, 6].every(j => ground.under(q[j], q[j + 1]) === 'a park') || !spaced('recreation', x, y, 140)) continue;
      const cls = court ? 'pitch' : 'playground';
      grounds.add(q);
      town.landuse.push({ cls, shape: [{ pts: q, seam: new Uint8Array(4) }] });
      if (court) town.pois.push({ x, y, cls, sub: 'tennis' });
    }
  }
}
