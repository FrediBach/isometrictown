import type { Build, Solid } from './buildings';
import type { Kind, Roof } from './classify';
import { hash } from './rng';
import { LINEWORK } from './settings';
import type { StyleId } from './styles';

/** How a building's windows are laid out. */
export type Pattern = 'grid' | 'paired' | 'tall' | 'small' | 'irregular' | 'ribbon' | 'curtain' | 'blank' | 'clerestory' | 'officeEnd' | 'sparse';

/** A building's window scheme: one pattern and the sizes it is drawn at, all in metres. */
export type Facade = {
  pattern: Pattern;
  /** Window width and height; for paired windows, each one of the pair. */
  w: number;
  h: number;
  /** Window spacing along the wall, or mullion spacing in bands and curtain walls. */
  bay: number;
  /** Height of the sill above the floor. */
  sill: number;
  /** Storey height, 0 for the regional default, or more than 20 for one row of windows. */
  storey: number;
  /** How strongly the windows favour walls facing the equator, 0 to 1. */
  bias: number;
  /** Round-headed windows. */
  arch: boolean;
  /** Glazing bars, at high detail. */
  bars: boolean;
  /** Taller windows on the ground floor. */
  tallGround: boolean;
  /** Smaller windows on the top floor. */
  attic: boolean;
  /** One wide window on the sunny side of the ground floor. */
  picture: boolean;
  /** A column of half-landing windows up the stairwell, on walls away from the street. */
  stair: boolean;
  /** Big doors on the street side: 1 loading doors, 2 one garage door, 3 a row of garages. */
  doors: 0 | 1 | 2 | 3;
  /** Where an industrial hall's office windows cluster, and how far along the walls they reach. */
  at?: [number, number];
  reach?: number;
};

/** The plain grid, for anything drawn without a classified building behind it. */
export const PLAIN: Facade = { pattern: 'grid', w: 1.24, h: 1.45, bay: 3.4, sill: 0.95, storey: 0, bias: 0, arch: false, bars: false, tallGround: false, attic: false, picture: false, stair: false, doors: 0 };

/** One wall to put windows in. (ax, ay) to (bx, by) runs counter-clockwise round the footprint. */
export type Wall = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  len: number;
  /** Where the windows start (above a shop front or a neighbour's roof) and the top of the wall. */
  z0: number;
  z1: number;
  /** The wall comes down to the ground, so it can take doors. */
  ground: boolean;
  /** The wall faces the street. */
  street: boolean;
  /** The front door goes in this wall. */
  door: boolean;
  balconies: 0 | 1 | 2;
  /** Pen for shutters, or -1 for none. */
  shutters: number;
};

/** Window patterns for homes, by region. Terraces and flats leave out the irregular one. */
const HOME: Record<StyleId, Partial<Record<Pattern, number>>> = {
  generic: { grid: 0.6, paired: 0.15, irregular: 0.25 },
  alpine: { small: 0.45, grid: 0.35, paired: 0.2 },
  dutch: { tall: 0.5, grid: 0.35, paired: 0.15 },
  central: { grid: 0.5, paired: 0.3, irregular: 0.2 },
  nordic: { grid: 0.5, paired: 0.2, irregular: 0.3 },
  british: { grid: 0.4, paired: 0.35, tall: 0.25 },
  french: { tall: 0.65, grid: 0.35 },
  mediterranean: { small: 0.35, tall: 0.35, grid: 0.3 },
  eastern: { grid: 0.6, paired: 0.25, irregular: 0.15 },
  arid: { small: 0.7, grid: 0.3 },
  eastAsian: { grid: 0.45, ribbon: 0.25, irregular: 0.3 },
  tropical: { grid: 0.5, small: 0.2, irregular: 0.3 },
  american: { grid: 0.45, paired: 0.3, irregular: 0.25 },
  antipodean: { grid: 0.4, irregular: 0.35, paired: 0.25 },
};
/** Regions whose older windows are mostly divided by glazing bars. */
const BARS = new Set<StyleId>(['british', 'dutch', 'french', 'central', 'nordic', 'american', 'alpine']);
/** Level of detail (mm per metre) from which glazing bars are drawn. */
const BARS_LOD = 1.4;
const OFFICE_USE = new Set(['office', 'commercial', 'retail']);

function pickPattern(w: Partial<Record<Pattern, number>>, u: number): Pattern {
  let total = 0;
  for (const k in w) total += w[k as Pattern]!;
  let acc = 0;
  for (const k in w) {
    acc += w[k as Pattern]! / total;
    if (u < acc) return k as Pattern;
  }
  return 'grid';
}

/**
 * The window scheme for a classified building. `r` gives a stable number per salt, shared
 * along a row of terraced houses. `at` is the footprint corner an industrial hall's offices sit in.
 */
export function chooseFacade(kind: Kind, use: string | undefined, roof: Roof, H: number, style: StyleId, r: (salt: number) => number, at?: [number, number]): Facade {
  const home = HOME[style];
  const regular = { ...home, grid: (home.grid ?? 0) + (home.irregular ?? 0), irregular: 0 };
  let pattern: Pattern;
  let bias = 0;
  let doors: Facade['doors'] = 0;
  switch (kind) {
    case 'house':
      pattern = pickPattern(home, r(16));
      bias = 1;
      break;
    case 'terrace':
      pattern = pickPattern(regular, r(16));
      bias = 0.6;
      break;
    case 'apartment':
      if (use && OFFICE_USE.has(use)) pattern = pickPattern(H >= 20 ? { curtain: 0.4, ribbon: 0.35, grid: 0.25 } : { ribbon: 0.5, grid: 0.5 }, r(16));
      else if (use === 'hotel') pattern = pickPattern({ grid: 0.7, tall: 0.3 }, r(16));
      else if (roof === 'flat' && H >= 10 && r(16) < 0.3) pattern = 'ribbon';
      else pattern = pickPattern(regular, r(20));
      bias = 0.35;
      break;
    case 'tall':
      pattern = pickPattern({ curtain: 0.55, ribbon: 0.25, grid: 0.2 }, r(16));
      break;
    case 'civic':
      pattern = use === 'train_station' ? 'tall' : pickPattern({ grid: 0.4, tall: 0.3, ribbon: 0.3 }, r(16));
      bias = 0.4;
      break;
    case 'worship':
      return { ...PLAIN, pattern: 'tall', w: 1.1 + r(17) * 0.3, h: 3.2 + r(18) * 1.2, bay: 4 + r(19) * 1.2, sill: 1.8, storey: 99, arch: true, bars: true };
    case 'industrial':
      if (use === 'barn' || use === 'farm_auxiliary') pattern = r(16) < 0.55 ? 'blank' : 'sparse';
      else pattern = pickPattern({ blank: 0.35, clerestory: 0.3, officeEnd: 0.25, sparse: 0.1 }, r(16));
      doors = r(21) < 0.7 ? 1 : 0;
      break;
    case 'shed':
      pattern = use === 'garage' || use === 'garages' || r(16) < 0.75 ? 'blank' : 'sparse';
      doors = use === 'garages' ? 3 : use === 'garage' || (!use && r(21) < 0.3) ? 2 : 0;
      return { ...PLAIN, pattern, w: 0.6, h: 0.6, bay: 6, sill: 1.1, doors };
  }
  const u1 = r(17);
  const u2 = r(18);
  const u3 = r(19);
  const f: Facade = { ...PLAIN, pattern, bias, doors };
  switch (pattern) {
    case 'grid':
    case 'irregular':
      Object.assign(f, { w: 1 + u1 * 0.4, h: 1.3 + u2 * 0.3, bay: 3 + u3 * 0.8 });
      break;
    case 'paired':
      Object.assign(f, { w: 0.65 + u1 * 0.15, h: 1.3 + u2 * 0.2, bay: 3.6 + u3 * 0.5 });
      break;
    case 'tall':
      Object.assign(f, { w: 0.85 + u1 * 0.25, h: 1.9 + u2 * 0.35, bay: 2.8 + u3 * 0.6, sill: 0.6 });
      break;
    case 'small':
      Object.assign(f, { w: 0.7 + u1 * 0.2, h: 0.85 + u2 * 0.25, bay: 3.6 + u3, sill: 1.05 });
      break;
    case 'ribbon':
      Object.assign(f, { h: 1.1 + u2 * 0.3, bay: 1.2 + u3 * 0.6, sill: 0.85 });
      break;
    case 'curtain':
      Object.assign(f, { bay: 1.3 + u3 * 0.5, sill: 0 });
      break;
    case 'clerestory':
      Object.assign(f, { bay: 1.8 + u3 * 0.8 });
      break;
    case 'officeEnd':
      Object.assign(f, { w: 1.3 + u1 * 0.4, h: 1.2 + u2 * 0.2, bay: 2.8 + u3 * 0.6, sill: 0.9, at, reach: 8 + r(22) * 8 });
      break;
    case 'sparse':
      Object.assign(f, use === 'barn' || use === 'farm_auxiliary' ? { w: 0.8, h: 0.7, bay: 7 + u3 * 4, sill: 2.2 } : { w: 1.2 + u1 * 0.8, h: 0.9 + u2 * 0.4, bay: 7 + u3 * 4, sill: 1.4 });
      break;
  }
  const homely = kind === 'house' || kind === 'terrace' || kind === 'apartment' || kind === 'civic';
  f.bars = homely && pattern !== 'ribbon' && pattern !== 'curtain' && BARS.has(style) && r(23) < 0.5;
  f.arch = kind === 'civic' && pattern === 'tall' && (use === 'train_station' || r(20) < 0.4);
  f.picture = kind === 'house';
  f.tallGround = (kind === 'apartment' || kind === 'civic') && r(20) < 0.35;
  f.attic = kind === 'apartment' && roof === 'flat' && r(22) < 0.3;
  f.stair = kind === 'apartment' && H >= 9 && pattern !== 'curtain' && r(21) < 0.4;
  return f;
}

type OpeningKind = 'window' | 'door' | 'loading' | 'garage' | 'band' | 'curtain';
/** A hole in the wall, from u0 to u1 along it and z0 to z1 up it. */
type Opening = {
  kind: OpeningKind;
  u0: number;
  u1: number;
  z0: number;
  z1: number;
  /** Mullion spacing for bands, and storey height for curtain walls. */
  div?: number;
  rows?: number;
  /** Shutter pen, or -1; closed shutters cover the window. */
  shutters?: number;
  closed?: boolean;
};
type Balcony = { m: number; hw: number; zf: number; d: number };
/** `f0` is how squarely the wall faces the equator, scaled by the façade's bias; `f` damps it on street fronts. */
type Ctx = { B: Build; w: Wall; fa: Facade; dx: number; dy: number; f0: number; f: number; ops: Opening[]; bals: Balcony[] };

/** Windows, doors and balconies for one wall. */
export function facadeLines(B: Build, w: Wall, fa: Facade, out: Solid): void {
  const lod = B.cam.lod;
  const full = lod * 1.2 >= 0.85;
  if (!full && lod * 1.5 < 0.5) return;
  const dx = (w.bx - w.ax) / w.len;
  const dy = (w.by - w.ay) / w.len;
  // Outward normal (dy, -dx) against the equator: positive on the sunny side. Street fronts
  // keep most of their rhythm whichever way they face.
  const f0 = (dy * B.equator[0] - dx * B.equator[1]) * fa.bias;
  const c: Ctx = { B, w, fa, dx, dy, f0, f: w.street ? f0 * 0.3 : f0, ops: [], bals: [] };
  switch (fa.pattern) {
    case 'blank':
      break;
    case 'clerestory':
      clerestory(c);
      break;
    case 'officeEnd':
      offices(c);
      break;
    case 'sparse':
      sparse(c);
      break;
    case 'ribbon':
    case 'curtain':
      ribbon(c);
      break;
    default:
      bays(c);
  }
  bigDoors(c);
  draw(c, full, out);
}

/** A stable number for a position along the wall, per salt. */
function at(c: Ctx, u: number, salt: number, extra = 0): number {
  const [k0, k1] = c.B.key(c.w.ax + c.dx * u, c.w.ay + c.dy * u);
  return hash(k0, k1, extra, c.B.seed, salt);
}

function storeyOf(c: Ctx): number {
  return c.fa.storey || c.B.style.floor;
}

/** Windows in bays, one or a pair per bay on each floor: the grid and its variations. */
function bays(c: Ctx): void {
  const { w, fa, f, ops } = c;
  const storey = storeyOf(c);
  const one = storey > 20;
  const cols = Math.max(1, Math.floor(w.len / fa.bay));
  const bay = w.len / cols;
  const pair = fa.pattern === 'paired' && bay >= 2.2;
  const gap = 0.25;
  // Wider windows on the sunny side, narrower on the shady one, always leaving some wall.
  let ww = fa.w * (1 + 0.22 * f);
  ww = Math.max(0.45, Math.min(ww, pair ? (bay * 0.75 - gap) / 2 : bay * 0.6));
  const doorCol = w.door && w.ground ? Math.floor(cols / 2) : -1;
  const stairCol = fa.stair && !w.street && cols >= 4 && w.len >= 10 && !one ? Math.floor(cols / 2) : -1;
  const mid = new Float64Array(cols);
  const half = new Float64Array(cols);
  const on = new Uint8Array(cols);
  for (let k = 0; k < cols; k++) {
    let m = (k + 0.5) * bay;
    let hw = ww / 2;
    let keep = true;
    if (fa.pattern === 'irregular' && k !== doorCol) {
      // Homes that grew piecemeal: the odd column missing, shifted or a different width.
      keep = at(c, m, 350) >= 0.18;
      hw *= 0.8 + 0.5 * at(c, m, 352);
      hw = Math.min(hw, bay * 0.35);
      m += (at(c, m, 351) - 0.5) * Math.max(0, bay - hw * 2 - 0.6);
    }
    // Fewer windows on walls facing away from the sun.
    if (f < 0 && k !== doorCol && at(c, m, 353) < -f * 0.6) keep = false;
    mid[k] = m;
    half[k] = hw;
    on[k] = keep ? 1 : 0;
  }
  // A picture window: two columns of the ground floor run together on the sunny side.
  let pic = -1;
  if (fa.picture && w.ground && f > 0.35 && cols >= 2 && at(c, w.len / 2, 354) < f) {
    const k = Math.floor(at(c, w.len / 2, 356) * (cols - 1));
    if (k !== doorCol && k + 1 !== doorCol && on[k] && on[k + 1]) pic = k;
  }
  if (doorCol >= 0) ops.push({ kind: 'door', u0: mid[doorCol] - 0.55, u1: mid[doorCol] + 0.55, z0: w.z0, z1: w.z0 + 2.2 });
  const shutters = w.shutters >= 0 && bay >= 2.4 && !pair ? w.shutters : -1;
  for (let zf = w.z0, fl = 0; ; zf += storey, fl++) {
    let sill = fa.sill;
    let h = Math.min(fa.h, storey - sill - 0.35);
    if (one) {
      h = Math.min(fa.h, w.z1 - w.z0 - sill - 0.8);
      if (fl > 0 || h < 1) break;
    } else {
      if (zf + sill + h > w.z1 - 0.35) break;
      if (fl === 0 && w.ground && fa.tallGround) {
        h = Math.min(h * 1.2, storey - 0.6);
        sill = Math.min(sill, storey - h - 0.35);
      }
      if (fa.attic && fl >= 2 && zf + storey + fa.sill + fa.h > w.z1 - 0.35) h *= 0.6;
    }
    const zb = zf + sill;
    const zt = zb + h;
    // Haussmann fronts: one continuous railed balcony on the second floor and another on the fifth.
    if (w.balconies === 2 && (fl === 2 || fl === 5)) c.bals.push({ m: w.len / 2, hw: w.len / 2 - 0.3, zf, d: 0.45 });
    for (let k = 0; k < cols; k++) {
      if (!on[k] || (fl === 0 && k === doorCol)) continue;
      const m = mid[k];
      const hw = half[k];
      if (k === stairCol) {
        // Stairwell windows sit between the floors, at the half landings.
        const zs = zf + storey * 0.5 + 0.2;
        if (fl > 0 && zs + 1 <= w.z1 - 0.35) ops.push({ kind: 'window', u0: m - 0.3, u1: m + 0.3, z0: zs, z1: zs + 1 });
        continue;
      }
      if (fl === 0 && pic >= 0 && (k === pic || k === pic + 1)) {
        if (k === pic) ops.push({ kind: 'window', u0: mid[pic] - half[pic], u1: mid[pic + 1] + half[pic + 1], z0: zf + Math.max(0.5, sill - 0.4), z1: zt });
        continue;
      }
      const closed = shutters >= 0 && at(c, m, 355, fl) < 0.12 + 0.2 * Math.max(0, c.f0);
      if (pair) {
        ops.push({ kind: 'window', u0: m - gap / 2 - hw * 2, u1: m - gap / 2, z0: zb, z1: zt });
        ops.push({ kind: 'window', u0: m + gap / 2, u1: m + gap / 2 + hw * 2, z0: zb, z1: zt });
      } else ops.push({ kind: 'window', u0: m - hw, u1: m + hw, z0: zb, z1: zt, shutters, closed });
      // Balconies from the first floor up: deep ones on alternate bays.
      if (w.balconies === 1 && fl > 0 && k % 2 === 0 && bay >= 2.6) c.bals.push({ m, hw: Math.min(bay * 0.42, 1.7), zf, d: 1.1 });
    }
  }
}

/** Continuous bands of glazing on each floor, or a curtain wall above a glazed ground floor. */
function ribbon(c: Ctx): void {
  const { w, fa, ops } = c;
  const storey = storeyOf(c);
  const curtain = fa.pattern === 'curtain';
  const margin = curtain ? 0.3 : Math.min(0.8, w.len * 0.1);
  if (w.len - margin * 2 < 1.2) return;
  const dm = w.len / 2;
  const door = w.door && w.ground;
  if (door) ops.push({ kind: 'door', u0: dm - 0.55, u1: dm + 0.55, z0: w.z0, z1: w.z0 + 2.2 });
  for (let zf = w.z0, fl = 0; ; zf += storey, fl++) {
    if (curtain && (fl === 1 || !w.ground)) {
      // Mullions and floor lines run from the first floor to the top.
      if (w.z1 - 0.3 - zf >= storey) ops.push({ kind: 'curtain', u0: margin, u1: w.len - margin, z0: zf, z1: w.z1 - 0.3, div: fa.bay, rows: storey });
      break;
    }
    // The ground floor of a curtain wall is a taller band of lobby glazing.
    const sill = curtain ? 0.3 : fa.sill;
    const h = curtain ? Math.min(storey - 0.7, 2.6) : Math.min(fa.h, storey - sill - 0.35);
    const zb = zf + sill;
    const zt = zb + h;
    if (zt > w.z1 - 0.35) break;
    if (fl === 0 && door) {
      if (dm - 0.9 - margin >= 1) ops.push({ kind: 'band', u0: margin, u1: dm - 0.9, z0: zb, z1: zt, div: fa.bay });
      if (w.len - margin - dm - 0.9 >= 1) ops.push({ kind: 'band', u0: dm + 0.9, u1: w.len - margin, z0: zb, z1: zt, div: fa.bay });
    } else ops.push({ kind: 'band', u0: margin, u1: w.len - margin, z0: zb, z1: zt, div: fa.bay });
    if (w.balconies === 1 && fl > 0) {
      const n = Math.max(1, Math.floor(w.len / 3.4));
      for (let k = 0; k < n; k += 2) c.bals.push({ m: ((k + 0.5) * w.len) / n, hw: Math.min(w.len / n * 0.42, 1.7), zf, d: 1.1 });
    }
  }
}

/** A row of low windows under the eaves of a hall, on its longer walls. */
function clerestory(c: Ctx): void {
  const { w, fa, ops } = c;
  if (w.len < 8 || w.z1 - w.z0 < 4) return;
  const h = Math.min(1.2, (w.z1 - w.z0) * 0.15);
  const zt = w.z1 - 0.5;
  ops.push({ kind: 'band', u0: 1.2, u1: w.len - 1.2, z0: zt - h, z1: zt, div: fa.bay });
}

/** A hall's offices: a small grid of one or two storeys round one corner, blank wall elsewhere. */
function offices(c: Ctx): void {
  const { w, fa, ops } = c;
  if (!fa.at || !fa.reach) return;
  const storey = 3.3;
  const rows = Math.min(2, Math.floor((w.z1 - w.z0 - 0.6) / storey) || (w.z1 - w.z0 >= 2.8 ? 1 : 0));
  const cols = Math.max(1, Math.floor(w.len / fa.bay));
  const bay = w.len / cols;
  const hw = Math.min(fa.w, bay * 0.6) / 2;
  for (let k = 0; k < cols; k++) {
    const m = (k + 0.5) * bay;
    if (Math.hypot(w.ax + c.dx * m - fa.at[0], w.ay + c.dy * m - fa.at[1]) > fa.reach) continue;
    for (let fl = 0; fl < rows; fl++) {
      const zb = w.z0 + fl * storey + fa.sill;
      ops.push({ kind: 'window', u0: m - hw, u1: m + hw, z0: zb, z1: zb + fa.h });
    }
  }
}

/** A few windows spread out along the wall, one row only. */
function sparse(c: Ctx): void {
  const { w, fa, f, ops } = c;
  const h = Math.min(fa.h, w.z1 - w.z0 - fa.sill - 0.4);
  if (h < 0.5) return;
  const n = Math.max(1, Math.floor(w.len / fa.bay));
  const step = w.len / n;
  const hw = Math.min(fa.w, step * 0.5) / 2;
  for (let k = 0; k < n; k++) {
    let m = (k + 0.5) * step;
    if (at(c, m, 358) < 0.35 || (f < 0 && at(c, m, 353) < -f * 0.6)) continue;
    m += (at(c, m, 357) - 0.5) * Math.max(0, Math.min(1.5, step - hw * 2 - 0.6));
    ops.push({ kind: 'window', u0: m - hw, u1: m + hw, z0: w.z0 + fa.sill, z1: w.z0 + fa.sill + h });
  }
}

/** Loading doors and garage doors on the street side, clearing any windows in their way. */
function bigDoors(c: Ctx): void {
  const { w, fa, ops } = c;
  if (!fa.doors || !w.street || !w.ground) return;
  const H = w.z1 - w.z0;
  const doors: Opening[] = [];
  if (fa.doors === 1) {
    if (w.len < 8 || H < 3.5) return;
    const n = Math.max(1, Math.min(3, Math.floor((w.len / 16) * (0.5 + at(c, w.len / 2, 359)))));
    const dw = Math.min(3.5 + at(c, w.len / 2, 357), w.len / n - 1.5);
    const dh = Math.min(4.5, H - 0.8);
    for (let k = 0; k < n; k++) {
      const m = ((k + 0.5) * w.len) / n;
      doors.push({ kind: 'loading', u0: m - dw / 2, u1: m + dw / 2, z0: w.z0, z1: w.z0 + dh });
    }
  } else {
    const dh = Math.min(2.1, H - 0.3);
    const n = fa.doors === 3 ? Math.floor(w.len / 3) : 1;
    const dw = Math.min(2.5, w.len / Math.max(1, n) - 0.5);
    if (n < 1 || dw < 1.8 || dh < 1.6) return;
    for (let k = 0; k < n; k++) {
      const m = ((k + 0.5) * w.len) / n;
      doors.push({ kind: 'garage', u0: m - dw / 2, u1: m + dw / 2, z0: w.z0, z1: w.z0 + dh });
    }
  }
  for (let i = ops.length - 1; i >= 0; i--) {
    const o = ops[i];
    if (o.kind !== 'window' && o.kind !== 'band') continue;
    if (doors.some((d) => o.u0 < d.u1 + 0.3 && o.u1 > d.u0 - 0.3 && o.z0 < d.z1 + 0.3 && o.z1 > d.z0)) ops.splice(i, 1);
  }
  ops.push(...doors);
}

/** Draw the openings and balconies on the wall. Below full detail, windows are single ticks. */
function draw(c: Ctx, full: boolean, out: Solid): void {
  const { B, w, dx, dy } = c;
  const { ax, ay } = w;
  const lod = B.cam.lod;
  const bars = c.fa.bars && lod >= BARS_LOD;
  const P = (u: number, n: number, z: number) => [ax + dx * u + dy * n, ay + dy * u - dx * n, z];
  const L = (pen: number, pts: number[], closed?: boolean) => out.lines.push(closed ? { pen, pts, closed } : { pen, pts });
  const rect = (pen: number, u0: number, u1: number, z0: number, z1: number) => L(pen, [...P(u0, 0, z0), ...P(u1, 0, z0), ...P(u1, 0, z1), ...P(u0, 0, z1)], true);
  // Spacing that stays open on paper, in metres.
  const open = (m: number, mm: number) => Math.max(m, B.cam.gap(mm) / B.cam.s);
  for (const o of c.ops) {
    const { u0, u1, z0, z1 } = o;
    const um = (u0 + u1) / 2;
    switch (o.kind) {
      case 'window': {
        if (!full) {
          L(LINEWORK, [...P(um, 0, z0), ...P(um, 0, z1)]);
          break;
        }
        const pen = o.shutters ?? -1;
        if (pen >= 0 && o.closed) {
          // Shutters closed against the sun: a pair of panels meeting in the middle.
          rect(pen, u0, u1, z0, z1);
          L(pen, [...P(um, 0, z0), ...P(um, 0, z1)]);
          break;
        }
        const r = (u1 - u0) / 2;
        const spring = z1 - r;
        if (c.fa.arch && spring > z0 + 0.5) {
          const pts = [...P(u0, 0, spring), ...P(u0, 0, z0), ...P(u1, 0, z0), ...P(u1, 0, spring)];
          for (let q = 1; q < 8; q++) pts.push(...P(um + Math.cos((q / 8) * Math.PI) * r, 0, spring + Math.sin((q / 8) * Math.PI) * r));
          L(LINEWORK, pts, true);
          if (bars) L(LINEWORK, [...P(um, 0, z0), ...P(um, 0, z1)]);
        } else {
          rect(LINEWORK, u0, u1, z0, z1);
          if (bars && u1 - u0 >= 0.8) {
            L(LINEWORK, [...P(um, 0, z0), ...P(um, 0, z1)]);
            const zt = z0 + (z1 - z0) * 0.68;
            L(LINEWORK, [...P(u0, 0, zt), ...P(u1, 0, zt)]);
          }
        }
        // Shutters folded back either side.
        if (pen >= 0) {
          const sw = Math.min(0.42, (u1 - u0) * 0.3);
          rect(pen, u0 - sw - 0.06, u0 - 0.06, z0, z1);
          rect(pen, u1 + 0.06, u1 + sw + 0.06, z0, z1);
        }
        break;
      }
      case 'door':
        // Taller than a window, down to the ground, with a little hood over it.
        if (!full) break;
        L(LINEWORK, [...P(u0, 0, z0), ...P(u0, 0, z1), ...P(u1, 0, z1), ...P(u1, 0, z0)]);
        L(LINEWORK, [...P(u0 - 0.25, 0, z1 + 0.25), ...P(u0 - 0.25, 0.45, z1 + 0.25), ...P(u1 + 0.25, 0.45, z1 + 0.25), ...P(u1 + 0.25, 0, z1 + 0.25)]);
        break;
      case 'loading':
      case 'garage': {
        // Roller shutters with slats, up-and-over garage doors with a few panels.
        L(LINEWORK, [...P(u0, 0, z0), ...P(u0, 0, z1), ...P(u1, 0, z1), ...P(u1, 0, z0)]);
        if (!full) break;
        const step = o.kind === 'loading' ? open(0.45, 0.6) : (z1 - z0) / 4;
        for (let z = z1 - step; z > z0 + step * 0.5; z -= step) L(LINEWORK, [...P(u0, 0, z), ...P(u1, 0, z)]);
        break;
      }
      case 'band': {
        if (!full) {
          const zm = (z0 + z1) / 2;
          L(LINEWORK, [...P(u0, 0, zm), ...P(u1, 0, zm)]);
          break;
        }
        rect(LINEWORK, u0, u1, z0, z1);
        const n = Math.max(1, Math.round((u1 - u0) / open(o.div ?? 1.5, 0.7)));
        for (let k = 1; k < n; k++) {
          const u = u0 + ((u1 - u0) * k) / n;
          L(LINEWORK, [...P(u, 0, z0), ...P(u, 0, z1)]);
        }
        break;
      }
      case 'curtain': {
        // Floor lines every storey (every other one where they'd crowd), mullions at full detail.
        const rows = o.rows ?? 3.2;
        const every = rows * B.cam.s < B.cam.gap(0.6) ? 2 : 1;
        for (let z = z0, k = 0; z <= z1 + 0.01; z += rows, k++) if (k % every === 0) L(LINEWORK, [...P(u0, 0, z), ...P(u1, 0, z)]);
        if (!full) break;
        const n = Math.max(1, Math.round((u1 - u0) / open(o.div ?? 1.5, 0.7)));
        for (let k = 0; k <= n; k++) {
          const u = u0 + ((u1 - u0) * k) / n;
          L(LINEWORK, [...P(u, 0, z0), ...P(u, 0, z1)]);
        }
        break;
      }
    }
  }
  if (full) for (const b of c.bals) balcony(out, ax, ay, dx, dy, b.m, b.hw, b.zf, b.d);
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
