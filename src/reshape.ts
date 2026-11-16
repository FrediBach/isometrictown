import type { Build, Solid } from './buildings';
import { CLIMATES, MEDIAN } from './future';
import { onMask } from './infra';
import { LOD, shows, showsAt } from './lod';
import type { Masks, Tree } from './nature';
import type { Paper } from './raster';
import { hash } from './rng';
import { GREENERY, LINEWORK } from './settings';
import { outline, walk } from './streets';
import { urbanity } from './traffic';
import type { Shape, Town, Way } from './tiles';
import { bicycle } from './vehicles';

/*
 * Solarpunk at depth Transform and beyond reshapes the town before it is drawn
 * (docs/solarpunk/bolder-plan.md §3): residential streets narrow to one shared lane between
 * planted strips, and main roads are rebuilt as boulevards with a planted median, a planted
 * buffer and a kerb-protected cycle track each side. Routes, buildings and water never move;
 * only how a carriageway is shared out changes, so masks, kerbs, traffic and markings all
 * follow by themselves. Every decision is made from a way's own geometry and its neighbours'
 * centre lines, so it is the same from every view.
 */

/** One side of a reshaped street between two junctions: its centre line and what stands across it. */
export type Run = {
  /** The way's centre line from where the strip starts to where it ends, flat [x, y, …]. */
  pts: number[];
  /** +1 for the left of the way's direction, -1 for the right. */
  side: 1 | -1;
  /** Offsets from the centre line, metres: the planted strip from `a` to `b`, the cycle track (boulevards) from `b` to `c`. */
  a: number;
  b: number;
  c?: number;
  /** A garden street's strip, which carries a row of trees. */
  garden: boolean;
};

/** What reshaping made, for the drawing passes that read it. */
export type Reshaped = { town: Town; strips: Shape[]; runs: Run[] };

/** Width of a garden street's one shared lane. */
const LANE = 3.6;
/** One traffic lane of a boulevard. */
const BOULEVARD_LANE = 3.1;
/** A boulevard's planted buffer between lanes and cycle track, and the track itself. */
const BUFFER = 0.9;
const TRACK = 1.8;
/** How far strips stop short of a crossing road's edge, so corners stay paved for turning and crossing. */
const CLEAR = 6;
/** Shortest strip worth planting, metres. */
const MIN_RUN = 8;
/** A street is reshaped only if at least this share of its length gets strips. */
const MIN_SHARE = 0.3;
/** Grid for looking up nearby centre lines, metres. */
const GRID = 24;

/** Main roads that become boulevards, and side streets that become garden streets. */
const BOULEVARD = new Set(['primary', 'secondary']);
const GARDEN = new Set(['minor', 'service']);

/**
 * Narrow the streets of a solarpunk town and record the planted strips they give up. Returns a
 * shallow copy of `town` with reshaped ways swapped for copies (`was` keeps the old width), so
 * the map data itself is never changed.
 */
export function reshapeTown(town: Town, B: Build): Reshaped {
  const urban = urbanity(town, B.toAbs);
  // Neighbours come from the 250 m context, not only the ways in view, so a street near the
  // edge finds the same junctions from every view.
  const roads = town.nearby.ways.filter((w) => (w.kind === 'road' || w.kind === 'rail') && !w.bridge);
  const index = new Map<string, [number, number][]>();
  roads.forEach((w, wi) => {
    const p = w.pts;
    const r = reach(w);
    for (let i = 0; i + 3 < p.length; i += 2) {
      for (let a = Math.floor((Math.min(p[i], p[i + 2]) - r) / GRID); a <= Math.floor((Math.max(p[i], p[i + 2]) + r) / GRID); a++)
        for (let b = Math.floor((Math.min(p[i + 1], p[i + 3]) - r) / GRID); b <= Math.floor((Math.max(p[i + 1], p[i + 3]) + r) / GRID); b++) {
          const k = `${a},${b}`;
          const list = index.get(k);
          if (list) list.push([wi, i]);
          else index.set(k, [[wi, i]]);
        }
    }
  });
  // Way ends by map position, to tell a road cut at a tile edge (two ends meet) from a junction.
  const key = (x: number, y: number) => B.key(x, y).join();
  const degree = new Map<string, number>();
  const at = new Map<string, Way[]>();
  for (const w of roads) {
    for (const k of [key(w.pts[0], w.pts[1]), key(w.pts[w.pts.length - 2], w.pts[w.pts.length - 1])]) {
      if (w.kind === 'road') degree.set(k, (degree.get(k) ?? 0) + 1);
      const list = at.get(k);
      if (list) list.push(w);
      else at.set(k, [w]);
    }
  }
  const ends = (w: Way) => [key(w.pts[0], w.pts[1]), key(w.pts[w.pts.length - 2], w.pts[w.pts.length - 1])];
  /** Two pieces of one road meeting end to end with nothing else there: the strip runs on. */
  const continues = (a: Way, b: Way) => {
    if (a.kind !== b.kind || a.cls !== b.cls) return false;
    const [b0, b1] = ends(b);
    return ends(a).some((k) => (k === b0 || k === b1) && degree.get(k) === 2);
  };
  /** Whether a point on way w is too near another road or railway for a strip. */
  const crowded = (w: Way, x: number, y: number) => {
    const list = index.get(`${Math.floor(x / GRID)},${Math.floor(y / GRID)}`);
    if (!list) return false;
    for (const [oi, i] of list) {
      const o = roads[oi];
      if (o === w || continues(w, o)) continue;
      const p = o.pts;
      const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
      const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2));
      if (Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y) < reach(o)) return true;
    }
    return false;
  };

  const strips: Shape[] = [];
  const runs: Run[] = [];
  const ways = town.ways.map((w) => {
    const kind = streetKind(w, urban);
    if (!kind) return w;
    const hw = w.width / 2;
    const garden = kind === 'garden';
    const inner = garden ? LANE / 2 : (w.oneway ? BOULEVARD_LANE : BOULEVARD_LANE + MEDIAN);
    const outer = garden ? hw : inner + BUFFER;
    if (outer - inner < 0.8) return w;
    // Walk the centre line a metre at a time, marking where the street is free of crossings.
    const p = w.pts;
    const free: [number, number][] = [];
    let total = 0;
    let start = -1;
    let s = 0;
    const [e0, e1] = ends(w);
    const open0 = (at.get(e0) ?? []).some((o) => o !== w && continues(w, o));
    const open1 = (at.get(e1) ?? []).some((o) => o !== w && continues(w, o));
    let L = 0;
    for (let i = 0; i + 3 < p.length; i += 2) L += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    walk(p, 0, 1, 0, (x, y) => {
      // Dead ends keep a little paving; ends that run on into the next piece of the street don't.
      const edge = (s < 2 && !open0) || (s > L - 2 && !open1);
      const ok = !edge && !crowded(w, x, y);
      if (ok && start < 0) start = s;
      if (!ok && start >= 0) {
        if (s - 1 - start >= MIN_RUN) free.push([start, s - 1]);
        start = -1;
      }
      s++;
    });
    if (start >= 0 && Math.min(L, s - 1) - start >= MIN_RUN) free.push([start, Math.min(L, s - 1)]);
    for (const [a, b] of free) total += b - a;
    if (!L || total / L < MIN_SHARE) return w;
    for (const [a, b] of free) {
      // Where a run reaches the end of the way and the street runs on, the strip runs on too: no cap.
      const capA = !(a < 0.5 && open0);
      const capB = !(b > L - 1.5 && open1);
      const line = sub(p, a, b > L - 1.5 ? L : b);
      for (const side of [1, -1] as const) {
        strips.push(strip(line, side, inner, outer, capA, capB));
        runs.push({ pts: line, side, a: inner, b: outer, c: garden ? undefined : outer + TRACK, garden });
      }
    }
    const width = garden ? LANE : inner * 2;
    return { ...w, width, was: w.width, future: kind };
  });
  return { town: { ...town, ways }, strips, runs };
}

/** How far from a road's centre line other streets' strips keep. */
function reach(w: Way): number {
  return (w.kind === 'rail' ? 2 : w.width / 2) + CLEAR;
}

/** Whether a street is rebuilt, and how. */
function streetKind(w: Way, urban: (x: number, y: number) => number): Way['future'] {
  if (w.kind !== 'road' || w.bridge || w.was !== undefined) return undefined;
  const p = w.pts;
  const mid = Math.floor(p.length / 4) * 2;
  const u = urban(p[mid], p[mid + 1]);
  if (BOULEVARD.has(w.cls) && w.width >= 12 && u > 0.15) return 'boulevard';
  if (GARDEN.has(w.cls) && w.service !== 'parking_aisle' && w.service !== 'driveway' && w.width >= 7 && u > 0.3) return 'garden';
  return undefined;
}

/** The part of a polyline from distance a to distance b along it. */
function sub(p: number[], a: number, b: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const l = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (l < 1e-6) continue;
    const t0 = Math.max(a, acc);
    const t1 = Math.min(b, acc + l);
    if (t1 > t0) {
      const ux = (p[i + 2] - p[i]) / l;
      const uy = (p[i + 3] - p[i + 1]) / l;
      if (!out.length) out.push(p[i] + ux * (t0 - acc), p[i + 1] + uy * (t0 - acc));
      out.push(p[i] + ux * (t1 - acc), p[i + 1] + uy * (t1 - acc));
    }
    acc += l;
  }
  return out;
}

/** A polyline moved sideways by o metres along its left normal, mitred at the bends. */
export function offset(p: number[], o: number): number[] {
  const n = p.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let nx = 0;
    let ny = 0;
    for (const j of [i - 1, i]) {
      if (j < 0 || j + 1 >= n) continue;
      const dx = p[j * 2 + 2] - p[j * 2];
      const dy = p[j * 2 + 3] - p[j * 2 + 1];
      const l = Math.hypot(dx, dy) || 1;
      nx += -dy / l;
      ny += dx / l;
    }
    const l = Math.hypot(nx, ny) || 1;
    // The mitre lengthens the offset at a bend, up to twice, so the edges stay parallel.
    const cos = n > 2 && i > 0 && i < n - 1 ? l / 2 : 1;
    const k = o / Math.max(0.5, cos);
    out.push(p[i * 2] + (nx / l) * k, p[i * 2 + 1] + (ny / l) * k);
  }
  return out;
}

/** A strip between offsets a and b on one side of a line, as a counter-clockwise ring; its edge along the road is never drawn, nor caps where it runs on. */
function strip(line: number[], side: 1 | -1, a: number, b: number, capA: boolean, capB: boolean): Shape {
  const inner = offset(line, side * a);
  const outer = offset(line, side * b);
  const n = inner.length / 2;
  const pts = [...inner];
  for (let i = n - 1; i >= 0; i--) pts.push(outer[i * 2], outer[i * 2 + 1]);
  // Edges in order: along the road (n - 1), the far cap, the outer edge (n - 1), the near cap.
  const seam = new Uint8Array(2 * n);
  for (let i = 0; i < n - 1; i++) seam[i] = 1;
  seam[n - 1] = capB ? 0 : 1;
  seam[2 * n - 1] = capA ? 0 : 1;
  // Counter-clockwise: the left side runs that way already, the right side is reversed.
  if (side === 1) return [{ pts, seam }];
  const m = pts.length / 2;
  const rev: number[] = [];
  const rseam = new Uint8Array(m);
  for (let i = m - 1; i >= 0; i--) rev.push(pts[i * 2], pts[i * 2 + 1]);
  // Edge i of the reversed ring is edge m - 2 - i of the original (the closing edge maps to itself).
  for (let i = 0; i < m; i++) rseam[i] = seam[(2 * m - 2 - i) % m];
  return [{ pts: rev, seam: rseam }];
}

/** Rows of street trees down the middle of garden-street strips, young and mature mixed, spaced as the climate allows. */
export function stripTrees(B: Build, paper: Paper, R: Reshaped, M: Masks): Tree[] {
  const out: Tree[] = [];
  if (B.set.trees <= 0 || !B.future) return out;
  const C = CLIMATES[B.future.climate];
  const spacing = Math.max(8, Math.min(22, 13.5 / C.streetTrees));
  for (const r of R.runs) {
    if (!r.garden) continue;
    const mid = offset(r.pts, r.side * (r.a + r.b) / 2);
    // The two sides of a street alternate, so the crowns don't pair up across the lane.
    walk(mid, r.side > 0 ? 3 : 3 + spacing / 2, spacing, 3, (x, y) => {
      if (onMask(paper, M.road, x, y) || onMask(paper, M.water, x, y) || onMask(paper, M.foot, x, y)) return;
      const [k0, k1] = B.key(x, y);
      if (hash(k0, k1, B.set.seed, 12300) >= 0.85 * Math.min(1, B.set.trees / 0.7)) return;
      const v = hash(k0, k1, B.set.seed, 12301);
      const young = hash(k0, k1, B.set.seed, 12302) < 0.35;
      const rr = young ? 1.1 + v * 0.4 : 1.8 + v * 0.7;
      out.push({ x, y, r: rr, h: young ? rr + 2.3 : rr + 3.4 + hash(k0, k1, B.set.seed, 12303) * 1.6, conifer: false });
    });
  }
  return out;
}

/** The planted strips' low planting: the park hatch, kept to the strips. */
export function stripGrass(paper: Paper, M: Masks, R: Reshaped, paths?: Uint8Array): void {
  const cam = paper.cam;
  if (!R.strips.length || !shows(cam, LOD.gardenStrip)) return;
  const clear = (x: number, y: number) => paper.on(M.strip, x, y) && !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && !paper.on(M.foot, x, y) && !paper.on(M.shadow, x, y) && paper.seen(x, y, cam.groundDepth(y));
  // Twice as dense as park grass: a strip is narrow, and should read as planted at a glance.
  paper.facet('strip-planting', () => paper.hatchGround(GREENERY, 63, cam.gap(0.9), (x, y) => !(paths && paper.on(paths, x, y)) && clear(x, y)));
  paper.facet('strip-edges', () => outline(paper, GREENERY, R.strips, M.strip, (x, y) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y)));
}

/**
 * Boulevard cycle tracks: the kerb on the pavement side, a dashed line between the two
 * directions, and riders on it. Made with the other extras; the lines are ground marks.
 */
export function cycleTracks(B: Build, paper: Paper, R: Reshaped, M: Masks): { solids: Solid[]; draw: (paper: Paper) => void } {
  const solids: Solid[] = [];
  const tracks = R.runs.filter((r) => r.c !== undefined);
  if (!tracks.length || !shows(B.cam, LOD.cycleTrack)) return { solids, draw: () => {} };
  for (const r of tracks) {
    if (!B.set.cars || !B.set.life) break;
    const mid = offset(r.pts, r.side * (r.b + r.c!) / 2);
    walk(mid, 4, 11, 4, (x, y, ux, uy) => {
      const [k0, k1] = B.key(x, y);
      if (hash(k0, k1, B.set.seed, 12310) >= 0.22 * Math.min(1, B.set.cars / 0.35)) return;
      if (!showsAt(B.cam, LOD.cycle, 1.8, [k0, k1], B.set.seed, 9210)) return;
      if (onMask(paper, M.road, x, y) || onMask(paper, M.foot, x, y)) return;
      // Riders keep to the right of their half, by the way the road runs on that side.
      const dir = (hash(k0, k1, B.set.seed, 12311) < 0.5 ? 1 : -1) * (B.left ? -1 : 1);
      const o = dir * 0.45;
      solids.push(bicycle(B, x - uy * o, y + ux * o, ux * dir, uy * dir, hash(k0, k1, B.set.seed, 12312) < 0.2));
    });
  }
  const draw = (paper: Paper) => {
    const test = (x: number, y: number, d: number) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && !paper.on(M.foot, x, y) && paper.seen(x, y, d);
    for (const r of tracks) {
      const edge = offset(r.pts, r.side * r.c!);
      paper.line3(LINEWORK, edge.flatMap((v, i) => (i % 2 ? [v, 0] : [v])), test);
      const mid = offset(r.pts, r.side * (r.b + r.c!) / 2);
      walk(mid, 1, 3.5, 1, (x, y, ux, uy) => {
        paper.line3(LINEWORK, [x, y, 0, x + ux * 1.4, y + uy * 1.4, 0], test);
      });
    }
  };
  return { solids, draw };
}
