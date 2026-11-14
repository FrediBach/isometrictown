import type { Camera } from './camera';
import type { Info } from './classify';
import { pointInRing, ringArea } from './geo';
import { hash } from './rng';
import { chimney, dome, dormer, minaret, parapet, pitchedRoof, sawtoothRoof, shedRoof, skirtRoof, tower, type End, type Pitched } from './roofs';
import { LINEWORK, ROOFS, SHADOWS, type Settings } from './settings';
import { bestRect, corners, orthoParts, turn, type Part, type Rect } from './shape';
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
  /** Traffic keeps to the left. */
  left: boolean;
};

/** A wall ring, optionally with the neighbour's height on each party-wall edge. */
export type WallRing = Ring & { party?: Float32Array };

const CREASE = Math.cos((24 * Math.PI) / 180);
const BAY = 3.4;
const SHADE_MM = 0.75;
/** Height of a shop's ground floor; the upper floors' windows start above it. */
const SHOP_H = 3.6;

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

/** `shop` is the direction of the street: walls facing it get shop fronts on the ground floor. */
type PrismOptions = { roof: boolean; windows: boolean; pen: number; topPen?: number; shop?: [number, number]; balconies?: 0 | 1 | 2; street?: [number, number]; door?: boolean; shutters?: number };

/**
 * Walls and an optional flat roof over footprint rings, from z0 to z1. Where a wall is a
 * party wall, only the part above the neighbour shows.
 */
export function prism(B: Build, rings: WallRing[], z0: number, z1: number, o: PrismOptions, out: Solid): void {
  const { set, cam } = B;
  const s = cam.s;
  rings.forEach((ring, ri) => {
    const p = ring.pts;
    const n = p.length / 2;
    const front = new Uint8Array(n);
    const next = (i: number) => (ring.party ? ring.party[i] : 0);
    // The front door goes in the longest outside wall facing the street.
    let doorEdge = -1;
    if (o.door && o.street && ri === 0 && z0 === 0) {
      let best = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const len = Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]);
        if (ring.seam[i] || next(i) > 0 || len < 2.6) continue;
        const dot = ((p[j * 2 + 1] - p[i * 2 + 1]) * o.street[0] - (p[j * 2] - p[i * 2]) * o.street[1]) / len;
        if (dot > 0.55 && dot * len > best) {
          best = dot * len;
          doorEdge = i;
        }
      }
    }
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
      const shop = !!o.shop && cam.s >= 0.5 && zb === 0 && len >= 3.5 && z1 > SHOP_H + 0.5 && ((by - ay) * o.shop[0] - (bx - ax) * o.shop[1]) / len > 0.55;
      if (shop) shopfront(B, ax, ay, bx, by, len, out);
      if (o.windows && set.windows && len >= 2.4) {
        // French balconies run along the street front only.
        const toStreet = o.street ? ((by - ay) * o.street[0] - (bx - ax) * o.street[1]) / len > 0.55 : false;
        const bal = o.balconies === 2 && !toStreet ? 0 : (o.balconies ?? 0);
        windows(B, ax, ay, bx, by, len, shop ? SHOP_H : zb, z1, out, { balconies: bal, door: i === doorEdge && !shop, shutters: o.shutters ?? -1 });
      }
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
  });
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

type WindowOptions = { balconies: 0 | 1 | 2; door: boolean; shutters: number };

function windows(B: Build, ax: number, ay: number, bx: number, by: number, len: number, z0: number, z1: number, out: Solid, wo: WindowOptions = { balconies: 0, door: false, shutters: -1 }): void {
  const { balconies } = wo;
  const s = B.cam.s;
  const full = s * 1.2 >= 0.85;
  if (!full && s * 1.5 < 0.5) return;
  const cols = Math.max(1, Math.floor(len / BAY));
  const bay = len / cols;
  const half = Math.min(0.62, bay * 0.3);
  const dx = (bx - ax) / len;
  const dy = (by - ay) / len;
  const doorCol = wo.door && full ? Math.floor(cols / 2) : -1;
  if (doorCol >= 0) {
    // The door: taller than a window, down to the ground, with a little hood over it.
    const m = (doorCol + 0.5) * bay;
    const P = (u: number, n: number, z: number) => [ax + dx * u + dy * n, ay + dy * u - dx * n, z];
    out.lines.push({ pen: LINEWORK, pts: [...P(m - 0.55, 0, z0), ...P(m - 0.55, 0, z0 + 2.2), ...P(m + 0.55, 0, z0 + 2.2), ...P(m + 0.55, 0, z0)] });
    out.lines.push({ pen: LINEWORK, pts: [...P(m - 0.8, 0, z0 + 2.45), ...P(m - 0.8, 0.45, z0 + 2.45), ...P(m + 0.8, 0.45, z0 + 2.45), ...P(m + 0.8, 0, z0 + 2.45)] });
  }
  for (let zb = z0 + 0.95, floor = 0; zb + 1.45 <= z1 - 0.35; zb += B.style.floor, floor++) {
    const zt = zb + 1.45;
    // Haussmann fronts: one continuous railed balcony on the second floor and another on the fifth.
    if (balconies === 2 && full && (floor === 2 || floor === 5) && zb > z0 + 1.5) balcony(out, ax, ay, dx, dy, len / 2, len / 2 - 0.3, zb - 0.95, 0.45);
    for (let c = 0; c < cols; c++) {
      const m = (c + 0.5) * bay;
      if (!full) {
        const x = ax + dx * m;
        const y = ay + dy * m;
        out.lines.push({ pen: LINEWORK, pts: [x, y, zb, x, y, zt] });
        continue;
      }
      if (floor === 0 && c === doorCol) continue;
      const px = ax + dx * (m - half);
      const py = ay + dy * (m - half);
      const qx = ax + dx * (m + half);
      const qy = ay + dy * (m + half);
      out.lines.push({ pen: LINEWORK, pts: [px, py, zb, qx, qy, zb, qx, qy, zt, px, py, zt], closed: true });
      // Shutters folded back either side.
      if (wo.shutters >= 0 && bay >= 2.4)
        for (const [u0, u1] of [
          [m - half - 0.42, m - half - 0.06],
          [m + half + 0.06, m + half + 0.42],
        ])
          out.lines.push({ pen: wo.shutters, pts: [ax + dx * u0, ay + dy * u0, zb, ax + dx * u1, ay + dy * u1, zb, ax + dx * u1, ay + dy * u1, zt, ax + dx * u0, ay + dy * u0, zt], closed: true });
      // Balconies from the first floor up: deep ones on alternate bays, shallow ones at every window.
      if (balconies === 1 && zb > z0 + 1.5 && c % 2 === 0 && bay >= 2.6) balcony(out, ax, ay, dx, dy, m, Math.min(bay * 0.42, 1.7), zb - 0.95, balconies === 1 ? 1.1 : 0.3);
    }
  }
}

/** A balcony in front of a window: a slab with a railing round it. (dx, dy) runs along the wall. */
function balcony(out: Solid, ax: number, ay: number, dx: number, dy: number, m: number, hw: number, zf: number, d: number): void {
  // Outward from the wall (rings run counter-clockwise).
  const nx = dy;
  const ny = -dx;
  const P = (u: number, n: number, z: number) => [ax + dx * u + nx * n, ay + dy * u + ny * n, z];
  const top = zf + 1.0;
  const bot = zf - 0.15;
  const front = [P(m - hw, d, bot), P(m + hw, d, bot), P(m + hw, d, top), P(m - hw, d, top)];
  out.faces.push([front.flat()]);
  for (const u of [m - hw, m + hw]) out.faces.push([[...P(u, 0, bot), ...P(u, d, bot), ...P(u, d, top), ...P(u, 0, top)]]);
  out.lines.push({ pen: LINEWORK, pts: front.flat(), closed: true });
  out.lines.push({ pen: LINEWORK, pts: [...P(m - hw, 0, top), ...P(m - hw, d, top)] }, { pen: LINEWORK, pts: [...P(m + hw, 0, top), ...P(m + hw, d, top)] });
  out.lines.push({ pen: LINEWORK, pts: [...P(m - hw, 0, bot), ...P(m - hw, d, bot)] }, { pen: LINEWORK, pts: [...P(m + hw, 0, bot), ...P(m + hw, d, bot)] });
  out.lines.push({ pen: LINEWORK, pts: [...P(m - hw, d, zf), ...P(m + hw, d, zf)] });
  const n = Math.max(2, Math.round((hw * 2) / 0.7));
  for (let k = 1; k < n; k++) {
    const u = m - hw + (2 * hw * k) / n;
    out.lines.push({ pen: LINEWORK, pts: [...P(u, d, zf), ...P(u, d, top)] });
  }
}

/** A shop front along a wall: wide windows, and striped awnings over most of them. */
function shopfront(B: Build, ax: number, ay: number, bx: number, by: number, len: number, out: Solid): void {
  const s = B.cam.s;
  if (s < 0.5) return;
  const cols = Math.max(1, Math.floor(len / 4.2));
  const bay = len / cols;
  const dx = (bx - ax) / len;
  const dy = (by - ay) / len;
  // Outward, away from the building (rings run counter-clockwise).
  const nx = dy;
  const ny = -dx;
  const P = (u: number, n: number, z: number) => [ax + dx * u + nx * n, ay + dy * u + ny * n, z];
  out.lines.push({ pen: LINEWORK, pts: [...P(0, 0, SHOP_H - 0.25), ...P(len, 0, SHOP_H - 0.25)] });
  for (let c = 0; c < cols; c++) {
    const m = (c + 0.5) * bay;
    const hw = bay * 0.36;
    out.lines.push({ pen: LINEWORK, pts: [...P(m - hw, 0, 0.35), ...P(m + hw, 0, 0.35), ...P(m + hw, 0, 2.6), ...P(m - hw, 0, 2.6)], closed: true });
    const [k0, k1] = B.key(ax + dx * m, ay + dy * m);
    if (hash(k0, k1, B.set.seed, 340) < 0.25 || s < 0.45) continue;
    // The awning: a sloping canvas with a short valance, striped in the roof pen.
    const aw = bay * 0.42;
    const deep = 1.3;
    const top = [P(m - aw, 0, 3.1), P(m + aw, 0, 3.1), P(m + aw, deep, 2.55), P(m - aw, deep, 2.55)];
    const val = [P(m - aw, deep, 2.55), P(m + aw, deep, 2.55), P(m + aw, deep, 2.25), P(m - aw, deep, 2.25)];
    out.faces.push([top.flat()], [val.flat()]);
    out.lines.push({ pen: LINEWORK, pts: top.flat(), closed: true }, { pen: LINEWORK, pts: val.flat(), closed: true });
    const n = Math.max(2, Math.round((aw * 2) / 0.45));
    for (let k = 1; k < n; k++) {
      const u = m - aw + (aw * 2 * k) / n;
      if (k % 2) out.lines.push({ pen: ROOFS, pts: [...P(u, 0, 3.1), ...P(u, deep, 2.55), ...P(u, deep, 2.25)] });
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

  prism(B, [wall], 0, He, { roof: false, windows: true, pen: LINEWORK, shop: shopSide(info), balconies: info.balconies, street: info.toStreet, door: hasDoor(info), shutters: info.shutters }, out);

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
    prism(B, rings, 0, He, { roof: false, windows: true, pen: LINEWORK, shop: shopSide(info), balconies: info.balconies, street: info.toStreet, door: hasDoor(info), shutters: info.shutters }, out);
    out.casts.push({ ring: rings[0].pts, h: He + rise * 0.7 });
    return true;
  }
  return false;
}

/** A flat-roofed building, with a parapet or a few boxes on top. */
function flat(B: Build, b: Building, rings: WallRing[], info: Info | undefined, z0: number, H: number, k: [number, number], out: Solid[]): void {
  const { set } = B;
  const solid = out[0];
  prism(B, rings, z0, H, { roof: true, windows: true, pen: LINEWORK, shop: z0 === 0 ? shopSide(info) : undefined, balconies: info?.balconies, street: info?.toStreet, door: hasDoor(info), shutters: info?.shutters }, solid);
  solid.casts.push({ ring: rings[0].pts, h: H });
  if (info?.castle && set.details) battlements(B, rings[0], b.shape.slice(1), H, out);
  else if (info?.parapet && set.details) parapet(B, rings, H, solid);
  const pad = !!info?.hospital && set.details && helipad(B, b, H, solid);
  const area = Math.abs(ringArea(rings[0].pts));
  if (!pad && set.rooftops && area > 220 && H < 150 && hash(k[0], k[1], set.seed, 2) < 0.55) rooftop(B, b, H, k, out);
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
  // Onion domes in the east and round the Alps, spires elsewhere.
  const onions = ONIONS[B.style.id] ?? 0;
  tower(B, x, y, r.ux, r.uy, s, h, out, hash(info.seed[0], info.seed[1], B.set.seed, 9) < onions ? 'onion' : 'spire');
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

function hasDoor(info: Info | undefined): boolean {
  return !!info && !info.shop && (info.kind === 'house' || info.kind === 'terrace' || info.kind === 'apartment' || info.kind === 'civic');
}

function shopSide(info: Info | undefined): [number, number] | undefined {
  return info?.shop ? info.toStreet : undefined;
}

/** All the solids for one building: the building itself and anything on its roof. */
export function building(B: Build, b: Building): Solid[] {
  const out = body(B, b);
  if (b.info?.townHall && B.set.details) flag(B, b, out);
  return out;
}

/** A flagpole on the roof with the flag out. */
function flag(B: Build, b: Building, out: Solid[]): void {
  const p = b.shape[0].pts;
  const { rect } = bestRect(p);
  if (!rect || B.cam.s < 0.3) return;
  const z = b.h * B.set.heightScale;
  const s = newSolid();
  const { cx: x, cy: y } = rect;
  s.lines.push({ pen: LINEWORK, pts: [x, y, z, x, y, z + 6] });
  const [ux, uy] = B.sun;
  const flagPts = [x, y, z + 6, x + ux * 2, y + uy * 2, z + 5.8, x + ux * 2, y + uy * 2, z + 4.6, x, y, z + 4.8];
  s.faces.push([flagPts]);
  s.lines.push({ pen: ROOFS, pts: flagPts, closed: true }, { pen: ROOFS, pts: [x + ux, y + uy, z + 5.9, x + ux, y + uy, z + 4.7] });
  out.push(s);
}

function body(B: Build, b: Building): Solid[] {
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

/** Battlements along a castle's outer walls, and pointed turrets at its corners. */
function battlements(B: Build, ring: WallRing, holes: Ring[], z: number, out: Solid[]): void {
  if (B.cam.s < 0.3) return;
  const s = newSolid();
  const p = ring.pts;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    if (ring.seam[i] || (ring.party && ring.party[i] > 0)) continue;
    const j = (i + 1) % n;
    const ax = p[i * 2];
    const ay = p[i * 2 + 1];
    const len = Math.hypot(p[j * 2] - ax, p[j * 2 + 1] - ay);
    if (len < 2) continue;
    const ux = (p[j * 2] - ax) / len;
    const uy = (p[j * 2 + 1] - ay) / len;
    // Inward, for counter-clockwise rings.
    const nx = -uy * 0.5;
    const ny = ux * 0.5;
    for (let t = 0.35; t + 0.7 <= len - 0.2; t += 1.4) {
      const x0 = ax + ux * t;
      const y0 = ay + uy * t;
      const x1 = x0 + ux * 0.7;
      const y1 = y0 + uy * 0.7;
      prism(B, [{ pts: [x0, y0, x1, y1, x1 + nx, y1 + ny, x0 + nx, y0 + ny], seam: new Uint8Array(4) }], z, z + 0.9, { roof: true, windows: false, pen: LINEWORK }, s);
    }
  }
  out.push(s);
  // Turrets with pointed roofs at the corners of the keep, where that's the castle style.
  if (!TURRETS.has(B.style.id)) return;
  const { rect } = bestRect(p);
  if (!rect || rect.w < 12 || Math.abs(ringArea(p)) < 300) return;
  for (const [cx, cy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const x = rect.cx + rect.ux * cx * (rect.L / 2 - 0.5) - rect.uy * cy * (rect.w / 2 - 0.5);
    const y = rect.cy + rect.uy * cx * (rect.L / 2 - 0.5) + rect.ux * cy * (rect.w / 2 - 0.5);
    const ix = rect.cx + (x - rect.cx) * 0.9;
    const iy = rect.cy + (y - rect.cy) * 0.9;
    if (!pointInRing(ix, iy, p) || holes.some((h) => pointInRing(ix, iy, h.pts))) continue;
    const t = newSolid();
    const R = Math.min(3, rect.w * 0.14);
    const ring16: number[] = [];
    for (let q = 0; q < 16; q++) ring16.push(x + Math.cos((q / 16) * Math.PI * 2) * R, y + Math.sin((q / 16) * Math.PI * 2) * R);
    const top = z + 3.5;
    prism(B, [{ pts: ring16, seam: new Uint8Array(16) }], 0, top, { roof: false, windows: true, pen: LINEWORK }, t);
    cone(B, t, ring16, top, top + R * 2.2);
    t.casts.push({ ring: ring16, h: top + R });
    out.push(t);
  }
}

/** A cone over a ring at height z: faces for the depth buffer, outline from its sheet-space extremes. */
function cone(B: Build, s: Solid, ring: number[], z: number, apexZ: number, pen = ROOFS): void {
  const n = ring.length / 2;
  let cx = 0;
  let cy = 0;
  for (let q = 0; q < n; q++) {
    cx += ring[q * 2] / n;
    cy += ring[q * 2 + 1] / n;
  }
  const apex = [cx, cy, apexZ];
  let lo = 0;
  let hi = 0;
  for (let q = 0; q < n; q++) {
    const sx = B.cam.sx(ring[q * 2], ring[q * 2 + 1]);
    if (sx < B.cam.sx(ring[lo * 2], ring[lo * 2 + 1])) lo = q;
    if (sx > B.cam.sx(ring[hi * 2], ring[hi * 2 + 1])) hi = q;
    const m = (q + 1) % n;
    s.faces.push([[ring[q * 2], ring[q * 2 + 1], z, ring[m * 2], ring[m * 2 + 1], z, ...apex]]);
  }
  s.lines.push({ pen, pts: [ring[lo * 2], ring[lo * 2 + 1], z, ...apex, ring[hi * 2], ring[hi * 2 + 1], z] });
  // The rim, front half only: from one extreme round the near side to the other.
  const rim: number[] = [];
  const near = (q: number) => B.cam.depth(ring[q * 2], ring[q * 2 + 1], z) <= B.cam.depth(cx, cy, z);
  for (let k = 0; k <= n; k++) {
    const q = (lo + k) % n;
    if (!near(q) && q !== hi && q !== lo) {
      if (rim.length) break;
      continue;
    }
    rim.push(ring[q * 2], ring[q * 2 + 1], z);
    if (q === hi) break;
  }
  if (rim.length >= 6) s.lines.push({ pen: LINEWORK, pts: rim });
}

/** A helipad on a hospital's flat roof: a ring with an H in it. */
function helipad(B: Build, b: Building, z: number, out: Solid): boolean {
  const p = b.shape[0].pts;
  const { rect } = bestRect(p);
  if (!rect || B.cam.s < 0.3 || Math.abs(ringArea(p)) < 600) return false;
  const R = Math.min(5.5, rect.w / 2 - 1.5, rect.L / 2 - 1.5);
  if (R < 3 || !pointInRing(rect.cx, rect.cy, p)) return false;
  const zz = z + 0.02;
  const ring: number[] = [];
  for (let q = 0; q < 28; q++) ring.push(rect.cx + Math.cos((q / 28) * Math.PI * 2) * R, rect.cy + Math.sin((q / 28) * Math.PI * 2) * R, zz);
  out.lines.push({ pen: ROOFS, pts: ring, closed: true });
  const P = (a: number, c: number) => [rect.cx + rect.ux * a - rect.uy * c, rect.cy + rect.uy * a + rect.ux * c, zz];
  const h = R * 0.5;
  out.lines.push({ pen: ROOFS, pts: [...P(-h, -h * 0.7), ...P(h, -h * 0.7)] }, { pen: ROOFS, pts: [...P(-h, h * 0.7), ...P(h, h * 0.7)] }, { pen: ROOFS, pts: [...P(0, -h * 0.7), ...P(0, h * 0.7)] });
  return true;
}

/** Share of church towers topped with an onion dome, by region. */
const ONIONS: Partial<Record<string, number>> = { eastern: 0.65, alpine: 0.4, central: 0.3 };

/** Regions where castles carry pointed corner turrets. */
const TURRETS = new Set(['central', 'french', 'british', 'alpine', 'nordic', 'eastern', 'dutch', 'generic']);

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
  const inside = (x: number, y: number) => pointInRing(x, y, outer) && b.shape.slice(1).every((hole) => !pointInRing(x, y, hole.pts));
  const v = hash(k[0], k[1], B.set.seed, 21);
  const area = Math.abs(ringArea(outer));
  if (TANKS.has(B.style.id) && v < 0.4) {
    if (tanks(B, rect, z, k, inside, out)) return;
  } else if (SOLAR.has(B.style.id) && v < 0.35 && area > 150 && B.cam.s >= 0.6) {
    if (solar(B, rect, z, inside, out)) return;
  }
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
    if (!corners.every(([x, y]) => inside(x, y))) continue;
    const s = newSolid();
    prism(B, [{ pts: corners.flat(), seam: new Uint8Array(4) }], z, z + h, { roof: true, windows: false, pen: LINEWORK }, s);
    out.push(s);
    made++;
  }
}

/** Regions where flat roofs carry water tanks, and where they carry solar panels. */
const TANKS = new Set(['american', 'eastAsian', 'arid', 'tropical', 'mediterranean']);
const SOLAR = new Set(['central', 'nordic', 'alpine', 'dutch', 'british', 'antipodean', 'american', 'generic']);

/** One or two round water tanks: on legs with a conical lid in North America, squat drums elsewhere. */
function tanks(B: Build, rect: Rect, z: number, k: [number, number], inside: (x: number, y: number) => boolean, out: Solid[]): boolean {
  const tower = B.style.id === 'american';
  const count = tower ? 1 : 1 + Math.floor(hash(k[0], k[1], B.set.seed, 22) * 3);
  let made = 0;
  for (let i = 0; i < 8 && made < count; i++) {
    const r = (salt: number) => hash(k[0], k[1], B.set.seed, 600 + i * 7 + salt);
    const R = tower ? 1.8 + r(0) * 0.8 : 0.7 + r(0) * 0.4;
    const a = (r(1) - 0.5) * (rect.L - 2 * R - 1);
    const c = (r(2) - 0.5) * (rect.w - 2 * R - 1);
    const x = rect.cx + rect.ux * a - rect.uy * c;
    const y = rect.cy + rect.uy * a + rect.ux * c;
    if (![0, 1, 2, 3].every((q) => inside(x + Math.cos((q * Math.PI) / 2) * (R + 0.3), y + Math.sin((q * Math.PI) / 2) * (R + 0.3)))) continue;
    const s = newSolid();
    const legs = tower ? 2.6 : 0.4;
    const H = tower ? 3.4 + r(3) * 1.2 : 1.4;
    const ring: number[] = [];
    for (let q = 0; q < 16; q++) ring.push(x + Math.cos((q / 16) * Math.PI * 2) * R, y + Math.sin((q / 16) * Math.PI * 2) * R);
    prism(B, [{ pts: ring, seam: new Uint8Array(16) }], z + legs, z + legs + H, { roof: !tower, windows: false, pen: LINEWORK }, s);
    for (let q = 0; q < 4; q++) {
      const ang = ((q + 0.5) / 4) * Math.PI * 2;
      const lx = x + Math.cos(ang) * R * 0.75;
      const ly = y + Math.sin(ang) * R * 0.75;
      s.lines.push({ pen: LINEWORK, pts: [lx, ly, z, lx, ly, z + legs] });
    }
    if (tower) {
      const top = z + legs + H;
      cone(B, s, ring, top, top + R * 0.55);
    }
    out.push(s);
    made++;
  }
  return made > 0;
}

/** Rows of tilted solar panels across a flat roof. */
function solar(B: Build, rect: Rect, z: number, inside: (x: number, y: number) => boolean, out: Solid[]): boolean {
  // Panels run along whichever roof axis faces the sun best.
  const [sx, sy] = B.sun;
  const along = Math.abs(rect.ux * sx + rect.uy * sy) < Math.abs(-rect.uy * sx + rect.ux * sy);
  const r = along ? rect : { ...rect, ux: -rect.uy, uy: rect.ux, L: rect.w, w: rect.L };
  let vx = -r.uy;
  let vy = r.ux;
  if (vx * sx + vy * sy > 0) {
    vx = -vx;
    vy = -vy;
  }
  const s = newSolid();
  let rows = 0;
  for (let c = -r.w / 2 + 1.2; c + 1.4 < r.w / 2 - 0.8; c += 3.4) {
    let half = r.L / 2 - 1.0;
    const P = (a: number, d: number) => [r.cx + r.ux * a + vx * d, r.cy + r.uy * a + vy * d];
    while (half > 1.5 && ![P(-half, c), P(half, c), P(-half, c + 1.4), P(half, c + 1.4)].every(([x, y]) => inside(x, y))) half -= 1;
    if (half <= 1.5) continue;
    const [a0x, a0y] = P(-half, c);
    const [a1x, a1y] = P(half, c);
    const [b1x, b1y] = P(half, c + 1.4);
    const [b0x, b0y] = P(-half, c + 1.4);
    const quad = [a0x, a0y, z + 1.0, a1x, a1y, z + 1.0, b1x, b1y, z + 0.3, b0x, b0y, z + 0.3];
    s.faces.push([quad]);
    s.lines.push({ pen: LINEWORK, pts: quad, closed: true });
    rows++;
  }
  if (rows) out.push(s);
  return rows > 0;
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

