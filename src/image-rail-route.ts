import type { Camera } from './camera';
import type { Footprints, Index } from './image-check';
import type { Target } from './image-read';
import { BUILT } from './image-tone';
import { labelAt, type Zones } from './image-zones';
import { place, rect } from './infra';
import type { Way } from './tiles';

/** Terrain and existing transport checked along the full width of each candidate rail alignment. */
export type RailGround = { obstacles: Footprints; ways: Index; segments: { w: Way; k: number }[]; z: Zones; cam: Camera; target: Target };

type Path = { pts: number[]; heading: number; turn: number; length: number; lastCrossing: number; cost: number; score: number };

/** Check one chord of a curve. Return the distance along the line of its latest level crossing. */
function checkChord(g: RailGround, x: number, y: number, ux: number, uy: number, length: number, travelled: number, previous: number): number | null {
  // Extend the ends slightly so the outside corner of the swept track bed stays clear too.
  const bed = place(x, y, ux, uy, rect(-0.5, length + 0.5, -3.6, 3.6));
  if (g.obstacles.touches(bed)) return null;
  const crossings: number[] = [];
  for (const index of g.ways.around(bed)) {
    const { w, k } = g.segments[index], p = w.pts;
    const ax = p[k - 2] - x, ay = p[k - 1] - y, bx = p[k] - x, by = p[k + 1] - y;
    const a = ax * ux + ay * uy, b = bx * ux + by * uy;
    const c = ay * ux - ax * uy, d = by * ux - bx * uy;
    const pad = 3.6 + w.width / 2, slope = d - c;
    if (Math.min(c, d) > pad || Math.max(c, d) < -pad) continue;
    const t0 = slope ? Math.max(0, Math.min((-pad - c) / slope, (pad - c) / slope)) : 0;
    const t1 = slope ? Math.min(1, Math.max((-pad - c) / slope, (pad - c) / slope)) : 1;
    const lo = a + (b - a) * t0, hi = a + (b - a) * t1;
    if (Math.max(lo, hi) < -pad || Math.min(lo, hi) > length + pad) continue;
    if (Math.abs(slope) < 0.55 * Math.hypot(a - b, slope) || w.bridge || w.kind === 'rail' || w.streetTram || w.service || w.cls === 'motorway' || w.cls === 'trunk') return null;
    if (w.kind !== 'road') continue;
    if (k === 2 && Math.abs(c) < pad || k === p.length - 2 && Math.abs(d) < pad) return null;
    const along = a - c * (b - a) / slope;
    if (c * d <= 0 && along >= 0 && along <= length) crossings.push(travelled + along);
  }
  for (const at of crossings.sort((a, b) => a - b)) {
    if (at - previous > 1 && at - previous < 32) return null;
    previous = Math.max(previous, at);
  }
  return previous;
}

/** Find a gently curving alignment to the sheet edge. Competing headings survive a blocked approach. */
export function railApproach(g: RailGround, x: number, y: number, heading: number, exitBearing: number): number[] | null {
  const { cam, z, target } = g;
  const [left, top, right, bottom] = cam.rect;
  const outside = (sx: number, sy: number) => sx < left || sx > right || sy < top || sy > bottom;
  const initial: Path = { pts: [x, y], heading, turn: 0, length: 0, lastCrossing: -21, cost: 0, score: 0 };
  // Aim for a particular connection off the sheet. Simply taking the first exit
  // favours the shortest straight line, even when there is a better valley alongside it.
  const gx = Math.cos(exitBearing), gy = Math.sin(exitBearing);
  const sx = cam.sx(x, y), sy = cam.sy(x, y, 0);
  const dx = cam.sx(x + gx, y + gy) - sx, dy = cam.sy(x + gx, y + gy, 0) - sy;
  const reach = Math.min(dx > 0 ? (right - sx) / dx : dx < 0 ? (left - sx) / dx : Infinity,
    dy > 0 ? (bottom - sy) / dy : dy < 0 ? (top - sy) / dy : Infinity);
  const goalX = x + gx * reach, goalY = y + gy * reach;
  let beam = [initial], best: Path | undefined;
  // Each 60 m step can turn by at most 0.44 radians (a radius of about 136 m).
  // Test four short chords along that arc, carrying its end tangent into the next step.
  const step = 60, chord = step / 4;
  // Every chord advances along the station axis. This bounds the search and prevents loops.
  const limit = Math.ceil(Math.hypot(right - left, (bottom - top) / cam.sa) / (cam.s * step * 0.29)) + 1;
  for (let layer = 0; layer < limit && beam.length; layer++) {
    const next: Path[] = [];
    for (const p of beam) for (const turn of [-0.44, -0.22, 0, 0.22, 0.44]) {
      if (Math.abs(p.heading + turn - heading) > 1.27) continue;
      let px = p.pts[p.pts.length - 2], py = p.pts[p.pts.length - 1];
      let cost = p.cost + 4 * Math.abs(turn) + 8 * Math.abs(turn - p.turn), travelled = p.length, last = p.lastCrossing;
      const extension: number[] = [];
      let escaped = false;
      for (let k = 0; k < 4; k++) {
        const angle = p.heading + turn * (k + 0.5) / 4, ux = Math.cos(angle), uy = Math.sin(angle);
        const crossing = checkChord(g, px, py, ux, uy, chord, travelled, last);
        if (crossing === null) break;
        if (crossing > last) cost += 25;
        last = crossing;
        let valid = true;
        const sheetAngle = Math.atan2(cam.sy(ux, uy, 0) - cam.sy(0, 0, 0), cam.sx(ux, uy) - cam.sx(0, 0));
        for (const fraction of [0.25, 0.75, 1]) {
          const mx = px + chord * ux * fraction, my = py + chord * uy * fraction;
          const sx = cam.sx(mx, my), sy = cam.sy(mx, my, 0);
          if (outside(sx, sy)) { escaped = true; break; }
          const label = labelAt(z, mx, my);
          const col = Math.floor((sx - target.x0) / target.cell), row = Math.floor((sy - target.y0) / target.cell);
          const i = row * target.W + col;
          if (!label || col < 0 || col >= target.W || row < 0 || row >= target.H || target.weight[i] < 0.5) { valid = false; break; }
          // Prefer the edge of settlement and the grain of the picture over cutting across blocks.
          cost += chord / 3 * ((BUILT.has(label) && label !== 'works' ? 0.85 : 0) +
            target.coherence[i] * Math.abs(Math.sin(sheetAngle - target.dir[i])) * 0.65);
        }
        if (!valid) break;
        cost += 2 * chord * (1 - Math.cos(angle - exitBearing));
        px += ux * chord; py += uy * chord;
        travelled += chord;
        extension.push(px, py);
        if (escaped) break;
      }
      if (escaped ? travelled < 75 : extension.length !== 8) continue;
      const candidate = { pts: [...p.pts, ...extension], heading: p.heading + turn, turn, length: travelled, lastCrossing: last, cost, score: cost / travelled };
      const remaining = Math.hypot(px - goalX, py - goalY);
      if (escaped) {
        candidate.score += 2 * remaining / Math.max(75, reach);
        if (!best || candidate.score < best.score) best = candidate;
      } else {
        candidate.score += (remaining + travelled - reach) / Math.max(75, reach);
        next.push(candidate);
      }
    }
    if (best && (layer + 1) * step >= reach * 1.4 + step) break;
    // Keep distinct corridors and headings; near-identical histories would crowd out a detour.
    const seen = new Set<string>();
    beam = [];
    for (const p of next.sort((a, b) => a.score - b.score)) {
      const n = p.pts.length, key = [Math.round(p.pts[n - 2] / 24), Math.round(p.pts[n - 1] / 24), Math.round(p.heading / 0.25)].join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(p);
      if (beam.length === 10) break;
    }
  }
  return best?.pts ?? null;
}

/** The continuous right of way, with mitred joins between the chords of each curve. */
export function trackBed(pts: number[]): number[] {
  const left: number[] = [], right: number[] = [];
  let nx = 0, ny = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const j = Math.min(i, pts.length - 4);
    const dx = pts[j + 2] - pts[j], dy = pts[j + 3] - pts[j + 1], len = Math.hypot(dx, dy);
    const vx = -dy / len, vy = dx / len;
    if (!i) { nx = vx; ny = vy; }
    const scale = 3.5 / (1 + nx * vx + ny * vy);
    const ox = (nx + vx) * scale, oy = (ny + vy) * scale;
    const opposite = pts.length - i - 2;
    left[opposite] = pts[i] + ox;
    left[opposite + 1] = pts[i + 1] + oy;
    right.push(pts[i] - ox, pts[i + 1] - oy);
    nx = vx; ny = vy;
  }
  return [...right, ...left];
}
