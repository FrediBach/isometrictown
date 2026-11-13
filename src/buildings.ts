import type { Camera } from './camera';
import { pointInRing, ringArea } from './geo';
import { hash } from './rng';
import { LINEWORK, SHADOWS, ROOFS, type Settings } from './settings';
import type { Building, Ring } from './tiles';

export type Line3 = { pen: number; pts: number[]; closed?: boolean };
/** Something solid: faces for the depth buffer, lines to draw, and outlines that cast shadows. */
export type Solid = {
  faces: number[][][];
  lines: Line3[];
  casts: { ring: number[]; h: number }[];
};

export type Build = {
  cam: Camera;
  set: Settings;
  /** Stable integer key for a local position, so randomness doesn't change when the view moves. */
  key: (x: number, y: number) => [number, number];
  /** Horizontal unit vector pointing towards the sun. */
  sun: [number, number];
};

const CREASE = Math.cos((24 * Math.PI) / 180);
const FLOOR = 3.2;
const BAY = 3.4;
const ROOF_HATCH_MM = 0.7;
const SHADE_MM = 0.75;

export function newSolid(): Solid {
  return { faces: [], lines: [], casts: [] };
}

/** Front-facing: the wall's outward normal points down the sheet, towards the viewer. */
function facing(B: Build, ax: number, ay: number, bx: number, by: number): boolean {
  const [ux, uy] = B.cam.up;
  return (by - ay) * ux - (bx - ax) * uy < 0;
}

/** Runs of consecutive edges that pass a filter, as 3D polylines at height z. */
function runs(ring: Ring, z: number, keep: (i: number) => boolean, pen: number, out: Line3[]): void {
  const p = ring.pts;
  const n = p.length / 2;
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (!keep(i)) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    const pts: number[] = [];
    for (let i = 0; i < n; i++) pts.push(p[i * 2], p[i * 2 + 1], z);
    out.push({ pen, pts, closed: true });
    return;
  }
  let cur: number[] | null = null;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (keep(i)) {
      const j = (i + 1) % n;
      if (!cur) {
        cur = [p[i * 2], p[i * 2 + 1], z];
        out.push({ pen, pts: cur });
      }
      cur.push(p[j * 2], p[j * 2 + 1], z);
    } else cur = null;
  }
}

type PrismOptions = { roof: boolean; windows: boolean; pen: number; topPen?: number };

/** Walls and an optional flat roof over footprint rings, from z0 to z1. */
export function prism(B: Build, rings: Ring[], z0: number, z1: number, o: PrismOptions, out: Solid): void {
  const { set, cam } = B;
  const s = cam.s;
  for (const ring of rings) {
    const p = ring.pts;
    const n = p.length / 2;
    const front = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ax, ay, bx, by] = [p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]];
      if (ring.seam[i]) continue;
      if (!facing(B, ax, ay, bx, by)) continue;
      front[i] = 1;
      out.faces.push([[ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z1]]);
      const len = Math.hypot(bx - ax, by - ay);
      if (o.windows && set.windows && len >= 2.4) windows(B, ax, ay, bx, by, len, z0, z1, out);
      if (set.shadeWalls && (by - ay) * B.sun[0] - (bx - ax) * B.sun[1] < 0) {
        const ext = Math.abs((bx - ax) * cam.cb - (by - ay) * cam.sb) * s;
        const m = Math.floor(ext / SHADE_MM);
        for (let k = 1; k < m; k++) {
          const t = k / m;
          const x = ax + (bx - ax) * t;
          const y = ay + (by - ay) * t;
          out.lines.push({ pen: SHADOWS, pts: [x, y, z0, x, y, z1] });
        }
      }
    }
    if (o.roof) runs(ring, z1, (i) => !ring.seam[i], o.topPen ?? o.pen, out.lines);
    runs(ring, z0, (i) => front[i] === 1, o.pen, out.lines);
    for (let i = 0; i < n; i++) {
      const h = (i - 1 + n) % n;
      if (ring.seam[i] || ring.seam[h]) continue;
      if (!front[i] && !front[h]) continue;
      const j = (i + 1) % n;
      const g = (h - 0 + n) % n;
      const e1x = p[i * 2] - p[g * 2];
      const e1y = p[i * 2 + 1] - p[g * 2 + 1];
      const e2x = p[j * 2] - p[i * 2];
      const e2y = p[j * 2 + 1] - p[i * 2 + 1];
      const cos = (e1x * e2x + e1y * e2y) / (Math.hypot(e1x, e1y) * Math.hypot(e2x, e2y) || 1);
      if (cos < CREASE || front[i] !== front[h]) out.lines.push({ pen: o.pen, pts: [p[i * 2], p[i * 2 + 1], z0, p[i * 2], p[i * 2 + 1], z1] });
    }
  }
  if (o.roof) {
    out.faces.push(
      rings.map((r) => {
        const f: number[] = [];
        for (let i = 0; i < r.pts.length; i += 2) f.push(r.pts[i], r.pts[i + 1], z1);
        return f;
      }),
    );
  }
}

function windows(B: Build, ax: number, ay: number, bx: number, by: number, len: number, z0: number, z1: number, out: Solid): void {
  const s = B.cam.s;
  const full = s * 1.2 >= 0.85;
  if (!full && s * 1.5 < 0.5) return;
  const cols = Math.max(1, Math.floor(len / BAY));
  const bay = len / cols;
  const half = Math.min(0.62, bay * 0.3);
  const dx = (bx - ax) / len;
  const dy = (by - ay) / len;
  for (let zb = z0 + 0.95; zb + 1.45 <= z1 - 0.35; zb += FLOOR) {
    const zt = zb + 1.45;
    for (let c = 0; c < cols; c++) {
      const m = (c + 0.5) * bay;
      if (!full) {
        const x = ax + dx * m;
        const y = ay + dy * m;
        out.lines.push({ pen: LINEWORK, pts: [x, y, zb, x, y, zt] });
        continue;
      }
      const px = ax + dx * (m - half);
      const py = ay + dy * (m - half);
      const qx = ax + dx * (m + half);
      const qy = ay + dy * (m + half);
      out.lines.push({ pen: LINEWORK, pts: [px, py, zb, qx, qy, zb, qx, qy, zt, px, py, zt], closed: true });
    }
  }
}

type Rect = { cx: number; cy: number; ux: number; uy: number; L: number; w: number };

/** The minimum-area rectangle around a ring, and how much of it the ring fills. */
function bestRect(p: number[]): { rect: Rect; fill: number } {
  const n = p.length / 2;
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = p[j * 2] - p[i * 2];
    let uy = p[j * 2 + 1] - p[i * 2 + 1];
    const l = Math.hypot(ux, uy);
    if (l < 0.5) continue;
    ux /= l;
    uy /= l;
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const a = p[k * 2] * ux + p[k * 2 + 1] * uy;
      const b = -p[k * 2] * uy + p[k * 2 + 1] * ux;
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
      b0 = Math.min(b0, b);
      b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (area < bestArea) {
      bestArea = area;
      const ca = (a0 + a1) / 2;
      const cb = (b0 + b1) / 2;
      const r = { cx: ca * ux - cb * uy, cy: ca * uy + cb * ux, ux, uy, L: a1 - a0, w: b1 - b0 };
      best = r.L >= r.w ? r : { ...r, ux: -uy, uy: ux, L: r.w, w: r.L };
    }
  }
  return { rect: best!, fill: best ? Math.abs(ringArea(p)) / bestArea : 0 };
}

/** A house with a gabled or hipped roof over its best-fit rectangle. */
function house(B: Build, r: Rect, z0: number, H: number, k: [number, number], out: Solid): void {
  const { set, cam } = B;
  const { cx, cy, ux, uy, L, w } = r;
  const vx = -uy;
  const vy = ux;
  const hip = (L / w < 1.35 && hash(k[0], k[1], set.seed, 3) < 0.75) || hash(k[0], k[1], set.seed, 4) < 0.18;
  const tan = Math.tan(((32 + 12 * hash(k[0], k[1], set.seed, 5)) * Math.PI) / 180);
  const rise = (w / 2) * tan;
  const He = Math.max(z0 + 2.8, H - rise * 0.45);
  const Hr = He + rise;
  const c = [
    [cx - ux * (L / 2) - vx * (w / 2), cy - uy * (L / 2) - vy * (w / 2)],
    [cx + ux * (L / 2) - vx * (w / 2), cy + uy * (L / 2) - vy * (w / 2)],
    [cx + ux * (L / 2) + vx * (w / 2), cy + uy * (L / 2) + vy * (w / 2)],
    [cx - ux * (L / 2) + vx * (w / 2), cy - uy * (L / 2) + vy * (w / 2)],
  ];
  const ring: Ring = { pts: c.flat(), seam: new Uint8Array(4) };
  prism(B, [ring], z0, He, { roof: false, windows: true, pen: LINEWORK }, out);

  const inset = hip ? w / 2 : 0;
  const R0 = [cx - ux * (L / 2 - inset), cy - uy * (L / 2 - inset), Hr];
  const R1 = [cx + ux * (L / 2 - inset), cy + uy * (L / 2 - inset), Hr];
  const at = (i: number) => [c[i][0], c[i][1], He];
  const pen = ROOFS;
  if (hip) {
    out.faces.push([[...at(0), ...at(1), ...R1, ...R0]], [[...at(1), ...at(2), ...R1]], [[...at(2), ...at(3), ...R0, ...R1]], [[...at(3), ...at(0), ...R0]]);
    out.lines.push({ pen, pts: [...at(0), ...at(1), ...at(2), ...at(3)], closed: true });
    out.lines.push({ pen, pts: [...at(0), ...R0, ...at(3)] }, { pen, pts: [...at(1), ...R1, ...at(2)] });
    if (L - w > 0.1) out.lines.push({ pen, pts: [...R0, ...R1] });
  } else {
    out.faces.push([[...at(0), ...at(1), ...R1, ...R0]], [[...at(2), ...at(3), ...R0, ...R1]]);
    for (const [a, b] of [
      [1, 2],
      [3, 0],
    ]) {
      if (facing(B, c[a][0], c[a][1], c[b][0], c[b][1])) out.faces.push([[...at(a), ...at(b), ...(a === 1 ? R1 : R0)]]);
    }
    out.lines.push({ pen, pts: [...at(0), ...at(1)] }, { pen, pts: [...at(2), ...at(3)] });
    out.lines.push({ pen, pts: [...at(3), ...R0, ...at(0)] }, { pen, pts: [...at(1), ...R1, ...at(2)] }, { pen, pts: [...R0, ...R1] });
  }

  if (set.roofHatch) {
    const sides: [number, number, number, number][] = [
      [0, 1, vx, vy],
      [2, 3, -vx, -vy],
    ];
    if (hip) sides.push([1, 2, -ux, -uy], [3, 0, ux, uy]);
    for (const [a, b, mx, my] of sides) {
      const S = Math.hypot(c[b][0] - c[a][0], c[b][1] - c[a][1]);
      const ex = (c[b][0] - c[a][0]) / S;
      const ey = (c[b][1] - c[a][1]) / S;
      // Space lines by their spacing on paper, so foreshortened slopes don't fill in.
      const onPaper = Math.hypot(cam.sx(c[b][0], c[b][1]) - cam.sx(c[a][0], c[a][1]), cam.sy(c[b][0], c[b][1], He) - cam.sy(c[a][0], c[a][1], He));
      const count = Math.max(1, Math.round(onPaper / ROOF_HATCH_MM));
      const step = S / count;
      for (let u = step / 2; u < S; u += step) {
        const v = hip ? Math.min(u, S - u, w / 2) : w / 2;
        if (v < 0.08) continue;
        const x = c[a][0] + ex * u;
        const y = c[a][1] + ey * u;
        out.lines.push({ pen, pts: [x, y, He, x + mx * v, y + my * v, He + v * tan] });
      }
    }
  }
  out.casts.push({ ring: ring.pts, h: He + rise * 0.6 });
}

/** A small box on a flat roof: stair housing, plant room, water tank. */
function rooftop(B: Build, b: Building, z: number, k: [number, number], out: Solid[]): void {
  const outer = b.shape[0].pts;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < outer.length; i += 2) {
    x0 = Math.min(x0, outer[i]);
    x1 = Math.max(x1, outer[i]);
    y0 = Math.min(y0, outer[i + 1]);
    y1 = Math.max(y1, outer[i + 1]);
  }
  const { rect } = bestRect(outer);
  const count = 1 + Math.floor(hash(k[0], k[1], B.set.seed, 20) * 2.2);
  for (let tries = 0, made = 0; tries < 8 && made < count; tries++) {
    const r = (salt: number) => hash(k[0], k[1], B.set.seed, 30 + tries * 7 + salt);
    const cx = x0 + (x1 - x0) * (0.15 + 0.7 * r(0));
    const cy = y0 + (y1 - y0) * (0.15 + 0.7 * r(1));
    const a = 1.2 + r(2) * 1.6;
    const bw = 1.2 + r(3) * 1.4;
    const h = 1.4 + r(4) * 1.4;
    const { ux, uy } = rect;
    const corners = [
      [cx - ux * a - -uy * bw, cy - uy * a - ux * bw],
      [cx + ux * a - -uy * bw, cy + uy * a - ux * bw],
      [cx + ux * a + -uy * bw, cy + uy * a + ux * bw],
      [cx - ux * a + -uy * bw, cy - uy * a + ux * bw],
    ];
    const inside = corners.every(([x, y]) => pointInRing(x, y, outer) && b.shape.slice(1).every((hole) => !pointInRing(x, y, hole.pts)));
    if (!inside) continue;
    const s = newSolid();
    prism(B, [{ pts: corners.flat(), seam: new Uint8Array(4) }], z, z + h, { roof: true, windows: false, pen: LINEWORK }, s);
    out.push(s);
    made++;
  }
}

/** All the solids for one building: the building itself and anything on its roof. */
export function building(B: Build, b: Building): Solid[] {
  const { set } = B;
  const outer = b.shape[0];
  const p = outer.pts;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]);
    x1 = Math.max(x1, p[i]);
    y0 = Math.min(y0, p[i + 1]);
    y1 = Math.max(y1, p[i + 1]);
  }
  const k = B.key((x0 + x1) / 2, (y0 + y1) / 2);
  const H = Math.max(2.5, b.h * set.heightScale);
  const z0 = Math.min(b.min * set.heightScale, H - 1);
  const solid = newSolid();
  const area = Math.abs(ringArea(p));
  const out: Solid[] = [solid];

  const simple = b.shape.length === 1 && !outer.seam.some((v) => v) && z0 === 0;
  if (simple && area > 20 && area < 650 && H <= 22 && hash(k[0], k[1], set.seed, 1) < set.pitched) {
    const { rect, fill } = bestRect(p);
    if (rect && fill > 0.84 && rect.w > 3) {
      const f = Math.sqrt(Math.min(1, fill));
      house(B, { ...rect, L: rect.L * f, w: rect.w * f }, 0, H, k, solid);
      return out;
    }
  }

  prism(B, b.shape, z0, H, { roof: true, windows: true, pen: LINEWORK }, solid);
  solid.casts.push({ ring: p, h: H });
  if (set.rooftops && area > 220 && H < 150 && hash(k[0], k[1], set.seed, 2) < 0.55) rooftop(B, b, H, k, out);
  return out;
}

/** A parked car: a body and a cabin. */
export function car(B: Build, x: number, y: number, ux: number, uy: number, k: number): Solid {
  const s = newSolid();
  const vx = -uy;
  const vy = ux;
  const box = (a0: number, a1: number, hw: number, z0: number, z1: number, roof: boolean) => {
    const pts = [x + ux * a0 - vx * hw, y + uy * a0 - vy * hw, x + ux * a1 - vx * hw, y + uy * a1 - vy * hw, x + ux * a1 + vx * hw, y + uy * a1 + vy * hw, x + ux * a0 + vx * hw, y + uy * a0 + vy * hw];
    prism(B, [{ pts, seam: new Uint8Array(4) }], z0, z1, { roof, windows: false, pen: LINEWORK }, s);
    return pts;
  };
  const van = k > 0.85;
  const len = van ? 2.6 : 2.2;
  const body = box(-len, len, 0.9, 0, van ? 1.9 : 0.95, true);
  if (!van) box(-1.25 + (k - 0.5) * 0.4, 0.95, 0.78, 0.95, 1.5, true);
  s.casts.push({ ring: body, h: van ? 1.9 : 1.4 });
  return s;
}
