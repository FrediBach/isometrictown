/** Landing piers reached from land and short ferry crossings in image towns. */
import { ringArea } from './geo';
import type { Camera } from './camera';
import type { Occupancy, Vary } from './image-blocks';
import { containsSite, Footprints, Index } from './image-check';
import { corners } from './shape';
import { pathLength, walk } from './streets';
import type { Town, Way } from './tiles';

type Landing = { road: Way; x: number; y: number; nx: number; ny: number; access: number[]; pier: number[]; rank: number };

/** The footprint of a straight passage, including its full width. */
function corridor(ax: number, ay: number, bx: number, by: number, width: number): number[] {
  const L = Math.hypot(bx - ax, by - ay);
  return corners({ cx: (ax + bx) / 2, cy: (ay + by) / 2, ux: (bx - ax) / L, uy: (by - ay) / L, L, w: width });
}

/** Add at most one ferry crossing per water body, joining distinct roads on opposite banks. */
export function ferryLandings(town: Town, cam: Camera, occ: Occupancy, vary: Vary): Way[] {
  const paths: Way[] = [];
  if (!town.water.length) return paths;
  const access: { point: number[]; road: Way }[] = [], nearby = new Index(), blocked = new Footprints();
  for (const w of town.ways) {
    if (w.bridge || w.kind === 'rail' || w.cls === 'motorway' || w.cls === 'trunk') {
      for (let i = 2; i < w.pts.length; i += 2) {
        const ax = w.pts[i - 2], ay = w.pts[i - 1], bx = w.pts[i], by = w.pts[i + 1];
        if (ax !== bx || ay !== by) blocked.add(corridor(ax, ay, bx, by, Math.max(5, w.width + 2)));
      }
    } else if (w.kind === 'road') {
      const p = w.pts;
      // Include the ends of short ways and regularly spaced access points on long streets.
      const length = pathLength(p);
      const step = Math.max(1, length / Math.max(1, Math.ceil(length / 16)));
      walk(p, 0, step, 0, (x, y) => {
        const point = [x, y];
        nearby.add(access.push({ point, road: w }) - 1, point, 36);
      });
    }
  }

  const water = new Footprints();
  for (const shape of town.water) water.add(shape[0].pts);
  for (const stream of town.streams) {
    const p = stream.pts;
    for (let k = 2; k < p.length; k += 2) {
      if (p[k - 2] !== p[k] || p[k - 1] !== p[k + 1]) blocked.add(corridor(p[k - 2], p[k - 1], p[k], p[k + 1], stream.width));
    }
  }
  const [left, top, right, bottom] = cam.rect;
  const served: Landing[] = [];
  const lakeBoats = new Map<number, number>();
  town.lakeBoats = lakeBoats;
  // Consider eligible lakes in seeded order so the first polygon has no special claim on a ferry.
  const bodies = town.water.map((shape, index) => {
    const [x, y] = shape[0].pts;
    const area = shape.reduce((sum, ring) => sum + ringArea(ring.pts), 0);
    const lake = town.waterCls[index] === 'lake';
    if (lake && area <= 100_000) {
      const activity = vary(x, y, 14772);
      lakeBoats.set(index, activity < 0.45 ? 0 : activity < 0.8 ? 2 : 3);
    }
    return { shape, index, area, lake, priority: vary(x, y, 14773) };
  }).sort((a, b) => a.priority - b.priority);
  let lakeServed = false;
  for (const { shape, index, area, lake, priority } of bodies) {
    const shore = shape[0].pts, candidates: Landing[] = [];
    if (!access.length || area < 2500 || (lake && (lakeServed || priority > 0.35))) continue;
    walk([...shore, shore[0], shore[1]], 12, 36, 0, (x, y, ux, uy) => {
      const sx = cam.sx(x, y), sy = cam.sy(x, y, 0);
      if (sx < left || sx > right || sy < top || sy > bottom || served.some(p => Math.hypot(x - p.x, y - p.y) < 150)) return;
      // Image water has counter-clockwise outer banks, with the wet side on the left.
      const nx = -uy, ny = ux, length = 14 + 6 * vary(x, y, 14770);
      const ax = x - 3 * nx, ay = y - 3 * ny, bx = x + length * nx, by = y + length * ny;
      if (!containsSite(shape, corridor(x + nx, y + ny, bx, by, 4.6)) || blocked.touches(corridor(ax, ay, bx, by, 5))) return;
      let distance = 36, stop: Landing | undefined;
      for (const k of nearby.at(ax, ay)) {
        const { point: [px, py], road } = access[k], d = Math.hypot(ax - px, ay - py);
        if (d >= distance || d < 0.1) continue;
        const approach = corridor(px, py, ax, ay, 2);
        if (water.touches(approach) || blocked.touches(approach)) continue;
        distance = d;
        stop = { road, x: bx, y: by, nx, ny, access: [px, py, ax, ay], pier: [ax, ay, bx, by], rank: d / 36 + vary(x, y, 14771) };
      }
      if (stop) candidates.push(stop);
    });
    candidates.sort((a, b) => a.rank - b.rank);
    if (!candidates.length) continue;
    const stops: Landing[] = [];
    // Prefer a pair of banks facing each other. Leave twelve metres clear for the nine-metre hull.
    crossing: for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j];
        if (a.road === b.road) continue;
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
        if (length < 120 || length > 900 || dx * a.nx + dy * a.ny < length * 0.4 || dx * b.nx + dy * b.ny > -length * 0.4) continue;
        const channel = corridor(a.x, a.y, b.x, b.y, 12);
        if (!containsSite(shape, channel) || blocked.touches(channel)) continue;
        town.ferries.push([a.x, a.y, b.x, b.y]);
        if (lake) lakeServed = true;
        if (lakeBoats.has(index)) lakeBoats.set(index, 0);
        stops.push(a, b);
        break crossing;
      }
    }
    served.push(...stops);
    for (const stop of stops) {
      const [px, py, ax, ay] = stop.access;
      occ.fill([corridor(px, py, ax, ay, 3)]);
      occ.fill([corridor(ax, ay, stop.x, stop.y, 5)]);
      paths.push({ kind: 'path', cls: 'footway', width: 0, pts: stop.access },
        { kind: 'path', cls: 'footway', sub: 'pier', bridge: true, width: 4, pts: stop.pier });
    }
  }
  return paths;
}
