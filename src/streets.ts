import { car, type Build, type Solid } from './buildings';
import type { Masks } from './nature';
import type { Paper, Test } from './raster';
import { hash } from './rng';
import { LINEWORK } from './settings';
import type { Shape, Way } from './tiles';

const PARKING = new Set(['minor', 'tertiary', 'secondary', 'primary']);
const LIT = new Set(['minor', 'tertiary', 'secondary', 'primary', 'trunk']);

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
    for (let i = 0; i < p.length; i += 2) paper.fillMask(mask, [polygon(p[i], p[i + 1], hw, 12)]);
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
export function curbs(paper: Paper, ways: Way[], M: Masks): void {
  for (const w of ways) {
    if (w.kind !== 'road') continue;
    const hw = w.width / 2;
    const p = w.pts;
    const n = p.length / 2;
    for (const side of [1, -1]) {
      for (let i = 0; i + 1 < n; i++) {
        const [ax, ay, bx, by] = [p[i * 2], p[i * 2 + 1], p[i * 2 + 2], p[i * 2 + 3]];
        const l = Math.hypot(bx - ax, by - ay);
        if (l < 1e-6) continue;
        const nx = (-(by - ay) / l) * side;
        const ny = ((bx - ax) / l) * side;
        groundSeg(paper, LINEWORK, ax + nx * hw, ay + ny * hw, bx + nx * hw, by + ny * hw, edgeTest(paper, M.road, nx, ny));
      }
      paper.end();
    }
    for (let i = 0; i < n; i++) {
      if (i > 0 && i < n - 1) {
        const e1x = p[i * 2] - p[i * 2 - 2];
        const e1y = p[i * 2 + 1] - p[i * 2 - 1];
        const e2x = p[i * 2 + 2] - p[i * 2];
        const e2y = p[i * 2 + 3] - p[i * 2 + 1];
        const cos = (e1x * e2x + e1y * e2y) / (Math.hypot(e1x, e1y) * Math.hypot(e2x, e2y) || 1);
        if (cos > 0.9985) continue;
      }
      const m = 16;
      for (let k = 0; k < m; k++) {
        const a0 = (k / m) * Math.PI * 2;
        const a1 = ((k + 1) / m) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const test = edgeTest(paper, M.road, Math.cos(am), Math.sin(am));
        groundSeg(paper, LINEWORK, p[i * 2] + Math.cos(a0) * hw, p[i * 2 + 1] + Math.sin(a0) * hw, p[i * 2] + Math.cos(a1) * hw, p[i * 2 + 1] + Math.sin(a1) * hw, test);
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

/** Cars parked along kerbs. */
export function parkCars(B: Build, paper: Paper, ways: Way[], M: Masks): Solid[] {
  const { set, cam } = B;
  const out: Solid[] = [];
  if (set.cars <= 0) return out;
  for (const w of ways) {
    if (w.kind !== 'road' || !PARKING.has(w.cls)) continue;
    const off = w.width / 2 - 1.35;
    walk(w.pts, 9, 6.3, 9, (x, y, ux, uy) => {
      for (const side of [1, -1]) {
        const cx = x - uy * side * off;
        const cy = y + ux * side * off;
        const [ka, kb] = B.key(cx, cy);
        if (hash(ka, kb, set.seed, 70 + side) >= set.cars * 0.85) continue;
        const sx = cam.sx(cx, cy);
        const sy = cam.sy(cx, cy, 0);
        if (sy < paper.y0 - 2 || sy > paper.y1 + 6 || sx < paper.x0 - 6 || sx > paper.x1 + 6) continue;
        if (!paper.on(M.road, sx, sy) || paper.on(M.foot, sx, sy) || paper.on(M.water, sx, sy)) continue;
        out.push(car(B, cx, cy, ux * side, uy * side, hash(ka, kb, set.seed, 90)));
      }
    });
  }
  return out;
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
      paper.line3(LINEWORK, [lx, ly, 0, lx, ly, 5.4, ax, ay, 5.6, ax, ay, 5.25]);
      count++;
    });
  }
  return count;
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
export function railways(B: Build, paper: Paper, ways: Way[]): void {
  const s = B.cam.s;
  const twin = s * 1.5 >= 0.55;
  for (const w of ways) {
    if (w.kind !== 'rail') continue;
    const p = w.pts;
    const tram = w.sub === 'tram';
    const g = tram ? 0.72 : w.sub === 'narrow_gauge' ? 0.5 : 0.75;
    for (const o of twin ? [g, -g] : [0]) paper.line3(LINEWORK, shifted(p, o));
    if (tram) {
      if (s < 0.3) continue;
      paper.line3(LINEWORK, shifted(p, 0, 5.6));
      walk(p, 6, 30, 3, (x, y, ux, uy, k) => {
        const side = k % 2 ? 1 : -1;
        const px = x - uy * 3.4 * side;
        const py = y + ux * 3.4 * side;
        paper.line3(LINEWORK, [px, py, 0, px, py, 6.4, x, y, 5.9]);
      });
      continue;
    }
    if (twin && s * 2.6 >= 1) {
      const sl = g + 0.55;
      walk(p, 1, 2.6, 0, (x, y, ux, uy) => paper.seg3(LINEWORK, x + uy * sl, y - ux * sl, 0, x - uy * sl, y + ux * sl, 0));
    }
  }
}

/** Footpaths as dashed lines, away from roads and water. */
export function footpaths(B: Build, paper: Paper, ways: Way[], M: Masks): void {
  const s = B.cam.s;
  const dash = 1.1 / s;
  const gap = 0.8 / s;
  const test: Test = (x, y, d) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && paper.seen(x, y, d);
  for (const w of ways) {
    if (w.kind !== 'path') continue;
    if (w.sub === 'steps' && s >= 0.5) {
      // Steps: treads across the path.
      walk(w.pts, 0.2, 0.55, 0.2, (x, y, ux, uy) => {
        groundSeg(paper, LINEWORK, x + uy * 0.9, y - ux * 0.9, x - uy * 0.9, y + ux * 0.9, test);
        paper.end();
      });
      continue;
    }
    // Farm tracks: two wheel ruts.
    if (w.cls === 'track' && s >= 0.35) {
      for (const o of [0.8, -0.8]) dashed(paper, shifted(w.pts, o).filter((_, i) => i % 3 !== 2), dash, gap, test);
      continue;
    }
    dashed(paper, w.pts, dash, gap, test);
  }
}

/** A dashed line on the ground. */
function dashed(paper: Paper, p: number[], dash: number, gap: number, test: Test): void {
  let phase = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const l = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (l < 1e-6) continue;
    const ux = (p[i + 2] - p[i]) / l;
    const uy = (p[i + 3] - p[i + 1]) / l;
    let t = 0;
    while (t < l) {
      const inDash = phase < dash;
      const left = Math.max(1e-3, inDash ? dash - phase : dash + gap - phase);
      const t1 = Math.min(l, t + left);
      if (inDash) groundSeg(paper, LINEWORK, p[i] + ux * t, p[i + 1] + uy * t, p[i] + ux * t1, p[i + 1] + uy * t1, test);
      else paper.end();
      phase = (phase + (t1 - t)) % (dash + gap);
      t = t1;
    }
  }
  paper.end();
}
