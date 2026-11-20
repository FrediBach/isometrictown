/**
 * The floorplan lab: reads the footprints of real places, files each under the image-mode zone
 * its ground is labelled with (as the adjacency lab labels it), and learns the plans each zone
 * builds. `npm run floorplans` drives it through `lab/floorplans.mjs`, which writes the table in
 * `src/image-floorplan-data.ts`.
 *
 * Each footprint is turned square to the street it fronts, straightened into a plan whose walls
 * run along or across the street, and scaled into a unit box with the street side at the bottom.
 * Plans are then snapped to a coarse grid, so the same L, T or U from many towns is counted as
 * one, and mirrored to one hand, since laying out can mirror them for free.
 */
import { ringArea } from '../src/geo';
import { LABELS, type Label } from '../src/image-tone';
import { bestRect } from '../src/shape';
// Types only: at run time `./adjacency` would resolve to the runner, lab/adjacency.mjs.
import type { PlaceResult } from './adjacency';

import { straighten } from './plan-shapes';

export { CORPUS } from './adjacency-places';
export { canonical, GRID } from './plan-shapes';

/** The built labels plans are learnt for. */
export const BUILT: Label[] = ['suburb', 'rows', 'old', 'blocks', 'towers', 'works'];
/** The smallest footprint learnt from in each zone, m², so sheds and garages don't count as its houses. */
const SMALLEST: Partial<Record<Label, number>> = { suburb: 60, rows: 25, old: 30, blocks: 60, towers: 150, works: 150 };
/** A building fronts the nearest street within this distance, m. */
const REACH = 45;

/** A real footprint as a plan: its zone, whether it shares party walls at both sides, its size and its outline in the unit box. */
export type Sample = { label: Label; row: boolean; W: number; D: number; fill: number; ring: number[] };

/** Street segments filed by cell, for the nearest street to a building. */
class Segments {
  private cells = new Map<number, number[]>();
  constructor(segs: number[], private size = 50) {
    for (let k = 0; k < segs.length; k += 4) {
      const [ax, ay, bx, by] = [segs[k], segs[k + 1], segs[k + 2], segs[k + 3]];
      for (let i = Math.floor(Math.min(ax, bx) / size); i <= Math.floor(Math.max(ax, bx) / size); i++)
        for (let j = Math.floor(Math.min(ay, by) / size); j <= Math.floor(Math.max(ay, by) / size); j++) {
          const key = (i + 32768) * 65536 + j + 32768;
          (this.cells.get(key) ?? this.cells.set(key, []).get(key)!).push(ax, ay, bx, by);
        }
    }
  }
  /** The nearest point on a street within `reach`, or null. */
  nearest(x: number, y: number, reach: number): [number, number] | null {
    let best = reach;
    let at: [number, number] | null = null;
    const s = this.size;
    for (let i = Math.floor((x - reach) / s); i <= Math.floor((x + reach) / s); i++)
      for (let j = Math.floor((y - reach) / s); j <= Math.floor((y + reach) / s); j++) {
        const list = this.cells.get((i + 32768) * 65536 + j + 32768);
        if (!list) continue;
        for (let k = 0; k < list.length; k += 4) {
          const [ax, ay, bx, by] = [list[k], list[k + 1], list[k + 2], list[k + 3]];
          const dx = bx - ax;
          const dy = by - ay;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
          const px = ax + dx * t;
          const py = ay + dy * t;
          const d = Math.hypot(px - x, py - y);
          if (d < best) [best, at] = [d, [px, py]];
        }
      }
    return at;
  }
}

/** Turn the footprints of a place the adjacency lab has labelled into plans, filed by the zone under each. */
export function samplesOf(r: PlaceResult): { samples: Sample[]; seen: number } {
  const { town, W, H, x0, y0 } = r;
  const CELL = 8;
  const segs: number[] = [];
  for (const w of town.ways) {
    if (w.kind !== 'road' || w.bridge || w.cls === 'motorway' || w.cls === 'trunk') continue;
    for (let k = 0; k + 3 < w.pts.length; k += 2) segs.push(w.pts[k], w.pts[k + 1], w.pts[k + 2], w.pts[k + 3]);
  }
  const streets = new Segments(segs);
  const samples: Sample[] = [];
  let seen = 0;
  for (const b of town.buildings) {
    if (b.context || b.min > 0 || !b.info || b.shape.length !== 1) continue;
    const p = b.shape[0].pts;
    const area = ringArea(p);
    if (area < 20) continue;
    const n = p.length / 2;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < p.length; k += 2) [cx, cy] = [cx + p[k], cy + p[k + 1]];
    [cx, cy] = [cx / n, cy / n];
    const i = Math.floor((cx - x0) / CELL);
    const j = Math.floor((cy - y0) / CELL);
    if (i < 0 || j < 0 || i >= W || j >= H) continue;
    const l = r.label[j * W + i];
    const label = LABELS[l] as Label | undefined;
    if (!label || !BUILT.includes(label) || area < (SMALLEST[label] ?? 20)) continue;
    seen++;
    const at = streets.nearest(cx, cy, REACH);
    const { rect, fill } = bestRect(p);
    if (!at || !rect) continue;
    // Of the rectangle's four sides, the one facing the street is the front.
    const tx = at[0] - cx;
    const ty = at[1] - cy;
    const axes: [number, number][] = [[rect.ux, rect.uy], [-rect.uy, rect.ux], [-rect.ux, -rect.uy], [rect.uy, -rect.ux]];
    let n0 = axes[0];
    for (const a of axes) if (a[0] * tx + a[1] * ty > n0[0] * tx + n0[1] * ty) n0 = a;
    // In from the street, and along it with the inward axis on its left, so rings stay counter-clockwise.
    const v: [number, number] = [-n0[0], -n0[1]];
    const u: [number, number] = [v[1], -v[0]];
    const local: number[] = [];
    for (let k = 0; k < p.length; k += 2) local.push((p[k] - cx) * u[0] + (p[k + 1] - cy) * u[1], (p[k] - cx) * v[0] + (p[k + 1] - cy) * v[1]);
    const plan = straighten(local);
    if (!plan) continue;
    let [a0, b0, a1, b1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k < plan.length; k += 2) [a0, b0, a1, b1] = [Math.min(a0, plan[k]), Math.min(b0, plan[k + 1]), Math.max(a1, plan[k]), Math.max(b1, plan[k + 1])];
    const Wm = a1 - a0;
    const Dm = b1 - b0;
    if (Wm < 3 || Dm < 3) continue;
    // Party walls on both sides along the street: the edges flagged lie on the box's two sides.
    let left = false;
    let right = false;
    for (let k = 0; k < n; k++) {
      if (!b.info.party[k]) continue;
      const m = (k + 1) % n;
      const ma = ((p[k * 2] + p[m * 2]) / 2 - cx) * u[0] + ((p[k * 2 + 1] + p[m * 2 + 1]) / 2 - cy) * u[1];
      if (Math.abs(ma - a0) < 1) left = true;
      if (Math.abs(ma - a1) < 1) right = true;
    }
    const ring: number[] = [];
    for (let k = 0; k < plan.length; k += 2) ring.push((plan[k] - a0) / Wm, (plan[k + 1] - b0) / Dm);
    samples.push({ label, row: left && right, W: Wm, D: Dm, fill, ring });
  }
  return { samples, seen };
}
