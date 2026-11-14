import { car, newSolid, prism, type Build, type Solid } from './buildings';
import { FIELD, GARDEN, MEADOW, type Ground } from './ground';
import { ringArea } from './geo';
import type { Masks, Tree } from './nature';
import type { Paper, Test } from './raster';
import { hash } from './rng';
import { GREENERY, LINEWORK } from './settings';
import { walk } from './streets';
import type { StyleId } from './styles';
import type { Building, Town, Way } from './tiles';

/**
 * Made-up garden and field boundaries, and street trees. The map rarely draws plots,
 * hedges or fences, so each house gets a plot of its own (the ground nearer to it than to
 * any other house, cut off at the street) and the plots are fenced the way the region does it.
 */

type Bound = 'hedge' | 'fence' | 'wall' | 'picket' | 'none';

/** What goes along the street and what goes between neighbours, by region. */
const BOUNDS: Record<StyleId, [Bound, Bound]> = {
  alpine: ['fence', 'fence'],
  dutch: ['hedge', 'hedge'],
  central: ['fence', 'hedge'],
  nordic: ['hedge', 'fence'],
  british: ['wall', 'hedge'],
  french: ['wall', 'hedge'],
  mediterranean: ['wall', 'wall'],
  eastern: ['fence', 'fence'],
  arid: ['wall', 'wall'],
  eastAsian: ['wall', 'wall'],
  tropical: ['wall', 'fence'],
  american: ['none', 'picket'],
  antipodean: ['fence', 'fence'],
  generic: ['fence', 'hedge'],
};

/** Chance that a field edge carries a hedgerow, by region. */
const HEDGEROWS: Record<StyleId, number> = {
  alpine: 0.3,
  dutch: 0.25,
  central: 0.55,
  nordic: 0.4,
  british: 0.85,
  french: 0.6,
  mediterranean: 0.3,
  eastern: 0.35,
  arid: 0,
  eastAsian: 0.1,
  tropical: 0.3,
  american: 0.25,
  antipodean: 0.35,
  generic: 0.45,
};

/** Chance that a main road is lined with trees, by region. */
const AVENUES: Record<StyleId, number> = {
  alpine: 0.2,
  dutch: 0.5,
  central: 0.5,
  nordic: 0.4,
  british: 0.35,
  french: 0.75,
  mediterranean: 0.4,
  eastern: 0.5,
  arid: 0.15,
  eastAsian: 0.3,
  tropical: 0.45,
  american: 0.45,
  antipodean: 0.45,
  generic: 0.35,
};

/** Half the side of the square a plot starts from before neighbours cut it down. */
const PLOT_R = 20;

type Cell = { pts: number[]; lab: number[] };

/** Keep the part of a cell where nx·x + ny·y ≤ d. Labels say which cut made each edge. */
function cut(c: Cell, nx: number, ny: number, d: number, label: number): Cell {
  const pts: number[] = [];
  const lab: number[] = [];
  const n = c.pts.length / 2;
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const ax = c.pts[k * 2];
    const ay = c.pts[k * 2 + 1];
    const bx = c.pts[j * 2];
    const by = c.pts[j * 2 + 1];
    const fa = nx * ax + ny * ay - d;
    const fb = nx * bx + ny * by - d;
    if (fa <= 0) {
      pts.push(ax, ay);
      lab.push(c.lab[k]);
    }
    if (fa <= 0 !== fb <= 0) {
      const t = fa / (fa - fb);
      pts.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      lab.push(fa <= 0 ? label : c.lab[k]);
    }
  }
  return { pts, lab };
}

const FRONT = -2;
const BOX = -1;

/** Plot boundaries round the houses in leafy residential areas: solids for hedges and walls, lines for fences. */
export function plots(B: Build, paper: Paper, town: Town, G: Ground, M: Masks): { solids: Solid[]; draw: () => void } {
  const { cam, style } = B;
  const solids: Solid[] = [];
  const fences: { pts: number[]; picket: boolean }[] = [];
  const marks: { pts: number[]; ground: boolean; closed?: boolean }[] = [];
  const done = { solids, draw: () => {} };
  if (!G.gardens || cam.lod < 0.5) return done;
  const [frontKind, sideKind] = BOUNDS[style.id];
  const garden = (x: number, y: number) => {
    const sx = cam.sx(x, y);
    const sy = cam.sy(x, y, 0);
    return paper.at(G.land, sx, sy) === GARDEN && !paper.on(M.road, sx, sy) && !paper.on(M.water, sx, sy) && !paper.on(M.foot, sx, sy) && !paper.on(M.green, sx, sy);
  };

  // Every house cuts its neighbours' plots, even off the sheet, so plots don't change as the
  // view moves; only those standing in gardens get boundaries drawn.
  type Site = { x: number; y: number; i: number; drawn: boolean };
  const sites: Site[] = [];
  town.buildings.forEach((b, i) => {
    if (b.info?.kind !== 'house') return;
    const p = b.shape[0].pts;
    let x = 0;
    let y = 0;
    for (let k = 0; k < p.length; k += 2) {
      x += p[k];
      y += p[k + 1];
    }
    x /= p.length / 2;
    y /= p.length / 2;
    sites.push({ x, y, i, drawn: paper.at(G.land, cam.sx(x, y), cam.sy(x, y, 0)) === GARDEN });
  });
  if (!sites.some((s) => s.drawn)) return done;

  // Neighbour lookup on a coarse grid.
  const CELL = PLOT_R * 2;
  const grid = new Map<string, number[]>();
  sites.forEach((s, k) => {
    const id = `${Math.floor(s.x / CELL)},${Math.floor(s.y / CELL)}`;
    (grid.get(id) ?? grid.set(id, []).get(id)!).push(k);
  });

  sites.forEach((s, k) => {
    if (!s.drawn) return;
    const b = town.buildings[s.i];
    const info = b.info!;
    let c: Cell = { pts: [s.x - PLOT_R, s.y - PLOT_R, s.x + PLOT_R, s.y - PLOT_R, s.x + PLOT_R, s.y + PLOT_R, s.x - PLOT_R, s.y + PLOT_R], lab: [BOX, BOX, BOX, BOX] };
    const gx = Math.floor(s.x / CELL);
    const gy = Math.floor(s.y / CELL);
    for (let ix = gx - 1; ix <= gx + 1; ix++)
      for (let iy = gy - 1; iy <= gy + 1; iy++)
        for (const j of grid.get(`${ix},${iy}`) ?? []) {
          if (j === k) continue;
          const o = sites[j];
          const nx = o.x - s.x;
          const ny = o.y - s.y;
          if (nx * nx + ny * ny > 4 * PLOT_R * PLOT_R) continue;
          c = cut(c, nx, ny, nx * (s.x + o.x) * 0.5 + ny * (s.y + o.y) * 0.5, j);
        }
    // The front boundary, set back a little from the street but always in front of the house.
    if (info.toStreet && info.streetGap !== undefined) {
      const [tx, ty] = info.toStreet;
      const p = b.shape[0].pts;
      let reach = 0;
      for (let q = 0; q < p.length; q += 2) reach = Math.max(reach, (p[q] - s.x) * tx + (p[q + 1] - s.y) * ty);
      const front = Math.max(reach + 1.5, info.streetGap - 1.6);
      c = cut(c, tx, ty, tx * s.x + ty * s.y + front, FRONT);
    }
    if (c.pts.length < 6 || Math.abs(ringArea(c.pts)) < 20) return;

    const n = c.pts.length / 2;
    for (let e = 0; e < n; e++) {
      const lab = c.lab[e];
      // Each shared edge once, from the lower-numbered side; the open box edges stay open.
      if (lab === BOX || (lab >= 0 && lab < k && sites[lab].drawn)) continue;
      const kind = lab === FRONT ? frontKind : sideKind;
      if (kind === 'none') continue;
      const f = (e + 1) % n;
      boundary(B, c.pts[e * 2], c.pts[e * 2 + 1], c.pts[f * 2], c.pts[f * 2 + 1], kind, garden, solids, fences);
    }
    yard(B, b, s.x, s.y, garden, solids, marks);
  });

  return {
    solids,
    draw: () => {
      for (const f of fences) {
        const [ax, ay, bx, by] = f.pts;
        const len = Math.hypot(bx - ax, by - ay);
        const ux = (bx - ax) / len;
        const uy = (by - ay) / len;
        paper.line3(LINEWORK, [ax, ay, f.picket ? 0.8 : 1.0, bx, by, f.picket ? 0.8 : 1.0]);
        const step = f.picket ? 1.8 : 2.4;
        const n = Math.max(1, Math.round(len / step));
        for (let k = 0; k <= n; k++) {
          const t = (k / n) * len;
          paper.line3(LINEWORK, [ax + ux * t, ay + uy * t, 0, ax + ux * t, ay + uy * t, f.picket ? 1.1 : 1.15]);
        }
      }
      const flat: Test = (x, y, d) => !paper.on(M.road, x, y) && !paper.on(M.foot, x, y) && paper.seen(x, y, d);
      for (const m of marks) paper.line3(LINEWORK, m.pts, m.ground ? flat : paper.seen, m.closed);
    },
  };
}

/** Regions where front gardens have a driveway, and where back gardens have trampolines. */
const DRIVES = new Set<StyleId>(['american', 'antipodean', 'british', 'nordic', 'central', 'generic']);
const TRAMPOLINES = new Set<StyleId>(['american', 'antipodean', 'british', 'nordic']);

/** A house's own bits of garden: a driveway with a car on it, a shed at the back, maybe a trampoline. */
function yard(B: Build, b: Building, cx: number, cy: number, ok: (x: number, y: number) => boolean, solids: Solid[], marks: { pts: number[]; ground: boolean; closed?: boolean }[]): void {
  const info = b.info!;
  if (!info.toStreet || !info.street || info.streetGap === undefined) return;
  const [tx, ty] = info.toStreet;
  const [sx, sy] = info.street;
  const p = b.shape[0].pts;
  let front = -Infinity;
  let back = Infinity;
  let left = Infinity;
  let right = -Infinity;
  for (let q = 0; q < p.length; q += 2) {
    const a = (p[q] - cx) * tx + (p[q + 1] - cy) * ty;
    const l = (p[q] - cx) * sx + (p[q + 1] - cy) * sy;
    front = Math.max(front, a);
    back = Math.min(back, a);
    left = Math.min(left, l);
    right = Math.max(right, l);
  }
  const [k0, k1] = B.key(cx, cy);
  const h = (k: number) => hash(k0, k1, B.set.seed, 800 + k);
  const P = (a: number, l: number): [number, number] => [cx + tx * a + sx * l, cy + ty * a + sy * l];

  if (DRIVES.has(B.style.id) && h(0) < 0.7) {
    const kerb = info.streetGap;
    const len = kerb - front;
    if (len >= 3 && len < 25) {
      const lane = h(1) < 0.5 ? left + 1.6 : right - 1.6;
      for (const d of [-1.4, 1.4]) {
        const [ax, ay] = P(front, lane + d);
        const [bx, by] = P(kerb, lane + d);
        marks.push({ pts: [ax, ay, 0, bx, by, 0], ground: true });
      }
      const [x, y] = P(front + 3, lane);
      if (len >= 6 && B.set.cars > 0 && h(2) < 0.55 && ok(x, y)) solids.push(car(B, x, y, tx, ty, h(3)));
    }
  }

  // A shed at the bottom of the garden.
  if (h(4) < 0.4) {
    const a = back - 4 - h(5) * 4;
    const l = left + (right - left) * h(6);
    const ring = [P(a - 1.0, l - 1.2), P(a + 1.0, l - 1.2), P(a + 1.0, l + 1.2), P(a - 1.0, l + 1.2)];
    if (ring.every(([x, y]) => ok(x, y))) {
      const pts = ring.flat();
      const s = newSolid();
      prism(B, [{ pts: ringArea(pts) < 0 ? ring.reverse().flat() : pts, seam: new Uint8Array(4) }], 0, 2.2, { roof: true, windows: false, pen: LINEWORK }, s);
      s.casts.push({ ring: pts, h: 2.2 });
      solids.push(s);
    }
  }

  // A trampoline on the lawn.
  if (TRAMPOLINES.has(B.style.id) && h(7) < 0.15) {
    const [x, y] = P(back - 5 - h(8) * 3, (left + right) / 2 + (h(9) - 0.5) * 6);
    const R = 1.8;
    if ([0, 1, 2, 3].every((q) => ok(x + Math.cos((q * Math.PI) / 2) * R, y + Math.sin((q * Math.PI) / 2) * R))) {
      const rim: number[] = [];
      for (let q = 0; q < 16; q++) rim.push(x + Math.cos((q / 16) * Math.PI * 2) * R, y + Math.sin((q / 16) * Math.PI * 2) * R, 0.9);
      marks.push({ pts: rim, ground: false, closed: true });
      for (let q = 0; q < 4; q++) {
        const ang = ((q + 0.5) / 4) * Math.PI * 2;
        marks.push({ pts: [x + Math.cos(ang) * R, y + Math.sin(ang) * R, 0, x + Math.cos(ang) * R, y + Math.sin(ang) * R, 0.9], ground: false });
      }
    }
  }
}

/** One boundary edge, cut into the runs that lie in gardens. */
function boundary(B: Build, ax: number, ay: number, bx: number, by: number, kind: Bound, ok: (x: number, y: number) => boolean, solids: Solid[], fences: { pts: number[]; picket: boolean }[]): void {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1.5) return;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const step = 0.8;
  const n = Math.ceil(len / step);
  let start = -1;
  const flush = (t0: number, t1: number) => {
    if (t1 - t0 < 1.2) return;
    const x0 = ax + ux * t0;
    const y0 = ay + uy * t0;
    const x1 = ax + ux * t1;
    const y1 = ay + uy * t1;
    if (kind === 'fence' || kind === 'picket') {
      fences.push({ pts: [x0, y0, x1, y1], picket: kind === 'picket' });
      return;
    }
    const hedge = kind === 'hedge';
    const hw = hedge ? 0.4 : 0.15;
    const [k0, k1] = B.key((x0 + x1) / 2, (y0 + y1) / 2);
    const h = hedge ? 1.1 + hash(k0, k1, B.set.seed, 500) * 0.5 : 1.0;
    const nx = -uy * hw;
    const ny = ux * hw;
    const pts = [x0 + nx, y0 + ny, x0 - nx, y0 - ny, x1 - nx, y1 - ny, x1 + nx, y1 + ny];
    const s = newSolid();
    prism(B, [{ pts: ringArea(pts) < 0 ? [pts[6], pts[7], pts[4], pts[5], pts[2], pts[3], pts[0], pts[1]] : pts, seam: new Uint8Array(4) }], 0, h, { roof: true, windows: false, pen: hedge ? GREENERY : LINEWORK }, s);
    s.casts.push({ ring: pts, h });
    solids.push(s);
  };
  for (let k = 0; k <= n; k++) {
    const t = Math.min(len, k * step);
    const good = ok(ax + ux * t, ay + uy * t);
    if (good && start < 0) start = t;
    if ((!good || k === n) && start >= 0) {
      flush(start, good ? t : Math.max(start, t - step));
      start = -1;
    }
  }
}

/** Hedgerows along field edges: bushes, with now and then a tree grown out of the hedge. */
export function hedgerows(B: Build, paper: Paper, G: Ground, M: Masks): Tree[] {
  const { cam, set, style } = B;
  const out: Tree[] = [];
  const chance = HEDGEROWS[style.id];
  if (set.trees <= 0 || !chance || cam.lod < 0.25) return out;
  const seen = new Set<string>();
  const clear = (x: number, y: number) => {
    const sx = cam.sx(x, y);
    const sy = cam.sy(x, y, 0);
    return !paper.on(M.road, sx, sy) && !paper.on(M.water, sx, sy) && !paper.on(M.foot, sx, sy) && !paper.on(M.wood, sx, sy);
  };
  for (const c of G.covers) {
    if (c.code !== FIELD && c.code !== MEADOW) continue;
    const ring = c.shape[0];
    const p = ring.pts;
    const n = p.length / 2;
    for (let e = 0; e < n; e++) {
      if (ring.seam[e]) continue;
      const f = (e + 1) % n;
      const ax = p[e * 2];
      const ay = p[e * 2 + 1];
      const bx = p[f * 2];
      const by = p[f * 2 + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 12) continue;
      const [m0, m1] = B.key(Math.round((ax + bx) / 4) * 2, Math.round((ay + by) / 4) * 2);
      if (hash(m0, m1, set.seed, 510) >= chance) continue;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      for (let t = 1.2; t < len - 1.2; t += 2.4) {
        const x = ax + ux * t;
        const y = ay + uy * t;
        const id = `${Math.round(x / 1.8)},${Math.round(y / 1.8)}`;
        if (seen.has(id) || !clear(x, y)) continue;
        seen.add(id);
        const [k0, k1] = B.key(x, y);
        const h = (salt: number) => hash(k0, k1, set.seed, 520 + salt);
        if (h(0) < 0.12) {
          const r = 2.2 + h(1) * 1.0;
          out.push({ x, y, r, h: r + 3.5 + h(2) * 2, conifer: false });
        } else if (h(0) < 0.92) {
          const r = 0.9 + h(1) * 0.6;
          out.push({ x, y, r, h: r, conifer: false, bush: true });
        }
      }
    }
  }
  return out;
}

const AVENUE_CLASSES = new Set(['primary', 'secondary', 'tertiary', 'minor']);

/** Trees along main roads, on the pavement, where there's room before the houses. */
export function streetTrees(B: Build, paper: Paper, ways: Way[], M: Masks): Tree[] {
  const { cam, set, style } = B;
  const out: Tree[] = [];
  const chance = AVENUES[style.id] * Math.min(1, set.trees / 0.7);
  if (set.trees <= 0 || !chance) return out;
  const clear = (x: number, y: number) => {
    const sx = cam.sx(x, y);
    const sy = cam.sy(x, y, 0);
    return !paper.on(M.road, sx, sy) && !paper.on(M.water, sx, sy) && !paper.on(M.foot, sx, sy) && !paper.on(M.wood, sx, sy);
  };
  for (const w of ways) {
    if (w.kind !== 'road' || !AVENUE_CLASSES.has(w.cls)) continue;
    const p = w.pts;
    const mid = Math.floor(p.length / 4) * 2;
    const [m0, m1] = B.key(Math.round(p[mid] / 20) * 20, Math.round(p[mid + 1] / 20) * 20);
    if (hash(m0, m1, set.seed, 530) >= (w.cls === 'minor' ? chance * 0.5 : chance)) continue;
    const off = w.width / 2 + 1.5;
    walk(p, 5, 9, 5, (x, y, ux, uy) => {
      for (const side of [1, -1]) {
        const nx = -uy * side;
        const ny = ux * side;
        const tx = x + nx * off;
        const ty = y + ny * off;
        // Room for a crown: the pavement must be clear a little further back too.
        if (!clear(tx, ty) || !clear(tx + nx * 2.2, ty + ny * 2.2)) continue;
        const [k0, k1] = B.key(tx, ty);
        const r = 1.9 + hash(k0, k1, set.seed, 540) * 0.7;
        out.push({ x: tx, y: ty, r, h: r + 3.4 + hash(k0, k1, set.seed, 541) * 1.5, conifer: false });
      }
    });
  }
  return out;
}
