import type { Build, Solid } from './buildings';
import { LANE, soccerSize, tennisCourts, trackLanes, type Ground, type Pitch } from './ground';
import { at, measure, onMask, type Extra } from './infra';
import { LOD, shows, showsAt } from './lod';
import type { Masks } from './nature';
import type { Paper } from './raster';
import { hash } from './rng';
import { LINEWORK } from './settings';
import { figure } from './sites';
import type { Town, Way } from './tiles';
import { racer, racerLength, type Racer } from './vehicles';

/*
 * Sport going on: football teams at a match or training on their pitches, players on tennis and
 * basketball courts, runners on athletics tracks, and racing cars or karts lapping raceways.
 * Pitches come from the ground plan, so the players stand on the markings that are drawn.
 */

/** A figure in a pitch's frame: along, across, height variation, stride. */
type Player = [number, number, number, number];
/** A cone in a pitch's frame. */
type Cone = [number, number];

/** One team's 4-4-2, defending the goal at negative u, as fractions of the field's length and width. */
const FORMATION: [number, number][] = [
  [-0.33, -0.33],
  [-0.36, -0.12],
  [-0.36, 0.12],
  [-0.33, 0.33],
  [-0.14, -0.35],
  [-0.17, -0.12],
  [-0.17, 0.12],
  [-0.14, 0.35],
  [0.02, -0.12],
  [0.04, 0.14],
];

/** Players, coaches and runners on the pitches, courts and tracks the ground plan marked. */
export function players(B: Build, paper: Paper, G: Ground, M: Masks): Extra {
  const { cam, set } = B;
  const none: Extra = { solids: [], draw: () => {} };
  if (!set.life || !shows(cam, LOD.person) || !G.pitches.length) return none;
  const groups: { p: Pitch; players: Player[]; cones: Cone[] }[] = [];
  for (const p of G.pitches) {
    const [k0, k1] = B.key(p.rect.cx, p.rect.cy);
    const h = (k: number) => hash(k0, k1, set.seed, 2200 + k);
    const players: Player[] = [];
    const cones: Cone[] = [];
    const jit = (i: number, m: number): [number, number] => [(h(40 + i * 2) - 0.5) * m, (h(41 + i * 2) - 0.5) * m];
    if (p.sport === 'soccer' || p.sport === 'track') {
      const f = soccerSize(p);
      const u = h(0);
      if (f && u < 0.3 && p.sport === 'soccer') match(f, h, jit, players);
      else if (f && u < (p.sport === 'soccer' ? 0.6 : 0.25)) training(f, h, jit, players, cones);
      if (p.sport === 'track' && h(1) < 0.55) runners(p, h, players);
    } else if (p.sport === 'tennis') {
      tennisCourts(p.rect).forEach((c, i) => {
        const g = (k: number) => hash(k0, k1, set.seed, 2260 + i * 8 + k);
        if (g(0) > 0.55) return;
        const T = (a: number, b: number): [number, number] => (c.alongU ? [c.cu + a, c.cv + b] : [c.cu + b, c.cv + a]);
        const base = 11.885 * c.k + 0.8;
        if (g(1) < 0.7) {
          players.push([...T(-base, (g(2) - 0.5) * 6 * c.k), g(3), 0.2], [...T(base, (g(4) - 0.5) * 6 * c.k), g(5), 0.2]);
        } else {
          // Doubles: one up at the net and one back on each side.
          players.push([...T(-base, -2 * c.k), g(2), 0.2], [...T(-4 * c.k, 2.5 * c.k), g(3), 0.2], [...T(base, 2 * c.k), g(4), 0.2], [...T(4 * c.k, -2.5 * c.k), g(5), 0.2]);
        }
      });
    } else if (p.sport === 'basketball') {
      if (h(0) > 0.5) continue;
      const k = Math.min(1, (p.rect.L - 2) / 28, (p.rect.w - 2) / 15);
      const sk = h(1) < 0.5 ? 1 : -1;
      const n = 4 + Math.floor(h(2) * 3);
      for (let i = 0; i < n; i++) {
        const [a, b] = jit(i, 1);
        players.push([sk * (14 * k - 2 - (a + 0.5) * 6 * k), b * 10 * k, h(20 + i), 0.18]);
      }
    } else if (h(0) < 0.35) {
      // A kick-about on a small or multi-use pitch.
      const n = 3 + Math.floor(h(1) * 5);
      for (let i = 0; i < n; i++) {
        const [a, b] = jit(i, 1);
        players.push([a * (p.rect.L - 4), b * (p.rect.w - 4), h(20 + i), 0.18]);
      }
    }
    if (players.length) groups.push({ p, players, cones });
  }
  const coneTall = cam.size(0.4) > 0.7;
  return {
    solids: [],
    draw: () => {
      for (const { p, players, cones } of groups) {
        const { cx, cy, ux, uy } = p.rect;
        const W = (u: number, v: number): [number, number] => [cx + ux * u - uy * v, cy + uy * u + ux * v];
        for (const [u, v, var_, stride] of players) {
          const [x, y] = W(u, v);
          if (onMask(paper, M.foot, x, y) || onMask(paper, M.road, x, y)) continue;
          figure(paper, x, y, var_, stride);
        }
        if (!coneTall) continue;
        for (const [u, v] of cones) {
          const [x, y] = W(u, v);
          paper.line3(LINEWORK, [x - 0.15 * ux, y - 0.15 * uy, 0, x, y, 0.35, x + 0.15 * ux, y + 0.15 * uy, 0]);
        }
      }
    },
  };
}

type Hash = (k: number) => number;
type Jitter = (i: number, m: number) => [number, number];

/** Two teams in a 4-4-2 shifted towards the ball, keepers in goal, and a referee near the ball. */
function match([FL, FW]: [number, number], h: Hash, jit: Jitter, out: Player[]): void {
  const bu = (h(2) - 0.5) * FL * 0.6;
  const bv = (h(3) - 0.5) * FW * 0.6;
  for (const side of [-1, 1]) {
    out.push([side * (FL / 2 - 1.5), bv * 0.1, h(4 + side), 0.14]);
    FORMATION.forEach(([fu, fv], i) => {
      const [ju, jv] = jit(i + (side > 0 ? 10 : 0), 4);
      out.push([side * fu * FL + bu * 0.45 + ju, fv * FW + bv * 0.3 + jv, h(20 + i + (side > 0 ? 10 : 0)), 0.3]);
    });
  }
  out.push([bu + 6, bv - 5, h(6), 0.2]);
}

/** Training: a rondo, a shooting drill on one goal, a slalom through cones, and the coach. */
function training([FL, FW]: [number, number], h: Hash, jit: Jitter, out: Player[], cones: Cone[]): void {
  const end = h(2) < 0.5 ? 1 : -1;
  // Rondo: a ring of players passing round two in the middle.
  const ru = -end * FL * 0.22;
  const rv = (h(3) - 0.5) * FW * 0.3;
  const n = 6 + Math.floor(h(4) * 3);
  for (let i = 0; i < n; i++) {
    const a = ((i + h(5)) / n) * Math.PI * 2;
    out.push([ru + Math.cos(a) * 5.5, rv + Math.sin(a) * 5.5, h(20 + i), 0.14]);
  }
  out.push([ru - 1, rv + 0.8, h(30), 0.3], [ru + 1.2, rv - 0.6, h(31), 0.3]);
  // Shooting: the keeper in goal, a shooter on the spot, a queue at the edge of the box.
  const g = end * (FL / 2);
  out.push([g - end * 0.8, 0, h(32), 0.2], [g - end * 12, 1, h(33), 0.3]);
  for (let i = 0; i < 4; i++) out.push([g - end * (19 + i * 1.6), -2 + i * 0.3, h(34 + i), 0.14]);
  // Slalom: a row of cones out on the wing, two players weaving through.
  const sv = (h(6) < 0.5 ? 1 : -1) * FW * 0.32;
  for (let i = 0; i < 7; i++) cones.push([-6 + i * 3, sv + (i % 2 ? 0.8 : -0.8)]);
  out.push([-4.5, sv + 1.2, h(38), 0.3], [5, sv - 1.2, h(39), 0.3]);
  // The coach on the touchline, watching.
  const [cu] = jit(30, 20);
  out.push([cu, -Math.sign(sv) * (FW / 2 + 1.5), h(7), 0.14]);
}

/** Runners on the lanes: a race strung out round a bend, or a few training at their own pace. */
function runners(p: Pitch, h: Hash, out: Player[]): void {
  const t = trackLanes(p.rect);
  if (!t) return;
  const { R, S, lanes } = t;
  /** A point at distance d round lane i, counter-clockwise from the start of the home straight. */
  const lane = (i: number, d: number): [number, number] => {
    const r = R - (i + 0.5) * LANE;
    const P = 4 * S + 2 * Math.PI * r;
    let s = ((d % P) + P) % P;
    if (s < 2 * S) return [-S + s, -r];
    s -= 2 * S;
    if (s < Math.PI * r) {
      const a = -Math.PI / 2 + s / r;
      return [S + Math.cos(a) * r, Math.sin(a) * r];
    }
    s -= Math.PI * r;
    if (s < 2 * S) return [S - s, r];
    s -= 2 * S;
    const a = Math.PI / 2 + s / r;
    return [-S + Math.cos(a) * r, Math.sin(a) * r];
  };
  const race = h(8) < 0.5;
  const n = race ? lanes : 2 + Math.floor(h(9) * 4);
  const lead = h(10) * (4 * S + 2 * Math.PI * R);
  for (let i = 0; i < n; i++) {
    const li = race ? i : Math.floor(h(50 + i) * lanes);
    const d = race ? lead - h(50 + i) * 12 : h(60 + i) * (4 * S + 2 * Math.PI * R);
    out.push([...lane(li, d), h(70 + i), 0.38]);
  }
}

// ---------------------------------------------------------------- Racing

/** Racing on raceways: a strung-out field of single-seaters or GT cars, or karts on tight little tracks. */
export function racing(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const { cam, set } = B;
  const solids: Solid[] = [];
  const none: Extra = { solids, draw: () => {} };
  const ways = town.ways.filter((w) => w.kind === 'road' && w.cls === 'raceway');
  if (!set.life || !ways.length) return none;
  // Pieces joined end to end make one track; how tightly it winds says whether it's for karts.
  const parent = ways.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const ends = new Map<string, number>();
  ways.forEach((w, i) => {
    for (const k of [0, w.pts.length - 2]) {
      const key = `${Math.round(w.pts[k])},${Math.round(w.pts[k + 1])}`;
      const j = ends.get(key);
      if (j === undefined) ends.set(key, i);
      else parent[find(i)] = find(j);
    }
  });
  const length = new Map<number, number>();
  const turning = new Map<number, number>();
  for (let i = 0; i < ways.length; i++) {
    const [l, t] = bends(ways[i]);
    const c = find(i);
    length.set(c, (length.get(c) ?? 0) + l);
    turning.set(c, (turning.get(c) ?? 0) + t);
  }
  for (let i = 0; i < ways.length; i++) {
    const w = ways[i];
    const c = find(i);
    const L = length.get(c)!;
    const kart = L > 120 && L < 2500 && turning.get(c)! / L > 0.012;
    // Whether there's racing today, and in what, is decided for the whole circuit at once.
    // Cells of about 1.5 km in absolute map metres, so it doesn't change as the view pans.
    const [X, Y] = B.key(w.pts[0], w.pts[1]);
    const c0 = Math.round(X / 1500);
    const c1 = Math.round(Y / 1500);
    if (hash(c0, c1, set.seed, 2300) > 0.65) continue;
    const kind: Racer = kart ? 'kart' : hash(c0, c1, set.seed, 2301) < 0.5 ? 'formula' : 'gt';
    const len = racerLength(kind);
    const p = w.pts;
    const cum = measure(p);
    const total = cum[cum.length - 1];
    const mean = kart ? 20 : 90;
    const room = Math.max(0, w.width / 2 - 1.5);
    const [s0, s1] = B.key(p[0], p[1]);
    let t = hash(s0, s1, set.seed, 2302) * mean;
    for (let guard = 0; guard < 300 && t < total - len; guard++) {
      const [x0, y0, ux, uy] = at(p, cum, t + len / 2);
      const [ka, kb] = B.key(x0, y0);
      const o = (hash(ka, kb, set.seed, 2303) - 0.5) * 2 * room;
      const x = x0 - uy * o;
      const y = y0 + ux * o;
      if (onMask(paper, M.road, x, y) && !onMask(paper, M.foot, x, y) && showsAt(cam, LOD.car, len, [ka, kb], set.seed, 2304)) solids.push(racer(B, x, y, ux, uy, kind));
      // Bunched into little trains with long gaps between, as a field strings out.
      const close = hash(Math.round(ka / 120), Math.round(kb / 120), set.seed, 2305) < 0.5;
      t += len + (close ? (kart ? 3 : 6) + hash(ka, kb, set.seed, 2306) * (kart ? 6 : 14) : -Math.log(1 - hash(ka, kb, set.seed, 2307) * 0.999) * mean);
    }
  }
  return { solids, draw: () => {} };
}

/** A way's length and how much it turns along it, in radians. */
function bends(w: Way): [number, number] {
  const p = w.pts;
  let l = 0;
  let turn = 0;
  let prev = NaN;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2] - p[i];
    const dy = p[i + 3] - p[i + 1];
    const d = Math.hypot(dx, dy);
    if (d < 0.5) continue;
    l += d;
    const a = Math.atan2(dy, dx);
    if (!Number.isNaN(prev)) {
      let da = a - prev;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      turn += Math.abs(da);
    }
    prev = a;
  }
  return [l, turn];
}
