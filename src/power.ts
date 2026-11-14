import type { Build } from './buildings';
import { measure, at, onMask, type Extra } from './infra';
import type { Masks } from './nature';
import type { Paper } from './raster';
import { hash } from './rng';
import { LINEWORK } from './settings';
import type { Town, Way } from './tiles';
import { urbanity } from './traffic';

/*
 * Power lines. OpenMapTiles carries none, so they're made up, in two kinds:
 *
 * Transmission lines on lattice pylons, laid out on a grid in absolute map coordinates: each grid
 * cell may hold one straight line of its own, a few kilometres long, so a line runs on unbroken
 * from one view into the next and never moves when the view pans. Pylons stand at fixed spans from
 * the line's start; where a span would land in a dense town centre the line goes underground.
 *
 * Distribution lines on wooden poles along roads: in town where that's how it's done (the Americas,
 * East Asia, Australia, the tropics), only out on country roads elsewhere.
 */

/** Grid cell for transmission lines, in absolute map units, and the chance a cell holds a line. */
const CELL = 3000;
const LINE_CHANCE = 0.6;
/** Regions where wires run overhead on poles along town streets, not just country roads. */
const OVERHEAD_TOWN = new Set(['american', 'eastAsian', 'antipodean', 'tropical', 'arid', 'eastern']);
const POLE_ROADS = new Set(['primary', 'secondary', 'tertiary', 'minor', 'service']);
const PRIVATE = new Set(['driveway', 'parking_aisle', 'drive-through']);

type Line = { pen: number; pts: number[] };

/** A wire hanging between two points, sagging by sag in the middle. */
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

/** A lattice pylon: four tapering legs, cross-bracing, arms with hanging insulators, and the peak. */
function pylon(t: Tower, detail: boolean, out: Line[]): void {
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

/** Transmission lines from the grid cells around the view, as pylons and the spans between them. */
function transmission(B: Build, paper: Paper, town: Town, M: Masks, box: number[], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number], out: Line[]): void {
  const { set, cam } = B;
  const urban = urbanity(town);
  const [X0, Y0] = toAbs(box[0], box[1]);
  const [X1, Y1] = toAbs(box[2], box[3]);
  const i0 = Math.floor(Math.min(X0, X1) / CELL) - 2;
  const i1 = Math.floor(Math.max(X0, X1) / CELL) + 2;
  const j0 = Math.floor(Math.min(Y0, Y1) / CELL) - 2;
  const j1 = Math.floor(Math.max(Y0, Y1) / CELL) + 2;
  const inBox = (x: number, y: number, m: number) => x > box[0] - m && x < box[2] + m && y > box[1] - m && y < box[3] + m;
  // Lattice bracing only where it can read as lattice; smaller, it closes up into a black mass.
  const detail = cam.lod >= 0.9;
  // No pylons across airfields: their runways and aprons keep a wide berth.
  const field: number[] = [];
  for (const w of town.runways) for (let k = 0; k < w.pts.length; k += 2) field.push(w.pts[k], w.pts[k + 1]);
  for (const a of town.aprons) for (let k = 0; k < a[0].pts.length; k += 2) field.push(a[0].pts[k], a[0].pts[k + 1]);
  const nearField = (x: number, y: number) => {
    for (let k = 0; k < field.length; k += 2) if (Math.hypot(field[k] - x, field[k + 1] - y) < 500) return true;
    return false;
  };
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
      let prev: Tower | null = null;
      for (let d = 0; d <= L; d += span) {
        const x = ax + dx * d;
        const y = ay + dy * d;
        if (!inBox(x, y, span * 1.2)) {
          prev = null;
          continue;
        }
        // Into a dense town the line goes underground; elsewhere a pylon steps aside from what's in its way.
        if (urban(x, y) > 0.55 || nearField(x, y) || nearField((x + (prev?.x ?? x)) / 2, (y + (prev?.y ?? y)) / 2)) {
          prev = null;
          continue;
        }
        let tower: Tower | null = null;
        for (const shift of [0, 12, -12, 24, -24]) {
          const px = x + dx * shift;
          const py = y + dy * shift;
          const onSheet = inBox(px, py, 0);
          if (onSheet && (onMask(paper, M.foot, px, py) || onMask(paper, M.water, px, py) || onMask(paper, M.road, px, py))) continue;
          tower = { x: px, y: py, dx, dy, big, H };
          break;
        }
        if (!tower) continue;
        pylon(tower, detail, out);
        if (prev && Math.hypot(prev.x - tower.x, prev.y - tower.y) < span * 2.3) {
          const sag = Math.hypot(prev.x - tower.x, prev.y - tower.y) * 0.025;
          const P = (tw: Tower, b: number, z: number) => [tw.x - tw.dy * b, tw.y + tw.dx * b, z];
          for (const [b, z] of conductors(tower)) {
            const [px, py] = P(prev, b, z);
            const [qx, qy] = P(tower, b, z);
            wire(px, py, z, qx, qy, z, sag, out);
          }
          wire(prev.x, prev.y, prev.H, tower.x, tower.y, tower.H, sag * 0.8, out);
        }
        prev = tower;
      }
    }
}

/** Wooden poles along roads with wires between them. */
function distribution(B: Build, paper: Paper, town: Town, M: Masks, out: Line[]): void {
  const { set, style } = B;
  const urban = urbanity(town);
  const townToo = OVERHEAD_TOWN.has(style.id);
  const american = style.id === 'american' || style.id === 'antipodean';
  const asian = style.id === 'eastAsian';
  const spacing = asian ? 30 : 38;
  const H = american ? 10.5 : asian ? 11 : 8.5;
  const blocked = (x: number, y: number) => onMask(paper, M.foot, x, y) || onMask(paper, M.water, x, y) || onMask(paper, M.road, x, y);
  const keyed = (w: Way, salt: number) => {
    const [k0, k1] = B.key(w.pts[0], w.pts[1]);
    return hash(k0, k1, set.seed, salt);
  };
  for (const w of town.ways) {
    if (w.kind !== 'road' || !POLE_ROADS.has(w.cls) || PRIVATE.has(w.service ?? '') || w.bridge) continue;
    const cum = measure(w.pts);
    const L = cum[cum.length - 1];
    if (L < spacing) continue;
    const [mx, my] = at(w.pts, cum, L / 2);
    const u = urban(mx, my);
    // Out of town everywhere; in town only where wires overhead are the norm.
    if (!townToo && u > 0.15) continue;
    if (keyed(w, 950) > (townToo ? 0.85 : 0.5)) continue;
    const side = keyed(w, 951) < 0.5 ? 1 : -1;
    const off = w.width / 2 + 1.0;
    // Arms across the road's direction carry the wires; the pole's top is the same for all.
    const wires: [number, number][] = american
      ? [
          [-0.9, H - 0.4],
          [0.9, H - 0.4],
          [0, H - 2.0],
        ]
      : asian
        ? [
            [-0.8, H - 0.4],
            [0.8, H - 0.4],
            [-0.8, H - 1.6],
            [0.8, H - 1.6],
            [0, H - 3.0],
            [0, H - 3.6],
          ]
        : [
            [-0.6, H - 0.3],
            [0, H],
            [0.6, H - 0.3],
          ];
    let prev: [number, number, number, number] | null = null;
    for (let d = 6; d <= L - 4; d += spacing) {
      const [x0, y0, ux, uy] = at(w.pts, cum, d);
      const nx = -uy * side;
      const ny = ux * side;
      const x = x0 + nx * off;
      const y = y0 + ny * off;
      if (blocked(x, y)) continue;
      // The pole, and its cross-arms.
      out.push({ pen: LINEWORK, pts: [x, y, 0, x, y, H] });
      const arms = new Set(wires.filter(([b]) => b !== 0).map(([, z]) => z));
      for (const z of arms) out.push({ pen: LINEWORK, pts: [x + nx * 1.1, y + ny * 1.1, z, x - nx * 1.1, y - ny * 1.1, z] });
      // Now and then a transformer can on the pole.
      const [k0, k1] = B.key(x, y);
      if ((american || asian) && hash(k0, k1, set.seed, 952) < 0.15) {
        const cx = x - ux * 0.5;
        const cy = y - uy * 0.5;
        const z0 = H - 3.4;
        out.push({ pen: LINEWORK, pts: [cx - nx * 0.3, cy - ny * 0.3, z0, cx - nx * 0.3, cy - ny * 0.3, z0 + 1.1, cx + nx * 0.3, cy + ny * 0.3, z0 + 1.1, cx + nx * 0.3, cy + ny * 0.3, z0, cx - nx * 0.3, cy - ny * 0.3, z0] });
      }
      if (prev) {
        const [px, py, pnx, pny] = prev;
        // Round a bend the road turns away from the wires; start a new run rather than cut the corner.
        if (Math.hypot(px - x, py - y) < spacing * 2.2 && pnx * nx + pny * ny > 0.87)
          for (const [b, z] of wires) wire(px + pnx * b, py + pny * b, z, x + nx * b, y + ny * b, z, 0.9, out);
      }
      prev = [x, y, nx, ny];
    }
  }
}

/** Overhead power lines: transmission pylons across the country, and poles along roads. */
export function powerLines(B: Build, paper: Paper, town: Town, M: Masks, box: number[], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Extra {
  const out: Line[] = [];
  if (!B.set.power || B.cam.lod < 0.1) return { solids: [], draw: () => {} };
  transmission(B, paper, town, M, box, toAbs, fromAbs, out);
  if (B.cam.lod >= 0.3) distribution(B, paper, town, M, out);
  return { solids: [], draw: (p) => out.forEach((l) => p.line3(l.pen, l.pts)) };
}
