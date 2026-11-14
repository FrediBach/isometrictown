import { tagLines, prism, type Build, type Line3, type Solid } from './buildings';
import { ringArea } from './geo';
import { LINEWORK, ROOFS } from './settings';
import { corners, offsetRing, type Rect } from './shape';

const ROOF_HATCH_MM = 0.7;

/**
 * How a pitched roof finishes at each end of its ridge. A party end meets the roof next
 * door; an inner end runs into another part of the same roof and is never seen.
 */
export type End = 'gable' | 'hip' | 'half' | 'party' | 'inner';

export type PitchSpec = {
  /** Walls. The ridge runs along rect.u. */
  rect: Rect;
  /** Height where the roof meets the wall tops. */
  He: number;
  /** Tangent of the pitch. */
  tan: number;
  /** At u = -L/2 and u = +L/2. */
  ends: [End, End];
  /** Eave overhang on the v = -w/2 and v = +w/2 sides. */
  sides: [number, number];
  /** Overhang at hipped ends and gable verges. */
  o: number;
  /** A decorated gable (1 stepped, 2 neck) on one end, rising above the roof. */
  front?: { end: 0 | 1; kind: 1 | 2 };
  hatch: boolean;
};

export type Pitched = { Hr: number; a0: number; a1: number; at: (u: number, v: number, z: number) => number[] };

/** Push a polyline in 3D, skipping repeated points. */
function poly(out: Line3[], pen: number, pts: number[][], closed = false): void {
  const flat: number[] = [];
  for (const p of pts) {
    const n = flat.length;
    if (n && Math.abs(flat[n - 3] - p[0]) < 1e-6 && Math.abs(flat[n - 2] - p[1]) < 1e-6 && Math.abs(flat[n - 1] - p[2]) < 1e-6) continue;
    flat.push(p[0], p[1], p[2]);
  }
  if (flat.length >= 6) out.push({ pen, pts: flat, closed });
}

function face(out: Solid, pts: number[][]): void {
  const flat: number[] = [];
  for (const p of pts) {
    const n = flat.length;
    if (n && Math.abs(flat[n - 3] - p[0]) < 1e-6 && Math.abs(flat[n - 2] - p[1]) < 1e-6 && Math.abs(flat[n - 1] - p[2]) < 1e-6) continue;
    flat.push(p[0], p[1], p[2]);
  }
  if (flat.length >= 9) out.faces.push([flat]);
}

/** How many hatch strokes fit between two ground points on paper. */
function strokes(B: Build, ax: number, ay: number, bx: number, by: number, z: number): number {
  const c = B.cam;
  return Math.max(1, Math.round(Math.hypot(c.sx(bx, by) - c.sx(ax, ay), c.sy(bx, by, z) - c.sy(ax, ay, z)) / c.gap(ROOF_HATCH_MM)));
}

/** Outline of a decorated gable across the end wall, from v = -hw to v = +hw, as [v, z] pairs. */
function gableProfile(kind: 1 | 2, hw: number, He: number, tan: number): [number, number][] {
  const Hr = He + hw * tan;
  const roof = (v: number) => He + (hw - Math.abs(v)) * tan;
  const left: [number, number][] = [[-hw, He]];
  if (kind === 1) {
    const n = Math.max(2, Math.min(5, Math.round(hw / 0.85)));
    const sw = hw / (n + 0.5);
    for (let j = 0; j < n; j++) {
      const top = roof(-hw + (j + 1) * sw) + 0.45;
      left.push([-hw + j * sw, top], [-hw + (j + 1) * sw, top]);
    }
    left.push([-0.5 * sw, Hr + 0.7]);
  } else {
    const shoulder = He + hw * tan * 0.6;
    left.push([-hw, He + 0.4], [-0.45 * hw, shoulder], [-0.32 * hw, shoulder], [-0.32 * hw, Hr + 0.6], [0, Hr + 1.3]);
  }
  const right = left
    .slice()
    .reverse()
    .map(([v, z]) => [-v, z] as [number, number]);
  return [...left, ...right];
}

/** A gabled, hipped or half-hipped roof over a rectangle, with overhangs. Walls are drawn separately. */
export function pitchedRoof(B: Build, S: PitchSpec, out: Solid): Pitched {
  const { rect, He, tan, ends, sides } = S;
  const { cx, cy, ux, uy, L, w } = rect;
  const vx = -uy;
  const vy = ux;
  const at = (u: number, v: number, z: number) => [cx + ux * u + vx * v, cy + uy * u + vy * v, z];
  const hw = w / 2;
  const Hr = He + hw * tan;
  const ue = [0, 0];
  const d = [0, 0];
  for (const k of [0, 1] as const) {
    const decorated = S.front?.end === k;
    switch (ends[k]) {
      case 'gable':
        ue[k] = L / 2 + (decorated ? 0 : S.o * 0.7);
        break;
      case 'hip':
        ue[k] = L / 2 + S.o;
        d[k] = hw + S.o;
        break;
      case 'half':
        ue[k] = L / 2;
        d[k] = hw * 0.4;
        break;
      default:
        ue[k] = L / 2;
    }
  }
  let a0 = -(ue[0] - d[0]);
  let a1 = ue[1] - d[1];
  if (a0 > a1) a0 = a1 = (a0 + a1) / 2;
  const R = [at(a0, 0, Hr), at(a1, 0, Hr)];
  const sv = [-1, 1];
  const sk = [-1, 1];
  const eaveZ = (s: number) => He - sides[s] * tan;
  const C = (k: number, s: number) => at(sk[k] * ue[k], sv[s] * (hw + sides[s]), eaveZ(s));
  const E = (k: number, s: number) => {
    if (d[k] === 0) return R[k];
    if (d[k] >= hw + sides[s] - 1e-6) return C(k, s);
    return at(sk[k] * ue[k], sv[s] * d[k], He + (hw - d[k]) * tan);
  };

  for (const s of [0, 1]) face(out, [C(0, s), C(1, s), E(1, s), R[1], R[0], E(0, s)]);
  for (const k of [0, 1]) {
    if (d[k] > 0) face(out, [E(k, 0), E(k, 1), R[k]]);
    const e = ends[k];
    if (e === 'hip') continue;
    const u = sk[k] * (L / 2);
    const decorated = S.front?.end === k ? S.front.kind : 0;
    if (decorated) {
      const prof = gableProfile(decorated, hw, He, tan).map(([v, z]) => at(u, v, z));
      face(out, prof);
      poly(out.lines, LINEWORK, prof);
    } else if (d[k] > 0) face(out, [at(u, -hw, He), at(u, -d[k], He + (hw - d[k]) * tan), at(u, d[k], He + (hw - d[k]) * tan), at(u, hw, He)]);
    else face(out, [at(u, -hw, He), at(u, 0, Hr), at(u, hw, He)]);
  }

  const pen = ROOFS;
  for (const s of [0, 1]) poly(out.lines, pen, [C(0, s), C(1, s)]);
  for (const k of [0, 1]) {
    if (ends[k] === 'party' || ends[k] === 'inner' || S.front?.end === k) continue;
    poly(out.lines, pen, [C(k, 0), E(k, 0), R[k], E(k, 1), C(k, 1)]);
    if (d[k] > 0) poly(out.lines, pen, [E(k, 0), E(k, 1)]);
  }
  if (a1 - a0 > 0.1) poly(out.lines, pen, R);

  if (S.hatch) {
    for (const s of [0, 1]) {
      const [x0, y0] = C(0, s);
      const [x1, y1] = C(1, s);
      const span = ue[0] + ue[1];
      const count = strokes(B, x0, y0, x1, y1, eaveZ(s));
      const step = span / count;
      const outer = hw + sides[s];
      for (let t = step / 2; t < span; t += step) {
        const u = -ue[0] + t;
        const inner = Math.max(0, d[0] - (u + ue[0]), d[1] - (ue[1] - u));
        if (outer - inner < 0.08) continue;
        out.lines.push({ pen, layer: 'roofHatch', pts: [...at(u, sv[s] * outer, eaveZ(s)), ...at(u, sv[s] * inner, He + (hw - inner) * tan)] });
      }
    }
    for (const k of [0, 1]) {
      if (d[k] === 0) continue;
      const hip = ends[k] === 'hip';
      const reach = hip ? hw + S.o : d[k];
      const z0 = hip ? He - S.o * tan : He + (hw - d[k]) * tan;
      const [x0, y0] = at(sk[k] * ue[k], -reach, z0);
      const [x1, y1] = at(sk[k] * ue[k], reach, z0);
      const count = strokes(B, x0, y0, x1, y1, z0);
      const step = (2 * reach) / count;
      for (let t = step / 2; t < 2 * reach; t += step) {
        const v = -reach + t;
        const depth = reach - Math.abs(v);
        if (depth < 0.08) continue;
        out.lines.push({ pen, layer: 'roofHatch', pts: [...at(sk[k] * ue[k], v, z0), ...at(sk[k] * (ue[k] - depth), v, z0 + depth * tan)] });
      }
    }
  }
  return { Hr, a0, a1, at };
}

/** A box from corner points, z0 to z1, with its top outline. */
function box(B: Build, ring: number[], z0: number, z1: number, out: Solid, pen = LINEWORK): void {
  prism(B, [{ pts: ring, seam: new Uint8Array(ring.length / 2) }], z0, z1, { roof: true, windows: false, pen }, out);
}

/** A chimney standing on the roof: from inside the roof up past it. */
export function chimney(B: Build, R: Pitched, u: number, v: number, du: number, dv: number, z0: number, top: number, out: Solid): void {
  const ring = [R.at(u - du, v - dv, 0), R.at(u + du, v - dv, 0), R.at(u + du, v + dv, 0), R.at(u - du, v + dv, 0)].flatMap((p) => [p[0], p[1]]);
  box(B, ring, z0, top, out);
}

/**
 * A dormer on a roof slope: a little gabled box whose front sits `inset` in from the
 * eave and whose back runs into the roof. `axis` points out of the slope, level.
 */
export function dormer(B: Build, x: number, y: number, ax: number, ay: number, depth: number, z0: number, zFront: number, out: Solid): void {
  tagLines('details', out, () => dormerLines(B, x, y, ax, ay, depth, z0, zFront, out));
}

function dormerLines(B: Build, x: number, y: number, ax: number, ay: number, depth: number, z0: number, zFront: number, out: Solid): void {
  const dw = 0.75;
  const rect: Rect = { cx: x - (ax * depth) / 2, cy: y - (ay * depth) / 2, ux: ax, uy: ay, L: depth, w: dw * 2 };
  const Hd = zFront + 1.25;
  prism(B, [{ pts: corners(rect), seam: new Uint8Array(4) }], z0, Hd, { roof: false, windows: false, pen: LINEWORK }, out);
  pitchedRoof(B, { rect, He: Hd, tan: 1, ends: ['inner', 'gable'], sides: [0.1, 0.1], o: 0.15, hatch: false }, out);
  const vx = -ay;
  const vy = ax;
  const zb = zFront + 0.2;
  const zt = Hd - 0.2;
  const h = dw * 0.55;
  out.lines.push({ pen: LINEWORK, pts: [x - vx * h, y - vy * h, zb, x + vx * h, y + vy * h, zb, x + vx * h, y + vy * h, zt, x - vx * h, y - vy * h, zt], closed: true });
}

/**
 * A roof that slopes in from every edge of any footprint, then stops flat: a mansard
 * when steep, a pitched skirt round a block when not. Party walls rise straight up as
 * fire walls. False if the footprint is too narrow for the inset.
 */
export function skirtRoof(B: Build, rings: { pts: number[]; seam: Uint8Array; party?: Float32Array }[], He: number, inset: number, tan: number, dormers: boolean, out: Solid): boolean {
  const insetRings: number[][] = [];
  for (const [ri, r] of rings.entries()) {
    // Small light wells keep straight walls; only real courtyards get a sloping roof.
    const well = ri > 0 && Math.abs(ringArea(r.pts)) < 150;
    const edge = (i: number) => (well || r.seam[i] || (r.party && r.party[i] > 0) ? 0 : inset);
    const o = offsetRing(r.pts, edge);
    if (!o) return false;
    insetRings.push(o);
  }
  const Ht = He + inset * tan;
  const pen = ROOFS;
  const { cam } = B;
  const [upx, upy] = cam.up;
  rings.forEach((r, ri) => {
    const p = r.pts;
    const q = insetRings[ri];
    const n = p.length / 2;
    const well = ri > 0 && Math.abs(ringArea(p)) < 150;
    const flat = (i: number) => well || !!(r.seam[i] || (r.party && r.party[i] > 0));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const A = [p[i * 2], p[i * 2 + 1], He];
      const Bv = [p[j * 2], p[j * 2 + 1], He];
      const A2 = [q[i * 2], q[i * 2 + 1], Ht];
      const B2 = [q[j * 2], q[j * 2 + 1], Ht];
      face(out, [A, Bv, B2, A2]);
      if (r.seam[i]) continue;
      poly(out.lines, flat(i) ? LINEWORK : pen, [A2, B2]);
      if (flat(i)) continue;
      poly(out.lines, pen, [A, Bv]);
      const h = (i - 1 + n) % n;
      const ex = p[j * 2] - p[i * 2];
      const ey = p[j * 2 + 1] - p[i * 2 + 1];
      const fx = p[i * 2] - p[h * 2];
      const fy = p[i * 2 + 1] - p[h * 2 + 1];
      const cos = (ex * fx + ey * fy) / (Math.hypot(ex, ey) * Math.hypot(fx, fy) || 1);
      if (cos < 0.92 || flat(h)) poly(out.lines, pen, [A, A2]);
      if (flat((i + 1) % n)) poly(out.lines, pen, [Bv, B2]);
      const len = Math.hypot(ex, ey);
      // Outward normal (to the right of a counter-clockwise edge) faces the viewer?
      const front = ey * upx - ex * upy < 0;
      if (B.set.roofHatch && front) {
        const count = strokes(B, A[0], A[1], Bv[0], Bv[1], He);
        for (let k = 0; k < count; k++) {
          const t = (k + 0.5) / count;
          out.lines.push({ pen, layer: 'roofHatch', pts: [A[0] + ex * t, A[1] + ey * t, He, A2[0] + (B2[0] - A2[0]) * t, A2[1] + (B2[1] - A2[1]) * t, Ht] });
        }
      }
      if (dormers && front && tan > 1.5 && ri === 0 && len >= 3.4) {
        const count = Math.floor(len / 3.4);
        const inx = -ey / len;
        const iny = ex / len;
        for (let k = 0; k < count; k++) {
          const t = (k + 0.5) / count;
          const t0 = 0.35;
          const x = p[i * 2] + ex * t + inx * t0;
          const y = p[i * 2 + 1] + ey * t + iny * t0;
          dormer(B, x, y, -inx, -iny, inset - t0, He, He + t0 * tan, out);
        }
      }
    }
  });
  out.faces.push(insetRings.map((q) => q.flatMap((v, i) => (i % 2 ? [v, Ht] : [v]))));
  return true;
}

/** A flat roof's parapet: a second outline just inside the edge. */
export function parapet(B: Build, rings: { pts: number[]; seam: Uint8Array; party?: Float32Array }[], z: number, out: Solid): void {
  tagLines('details', out, () => parapetLines(B, rings, z, out));
}

function parapetLines(B: Build, rings: { pts: number[]; seam: Uint8Array; party?: Float32Array }[], z: number, out: Solid): void {
  const s = B.cam.s;
  if (B.cam.lod < 0.4) return;
  const d = Math.min(1.2, Math.max(0.4, 0.6 / s));
  for (const r of rings) {
    const skip = (i: number) => !!(r.seam[i] || (r.party && r.party[i] > 0));
    const q = offsetRing(r.pts, (i) => (skip(i) ? 0 : d));
    if (!q) continue;
    const n = q.length / 2;
    let cur: number[] | null = null;
    for (let k = 0; k <= n; k++) {
      const i = k % n;
      if (k < n && !skip(i)) {
        const j = (i + 1) % n;
        if (!cur) {
          cur = [q[i * 2], q[i * 2 + 1], z];
          out.lines.push({ pen: LINEWORK, pts: cur });
        }
        cur.push(q[j * 2], q[j * 2 + 1], z);
      } else cur = null;
    }
  }
}

/** A mono-pitch roof rising from the v = -w/2 side to the v = +w/2 side. */
export function shedRoof(B: Build, rect: Rect, He: number, tan: number, out: Solid): void {
  const { cx, cy, ux, uy, L, w } = rect;
  const vx = -uy;
  const vy = ux;
  const at = (u: number, v: number, z: number) => [cx + ux * u + vx * v, cy + uy * u + vy * v, z];
  const a = L / 2;
  const b = w / 2;
  const Hh = He + w * tan;
  const lo0 = at(-a, -b, He);
  const lo1 = at(a, -b, He);
  const hi0 = at(-a, b, Hh);
  const hi1 = at(a, b, Hh);
  face(out, [lo0, lo1, hi1, hi0]);
  face(out, [at(-a, b, He), at(a, b, He), hi1, hi0]);
  face(out, [lo0, at(-a, b, He), hi0]);
  face(out, [lo1, at(a, b, He), hi1]);
  poly(out.lines, ROOFS, [lo0, lo1, hi1, hi0], true);
  poly(out.lines, LINEWORK, [at(-a, b, He), hi0]);
  poly(out.lines, LINEWORK, [at(a, b, He), hi1]);
  if (B.set.roofHatch) {
    const count = strokes(B, lo0[0], lo0[1], lo1[0], lo1[1], He);
    for (let k = 0; k < count; k++) {
      const u = -a + ((k + 0.5) / count) * L;
      out.lines.push({ pen: ROOFS, layer: 'roofHatch', pts: [...at(u, -b, He), ...at(u, b, Hh)] });
    }
  }
}

/** A factory roof of north-light teeth along the rectangle's length. */
export function sawtoothRoof(rect: Rect, He: number, out: Solid): void {
  const { cx, cy, ux, uy, L, w } = rect;
  const vx = -uy;
  const vy = ux;
  const at = (u: number, v: number, z: number) => [cx + ux * u + vx * v, cy + uy * u + vy * v, z];
  const n = Math.max(2, Math.round(L / 7));
  const tl = L / n;
  const ht = Math.min(2.6, tl * 0.38);
  const b = w / 2;
  poly(out.lines, LINEWORK, [at(-L / 2, -b, He), at(L / 2, -b, He), at(L / 2, b, He), at(-L / 2, b, He)], true);
  for (let k = 0; k < n; k++) {
    const u0 = -L / 2 + k * tl;
    const u1 = u0 + tl;
    const top = He + ht;
    face(out, [at(u0, -b, He), at(u0, b, He), at(u1, b, top), at(u1, -b, top)]);
    face(out, [at(u1, -b, He), at(u1, b, He), at(u1, b, top), at(u1, -b, top)]);
    face(out, [at(u0, -b, He), at(u1, -b, He), at(u1, -b, top)]);
    face(out, [at(u0, b, He), at(u1, b, He), at(u1, b, top)]);
    poly(out.lines, ROOFS, [at(u1, -b, top), at(u1, b, top)]);
    poly(out.lines, ROOFS, [at(u0, -b, He), at(u1, -b, top)]);
    poly(out.lines, ROOFS, [at(u0, b, He), at(u1, b, top)]);
    if (k > 0) poly(out.lines, ROOFS, [at(u0, -b, He), at(u0, b, He)]);
    const mull = Math.max(1, Math.round(w / 1.6));
    for (let m = 0; m <= mull; m++) {
      const v = -b + (m / mull) * w;
      out.lines.push({ pen: LINEWORK, pts: [...at(u1, v, He), ...at(u1, v, top)] });
    }
  }
}

/** A regular polygon ring around a point. */
function ngon(x: number, y: number, r: number, n: number, phase = 0): number[] {
  const pts: number[] = [];
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * Math.PI * 2;
    pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  return pts;
}

/** A pyramid or cone over a ring, to an apex: spires, minaret caps. */
export function spire(ring: number[], z: number, apex: number[], out: Solid, pen = ROOFS): void {
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    face(out, [[ring[i * 2], ring[i * 2 + 1], z], [ring[j * 2], ring[j * 2 + 1], z], apex]);
  }
  // Every edge for a pyramid; every other one for a cone, which reads as rounded.
  const every = n > 4 ? 2 : 1;
  for (let i = 0; i < n; i += every) poly(out.lines, pen, [[ring[i * 2], ring[i * 2 + 1], z], apex]);
}

/** A dome on a drum, outlined by its true silhouette. */
export function dome(B: Build, x: number, y: number, r: number, z: number, out: Solid): void {
  const drum = r * 0.3;
  box(B, ngon(x, y, r, 20), z, z + drum, out, ROOFS);
  const zc = z + drum;
  const rings = 5;
  const segs = 20;
  const pt = (i: number, k: number) => {
    const phi = (i / rings) * (Math.PI / 2);
    const th = (k / segs) * Math.PI * 2;
    return [x + Math.cos(th) * Math.cos(phi) * r, y + Math.sin(th) * Math.cos(phi) * r, zc + Math.sin(phi) * r];
  };
  for (let i = 0; i < rings; i++) for (let k = 0; k < segs; k++) face(out, [pt(i, k), pt(i, k + 1), pt(i + 1, k + 1), pt(i + 1, k)]);
  // In an orthographic view a sphere's outline is the great circle square to the view.
  const { cam } = B;
  const dx = cam.sb * cam.ca;
  const dy = cam.cb * cam.ca;
  const dz = -cam.sa;
  const e1 = [cam.cb, -cam.sb, 0];
  const e2 = [dy * e1[2] - dz * e1[1], dz * e1[0] - dx * e1[2], dx * e1[1] - dy * e1[0]];
  const l2 = Math.hypot(e2[0], e2[1], e2[2]);
  const sil: number[][] = [];
  for (let k = 0; k <= 48; k++) {
    const t = (k / 48) * Math.PI * 2;
    const p = [0, 1, 2].map((a) => Math.cos(t) * e1[a] * r + (Math.sin(t) * e2[a] * r) / l2);
    if (p[2] >= -1e-6) sil.push([x + p[0] * 1.01, y + p[1] * 1.01, zc + p[2] * 1.01]);
    else if (sil.length) {
      poly(out.lines, ROOFS, sil.splice(0));
    }
  }
  poly(out.lines, ROOFS, sil);
  poly(out.lines, ROOFS, [[x, y, zc + r], [x, y, zc + r + Math.max(1, r * 0.25)]]);
}

/** A minaret: a slim tower with a balcony and a pointed cap. */
export function minaret(B: Build, x: number, y: number, h: number, out: Solid): void {
  const r = 1.3;
  box(B, ngon(x, y, r, 8), 0, h, out);
  box(B, ngon(x, y, r * 1.5, 8), h * 0.78, h * 0.78 + 0.6, out);
  spire(ngon(x, y, r, 8), h, [x, y, h + 3.2], out);
}

/** A church tower with belfry openings and a spire, square on its side s. */
export function tower(B: Build, x: number, y: number, ux: number, uy: number, s: number, h: number, out: Solid, top: 'spire' | 'onion' = 'spire'): void {
  const vx = -uy;
  const vy = ux;
  const a = s / 2;
  const ring = [x - ux * a - vx * a, y - uy * a - vy * a, x + ux * a - vx * a, y + uy * a - vy * a, x + ux * a + vx * a, y + uy * a + vy * a, x - ux * a + vx * a, y - uy * a + vy * a];
  prism(B, [{ pts: ring, seam: new Uint8Array(4) }], 0, h, { roof: true, windows: false, pen: LINEWORK }, out);
  const [upx, upy] = B.cam.up;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const ex = ring[j * 2] - ring[i * 2];
    const ey = ring[j * 2 + 1] - ring[i * 2 + 1];
    if (ey * upx - ex * upy >= 0) continue;
    const mx = (ring[i * 2] + ring[j * 2]) / 2;
    const my = (ring[i * 2 + 1] + ring[j * 2 + 1]) / 2;
    const hx = ex * 0.17;
    const hy = ey * 0.17;
    out.lines.push({ pen: LINEWORK, pts: [mx - hx, my - hy, h - 3.4, mx + hx, my + hy, h - 3.4, mx + hx, my + hy, h - 1.2, mx - hx, my - hy, h - 1.2], closed: true });
  }
  if (top === 'onion') onion(B, x, y, s * 0.42, h, out);
  else spire(ring, h, [x, y, h + s * 2.4], out);
}

/** The bulb profile of an onion dome: (height, radius) as fractions of its size. */
const ONION: [number, number][] = [
  [0, 0.7],
  [0.12, 0.95],
  [0.3, 1.12],
  [0.48, 1.0],
  [0.66, 0.62],
  [0.82, 0.28],
  [1, 0],
];

/** An onion dome on a short drum, with a spike on top. */
export function onion(B: Build, x: number, y: number, R: number, z: number, out: Solid): void {
  const drum = ngon(x, y, R * 0.8, 12);
  box(B, drum, z, z + R * 0.6, out, LINEWORK);
  const z0 = z + R * 0.6;
  const H = R * 2.6;
  const n = 14;
  const rings = ONION.map(([t, f]) => ({ z: z0 + t * H, pts: ngon(x, y, Math.max(1e-3, R * f), n) }));
  for (let k = 0; k + 1 < rings.length; k++) {
    const a = rings[k];
    const b = rings[k + 1];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      face(out, [
        [a.pts[i * 2], a.pts[i * 2 + 1], a.z],
        [a.pts[j * 2], a.pts[j * 2 + 1], a.z],
        [b.pts[j * 2], b.pts[j * 2 + 1], b.z],
        [b.pts[i * 2], b.pts[i * 2 + 1], b.z],
      ]);
    }
  }
  // The outline: each ring's leftmost and rightmost point on the sheet, joined up the bulb.
  const left: number[][] = [];
  const right: number[][] = [];
  for (const r of rings) {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < n; i++) {
      const sx = B.cam.sx(r.pts[i * 2], r.pts[i * 2 + 1]);
      if (sx < B.cam.sx(r.pts[lo * 2], r.pts[lo * 2 + 1])) lo = i;
      if (sx > B.cam.sx(r.pts[hi * 2], r.pts[hi * 2 + 1])) hi = i;
    }
    left.push([r.pts[lo * 2], r.pts[lo * 2 + 1], r.z]);
    right.push([r.pts[hi * 2], r.pts[hi * 2 + 1], r.z]);
  }
  poly(out.lines, ROOFS, [...left, ...right.reverse()]);
  // The waist, where the bulb is widest.
  const w = rings[2];
  const waist: number[][] = [];
  for (let i = 0; i <= n; i++) waist.push([w.pts[(i % n) * 2], w.pts[(i % n) * 2 + 1], w.z]);
  poly(out.lines, ROOFS, waist);
  poly(out.lines, LINEWORK, [
    [x, y, z0 + H],
    [x, y, z0 + H + R * 1.2],
  ]);
}
