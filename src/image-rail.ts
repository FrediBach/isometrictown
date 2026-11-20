import type { Camera } from './camera';
import type { Occupancy } from './image-blocks';
import { Footprints, Index, ringsMeet } from './image-check';
import { railApproach, trackBed } from './image-rail-route';
import { toneAt, type Target } from './image-read';
import { BUILT } from './image-tone';
import { labelAt, type Zones } from './image-zones';
import { walk } from './streets';
import { place, rect } from './infra';
import type { Building, Shape, Town, Way } from './tiles';

type Front = { x: number; y: number; ux: number; uy: number; width: number; rank: number; parallel: boolean };
const shapeOf = (pts: number[]): Shape => [{ pts, seam: new Uint8Array(pts.length / 2) }];

/** Fit a village station to a street frontage and reserve its platform and rail approaches. */
export function villageRailway(town: Town, cores: [number, number][], z: Zones, cam: Camera, target: Target, occ: Occupancy, streams: Shape[], vary: (x: number, y: number, salt: number) => number, housing?: () => Building[]): void {
  if (!cores.length) return;
  const [left, top, right, bottom] = cam.rect;
  // Give the station a regional destination of its own. A frontage facing that
  // direction gets an earlier trial, while the land can still favour another site.
  const destination = 2 * Math.PI * vary(...cores[0], 14985);
  const dx = Math.cos(destination), dy = Math.sin(destination);
  const obstacles = new Footprints();
  for (const shape of [...town.water, ...streams, ...town.green, ...town.wood, ...town.plazas, ...town.landuse.filter(a => a.cls === 'parking').map(a => a.shape)])
    obstacles.add(shape[0].pts);

  const junctions = new Map<string, { x: number; y: number; degree: number }>();
  const streets = new Footprints();
  const ways = new Index(), segments: { w: Way; k: number }[] = [], fronts: Front[] = [];
  for (const w of town.ways) {
    for (let k = 2; k < w.pts.length; k += 2) {
      const ax = w.pts[k - 2], ay = w.pts[k - 1], bx = w.pts[k], by = w.pts[k + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (!len) continue;
      const half = Math.max(1, w.width / 2);
      streets.add(place(ax, ay, (bx - ax) / len, (by - ay) / len, rect(0, len, -half, half)));
      ways.add(segments.length, [ax, ay, bx, by], w.width / 2 + 4);
      segments.push({ w, k });
    }
    if (w.kind !== 'road' || w.bridge) continue;
    for (const k of [0, w.pts.length - 2]) {
      const x = w.pts[k], y = w.pts[k + 1], key = Math.round(x) + ',' + Math.round(y);
      const node = junctions.get(key);
      if (node) node.degree++;
      else junctions.set(key, { x, y, degree: 1 });
    }
    if (w.service || w.streetTram || w.cls === 'motorway' || w.cls === 'trunk') continue;
    walk(w.pts, 8, 19, 7, (x, y, tx, ty) => {
      const sx = cam.sx(x, y), sy = cam.sy(x, y, 0);
      if (sx < left + 4 || sx > right - 4 || sy < top + 4 || sy > bottom - 4) return;
      const label = labelAt(z, x, y);
      if (!label || toneAt(target, sx, sy) === null) return;
      if (!BUILT.has(label) && ![-24, 24].some(offset => {
        const adjacent = labelAt(z, x - ty * offset, y + tx * offset);
        return adjacent && BUILT.has(adjacent);
      })) return;
      const distance = Math.min(...cores.map(([cx, cy]) => Math.hypot(x - cx, y - cy)));
      if (distance > 350) return;
      const rank = distance + 90 * vary(x, y, 14900);
      for (const side of [-1, 1]) {
        fronts.push({ x, y, ux: -side * ty, uy: side * tx, width: w.width, rank, parallel: false });
        const ux = side * tx, uy = side * ty, offset = w.width / 2 + 20;
        fronts.push({ x: x - 32 * ux + offset * uy, y: y - 32 * uy - offset * ux, ux, uy,
          width: w.width, rank: rank - 10, parallel: true });
      }
    });
  }
  for (const { x, y, degree } of junctions.values()) if (degree >= 3)
    obstacles.add(place(x, y, 1, 0, rect(-6, 6, -6, 6)));
  // Rank station frontages by the land available on their approaches. A street on the
  // village fringe can serve the centre without taking a strip out of a whole row of homes.
  for (const f of fronts) {
    const landCost = (dir: number) => {
      let best = Infinity;
      for (const turn of [-0.6, 0, 0.6]) {
        const ux = dir * (f.ux * Math.cos(turn) - f.uy * Math.sin(turn));
        const uy = dir * (f.uy * Math.cos(turn) + f.ux * Math.sin(turn));
        let cost = 0;
        for (const d of [35, 70, 110, 155, 210]) {
          const x = f.x + ux * d, y = f.y + uy * d, label = labelAt(z, x, y);
          if (!label || label === 'water' || label === 'wood' || label === 'park') cost += 80;
          else if (BUILT.has(label) && label !== 'works') cost += 55;
        }
        best = Math.min(best, cost);
      }
      return best;
    };
    f.rank += 85 * (1 - f.ux * dx - f.uy * dy);
    f.rank += f.parallel ? (landCost(1) + landCost(-1)) / 2 : landCost(1);
  }
  if (!fronts.length) return;
  let homes: Building[] | undefined;
  const plots = new Index();
  const ground = { obstacles, ways, segments, z, cam, target };
  fronts.sort((a, b) => a.rank - b.rank);
  type Site = { track: number[]; platform: number[]; access: number[]; door: number[]; building: number[]; hall: number[]; yard: number[]; forecourt: number[]; entrance: number[] };
  let best: Site | undefined, bestCost = Infinity, tried = 0, found = 0;
  for (const { x, y, ux, uy, width, parallel } of fronts) {
    const at = (a: number, b: number) => [x + ux * a - uy * b, y + uy * a + ux * b];
    const strip = (a: number, b: number, lo: number, hi: number) => place(x, y, ux, uy, rect(a, b, lo, hi));
    const start = parallel ? 0 : width / 2 + 6, platformEnd = start + 62;
    const yard = strip(start - 2, platformEnd + 2, -4, 7);
    if (!occ.allows(yard, 0) || streets.touches(yard) || obstacles.touches(yard)) continue;
    const building = strip(start + 8, start + 26, 8, 17);
    const hall = at(start + 17, 12.5);
    const forecourt = parallel ? strip(30, 34, 6, 19) : strip(width / 2 + 1, start + 2, -1, 7);
    if (streets.touches(forecourt) || obstacles.touches(forecourt)) continue;
    const visible = (ring: number[]) => {
      for (let i = 0; i < ring.length; i += 2) {
        const sx = cam.sx(ring[i], ring[i + 1]), sy = cam.sy(ring[i], ring[i + 1], 0);
        if (sx < left || sx > right || sy < top || sy > bottom || toneAt(target, sx, sy) === null) return false;
      }
      return true;
    };
    if (!visible(yard) || !visible(building)) continue;
    if (!occ.allows(building, 0) || streets.touches(building) || obstacles.touches(building)) continue;
    const heading = Math.atan2(uy, ux);
    const throat = at(platformEnd + 1, 0);
    if (++tried > 80) break;
    const bearing = (direction: number, aimFor: number, salt: number) => {
      // Serve a neighbouring settlement in the forward sector when there is one.
      const choice = vary(x, y, salt) - 0.5;
      const turn = Math.atan2(Math.sin(aimFor - direction), Math.cos(aimFor - direction));
      let nearest = Infinity, aim = direction + Math.max(-1.15, Math.min(1.15, turn + 0.5 * choice));
      for (const [cx, cy] of cores) {
        const dx = cx - x, dy = cy - y, dist = Math.hypot(dx, dy);
        if (dist < 220 || dist >= nearest || dx * Math.cos(direction) + dy * Math.sin(direction) < dist * 0.45) continue;
        nearest = dist;
        aim = Math.atan2(dy, dx);
      }
      return aim;
    };
    const approach = railApproach(ground, throat[0], throat[1], heading, bearing(heading, destination, 14901));
    if (!approach) continue;
    const track: number[] = [];
    if (parallel) {
      const rear = at(start, 0);
      const other = railApproach(ground, rear[0], rear[1], heading + Math.PI,
        bearing(heading + Math.PI, destination + Math.PI, 14902));
      if (!other) continue;
      for (let i = other.length - 2; i >= 0; i -= 2) track.push(other[i], other[i + 1]);
    } else track.push(...at(start, 0));
    track.push(...approach);
    let cost = 0, routeLength = 0;
    for (let k = 2; k < track.length; k += 2) {
      const px = (track[k] + track[k - 2]) / 2, py = (track[k + 1] + track[k - 1]) / 2;
      const dx = track[k] - track[k - 2], dy = track[k + 1] - track[k - 1], length = Math.hypot(dx, dy);
      routeLength += length;
      for (const offset of [-13, 0, 13]) {
        const qx = px - dy / length * offset, qy = py + dx / length * offset;
        const label = labelAt(z, qx, qy);
        const tone = toneAt(target, cam.sx(qx, qy), cam.sy(qx, qy, 0)) ?? 1;
        // Removing houses costs most in dark fabric. A long ink line over a
        // pale, otherwise empty patch also changes the source silhouette.
        cost += length / 3 * (label && BUILT.has(label) && label !== 'works' ? 1.4 + 2 * (1 - tone) : 0.12 + tone ** 4);
      }
    }
    // Crossing the backs of lots can leave an entire street of houses intact. Compare
    // the station as well as the running line, counting each displaced building once.
    if (!homes) {
      homes = housing?.() ?? [];
      homes.forEach((home, i) => plots.add(i, home.shape[0].pts));
    }
    const lost = new Set<number>();
    for (const ring of [yard, building, forecourt, trackBed(track)]) {
      for (const i of plots.around(ring)) {
        if (lost.has(i) || !ringsMeet(ring, homes[i].shape[0].pts)) continue;
        lost.add(i);
        cost += 22 + 2 * homes[i].h;
      }
    }
    // A useful regional connection spans more than a corner of the sheet.
    const span = Math.min(right - left, (bottom - top) / cam.sa) / cam.s;
    cost += Math.max(0, span * 0.65 - routeLength) * 0.9 - (parallel ? 150 : 0);
    cost += 2 * Math.max(0, Math.min(280, span * 0.55) - routeLength);
    cost += 0.25 * Math.min(...cores.map(([cx, cy]) => Math.hypot(cx - x, cy - y)));
    // The train, canopy and hall put much more ink on the sheet than open track.
    // Judge them at their projected height, including where a station straddles a tonal edge.
    const stop = [hall, ...[8, 32, 54].map(t => at(start + t, 0))];
    for (const [px, py] of stop) cost += 230 * (toneAt(target, cam.sx(px, py), cam.sy(px, py, 3)) ?? 1);
    const ex = track.at(-2)! - x, ey = track.at(-1)! - y;
    cost += 170 * (1 - (ex * dx + ey * dy) / Math.max(1, Math.hypot(ex, ey)));
    found++;
    const platform = [...at(start + 2, 4.3), ...at(platformEnd, 4.3)];
    const access = parallel ? [...at(32, width / 2 + 20), ...at(32, 4.3)] : [x, y, ...at(start + 2, 4.3)];
    if (cost < bestCost) {
      bestCost = cost;
      best = { track, platform, access, door: [...at(start + 17, 4.3), ...at(start + 17, 8)], building, hall, yard, forecourt,
        entrance: strip(start + 16, start + 18, 6, 8) };
    }
    if (found >= 12) break;
  }
  if (!best) return;
  const { track, platform, access, door, building, hall, yard, forecourt, entrance } = best;
  const corridor = trackBed(track);
  town.ways.push({ kind: 'rail', cls: 'rail', sub: 'rail', width: 3, pts: track },
    { kind: 'path', cls: 'path', sub: 'platform', width: 3.6, pts: platform },
    { kind: 'path', cls: 'footway', width: 2, pts: access },
    { kind: 'path', cls: 'footway', width: 2, pts: door });
  town.landuse.push({ cls: 'railway', shape: shapeOf(corridor) }, { cls: 'railway', shape: shapeOf(yard) });
  town.buildings.push({ shape: shapeOf(building), h: 6.5, min: 0 });
  town.tagged.push({ x: hall[0], y: hall[1], building: 'train_station', roof: 'hipped', from: 'image' });
  town.pois.push({ x: hall[0], y: hall[1], cls: 'railway', sub: 'station' });
  for (const ring of [corridor, yard, building, forecourt, entrance]) occ.fill([ring]);
}
