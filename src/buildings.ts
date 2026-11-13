import type { Camera } from './camera';
import type { Info } from './classify';
import { pointInRing, ringArea } from './geo';
import { hash } from './rng';
import { chimney, dome, dormer, minaret, parapet, pitchedRoof, sawtoothRoof, shedRoof, skirtRoof, tower, type End, type Pitched } from './roofs';
import { LINEWORK, SHADOWS, type Settings } from './settings';
import { bestRect, corners, orthoParts, turn, type Part } from './shape';
import type { Style } from './styles';
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
  /** The regional building style in use. */
  style: Style;
  /** Stable integer key for a local position, so randomness doesn't change when the view moves. */
  key: (x: number, y: number) => [number, number];
  /** Horizontal unit vector pointing towards the sun. */
  sun: [number, number];
};

/** A wall ring, optionally with the neighbour's height on each party-wall edge. */
export type WallRing = Ring & { party?: Float32Array };

const CREASE = Math.cos((24 * Math.PI) / 180);
const BAY = 3.4;
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

/**
 * Walls and an optional flat roof over footprint rings, from z0 to z1. Where a wall is a
 * party wall, only the part above the neighbour shows.
 */
export function prism(B: Build, rings: WallRing[], z0: number, z1: number, o: PrismOptions, out: Solid): void {
  const { set, cam } = B;
  const s = cam.s;
  for (const ring of rings) {
    const p = ring.pts;
    const n = p.length / 2;
    const front = new Uint8Array(n);
    const next = (i: number) => (ring.party ? ring.party[i] : 0);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const [ax, ay, bx, by] = [p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1]];
      if (ring.seam[i]) continue;
      if (!facing(B, ax, ay, bx, by)) continue;
      out.faces.push([[ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z1]]);
      const zb = Math.max(z0, next(i));
      if (zb >= z1 - 0.3) continue;
      front[i] = 1;
      const len = Math.hypot(bx - ax, by - ay);
      if (o.windows && set.windows && len >= 2.4) windows(B, ax, ay, bx, by, len, zb, z1, out);
      if (set.shadeWalls && (by - ay) * B.sun[0] - (bx - ax) * B.sun[1] < 0) {
        const ext = Math.abs((bx - ax) * cam.cb - (by - ay) * cam.sb) * s;
        const m = Math.floor(ext / SHADE_MM);
        for (let k = 1; k < m; k++) {
          const t = k / m;
          const x = ax + (bx - ax) * t;
          const y = ay + (by - ay) * t;
          out.lines.push({ pen: SHADOWS, pts: [x, y, zb, x, y, z1] });
        }
      }
    }
    if (o.roof) runs(ring, z1, (i) => !ring.seam[i], o.topPen ?? o.pen, out.lines);
    runs(ring, z0, (i) => front[i] === 1 && next(i) <= z0, o.pen, out.lines);
    for (let i = 0; i < n; i++) {
      const h = (i - 1 + n) % n;
      if (ring.seam[i] || ring.seam[h]) continue;
      if (!front[i] && !front[h]) continue;
      const zb = Math.max(z0, next(h), next(i));
      if (zb >= z1) continue;
      const j = (i + 1) % n;
      const e1x = p[i * 2] - p[h * 2];
      const e1y = p[i * 2 + 1] - p[h * 2 + 1];
      const e2x = p[j * 2] - p[i * 2];
      const e2y = p[j * 2 + 1] - p[i * 2 + 1];
      const cos = (e1x * e2x + e1y * e2y) / (Math.hypot(e1x, e1y) * Math.hypot(e2x, e2y) || 1);
      if (cos < CREASE || front[i] !== front[h]) out.lines.push({ pen: o.pen, pts: [p[i * 2], p[i * 2 + 1], zb, p[i * 2], p[i * 2 + 1], z1] });
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
  for (let zb = z0 + 0.95; zb + 1.45 <= z1 - 0.35; zb += B.style.floor) {
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

type HouseOptions = { roof: 'gabled' | 'hipped' | 'halfHipped'; tan: number; maxHe?: number; details: boolean };
type House = { main: Part; P: Pitched; He: number; tan: number };

/** Turn a part a quarter turn, keeping its side flags with the sides they belong to. */
function turnPart(part: Part): Part {
  const rot = (a: Uint8Array) => Uint8Array.from([a[1], a[2], a[3], a[0]]);
  return { rect: turn(part.rect), party: rot(part.party), outside: rot(part.outside) };
}

/** Which way a part's ridge runs: along the street, gable to the street, between party walls, or along its length. */
function orient(B: Build, part: Part, info: Info, roof: HouseOptions['roof'], main: boolean): Part {
  const r = part.rect;
  const dot = (v?: [number, number]) => (v ? Math.abs(r.ux * v[0] + r.uy * v[1]) : 0);
  const partyEnds = part.party[1] || part.party[3];
  const partySides = part.party[0] || part.party[2];
  let flip = false;
  let firm = false;
  if (main && info.across) {
    flip = true;
    firm = true;
  } else if (main && B.style.ridge === 'gableToStreet' && info.toStreet) flip = dot(info.toStreet) < Math.SQRT1_2;
  else if (partySides && !partyEnds) {
    flip = true;
    firm = true;
  } else if (partyEnds) flip = false;
  else if (main && B.style.ridge === 'street' && info.street && r.L / r.w < 1.6) flip = dot(info.street) < Math.SQRT1_2;
  // Hips sit best on the long axis, and a gable shouldn't span a very wide front.
  if (flip && !firm && (roof === 'hipped' || (r.L > 1.5 * r.w && r.L > 11))) flip = false;
  return flip ? turnPart(part) : part;
}

/**
 * A house with a pitched roof. Footprints that square up into a few rectangles get a
 * roof per rectangle, meeting as cross gables; near-rectangles get one roof over their
 * best-fit rectangle. Returns null when neither works.
 */
function house(B: Build, b: Building, info: Info, H: number, o: HouseOptions, out: Solid): House | null {
  const { set, style } = B;
  const p = b.shape[0].pts;
  const { rect, fill } = bestRect(p);
  if (!rect) return null;
  let tan = o.tan;
  const guessHe = Math.max(2.8, H - (rect.w / 2) * tan * 0.45);
  const ortho = orthoParts(p, info.party, guessHe - 1, rect);
  let parts: Part[];
  let wall: WallRing;
  if (ortho) {
    parts = ortho.parts;
    wall = { pts: ortho.ring, seam: new Uint8Array(ortho.ring.length / 2), party: ortho.party };
  } else if (fill > 0.84 && rect.w > 3) {
    const f = Math.sqrt(Math.min(1, fill));
    const r = { ...rect, L: rect.L * f, w: rect.w * f };
    parts = [{ rect: r, party: new Uint8Array(4), outside: new Uint8Array([1, 1, 1, 1]) }];
    wall = { pts: corners(r), seam: new Uint8Array(4) };
  } else return null;

  parts = parts.map((part, i) => orient(B, part, info, o.roof, i === 0));
  const main = parts[0];
  if (main.rect.w < 2.5) return null;
  // Keep the roof from towering over the house.
  tan = Math.min(tan, 13 / (main.rect.w / 2));
  const rise = (main.rect.w / 2) * tan;
  let He = Math.max(2.8, H - rise * 0.45);
  if (o.maxHe) He = Math.min(He, o.maxHe);

  prism(B, [wall], 0, He, { roof: false, windows: true, pen: LINEWORK }, out);

  const endKind: End = o.roof === 'hipped' ? 'hip' : o.roof === 'halfHipped' ? 'half' : 'gable';
  let P: Pitched | null = null;
  parts.forEach((part, i) => {
    const { rect: r, party, outside } = part;
    const end = (side: number): End => (party[side] ? 'party' : !outside[side] ? 'inner' : endKind === 'hip' && r.L < r.w ? 'gable' : endKind);
    const eave = (side: number) => (party[side] || !outside[side] ? 0 : style.overhang);
    const ends: [End, End] = [end(3), end(1)];
    let front: { end: 0 | 1; kind: 1 | 2 } | undefined;
    if (i === 0 && info.gableFront && info.toStreet) {
      const d = r.ux * info.toStreet[0] + r.uy * info.toStreet[1];
      const k = d > 0 ? 1 : 0;
      if (Math.abs(d) > 0.6 && ends[k] === 'gable') front = { end: k, kind: info.gableFront };
    }
    const made = pitchedRoof(B, { rect: r, He, tan, ends, sides: [eave(0), eave(2)], o: style.overhang, front, hatch: set.roofHatch }, out);
    if (i === 0) P = made;
  });
  out.casts.push({ ring: wall.pts, h: He + rise * 0.6 });
  if (o.details && set.details) roofDetails(B, info, main, P!, He, tan, out);
  return { main, P: P!, He, tan };
}

/** Chimneys and dormers on a house's main roof. */
function roofDetails(B: Build, info: Info, main: Part, P: Pitched, He: number, tan: number, out: Solid): void {
  const { rect: r, party } = main;
  const hw = r.w / 2;
  const [k0, k1] = info.seed;
  const rnd = (salt: number) => hash(k0, k1, B.set.seed, 300 + salt);
  const own = B.key(r.cx, r.cy);
  const mine = (salt: number) => hash(own[0], own[1], B.set.seed, 320 + salt);
  if (info.chimney) {
    if (party[1] || party[3]) {
      // Terraces share stacks on the party walls.
      const sk = party[1] ? 1 : -1;
      chimney(B, P, sk * (r.L / 2 - 0.35), 0, 0.35, 0.85, He, P.Hr + 0.9, out);
    } else {
      const u = P.a0 + (P.a1 - P.a0) * (0.2 + 0.6 * mine(1));
      const v = (rnd(2) < 0.5 ? -1 : 1) * hw * 0.35;
      chimney(B, P, u, v, 0.32, 0.32, He, He + (hw - Math.abs(v) + 0.4) * tan + 0.7, out);
    }
  }
  if (!info.dormers || hw * tan < 2.6 || tan < 0.55) return;
  const zFront = He + 1.0 * tan;
  if (zFront + 2.1 > P.Hr - 0.2) return;
  const [upx, upy] = B.cam.up;
  const vx = -r.uy;
  const vy = r.ux;
  const lo = Math.max(-r.L / 2 + 1.2, P.a0 - (P.a0 > -r.L / 2 + 0.01 ? 0 : Infinity));
  const hi = Math.min(r.L / 2 - 1.2, P.a1 + (P.a1 < r.L / 2 - 0.01 ? 0 : Infinity));
  const count = Math.min(4, Math.floor((hi - lo) / 3.2));
  for (const sv of [-1, 1]) {
    if (party[sv < 0 ? 0 : 2]) continue;
    const nx = sv * vx;
    const ny = sv * vy;
    if (nx * upx + ny * upy >= 0) continue;
    for (let i = 0; i < count; i++) {
      const u = lo + ((i + 0.5) * (hi - lo)) / count;
      const [x, y] = P.at(u, sv * (hw - 1.0), 0);
      dormer(B, x, y, nx, ny, hw - 1.0, He, zFront, out);
    }
  }
}

/** A roof sloping in from every edge: a mansard, or a pitched skirt round a block. */
function skirtBlock(B: Build, rings: WallRing[], H: number, info: Info, steep: boolean, out: Solid): boolean {
  const tan = steep ? Math.tan((72 * Math.PI) / 180) : Math.tan((info.pitch * Math.PI) / 180);
  for (const inset of steep ? [1.3, 0.9] : [3.2, 1.8]) {
    const rise = inset * tan;
    const He = Math.max(3, steep ? H - rise * 0.75 : H - rise * 0.5);
    if (!skirtRoof(B, rings, He, inset, tan, steep && info.dormers && B.set.details, out)) continue;
    prism(B, rings, 0, He, { roof: false, windows: true, pen: LINEWORK }, out);
    out.casts.push({ ring: rings[0].pts, h: He + rise * 0.7 });
    return true;
  }
  return false;
}

/** A flat-roofed building, with a parapet or a few boxes on top. */
function flat(B: Build, b: Building, rings: WallRing[], info: Info | undefined, z0: number, H: number, k: [number, number], out: Solid[]): void {
  const { set } = B;
  const solid = out[0];
  prism(B, rings, z0, H, { roof: true, windows: true, pen: LINEWORK }, solid);
  solid.casts.push({ ring: rings[0].pts, h: H });
  if (info?.parapet && set.details) parapet(B, rings, H, solid);
  const area = Math.abs(ringArea(rings[0].pts));
  if (set.rooftops && area > 220 && H < 150 && hash(k[0], k[1], set.seed, 2) < 0.55) rooftop(B, b, H, k, out);
}

/** A shed or sawtooth roof over a near-rectangular footprint. */
function oneWay(B: Build, b: Building, info: Info, H: number, out: Solid): boolean {
  const { rect, fill } = bestRect(b.shape[0].pts);
  if (!rect || fill < 0.8 || rect.w < 3) return false;
  const f = Math.sqrt(Math.min(1, fill));
  const r = { ...rect, L: rect.L * f, w: rect.w * f };
  const tan = Math.tan((info.pitch * Math.PI) / 180);
  const He = info.roof === 'shed' ? Math.max(2.4, H - r.w * tan * 0.5) : Math.max(3, H - 1.4);
  prism(B, [{ pts: corners(r), seam: new Uint8Array(4) }], 0, He, { roof: false, windows: true, pen: LINEWORK }, out);
  if (info.roof === 'shed') shedRoof(B, r, He, tan, out);
  else sawtoothRoof(r, He, out);
  out.casts.push({ ring: corners(r), h: He + 1.5 });
  return true;
}

/** A church: a steep nave with a tower and spire at the end facing the street. */
function church(B: Build, b: Building, info: Info, H: number, out: Solid): boolean {
  const made = house(B, b, info, Math.min(H, 22), { roof: 'gabled', tan: Math.tan((50 * Math.PI) / 180), maxHe: 14, details: false }, out);
  if (!made) return false;
  const r = made.main.rect;
  const s = Math.max(3.5, Math.min(9, r.w * 0.45));
  if (r.L < s * 2.2) return true;
  const d = info.toStreet ? r.ux * info.toStreet[0] + r.uy * info.toStreet[1] : hash(info.seed[0], info.seed[1], 7) - 0.5;
  const sk = d >= 0 ? 1 : -1;
  const x = r.cx + r.ux * sk * (r.L / 2 - s / 2);
  const y = r.cy + r.uy * sk * (r.L / 2 - s / 2);
  const ridge = made.P.Hr;
  const h = H > ridge + 6 ? Math.min(H, 90) : ridge + 4 + s * 0.8;
  tower(B, x, y, r.ux, r.uy, s, h, out);
  return true;
}

/** A mosque: a flat-roofed hall under a dome, with a minaret. */
function mosque(B: Build, b: Building, rings: WallRing[], info: Info, H: number, k: [number, number], out: Solid[]): boolean {
  const p = b.shape[0].pts;
  const { rect } = bestRect(p);
  if (!rect || rect.w < 5) return false;
  if (!pointInRing(rect.cx, rect.cy, p)) return false;
  const He = Math.min(H, 12);
  flat(B, b, rings, info, 0, He, k, out);
  const r = Math.max(2.5, Math.min(14, Math.min(rect.w, rect.L) * 0.33));
  dome(B, rect.cx, rect.cy, r, He, out[0]);
  if (Math.abs(ringArea(p)) > 120) {
    const vx = -rect.uy;
    const vy = rect.ux;
    const sk = hash(info.seed[0], info.seed[1], 8) < 0.5 ? -1 : 1;
    const a = rect.L / 2 - 1.8;
    const c = rect.w / 2 - 1.8;
    minaret(B, rect.cx + rect.ux * sk * a + vx * c, rect.cy + rect.uy * sk * a + vy * c, Math.max(18, Math.min(60, He * 2 + 10)), out[0]);
  }
  return true;
}

/** A temple: two tiers of hipped roofs with deep eaves. */
function temple(B: Build, b: Building, H: number, out: Solid): boolean {
  const { rect, fill } = bestRect(b.shape[0].pts);
  if (!rect || fill < 0.75 || rect.w < 5) return false;
  const f = Math.sqrt(Math.min(1, fill));
  const r = { ...rect, L: rect.L * f, w: rect.w * f };
  const He = Math.min(Math.max(3.5, H * 0.5), 7);
  const tan1 = Math.tan((27 * Math.PI) / 180);
  prism(B, [{ pts: corners(r), seam: new Uint8Array(4) }], 0, He, { roof: false, windows: true, pen: LINEWORK }, out);
  pitchedRoof(B, { rect: r, He, tan: tan1, ends: ['hip', 'hip'], sides: [1.1, 1.1], o: 1.1, hatch: B.set.roofHatch }, out);
  const inner = { ...r, L: r.L * 0.6, w: r.w * 0.6 };
  const He2 = He + (r.w / 2) * tan1 * 0.55 + 1.6;
  prism(B, [{ pts: corners(inner), seam: new Uint8Array(4) }], He, He2, { roof: false, windows: false, pen: LINEWORK }, out);
  pitchedRoof(B, { rect: inner, He: He2, tan: Math.tan((30 * Math.PI) / 180), ends: ['hip', 'hip'], sides: [0.8, 0.8], o: 0.8, hatch: B.set.roofHatch }, out);
  out.casts.push({ ring: corners(r), h: He2 + 1 });
  return true;
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
  const out: Solid[] = [solid];
  const info = b.info;
  const rings: WallRing[] = [{ ...outer, party: info?.party.map((v) => v * set.heightScale) }, ...b.shape.slice(1)];

  const seamless = !b.shape.some((r) => r.seam.some((v) => v));
  const simple = b.shape.length === 1 && seamless && z0 === 0;
  if (info && z0 === 0) {
    const tan = Math.tan((info.pitch * Math.PI) / 180);
    switch (info.roof) {
      case 'gabled':
      case 'hipped':
      case 'halfHipped':
        if (simple && house(B, b, info, H, { roof: info.roof, tan, details: true }, solid)) return out;
        if (seamless && B.style.blocks !== 'flat' && skirtBlock(B, rings, H, info, false, solid)) return out;
        break;
      case 'mansard':
      case 'skirt':
        if (seamless && skirtBlock(B, rings, H, info, info.roof === 'mansard', solid)) return out;
        break;
      case 'shed':
      case 'sawtooth':
        if (simple && oneWay(B, b, info, H, solid)) return out;
        break;
      case 'church':
        if (simple && church(B, b, info, H, solid)) return out;
        break;
      case 'mosque':
        if (seamless && mosque(B, b, rings, info, H, k, out)) return out;
        break;
      case 'temple':
        if (simple && temple(B, b, H, solid)) return out;
        break;
    }
  }
  flat(B, b, rings, info, z0, H, k, out);
  return out;
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
  if (!rect) return;
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

