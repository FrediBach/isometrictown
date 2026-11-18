import type { Build } from './buildings';
import type { Camera } from './camera';
import { onMask, type Extra } from './infra';
import type { Masks } from './nature';
import type { Paper } from './raster';
import { hash } from './rng';
import { LINEWORK } from './settings';
import type { Town, Way } from './tiles';
import { imagePower, imageFeeders } from './image-power';
import { urbanity } from './traffic';
import { LOD, shows } from './lod';
import { powerTerrain } from './power-terrain';
import { powerRoads, roadsideSupports, ruralSupports, roadAnchor } from './power-roads';
type Terrain = ReturnType<typeof powerTerrain>;

/*
 * Power lines. OpenMapTiles carries none, so they're made up, in two kinds:
 *
 * Transmission lines on lattice pylons, laid out on a grid in absolute map coordinates: each grid
 * cell may hold one straight line of its own, a few kilometres long, so a line runs on unbroken
 * from one view into the next. Pylons stand at fixed spans from the line's start; supports and
 * the full corridor must lie on mapped land, clear of water, buildings and airfields. Unknown
 * ground and dense towns break the run; rejected supports are never bridged over.
 *
 * Distribution lines on wooden poles along roads: in town where that's how it's done (the Americas,
 * East Asia, Australia, the tropics), only out on country roads elsewhere.
 */

/** Grid cell for transmission lines, in absolute map units, and the chance a cell holds a line. */
const CELL = 3000;
const LINE_CHANCE = 0.6;
/** Regions where wires run overhead on poles along town streets, not just country roads. */
export const OVERHEAD_TOWN = new Set(['american', 'eastAsian', 'antipodean', 'tropical', 'arid', 'eastern']);

type Line = { pen: number; pts: number[] };

/** Whether a span between two points passes over the cinematic title, which no wire may run through. */
function crossesTitle(paper: Paper, M: Masks, ax: number, ay: number, bx: number, by: number): boolean {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 1.5);
  for (let i = 0; i <= n; i++) if (onMask(paper, M.title, ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n)) return true;
  return false;
}

/** A wire hanging between two supports, sagging in the middle. */
function wire(ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number, out: Line[]): void {
  const pts: number[] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t - 4 * sag * t * (1 - t));
  }
  out.push({ pen: LINEWORK, pts });
}

type Tower = { x: number; y: number; dx: number; dy: number; big: boolean; H: number };

/** A pylon's arms: height and reach either side. Big pylons carry a wide lower pair and a shorter upper one. */
function arms(t: Tower): [number, number][] {
  return t.big
    ? [
        [t.H * 0.62, 11],
        [t.H * 0.8, 7],
      ]
    : [
        [t.H * 0.72, 5],
        [t.H * 0.88, 3.8],
      ];
}

/** Insulator length: the conductors hang this far below the arms. */
const drop = (t: Tower) => (t.big ? 3 : 2.2);

/** Where the conductors hang on a pylon: offset across the line, and height. */
function conductors(t: Tower): [number, number][] {
  const out: [number, number][] = [];
  arms(t).forEach(([z, reach], k) => {
    const at = t.big && k === 0 ? [reach, reach * 0.6] : [reach];
    for (const b of at) out.push([-b, z - drop(t)], [b, z - drop(t)]);
  });
  return out;
}

/**
 * A lattice pylon: four tapering legs, cross-bracing, arms with hanging insulators, and the
 * peak. Too small on paper for its legs to stand apart, it is drawn flat, as the A-frame you'd
 * see side on, so the legs don't close up into a black wedge.
 */
function pylon(cam: Camera, t: Tower, detail: boolean, out: Line[]): void {
  if (!shows(cam, LOD.pylonLegs)) {
    flatPylon(cam, t, out);
    return;
  }
  const { x, y, dx, dy, H, big } = t;
  const nx = -dy;
  const ny = dx;
  const P = (a: number, b: number, z: number) => [x + dx * a + nx * b, y + dy * a + ny * b, z];
  const b0 = big ? 4.5 : 3;
  const waist = H * (big ? 0.58 : 0.66);
  const half = (z: number) => (z <= waist ? b0 + (1.1 - b0) * (z / waist) : 1.1 - 0.5 * ((z - waist) / (H - waist)));
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [ca, cb] of corners) out.push({ pen: LINEWORK, pts: [...P(ca * b0, cb * b0, 0), ...P(ca * 1.1, cb * 1.1, waist), ...P(ca * 0.6, cb * 0.6, H * 0.95)] });
  // Cross-bracing on each face, panel by panel, up to the waist and above.
  const levels: number[] = [];
  for (let z = 0; z < H * 0.94; z += detail ? Math.max(3, half(z) * 1.3) : H) levels.push(z);
  levels.push(H * 0.94);
  for (let k = 0; k + 1 < levels.length; k++) {
    const z0 = levels[k];
    const z1 = levels[k + 1];
    const h0 = half(z0);
    const h1 = half(z1);
    for (let c = 0; c < 4; c++) {
      const [a0, b0c] = corners[c];
      const [a1, b1c] = corners[(c + 1) % 4];
      if (detail) {
        out.push({ pen: LINEWORK, pts: [...P(a0 * h0, b0c * h0, z0), ...P(a1 * h1, b1c * h1, z1)] });
        out.push({ pen: LINEWORK, pts: [...P(a1 * h0, b1c * h0, z0), ...P(a0 * h1, b0c * h1, z1)] });
      }
      out.push({ pen: LINEWORK, pts: [...P(a0 * h1, b0c * h1, z1), ...P(a1 * h1, b1c * h1, z1)] });
    }
  }
  // Peak for the earth wire.
  out.push({ pen: LINEWORK, pts: [...P(-0.6, -0.6, H * 0.95), ...P(0, 0, H), ...P(0.6, 0.6, H * 0.95)] });
  out.push({ pen: LINEWORK, pts: [...P(0.6, -0.6, H * 0.95), ...P(0, 0, H), ...P(-0.6, 0.6, H * 0.95)] });
  // Arms: a lower chord and a raking upper one out to each tip, an insulator hanging from it.
  for (const [z, reach] of arms(t)) {
    const h = half(z);
    for (const s of [-1, 1]) {
      for (const a of [-1, 1]) out.push({ pen: LINEWORK, pts: [...P(a * h, s * h, z), ...P(0, s * reach, z), ...P(a * h * 0.8, s * h * 0.8, z + 2)] });
    }
  }
  for (const [b, z] of conductors(t)) out.push({ pen: LINEWORK, pts: [...P(0, b, z), ...P(0, b, z + drop(t))] });
}

/** A pylon as a flat A-frame across the line: two legs, a peak and one chord out to each arm tip. */
function flatPylon(cam: Camera, t: Tower, out: Line[]): void {
  const { x, y, dx, dy, H, big } = t;
  const P = (b: number, z: number) => [x - dy * b, y + dx * b, z];
  const b0 = big ? 4.5 : 3;
  const waist = H * (big ? 0.58 : 0.66);
  for (const s of [-1, 1]) out.push({ pen: LINEWORK, pts: [...P(s * b0, 0), ...P(s * 1.1, waist), ...P(s * 0.6, H * 0.95), ...P(0, H)] });
  for (const [z, reach] of arms(t)) out.push({ pen: LINEWORK, pts: [...P(-reach, z), ...P(reach, z)] });
  if (shows(cam, LOD.insulator, drop(t))) for (const [b, z] of conductors(t)) out.push({ pen: LINEWORK, pts: [...P(b, z), ...P(b, z + drop(t))] });
}

/** An inferred transmission run must continue beyond both sides of the print, not terminate within it. */
export function powerRunContinues(cam: Camera, first: { x: number; y: number; H: number }, last: { x: number; y: number; H: number }): boolean {
  const outside = (t: { x: number; y: number; H: number }) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    // Include the whole tower and its arms: a base outside the sheet can still leave a visible end.
    for (const dx of [-16, 16]) for (const dy of [-16, 16]) for (const z of [0, t.H]) {
      const x = cam.sx(t.x + dx, t.y + dy), y = cam.sy(t.x + dx, t.y + dy, z);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const [left, top, right, bottom] = cam.rect, margin = 8;
    return x1 < left - margin || x0 > right + margin || y1 < top - margin || y0 > bottom + margin;
  };
  return outside(first) && outside(last);
}

/** Transmission lines from the grid cells around the view, as pylons and the spans between them. */
function transmission(B: Build, paper: Paper, town: Town, M: Masks, box: number[], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number], out: Line[], terrain: Terrain): void {
  const { set, cam } = B;
  const urban = urbanity({ ...town, ways: terrain.roads }, B.toAbs);
  const [X0, Y0] = toAbs(box[0], box[1]);
  const [X1, Y1] = toAbs(box[2], box[3]);
  const i0 = Math.floor(Math.min(X0, X1) / CELL) - 2;
  const i1 = Math.floor(Math.max(X0, X1) / CELL) + 2;
  const j0 = Math.floor(Math.min(Y0, Y1) / CELL) - 2;
  const j1 = Math.floor(Math.max(Y0, Y1) / CELL) + 2;
  const inBox = (x: number, y: number, m: number) => x > box[0] - m && x < box[2] + m && y > box[1] - m && y < box[3] + m;
  // Lattice bracing only where it can read as lattice; smaller, it closes up into a black mass.
  const detail = shows(cam, LOD.lattice);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const r = (salt: number) => hash(i, j, set.seed, 900 + salt);
      if (r(0) > LINE_CHANCE) continue;
      const big = r(5) < 0.5;
      // A straight line through a point in the cell, up to one and a half cells either way.
      const cx = (i + r(1)) * CELL;
      const cy = (j + r(2)) * CELL;
      const ang = r(3) * Math.PI;
      const len = CELL * (1.6 + r(4) * 1.4);
      const [ax, ay] = fromAbs(cx - (Math.cos(ang) * len) / 2, cy - (Math.sin(ang) * len) / 2);
      const [bx, by] = fromAbs(cx + (Math.cos(ang) * len) / 2, cy + (Math.sin(ang) * len) / 2);
      const L = Math.hypot(bx - ax, by - ay);
      const dx = (bx - ax) / L;
      const dy = (by - ay) / L;
      // Skip lines that come nowhere near the view.
      const t = Math.max(0, Math.min(L, ((box[0] + box[2]) / 2 - ax) * dx + ((box[1] + box[3]) / 2 - ay) * dy));
      const reach = Math.hypot(box[2] - box[0], box[3] - box[1]);
      if (Math.hypot(ax + dx * t - (box[0] + box[2]) / 2, ay + dy * t - (box[1] + box[3]) / 2) > reach) continue;
      const span = big ? 380 : 290;
      const H = big ? 48 + r(6) * 8 : 30 + r(6) * 6;
      let run: Tower[] = [];
      const flush = () => {
        if (run.length > 1 && powerRunContinues(cam, run[0], run[run.length - 1])) {
          for (const tower of run) pylon(cam, tower, detail, out);
          for (let k = 1; k < run.length; k++) {
            const prev = run[k - 1], tower = run[k];
            const sag = Math.hypot(prev.x - tower.x, prev.y - tower.y) * 0.025;
            for (const [b, z] of conductors(tower)) wire(prev.x - prev.dy * b, prev.y + prev.dx * b, z, tower.x - tower.dy * b, tower.y + tower.dx * b, z, sag, out);
            wire(prev.x, prev.y, prev.H, tower.x, tower.y, tower.H, sag * 0.8, out);
          }
        }
        run = [];
      };
      for (let d = 0; d <= L; d += span) {
        const x = ax + dx * d, y = ay + dy * d;
        // Inspect two spans beyond the view before deciding whether the route continues.
        if (!inBox(x, y, span * 2) || urban(x, y) > 0.55) { flush(); continue; }
        let tower: Tower | null = null;
        for (const shift of [0, 12, -12, 24, -24]) {
          const px = x + dx * shift, py = y + dy * shift;
          if (!terrain.support(px, py, true) || onMask(paper, M.title, px, py)) continue;
          tower = { x: px, y: py, dx, dy, big, H };
          break;
        }
        if (!tower) { flush(); continue; }
        const prev = run[run.length - 1];
        if (prev && (Math.hypot(prev.x - tower.x, prev.y - tower.y) >= span * 1.2 || !terrain.span(prev.x, prev.y, tower.x, tower.y, true, big ? 11 : 5) || crossesTitle(paper, M, prev.x, prev.y, tower.x, tower.y))) flush();
        run.push(tower);
      }
      flush();
    }
}

/** Wooden poles along roads with wires between them. */
function distribution(B: Build, paper: Paper, town: Town, M: Masks, out: Line[], terrain: Terrain, grid?: ReturnType<typeof imagePower>): void {
  const { set, style } = B;
  const urban = grid ? undefined : urbanity({ ...town, ways: terrain.roads }, B.toAbs);
  const townToo = OVERHEAD_TOWN.has(style.id);
  const american = style.id === 'american' || style.id === 'antipodean';
  const asian = style.id === 'eastAsian';
  const blocked = (x: number, y: number) => !terrain.support(x, y, false) || onMask(paper, M.title, x, y);
  const keyed = (w: Way, salt: number) => {
    const [k0, k1] = B.key(...roadAnchor(w));
    return hash(k0, k1, set.seed, salt);
  };
  const ways = powerRoads(terrain.roads, B.key);
  const preferredSide = (w: Way) => keyed(w, 951) < 0.5 ? 1 : -1;
  const [left, top, right, bottom] = B.cam.rect;
  const visible = (x: number, y: number) => {
    const sx = B.cam.sx(x, y), sy = B.cam.sy(x, y, 0);
    return sx >= left && sx <= right && sy >= top && sy <= bottom;
  };
  const routes = grid ? imageFeeders(ways, grid, visible, (x, y) => !blocked(x, y),
    (a, b, width) => terrain.span(a[0], a[1], b[0], b[1], false, width) && !crossesTitle(paper, M, a[0], a[1], b[0], b[1]),
    preferredSide, h => shows(B.cam, LOD.pole, h)) :
    ways.filter(w => keyed(w, 950) <= (townToo ? 0.85 : 0.5)).map(w => {
      const side = preferredSide(w), spacing = asian ? 30 : 38;
      return { poles: roadsideSupports(w, side, spacing), side, spacing, village: false, H: american ? 10.5 : asian ? 11 : 8.5, reach: 1.1 };
    });
  for (const { poles, H, village, reach, side, spacing } of routes) {
    const feeder = !!grid && !village;
    // Arms across the road's direction carry the wires; the pole's top is the same for all.
    let wires: [number, number][];
    if (village) wires = [[0, H], [0.55, H - 0.35]];
    else if (feeder) wires = [[-1.65, H - 0.5], [1.65, H - 0.5], [0, H], [0, H - 2.3]];
    else if (american) wires = [[-0.9, H - 0.4], [0.9, H - 0.4], [0, H - 2.0]];
    else if (asian) wires = [[-0.8, H - 0.4], [0.8, H - 0.4], [-0.8, H - 1.6], [0.8, H - 1.6], [0, H - 3.0], [0, H - 3.6]];
    else wires = [[-0.6, H - 0.3], [0, H], [0.6, H - 0.3]];
    // Wires too close to read apart on paper close up into one thick stroke: keep one of each
    // close group, the ones nearest the pole first.
    const kept: [number, number][] = [];
    for (const wr of [...wires].sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]) || b[1] - a[1]))
      if (kept.every(([b, z]) => shows(B.cam, LOD.poleWires, Math.hypot(b - wr[0], z - wr[1])))) kept.push(wr);
    const arms = new Set(kept.filter(([b]) => b !== 0).map(([, z]) => z));
    const can = (american || asian || feeder) && shows(B.cam, LOD.transformer);
    let prev: [number, number, number, number] | null = null;
    let previousPole: Line[] = [], previousDrawn = false;
    const rural = !urban || townToo ? null : ruralSupports(poles, urban);
    for (let i=0; i<poles.length; i++) {
      const [x, y, nx, ny] = poles[i];
      if (!grid && (blocked(x, y) || (rural && !rural[i]))) { prev = null; continue; }
      const ux = ny * side, uy = -nx * side;
      const pole: Line[] = [];
      // The pole, and its cross-arms; retain them only if a verified span uses this support.
      pole.push({ pen: LINEWORK, pts: [x, y, 0, x, y, H] });
      for (const z of arms) pole.push({ pen: LINEWORK, pts: [x + nx * reach, y + ny * reach, z, x - nx * reach, y - ny * reach, z] });
      // Now and then a transformer can on the pole.
      const [k0, k1] = B.key(x, y);
      const terminal = !!grid && (i === 0 || i === poles.length - 1);
      if (terminal) {
        // A cable riser takes the overhead circuit underground at the street end or junction.
        pole.push({ pen: LINEWORK, pts: [x, y, H, x + nx * 0.7, y + ny * 0.7, H - 1, x + nx * 0.7, y + ny * 0.7, 0] });
      }
      if ((terminal && shows(B.cam, LOD.transformer)) || (can && hash(k0, k1, set.seed, 952) < 0.15)) {
        const cx = x - ux * 0.5;
        const cy = y - uy * 0.5;
        const z0 = H - 3.4;
        pole.push({ pen: LINEWORK, pts: [cx - nx * 0.3, cy - ny * 0.3, z0, cx - nx * 0.3, cy - ny * 0.3, z0 + 1.1, cx + nx * 0.3, cy + ny * 0.3, z0 + 1.1, cx + nx * 0.3, cy + ny * 0.3, z0, cx - nx * 0.3, cy - ny * 0.3, z0] });
      }
      let joined = false;
      if (prev) {
        const [px, py, pnx, pny] = prev;
        // Dedicated corner supports let the wires turn with the road.
        if (grid || (Math.hypot(px - x, py - y) < spacing * 1.5 && terrain.span(px, py, x, y, false, reach) && !crossesTitle(paper, M, px, py, x, y))) {
          if (!previousDrawn) out.push(...previousPole);
          out.push(...pole);
          joined = true;
          for (const [b, z] of kept) wire(px + pnx * b, py + pny * b, z, x + nx * b, y + ny * b, z, 0.9, out);
        }
      }
      prev = [x, y, nx, ny];
      previousPole = pole; previousDrawn = joined;
    }
  }
}

/** Overhead power lines: transmission pylons across the country, and poles along roads. */
export function powerLines(B: Build, paper: Paper, town: Town, M: Masks, box: number[], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Extra {
  const out: Line[] = [];
  if (!B.set.power || !shows(B.cam, LOD.pylon)) return { solids: [], draw: () => {} };
  const grid = B.set.source === 'image' ? imagePower(town.density.built) : undefined;
  const terrain = powerTerrain(town, !!grid);
  if (!grid) transmission(B, paper, town, M, box, toAbs, fromAbs, out, terrain);
  if (grid || shows(B.cam, LOD.pole)) distribution(B, paper, town, M, out, terrain, grid);
  return { solids: [], draw: (p) => out.forEach((l) => p.line3(l.pen, l.pts)) };
}
