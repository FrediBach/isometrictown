import { newSolid, type Build, type Solid } from './buildings';
import { measure, at, place, rect, slab } from './infra';
import type { Masks } from './nature';
import type { Paper } from './raster';
import { hash } from './rng';
import { LINEWORK } from './settings';
import type { Town, Way } from './tiles';

/*
 * A few trains on the railways in view. Rail pieces are joined into continuous tracks, sorted by
 * what runs on them (main line, yard, tram, metro, narrow gauge, funicular), and each kind gets a
 * small budget, so a station throat with twenty tracks still gets one or two trains, not twenty.
 * Where there's a platform, one passenger train stands at it. What runs, how long it is and which
 * way it heads all come from the seed and the track's position, so the same view gives the same trains.
 */

/** Regions where main lines mostly run under overhead wires. */
const ELECTRIC = new Set(['alpine', 'dutch', 'central', 'nordic', 'british', 'french', 'mediterranean', 'eastern', 'eastAsian']);
const YARD = new Set(['yard', 'siding', 'spur']);
/** Trains per kind of track: a sheet with plenty of main line gets an extra one. */
const BUDGET: Record<Family, number> = { main: 1, yard: 1, tram: 2, metro: 1, narrow: 1, funicular: 1 };
/** How far apart two trains must stand, centre to centre, in metres. */
const APART = 70;

type Family = 'main' | 'yard' | 'tram' | 'metro' | 'narrow' | 'funicular';
type Track = { pts: number[]; cum: Float64Array; L: number; family: Family; bridge: boolean };
type CarKind = 'loco' | 'diesel' | 'cab' | 'coach' | 'tram' | 'metro' | 'box' | 'tank' | 'flat' | 'stack' | 'gondola' | 'funicular';
type Car = { kind: CarKind; len: number };
/** Drawn in linework only, like the cars on the roads. */
type Train = { cars: Car[]; width: number; electric: boolean };

function family(w: Way): Family {
  if (w.sub === 'tram') return 'tram';
  if (w.sub === 'subway' || w.sub === 'light_rail') return 'metro';
  if (w.sub === 'funicular') return 'funicular';
  if (w.sub === 'narrow_gauge' || w.sub === 'preserved') return 'narrow';
  if (YARD.has(w.service ?? '')) return 'yard';
  return 'main';
}

/**
 * Join rail pieces end to end into longer tracks. At a switch the straightest way on wins, so a
 * track runs through a junction rather than turning off at it.
 */
function tracks(ways: Way[]): Track[] {
  const rails = ways.filter((w) => w.kind === 'rail' && w.pts.length >= 4);
  const key = (x: number, y: number) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
  const at = new Map<string, number[]>();
  rails.forEach((w, i) => {
    for (const k of [key(w.pts[0], w.pts[1]), key(w.pts[w.pts.length - 2], w.pts[w.pts.length - 1])]) {
      const list = at.get(k);
      if (list) list.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Uint8Array(rails.length);
  const out: Track[] = [];
  // Extend pts (flat x, y) from its last point, appending pieces that carry on in the same direction.
  const grow = (pts: number[], fam: Family) => {
    for (;;) {
      const n = pts.length;
      const [ex, ey] = [pts[n - 2], pts[n - 1]];
      const dx = ex - pts[n - 4];
      const dy = ey - pts[n - 3];
      const dl = Math.hypot(dx, dy) || 1;
      let best = -1;
      let bestCos = Math.cos((35 * Math.PI) / 180);
      let flip = false;
      for (const j of at.get(key(ex, ey)) ?? []) {
        if (used[j] || family(rails[j]) !== fam) continue;
        const p = rails[j].pts;
        const atStart = key(p[0], p[1]) === key(ex, ey);
        const [nx, ny] = atStart ? [p[2] - p[0], p[3] - p[1]] : [p[p.length - 4] - p[p.length - 2], p[p.length - 3] - p[p.length - 1]];
        const c = (nx * dx + ny * dy) / ((Math.hypot(nx, ny) || 1) * dl);
        if (c > bestCos) {
          bestCos = c;
          best = j;
          flip = !atStart;
        }
      }
      if (best < 0) return;
      used[best] = 1;
      const p = rails[best].pts;
      const q = flip ? reversed(p) : p;
      for (let i = 2; i < q.length; i++) pts.push(q[i]);
    }
  };
  rails.forEach((w, i) => {
    if (used[i]) return;
    used[i] = 1;
    const fam = family(w);
    const pts = [...w.pts];
    grow(pts, fam);
    const back = reversed(pts);
    grow(back, fam);
    const cum = measure(back);
    out.push({ pts: back, cum, L: cum[cum.length - 1], family: fam, bridge: !!w.bridge });
  });
  return out;
}

function reversed(p: number[]): number[] {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}

/** What runs on a track: a composition of cars. r gives stable random numbers. */
function compose(B: Build, fam: Family, r: (salt: number) => number, atPlatform: boolean): Train {
  const electric = ELECTRIC.has(B.style.id);
  const cars: Car[] = [];
  const n = (lo: number, hi: number, salt: number) => lo + Math.floor(r(salt) * (hi - lo + 1));
  if (fam === 'tram') {
    const k = n(3, 5, 3);
    for (let i = 0; i < k; i++) cars.push({ kind: 'tram', len: i === 0 || i === k - 1 ? 8.5 : 6.5 });
    return { cars, width: 2.4, electric: true };
  }
  if (fam === 'metro') {
    for (let i = n(4, 6, 3); i > 0; i--) cars.push({ kind: 'metro', len: 18 });
    return { cars, width: 2.8, electric: true };
  }
  if (fam === 'funicular') return { cars: [{ kind: 'funicular', len: 16 }], width: 2.6, electric: false };
  if (fam === 'narrow') {
    cars.push({ kind: electric ? 'loco' : 'diesel', len: 11 });
    for (let i = n(2, 4, 3); i > 0; i--) cars.push({ kind: 'coach', len: 14 });
    return { cars, width: 2.5, electric };
  }
  if (fam === 'yard') {
    // Wagons standing in the yard, waiting for a locomotive.
    for (let i = n(4, 10, 3); i > 0; i--) cars.push(wagon(B, r, 20 + i));
    return { cars, width: 2.9, electric };
  }
  const american = B.style.id === 'american';
  const pick = r(4);
  const freight = !atPlatform && pick < (american ? 0.65 : 0.3);
  if (freight) {
    const locos = american ? n(2, 3, 5) : 1;
    for (let i = 0; i < locos; i++) cars.push({ kind: electric ? 'loco' : 'diesel', len: american ? 22 : 19 });
    for (let i = n(8, american ? 30 : 18, 6); i > 0; i--) cars.push(wagon(B, r, 40 + i));
    return { cars, width: 2.9, electric };
  }
  if (pick < (american ? 0.85 : 0.65)) {
    // A regional multiple unit: cab cars at both ends, coaches between.
    const k = n(2, 5, 7);
    for (let i = 0; i < k; i++) cars.push({ kind: i === 0 || i === k - 1 ? 'cab' : 'coach', len: 24 });
    return { cars, width: 2.9, electric };
  }
  // An intercity: a locomotive and a long rake of coaches.
  cars.push({ kind: electric ? 'loco' : 'diesel', len: 19 });
  for (let i = n(5, 9, 8); i > 0; i--) cars.push({ kind: 'coach', len: 26.4 });
  return { cars, width: 2.9, electric };
}

function wagon(B: Build, r: (salt: number) => number, salt: number): Car {
  const v = r(salt);
  if (B.style.id === 'american' && v < 0.5) return { kind: 'stack', len: 21 };
  if (v < 0.3) return { kind: 'box', len: 16 };
  if (v < 0.5) return { kind: 'tank', len: 14 };
  if (v < 0.75) return { kind: 'flat', len: 19.5 };
  return { kind: 'gondola', len: 13 };
}

/** Is the wall from a to b (counter-clockwise ring) facing the viewer? */
function facing(B: Build, ax: number, ay: number, bx: number, by: number): boolean {
  const [ux, uy] = B.cam.up;
  return (by - ay) * ux - (bx - ax) * uy < 0;
}

/** Draw one car centred at x, y heading ux, uy. */
function drawCar(B: Build, s: Solid, car: Car, train: Train, x: number, y: number, ux: number, uy: number, front: boolean, back: boolean): void {
  const { cam } = B;
  const detail = cam.lod >= 0.5;
  const fine = cam.lod >= 0.9;
  const hw = train.width / 2;
  const h = car.len / 2;
  // Millimetres on paper per metre along the car: a car running away from the viewer is
  // foreshortened, and side details spaced in metres would crowd into a solid band.
  const along = Math.hypot(cam.sx(x + ux, y + uy) - cam.sx(x, y), cam.sy(x + ux, y + uy, 0) - cam.sy(x, y, 0));
  const spaced = (pitch: number) => Math.max(pitch, 1.4 / Math.max(along, 1e-3));
  const R = (a0: number, a1: number, b0: number, b1: number) => place(x, y, ux, uy, rect(a0, a1, b0, b1));
  const P = (a: number, b: number, z: number) => [x + ux * a - uy * b, y + uy * a + ux * b, z];
  const box = (a0: number, a1: number, w: number, z0: number, z1: number, pen = LINEWORK) => {
    const ring = R(a0, a1, -w, w);
    slab(B, s, ring, z0, z1, pen);
    return ring;
  };
  /** Lines along the visible long sides, at height z, between a0 and a1. */
  const sides = (fn: (side: number) => void) => {
    for (const side of [-1, 1]) {
      // The right side (b = -hw) runs forwards in the ring, the left side backwards.
      const [ax, ay] = P(side < 0 ? -h : h, side * hw, 0);
      const [bx, by] = P(side < 0 ? h : -h, side * hw, 0);
      if (facing(B, ax, ay, bx, by)) fn(side);
    }
  };
  const windowRow = (a0: number, a1: number, z0: number, z1: number, pitch: number, wide: number) => {
    if (!detail) return;
    sides((side) => {
      const n = Math.max(1, Math.floor((a1 - a0) / spaced(pitch)));
      if (along * (a1 - a0) < 1.5) return;
      const step = (a1 - a0) / n;
      for (let i = 0; i < n; i++) {
        const m = a0 + (i + 0.5) * step;
        if (!fine) {
          s.lines.push({ pen: LINEWORK, pts: [...P(m - wide / 2, side * hw, (z0 + z1) / 2), ...P(m + wide / 2, side * hw, (z0 + z1) / 2)] });
          continue;
        }
        s.lines.push({ pen: LINEWORK, pts: [...P(m - wide / 2, side * hw, z0), ...P(m + wide / 2, side * hw, z0), ...P(m + wide / 2, side * hw, z1), ...P(m - wide / 2, side * hw, z1)], closed: true });
      }
    });
  };
  const doors = (list: number[], z0: number, z1: number) => {
    if (!fine || along < 0.5) return;
    sides((side) => {
      for (const m of list) s.lines.push({ pen: LINEWORK, pts: [...P(m - 0.65, side * hw, z0), ...P(m - 0.65, side * hw, z1), ...P(m + 0.65, side * hw, z1), ...P(m + 0.65, side * hw, z0)] });
    });
  };
  const stripe = (z: number, a0 = -h, a1 = h) => {
    if (!fine) return;
    sides((side) => s.lines.push({ pen: LINEWORK, pts: [...P(a0 + 0.3, side * hw, z), ...P(a1 - 0.3, side * hw, z)] }));
  };
  const bogies = (z: number) => {
    if (!detail) return;
    for (const a of [-h + 2.6, h - 2.6]) box(a - 1.3, a + 1.3, hw - 0.4, 0.15, z);
  };
  const pantograph = (a: number, roof: number) => {
    if (!train.electric || cam.lod < 0.3) return;
    const top = 5.5;
    s.lines.push({ pen: LINEWORK, pts: [...P(a - 0.9, 0, roof), ...P(a, 0, top - 0.4), ...P(a + 0.9, 0, roof)] });
    s.lines.push({ pen: LINEWORK, pts: [...P(a, -0.8, top), ...P(a, 0.8, top)] });
    s.lines.push({ pen: LINEWORK, pts: [...P(a, 0, top - 0.4), ...P(a, 0, top)] });
  };
  const ribs = (a0: number, a1: number, z0: number, z1: number, pitch: number, pen = LINEWORK) => {
    if (!fine || spaced(pitch) > pitch * 2.5) return;
    const step = spaced(pitch);
    sides((side) => {
      for (let a = a0 + step; a < a1 - 0.2; a += step) s.lines.push({ pen, pts: [...P(a, side * hw, z0), ...P(a, side * hw, z1)] });
    });
  };
  let cast: number[] = [];
  let top = 4.1;
  switch (car.kind) {
    case 'loco':
    case 'diesel': {
      cast = box(-h, h, hw, 1.1, 4.1);
      bogies(1.1);
      // Cab windows at either end, louvres between.
      windowRow(-h + 0.6, -h + 2.2, 2.6, 3.4, 2, 1.0);
      windowRow(h - 2.2, h - 0.6, 2.6, 3.4, 2, 1.0);
      ribs(-h + 3.5, h - 3.5, 2.4, 3.6, 0.8);
      stripe(1.9);
      if (car.kind === 'loco') {
        pantograph(-h + 4, 4.1);
        pantograph(h - 4, 4.1);
      } else if (detail) box(-1.5, 1.5, hw - 0.6, 4.1, 4.5);
      break;
    }
    case 'cab':
    case 'coach': {
      // A cab car slopes down to a nose at its leading end.
      const nose = car.kind === 'cab' ? (front ? 1 : back ? -1 : 0) : 0;
      const a0 = nose < 0 ? -h + 2.4 : -h;
      const a1 = nose > 0 ? h - 2.4 : h;
      cast = box(a0, a1, hw, 1.1, 4.1);
      if (nose > 0) box(a1, h, hw, 1.1, 3.2);
      if (nose < 0) box(-h, a0, hw, 1.1, 3.2);
      bogies(1.1);
      windowRow(a0 + 2.2, a1 - 2.2, 2.3, 3.3, 2.3, 1.5);
      doors([a0 + 1.2, a1 - 1.2], 1.2, 3.5);
      stripe(1.8);
      if (car.kind === 'cab' && nose) pantograph(-nose * 3, 4.1);
      break;
    }
    case 'tram': {
      cast = box(-h, h, hw, 0.35, 3.4);
      windowRow(-h + 0.5, h - 0.5, 1.3, 2.8, 1.6, 1.25);
      stripe(1.0);
      if (front || back) {
        // The tram's ends: a raked windscreen line.
        const e = front ? h : -h;
        if (detail) s.lines.push({ pen: LINEWORK, pts: [...P(e, -hw, 1.4), ...P(e, hw, 1.4)] });
      } else if (detail) box(-1.6, 1.6, hw - 0.5, 3.4, 3.75); // roof gear; the overhead wire comes with the track
      top = 3.4;
      break;
    }
    case 'metro': {
      cast = box(-h, h, hw, 1.0, 3.7);
      bogies(1.0);
      windowRow(-h + 1, h - 1, 2.1, 3.0, 2.2, 1.3);
      doors([-h + 3.4, -1.9, 1.9, h - 3.4], 1.1, 3.2);
      stripe(1.6);
      top = 3.7;
      break;
    }
    case 'funicular': {
      // Stepped compartments, as if the car were built for a slope.
      cast = box(-h, h, hw, 0.6, 3.0);
      for (let i = 0; i < 4; i++) box(-h + i * 4, -h + i * 4 + 4, hw, 3.0, 3.3 + i * 0.5);
      windowRow(-h + 0.5, h - 0.5, 1.6, 2.7, 2, 1.4);
      stripe(1.2);
      top = 4.8;
      break;
    }
    case 'box': {
      cast = box(-h, h, hw, 1.1, 4.3);
      bogies(1.1);
      ribs(-h, h, 1.2, 4.2, 1.1);
      doors([0], 1.2, 3.9);
      top = 4.3;
      break;
    }
    case 'tank': {
      box(-h, h, hw - 0.3, 1.0, 1.3);
      bogies(1.0);
      tube(B, s, x, y, ux, uy, h - 0.8, 1.45, 2.75);
      cast = R(-h, h, -hw, hw);
      top = 4.2;
      break;
    }
    case 'flat':
    case 'stack': {
      cast = box(-h, h, hw, 1.0, 1.35);
      bogies(1.0);
      // One long container or two short ones, two high on American well cars.
      const z0 = car.kind === 'stack' ? 0.6 : 1.35;
      const levels = car.kind === 'stack' ? 2 : 1;
      const r = (salt: number) => hash(Math.round(x), Math.round(y), B.set.seed, salt);
      for (let l = 0; l < levels; l++) {
        const zb = z0 + l * 2.6;
        const split = l === 0 && car.kind === 'flat' && r(810) < 0.5;
        for (const [a0, a1] of split ? [[-h + 0.4, -0.15], [0.15, h - 0.4]] : [[-h + 0.4, h - 0.4]]) {
          box(a0, a1, hw - 0.1, zb, zb + 2.55);
          ribs(a0, a1, zb + 0.1, zb + 2.45, 0.9);
        }
        if (car.kind === 'flat' && r(812) < 0.25) break;
      }
      top = z0 + levels * 2.6;
      break;
    }
    case 'gondola': {
      cast = box(-h, h, hw, 1.1, 3.0);
      bogies(1.1);
      ribs(-h, h, 1.2, 2.9, 1.6);
      // The open top: an inner rim, with the load heaped inside.
      if (detail) {
        const inner = R(-h + 0.25, h - 0.25, -hw + 0.25, hw - 0.25);
        s.lines.push({ pen: LINEWORK, pts: [...inner.flatMap((v, i) => (i % 2 ? [v, 3.0] : [v]))], closed: true });
      }
      top = 3.0;
      break;
    }
  }
  s.casts.push({ ring: cast, h: top });
}

/** A horizontal hexagonal tube along the car: a tank barrel of radius r, its axis at height zc. */
function tube(B: Build, s: Solid, x: number, y: number, ux: number, uy: number, h: number, r: number, zc: number): void {
  const n = 6;
  const ring = (a: number) => {
    const pts: number[] = [];
    for (let k = 0; k < n; k++) {
      const t = ((k + 0.5) / n) * Math.PI * 2;
      const b = Math.cos(t) * r;
      pts.push(x + ux * a - uy * b, y + uy * a + ux * b, zc + Math.sin(t) * r);
    }
    return pts;
  };
  const p0 = ring(-h);
  const p1 = ring(h);
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const quad = [p0[k * 3], p0[k * 3 + 1], p0[k * 3 + 2], p1[k * 3], p1[k * 3 + 1], p1[k * 3 + 2], p1[j * 3], p1[j * 3 + 1], p1[j * 3 + 2], p0[j * 3], p0[j * 3 + 1], p0[j * 3 + 2]];
    s.faces.push([quad]);
    s.lines.push({ pen: LINEWORK, pts: [p0[k * 3], p0[k * 3 + 1], p0[k * 3 + 2], p1[k * 3], p1[k * 3 + 1], p1[k * 3 + 2]] });
  }
  for (const cap of [p0, p1]) {
    s.faces.push([cap]);
    s.lines.push({ pen: LINEWORK, pts: cap, closed: true });
  }
  void B;
}

/** Trains on the tracks in view: a few, sensibly spread, of kinds that suit each track. */
export function trains(B: Build, paper: Paper, town: Town, M: Masks): Solid[] {
  const { set, cam } = B;
  const out: Solid[] = [];
  if (!set.rails || !set.life || cam.lod < 0.25) return out;
  const all = tracks(town.ways);
  if (!all.length) return out;
  const visible = (x: number, y: number, bridge: boolean) => {
    const sx = cam.sx(x, y);
    const sy = cam.sy(x, y, 0);
    if (sx < paper.x0 + 2 || sx > paper.x1 - 2 || sy < paper.y0 + 2 || sy > paper.y1 - 2) return false;
    return !paper.on(M.foot, sx, sy) && (bridge || !paper.on(M.water, sx, sy));
  };
  const STEP = 4;
  // Each track's visible stretches, as [from, to] along it.
  const stretches = all.map((t) => {
    const runs: [number, number][] = [];
    let start = -1;
    for (let d = 0; d <= t.L; d += STEP) {
      const [x, y] = at(t.pts, t.cum, d);
      const ok = visible(x, y, t.bridge);
      if (ok && start < 0) start = d;
      if ((!ok || d + STEP > t.L) && start >= 0) {
        runs.push([start, ok ? d : d - STEP]);
        start = -1;
      }
    }
    return runs;
  });
  const shown = all.map((_, i) => stretches[i].reduce((a, [f, t]) => a + t - f, 0));
  const mainShown = all.reduce((a, t, i) => a + (t.family === 'main' ? shown[i] : 0), 0);
  const budget = { ...BUDGET, main: mainShown > 1500 ? 3 : mainShown > 700 ? 2 : 1 };
  const placed: [number, number][] = [];
  const stable = (t: Track) => {
    // Key a track by its middle, so the same track gets the same train from any view.
    const [mx, my] = at(t.pts, t.cum, t.L / 2);
    return B.key(Math.round(mx / 10) * 10, Math.round(my / 10) * 10);
  };

  /** Put a train on track i with its middle at d (or anywhere it fits); returns whether it went in. */
  const run = (i: number, mid: number | null, atPlatform: boolean): boolean => {
    const t = all[i];
    const [k0, k1] = stable(t);
    const r = (salt: number) => hash(k0, k1, set.seed, 700 + salt);
    const train = compose(B, t.family, r, atPlatform);
    const GAP = 0.9;
    const length = (cars: Car[]) => cars.reduce((a, c) => a + c.len + GAP, -GAP);
    // Shorten the train to the longest visible stretch if it doesn't fit.
    const room = Math.max(0, ...stretches[i].map(([f, to]) => to - f)) - 4;
    const minCars = train.cars[0].kind === 'cab' ? 2 : 1;
    while (train.cars.length > minCars && length(train.cars) > room) {
      // Take a car out of the middle, keeping the cab or locomotive ends.
      train.cars.splice(Math.floor(train.cars.length / 2), 1);
    }
    const L = length(train.cars);
    if (L > room) return false;
    let from: number;
    if (mid !== null) {
      const run = stretches[i].find(([f, to]) => mid - L / 2 >= f && mid + L / 2 <= to);
      if (!run) return false;
      from = mid - L / 2;
    } else {
      const fits = stretches[i].filter(([f, to]) => to - f >= L + 4);
      if (!fits.length) return false;
      const [f, to] = fits[Math.floor(r(90) * fits.length)];
      from = f + 2 + r(91) * (to - f - L - 4);
    }
    const [cx, cy] = at(t.pts, t.cum, from + L / 2);
    if (placed.some(([px, py]) => Math.hypot(px - cx, py - cy) < (atPlatform ? 25 : APART))) return false;
    placed.push([cx, cy]);
    // Which way it's heading along the track.
    const forward = r(92) < 0.5;
    let d = from;
    train.cars.forEach((car, ci) => {
      // Each car sits on a chord between its two bogies, so it follows curves.
      const a = Math.min(car.len / 2 - 2.5, car.len * 0.35);
      const mid = d + car.len / 2;
      const [ax, ay] = at(t.pts, t.cum, mid - a);
      const [bx, by] = at(t.pts, t.cum, mid + a);
      const l = Math.hypot(bx - ax, by - ay) || 1;
      let ux = (bx - ax) / l;
      let uy = (by - ay) / l;
      const lead = forward ? ci === train.cars.length - 1 : ci === 0;
      const tail = forward ? ci === 0 : ci === train.cars.length - 1;
      if (!forward) {
        ux = -ux;
        uy = -uy;
      }
      const s = newSolid();
      drawCar(B, s, car, train, (ax + bx) / 2, (ay + by) / 2, ux, uy, lead, tail);
      out.push(s);
      d += car.len + GAP;
    });
    return true;
  };

  // A passenger train standing at a platform, if there's one in view.
  const used = new Set<number>();
  const platforms = town.ways.filter((w) => w.kind === 'path' && w.sub === 'platform');
  const stops: { i: number; d: number; score: number }[] = [];
  for (const p of platforms) {
    const pc = measure(p.pts);
    const pl = pc[pc.length - 1];
    if (pl < 40) continue;
    const [px, py] = at(p.pts, pc, pl / 2);
    if (!visible(px, py, false)) continue;
    all.forEach((t, i) => {
      if (t.family !== 'main' && t.family !== 'narrow' && t.family !== 'metro') return;
      // The nearest point on the track to the platform's middle.
      let best = Infinity;
      let bestD = 0;
      for (let d = 0; d <= t.L; d += 2) {
        const [x, y] = at(t.pts, t.cum, d);
        const g = Math.hypot(x - px, y - py);
        if (g < best) {
          best = g;
          bestD = d;
        }
      }
      if (best < 6) {
        const [k0, k1] = B.key(Math.round(px), Math.round(py));
        stops.push({ i, d: bestD, score: hash(k0, k1, set.seed, 720 + i) });
      }
    });
  }
  stops.sort((a, b) => a.score - b.score);
  for (const s of stops) {
    const fam = all[s.i].family;
    if (budget[fam] <= 0 || used.has(s.i)) continue;
    if (run(s.i, s.d, true)) {
      used.add(s.i);
      budget[fam]--;
      break;
    }
  }

  // Then the rest of each kind's budget, favouring long visible tracks, with some randomness.
  const order = all
    .map((t, i) => {
      const [k0, k1] = stable(t);
      return { i, score: Math.min(1, shown[i] / 400) * 0.6 + hash(k0, k1, set.seed, 730) * 0.4 };
    })
    .filter(({ i }) => shown[i] > 30)
    .sort((a, b) => b.score - a.score);
  for (const { i } of order) {
    const fam = all[i].family;
    if (budget[fam] <= 0 || used.has(i)) continue;
    if (run(i, null, false)) {
      used.add(i);
      budget[fam]--;
    }
  }
  return out;
}
