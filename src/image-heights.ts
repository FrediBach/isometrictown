/** The optional image skyline. Tone raises ordinary buildings and picks out a few larger developments. */
import type { Camera } from './camera';
import { pointInRing } from './geo';
import type { BuildContext } from './image-buildings';
import { centre, Footprints, simpleFootprint } from './image-check';
import type { MaskField } from './image-masks';
import type { Target } from './image-read';
import { simplify } from './image-water';
import { reachHeight } from './render';
import type { Settings } from './settings';
import { bestRect } from './shape';
import type { Town } from './tiles';

const ORDINARY = new Set(['house', 'terrace', 'apartments', 'industrial', 'warehouse']);
const ROW = new Set(['terrace', 'apartments']);
/** The tallest landmark in the Sapporo preset is about 148 m. */
const TOWER_HEIGHT = 148;

/** Join two footprints along one complete party wall, retaining their outer walls and occupied ground. */
function join(a: number[], b: number[]): number[] | null {
  const same = (i: number, j: number) => Math.abs(a[i] - b[j]) < 1e-6 && Math.abs(a[i + 1] - b[j + 1]) < 1e-6;
  for (let i = 0; i < a.length; i += 2) {
    const ni = (i + 2) % a.length;
    for (let j = 0; j < b.length; j += 2) {
      const nj = (j + 2) % b.length;
      if (!same(i, nj) || !same(ni, j)) continue;
      const ring = [...a.slice(ni), ...a.slice(0, ni)];
      for (let k = (nj + 2) % b.length; k !== j; k = (k + 2) % b.length) ring.push(b[k], b[k + 1]);
      const outline = simplify(ring, 1e-7, true);
      return simpleFootprint(outline) ? outline : null;
    }
  }
  return null;
}

/** Shape the heights of a freshly built image town, using its existing streets, sites and landmarks. */
export function imageHeights(town: Town, target: Target, cam: Camera, set: Settings, { vary, ground, style }: Pick<BuildContext, 'vary' | 'ground' | 'style'>, masks?: MaskField): void {
  // Masks can set the strength for parts of the picture; it is read where each building stands.
  const reliefs = masks?.field('imageRelief');
  const strength = Math.min(1, reliefs ? masks!.peak('imageRelief') : set.imageRelief);
  if (!(strength > 0)) return;
  const { buildings, tagged } = town;
  const sites = new Footprints();
  for (const b of buildings) sites.add(b.shape[0].pts);
  const { cell, W, H, x0, y0, tone, weight } = target;
  const at = (sx: number, sy: number) => {
    const x = Math.floor((sx - x0) / cell), y = Math.floor((sy - y0) / cell);
    return x < 0 || x >= W || y < 0 || y >= H ? -1 : y * W + x;
  };
  const darkness = (i: number) => i < 0 ? 0 : (1 - tone[i]) * weight[i];
  const rise = cam.s * cam.ca * set.heightScale;
  const tallest = Math.min(TOWER_HEIGHT, reachHeight(set) / set.heightScale);
  // Check every target row a facade would cover. A tall roof must not jump over a pale stripe
  // into another dark patch. Above the top of the drawing, the roof is clipped anyway.
  const heightAt = (sx: number, sy: number, lo: number, hi: number) => {
    const limit = (i: number) => lo + (hi - lo) * (Math.max(0, darkness(i) - 0.18) / 0.82) ** 1.8;
    const base = at(sx, sy);
    let h = limit(base);
    const next = (sy - y0 - Math.floor((sy - y0) / cell) * cell) / rise;
    for (let k = base - W, z = next; k >= 0; k -= W, z += cell / rise) {
      if (z >= h) break;
      h = Math.min(h, Math.max(z, limit(k)));
    }
    return h;
  };
  town.buildings = [];
  town.tagged = [];
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i], tag = tagged[i];
    town.buildings.push(b);
    town.tagged.push(tag);
    if (!tag.building || !ORDINARY.has(tag.building)) continue;
    const sx = cam.sx(tag.x, tag.y), sy = cam.sy(tag.x, tag.y, 0);
    const sample = at(sx, sy);
    if (sample < 0 || !weight[sample]) continue;
    const local = reliefs ? Math.min(1, reliefs[sample]) : strength;
    if (!(local > 0)) continue;
    const rank = vary(tag.x, tag.y, 14140);
    const landmark = rank > 0.9 && darkness(sample) > 0.45;
    let ring = b.shape[0].pts;
    let end = i;
    // A few adjacent street houses can share a tower site. Only join complete party walls,
    // stopping at a gap, a civic building, a sharp bend or the edge of the dark area.
    if (landmark && ROW.has(tag.building)) {
      while (end < i + 3 && end + 1 < buildings.length) {
        const next = tagged[end + 1];
        if (!ROW.has(next.building ?? '') || buildings[end + 1].context !== b.context ||
            darkness(at(cam.sx(next.x, next.y), cam.sy(next.x, next.y, 0))) < 0.45) break;
        const joined = join(ring, buildings[end + 1].shape[0].pts);
        if (!joined || bestRect(joined).fill < 0.8) break;
        ring = joined;
        end++;
      }
    }
    // Joining changes the positions at which the finished outline checks adjoining buildings
    // and the ground. Check it again, including any neighbouring developments already placed.
    if (end > i && (!ground.clear(ring) || sites.clash(ring, i, end) || !pointInRing(...centre(ring), ring))) {
      end = i;
      ring = b.shape[0].pts;
    }
    const { rect, fill } = bestRect(ring);
    if (!rect) continue;
    const [cx, cy] = end > i ? centre(ring) : [tag.x, tag.y];
    const width = rect.w * Math.sqrt(fill);
    const variation = vary(cx, cy, 14141);
    const ceiling = landmark && width >= 10
      ? Math.min(tallest, width * (6.5 + 2 * variation))
      : Math.min(55, width * (2.7 + 2.5 * variation));
    const lo = 3 + 1.5 * variation;
    let goal = heightAt(cam.sx(cx, cy), cam.sy(cx, cy, 0), lo, Math.max(lo, ceiling));
    if (end > i) {
      for (let j = i; j <= end; j++) {
        const p = tagged[j];
        goal = Math.min(goal, heightAt(cam.sx(p.x, p.y), cam.sy(p.x, p.y, 0), lo, ceiling));
      }
    }
    // Opacity both lightens the photograph against paper and fades its influence on the
    // town. A fully transparent pixel therefore keeps the original building.
    const mix = local * weight[sample];
    const height = (h: number) => h + mix * (goal - h);
    const raise = (j: number) => {
      const house = buildings[j], use = tagged[j];
      const base = house.h;
      house.h = height(base);
      if (house.h <= style.pitchedMaxH || house.h < base + style.floor) return;
      // Untyped buildings over 40 m take the tall facade scheme, or office glass on industrial land.
      if (house.h <= 40) use.building = 'apartments';
      else if (use.building === 'industrial' || use.building === 'warehouse') use.building = 'office';
      else use.building = undefined;
      use.roof = 'flat';
    };
    // Below mid-rise height the individual buildings keep their own roofs. As the walls
    // rise into a tower they become one footprint on exactly the same ground.
    const originalHeight = b.h;
    raise(i);
    if (end > i && b.h > 30 && b.h >= originalHeight + style.floor) {
      b.shape = [{ pts: ring, seam: new Uint8Array(ring.length / 2) }];
      tag.x = cx;
      tag.y = cy;
      sites.add(ring);
    } else {
      // Keep these neighbours moving towards the same eventual roof height.
      for (let j = i + 1; j <= end; j++) {
        raise(j);
        town.buildings.push(buildings[j]);
        town.tagged.push(tagged[j]);
      }
    }
    i = end;
  }
}
