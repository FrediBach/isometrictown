import type { Build } from './buildings';
import { GARDEN, MEADOW, SCRUB } from './ground';
import { onMask } from './infra';
import type { Masks } from './nature';
import type { Paper, Test } from './raster';
import { GREENERY, LINEWORK } from './settings';
import type { Shape, Way } from './tiles';
import { LOD, shows } from './lod';
import { kept, LEAVES, KERBS_KEPT, runGone, stepsGone, left, gone } from './decay';
import { hash } from './rng';

/** Regions where most railways run under overhead wires. */
export const ELECTRIC = new Set(['alpine', 'dutch', 'central', 'nordic', 'british', 'french', 'mediterranean', 'eastern', 'eastAsian']);
// The mask and its outline must use the same chords at road joints.
const ROAD_JOINT_SIDES = 12;
const LIT = new Set(['minor', 'tertiary', 'secondary', 'primary', 'trunk']);
/** Main roads, which keep more of their kerbs as the town decays. */
const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary']);

function polygon(cx: number, cy: number, r: number, n: number): number[] {
  const pts: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

/** Paint road surfaces (segments plus round joints) and plazas into the road mask. */
export function fillRoads(paper: Paper, ways: Way[], plazas: Shape[], mask: Uint8Array): void {
  for (const w of ways) {
    if (w.kind !== 'road') continue;
    const hw = w.width / 2;
    const p = w.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
      const l = Math.hypot(bx - ax, by - ay);
      if (l < 1e-6) continue;
      const nx = (-(by - ay) / l) * hw;
      const ny = ((bx - ax) / l) * hw;
      paper.fillMask(mask, [[ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny]]);
    }
    for (let i = 0; i < p.length; i += 2) paper.fillMask(mask, [polygon(p[i], p[i + 1], hw, ROAD_JOINT_SIDES)]);
  }
  for (const s of plazas) paper.fillMask(mask, s.map((r) => r.pts));
}

/**
 * Where a ground edge with normal (nx, ny) separates mask from no-mask.
 * Returns a sheet-space offset of about a pixel and a half along that normal.
 */
function across(paper: Paper, nx: number, ny: number): [number, number] {
  const c = paper.cam;
  const ox = c.s * (nx * c.cb - ny * c.sb);
  const oy = -c.s * c.sa * (nx * c.sb + ny * c.cb);
  const l = Math.hypot(ox, oy) || 1;
  const d = 1.6 / paper.ppm;
  return [(ox / l) * d, (oy / l) * d];
}

export function edgeTest(paper: Paper, mask: Uint8Array, nx: number, ny: number, extra?: (x: number, y: number) => boolean): Test {
  const [ox, oy] = across(paper, nx, ny);
  return (x, y, d) => paper.on(mask, x + ox, y + oy) !== paper.on(mask, x - ox, y - oy) && (!extra || extra(x, y)) && paper.seen(x, y, d);
}

/** Trace a ground segment in local metres. */
export function groundSeg(paper: Paper, pen: number, ax: number, ay: number, bx: number, by: number, test: Test): void {
  const c = paper.cam;
  paper.seg(pen, c.sx(ax, ay), c.sy(ax, ay, 0), c.depth(ax, ay, 0), c.sx(bx, by), c.sy(bx, by, 0), c.depth(bx, by, 0), test);
}

/** Outline of the union of a mask's shapes: only edges with the mask on exactly one side. */
export function outline(paper: Paper, pen: number, shapes: Shape[], mask: Uint8Array, extra?: (x: number, y: number) => boolean): void {
  for (const s of shapes) {
    for (const r of s) {
      const p = r.pts;
      const n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [ax, ay, bx, by] = [p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]];
        const l = Math.hypot(bx - ax, by - ay);
        if (l < 1e-6) continue;
        groundSeg(paper, pen, ax, ay, bx, by, edgeTest(paper, mask, -(by - ay) / l, (bx - ax) / l, extra));
      }
      paper.end();
    }
  }
}

/** Kerb lines: both sides of every road plus round joints, kept only on the edge of the road union. */
export function curbs(paper: Paper, ways: Way[], M: Masks, B?: Build): void {
  // In an abandoned town kerbs break up a stretch at a time, though never all of them.
  const broken = !!B && B.set.abandon > LEAVES.kerbs[0];
  for (const w of ways) {
    if (w.kind !== 'road') continue;
    const hw = w.width / 2;
    const p = w.pts;
    const n = p.length / 2;
    const most = 1 - (MAIN.has(w.cls) ? KERBS_KEPT.main : KERBS_KEPT.other);
    for (const side of [1, -1]) {
      for (let i = 0; i + 1 < n; i++) {
        const [ax, ay, bx, by] = [p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3]];
        const l = Math.hypot(bx - ax, by - ay);
        if (l < 1e-6) continue;
        const nx = (-(by - ay) / l) * side;
        const ny = ((bx - ax) / l) * side;
        const test = edgeTest(paper, M.road, nx, ny);
        if (!broken) {
          groundSeg(paper, LINEWORK, ax + nx * hw, ay + ny * hw, bx + nx * hw, by + ny * hw, test);
          continue;
        }
        paper.end();
        for (const q of kept(B!, [ax + nx * hw, ay + ny * hw, bx + nx * hw, by + ny * hw], 'kerbs', side > 0 ? 9900 : 9904, 6, 0.7, most)) {
          // A scrap left at the end of a segment would only be a speck.
          if (Math.hypot(q[q.length - 2] - q[0], q[q.length - 1] - q[1]) < Math.min(1.5, l - 1e-6)) continue;
          groundSeg(paper, LINEWORK, q[0], q[1], q[q.length - 2], q[q.length - 1], test);
          paper.end();
        }
      }
      paper.end();
    }
    for (let i = 0; i < n; i++) {
      if (broken && runGone(B!, 'kerbs', p[i * 2], p[i * 2 + 1], 9908, 0.7, most)) continue;
      if (i > 0 && i < n - 1) {
        const e1x = p[i * 2] - p[i * 2 - 2];
        const e1y = p[i * 2 + 1] - p[i * 2 - 1];
        const e2x = p[i * 2 + 2] - p[i * 2];
        const e2y = p[i * 2 + 3] - p[i * 2 + 1];
        const cos = (e1x * e2x + e1y * e2y) / (Math.hypot(e1x, e1y) * Math.hypot(e2x, e2y) || 1);
        if (cos > 0.9985) continue;
      }
      // Only the outside of a bend (or an end cap) belongs to the kerb. Testing the whole
      // circle against the raster also admits tiny arcs beside the straight edges.
      const planes: number[][] = [];
      if (i > 0) planes.push([p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]]);
      if (i < n - 1) planes.push([p[i * 2] - p[i * 2 + 2], p[i * 2 + 1] - p[i * 2 + 3]]);
      const m = ROAD_JOINT_SIDES;
      for (let k = 0; k < m; k++) {
        const a0 = (k / m) * Math.PI * 2;
        const a1 = ((k + 1) / m) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const ax = Math.cos(a0) * hw;
        const ay = Math.sin(a0) * hw;
        const bx = Math.cos(a1) * hw;
        const by = Math.sin(a1) * hw;
        let lo = 0;
        let hi = 1;
        for (const [nx, ny] of planes) {
          const d0 = ax * nx + ay * ny;
          const d1 = bx * nx + by * ny;
          if (d0 < 0 && d1 < 0) { hi = -1; break; }
          if (d0 < 0) lo = Math.max(lo, d0 / (d0 - d1));
          else if (d1 < 0) hi = Math.min(hi, d0 / (d0 - d1));
        }
        if (lo >= hi) { paper.end(); continue; }
        if (lo > 0) paper.end();
        const test = edgeTest(paper, M.road, Math.cos(am), Math.sin(am));
        groundSeg(paper, LINEWORK, p[i * 2] + ax + (bx - ax) * lo, p[i * 2 + 1] + ay + (by - ay) * lo, p[i * 2] + ax + (bx - ax) * hi, p[i * 2 + 1] + ay + (by - ay) * hi, test);
        if (hi < 1) paper.end();
      }
      paper.end();
    }
  }
}

/** Walk a polyline, calling fn at regular distances with the position and direction. */
export function walk(p: number[], start: number, step: number, stopBefore: number, fn: (x: number, y: number, ux: number, uy: number, k: number) => void): void {
  let total = 0;
  for (let i = 0; i + 3 < p.length; i += 2) total += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  let at = start;
  let k = 0;
  let acc = 0;
  for (let i = 0; i + 3 < p.length && at <= total - stopBefore; i += 2) {
    const l = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (l < 1e-6) continue;
    const ux = (p[i + 2] - p[i]) / l;
    const uy = (p[i + 3] - p[i + 1]) / l;
    while (at <= acc + l && at <= total - stopBefore) {
      const t = at - acc;
      fn(p[i] + ux * t, p[i + 1] + uy * t, ux, uy, k++);
      at += step;
    }
    acc += l;
  }
}

/** Street lamps on the pavement. */
export function lamps(B: Build, paper: Paper, ways: Way[], M: Masks): number {
  const { cam } = B;
  let count = 0;
  for (const w of ways) {
    if (w.kind !== 'road' || !LIT.has(w.cls)) continue;
    const off = w.width / 2 + 0.9;
    walk(w.pts, 14, 32, 6, (x, y, ux, uy, k) => {
      const side = k % 2 ? 1 : -1;
      const nx = -uy * side;
      const ny = ux * side;
      const lx = x + nx * off;
      const ly = y + ny * off;
      const sx = cam.sx(lx, ly);
      const sy = cam.sy(lx, ly, 0);
      if (sy < paper.y0 || sy > paper.y1 + 4 || sx < paper.x0 || sx > paper.x1) return;
      if (paper.on(M.road, sx, sy) || paper.on(M.foot, sx, sy) || paper.on(M.water, sx, sy)) return;
      const ax = lx - nx * 1.3;
      const ay = ly - ny * 1.3;
      // In an abandoned town a lamp loses its head, leans, falls and is gone.
      const worn = B.set.abandon > 0 ? stepsGone(B, 'lamps', lx, ly, 4, 9930) : 0;
      if (worn === 0) {
        paper.line3(LINEWORK, [lx, ly, 0, lx, ly, 5.4, ax, ay, 5.6, ax, ay, 5.25]);
        count++;
        return;
      }
      const [k0, k1] = B.key(lx, ly);
      const a = hash(k0, k1, B.set.seed, 9934) * Math.PI * 2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      if (worn === 1) paper.line3(LINEWORK, [lx, ly, 0, lx, ly, 5.4]);
      else if (worn === 2) paper.line3(LINEWORK, [lx, ly, 0, lx + dx * 1.5, ly + dy * 1.5, 5.2]);
      else if (worn === 3) paper.line3(LINEWORK, [lx, ly, 0.1, lx + dx * 5.4, ly + dy * 5.4, 0.1], (sx, sy, d) => !paper.on(M.road, sx, sy) && !paper.on(M.foot, sx, sy) && paper.seen(sx, sy, d));
    });
  }
  return count;
}

/**
 * Cracks across the carriageways of an abandoned town, a short zigzag in from one kerb, and
 * later a tuft of weeds where each starts.
 */
export function cracks(B: Build, paper: Paper, ways: Way[], M: Masks): void {
  const { cam, set } = B;
  if (set.abandon <= LEAVES.cracks[0] || !shows(cam, LOD.crack)) return;
  const test: Test = (x, y, d) => paper.on(M.road, x, y) && !paper.on(M.foot, x, y) && paper.seen(x, y, d);
  const step = Math.max(5, cam.gap(3) / cam.s);
  const weeds = shows(cam, LOD.weed);
  for (const w of ways) {
    if (w.kind !== 'road' || w.bridge) continue;
    const hw = w.width / 2;
    walk(w.pts, step * 0.5, step, step * 0.5, (x, y, ux, uy) => {
      if (!left(B, 'cracks', x, y, 9920, 0.6)) return;
      const [k0, k1] = B.key(x, y);
      const h = (k: number) => hash(k0, k1, set.seed, 9910 + k);
      const side = h(0) < 0.5 ? 1 : -1;
      const vx = -uy * side;
      const vy = ux * side;
      const o0 = hw * (0.95 - 0.25 * h(1));
      const o1 = o0 - w.width * (0.25 + 0.4 * h(2));
      // Too short to read, it is left out; too short for its zigzag to read, it is one stroke.
      if (!shows(cam, LOD.crack, o0 - o1, h(7))) return;
      const bends = cam.size(o0 - o1) >= 3 * LOD.crack.mm ? 3 : 1;
      const pts: number[] = [];
      for (let k = 0; k <= bends; k++) {
        const o = o0 + ((o1 - o0) * k) / bends;
        const a = bends === 1 ? 0 : (h(3 + k) - 0.5) * 1.4;
        pts.push(x + ux * a + vx * o, y + uy * a + vy * o);
      }
      for (let k = 0; k + 3 < pts.length; k += 2) groundSeg(paper, LINEWORK, pts[k], pts[k + 1], pts[k + 2], pts[k + 3], test);
      paper.end();
      if (!weeds || !gone(B, x, y, 0.35, 0.9, 9922, 0.6)) return;
      const [tx, ty] = [pts[0], pts[1]];
      paper.line3(GREENERY, [tx - 0.5, ty, 0.8, tx, ty, 0, tx + 0.5, ty, 0.85], (sx, sy, d) => !paper.on(M.foot, sx, sy) && paper.seen(sx, sy, d));
    });
  }
}

/** A polyline shifted sideways by o metres, at height z, as flat x, y, z. */
export function shifted(p: number[], o: number, z = 0): number[] {
  const pts: number[] = [];
  for (let i = 0; i < p.length; i += 2) {
    const a = Math.max(0, i - 2);
    const b = Math.min(p.length - 2, i + 2);
    const l = Math.hypot(p[b] - p[a], p[b + 1] - p[a + 1]) || 1;
    pts.push(p[i] - ((p[b + 1] - p[a + 1]) / l) * o, p[i + 1] + ((p[b] - p[a]) / l) * o, z);
  }
  return pts;
}

/**
 * Railway: two rails and sleepers when there's room, else one line. Narrow gauge sits
 * closer; trams run on bare rails under a contact wire hung from poles.
 */
export function railways(B: Build, paper: Paper, ways: Way[], M?: Masks): void {
  const { cam } = B;
  for (const w of ways) {
    if (w.kind !== 'rail') continue;
    const p = w.pts;
    const tram = w.sub === 'tram';
    const g = tram ? 0.72 : w.sub === 'narrow_gauge' ? 0.5 : 0.75;
    const { gauge, pitch } = railProjection(B, p, g);
    const twin = shows(cam, LOD.twinRails, gauge - cam.nib / cam.s) && gauge * cam.s >= cam.nib * 2;
    for (const o of twin ? [g, -g] : [0]) paper.line3(LINEWORK, shifted(p, o));
    if (tram) {
      if (!shows(cam, LOD.catenary, 6.4)) continue;
      paper.facet('catenary', () => {
        if (clearContactWire(B, p, twin ? g : 0)) paper.line3(LINEWORK, shifted(p, 0, 5.6));
        walk(p, 6, 30, 3, (x, y, ux, uy, k) => {
          const side = k % 2 ? 1 : -1;
          let px = x - uy * 3.4 * side, py = y + ux * 3.4 * side;
          if (w.streetTram && M) {
            // Step out to the pavement. At wide junctions there may be no clear site within reach.
            for (let offset = 4.4; offset <= 9 && onMask(paper, M.road, px, py); offset++) {
              px = x - uy * offset * side;
              py = y + ux * offset * side;
            }
            if (onMask(paper, M.road, px, py) || onMask(paper, M.foot, px, py) || onMask(paper, M.water, px, py)) return;
          }
          paper.line3(LINEWORK, [px, py, 0, px, py, 6.4, x, y, 5.9]);
        });
      });
      continue;
    }
    // Overhead line: masts beside the track with an arm out over it, and the contact wire.
    if (ELECTRIC.has(B.style.id) && shows(cam, LOD.catenary) && w.service !== 'yard' && w.service !== 'siding' && w.sub !== 'subway') {
      paper.facet('catenary', () => {
        if (clearContactWire(B, p, twin ? g : 0)) paper.line3(LINEWORK, shifted(p, 0, 5.6));
        walk(p, 20, 55, 10, (x, y, ux, uy) => {
          // Image branch platforms stand to the left of the track.
          const side = B.set.source === 'image' ? -3 : 3;
          const px = x - uy * side, py = y + ux * side;
          if (B.set.source === 'image' && M && onMask(paper, M.road, px, py)) return;
          paper.line3(LINEWORK, [px, py, 0, px, py, 7.4]);
          paper.line3(LINEWORK, [px, py, 6.9, x, y, 6.9, x, y, 5.6]);
        });
      });
    }
    if (twin && shows(cam, LOD.sleepers)) {
      const sl = g + 0.55;
      walk(p, 1, pitch, 0, (x, y, ux, uy) => paper.seg3(LINEWORK, x + uy * sl, y - ux * sl, 0, x - uy * sl, y + ux * sl, 0));
    }
  }
}

/** Keep the contact wire only when it reads outside the projected rail corridor. */
function clearContactWire(B: Build, p: number[], g: number): boolean {
  const c = B.cam;
  let clearance = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len, uy = dy / len;
    const x = ux * c.cb - uy * c.sb;
    const along = Math.hypot(x, c.sa * (ux * c.sb + uy * c.cb));
    // Vertical height separates parallel lines only across their projected direction.
    const gap = (5.6 * c.ca * Math.abs(x) - g * c.sa) / along - c.nib / c.s;
    clearance = Math.min(clearance, gap);
  }
  return Number.isFinite(clearance) && clearance * c.s >= c.nib && shows(c, LOD.contactWire, clearance);
}

/** Minimum perpendicular rail gauge and a shared sleeper pitch for the projected track. */
function railProjection(B: Build, p: number[], g: number): { gauge: number; pitch: number } {
  const c = B.cam;
  let gauge = Infinity;
  let separation = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len, uy = dy / len;
    const along = Math.hypot(ux * c.cb - uy * c.sb, c.sa * (ux * c.sb + uy * c.cb));
    const across = Math.hypot(uy * c.cb + ux * c.sb, c.sa * (uy * c.sb - ux * c.cb));
    gauge = Math.min(gauge, 2 * g * c.sa / along);
    separation = Math.min(separation, c.s * c.sa / across);
  }
  if (!Number.isFinite(gauge)) return { gauge: 0, pitch: 2.6 };
  return { gauge, pitch: Math.max(2.6, Math.max(c.gap(1.2), c.nib * 2) / separation) };
}

function drawsPathDash(M: Masks, land: Uint8Array | undefined, pixel: number): boolean {
  const cover = land?.[pixel];
  return !M.green[pixel] && !M.wood[pixel] && cover !== MEADOW && cover !== SCRUB && cover !== GARDEN;
}

/** Reserve a continuous, pen-scaled corridor through park tone for drawable paths. */
export function pathClearance(B: Build, paper: Paper, ways: Way[], M: Masks, land?: Uint8Array): Uint8Array {
  const mask = paper.mask();
  if (!B.set.paths) return mask;
  const cam = B.cam;
  const keepDash = (pixel: number) => drawsPathDash(M, land, pixel);
  const fill = (p: number[], dashedPath: boolean) => {
    const ground: number[] = [];
    for (let i = 0; i < p.length; i += 2) ground.push(...cam.ground(p[i], p[i + 1]));
    paper.fillMask(mask, [ground], 1, dashedPath ? keepDash : undefined);
  };
  for (const w of ways) {
    if (!visiblePath(B, w)) continue;
    // Treads and wheel ruts need room on both sides of the centre line.
    const spread = w.sub === 'steps' && stairPitch(B, w.pts) > 0 ? 0.9
      : w.cls === 'track' && shows(cam, LOD.ruts) ? 0.8 : 0;
    const r = cam.nib * 2 + spread * cam.s;
    const p = w.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = cam.sx(p[i], p[i + 1]), ay = cam.sy(p[i], p[i + 1], 0);
      const bx = cam.sx(p[i + 2], p[i + 3]), by = cam.sy(p[i + 2], p[i + 3], 0);
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-6) continue;
      const nx = -(by - ay) / len * r, ny = (bx - ax) / len * r;
      fill([ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny], spread === 0);
      fill(polygon(ax, ay, r, 12), spread === 0);
      fill(polygon(bx, by, r, 12), spread === 0);
    }
  }
  return mask;
}

function visiblePath(B: Build, w: Way): boolean {
  return w.kind === 'path' && w.sub !== 'platform' && shows(B.cam, LOD.footpath, pathLength(w.pts));
}

/** Dashed paths, paired track ruts and stair treads. */
export function footpaths(B: Build, paper: Paper, ways: Way[], M: Masks, land?: Uint8Array): void {
  // Measure on the sheet, so foreshortening cannot turn dashes into filtered specks.
  const dash = B.cam.tone(1.1);
  const gap = B.cam.tone(0.8);
  const test: Test = (x, y, d) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && paper.seen(x, y, d);
  const pathInk: Test = (x, y, d) => drawsPathDash(M, land, paper.index(x, y)) && test(x, y, d);
  for (const w of ways) {
    if (!visiblePath(B, w)) continue;
    const pitch = w.sub === 'steps' ? stairPitch(B, w.pts) : 0;
    if (pitch > 0) {
      // Keep one rhythm for the whole flight, allowing for its most compressed direction.
      walk(w.pts, 0.2, pitch, 0.2, (x, y, ux, uy) => {
        groundSeg(paper, LINEWORK, x + uy * 0.9, y - ux * 0.9, x - uy * 0.9, y + ux * 0.9, test);
        paper.end();
      });
      continue;
    }
    // Paths no one walks any more grow over, a stretch at a time.
    for (const pts of kept(B, w.pts, 'paths', 9856, 10)) {
      // Farm tracks: two wheel ruts.
      if (w.cls === 'track' && shows(B.cam, LOD.ruts)) {
        for (const o of [0.8, -0.8]) dashed(paper, shifted(pts, o).filter((_, i) => i % 3 !== 2), dash, gap, test);
        continue;
      }
      dashed(paper, pts, dash, gap, pathInk);
    }
  }
}

/** A flight's tread pitch in local metres, or zero when its projected width needs a dashed path. */
function stairPitch(B: Build, p: number[]): number {
  const c = B.cam;
  let width = Infinity;
  let separation = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len, uy = dy / len;
    const across = Math.hypot(uy * c.cb + ux * c.sb, c.sa * (uy * c.sb - ux * c.cb));
    width = Math.min(width, 1.8 * across);
    // The projected ground area divided by tread length gives perpendicular spacing.
    separation = Math.min(separation, c.s * c.sa / across);
  }
  if (!Number.isFinite(width) || !shows(c, LOD.steps, width) || width * c.s <= c.nib * 2) return 0;
  return Math.max(0.55, Math.max(c.gap(0.8), c.nib * 2) / separation);
}

/** Length along a way in ground metres. */
export function pathLength(p: number[]): number {
  let l = 0;
  for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return l;
}

/** A ground line with dash phase measured in sheet millimetres, continuous through bends. */
export function dashed(paper: Paper, p: number[], dash: number, gap: number, test: Test): void {
  let inDash = true;
  let left = dash;
  const c = paper.cam;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const l = Math.hypot(c.sx(p[i + 2], p[i + 3]) - c.sx(p[i], p[i + 1]), c.sy(p[i + 2], p[i + 3], 0) - c.sy(p[i], p[i + 1], 0));
    if (l < 1e-6) continue;
    // Local metres travelled per millimetre along this projected segment.
    const ux = (p[i + 2] - p[i]) / l;
    const uy = (p[i + 3] - p[i + 1]) / l;
    let t = 0;
    while (t < l - 1e-9) {
      const t1 = Math.min(l, t + left);
      if (inDash) groundSeg(paper, LINEWORK, p[i] + ux * t, p[i + 1] + uy * t, p[i] + ux * t1, p[i + 1] + uy * t1, test);
      else paper.end();
      left -= t1 - t;
      if (left < 1e-9) {
        if (inDash) paper.end();
        inDash = !inDash;
        left = inDash ? dash : gap;
      }
      t = t1;
    }
  }
  paper.end();
}
