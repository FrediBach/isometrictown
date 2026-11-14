import { newSolid, prism, type Build, type Solid } from './buildings';
import { pointInRing, ringArea } from './geo';
import { onMask, place, rect, slab, type Extra } from './infra';
import type { Masks } from './nature';
import type { Paper, Test } from './raster';
import { hash } from './rng';
import { dome } from './roofs';
import { LINEWORK, ROOFS, WATER } from './settings';
import { bestRect, offsetRing, type Rect } from './shape';
import type { Area, Town } from './tiles';
import { letter } from './lettering';

/**
 * Things that belong to particular places: parasols on beaches, tents at campsites, swings
 * on playgrounds, silos in farmyards, cranes and containers in ports, benches cut into
 * quarries. All made up, tied to map position and the seed like the rest.
 */

/** A ground point that nothing else stands on. */
function free(paper: Paper, M: Masks, x: number, y: number): boolean {
  return !onMask(paper, M.road, x, y) && !onMask(paper, M.foot, x, y) && !onMask(paper, M.water, x, y);
}

/** Visit a grid fixed to the map over a rectangle, with a stable random source per cell. */
function grid(B: Build, r: Rect, step: number, salt: number, fn: (x: number, y: number, h: (k: number) => number) => void): void {
  const pad = Math.max(r.L, r.w) / 2 + step;
  const x0 = Math.floor((r.cx - pad) / step);
  const x1 = Math.ceil((r.cx + pad) / step);
  const y0 = Math.floor((r.cy - pad) / step);
  const y1 = Math.ceil((r.cy + pad) / step);
  for (let i = x0; i <= x1; i++)
    for (let j = y0; j <= y1; j++) {
      const [k0, k1] = B.key(i * step, j * step);
      const h = (k: number) => hash(k0, k1, B.set.seed, salt + k);
      fn((i + 0.2 + 0.6 * h(90)) * step, (j + 0.2 + 0.6 * h(91)) * step, h);
    }
}

function inside(a: Area, x: number, y: number): boolean {
  return pointInRing(x, y, a.shape[0].pts) && a.shape.slice(1).every((hole) => !pointInRing(x, y, hole.pts));
}

/** A vertical cylinder of n sides; with few creases it reads as round. */
function cylinder(B: Build, out: Solid, x: number, y: number, r: number, z0: number, z1: number, roof = true): number[] {
  const ring: number[] = [];
  for (let q = 0; q < 18; q++) ring.push(x + Math.cos((q / 18) * Math.PI * 2) * r, y + Math.sin((q / 18) * Math.PI * 2) * r);
  prism(B, [{ pts: ring, seam: new Uint8Array(18) }], z0, z1, { roof, windows: false, pen: LINEWORK }, out);
  return ring;
}

// ---------------------------------------------------------------- Beaches

function parasol(x: number, y: number, h: (k: number) => number): Solid {
  const s = newSolid();
  const r = 1.2 + h(1) * 0.3;
  const zr = 2.0;
  const apex = [x, y, zr + 0.45];
  const rim: number[] = [];
  for (let q = 0; q < 8; q++) {
    const a = (q / 8) * Math.PI * 2 + h(2);
    rim.push(x + Math.cos(a) * r, y + Math.sin(a) * r, zr);
  }
  for (let q = 0; q < 8; q++) {
    const n = (q + 1) % 8;
    s.faces.push([[...rim.slice(q * 3, q * 3 + 3), ...rim.slice(n * 3, n * 3 + 3), ...apex]]);
    if (q % 2) s.lines.push({ pen: ROOFS, pts: [...rim.slice(q * 3, q * 3 + 3), ...apex] });
  }
  s.lines.push({ pen: LINEWORK, pts: rim, closed: true }, { pen: LINEWORK, pts: [x, y, 0, x, y, zr] });
  s.casts.push({ ring: rim.filter((_, i) => i % 3 !== 2), h: zr });
  return s;
}

/** Parasols over beaches, each with a towel spread beside it. */
export function beaches(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const list = town.cover.filter((c) => c.cls === 'beach');
  if (!list.length || !B.set.ground || B.cam.s < 0.4) return { solids: [], draw: () => {} };
  const solids: Solid[] = [];
  const towels: number[][] = [];
  for (const a of list) {
    const { rect: r } = bestRect(a.shape[0].pts);
    if (!r) continue;
    grid(B, r, 7, 700, (x, y, h) => {
      if (h(0) > 0.3 || !inside(a, x, y) || !free(paper, M, x, y)) return;
      solids.push(parasol(x, y, h));
      const ang = h(3) * Math.PI;
      const ux = Math.cos(ang);
      const uy = Math.sin(ang);
      const ring = place(x + ux * 1.8, y + uy * 1.8, -uy, ux, rect(-0.9, 0.9, -0.45, 0.45));
      towels.push([0, 1, 2, 3].flatMap((q) => [ring[q * 2], ring[q * 2 + 1], 0]));
    });
  }
  return { solids, draw: () => towels.forEach((t) => paper.line3(LINEWORK, t, paper.seen, true)) };
}

// ---------------------------------------------------------------- Campsites

function tent(x: number, y: number, ux: number, uy: number, big: boolean): Solid {
  const s = newSolid();
  const L = big ? 1.6 : 1.2;
  const W = big ? 1.1 : 0.8;
  const H = big ? 1.5 : 1.1;
  const vx = -uy;
  const vy = ux;
  const P = (a: number, b: number, z: number) => [x + ux * a + vx * b, y + uy * a + vy * b, z];
  const r0 = P(-L, 0, H);
  const r1 = P(L, 0, H);
  const sides = [
    [P(-L, -W, 0), P(L, -W, 0), r1, r0],
    [P(-L, W, 0), P(L, W, 0), r1, r0],
    [P(-L, -W, 0), P(-L, W, 0), r0],
    [P(L, -W, 0), P(L, W, 0), r1],
  ];
  for (const f of sides) {
    s.faces.push([f.flat()]);
    s.lines.push({ pen: LINEWORK, pts: f.flat(), closed: true });
  }
  s.lines.push({ pen: ROOFS, pts: [...P(L, 0, 0), ...r1] });
  s.casts.push({ ring: [...P(-L, -W, 0), ...P(L, -W, 0), ...P(L, W, 0), ...P(-L, W, 0)].filter((_, i) => i % 3 !== 2), h: H * 0.6 });
  return s;
}

/** Tents and caravans round campsites. */
export function campsites(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const camps = town.pois.filter((p) => p.cls === 'campsite');
  if (!camps.length || B.cam.s < 0.3) return { solids: [], draw: () => {} };
  const solids: Solid[] = [];
  for (const c of camps) {
    grid(B, { cx: c.x, cy: c.y, ux: 1, uy: 0, L: 90, w: 90 }, 8, 710, (x, y, h) => {
      if (Math.hypot(x - c.x, y - c.y) > 45 || h(0) > 0.4) return;
      if (!free(paper, M, x, y) || onMask(paper, M.wood, x, y)) return;
      const a = h(1) * Math.PI;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      if (h(2) < 0.3) {
        const s = newSolid();
        const ring = place(x, y, ux, uy, rect(-2.6, 2.6, -1.1, 1.1));
        if (!free(paper, M, ring[0], ring[1]) || !free(paper, M, ring[4], ring[5])) return;
        slab(B, s, ring, 0.35, 2.5);
        s.casts.push({ ring, h: 2.5 });
        solids.push(s);
      } else solids.push(tent(x, y, ux, uy, h(3) < 0.4));
    });
  }
  return { solids, draw: () => {} };
}

// ---------------------------------------------------------------- Playgrounds

/** A swing frame and a slide on each playground. */
export function playgrounds(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  if (B.cam.s < 0.45) return { solids: [], draw: () => {} };
  const lines: number[][] = [];
  for (const a of town.landuse) {
    if (a.cls !== 'playground' || Math.abs(ringArea(a.shape[0].pts)) < 60) continue;
    const { rect: r } = bestRect(a.shape[0].pts);
    if (!r || r.w < 6) continue;
    const { ux, uy } = r;
    const vx = -uy;
    const vy = ux;
    const P = (u: number, v: number, z: number) => [r.cx + ux * u + vx * v, r.cy + uy * u + vy * v, z];
    const su = -r.L * 0.2;
    if (!free(paper, M, P(su, 0, 0)[0], P(su, 0, 0)[1])) continue;
    // Swings: an A-frame at each end of a bar, two seats hanging from it.
    for (const e of [-1.6, 1.6]) lines.push([...P(su + e, -1, 0), ...P(su + e, 0, 2.3), ...P(su + e, 1, 0)]);
    lines.push([...P(su - 1.6, 0, 2.3), ...P(su + 1.6, 0, 2.3)]);
    for (const c of [-0.7, 0.7]) lines.push([...P(su + c - 0.25, 0, 2.3), ...P(su + c - 0.25, 0, 0.5), ...P(su + c + 0.25, 0, 0.5), ...P(su + c + 0.25, 0, 2.3)]);
    // Slide: a ladder up to a platform and the chute down.
    const lu = r.L * 0.2;
    if (r.L < 10) continue;
    for (const v of [-0.35, 0.35]) {
      lines.push([...P(lu, v, 0), ...P(lu, v, 1.8), ...P(lu + 3, v, 0.3), ...P(lu + 3.4, v, 0.3)]);
      lines.push([...P(lu - 0.6, v, 0), ...P(lu, v, 1.8)]);
    }
    for (let z = 0.45; z < 1.8; z += 0.45) lines.push([...P(lu - 0.6 + (z / 1.8) * 0.6, -0.35, z), ...P(lu - 0.6 + (z / 1.8) * 0.6, 0.35, z)]);
  }
  return { solids: [], draw: (paper) => lines.forEach((l) => paper.line3(LINEWORK, l)) };
}

// ---------------------------------------------------------------- Farmyards

/**
 * Silos beside barns. The map rarely marks farmyards, so a farm is a big building standing
 * outside the town's residential and industrial land, with fields close by.
 */
export function farmyards(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const solids: Solid[] = [];
  const fields = town.cover.filter((c) => c.cls === 'farmland' || c.cls === 'meadow');
  const towns = town.landuse.filter((a) => a.cls === 'residential' || a.cls === 'industrial' || a.cls === 'commercial' || a.cls === 'retail');
  if (!fields.length || B.cam.s < 0.2) return { solids, draw: () => {} };
  for (const b of town.buildings) {
    if (b.min > 0 || b.info?.kind === 'worship' || b.info?.kind === 'civic') continue;
    const area = Math.abs(ringArea(b.shape[0].pts));
    if (area < 220 || area > 4000) continue;
    const { rect: r } = bestRect(b.shape[0].pts);
    if (!r) continue;
    const [k0, k1] = B.key(r.cx, r.cy);
    const h = (k: number) => hash(k0, k1, B.set.seed, 720 + k);
    if (h(0) > 0.4) continue;
    if (towns.some((a) => inside(a, r.cx, r.cy))) continue;
    // Farms stand apart: few other buildings close by.
    let close = 0;
    for (const o of town.buildings) {
      const q = o.shape[0].pts;
      if (Math.abs(q[0] - r.cx) < 70 && Math.abs(q[1] - r.cy) < 70 && ++close > 8) break;
    }
    if (close > 8) continue;
    const near = [0, 1, 2, 3, 4, 5, 6, 7].some((q) => {
      const x = r.cx + Math.cos((q * Math.PI) / 4) * (r.L / 2 + 40);
      const y = r.cy + Math.sin((q * Math.PI) / 4) * (r.L / 2 + 40);
      return fields.some((f) => inside(f, x, y));
    });
    if (!near) continue;
    // At one end of the barn, a little out from its side.
    const R = 2.4 + h(1) * 1.2;
    const end = h(2) < 0.5 ? 1 : -1;
    const side = h(3) < 0.5 ? 1 : -1;
    const count = h(4) < 0.4 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const a = end * (r.L / 2 - R - 0.5 - k * (2 * R + 1));
      const d = side * (r.w / 2 + R + 1.5);
      const x = r.cx + r.ux * a - r.uy * d;
      const y = r.cy + r.uy * a + r.ux * d;
      if (![0, 1, 2, 3, 4, 5].every((q) => free(paper, M, x + Math.cos(q) * (R + 0.3), y + Math.sin(q) * (R + 0.3)))) break;
      const s = newSolid();
      const H = Math.max(b.h * B.set.heightScale + 3, 9 + h(5 + k) * 6);
      const ring = cylinder(B, s, x, y, R, 0, H, false);
      dome(B, x, y, R, H, s);
      s.casts.push({ ring, h: H + R * 0.6 });
      solids.push(s);
    }
  }
  return { solids, draw: () => {} };
}

// ---------------------------------------------------------------- Ports

/** Where industrial land meets open water: quayside cranes, with stacks of containers behind them. */
export function ports(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const works = town.landuse.filter((a) => a.cls === 'industrial');
  if (!works.length || !town.water.length || B.cam.s < 0.12) return { solids: [], draw: () => {} };
  const solids: Solid[] = [];
  const lines: number[][] = [];
  const water = (x: number, y: number) => onMask(paper, M.water, x, y) && !onMask(paper, M.pool, x, y);
  const usedCranes: [number, number][] = [];
  for (const shape of town.water)
    for (const ring of shape) {
      const p = ring.pts;
      const n = p.length / 2;
      for (let e = 0; e < n; e++) {
        if (ring.seam[e]) continue;
        const f = (e + 1) % n;
        const ax = p[e * 2];
        const ay = p[e * 2 + 1];
        const len = Math.hypot(p[f * 2] - ax, p[f * 2 + 1] - ay);
        if (len < 40) continue;
        const ux = (p[f * 2] - ax) / len;
        const uy = (p[f * 2 + 1] - ay) / len;
        for (let t = 20; t < len - 20; t += 45) {
          const x = ax + ux * t;
          const y = ay + uy * t;
          let nx = -uy;
          let ny = ux;
          if (!water(x + nx * 6, y + ny * 6)) {
            nx = -nx;
            ny = -ny;
          }
          // n points over the water; the quay is behind.
          if (!water(x + nx * 6, y + ny * 6) || water(x - nx * 6, y - ny * 6)) continue;
          if (!works.some((a) => inside(a, x - nx * 8, y - ny * 8))) continue;
          if (usedCranes.some(([cx, cy]) => Math.hypot(cx - x, cy - y) < 35)) continue;
          const [k0, k1] = B.key(x, y);
          if (hash(k0, k1, B.set.seed, 740) > 0.7) continue;
          usedCranes.push([x, y]);
          crane(x, y, ux, uy, nx, ny, lines);
          containers(B, paper, M, x - nx * 22, y - ny * 22, ux, uy, k0, k1, solids);
        }
      }
    }
  return { solids, draw: (paper) => lines.forEach((l) => paper.line3(LINEWORK, l)) };
}

/** A gantry crane on the quay, its boom out over the water. */
function crane(x: number, y: number, ux: number, uy: number, nx: number, ny: number, lines: number[][]): void {
  const P = (a: number, d: number, z: number) => [x + ux * a + nx * d, y + uy * a + ny * d, z];
  const H = 22;
  for (const a of [-6, 6]) {
    lines.push([...P(a, -2, 0), ...P(a, -2, H), ...P(a, -14, H), ...P(a, -14, 0)]);
    lines.push([...P(a, -2, H * 0.45), ...P(a, -14, H * 0.45)]);
    lines.push([...P(a, -14, H + 2), ...P(a, 26, H + 2)]);
    lines.push([...P(a, -14, H), ...P(a, -14, H + 2)]);
  }
  for (const d of [-2, -14]) lines.push([...P(-6, d, H), ...P(6, d, H)]);
  lines.push([...P(-6, 26, H + 2), ...P(6, 26, H + 2)]);
  // The machinery house and the hoist.
  lines.push([...P(-3, -10, H + 2), ...P(3, -10, H + 2), ...P(3, -10, H + 5), ...P(-3, -10, H + 5)].concat(P(-3, -10, H + 2)));
  lines.push([...P(0, 12, H + 2), ...P(0, 12, 8)]);
}

/** A block of stacked containers. */
function containers(B: Build, paper: Paper, M: Masks, x: number, y: number, ux: number, uy: number, k0: number, k1: number, out: Solid[]): void {
  const vx = -uy;
  const vy = ux;
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 3; col++) {
      const a = (col - 1) * 13;
      const b = (row - 1.5) * 2.8;
      const cx = x + ux * a + vx * b;
      const cy = y + uy * a + vy * b;
      const ring = place(cx, cy, ux, uy, rect(-6, 6, -1.2, 1.2));
      if (![0, 1, 2, 3].every((q) => free(paper, M, ring[q * 2], ring[q * 2 + 1]))) continue;
      const stack = 1 + Math.floor(hash(k0, k1, B.set.seed, 750 + row * 3 + col) * 3);
      const s = newSolid();
      for (let k = 0; k < stack; k++) slab(B, s, ring, k * 2.6, (k + 1) * 2.6);
      s.casts.push({ ring, h: stack * 2.6 });
      out.push(s);
    }
}

// ---------------------------------------------------------------- Quarries

/** Benches cut down into quarries, as nested outlines. */
export function quarries(_B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const pits = town.landuse.filter((a) => a.cls === 'quarry');
  if (!pits.length) return { solids: [], draw: () => {} };
  const test: Test = (x, y, d) => !paper.on(M.road, x, y) && !paper.on(M.foot, x, y) && !paper.on(M.water, x, y) && paper.seen(x, y, d);
  return {
    solids: [],
    draw: () => {
      for (const a of pits) {
        let ring: number[] | null = a.shape[0].pts;
        for (let k = 1; k <= 8 && ring; k++) {
          ring = offsetRing(a.shape[0].pts, () => k * 7);
          if (!ring || Math.abs(ringArea(ring)) < 150) break;
          const pts: number[] = [];
          for (let i = 0; i < ring.length; i += 2) pts.push(ring[i], ring[i + 1], 0);
          paper.line3(LINEWORK, pts, test, true);
        }
      }
    },
  };
}

// ---------------------------------------------------------------- Squares

/** A fountain or a statue in the middle of each town square big enough to hold one. */
export function squares(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const solids: Solid[] = [];
  const lines: { pen: number; pts: number[] }[] = [];
  if (B.cam.s < 0.3) return { solids, draw: () => {} };
  for (const sq of town.plazas) {
    const outer = sq[0].pts;
    const area = Math.abs(ringArea(outer));
    if (area < 400 || area > 40000) continue;
    // Runway and helipad areas share the list; they keep clear.
    if (town.runways.some((w) => pointInRing(w.pts[0], w.pts[1], outer) || pointInRing(w.pts[w.pts.length - 2], w.pts[w.pts.length - 1], outer))) continue;
    const { rect: r } = bestRect(outer);
    if (!r || r.w < 14 || !pointInRing(r.cx, r.cy, outer)) continue;
    const [k0, k1] = B.key(r.cx, r.cy);
    const h = (k: number) => hash(k0, k1, B.set.seed, 760 + k);
    const { cx: x, cy: y } = r;
    if (onMask(paper, M.foot, x, y) || onMask(paper, M.water, x, y)) continue;
    const s = newSolid();
    if (h(0) < 0.6) {
      // A round basin, a column carrying a bowl, and water falling from it.
      const R = Math.min(Math.max(2.5, Math.sqrt(area) * (0.05 + h(1) * 0.02)), 7, r.w * 0.2);
      const ring = cylinder(B, s, x, y, R, 0, 0.55);
      const inner: number[] = [];
      for (let q = 0; q < 24; q++) inner.push(x + Math.cos((q / 24) * Math.PI * 2) * (R - 0.35), y + Math.sin((q / 24) * Math.PI * 2) * (R - 0.35), 0.55);
      lines.push({ pen: WATER, pts: [...inner, inner[0], inner[1], inner[2]] });
      cylinder(B, s, x, y, 0.25, 0.55, 1.9);
      cylinder(B, s, x, y, 1.0, 1.75, 1.95);
      for (let q = 0; q < 8; q++) {
        const a = (q / 8) * Math.PI * 2;
        const pts: number[] = [];
        for (let t = 0; t <= 1.0001; t += 0.2) pts.push(x + Math.cos(a) * (0.2 + t * 1.1), y + Math.sin(a) * (0.2 + t * 1.1), 2.5 + 0.35 * t - 1.3 * t * t);
        lines.push({ pen: WATER, pts });
      }
      s.casts.push({ ring, h: 0.55 });
    } else {
      // A statue on a plinth.
      const a = h(2) * Math.PI;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const plinth = place(x, y, ux, uy, rect(-1.1, 1.1, -1.1, 1.1));
      slab(B, s, plinth, 0, 2.4);
      slab(B, s, place(x, y, ux, uy, rect(-1.3, 1.3, -1.3, 1.3)), 0, 0.4);
      slab(B, s, place(x, y, ux, uy, rect(-0.3, 0.3, -0.22, 0.22)), 2.4, 4.0);
      cylinder(B, s, x, y, 0.2, 4.0, 4.4);
      s.casts.push({ ring: plinth, h: 4.2 });
    }
    solids.push(s);
  }
  return { solids, draw: (paper) => lines.forEach((l) => paper.line3(l.pen, l.pts)) };
}

// ---------------------------------------------------------------- Street furniture

/** The nearest road to a point: where on it, which way it runs, and its half width. */
function nearestRoad(town: Town, x: number, y: number, max: number): { px: number; py: number; ux: number; uy: number; hw: number; d: number } | null {
  let best: { px: number; py: number; ux: number; uy: number; hw: number; d: number } | null = null;
  for (const w of town.ways) {
    if (w.kind !== 'road') continue;
    const p = w.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i];
      const ay = p[i + 1];
      const dx = p[i + 2] - ax;
      const dy = p[i + 3] - ay;
      const ll = dx * dx + dy * dy;
      if (ll < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / ll));
      const px = ax + dx * t;
      const py = ay + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d > max || (best && d >= best.d)) continue;
      const l = Math.sqrt(ll);
      best = { px, py, ux: dx / l, uy: dy / l, hw: w.width / 2, d };
    }
  }
  return best;
}

/** Bus shelters at bus stops: a back panel, a roof on posts, and the stop sign at the kerb. */
export function busStops(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const solids: Solid[] = [];
  if (B.cam.s < 0.4) return { solids, draw: () => {} };
  for (const stop of town.pois) {
    if (stop.cls !== 'bus' || stop.sub !== 'bus_stop') continue;
    const [k0, k1] = B.key(stop.x, stop.y);
    if (hash(k0, k1, B.set.seed, 770) > 0.75) continue;
    const r = nearestRoad(town, stop.x, stop.y, 20);
    if (!r) continue;
    // Stand on the pavement on the stop's side of the road, facing the road.
    let nx = stop.x - r.px;
    let ny = stop.y - r.py;
    const l = Math.hypot(nx, ny);
    if (l < 1e-3) {
      nx = -r.uy;
      ny = r.ux;
    } else {
      nx /= l;
      ny /= l;
    }
    const x = r.px + nx * (r.hw + 2.0);
    const y = r.py + ny * (r.hw + 2.0);
    if (!free(paper, M, x, y) || !free(paper, M, x + nx * 0.9, y + ny * 0.9)) continue;
    const s = newSolid();
    const P = (a: number, c: number, z: number) => [x + r.ux * a + nx * c, y + r.uy * a + ny * c, z];
    const back = [P(-1.8, 0.7, 0.1), P(1.8, 0.7, 0.1), P(1.8, 0.7, 2.3), P(-1.8, 0.7, 2.3)];
    s.faces.push([back.flat()]);
    s.lines.push({ pen: LINEWORK, pts: back.flat(), closed: true });
    for (const a of [-1.8, 1.8]) {
      const side = [P(a, 0.7, 0.1), P(a, -0.2, 0.1), P(a, -0.2, 2.3), P(a, 0.7, 2.3)];
      s.faces.push([side.flat()]);
      s.lines.push({ pen: LINEWORK, pts: side.flat(), closed: true });
    }
    slab(B, s, place(x, y, r.ux, r.uy, rect(-2, 2, -0.4, 0.9).map(([a, c]) => [a, c * 1])), 2.3, 2.45);
    // The stop sign at the kerb end.
    const [sx, sy] = P(2.6, -1.2, 0);
    s.lines.push({ pen: LINEWORK, pts: [sx, sy, 0, sx, sy, 2.6] });
    const disc: number[] = [];
    for (let q = 0; q < 10; q++) disc.push(sx + r.ux * Math.cos((q / 10) * Math.PI * 2) * 0.35, sy + r.uy * Math.cos((q / 10) * Math.PI * 2) * 0.35, 2.6 + 0.35 + Math.sin((q / 10) * Math.PI * 2) * 0.35);
    s.lines.push({ pen: ROOFS, pts: disc, closed: true });
    solids.push(s);
  }
  return { solids, draw: () => {} };
}

/** Petrol stations: a canopy on columns over two pump islands. */
export function fuel(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const solids: Solid[] = [];
  if (B.cam.s < 0.25) return { solids, draw: () => {} };
  for (const f of town.pois) {
    if (f.cls !== 'fuel' || f.sub !== 'fuel') continue;
    const r = nearestRoad(town, f.x, f.y, 40);
    if (!r) continue;
    // Set back from the road, wherever the station's forecourt is clear.
    let nx = f.x - r.px;
    let ny = f.y - r.py;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    let spot: [number, number] | null = null;
    for (const back of [r.hw + 9, r.hw + 12, r.hw + 7]) {
      const x = r.px + nx * back;
      const y = r.py + ny * back;
      const corners = place(x, y, r.ux, r.uy, rect(-7, 7, -4.5, 4.5));
      let ok = true;
      for (let q = 0; q < 4 && ok; q++) ok = free(paper, M, corners[q * 2], corners[q * 2 + 1]);
      if (ok && free(paper, M, x, y)) {
        spot = [x, y];
        break;
      }
    }
    if (!spot) continue;
    const [x, y] = spot;
    const s = newSolid();
    slab(B, s, place(x, y, r.ux, r.uy, rect(-7, 7, -4.5, 4.5)), 4.6, 5.4, ROOFS);
    for (const [a, c] of [
      [-4.5, 0],
      [4.5, 0],
    ]) {
      const [cx, cy] = [x + r.ux * a - r.uy * c, y + r.uy * a + r.ux * c];
      s.lines.push({ pen: LINEWORK, pts: [cx, cy, 0, cx, cy, 4.6] });
      slab(B, s, place(cx, cy, r.ux, r.uy, rect(-0.4, 0.4, -1.6, 1.6)), 0, 0.2);
      slab(B, s, place(cx, cy, r.ux, r.uy, rect(-0.3, 0.3, -0.5, 0.5)), 0.2, 1.6);
    }
    s.casts.push({ ring: place(x, y, r.ux, r.uy, rect(-7, 7, -4.5, 4.5)), h: 5.2 });
    solids.push(s);
  }
  return { solids, draw: () => {} };
}

/** A tall chimney stack beside some of the big works. */
export function chimneys(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const solids: Solid[] = [];
  if (B.cam.s < 0.12 || !B.set.details) return { solids, draw: () => {} };
  for (const b of town.buildings) {
    if (b.info?.kind !== 'industrial') continue;
    const area = Math.abs(ringArea(b.shape[0].pts));
    if (area < 1500) continue;
    const { rect: r } = bestRect(b.shape[0].pts);
    if (!r) continue;
    const [k0, k1] = B.key(r.cx, r.cy);
    const h = (k: number) => hash(k0, k1, B.set.seed, 780 + k);
    if (h(0) > 0.22) continue;
    const R = 1.4 + h(1) * 0.8;
    const end = h(2) < 0.5 ? 1 : -1;
    const x = r.cx + r.ux * end * (r.L / 2 + R + 1.5);
    const y = r.cy + r.uy * end * (r.L / 2 + R + 1.5);
    if (![0, 1, 2, 3, 4, 5].every((q) => free(paper, M, x + Math.cos(q) * (R + 0.4), y + Math.sin(q) * (R + 0.4)))) continue;
    const s = newSolid();
    const H = Math.max(b.h * 2.5, 28 + h(3) * 22);
    const ring = cylinder(B, s, x, y, R * 1.25, 0, H * 0.25, false);
    cylinder(B, s, x, y, R, H * 0.25, H, true);
    // Bands near the top.
    for (const z of [H - 1.2, H - 2.4]) {
      const band: number[] = [];
      for (let q = 0; q <= 18; q++) band.push(x + Math.cos((q / 18) * Math.PI * 2) * R, y + Math.sin((q / 18) * Math.PI * 2) * R, z);
      s.lines.push({ pen: ROOFS, pts: band });
    }
    s.casts.push({ ring, h: H });
    solids.push(s);
  }
  return { solids, draw: () => {} };
}

/** A summit cross on each mountain top, with its height lettered beside it. */
export function peaks(B: Build, town: Town): Extra {
  if (!town.peaks.length || B.cam.s < 0.08) return { solids: [], draw: () => {} };
  return {
    solids: [],
    draw: (paper) => {
      const { cam } = B;
      for (const pk of town.peaks) {
        const { x, y } = pk;
        // Sized on paper rather than on the ground, so the cross reads at any scale.
        const k = Math.max(1, 1.2 / cam.s);
        paper.line3(LINEWORK, [x, y, 0, x, y, 6 * k]);
        paper.line3(LINEWORK, [x - cam.cb * 1.4 * k, y + cam.sb * 1.4 * k, 4.4 * k, x + cam.cb * 1.4 * k, y - cam.sb * 1.4 * k, 4.4 * k]);
        // A cairn at its foot.
        paper.line3(LINEWORK, [x - cam.cb * 1.2 * k, y + cam.sb * 1.2 * k, 0, x, y, 1.2 * k, x + cam.cb * 1.2 * k, y - cam.sb * 1.2 * k, 0]);
        if (!pk.ele) continue;
        const sx = cam.sx(x, y) + 1.2;
        const sy = cam.sy(x, y, 0) + 0.2;
        const d = cam.depth(x, y, 0);
        for (const l of letter(`${Math.round(pk.ele)} M`, sx, sy, { h: 1.6 })) {
          const pts: number[] = [];
          for (let i = 0; i < l.length; i += 2) pts.push(l[i], l[i + 1], d);
          paper.sheet(LINEWORK, pts);
        }
      }
    },
  };
}
