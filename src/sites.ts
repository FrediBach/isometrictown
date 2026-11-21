import { car, heightScaleAt, newSolid, prism, type Build, type Solid } from './buildings';
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
import { walk } from './streets';
import { LOD, shows, showsAt } from './lod';
import { emergency, local, tractor } from './vehicles';
import { left, past, stepsGone } from './decay';

/**
 * Things that belong to particular places: parasols on beaches, tents and caravans at campsites, swings
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
  if (!list.length || !B.set.ground || !shows(B.cam, LOD.beach)) return { solids: [], draw: () => {} };
  const solids: Solid[] = [];
  const towels: number[][] = [];
  for (const a of list) {
    const { rect: r } = bestRect(a.shape[0].pts);
    if (!r) continue;
    grid(B, r, 7, 700, (x, y, h) => {
      if (h(0) > 0.3 || !inside(a, x, y) || !free(paper, M, x, y)) return;
      if (B.set.abandon > 0 && left(B, 'leisure', x, y, 9840)) return;
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

/*
 * The map has a campsite as a point, sometimes a motorhome stop (caravan_site) rather than a
 * camp_site, and no outline. Its ground is worked out: what lies within a radius of the
 * point, short of the through roads, railways and water between, and of land that is
 * something else. Pitches line the camp's own lanes, with rows across open ground between.
 * Everything a pitch depends on comes from the map, so pitches don't move when the view does.
 */

/** Roads that bound a campsite rather than run through it. */
const THROUGH = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'raceway']);
/** Land cover a campsite stops at, unless its point stands on it. */
const NOT_CAMP = new Set(['farmland', 'vineyard', 'orchard', 'allotments', 'farmyard', 'wetland', 'rock', 'ice']);
/** Pitch spacing along a lane and their depth back from it, in metres. */
const PITCH = 9;
const PITCH_DEPTH = 8;
/** Pitch centres closer than this crowd each other: the later one in hash order goes. */
const PITCH_GAP = 8.2;

/** A pitch: its centre, the way a van on it faces (towards its lane), and its place in the order they are taken in. */
type Pitch = { x: number; y: number; ux: number; uy: number; pri: number; vans: boolean };

/** Does segment a–b cross any edge of the polyline p? */
function crosses(ax: number, ay: number, bx: number, by: number, p: number[], closed = false): boolean {
  const n = p.length;
  for (let i = 0; i + 1 < n; i += 2) {
    const j = i + 2 < n ? i + 2 : closed ? 0 : -1;
    if (j < 0) break;
    const cx = p[i], cy = p[i + 1], dx = p[j], dy = p[j + 1];
    const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    if (d1 > 0 === d2 > 0) continue;
    const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    if (d3 > 0 !== d4 > 0) return true;
  }
  return false;
}

/** Is (x, y) within d of the polyline p? */
function nearLine(p: number[], x: number, y: number, d: number): boolean {
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ex = p[i + 2] - p[i];
    const ey = p[i + 3] - p[i + 1];
    const l2 = ex * ex + ey * ey;
    const t = l2 ? Math.max(0, Math.min(1, ((x - p[i]) * ex + (y - p[i + 1]) * ey) / l2)) : 0;
    if (Math.hypot(p[i] + ex * t - x, p[i + 1] + ey * t - y) < d) return true;
  }
  return false;
}

/** Does the bounding box of p come within d of (x, y)? */
function boxNear(p: number[], x: number, y: number, d: number): boolean {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < x0) x0 = p[i];
    if (p[i] > x1) x1 = p[i];
    if (p[i + 1] < y0) y0 = p[i + 1];
    if (p[i + 1] > y1) y1 = p[i + 1];
  }
  return x >= x0 - d && x <= x1 + d && y >= y0 - d && y <= y1 + d;
}

/** Candidate pitches for one campsite, and a test for whether a point is on its ground. */
function campGround(B: Build, town: Town, c: { x: number; y: number; sub: string }, out: Pitch[]): void {
  const vans = c.sub === 'caravan_site';
  const R = vans ? 40 : 70;
  const ways = town.nearby.ways.filter((w) => boxNear(w.pts, c.x, c.y, R + 20));
  const barriers = ways.filter((w) => w.kind === 'rail' || (w.kind === 'road' && THROUGH.has(w.cls))).map((w) => w.pts);
  for (const s of town.streams) if (boxNear(s.pts, c.x, c.y, R + 20)) barriers.push(s.pts);
  // Car parks keep their bays for cars.
  const aisles = ways.filter((w) => w.service === 'parking_aisle').map((w) => w.pts);
  const shores = town.water.filter((s) => boxNear(s[0].pts, c.x, c.y, R)).map((s) => s[0].pts);
  // Land that is something else, unless the campsite's point stands on it.
  const others = [...town.nearby.landuse, ...town.cover.filter((a) => NOT_CAMP.has(a.cls))].filter((a) => boxNear(a.shape[0].pts, c.x, c.y, R) && !inside(a, c.x, c.y));
  const ours = (x: number, y: number) =>
    Math.hypot(x - c.x, y - c.y) <= R && !barriers.some((p) => crosses(c.x, c.y, x, y, p) || nearLine(p, x, y, 7)) && !aisles.some((p) => nearLine(p, x, y, 10)) && !shores.some((p) => crosses(c.x, c.y, x, y, p, true)) && !others.some((a) => inside(a, x, y));
  const add = (x: number, y: number, ux: number, uy: number, rank: number) => {
    if (!ours(x, y)) return;
    const [k0, k1] = B.key(x, y);
    out.push({ x, y, ux, uy, pri: rank + hash(k0, k1, B.set.seed, 7400), vans });
  };

  // Pitches either side of the camp's lanes, spaced from each lane's own ends.
  const lanes = ways.filter((w) => !w.bridge && ((w.kind === 'road' && w.cls === 'service' && w.service !== 'parking_aisle') || (w.kind === 'path' && w.sub !== 'steps' && w.sub !== 'pier')));
  let best = 0;
  let gx = 1;
  let gy = 0;
  for (const w of lanes) {
    const off = (w.kind === 'road' ? w.width / 2 : 1) + 0.8 + PITCH_DEPTH / 2;
    for (const side of [1, -1])
      walk(w.pts, PITCH / 2, PITCH, PITCH / 2, (x, y, ux, uy) => {
        const nx = -uy * side;
        const ny = ux * side;
        add(x + nx * off, y + ny * off, -nx, -ny, 0);
      });
    // The longest stretch of lane on the ground sets the rows across open ground.
    for (let i = 0; i + 3 < w.pts.length; i += 2) {
      const dx = w.pts[i + 2] - w.pts[i];
      const dy = w.pts[i + 3] - w.pts[i + 1];
      const l = Math.hypot(dx, dy);
      if (l > best && ours((w.pts[i] + w.pts[i + 2]) / 2, (w.pts[i + 1] + w.pts[i + 3]) / 2)) {
        best = l;
        gx = dx / l;
        gy = dy / l;
      }
    }
  }
  // Rows over open ground, on a grid that turns with the camp, centred on its point.
  const [c0, c1] = B.key(c.x, c.y);
  if (!best) {
    const a = hash(c0, c1, B.set.seed, 7401) * Math.PI;
    gx = Math.cos(a);
    gy = Math.sin(a);
  }
  const flip = hash(c0, c1, B.set.seed, 7402) < 0.5 ? 1 : -1;
  const n = Math.ceil(R / PITCH);
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++) {
      const u = i * PITCH;
      const v = j * (PITCH_DEPTH + 1.5);
      add(c.x + gx * u - gy * v, c.y + gy * u + gx * v, -gy * flip, gx * flip, 1);
    }
}

/** A body of one cross-section: the convex profile `prof` ([a, z] pairs, in order round it) swept across from b0 to b1. */
function extrude(s: Solid, P: (a: number, b: number, z: number) => number[], prof: number[][], b0: number, b1: number): void {
  const side = (b: number) => prof.flatMap(([a, z]) => P(a, b, z));
  const s0 = side(b0);
  const s1 = side(b1);
  s.faces.push([s0], [s1]);
  s.lines.push({ pen: LINEWORK, pts: s0, closed: true }, { pen: LINEWORK, pts: s1, closed: true });
  for (let i = 0; i < prof.length; i++) {
    const [a, z] = prof[i];
    const [a2, z2] = prof[(i + 1) % prof.length];
    s.faces.push([[...P(a, b0, z), ...P(a2, b0, z2), ...P(a2, b1, z2), ...P(a, b1, z)]]);
    s.lines.push({ pen: LINEWORK, pts: [...P(a, b0, z), ...P(a, b1, z)] });
  }
}

/** An outline drawn on the side of a body at b: a window or a door. */
function panel(s: Solid, P: (a: number, b: number, z: number) => number[], b: number, a0: number, a1: number, z0: number, z1: number): void {
  s.lines.push({ pen: LINEWORK, pts: [...P(a0, b, z0), ...P(a1, b, z0), ...P(a1, b, z1), ...P(a0, b, z1)], closed: true });
}

/** An awning out from the side at b (d says which way), its edge on two poles; `a0`–`a1` along, from height z0 down to z1. */
function awningOut(s: Solid, P: (a: number, b: number, z: number) => number[], b: number, d: number, a0: number, a1: number, z0: number, z1: number): void {
  const o = b + d * 2.3;
  const sheet = [...P(a0, b, z0), ...P(a1, b, z0), ...P(a1, o, z1), ...P(a0, o, z1)];
  const valance = [...P(a0, o, z1), ...P(a1, o, z1), ...P(a1, o, z1 - 0.2), ...P(a0, o, z1 - 0.2)];
  s.faces.push([sheet], [valance]);
  (s.shade ??= []).push([sheet]);
  s.lines.push({ pen: LINEWORK, pts: sheet, closed: true }, { pen: LINEWORK, pts: [...P(a0, o, z1 - 0.2), ...P(a1, o, z1 - 0.2)] });
  for (const a of [a0 + 0.1, a1 - 0.1]) s.lines.push({ pen: LINEWORK, pts: [...P(a, o, z1 - 0.2), ...P(a, o, 0)] });
}

/** A ridge tent: two pitched sides and two triangular ends. */
function ridgeTent(x: number, y: number, ux: number, uy: number, big: boolean): Solid {
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
  // The door: a slit up the front end.
  s.lines.push({ pen: ROOFS, pts: [...P(L, 0, 0), ...r1] });
  s.casts.push({ ring: [...P(-L, -W, 0), ...P(L, -W, 0), ...P(L, W, 0), ...P(-L, W, 0)].filter((_, i) => i % 3 !== 2), h: H * 0.6 });
  return s;
}

/** A dome tent: a low six-sided dome, its poles showing as the creases. */
function domeTent(x: number, y: number, ux: number, uy: number, r: number): Solid {
  const s = newSolid();
  const H = r * 0.85;
  const base = Math.atan2(uy, ux);
  const ring = (rad: number, z: number) => Array.from({ length: 6 }, (_, q) => [x + Math.cos(base + (q * Math.PI) / 3) * rad, y + Math.sin(base + (q * Math.PI) / 3) * rad, z]);
  const rim = ring(r, 0);
  const mid = ring(r * 0.72, H * 0.7);
  const apex = [x, y, H];
  for (let q = 0; q < 6; q++) {
    const n = (q + 1) % 6;
    s.faces.push([[...rim[q], ...rim[n], ...mid[n], ...mid[q]]], [[...mid[q], ...mid[n], ...apex]]);
    s.lines.push({ pen: LINEWORK, pts: [...rim[q], ...mid[q], ...apex] });
  }
  s.lines.push({ pen: LINEWORK, pts: rim.flat(), closed: true }, { pen: LINEWORK, pts: mid.flat(), closed: true });
  s.casts.push({ ring: rim.flatMap((p) => [p[0], p[1]]), h: H * 0.6 });
  return s;
}

/** A touring caravan, front towards (ux, uy): rounded ends, windows, a door on side d, the drawbar, and an awning if wanted. */
function caravan(B: Build, x: number, y: number, ux: number, uy: number, d: number, awning: boolean, fine: boolean): Solid {
  const s = newSolid();
  const { P, wheel } = local(B, s, x, y, ux, uy);
  const W = 1.15;
  extrude(s, P, [[-2.7, 0.35], [2.45, 0.35], [2.8, 0.95], [2.55, 2.2], [2.1, 2.5], [-2.55, 2.5], [-2.75, 2.25]], -W, W);
  s.casts.push({ ring: place(x, y, ux, uy, rect(-2.75, 2.8, -W, W)), h: 2.5 });
  // The drawbar, an A-frame to the hitch.
  s.lines.push({ pen: LINEWORK, pts: [...P(2.6, -0.7, 0.4), ...P(3.9, 0, 0.42), ...P(2.6, 0.7, 0.4)] });
  if (fine) {
    const e = W + 0.02;
    for (const b of [-e, e]) {
      panel(s, P, b, -2.2, -0.9, 1.3, 1.95);
      panel(s, P, b, 1.0, 2.05, 1.3, 1.95);
    }
    panel(s, P, d * e, -0.35, 0.3, 0.5, 2.05);
    s.lines.push({ pen: LINEWORK, pts: [...P(3.7, 0, 0.42), ...P(3.7, 0, 0.05)] });
    for (const b of [-W + 0.1, W - 0.1]) wheel(0, b, 0.32);
  }
  if (awning) awningOut(s, P, d * W, d, -1.9, 1.4, 2.4, 2.05);
  return s;
}

/** An alcove motorhome, cab towards (ux, uy): a box body, the bed over the cab, a sloping cab front, a door on side d. */
function motorhome(B: Build, x: number, y: number, ux: number, uy: number, d: number, awning: boolean, fine: boolean): Solid {
  const s = newSolid();
  const { P, wheel } = local(B, s, x, y, ux, uy);
  const W = 1.15;
  extrude(s, P, [[-3.4, 0.4], [1.7, 0.4], [1.7, 3.0], [-3.3, 3.0], [-3.45, 2.8]], -W, W);
  extrude(s, P, [[1.7, 2.1], [2.75, 2.3], [2.6, 3.0], [1.7, 3.0]], -W, W);
  extrude(s, P, [[1.7, 0.4], [3.5, 0.4], [3.55, 1.0], [2.5, 2.1], [1.7, 2.1]], -1.05, 1.05);
  s.casts.push({ ring: place(x, y, ux, uy, rect(-3.45, 3.55, -W, W)), h: 3 });
  if (fine) {
    const e = W + 0.02;
    for (const b of [-e, e]) {
      panel(s, P, b, -2.8, -1.6, 1.5, 2.2);
      panel(s, P, b, 0.1, 1.3, 1.5, 2.2);
      panel(s, P, (b / e) * 1.07, 1.85, 2.45, 1.3, 1.95);
    }
    panel(s, P, d * e, -1.3, -0.65, 0.5, 2.3);
    for (const a of [-1.9, 2.6]) for (const b of [-W + 0.12, W - 0.12]) wheel(a, b, 0.38);
  }
  // The awning in its case under the roof edge, wound out over the door if wanted.
  s.lines.push({ pen: LINEWORK, pts: [...P(-2.6, d * (W + 0.05), 2.85), ...P(1.0, d * (W + 0.05), 2.85)] });
  if (awning) awningOut(s, P, d * (W + 0.05), d, -2.6, 1.0, 2.85, 2.35);
  return s;
}

/** Tents, caravans and motorhomes on the pitches of campsites and motorhome stops. */
export function campsites(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const { cam, set } = B;
  const none = { solids: [], draw: () => {} };
  // Points just off the sheet too, so a camp's edge is the same whichever side the view is.
  const camps = town.nearby.pois.filter((p) => p.cls === 'campsite');
  if (!camps.length || (!shows(cam, LOD.tent) && !shows(cam, LOD.caravan))) return none;
  const all: Pitch[] = [];
  for (const c of camps) campGround(B, town, c, all);
  // Lane pitches first, each kind in hash order, so crowded pitches give way the same in every view.
  all.sort((a, b) => a.pri - b.pri || a.x - b.x || a.y - b.y);
  const pitches: Pitch[] = [];
  for (const p of all) if (!pitches.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < PITCH_GAP)) pitches.push(p);

  const solids: Solid[] = [];
  const clear = (x: number, y: number) => free(paper, M, x, y) && !onMask(paper, M.wood, x, y);
  const clearRing = (ring: number[]) => {
    for (let i = 0; i < ring.length; i += 2) if (!clear(ring[i], ring[i + 1])) return false;
    return true;
  };
  // Room taken on the ground, as discs [x, y, r, …]. A thing is placed, or not, before its
  // level of detail is asked, so what stands where is the same at every scale.
  const taken: number[] = [];
  const discs = (x: number, y: number, ux: number, uy: number, a0: number, a1: number, b0: number, b1: number) => {
    const r = (b1 - b0) / 2;
    const out: number[] = [];
    const n = Math.max(1, Math.ceil((a1 - a0 - 2 * r) / r));
    for (let i = 0; i <= n; i++) {
      const a = a1 - a0 <= 2 * r ? (a0 + a1) / 2 : a0 + r + ((a1 - a0 - 2 * r) * i) / n;
      out.push(x + ux * a - uy * (b0 + r), y + uy * a + ux * (b0 + r), r);
    }
    return out;
  };
  const claim = (cs: number[], ring: number[]) => {
    if (!clearRing(ring)) return false;
    for (let i = 0; i < cs.length; i += 3)
      for (let j = 0; j < taken.length; j += 3) if (Math.hypot(cs[i] - taken[j], cs[i + 1] - taken[j + 1]) < cs[i + 2] + taken[j + 2]) return false;
    taken.push(...cs);
    return true;
  };
  const fine = shows(cam, LOD.campDetail);
  // Doors and awnings are on the side away from the traffic.
  const door = B.left ? 1 : -1;
  for (const p of pitches) {
    if (!clear(p.x, p.y)) continue;
    const [k0, k1] = B.key(p.x, p.y);
    const h = (k: number) => hash(k0, k1, set.seed, 7410 + k);
    const roll = h(0);
    // Campers leave an abandoned town with their tents, motorhomes and cars; caravans are left to rot.
    const gone = set.abandon > 0 && left(B, 'leisure', p.x, p.y, 9838);
    // Across the pitch, towards the door side of a van facing the lane.
    const sx = -p.uy * door;
    const sy = p.ux * door;
    const at = (u: number) => [p.x + sx * u, p.y + sy * u] as const;
    const addCar = (u: number, salt: number) => {
      if (set.cars <= 0 || h(salt) > 0.6 || gone) return;
      const [cx, cy] = at(u);
      if (!claim(discs(cx, cy, p.ux, p.uy, -2.3, 2.3, -1, 1), place(cx, cy, p.ux, p.uy, rect(-2.3, 2.3, -0.95, 0.95)))) return;
      if (showsAt(cam, LOD.car, 4.4, [k0, k1], set.seed, 7420)) solids.push(car(B, cx, cy, p.ux, p.uy, h(salt + 1)));
    };
    const van = p.vans ? (roll < 0.6 ? 'motorhome' : roll < 0.75 ? 'caravan' : null) : roll < 0.28 ? null : roll < 0.62 ? 'tents' : roll < 0.84 ? 'caravan' : 'motorhome';
    if (!van || (gone && (van !== 'caravan' || past(B, 'wrecks', h(15), p.x, p.y)))) continue;
    if (van === 'tents') {
      const count = h(1) < 0.35 ? 2 : 1;
      for (let t = 0; t < count; t++) {
        const kind = h(2 + t);
        const [tx, ty] = at(t ? 2.6 : -0.5 + (h(4) - 0.5) * 2);
        const depth = (h(5 + t) - 0.5) * 2.5;
        const x = tx - p.ux * depth;
        const y = ty - p.uy * depth;
        const a = Math.atan2(p.uy, p.ux) + (h(7 + t) - 0.5) * 0.9;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const size = kind < 0.45 ? 2.2 : kind < 0.75 ? 2.4 : 3.2;
        if (!claim([x, y, 1.9], place(x, y, ux, uy, rect(-1.6, 1.6, -1.2, 1.2))) || !shows(cam, LOD.tent, size, h(9 + t))) continue;
        solids.push(kind < 0.45 ? domeTent(x, y, ux, uy, 1.1) : ridgeTent(x, y, ux, uy, kind >= 0.75));
      }
      addCar(-3.4, 11);
      continue;
    }
    // Most vans face their lane; some were backed in.
    const turn = h(13) < (van === 'caravan' ? 0.8 : 0.7) ? 1 : -1;
    const ux = p.ux * turn;
    const uy = p.uy * turn;
    const len = van === 'caravan' ? 6.6 : 7;
    const awning = h(14) < (van === 'caravan' ? 0.6 : 0.35) && shows(cam, LOD.awning, 2.3);
    const d = door * turn;
    const reach = awning ? 3.6 : 1.3;
    const b0 = d > 0 ? -1.3 : -reach;
    const b1 = d > 0 ? reach : 1.3;
    const body = discs(p.x, p.y, ux, uy, -3.5, 3.9, -1.3, 1.3);
    const side = awning ? discs(p.x, p.y, ux, uy, -2.6, 1.4, d > 0 ? 1.3 : -reach, d > 0 ? reach : -1.3) : [];
    if (!claim([...body, ...side], place(p.x, p.y, ux, uy, rect(-3.5, 3.9, b0, b1)))) continue;
    if (!showsAt(cam, LOD.caravan, len, [k0, k1], set.seed, 7421)) continue;
    solids.push(van === 'caravan' ? caravan(B, p.x, p.y, ux, uy, d, awning, fine) : motorhome(B, p.x, p.y, ux, uy, d, awning, fine));
    addCar(-3.3 * turn, 15);
  }
  return { solids, draw: () => {} };
}

// ---------------------------------------------------------------- Playgrounds

/** A swing frame and a slide on each playground. */
export function playgrounds(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  if (!shows(B.cam, LOD.playground)) return { solids: [], draw: () => {} };
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
  if (!fields.length || !shows(B.cam, LOD.farmyard)) return { solids, draw: () => {} };
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
      const H = Math.max(b.h * heightScaleAt(B, r.cx, r.cy) + 3, 9 + h(5 + k) * 6);
      const ring = cylinder(B, s, x, y, R, 0, H, false);
      dome(B, x, y, R, H, s);
      s.casts.push({ ring, h: H + R * 0.6 });
      solids.push(s);
    }
    // A tractor parked along the barn's other side, sometimes with its trailer.
    // It stays when the farm is left, until it rusts away.
    if (B.set.life && shows(B.cam, LOD.machine) && hash(k0, k1, B.set.seed, 2120) < 0.5 && !(B.set.abandon > 0 && past(B, 'wrecks', hash(k0, k1, B.set.seed, 9834)))) {
      const d = -side * (r.w / 2 + 2.2);
      const dir = hash(k0, k1, B.set.seed, 2121) < 0.5 ? 1 : -1;
      const tool = hash(k0, k1, B.set.seed, 2122) < 0.4 ? 'trailer' : 'none';
      const a = dir * (tool === 'trailer' ? 3.5 : 0);
      const x = r.cx + r.ux * a - r.uy * d;
      const y = r.cy + r.uy * a + r.ux * d;
      const reach = tool === 'trailer' ? 7.5 : 2.5;
      const ok = [-reach, 0, 2.2].every((t) => [-1.3, 1.3].every((e) => free(paper, M, x + r.ux * dir * t - r.uy * e, y + r.uy * dir * t + r.ux * e)));
      if (ok) solids.push(tractor(B, x, y, r.ux * dir, r.uy * dir, tool));
    }
  }
  return { solids, draw: () => {} };
}

// ---------------------------------------------------------------- Ports

/** Where industrial land meets open water: quayside cranes, with stacks of containers behind them. */
export function ports(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const works = town.landuse.filter((a) => a.cls === 'industrial');
  if (!works.length || !town.water.length || !shows(B.cam, LOD.port)) return { solids: [], draw: () => {} };
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

/** A hillside working with a broken high wall, benches and spoil beside the open yard. */
function quarryWorking(B: Build, outline: number[], access: [number, number]): Solid {
  const s = newSolid();
  const { rect: site } = bestRect(outline);
  if (!site) return s;
  const { cx, cy } = site;
  const radius = site.w / 2;
  const [kx, ky] = B.key(cx, cy);
  const pick = (salt: number) => hash(kx, ky, B.set.seed, salt);
  // Present the exposed high wall in profile, with its low end towards the roadside entrance.
  const [upX, upY] = B.cam.up;
  const turn = (pick(14790) - 0.5) * 1.9;
  const ux = upY * Math.cos(turn) - upX * Math.sin(turn);
  const uy = -upX * Math.cos(turn) - upY * Math.sin(turn);
  const side = (access[0] - cx) * ux + (access[1] - cy) * uy > 0 ? 1 : -1;
  // Keep even the ends of long ledges and the outer wheel rut inside the reserved polygon.
  const edges: { nx: number; ny: number; limit: number }[] = [];
  for (let i = 0, j = outline.length - 2; i < outline.length; j = i, i += 2) {
    const nx = outline[i + 1] - outline[j + 1], ny = outline[j] - outline[i];
    edges.push({ nx, ny, limit: (outline[i] - cx) * nx + (outline[i + 1] - cy) * ny });
  }
  const within = (x: number, y: number, z: number) => {
    let fraction = 1;
    for (const { nx, ny, limit } of edges) {
      const distance = x * nx + y * ny;
      if (distance > limit && distance > 0) fraction = Math.min(fraction, limit / distance);
    }
    return [cx + x * fraction, cy + y * fraction, z];
  };
  const at = (across: number, forward: number, height: number) => {
    const x = ux * across * side + uy * forward, y = uy * across * side - ux * forward;
    const stretch = (site.L - site.w) / 2 * (x * site.ux + y * site.uy);
    return within(radius * x + stretch * site.ux, radius * y + stretch * site.uy, height * radius);
  };

  // A high wall can wind across the site or break into two separate cuts. Each cut
  // has its own crest, number of lifts and bench widths, with the ends grading down.
  function cut(left: number, right: number, key: number): void {
    const roll = (salt: number) => hash(kx, ky, B.set.seed, salt, key);
    const spans = 2 + Math.floor((right - left) * (1.3 + 2 * roll(14800)));
    const relief = 0.28 + 0.43 * roll(14801);
    const lifts = Math.min(1 + Math.floor(3 * roll(14802)),
      Math.max(1, Math.floor(B.cam.size(radius * relief) / LOD.quarryLift.mm)));
    const bend = 0.10 + 0.44 * roll(14803), deepest = 0.25 + 0.5 * roll(14804);
    const y0 = -0.55 + 0.18 * roll(14805), bench = 0.17 + 0.23 * roll(14806);
    const profiles: number[][][] = [];
    for (let i = 0; i <= spans; i++) {
      const t = (i + (i > 0 && i < spans ? (roll(14810 + i) - 0.5) * 0.50 : 0)) / spans;
      const x = left + (right - left) * t;
      const y = y0 + Math.abs(t - deepest) * bend + (roll(14820 + i) - 0.5) * 0.18;
      const h = relief * (0.34 + 0.66 * Math.sin(Math.PI * t)) * (0.8 + 0.40 * roll(14830 + i));
      const profile = [at(x, y - 0.12, 0), at(x, y, h)];
      const depth = bench * (0.75 + 0.45 * roll(14840 + i));
      for (let lift = 1; lift <= lifts; lift++) {
        const z = h * (1 - lift / lifts);
        profile.push(at(x, y + depth * (lift - 0.6) / lifts, z));
        if (lift < lifts) profile.push(at(x, y + depth * lift / lifts, z));
      }
      profiles.push(profile);
    }
    for (let i = 1; i < profiles.length; i++) {
      const a = profiles[i - 1], b = profiles[i];
      for (let j = 1; j < a.length; j++) s.faces.push([[...a[j - 1], ...b[j - 1], ...b[j], ...a[j]]]);
      const width = Math.hypot(b[1][0] - a[1][0], b[1][1] - a[1][1]);
      if (shows(B.cam, LOD.quarryJoint, Math.min(width, a[1][2] - a[2][2]))) {
        const onFace = (along: number, down: number) => a[1].map((v, k) => {
          const crest = v + along * (b[1][k] - v);
          const foot = a[2][k] + along * (b[2][k] - a[2][k]);
          return crest + down * (foot - crest);
        });
        const start = 0.25 + 0.5 * roll(14850 + i), lean = 0.45 * (roll(14860 + i) - 0.5);
        s.lines.push({ pen: LINEWORK, pts: [...onFace(start, 0), ...onFace(start + lean, 0.62), ...onFace(start + lean / 2, 0.92)] });
      }
    }
    for (let j = 0; j < profiles[0].length; j++)
      s.lines.push({ pen: LINEWORK, pts: profiles.flatMap(p => p[j]) });
    for (const [i, p] of profiles.entries()) {
      const end = i === 0 || i === profiles.length - 1;
      if (end) {
        s.faces.push([p.flat()]);
        s.lines.push({ pen: LINEWORK, pts: p.flat(), closed: true });
      } else {
        s.lines.push({ pen: LINEWORK, pts: p.slice(0, 3).flat() });
        for (let j = 3; j < p.length; j += 2) s.lines.push({ pen: LINEWORK, pts: [...p[j], ...p[j + 1]] });
      }
    }
  }
  const left = -0.81 + 0.17 * pick(14870), right = 0.40 + 0.29 * pick(14871);
  if (pick(14872) < 0.32) {
    const split = -0.23 + 0.32 * pick(14873);
    cut(left, split - 0.09, 0);
    cut(split + 0.09, right, 1);
  } else cut(left, right, 0);
  s.shade = s.faces.slice();

  // Distribute spoil along the open side, leaving a clear route into the yard.
  const piles = Math.floor(3.7 * pick(14874));
  for (let i = 0; i < piles; i++) {
    const roll = (salt: number) => hash(kx, ky, B.set.seed, salt, i);
    const x = -0.62 + (i + 0.3 + 0.4 * roll(14875)) / piles;
    const y = 0.34 + 0.25 * roll(14876), width = Math.min(0.42 / piles, 0.13 + 0.14 * roll(14877));
    const depth = width * (0.50 + 0.44 * roll(14878));
    const count = 4 + Math.floor(3 * roll(14879)), toe: number[][] = [];
    for (let j = 0; j < count; j++) {
      const a = 2 * Math.PI * (j + 0.52 * roll(14880 + j)) / count;
      toe.push(at(x + width * Math.cos(a), y + depth * Math.sin(a), 0));
    }
    const peak = at(x + width * (roll(14887) - 0.5), y, width * (0.45 + 0.6 * roll(14888)));
    for (let j = 0; j < count; j++) {
      s.faces.push([[...toe[j], ...toe[(j + 1) % count], ...peak]]);
      if (j % 2 === 0) s.lines.push({ pen: LINEWORK, pts: [...toe[j], ...peak] });
    }
    s.lines.push({ pen: LINEWORK, pts: toe.flat(), closed: true });
  }
  if (shows(B.cam, LOD.ruts, radius * 0.13)) {
    const lane = [at(0.48, 0.08, 0), at(0.72, 0.06, 0)];
    const dx = access[0] - cx, dy = access[1] - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      // Stop at the edge of the reserved site. Leave the crest intact when the road passes behind it.
      const end = [cx + dx * radius / dist, cy + dy * radius / dist, 0];
      if ((dx * ux + dy * uy) * side / dist > 0.55) lane.push(end);
    }
    for (const offset of [-0.065, 0.065]) {
      const pts = lane.flatMap((p, i) => {
        const a = lane[Math.max(0, i - 1)], b = lane[Math.min(lane.length - 1, i + 1)];
        const k = offset * radius / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
        return within(p[0] - cx - (b[1] - a[1]) * k, p[1] - cy + (b[0] - a[0]) * k, 0);
      });
      s.lines.push({ pen: LINEWORK, pts });
    }
  }
  return s;
}

/** Stepped quarry workings and the contours of mapped pits. */
export function quarries(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const pits = town.landuse.filter((a) => a.cls === 'quarry');
  const workings = pits.flatMap(a => a.quarryAccess ? [quarryWorking(B, a.shape[0].pts, a.quarryAccess)] : []);
  if (!pits.length) return { solids: [], draw: () => {} };
  const test: Test = (x, y, d) => !paper.on(M.road, x, y) && !paper.on(M.foot, x, y) && !paper.on(M.water, x, y) && paper.seen(x, y, d);
  return {
    solids: workings,
    draw: () => {
      for (const a of pits) {
        if (a.quarryAccess) continue;
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

/** An image-town fountain with a basin aligned to the square and jets scaled to its width. */
function imageFountain(B: Build, s: Solid, r: Rect, radius: number, water: { pen: number; pts: number[] }[]): void {
  const [kx, ky] = B.key(r.cx, r.cy);
  const pick = (salt: number) => hash(kx, ky, B.set.seed, salt);
  const sides = pick(14736) < 0.45 ? 6 + 2 * Math.floor(2 * pick(14737)) : 24;
  const breadth = radius * (0.65 + 0.35 * pick(14738));
  const rim: number[][] = [], inner: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = i * 2 * Math.PI / sides, dx = Math.cos(a), dy = Math.sin(a);
    rim.push([radius * dx, breadth * dy]);
    const u = (radius - 0.35) * dx, v = (breadth - 0.35) * dy;
    inner.push(r.cx + r.ux * u - r.uy * v, r.cy + r.uy * u + r.ux * v, 0.55);
  }
  const basin = place(r.cx, r.cy, r.ux, r.uy, rim);
  slab(B, s, basin, 0, 0.55);
  s.casts.push({ ring: basin, h: 0.55 });
  water.push({ pen: WATER, pts: [...inner, ...inner.slice(0, 3)] });
  const height = 1.1 + 0.32 * breadth, jets = 3 + Math.floor(4 * pick(14739));
  const bowl = pick(14742) < 0.5;
  if (bowl) {
    cylinder(B, s, r.cx, r.cy, 0.25, 0.55, height);
    cylinder(B, s, r.cx, r.cy, breadth * 0.28, height, height + 0.2);
  }
  for (let i = 0; i < jets; i++) {
    const a = i * 2 * Math.PI / jets;
    const pts: number[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const start = bowl ? 0.28 * breadth : 0;
      const dx = Math.cos(a) * (start * (1 - t) + 0.65 * radius * t);
      const dy = Math.sin(a) * (start * (1 - t) + 0.65 * breadth * t);
      const z = 0.55 + (bowl ? height - 0.35 : 0) * (1 - t) + 4 * t * (1 - t) * height * (bowl ? 0.24 : 0.85);
      pts.push(r.cx + r.ux * dx - r.uy * dy, r.cy + r.uy * dx + r.ux * dy, z);
    }
    water.push({ pen: WATER, pts });
  }
}

/** A fountain or a statue in the middle of each town square big enough to hold one. */
export function squares(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const solids: Solid[] = [];
  const lines: { pen: number; pts: number[] }[] = [];
  if (!shows(B.cam, LOD.fountain)) return { solids, draw: () => {} };
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
      if (B.set.source === 'image') {
        imageFountain(B, s, r, R, lines);
        solids.push(s);
        continue;
      }
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
  if (!shows(B.cam, LOD.busStop)) return { solids, draw: () => {} };
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
    // In an abandoned town the shelter loses its roof, then its panels; the sign stands.
    const worn = B.set.abandon > 0 ? stepsGone(B, 'canopies', x, y, 2, 10044) : 0;
    const s = newSolid();
    const P = (a: number, c: number, z: number) => [x + r.ux * a + nx * c, y + r.uy * a + ny * c, z];
    const back = [P(-1.8, 0.7, 0.1), P(1.8, 0.7, 0.1), P(1.8, 0.7, 2.3), P(-1.8, 0.7, 2.3)];
    if (worn < 2) {
      s.faces.push([back.flat()]);
      s.lines.push({ pen: LINEWORK, pts: back.flat(), closed: true });
      for (const a of [-1.8, 1.8]) {
        const side = [P(a, 0.7, 0.1), P(a, -0.2, 0.1), P(a, -0.2, 2.3), P(a, 0.7, 2.3)];
        s.faces.push([side.flat()]);
        s.lines.push({ pen: LINEWORK, pts: side.flat(), closed: true });
      }
    }
    if (worn < 1) slab(B, s, place(x, y, r.ux, r.uy, rect(-2, 2, -0.4, 0.9).map(([a, c]) => [a, c * 1])), 2.3, 2.45);
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
  if (!shows(B.cam, LOD.fuel)) return { solids, draw: () => {} };
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
    // Left to rot, the canopy comes down, and then its columns.
    const worn = B.set.abandon > 0 ? stepsGone(B, 'canopies', x, y, 2, 10044) : 0;
    const s = newSolid();
    if (worn < 1) slab(B, s, place(x, y, r.ux, r.uy, rect(-7, 7, -4.5, 4.5)), 4.6, 5.4, ROOFS);
    for (const [a, c] of [
      [-4.5, 0],
      [4.5, 0],
    ]) {
      const [cx, cy] = [x + r.ux * a - r.uy * c, y + r.uy * a + r.ux * c];
      if (worn < 2) s.lines.push({ pen: LINEWORK, pts: [cx, cy, 0, cx, cy, 4.6] });
      slab(B, s, place(cx, cy, r.ux, r.uy, rect(-0.4, 0.4, -1.6, 1.6)), 0, 0.2);
      slab(B, s, place(cx, cy, r.ux, r.uy, rect(-0.3, 0.3, -0.5, 0.5)), 0.2, 1.6);
    }
    if (worn < 1) s.casts.push({ ring: place(x, y, r.ux, r.uy, rect(-7, 7, -4.5, 4.5)), h: 5.2 });
    solids.push(s);
  }
  return { solids, draw: () => {} };
}

/** A tall chimney stack beside some of the big works. */
export function chimneys(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const solids: Solid[] = [];
  if (!shows(B.cam, LOD.stack) || !B.set.details) return { solids, draw: () => {} };
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
  if (!town.peaks.length || !shows(B.cam, LOD.summit)) return { solids: [], draw: () => {} };
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
        paper.fine(() => {
          for (const l of letter(`${Math.round(pk.ele)} M`, sx, sy, { h: 1.6 })) {
            const pts: number[] = [];
            for (let i = 0; i < l.length; i += 2) pts.push(l[i], l[i + 1], d);
            paper.sheet(LINEWORK, pts);
          }
        });
      }
    },
  };
}

// ---------------------------------------------------------------- People

/** A few people standing about on squares, pedestrian streets and beaches. */
export function people(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const { cam, set } = B;
  if (!shows(cam, LOD.person) || !set.life) return { solids: [], draw: () => {} };
  const spots: { pts: number[]; area: number; chance: number }[] = [];
  for (const sq of town.plazas) spots.push({ pts: sq[0].pts, area: Math.abs(ringArea(sq[0].pts)), chance: 0.1 });
  for (const c of town.cover) if (c.cls === 'beach') spots.push({ pts: c.shape[0].pts, area: Math.abs(ringArea(c.shape[0].pts)), chance: 0.05 });
  const figures: [number, number, number][] = [];
  for (const sp of spots) {
    if (sp.area < 150 || sp.area > 60000) continue;
    const { rect: r } = bestRect(sp.pts);
    if (!r) continue;
    grid(B, r, 4, 790, (x, y, h) => {
      if (h(0) > sp.chance || !pointInRing(x, y, sp.pts)) return;
      if (onMask(paper, M.foot, x, y) || onMask(paper, M.water, x, y)) return;
      figures.push([x, y, h(1)]);
    });
  }
  // Pedestrian streets.
  for (const w of town.ways) {
    if (w.kind !== 'path' || w.sub !== 'pedestrian') continue;
    walk(w.pts, 2, 3.5, 2, (x, y, ux, uy) => {
      const [k0, k1] = B.key(x, y);
      const h = (k: number) => hash(k0, k1, set.seed, 795 + k);
      if (h(0) > 0.15) return;
      const o = (h(1) - 0.5) * 3;
      const px = x - uy * o;
      const py = y + ux * o;
      if (!onMask(paper, M.foot, px, py)) figures.push([px, py, h(2)]);
    });
  }
  // People leave an abandoned town, street by street.
  const staying = set.abandon > 0 ? figures.filter(([x, y]) => !left(B, 'people', x, y, 9812)) : figures;
  return {
    solids: [],
    draw: (paper) => {
      for (const [x, y, v] of staying) figure(paper, x, y, v);
    },
  };
}

/** A standing figure at (x, y), its height varied by v in [0, 1): legs, body and a round head. Stride spreads the legs, for runners. */
export function figure(paper: Paper, x: number, y: number, v: number, stride = 0.14): void {
  const cam = paper.cam;
  const H = 1.55 + v * 0.3;
  const [dx, dy] = [cam.cb * stride, -cam.sb * stride];
  paper.line3(LINEWORK, [x - dx, y - dy, 0, x, y, H * 0.5, x + dx, y + dy, 0]);
  paper.line3(LINEWORK, [x, y, H * 0.5, x, y, H * 0.85]);
  const hx = cam.sx(x, y);
  const hy = cam.sy(x, y, H * 0.93);
  const d = cam.depth(x, y, H);
  const R = 0.11 * cam.s;
  const head: number[] = [];
  for (let q = 0; q <= 8; q++) head.push(hx + Math.cos((q / 8) * Math.PI * 2) * R, hy + Math.sin((q / 8) * Math.PI * 2) * R, d);
  paper.sheet(LINEWORK, head);
}

// ---------------------------------------------------------------- Fire stations and hospitals

/**
 * Fire engines on the apron in front of fire stations, and ambulances outside hospitals: on open
 * ground beside the building, facing the nearest road, where the map has the station or hospital.
 */
export function stations(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const solids: Solid[] = [];
  const { cam, set } = B;
  if (set.cars <= 0 || !shows(cam, LOD.car, 9)) return { solids, draw: () => {} };
  const placed: [number, number][] = [];
  /** The direction in which a mask lies nearest within r metres, or -1 if it doesn't. */
  const near = (mask: Uint8Array, x: number, y: number, r: number): number => {
    let best = -1;
    let bestD = Infinity;
    for (let q = 0; q < 16; q++) {
      const a = (q / 16) * Math.PI * 2;
      for (let d = 2; d <= r; d += 2) {
        if (!onMask(paper, mask, x + Math.cos(a) * d, y + Math.sin(a) * d)) continue;
        if (d < bestD) {
          bestD = d;
          best = a;
        }
        break;
      }
    }
    return best;
  };
  for (const p of town.pois) {
    const fire = p.cls === 'fire_station';
    if (!fire && p.cls !== 'hospital') continue;
    if (placed.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 80)) continue;
    const [k0, k1] = B.key(p.x, p.y);
    const h = (k: number) => hash(k0, k1, set.seed, 2500 + k);
    if (!fire && h(0) > 0.7) continue;
    const len = fire ? 9 : 6;
    if (!shows(cam, LOD.car, len, h(3))) continue;
    const fits = (x: number, y: number, ux: number, uy: number) => [-len / 2, 0, len / 2].every((t) => [-1.4, 1.4].every((e) => free(paper, M, x + ux * t - uy * e, y + uy * t + ux * e)));
    let spot: [number, number, number, number] | null = null;
    search: for (let r = 6; r <= 45; r += 4)
      for (let q = 0; q < 12; q++) {
        const a = ((q + h(1)) / 12) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const y = p.y + Math.sin(a) * r;
        if (!free(paper, M, x, y) || near(M.foot, x, y, 10) < 0) continue;
        const road = near(M.road, x, y, 14);
        if (road < 0 || !fits(x, y, Math.cos(road), Math.sin(road))) continue;
        spot = [x, y, Math.cos(road), Math.sin(road)];
        break search;
      }
    if (!spot) continue;
    const [x, y, ux, uy] = spot;
    placed.push([p.x, p.y]);
    solids.push(emergency(B, x, y, ux, uy, fire));
    // Often a second one beside it.
    const ox = x - uy * 3.6;
    const oy = y + ux * 3.6;
    if (h(2) < 0.5 && fits(ox, oy, ux, uy)) solids.push(emergency(B, ox, oy, ux, uy, fire));
  }
  return { solids, draw: () => {} };
}
