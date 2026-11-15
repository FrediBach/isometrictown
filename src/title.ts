import { newSolid, type Build, type Line3, type Solid } from './buildings';
import { pointInRing, ringArea } from './geo';
import { letter, letterable, measure } from './lettering';
import { LOD, shows } from './lod';
import { LINEWORK, SHADOWS } from './settings';
import type { Building, Town } from './tiles';

/*
 * The cinematic title: the place name in giant block capitals standing on a long straight
 * street, as in film openings where the name rises between the buildings. The letters are the
 * margin's single-stroke capitals, thickened into bold strokes, merged into outlines and
 * extruded, so they hide and are hidden by the town like anything else that stands.
 */

/** The title's solids, its ground footprint for `M.foot`, and a test for the buildings it makes room by removing. */
export type Title = { solids: Solid[]; footprint: number[]; clearance: number[]; clears: (b: Building) => boolean };

/** How strongly each road class draws the title: wide main streets read best. */
const CLASS_WEIGHT: Record<string, number> = { motorway: 0.8, trunk: 1.05, primary: 1.2, secondary: 1.15, tertiary: 1.1, minor: 1, busway: 0.9, raceway: 0.7, service: 0.55 };
/** Spacing of the hatching on shaded faces, mm before `cam.tone()`. */
const SHADE_MM = 0.8;
/** Shortest straight run worth standing a title on, metres. */
const MIN_RUN = 30;

type Run = { ax: number; ay: number; bx: number; by: number; len: number; cls: string };

/** The place name or the text given, kept to the characters the lettering has. */
export function titleText(text: string, place: string): string {
  const raw = (text.trim() || place).replace(/\s+/g, ' ');
  return [...raw].filter((c) => c === ' ' || letterable(c)).join('').trim();
}

/**
 * Glyph outlines for a line of text, in grid units with y up from the baseline (6 is the cap
 * height): the strokes are thickened to `weight` units, rasterised, and their boundary traced
 * and straightened. Returns shapes as rings, outer ring counter-clockwise first, then holes.
 */
export function blockLetters(text: string, weight: number, spacing: number, round: boolean): { shapes: number[][][]; x0: number; x1: number; y0: number; y1: number } {
  const hw = weight / 2;
  // Each glyph grows by the weight, so the tracking takes it back out and adds the spacing asked for.
  const track = spacing + weight - 1.6;
  const width = measure(text, 6, track);
  const strokes = letter(text, -width / 2, 0, { h: 6, track }).map((s) => s.map((v, i) => (i % 2 ? -v : v)));
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const s of strokes) {
    for (let i = 0; i < s.length; i += 2) {
      bx0 = Math.min(bx0, s[i] - hw);
      bx1 = Math.max(bx1, s[i] + hw);
      by0 = Math.min(by0, s[i + 1] - hw);
      by1 = Math.max(by1, s[i + 1] + hw);
    }
  }
  if (!strokes.length) return { shapes: [], x0: 0, x1: 0, y0: 0, y1: 0 };
  // Pixels per grid unit: fine enough for crisp diagonals, capped so long names stay quick.
  const R = Math.max(6, Math.min(32, Math.sqrt(2e6 / ((bx1 - bx0 + 2) * (by1 - by0 + 2)))));
  const ox = bx0 - 1;
  const oy = by0 - 1;
  const W = Math.ceil((bx1 - bx0 + 2) * R);
  const H = Math.ceil((by1 - by0 + 2) * R);
  const grid = new Uint8Array(W * H);
  /** Fill the pixels whose centres pass a test, within a box in grid units. */
  const paint = (x0: number, y0: number, x1: number, y1: number, inside: (x: number, y: number) => boolean) => {
    const i0 = Math.max(0, Math.floor((x0 - ox) * R));
    const i1 = Math.min(W - 1, Math.ceil((x1 - ox) * R));
    const j0 = Math.max(0, Math.floor((y0 - oy) * R));
    const j1 = Math.min(H - 1, Math.ceil((y1 - oy) * R));
    for (let j = j0; j <= j1; j++) {
      const y = oy + (j + 0.5) / R;
      for (let i = i0; i <= i1; i++) if (inside(ox + (i + 0.5) / R, y)) grid[j * W + i] = 1;
    }
  };
  /** Whether a stroke's end lands on another stroke (the A's crossbar on its legs): such an end gets no square cap, which would poke out past a slanting stroke. */
  const joined = (si: number, x: number, y: number, own: number): boolean => {
    for (let sj = 0; sj < strokes.length; sj++) {
      const t = strokes[sj];
      for (let k = 0; k + 3 < t.length; k += 2) {
        if (sj === si && k / 2 === own) continue;
        const [ax, ay, bx, by] = [t[k], t[k + 1], t[k + 2], t[k + 3]];
        const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const u = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2)) : 0;
        if (Math.hypot(ax + (bx - ax) * u - x, ay + (by - ay) * u - y) < 0.15) return true;
      }
    }
    return false;
  };
  strokes.forEach((s, si) => {
    const n = s.length / 2;
    const closed = n > 2 && Math.hypot(s[0] - s[s.length - 2], s[1] - s[s.length - 1]) < 1e-6;
    if (n === 1 || (n === 2 && s[0] === s[2] && s[1] === s[3])) {
      paint(s[0] - hw, s[1] - hw, s[0] + hw, s[1] + hw, (x, y) => (round ? Math.hypot(x - s[0], y - s[1]) <= hw : Math.abs(x - s[0]) <= hw && Math.abs(y - s[1]) <= hw));
      return;
    }
    const cap0 = !round && !closed && !joined(si, s[0], s[1], 0);
    const cap1 = !round && !closed && !joined(si, s[s.length - 2], s[s.length - 1], n - 2);
    for (let k = 0; k + 1 < n; k++) {
      const [ax, ay, bx, by] = [s[k * 2], s[k * 2 + 1], s[k * 2 + 2], s[k * 2 + 3]];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 1e-9) continue;
      const dx = (bx - ax) / L;
      const dy = (by - ay) / L;
      // Square letters get square ends where a stroke starts or stops freely; an end on another
      // stroke stops at its centre line, buried. Joints are mitred below. Elsewhere the stroke runs
      // on a pixel or so, so no hairline crack opens along the seam with the mitre, where pixel
      // centres on the shared edge would fail both tests.
      const seam = 1.5 / R;
      const e0 = round ? 0 : k === 0 && !closed ? (cap0 ? hw : seam) : seam;
      const e1 = round ? 0 : k === n - 2 && !closed ? (cap1 ? hw : seam) : seam;
      paint(Math.min(ax, bx) - hw, Math.min(ay, by) - hw, Math.max(ax, bx) + hw, Math.max(ay, by) + hw, (x, y) => {
        const t = (x - ax) * dx + (y - ay) * dy;
        if (round) {
          const c = Math.max(0, Math.min(L, t));
          return Math.hypot(x - ax - dx * c, y - ay - dy * c) <= hw;
        }
        return t >= -e0 && t <= L + e1 && Math.abs((y - ay) * dx - (x - ax) * dy) <= hw;
      });
    }
    if (round) return;
    // Mitre each joint: the wedge between the two strokes' outer edges, cut off as a bevel when it gets long.
    for (let k = closed ? 0 : 1; k < n - 1; k++) {
      const p = k === 0 ? n - 2 : k - 1;
      const [vx, vy] = [s[k * 2], s[k * 2 + 1]];
      const [px, py, qx, qy] = [s[p * 2], s[p * 2 + 1], s[k * 2 + 2], s[k * 2 + 3]];
      const l1 = Math.hypot(vx - px, vy - py);
      const l2 = Math.hypot(qx - vx, qy - vy);
      if (l1 < 1e-9 || l2 < 1e-9) continue;
      const [d1x, d1y, d2x, d2y] = [(vx - px) / l1, (vy - py) / l1, (qx - vx) / l2, (qy - vy) / l2];
      const cross = d1x * d2y - d1y * d2x;
      if (Math.abs(cross) < 1e-6) continue;
      // The outer side is right of a left turn and left of a right turn.
      const side = cross > 0 ? -1 : 1;
      const n1x = -d1y * side * hw;
      const n1y = d1x * side * hw;
      const n2x = -d2y * side * hw;
      const n2y = d2x * side * hw;
      const ring = [vx, vy, vx + n1x, vy + n1y];
      const mx = n1x + n2x;
      const my = n1y + n2y;
      const ml = Math.hypot(mx, my);
      const cosHalf = ml / (2 * hw);
      if (cosHalf > 0.5) {
        const reach = hw / cosHalf;
        ring.push(vx + (mx / ml) * reach, vy + (my / ml) * reach);
      }
      ring.push(vx + n2x, vy + n2y);
      const xs = ring.filter((_, i) => i % 2 === 0);
      const ys = ring.filter((_, i) => i % 2 === 1);
      paint(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), (x, y) => pointInRing(x, y, ring));
    }
  });
  const loops = trace(grid, W, H).map((l) => {
    const pts = simplify(l, 1.1);
    for (let i = 0; i < pts.length; i += 2) {
      pts[i] = ox + pts[i] / R;
      pts[i + 1] = oy + pts[i + 1] / R;
    }
    return pts;
  });
  const minArea = (weight * weight) / 8;
  const outer = loops.filter((p) => p.length >= 6 && ringArea(p) > minArea);
  const holes = loops.filter((p) => p.length >= 6 && ringArea(p) < -minArea * 0.25);
  const shapes = outer.map((p) => [p]);
  for (const h of holes) {
    let best = -1;
    let bestArea = Infinity;
    outer.forEach((p, i) => {
      const a = ringArea(p);
      if (a < bestArea && pointInRing(h[0], h[1], p)) {
        best = i;
        bestArea = a;
      }
    });
    if (best >= 0) shapes[best].push(h);
  }
  return { shapes, x0: bx0, x1: bx1, y0: by0, y1: by1 };
}

/**
 * The boundaries of the filled pixels as closed loops, in pixel units with y up the grid:
 * outer edges counter-clockwise, holes clockwise. Each loop is the midpoints of its pixel
 * edges, which takes the worst of the staircase off diagonals.
 */
function trace(grid: Uint8Array, W: number, H: number): number[][] {
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && grid[j * W + i] === 1;
  const V = W + 1;
  // Directed edges keyed by start vertex; a vertex where two loops pinch has two.
  const next = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = y0 * V + x0;
    const list = next.get(k);
    if (list) list.push(y1 * V + x1);
    else next.set(k, [y1 * V + x1]);
  };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!at(i, j)) continue;
      if (!at(i, j - 1)) add(i, j, i + 1, j);
      if (!at(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!at(i, j + 1)) add(i + 1, j + 1, i, j + 1);
      if (!at(i - 1, j)) add(i, j + 1, i, j);
    }
  }
  const loops: number[][] = [];
  for (const [start, ends] of next) {
    while (ends.length) {
      const verts: number[] = [start];
      let prev = start;
      let cur = ends.pop()!;
      while (cur !== start) {
        verts.push(cur);
        const outs = next.get(cur);
        if (!outs || !outs.length) break;
        let pick = 0;
        if (outs.length > 1) {
          // At a pinch, turn left, keeping each loop tight round its own pixels.
          const dx = (cur % V) - (prev % V);
          const dy = Math.floor(cur / V) - Math.floor(prev / V);
          pick = outs.findIndex((o) => (o % V) - (cur % V) === -dy && Math.floor(o / V) - Math.floor(cur / V) === dx);
          if (pick < 0) pick = 0;
        }
        prev = cur;
        cur = outs.splice(pick, 1)[0];
      }
      if (verts.length < 4) continue;
      const pts: number[] = [];
      for (let k = 0; k < verts.length; k++) {
        const a = verts[k];
        const b = verts[(k + 1) % verts.length];
        pts.push(((a % V) + (b % V)) / 2, (Math.floor(a / V) + Math.floor(b / V)) / 2);
      }
      loops.push(pts);
    }
  }
  return loops;
}

/** A closed loop with points closer than `eps` to the line through their neighbours taken out (Douglas–Peucker). */
function simplify(p: number[], eps: number): number[] {
  const n = p.length / 2;
  if (n < 4) return p;
  let far = 0;
  let best = -1;
  for (let i = 1; i < n; i++) {
    const d = (p[i * 2] - p[0]) ** 2 + (p[i * 2 + 1] - p[1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const bi = b % n;
    const [ax, ay, bx, by] = [p[a * 2], p[a * 2 + 1], p[bi * 2], p[bi * 2 + 1]];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    let dmax = -1;
    let m = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((p[i * 2] - ax) * (by - ay) - (p[i * 2 + 1] - ay) * (bx - ax)) / L;
      if (d > dmax) {
        dmax = d;
        m = i;
      }
    }
    if (m >= 0 && dmax > eps) {
      keep[m] = 1;
      stack.push([a, m], [m, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}

/** Road centre lines joined across the cuts where tiles split them, as long polylines with their class. */
function chains(town: Town): { pts: number[]; cls: string }[] {
  const roads = town.ways.filter((w) => w.kind === 'road' && w.pts.length >= 4 && w.cls in CLASS_WEIGHT);
  const used = new Uint8Array(roads.length);
  const ends = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  roads.forEach((w, i) => {
    const p = w.pts;
    for (const k of [key(p[0], p[1]), key(p[p.length - 2], p[p.length - 1])]) {
      const list = ends.get(k);
      if (list) list.push(i);
      else ends.set(k, [i]);
    }
  });
  const out: { pts: number[]; cls: string }[] = [];
  for (let i = 0; i < roads.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let pts = [...roads[i].pts];
    // Grow the chain at both ends while the next piece carries straight on.
    for (let pass = 0; pass < 2; pass++) {
      for (;;) {
        const n = pts.length;
        const [ex, ey, px, py] = [pts[n - 2], pts[n - 1], pts[n - 4], pts[n - 3]];
        const dl = Math.hypot(ex - px, ey - py) || 1;
        let found = -1;
        let flip = false;
        for (const j of ends.get(key(ex, ey)) ?? []) {
          if (used[j] || roads[j].cls !== roads[i].cls) continue;
          const q = roads[j].pts;
          const atStart = Math.hypot(q[0] - ex, q[1] - ey) < 1.5;
          const [sx, sy, tx, ty] = atStart ? [q[0], q[1], q[2], q[3]] : [q[q.length - 2], q[q.length - 1], q[q.length - 4], q[q.length - 3]];
          const ql = Math.hypot(tx - sx, ty - sy) || 1;
          if (((ex - px) * (tx - sx) + (ey - py) * (ty - sy)) / (dl * ql) < Math.cos((20 * Math.PI) / 180)) continue;
          found = j;
          flip = !atStart;
          break;
        }
        if (found < 0) break;
        used[found] = 1;
        const q = roads[found].pts;
        const seq: number[] = [];
        if (flip) for (let k = q.length - 4; k >= 0; k -= 2) seq.push(q[k], q[k + 1]);
        else for (let k = 2; k < q.length; k += 2) seq.push(q[k], q[k + 1]);
        pts.push(...seq);
      }
      const rev: number[] = [];
      for (let k = pts.length - 2; k >= 0; k -= 2) rev.push(pts[k], pts[k + 1]);
      pts = rev;
    }
    out.push({ pts, cls: roads[i].cls });
  }
  return out;
}

/** The longest stretches of a polyline that stay within a few metres of straight, longest first. */
function straightRuns(p: number[], cls: string): Run[] {
  const n = p.length / 2;
  const runs: Run[] = [];
  let i = 0;
  while (i < n - 1) {
    let j = i + 1;
    for (let k = i + 2; k < n; k++) {
      const [ax, ay, bx, by] = [p[i * 2], p[i * 2 + 1], p[k * 2], p[k * 2 + 1]];
      const L = Math.hypot(bx - ax, by - ay);
      const tol = Math.max(1.5, L * 0.015);
      let ok = L > 0;
      for (let m = i + 1; m < k && ok; m++) ok = Math.abs((p[m * 2] - ax) * (by - ay) - (p[m * 2 + 1] - ay) * (bx - ax)) / L <= tol;
      if (!ok) break;
      j = k;
    }
    const [ax, ay, bx, by] = [p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]];
    const len = Math.hypot(bx - ax, by - ay);
    if (len >= MIN_RUN) runs.push({ ax, ay, bx, by, len, cls });
    i = j;
  }
  return runs;
}

type Spot = { cx: number; cy: number; tx: number; ty: number; len: number };

/**
 * Where the title stands: the n-th best straight street run, judged by how much of the sheet
 * it crosses, how near the middle it is, how wide the street is and how built up its sides.
 */
function pickSpot(B: Build, town: Town, wordMm: number, aspect: number): Spot | null {
  const cam = B.cam;
  const [rx0, ry0, rx1, ry1] = cam.rect;
  const [mx, my] = [(rx0 + rx1) / 2, (ry0 + ry1) / 2];
  const half = Math.hypot(rx1 - rx0, ry1 - ry0) / 2;
  const right: [number, number] = [cam.cb, -cam.sb];
  // Building positions, for judging how built up a street's sides are.
  const bx: number[] = [];
  const by: number[] = [];
  for (const b of town.buildings) {
    bx.push(b.shape[0].pts[0]);
    by.push(b.shape[0].pts[1]);
  }
  const scored: (Spot & { score: number; gx0: number; gy0: number })[] = [];
  for (const c of chains(town)) {
    for (const r of straightRuns(c.pts, c.cls)) {
      // Clip the run to the drawing area on the sheet; it maps to the sheet as a straight line.
      const [sax, say, sbx, sby] = [cam.sx(r.ax, r.ay), cam.sy(r.ax, r.ay, 0), cam.sx(r.bx, r.by), cam.sy(r.bx, r.by, 0)];
      let t0 = 0;
      let t1 = 1;
      const dx = sbx - sax;
      const dy = sby - say;
      for (const [pp, q] of [[-dx, sax - rx0], [dx, rx1 - sax], [-dy, say - ry0], [dy, ry1 - say]] as const) {
        if (Math.abs(pp) < 1e-9) {
          if (q < 0) t1 = -1;
          continue;
        }
        const t = q / pp;
        if (pp < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
      if (t1 <= t0) continue;
      const onSheet = Math.hypot(dx, dy) * (t1 - t0);
      let tx = (r.bx - r.ax) / r.len;
      let ty = (r.by - r.ay) / r.len;
      if (tx * right[0] + ty * right[1] < 0) [tx, ty] = [-tx, -ty];
      const across = Math.abs(tx * right[0] + ty * right[1]);
      if (across < 0.2) continue;
      // Centre the word on the part in view, pulled towards the middle of the sheet as far as the run allows.
      const [gx0, gy0] = [r.ax + (r.bx - r.ax) * t0, r.ay + (r.by - r.ay) * t0];
      const [gx1, gy1] = [r.ax + (r.bx - r.ax) * t1, r.ay + (r.by - r.ay) * t1];
      const visLen = Math.hypot(gx1 - gx0, gy1 - gy0);
      const [hx, hy] = cam.ground(mx, my);
      const wordM = wordMm / (cam.s * across);
      const along = (hx - gx0) * ((gx1 - gx0) / visLen) + (hy - gy0) * ((gy1 - gy0) / visLen);
      const s = visLen > wordM ? Math.max(wordM / 2, Math.min(visLen - wordM / 2, along)) : visLen / 2;
      const cx = gx0 + ((gx1 - gx0) / visLen) * s;
      const cy = gy0 + ((gy1 - gy0) / visLen) * s;
      const off = Math.hypot(cam.sx(cx, cy) - mx, cam.sy(cx, cy, 0) - my) / half;
      const fit = Math.min(1, onSheet / wordMm);
      // Letters that would rise out of the top of the drawing lose their heads.
      const top = cam.sy(cx, cy, 0) - (wordMm * aspect * cam.ca) / across;
      const cut = top < ry0 ? 0.3 : 1;
      const score = fit * fit * across * across * (1.25 - Math.min(1, off)) * (CLASS_WEIGHT[r.cls] ?? 1) * cut;
      scored.push({ cx, cy, tx, ty, len: visLen, score, gx0: (gx0 + gx1) / 2, gy0: (gy0 + gy1) / 2 });
    }
  }
  // Built-up sides, for the front runners only: buildings within a block's depth of the run's middle part in view.
  scored.sort((a, b) => b.score - a.score);
  scored.length = Math.min(scored.length, 48);
  const reach = 45;
  for (const s of scored) {
    let near = 0;
    for (let k = 0; k < bx.length; k++) {
      const u = (bx[k] - s.gx0) * s.tx + (by[k] - s.gy0) * s.ty;
      const w = Math.abs((bx[k] - s.gx0) * s.ty - (by[k] - s.gy0) * s.tx);
      if (w < reach && Math.abs(u) < s.len / 2 + reach) near++;
    }
    s.score *= 0.55 + 0.45 * Math.min(1, near / Math.max(4, s.len / 12));
  }
  scored.sort((a, b) => b.score - a.score);
  // The n-th distinct street: runs of a dual carriageway or the same street again don't count twice.
  const picked: (typeof scored)[number][] = [];
  for (const s of scored) {
    if (picked.some((p) => Math.hypot(p.cx - s.cx, p.cy - s.cy) < 60 && Math.abs(p.tx * s.tx + p.ty * s.ty) > 0.95)) continue;
    picked.push(s);
    if (picked.length >= B.set.titleStreet) break;
  }
  return picked[Math.min(picked.length, Math.max(1, Math.round(B.set.titleStreet))) - 1] ?? null;
}

/** The cinematic title, if it is switched on and there is text to letter. */
export function title(B: Build, town: Town): Title | null {
  const { cam, set } = B;
  if (!set.title) return null;
  const text = titleText(set.titleText, set.place);
  if (!text) return null;
  const weight = set.titleWeight;
  const glyphs = blockLetters(text, weight, set.titleTrack, set.titleRound);
  if (!glyphs.shapes.length) return null;
  const units = glyphs.x1 - glyphs.x0;
  const wordMm = (cam.rect[2] - cam.rect[0]) * set.titleSize;
  const right: [number, number] = [cam.cb, -cam.sb];

  const [rx0, ry0, rx1, ry1] = cam.rect;
  const spot = set.titleFront ? null : pickSpot(B, town, wordMm, (glyphs.y1 - glyphs.y0) / units);
  // With no street to stand on, or when asked, the title faces the viewer square in the middle of the sheet.
  let [cx, cy] = spot ? [spot.cx, spot.cy] : cam.ground((rx0 + rx1) / 2, (ry0 + ry1) / 2);
  let [tx, ty] = spot ? [spot.tx, spot.ty] : right;
  const turn = (set.titleTurn * Math.PI) / 180;
  [tx, ty] = [tx * Math.cos(turn) + ty * Math.sin(turn), -tx * Math.sin(turn) + ty * Math.cos(turn)];
  // Keep it reading left to right.
  if (tx * right[0] + ty * right[1] < 0) [tx, ty] = [-tx, -ty];
  const across = Math.max(0.25, tx * right[0] + ty * right[1]);
  const m = wordMm / (cam.s * across) / units;
  const capH = 6 * m;
  // Keep the whole word inside the drawing, side to side, before any slide asked for.
  const k = cam.s * across * m;
  const pad = (rx1 - rx0) * 0.03;
  const sx = cam.sx(cx, cy);
  const lo = rx0 + pad - (sx + glyphs.x0 * k);
  const hi = rx1 - pad - (sx + glyphs.x1 * k);
  const fix = lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, 0));
  cx += (tx * fix) / (cam.s * across);
  cy += (ty * fix) / (cam.s * across);
  if (spot) {
    cx += tx * set.titleSlide * spot.len * 0.5;
    cy += ty * set.titleSlide * spot.len * 0.5;
  } else {
    // Facing the viewer, the slide moves the title back and forth instead.
    const [ux, uy] = cam.up;
    const back = (set.titleSlide * (ry1 - ry0)) / (2 * cam.s * cam.sa);
    cx += ux * back;
    cy += uy * back;
  }
  if (!shows(cam, LOD.title, capH)) return null;
  // The face towards the viewer is to the right of the reading direction.
  const nx = ty;
  const ny = -tx;
  const depth = Math.max(0.3, set.titleDepth * capH);
  const z0 = set.titleLift * capH - glyphs.y0 * m;
  const wx = (gx: number, gy: number, side: number): [number, number, number] => [cx + tx * gx * m + nx * side * depth * 0.5, cy + ty * gx * m + ny * side * depth * 0.5, z0 + gy * m];

  const toCam = [-cam.sb * cam.ca, -cam.cb * cam.ca, cam.sa];
  const sunH = (Math.max(5, set.sunHeight) * Math.PI) / 180;
  const sun3 = [B.sun[0] * Math.cos(sunH), B.sun[1] * Math.cos(sunH), Math.sin(sunH)];
  const shade = set.titleShade;
  const tone = cam.tone(SHADE_MM);
  /** Sheet length of a 3D segment, mm. */
  const sheetLen = (a: number[], b: number[]) => Math.hypot(cam.sx(a[0], a[1]) - cam.sx(b[0], b[1]), cam.sy(a[0], a[1], a[2]) - cam.sy(b[0], b[1], b[2]));

  const shadeFaces: number[][][] = [];
  const solid = { ...newSolid(), shade: shadeFaces };
  const lines: Line3[] = solid.lines;
  for (const shape of glyphs.shapes) {
    const front = shape.map((r) => ringAt(r, 1, wx));
    const back = shape.map((r) => ringAt(r, -1, wx));
    solid.faces.push(front, back);
    for (const r of front) lines.push({ pen: LINEWORK, pts: r, closed: true });
    for (const r of back) lines.push({ pen: LINEWORK, pts: r, closed: true });
    // The sides of every stroke, between the front and back outlines.
    shape.forEach((ring, ri) => {
      const n = ring.length / 2;
      const F = front[ri];
      const K = back[ri];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const h = (i + n - 1) % n;
        const a = [F[i * 3], F[i * 3 + 1], F[i * 3 + 2]];
        const b = [F[j * 3], F[j * 3 + 1], F[j * 3 + 2]];
        const ka = [K[i * 3], K[i * 3 + 1], K[i * 3 + 2]];
        const kb = [K[j * 3], K[j * 3 + 1], K[j * 3 + 2]];
        const side = [[...a, ...b, ...kb, ...ka]];
        solid.faces.push(side);
        // Outward normal of the edge in the glyph plane, carried into the world.
        const ex = ring[j * 2] - ring[i * 2];
        const ey = ring[j * 2 + 1] - ring[i * 2 + 1];
        const el = Math.hypot(ex, ey) || 1;
        const N = [(tx * ey) / el, (ty * ey) / el, -ex / el];
        const seen = N[0] * toCam[0] + N[1] * toCam[1] + N[2] * toCam[2] > 0;
        // An edge between front and back where the outline turns a corner, or where the side turns away from view.
        const px = ring[i * 2] - ring[h * 2];
        const py = ring[i * 2 + 1] - ring[h * 2 + 1];
        const pl = Math.hypot(px, py) || 1;
        const bend = (px * ex + py * ey) / (pl * el);
        const Np = [(tx * py) / pl, (ty * py) / pl, -px / pl];
        const seenPrev = Np[0] * toCam[0] + Np[1] * toCam[1] + Np[2] * toCam[2] > 0;
        if (bend < Math.cos((28 * Math.PI) / 180) || seen !== seenPrev) lines.push({ pen: LINEWORK, pts: [...a, ...ka] });
        if (!shade || !seen || N[0] * sun3[0] + N[1] * sun3[1] + N[2] * sun3[2] >= 0) continue;
        const cnt = Math.floor(sheetLen(a, b) / tone);
        for (let k = 1; k <= cnt; k++) {
          const t = k / (cnt + 1);
          const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          const q = [ka[0] + (kb[0] - ka[0]) * t, ka[1] + (kb[1] - ka[1]) * t, ka[2] + (kb[2] - ka[2]) * t];
          lines.push({ pen: SHADOWS, pts: [...p, ...q], on: side, facet: 'shade' });
        }
      }
    });
  }

  // The ground the letters stand on, along the street; buildings in it make way if asked.
  const g0 = glyphs.x0 * m;
  const g1 = glyphs.x1 * m;
  const room = 2;
  const corner = (u: number, w: number) => [cx + tx * u + nx * w, cy + ty * u + ny * w];
  const footprint = [...corner(g0, -depth / 2), ...corner(g1, -depth / 2), ...corner(g1, depth / 2), ...corner(g0, depth / 2)];
  // A little wider all round: overhead wires keep off this.
  const clear = 3;
  const clearance = [...corner(g0 - clear, -depth / 2 - clear), ...corner(g1 + clear, -depth / 2 - clear), ...corner(g1 + clear, depth / 2 + clear), ...corner(g0 - clear, depth / 2 + clear)];
  const clears = (b: Building): boolean => {
    if (!set.titleClear) return false;
    const p = b.shape[0].pts;
    let u0 = Infinity;
    let u1 = -Infinity;
    let w0 = Infinity;
    let w1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      const dx = p[i] - cx;
      const dy = p[i + 1] - cy;
      const u = dx * tx + dy * ty;
      const w = dx * nx + dy * ny;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      w0 = Math.min(w0, w);
      w1 = Math.max(w1, w);
    }
    return u1 > g0 - room && u0 < g1 + room && w1 > -depth / 2 - room && w0 < depth / 2 + room;
  };
  // Revealed, the letters slide towards the viewer along the line of sight: nothing moves on the
  // sheet, but buildings that stood in front of them fall behind. Shadows stay where they were.
  if (set.titleReveal > 0) {
    for (const f of solid.faces) shadeFaces.push(f.map((r) => r.slice()));
    const span = cam.groundDepth(ry0) - cam.groundDepth(ry1) + 400 * cam.sa;
    const D = set.titleReveal * span;
    const [vx, vy, vz] = [-cam.sb * cam.ca * D, -cam.cb * cam.ca * D, cam.sa * D];
    const moved = new Set<number[]>();
    const move = (r: number[]) => {
      if (moved.has(r)) return;
      moved.add(r);
      for (let i = 0; i < r.length; i += 3) {
        r[i] += vx;
        r[i + 1] += vy;
        r[i + 2] += vz;
      }
    };
    for (const f of solid.faces) f.forEach(move);
    for (const l of lines) move(l.pts);
  } else for (const f of solid.faces) shadeFaces.push(f);
  return { solids: [solid], footprint, clearance, clears };
}

/** A glyph ring in the plane of one face of the letters, as 3D triples. */
function ringAt(r: number[], side: number, wx: (gx: number, gy: number, side: number) => [number, number, number]): number[] {
  const out: number[] = [];
  for (let i = 0; i < r.length; i += 2) out.push(...wx(r[i], r[i + 1], side));
  return out;
}
