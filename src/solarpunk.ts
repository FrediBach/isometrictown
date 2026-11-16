import { newSolid, prism, type Build, type Line3, type Solid } from './buildings';
import type { Camera } from './camera';
import { pointInRing, ringArea } from './geo';
import { FIELD, MEADOW, type Ground } from './ground';
import { onMask, place, rect, type Extra } from './infra';
import { LOD, shows } from './lod';
import type { Masks } from './nature';
import type { Paper } from './raster';
import { hash } from './rng';
import { future, GREENERY, LINEWORK, ROOFS, type Settings } from './settings';
import { bestRect, type Rect } from './shape';
import type { Facade } from './facades';
import type { Tree } from './nature';
import type { Building, Shape, Way } from './tiles';

/*
 * Solarpunk: the same map extrapolated into a far future where the town has been rebuilt
 * kindly. Nothing here is in the map; it is all made up from what is, keyed to map position
 * like every other invention, so it stays put when the view pans.
 *
 * Roofs facing the sun carry solar tiles, flat roofs are gardens or solar arrays, and walls
 * are overgrown with climbers. Bicycles, small electric pods and cargo pods take the place of
 * cars, kerbside parking becomes planted parklets, car parks get solar canopies and petrol
 * stations become charging hubs. Pylons are gone (the lines run underground) and wind
 * turbines stand in the fields, some of which grow crops under raised panels. Airships
 * cruise overhead. There are more trees everywhere.
 *
 * Each feature hooks into the module that draws its present-day self and checks `future()`;
 * the shared geometry lives here.
 */

/** Settings as the future draws them: more trees, less traffic. Switched-off sliders stay off. */
export function futureSettings(set: Settings): Settings {
  if (!future(set)) return set;
  return { ...set, trees: set.trees > 0 ? Math.min(1, set.trees * 1.5 + 0.2) : 0, cars: set.cars * 0.6 };
}

type V3 = [number, number, number];

/** The camera's frame: right along the sheet, up the sheet, and the line of sight (away from the viewer), as world unit vectors. */
function basis(cam: Camera): { right: V3; up: V3; view: V3 } {
  return {
    right: [cam.cb, -cam.sb, 0],
    up: [cam.sb * cam.sa, cam.cb * cam.sa, cam.ca],
    view: [cam.sb * cam.ca, cam.cb * cam.ca, -cam.sa],
  };
}

/**
 * A round crown facing the viewer: a ring of 3D points in the plane square to the line of
 * sight, so it projects to its true shape and fills the depth buffer like any face. Its edge
 * is lobed a little, keyed to position.
 */
export function crown(B: Build, x: number, y: number, z: number, r: number, k: number, n = 14): number[] {
  const { right, up } = basis(B.cam);
  const out: number[] = [];
  const phase = k * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.92 + 0.08 * Math.cos(a * 3 + phase));
    const c = Math.cos(a) * rr;
    const s = Math.sin(a) * rr;
    out.push(x + right[0] * c + up[0] * s, y + right[1] * c + up[1] * s, z + up[2] * s);
  }
  return out;
}

/** A bush or small tree standing on a roof or in a planter at height z: a crown, and a trunk if it has one. */
export function plant(B: Build, s: Solid, x: number, y: number, z: number, r: number, trunk: number, k: number, facet: string): void {
  if (!shows(B.cam, LOD.roofPlant, r * 2)) return;
  const zc = z + trunk + r * 0.85;
  const ring = crown(B, x, y, zc, r, k, shows(B.cam, LOD.treeCrown, r * 2) ? 20 : 12);
  s.faces.push([ring]);
  s.lines.push({ pen: GREENERY, pts: ring, closed: true, layer: 'trees', facet });
  if (trunk > 0) s.lines.push({ pen: GREENERY, pts: [x, y, z, x, y, zc - r * 0.6], layer: 'trees', facet });
}

/** Mm on paper between two local 3D points. */
function onPaper(cam: Camera, a: number[], b: number[]): number {
  return Math.hypot(cam.sx(b[0], b[1]) - cam.sx(a[0], a[1]), cam.sy(b[0], b[1], b[2]) - cam.sy(a[0], a[1], a[2]));
}

/**
 * A panel array on a plane, given as a point at (a, b) in its own frame: an outline, and the
 * seams between panels where they read. Seams that would run together on paper are merged,
 * two panels to one, then four, before they are left out.
 */
export function panels(B: Build, out: Line3[], P: (a: number, b: number) => number[], a0: number, a1: number, b0: number, b1: number, da: number, db: number, on: number[][] | undefined, facet: string, layer: Line3['layer'] = 'details', pen = ROOFS): void {
  const cam = B.cam;
  if (a1 - a0 < 0.4 || b1 - b0 < 0.4) return;
  const across = (a: number, b: number, a2: number, b2: number) => onPaper(cam, P(a, b), P(a2, b2)) / cam.s;
  if (!shows(cam, LOD.solar, Math.min(across(a0, b0, a0, b1), across(a0, b0, a1, b0)))) return;
  const line = (pts: number[][], closed = false) => out.push({ pen, pts: pts.flat(), closed, on, facet, layer });
  line([P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)], true);
  const step = (d: number, size: (d: number) => number) => {
    for (let f = 1; f <= 4; f *= 2) if (shows(cam, LOD.solarSeam, size(d * f))) return d * f;
    return 0;
  };
  const sa = step(da, (d) => across(a0, b0, a0 + d, b0));
  const sb = step(db, (d) => across(a0, b0, a0, b0 + d));
  if (sa) {
    const n = Math.round((a1 - a0) / sa);
    for (let i = 1; i < n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      line([P(a, b0), P(a, b1)]);
    }
  }
  if (sb) {
    const n = Math.round((b1 - b0) / sb);
    for (let i = 1; i < n; i++) {
      const b = b0 + ((b1 - b0) * i) / n;
      line([P(a0, b), P(a1, b)]);
    }
  }
}

/**
 * Climbers up a wall from a to b, between z0 and z1, drawn on the wall's face: a few wavering
 * stems of differing height with side shoots. About a third of walls have them.
 */
export function vines(B: Build, out: Solid, face: number[][], ax: number, ay: number, bx: number, by: number, z0: number, z1: number, reach = 16): void {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 2.4 || z1 - z0 < 2.2 || !shows(B.cam, LOD.vine)) return;
  const [k0, k1] = B.key((ax + bx) / 2, (ay + by) / 2);
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  // Lifted a hair off the wall towards the viewer, so the stems win the depth test against it.
  const n = Math.max(1, Math.floor(len / 1.9));
  const shoots = shows(B.cam, LOD.vineShoot);
  for (let i = 0; i < n; i++) {
    const h = (salt: number) => hash(k0, k1, B.seed, 12001 + i * 5 + salt);
    const t = ((i + 0.25 + 0.5 * h(0)) / n) * len;
    // Up a house front, or the lower floors of a tower: climbers don't reach the skyline.
    const top = z0 + Math.min(z1 - z0, reach) * (0.55 + 0.45 * h(1));
    const amp = 0.25 + 0.2 * h(2);
    const phase = h(3) * Math.PI * 2;
    const at = (z: number): number[] => {
      const w = t + Math.sin(phase + z * 1.7) * amp;
      const c = Math.max(0.1, Math.min(len - 0.1, w));
      return [ax + ux * c, ay + uy * c, z];
    };
    const stem: number[] = [];
    for (let z = z0; z < top; z += 0.4) stem.push(...at(z));
    stem.push(...at(top));
    out.lines.push({ pen: GREENERY, pts: stem, on: face, facet: 'future-vines' });
    if (!shoots) continue;
    for (let z = z0 + 1.2, side = h(4) < 0.5 ? 1 : -1; z < top - 0.6; z += 1.3, side = -side) {
      const [x, y] = at(z);
      const reach = Math.max(-t + 0.1, Math.min(len - t - 0.1, side * 0.9));
      out.lines.push({ pen: GREENERY, pts: [x, y, z, x + ux * reach * 0.6, y + uy * reach * 0.6, z + 0.35, x + ux * reach, y + uy * reach, z + 0.45], on: face, facet: 'future-vines' });
    }
  }
}

/**
 * A flat roof in the future: a garden (sedum, planters, bushes and small trees) or a solar
 * array, decided per building, and small helical wind turbines on tall ones.
 */
export function futureRoof(B: Build, b: Building, z: number, k: [number, number], roof: number[][], out: Solid[], civic = false): void {
  const outer = b.shape[0].pts;
  const { rect } = bestRect(outer);
  const area = Math.abs(ringArea(outer));
  if (!rect || area < 25) return;
  const inside = (x: number, y: number) => pointInRing(x, y, outer) && b.shape.slice(1).every((hole) => !pointInRing(x, y, hole.pts));
  const h = (salt: number) => hash(k[0], k[1], B.seed, 12020 + salt);
  const keep: ((x: number, y: number) => boolean)[] = [];
  const avoid = (x: number, y: number) => keep.some((f) => f(x, y));
  // A glass dome over civic buildings and some big roofs.
  if ((civic && area > 300) || (area > 900 && h(3) < 0.35)) {
    const d = roofDome(B, rect, z, inside, out);
    if (d) keep.push(d);
  }
  // Bigger roofs split: a solar array over one end, a garden over the other.
  const split = area > 140 && h(0) < 0.7 && !keep.length;
  const half = (side: number): Rect => ({ ...rect, cx: rect.cx + rect.ux * side * rect.L / 4, cy: rect.cy + rect.uy * side * rect.L / 4, L: rect.L / 2 });
  const sunEnd = rect.ux * B.sun[0] + rect.uy * B.sun[1] >= 0 ? 1 : -1;
  const green = split ? half(-sunEnd) : rect;
  if (!keep.length && green.L * green.w > 110 && h(1) < 0.55) {
    const g = greenhouse(B, green, z, inside, out);
    if (g) keep.push(g);
  }
  if (split) array(B, half(sunEnd), z, inside, out);
  garden(B, green, z, inside, roof, out, avoid);
  if (area > 160 && h(4) < 0.55) pipes(B, rect, z, outer, (x, y) => inside(x, y) && !avoid(x, y), k, out);
  if (z > 9 && area > 90) turbines(B, rect, z, k, inside, out);
}

/**
 * A greenhouse with a barrel vault of glass over a garden roof: ribs across, glazing bars
 * along. Returns a test for the ground it stands on, which the garden keeps off.
 */
function greenhouse(B: Build, r: Rect, z: number, inside: (x: number, y: number) => boolean, out: Solid[]): ((x: number, y: number) => boolean) | undefined {
  const L = Math.min(r.L - 2, 18);
  const R = Math.min(r.w / 2 - 1, 2.8);
  if (L < 4 || R < 1.4) return undefined;
  const corners = [onRect(r, -L / 2, -R), onRect(r, L / 2, -R), onRect(r, L / 2, R), onRect(r, -L / 2, R)];
  if (!corners.every(([x, y]) => inside(x, y))) return undefined;
  const s = newSolid();
  s.facet = 'future-greenhouse';
  const P = (a: number, t: number) => {
    const [x, y] = onRect(r, a, -R * Math.cos(t));
    return [x, y, z + 0.4 + R * Math.sin(t)];
  };
  const n = 10;
  // A low wall, then the vault in strips.
  prism(B, [{ pts: corners.flat(), seam: new Uint8Array(4) }], z, z + 0.4, { roof: false, windows: false, pen: LINEWORK }, s);
  for (let i = 0; i < n; i++) {
    const t0 = (i / n) * Math.PI;
    const t1 = ((i + 1) / n) * Math.PI;
    s.faces.push([[...P(-L / 2, t0), ...P(L / 2, t0), ...P(L / 2, t1), ...P(-L / 2, t1)]]);
  }
  for (const a of [-L / 2, L / 2]) {
    const end: number[] = [];
    for (let i = 0; i <= n; i++) end.push(...P(a, (i / n) * Math.PI));
    s.faces.push([end]);
  }
  const ribs = Math.max(2, Math.round(L / 1.6));
  const fine = shows(B.cam, LOD.solarSeam, L / ribs);
  for (let q = 0; q <= ribs; q++) {
    if (!fine && q % 2 && q !== ribs) continue;
    const a = -L / 2 + (L * q) / ribs;
    const rib: number[] = [];
    for (let i = 0; i <= n; i++) rib.push(...P(a, (i / n) * Math.PI));
    s.lines.push({ pen: LINEWORK, pts: rib, facet: 'future-greenhouse' });
  }
  for (const t of fine ? [0.5, 1.05, 1.57, 2.09, 2.64] : [1.0, 2.14]) s.lines.push({ pen: LINEWORK, pts: [...P(-L / 2, t), ...P(L / 2, t)], facet: 'future-greenhouse' });
  out.push(s);
  const ring = corners.flat();
  return (x, y) => pointInRing(x, y, ring);
}

/** A point on a rect at a along its length and c across it, from the centre. */
function onRect(r: Rect, a: number, c: number): [number, number] {
  return [r.cx + r.ux * a - r.uy * c, r.cy + r.uy * a + r.ux * c];
}

/** A roof garden: sedum over the roof, planter beds with bushes, and small trees on big roofs. */
function garden(B: Build, r: Rect, z: number, inside: (x: number, y: number) => boolean, roof: number[][], out: Solid[], avoid?: (x: number, y: number) => boolean): void {
  const s = newSolid();
  s.facet = 'future-roof-garden';
  const cam = B.cam;
  // Sedum: little tufts at an even spacing on paper, only on the roof's own face.
  const gap = cam.gap(3.4) / cam.s;
  if (shows(cam, LOD.sedum) && r.L * r.w < 40000) {
    const t = cam.nib * 0.9 / cam.s;
    const { right, up } = basis(cam);
    for (let a = -r.L / 2 + gap / 2; a < r.L / 2; a += gap) {
      for (let c = -r.w / 2 + gap / 2; c < r.w / 2; c += gap * 0.8) {
        const [x0, y0] = onRect(r, a, c);
        const [ka, kb] = B.key(x0, y0);
        const j = hash(ka, kb, B.seed, 12021);
        const x = x0 + r.ux * (j - 0.5) * gap * 0.5;
        const y = y0 + r.uy * (j - 0.5) * gap * 0.5;
        if (!inside(x, y) || avoid?.(x, y)) continue;
        const P = (dr: number, du: number) => [x + right[0] * dr + up[0] * du, y + right[1] * dr + up[1] * du, z + up[2] * du];
        s.lines.push({ pen: GREENERY, pts: [...P(-t, t * 1.3), ...P(0, 0), ...P(t, t * 1.3)], on: roof, layer: 'trees', facet: 'future-roof-garden' });
      }
    }
  }
  // Planter beds and trees on a grid along the roof.
  const cell = 3.6;
  const na = Math.floor((r.L - 1.4) / cell);
  const nc = Math.floor((r.w - 1.4) / cell);
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nc; j++) {
      const a = -((na - 1) * cell) / 2 + i * cell;
      const c = -((nc - 1) * cell) / 2 + j * cell;
      const [x, y] = onRect(r, a, c);
      const [ka, kb] = B.key(x, y);
      const h = (salt: number) => hash(ka, kb, B.seed, 12022 + salt);
      const corners = [onRect(r, a - 1.6, c - 0.7), onRect(r, a + 1.6, c - 0.7), onRect(r, a + 1.6, c + 0.7), onRect(r, a - 1.6, c + 0.7)];
      if (!corners.every(([px, py]) => inside(px, py) && !avoid?.(px, py)) || !inside(x, y)) continue;
      const v = h(0);
      if (v < 0.42) {
        if (shows(cam, LOD.rooftop, 1.4)) prism(B, [{ pts: corners.flat(), seam: new Uint8Array(4) }], z, z + 0.5, { roof: true, windows: false, pen: LINEWORK }, s);
        for (const d of [-0.9, 0.9]) {
          const [px, py] = onRect(r, a + d, c);
          plant(B, s, px, py, z + 0.5, 0.55 + h(1) * 0.25, 0, h(2 + (d > 0 ? 1 : 0)), 'future-roof-garden');
        }
      } else if (v < 0.7 && na * nc >= 2) plant(B, s, x, y, z, 1.3 + h(4) * 0.8, 1.4 + h(5) * 1.6, h(6), 'future-roof-garden');
      else if (v < 0.92) plant(B, s, x, y, z, 0.6 + h(7) * 0.3, 0, h(8), 'future-roof-garden');
    }
  }
  if (s.lines.length) out.push(s);
}

/** Rows of solar panels tilted to the sun across a flat roof, every panel drawn where they read. */
function array(B: Build, rect: Rect, z: number, inside: (x: number, y: number) => boolean, out: Solid[]): void {
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
  s.facet = 'future-solar-array';
  for (let c = -r.w / 2 + 0.9; c + 1.6 < r.w / 2 - 0.6; c += 2.5) {
    let half = r.L / 2 - 0.7;
    const P = (a: number, d: number) => [r.cx + r.ux * a + vx * d, r.cy + r.uy * a + vy * d];
    while (half > 1.2 && ![P(-half, c), P(half, c), P(-half, c + 1.6), P(half, c + 1.6)].every(([x, y]) => inside(x, y))) half -= 0.8;
    if (half <= 1.2) continue;
    // The far edge (away from the sun) is raised.
    const Q = (a: number, d: number) => {
      const [x, y] = P(a, c + d);
      return [x, y, z + 0.9 - d * 0.4];
    };
    const quad = [Q(-half, 0), Q(half, 0), Q(half, 1.6), Q(-half, 1.6)];
    const face = [quad.flat()];
    s.faces.push(face);
    s.lines.push({ pen: LINEWORK, pts: quad.flat(), closed: true, facet: 'future-solar-array' });
    panels(B, s.lines, (a, d) => Q(a, d), -half, half, 0, 1.6, 1.0, 0.8, face, 'future-solar-array', 'rooftops');
  }
  if (s.faces.length) out.push(s);
}

/** One or two small helical wind turbines on a tall flat roof. */
function turbines(B: Build, r: Rect, z: number, k: [number, number], inside: (x: number, y: number) => boolean, out: Solid[]): void {
  if (!shows(B.cam, LOD.roofTurbine)) return;
  const count = 1 + Math.floor(hash(k[0], k[1], B.seed, 12030) * (r.L > 20 ? 4 : 2));
  for (let i = 0; i < count; i++) {
    const a = (i - (count - 1) / 2) * Math.min(5, r.L / (count + 1));
    const c = (r.w / 2 - 1.6) * (hash(k[0], k[1], B.seed, 12031 + i) < 0.5 ? 1 : -1);
    const [x, y] = onRect(r, a, c);
    if (!inside(x, y)) continue;
    const s = newSolid();
    s.facet = 'future-roof-turbine';
    const R = 0.9;
    const z0 = z + 1.4;
    const z1 = z0 + 3.4;
    s.lines.push({ pen: LINEWORK, pts: [x, y, z, x, y, z1 + 0.3], facet: 'future-roof-turbine' });
    const phase = hash(k[0], k[1], B.seed, 12033 + i) * Math.PI * 2;
    // Three blades, each twisting a third of a turn as it rises.
    for (let q = 0; q < 3; q++) {
      const pts: number[] = [];
      for (let m = 0; m <= 10; m++) {
        const f = m / 10;
        const ang = phase + (q * Math.PI * 2) / 3 + f * (Math.PI * 2) / 3;
        pts.push(x + Math.cos(ang) * R, y + Math.sin(ang) * R, z0 + (z1 - z0) * f);
      }
      s.lines.push({ pen: LINEWORK, pts, facet: 'future-roof-turbine' });
    }
    for (const zz of [z0, z1]) {
      const ring: number[] = [];
      for (let q = 0; q < 10; q++) ring.push(x + Math.cos((q / 10) * Math.PI * 2) * R * 0.35, y + Math.sin((q / 10) * Math.PI * 2) * R * 0.35, zz);
      s.lines.push({ pen: LINEWORK, pts: ring, closed: true, facet: 'future-roof-turbine' });
    }
    out.push(s);
  }
}

/**
 * A wind turbine: a tapering tower, a nacelle facing into the wind and three blades. `phase`
 * turns the rotor; the blades' outlines are projected along the sun for their shadows.
 */
export function windTurbine(B: Build, x: number, y: number, H: number, R: number, fx: number, fy: number, phase: number, z0 = 0): Solid {
  const s = newSolid();
  s.facet = 'future-turbine';
  const { right } = basis(B.cam);
  const r0 = H * 0.032 + 0.06;
  const r1 = r0 * 0.55;
  const top = z0 + H;
  const tower = [x - right[0] * r0, y - right[1] * r0, z0, x + right[0] * r0, y + right[1] * r0, z0, x + right[0] * r1, y + right[1] * r1, top, x - right[0] * r1, y - right[1] * r1, top];
  s.faces.push([tower]);
  s.lines.push({ pen: LINEWORK, pts: tower.slice(3, 9) }, { pen: LINEWORK, pts: [...tower.slice(9, 12), ...tower.slice(0, 3)] });
  // The nacelle, a box behind the hub.
  const n = H * 0.02 + 0.12;
  prism(B, [{ pts: place(x, y, fx, fy, rect(-n * 3.2, n * 1.2, -n * 0.8, n * 0.8)), seam: new Uint8Array(4) }], top - n * 0.8, top + n * 0.9, { roof: true, windows: false, pen: LINEWORK }, s);
  const hx = x + fx * n * 1.6;
  const hy = y + fy * n * 1.6;
  const hz = top + n * 0.05;
  // Blades sweep the plane square to the wind.
  const px = -fy;
  const py = fx;
  for (let q = 0; q < 3; q++) {
    const t = phase + (q * Math.PI * 2) / 3;
    const bx = px * Math.cos(t);
    const by = py * Math.cos(t);
    const bz = Math.sin(t);
    const cx = -px * Math.sin(t);
    const cy = -py * Math.sin(t);
    const cz = Math.cos(t);
    const P = (along: number, chord: number) => [hx + bx * along + cx * chord, hy + by * along + cy * chord, hz + bz * along + cz * chord];
    const blade = [...P(n * 0.6, -n * 0.45), ...P(R * 0.22, -n * 0.75), ...P(R, -n * 0.08), ...P(R, n * 0.05), ...P(R * 0.3, n * 0.35), ...P(n * 0.6, n * 0.4)];
    s.faces.push([blade]);
    s.shade = [...(s.shade ?? []), [blade]];
    s.lines.push({ pen: LINEWORK, pts: blade, closed: true });
  }
  const hub = crown(B, hx + fx * 0.2, hy + fy * 0.2, hz, n * 0.75, 0, 10);
  s.faces.push([hub]);
  s.lines.push({ pen: LINEWORK, pts: hub, closed: true });
  const base: number[] = [];
  for (let q = 0; q < 10; q++) base.push(x + Math.cos((q / 10) * Math.PI * 2) * r0, y + Math.sin((q / 10) * Math.PI * 2) * r0);
  if (z0 === 0) s.casts.push({ ring: base, h: H });
  for (const l of s.lines) l.facet ??= 'future-turbine';
  return s;
}

/** The way the wind blows over the whole sheet, the same for every turbine: a seed-fixed bearing. */
function wind(set: Settings): [number, number] {
  const a = hash(set.seed, 7, 3, 12040) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}

/**
 * Wind turbines out in the open country, on fields and meadows away from the town, on a grid
 * fixed to the map. They take the place of the pylons, whose lines now run underground.
 */
export function windFarms(B: Build, paper: Paper, G: Ground | null, M: Masks, box: number[], toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Extra {
  const solids: Solid[] = [];
  const none = { solids, draw: () => {} };
  const { set, cam } = B;
  if (!G || !set.power || !shows(cam, LOD.turbine)) return none;
  const [A0x, A0y] = toAbs(box[0], box[1]);
  const [A1x, A1y] = toAbs(box[2], box[3]);
  const size = 190;
  const [wx, wy] = wind(set);
  for (let i = Math.floor(A0x / size); i <= Math.ceil(A1x / size); i++) {
    for (let j = Math.floor(A0y / size); j <= Math.ceil(A1y / size); j++) {
      const h = (salt: number) => hash(i, j, set.seed, 12041 + salt);
      if (h(0) > 0.6) continue;
      const [x, y] = fromAbs((i + 0.2 + 0.6 * h(1)) * size, (j + 0.2 + 0.6 * h(2)) * size);
      const sx = cam.sx(x, y);
      const sy = cam.sy(x, y, 0);
      if (!paper.on(M.green, sx, sy) && paper.at(G.land, sx, sy) !== FIELD && paper.at(G.land, sx, sy) !== MEADOW) continue;
      if (G.inTown(x, y, sx, sy) || onMask(paper, M.wood, x, y)) continue;
      // Clear ground round the foot, and room from the edge of what is loaded.
      let clear = true;
      for (let q = 0; q < 6 && clear; q++) {
        const px = x + Math.cos(q) * 9;
        const py = y + Math.sin(q) * 9;
        clear = !onMask(paper, M.road, px, py) && !onMask(paper, M.foot, px, py) && !onMask(paper, M.water, px, py);
      }
      if (!clear) continue;
      const H = 60 + 30 * h(3);
      const yaw = (h(4) - 0.5) * 0.35;
      const fx = wx * Math.cos(yaw) - wy * Math.sin(yaw);
      const fy = wx * Math.sin(yaw) + wy * Math.cos(yaw);
      if (!shows(cam, LOD.turbine, H)) continue;
      solids.push(windTurbine(B, x, y, H, H * 0.42, fx, fy, h(5) * Math.PI * 2));
    }
  }
  return { solids, draw: () => {} };
}

/**
 * Agrivoltaics: about a third of fields grow their crops under rows of raised solar tables,
 * tilted to the sun, on posts. The furrows still show between the rows.
 */
export function agrivoltaics(B: Build, paper: Paper, G: Ground, M: Masks): Solid[] {
  const out: Solid[] = [];
  const { cam, set } = B;
  if (!shows(cam, LOD.agrivoltaic)) return out;
  const [sx, sy] = B.sun;
  let tables = 0;
  for (const c of G.covers) {
    if (c.code !== FIELD || tables > 2400) continue;
    const r = c.rect;
    const [k0, k1] = B.key(r.cx, r.cy);
    if (hash(k0, k1, set.seed, 12050) > 0.6 || r.w < 20 || r.L < 30) continue;
    const outer = c.shape[0].pts;
    const inside = (x: number, y: number) => pointInRing(x, y, outer) && c.shape.slice(1).every((h) => !pointInRing(x, y, h.pts));
    // Tables run along the field's length; their low edge faces the sun.
    const vx = -r.uy;
    const vy = r.ux;
    const toSun = vx * sx + vy * sy >= 0 ? 1 : -1;
    const T = 12;
    const D = 2.6;
    for (let b = -r.w / 2 + 6; b <= r.w / 2 - 6; b += 11) {
      for (let a = -r.L / 2 + T / 2 + 3; a <= r.L / 2 - T / 2 - 3; a += T + 1.8) {
        const P = (da: number, db: number) => onRect(r, a + da, b + db);
        const ends = [P(-T / 2, -D / 2), P(T / 2, -D / 2), P(T / 2, D / 2), P(-T / 2, D / 2)];
        if (!ends.every(([x, y]) => inside(x, y) && !onMask(paper, M.road, x, y) && !onMask(paper, M.foot, x, y) && !onMask(paper, M.water, x, y))) continue;
        const [mx, my] = P(0, 0);
        const ms = cam.sx(mx, my);
        const mys = cam.sy(mx, my, 0);
        if (ms < paper.x0 - 8 || ms > paper.x1 + 8 || mys < paper.y0 - 8 || mys > paper.y1 + 8) continue;
        const s = newSolid();
        s.facet = 'future-agrivoltaic';
        // Low on the sun side, high on the other.
        const Q = (da: number, db: number) => {
          const [x, y] = P(da, db);
          return [x, y, 3.4 - db * toSun * 0.35];
        };
        const quad = [Q(-T / 2, -D / 2), Q(T / 2, -D / 2), Q(T / 2, D / 2), Q(-T / 2, D / 2)];
        const face = [quad.flat()];
        s.faces.push(face);
        s.lines.push({ pen: ROOFS, pts: quad.flat(), closed: true });
        panels(B, s.lines, (da, db) => Q(da, db), -T / 2, T / 2, -D / 2, D / 2, 2, D, face, 'future-agrivoltaic', 'ground');
        for (const da of [-T / 2 + 0.6, T / 2 - 0.6]) {
          const [x, y, z] = Q(da, 0);
          s.lines.push({ pen: LINEWORK, pts: [x, y, 0, x, y, z] });
        }
        // The panel's own shadow, a strip beside the row, not a block under it.
        s.shade = [face];
        for (const l of s.lines) l.facet ??= 'future-agrivoltaic';
        out.push(s);
        tables++;
      }
    }
  }
  return out;
}

/**
 * A spheroid's outline as seen along `dir`: the ring of points where the line of sight grazes
 * it. It is planar, so it doubles as a face for the depth buffer or for a shadow.
 */
function rim(C: V3, u: V3, v: V3, w: V3, a: number, b: number, dir: V3, n: number): number[] {
  const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const d: V3 = [dot(u, dir) / a, dot(v, dir) / b, dot(w, dir) / b];
  const dl = Math.hypot(...d) || 1;
  const dn: V3 = [d[0] / dl, d[1] / dl, d[2] / dl];
  // Two unit vectors square to it.
  const seed: V3 = Math.abs(dn[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const c1: V3 = [dn[1] * seed[2] - dn[2] * seed[1], dn[2] * seed[0] - dn[0] * seed[2], dn[0] * seed[1] - dn[1] * seed[0]];
  const l1 = Math.hypot(...c1);
  const e1: V3 = [c1[0] / l1, c1[1] / l1, c1[2] / l1];
  const e2: V3 = [dn[1] * e1[2] - dn[2] * e1[1], dn[2] * e1[0] - dn[0] * e1[2], dn[0] * e1[1] - dn[1] * e1[0]];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const X = e1.map((e, k) => Math.cos(t) * e + Math.sin(t) * e2[k]);
    for (let k = 0; k < 3; k++) out.push(C[k] + u[k] * a * X[0] + v[k] * b * X[1] + w[k] * b * X[2]);
  }
  return out;
}

/** An airship: a long envelope skinned with solar film along its back, tail fins and a gondola. */
function airship(B: Build, x: number, y: number, z: number, ux: number, uy: number, L: number, sunHeight: number): Solid {
  const s = newSolid();
  s.facet = 'future-airship';
  const a = L / 2;
  const b = L * 0.16;
  const C: V3 = [x, y, z];
  const u: V3 = [ux, uy, 0];
  const v: V3 = [-uy, ux, 0];
  const w: V3 = [0, 0, 1];
  const { view } = basis(B.cam);
  const hull = rim(C, u, v, w, a, b, view, 48);
  s.faces.push([hull]);
  s.lines.push({ pen: LINEWORK, pts: hull, closed: true });
  const h = (sunHeight * Math.PI) / 180;
  const ray: V3 = [-B.sun[0] * Math.cos(h), -B.sun[1] * Math.cos(h), -Math.sin(h)];
  s.shade = [[rim(C, u, v, w, a, b, ray, 32)]];
  const P = (t: number, phi: number): number[] => {
    const r = b * Math.sin(t);
    return [0, 1, 2].map((k) => C[k] + u[k] * a * Math.cos(t) + (v[k] * Math.cos(phi) + w[k] * Math.sin(phi)) * r);
  };
  // Solar film on the back: strips along, and seams across.
  const fine = shows(B.cam, LOD.solarSeam, b * 0.3);
  for (const phi of fine ? [1.2, 1.57, 1.94] : [1.25, 1.89]) {
    const pts: number[] = [];
    for (let m = 0; m <= 18; m++) pts.push(...P(0.22 * Math.PI + (0.56 * Math.PI * m) / 18, phi));
    s.lines.push({ pen: ROOFS, pts });
  }
  if (fine)
    for (let m = 1; m < 7; m++) {
      const t = 0.22 * Math.PI + (0.56 * Math.PI * m) / 7;
      const pts: number[] = [];
      for (let q = 0; q <= 6; q++) pts.push(...P(t, 1.2 + (0.74 * q) / 6));
      s.lines.push({ pen: ROOFS, pts });
    }
  // Four fins at the tail.
  for (const [dx, dy, dz] of [[w[0], w[1], 1], [w[0], w[1], -1], [v[0], v[1], 0], [-v[0], -v[1], 0]]) {
    const n: V3 = dz === 0 ? [dx, dy, 0] : [0, 0, dz];
    const F = (along: number, out: number) => [0, 1, 2].map((k) => C[k] - u[k] * a * along + n[k] * b * out);
    const fin = [...F(0.62, 0.78), ...F(0.94, 0.33), ...F(1.0, 1.25), ...F(0.8, 1.25)];
    s.faces.push([fin]);
    s.lines.push({ pen: LINEWORK, pts: fin, closed: true });
  }
  // The gondola under the belly.
  const g = place(x + ux * a * 0.08, y + uy * a * 0.08, ux, uy, rect(-L * 0.09, L * 0.09, -b * 0.22, b * 0.22));
  prism(B, [{ pts: g, seam: new Uint8Array(4) }], z - b - b * 0.35, z - b * 0.9, { roof: false, windows: false, pen: LINEWORK }, s);
  for (const l of s.lines) l.facet ??= 'future-airship';
  return s;
}

/** Airships drifting high over the town, one now and then, on cells fixed to the map. */
export function airships(B: Build, toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Extra {
  const solids: Solid[] = [];
  const { set, cam } = B;
  if (!future(set) || !set.life || !shows(cam, LOD.airship)) return { solids, draw: () => {} };
  const box = cam.region(300);
  const size = 800;
  const [A0x, A0y] = toAbs(box[0], box[1]);
  const [A1x, A1y] = toAbs(box[2], box[3]);
  const [x0, y0, x1, y1] = cam.rect;
  for (let i = Math.floor(A0x / size); i <= Math.ceil(A1x / size); i++) {
    for (let j = Math.floor(A0y / size); j <= Math.ceil(A1y / size); j++) {
      const h = (salt: number) => hash(i, j, set.seed, 12060 + salt);
      if (h(0) > 0.5) continue;
      const [x, y] = fromAbs((i + h(1)) * size, (j + h(2)) * size);
      const z = 110 + 90 * h(3);
      const L = 70 + 45 * h(4);
      const sx = cam.sx(x, y);
      const sy = cam.sy(x, y, z);
      const m = (L / 2) * cam.s + 4;
      if (sx < x0 + m || sx > x1 - m || sy < y0 + m || sy > y1 - m) continue;
      const head = h(5) * Math.PI * 2;
      solids.push(airship(B, x, y, z, Math.cos(head), Math.sin(head), L, set.sunHeight));
    }
  }
  return { solids, draw: () => {} };
}

/** A bicycle with its rider, or a cargo bike with a box up front: lines only. */
function bike(B: Build, x: number, y: number, ux: number, uy: number, cargo: boolean, k: number): Solid {
  const s = newSolid();
  const P = (a: number, c: number, z: number) => [x + ux * a - uy * c, y + uy * a + ux * c, z];
  const R = 0.33;
  const wheel = (a: number) => {
    const pts: number[] = [];
    for (let q = 0; q < 10; q++) {
      const t = (q / 10) * Math.PI * 2;
      pts.push(...P(a + Math.cos(t) * R, 0, R + Math.sin(t) * R));
    }
    s.lines.push({ pen: LINEWORK, pts, closed: true });
  };
  const rear = cargo ? -0.85 : -0.55;
  const front = 0.55;
  wheel(rear);
  wheel(front);
  s.lines.push({ pen: LINEWORK, pts: [...P(rear, 0, R), ...P(-0.1, 0, 0.95), ...P(front - 0.1, 0, 1.0), ...P(front, 0, R)] });
  if (cargo) {
    const box = place(x + ux * -0.05, y + uy * -0.05, ux, uy, rect(-0.35, 0.35, -0.4, 0.4));
    prism(B, [{ pts: box, seam: new Uint8Array(4) }], 0.45, 1.0, { roof: true, windows: false, pen: LINEWORK }, s);
  }
  // The rider: back and head.
  const seat = P(-0.2 + (cargo ? -0.35 : 0), 0, 1.0);
  const shoulder = P(0.05 + (cargo ? -0.35 : 0), 0, 1.55);
  s.lines.push({ pen: LINEWORK, pts: [...seat, ...shoulder, ...P(front - 0.12, 0, 1.08)] });
  const head = crown(B, shoulder[0], shoulder[1], shoulder[2] + 0.22, 0.13, k, 8);
  s.faces.push([head]);
  s.lines.push({ pen: LINEWORK, pts: head, closed: true });
  return s;
}

/** A small rounded electric pod, with a solar roof. */
function pod(B: Build, x: number, y: number, ux: number, uy: number, cargo: boolean): Solid {
  const s = newSolid();
  const L = cargo ? 2.4 : 1.4;
  const w = cargo ? 1.05 : 0.8;
  const c = 0.35;
  const ring = place(x, y, ux, uy, [[-L, -w + c], [-L + c, -w], [L - c, -w], [L, -w + c], [L, w - c], [L - c, w], [-L + c, w], [-L, w - c]]);
  const top = cargo ? 2.3 : 1.45;
  prism(B, [{ pts: ring, seam: new Uint8Array(8) }], 0.15, top, { roof: true, windows: false, pen: LINEWORK }, s);
  const roof = s.faces[s.faces.length - 1];
  panels(B, s.lines, (a, b) => {
    const [px, py] = place(x, y, ux, uy, [[a, b]]);
    return [px, py, top];
  }, -L + c, L - c, -w + c, w - c, cargo ? 1.2 : L, w, roof, 'future-vehicle', 'cars');
  if (!cargo) s.lines.push({ pen: LINEWORK, pts: [...place(x, y, ux, uy, [[L * 0.55, -w]]), 0.9, ...place(x, y, ux, uy, [[L * 0.55, w]]), 0.9] });
  s.casts.push({ ring, h: top });
  return s;
}

/** A tram-like electric bus with solar panels along its roof. */
function solarBus(B: Build, x: number, y: number, ux: number, uy: number, L: number): Solid {
  const s = newSolid();
  const ring = place(x, y, ux, uy, rect(-L, L, -1.25, 1.25));
  prism(B, [{ pts: ring, seam: new Uint8Array(4) }], 0.2, 3.0, { roof: true, windows: false, pen: LINEWORK }, s);
  const roof = s.faces[s.faces.length - 1];
  panels(B, s.lines, (a, b) => {
    const [px, py] = place(x, y, ux, uy, [[a, b]]);
    return [px, py, 3.0];
  }, -L + 0.5, L - 0.5, -0.9, 0.9, 1.6, 1.8, roof, 'future-vehicle', 'cars');
  // A band of windows.
  for (const side of [-1.25, 1.25]) {
    const a = place(x, y, ux, uy, [[-L + 0.6, side], [L - 0.6, side]]);
    s.lines.push({ pen: LINEWORK, pts: [a[0], a[1], 1.4, a[2], a[3], 1.4] });
  }
  s.casts.push({ ring, h: 3.0 });
  return s;
}

/** A future stand-in for a vehicle of the present: its length, and how to make it. */
export function futureVehicle(B: Build, kind: 'car' | 'bus' | 'truck', k: number, parked: boolean): { len: number; make: (x: number, y: number, ux: number, uy: number) => Solid | null } {
  const tag = (s: Solid) => {
    s.facet = 'future-vehicle';
    for (const l of s.lines) l.facet ??= 'future-vehicle';
    return s;
  };
  if (parked) {
    // Most kerbside parking is now planters and benches; a few pods still wait there.
    if (k < 0.55) return { len: 4.4, make: (x, y, ux, uy) => parklet(B, x, y, ux, uy, k) };
    if (k < 0.8) return { len: 0, make: () => null };
    return { len: 2.8, make: (x, y, ux, uy) => tag(pod(B, x, y, ux, uy, false)) };
  }
  if (kind === 'bus') return { len: 12, make: (x, y, ux, uy) => tag(solarBus(B, x, y, ux, uy, 6)) };
  if (kind === 'truck') return { len: 4.8, make: (x, y, ux, uy) => tag(pod(B, x, y, ux, uy, true)) };
  if (k < 0.5) return { len: 1.8, make: (x, y, ux, uy) => tag(bike(B, x, y, ux, uy, false, k)) };
  if (k < 0.62) return { len: 2.3, make: (x, y, ux, uy) => tag(bike(B, x, y, ux, uy, true, k)) };
  return { len: 2.8, make: (x, y, ux, uy) => tag(pod(B, x, y, ux, uy, false)) };
}

/** A parklet where a car used to park: a planter box with bushes, and a bench. */
function parklet(B: Build, x: number, y: number, ux: number, uy: number, k: number): Solid {
  const s = newSolid();
  s.facet = 'future-parklet';
  const box = place(x, y, ux, uy, rect(-2, 2, -0.6, 0.6));
  prism(B, [{ pts: box, seam: new Uint8Array(4) }], 0, 0.55, { roof: true, windows: false, pen: LINEWORK }, s);
  for (const a of [-1.2, 0, 1.2]) {
    const [px, py] = place(x, y, ux, uy, [[a, 0]]);
    plant(B, s, px, py, 0.55, 0.55 + 0.2 * Math.abs(Math.sin(k * 40 + a)), 0, k + a, 'future-parklet');
  }
  s.casts.push({ ring: box, h: 0.55 });
  for (const l of s.lines) l.facet ??= 'future-parklet';
  return s;
}

/**
 * A solar canopy over one parking bay, from the aisle (`v0`) back over the bay's depth, low at
 * the aisle and higher at the back. `last` closes the row's far end.
 */
export function carport(B: Build, x: number, y: number, ux: number, uy: number, nx: number, ny: number, v0: number, W: number, D: number, first: boolean, last: boolean): Solid {
  const s = newSolid();
  s.facet = 'future-carport';
  const P = (a: number, d: number) => [x + ux * a + nx * (v0 + d), y + uy * a + ny * (v0 + d), 2.5 + d * 0.12];
  const quad = [P(0, 0.2), P(W, 0.2), P(W, D), P(0, D)];
  const face = [quad.flat()];
  s.faces.push(face);
  s.lines.push({ pen: LINEWORK, pts: [...P(0, 0.2), ...P(W, 0.2)] }, { pen: LINEWORK, pts: [...P(0, D), ...P(W, D)] });
  if (first) s.lines.push({ pen: LINEWORK, pts: [...P(0, 0.2), ...P(0, D)] });
  if (last) s.lines.push({ pen: LINEWORK, pts: [...P(W, 0.2), ...P(W, D)] });
  else s.lines.push({ pen: ROOFS, pts: [...P(W, 0.2), ...P(W, D)], on: face });
  panels(B, s.lines, P, 0, W, 0.2, D, W, D / 3, face, 'future-carport', 'streets');
  // A post at the back of every other bay.
  if (first || hash(...B.key(x, y), B.set.seed, 12070) < 0.5) {
    const [px, py, pz] = P(0, D - 0.3);
    s.lines.push({ pen: LINEWORK, pts: [px, py, 0, px, py, pz] });
  }
  s.shade = [face];
  for (const l of s.lines) l.facet ??= 'future-carport';
  return s;
}

/** Solar panels over a charging hub's canopy, which stands where the petrol station was. */
export function canopyPanels(B: Build, s: Solid, x: number, y: number, ux: number, uy: number, z: number): void {
  s.facet = 'future-charging';
  const top = s.faces.find((f) => f[0].length >= 12 && f[0].every((v, i) => i % 3 !== 2 || Math.abs(v - z) < 1e-6));
  panels(B, s.lines, (a, b) => {
    const [px, py] = place(x, y, ux, uy, [[a, b]]);
    return [px, py, z];
  }, -6.6, 6.6, -4.1, 4.1, 1.1, 1.6, top, 'future-charging', 'streets');
}

/**
 * A wall in the future, wherever it faces the viewer. Mostly green tech rather than greenery:
 * glass bands round rounded corners, shading fins or louvres on sunny glazed walls, solar
 * cladding on blank sunny walls of halls. Now and then planted troughs, shrubs or climbers.
 */
export function greenWall(B: Build, out: Solid, face: number[][], ax: number, ay: number, bx: number, by: number, z0: number, z1: number, fa: Facade, ground: boolean): void {
  const { cam } = B;
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 0.3 || z1 - z0 < 2.2) return;
  const storey = fa.storey || B.style.floor;
  // The facets of a rounded corner carry the floors round it as glass bands.
  if (len < 2.4) {
    if (storey <= 20 && shows(cam, LOD.floors, storey * cam.ca)) bands(out, face, ax, ay, bx, by, z0, z1, storey);
    return;
  }
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  // Outward, for counter-clockwise rings.
  const nx = uy;
  const ny = -ux;
  const [k0, k1] = B.key((ax + bx) / 2, (ay + by) / 2);
  const h = (salt: number) => hash(k0, k1, B.seed, 12100 + salt);
  const at = (t: number, d: number): [number, number] => [ax + ux * t + nx * d, ay + uy * t + ny * d];
  const sunny = nx * B.sun[0] + ny * B.sun[1];

  // Shrubs along the foot of some walls.
  if (ground && z0 < 0.5 && h(0) < 0.22)
    for (let t = 0.9; t < len - 0.6; t += 1.7 + h(1) * 0.6) {
      const [x, y] = at(t, 0.85);
      const [ka, kb] = B.key(x, y);
      plant(B, out, x, y, 0, 0.6 + hash(ka, kb, B.seed, 12102) * 0.35, 0, hash(ka, kb, B.seed, 12103), 'future-planters');
    }

  // Halls clad in solar panels on their sunny blank walls.
  const blank = fa.pattern === 'blank' || fa.pattern === 'clerestory' || fa.pattern === 'officeEnd';
  if (blank && sunny > 0.2 && len > 6) {
    panels(B, out.lines, (t, z) => [ax + ux * t, ay + uy * t, z], 0.6, len - 0.6, z0 + 0.8, Math.min(z1 - 0.6, z0 + 14), 1.1, 1.8, face, 'future-solar-facade', 'details');
    return;
  }

  const floors = storey > 20 ? 0 : Math.floor((z1 - z0 - 1.2) / storey);
  // Sunny glazed walls of blocks shade themselves.
  const glazed = fa.pattern === 'curtain' || fa.pattern === 'ribbon' || fa.pattern === 'grid' || fa.pattern === 'tall';
  if (glazed && floors >= 2 && sunny > 0.25 && h(6) < 0.7 && shows(cam, LOD.shading, storey)) {
    shading(out, ax, ay, ux, uy, nx, ny, len, z0, z1, storey, h(7) < 0.4);
    return;
  }

  // Planted troughs along the storeys of a few walls.
  if (floors >= 1 && len >= 3 && h(2) < 0.12 && shows(cam, LOD.planter, storey)) {
    for (let fl = 1; fl <= floors && fl <= 30; fl++) {
      if (fl % 2 === 0 && floors > 3) continue;
      const zf = z0 + fl * storey;
      const bay = len > 12 ? 5.5 : len;
      for (let t0 = 0.35; t0 < len - 1.2; t0 += bay) {
        const t1 = Math.min(len - 0.35, t0 + bay - (len > 12 ? 0.8 : 0.35));
        const [ka, kb] = B.key(...at((t0 + t1) / 2, 0));
        const r = (salt: number) => hash(ka, kb, B.seed, 12110 + fl * 7 + salt);
        if (r(0) < 0.15) continue;
        const ring = [...at(t0, 0), ...at(t1, 0), ...at(t1, 0.75), ...at(t0, 0.75)];
        prism(B, [{ pts: ringArea(ring) < 0 ? [...at(t0, 0.75), ...at(t1, 0.75), ...at(t1, 0), ...at(t0, 0)] : ring, seam: new Uint8Array(4) }], zf - 0.15, zf + 0.4, { roof: true, windows: false, pen: LINEWORK }, out);
        for (let t = t0 + 0.6; t < t1 - 0.3; t += 1.5 + r(1) * 0.5) {
          const [x, y] = at(t, 0.4);
          plant(B, out, x, y, zf + 0.4, 0.5 + r(3) * 0.3, 0, r(4) + t, 'future-planters');
        }
      }
    }
    return;
  }
  if (h(5) < 0.12) vines(B, out, face, ax, ay, bx, by, z0, z1, 8);
}

/** The shady slope of a pitched roof planted over: sedum tufts on its face and a row of bushes along it. False when too small to draw, so the caller hatches it green instead. */
export function greenSlope(B: Build, out: Solid, P: (u: number, v: number) => number[], u0: number, u1: number, v0: number, v1: number, face: number[][]): boolean {
  const cam = B.cam;
  if (u1 - u0 < 1.5 || v1 - v0 < 1 || !shows(cam, LOD.sedum)) return false;
  {
    const gap = cam.gap(3.0) / cam.s;
    const t = (cam.nib * 0.9) / cam.s;
    const { right, up } = basis(cam);
    for (let u = u0 + gap / 2; u < u1; u += gap)
      for (let v = v0 + gap / 3; v < v1; v += gap * 0.7) {
        const [x, y, z] = P(u, v);
        const Q = (dr: number, du: number) => [x + right[0] * dr + up[0] * du, y + right[1] * dr + up[1] * du, z + up[2] * du];
        out.lines.push({ pen: GREENERY, pts: [...Q(-t, t * 1.3), ...Q(0, 0), ...Q(t, t * 1.3)], on: face, facet: 'future-green-roof' });
      }
  }
  const vm = (v0 + v1) / 2;
  for (let u = u0 + 0.8; u < u1 - 0.5; u += 2.2) {
    const [x, y, z] = P(u, vm);
    const [ka, kb] = B.key(x, y);
    plant(B, out, x, y, z - 0.3, 0.5 + hash(ka, kb, B.seed, 12160) * 0.3, 0, hash(ka, kb, B.seed, 12161), 'future-green-roof');
  }
  return true;
}

/**
 * Glass biodomes in big parks: a hemisphere of triangulated struts, latitude rings and
 * meridians crossed by diagonals, standing on a low ring wall.
 */
export function biodomes(B: Build, paper: Paper, parks: Shape[], M: Masks): Extra {
  const solids: Solid[] = [];
  const { cam, set } = B;
  if (!future(set) || !shows(cam, LOD.biodome)) return { solids, draw: () => {} };
  for (const shape of parks) {
    const outer = shape[0].pts;
    const area = Math.abs(ringArea(outer));
    if (area < 2500) continue;
    const { rect: r } = bestRect(outer);
    if (!r) continue;
    const [k0, k1] = B.key(r.cx, r.cy);
    const h = (salt: number) => hash(k0, k1, set.seed, 12170 + salt);
    if (h(0) > 0.55) continue;
    const R = Math.min(22, r.w * 0.32, r.L * 0.3);
    if (R < 6) continue;
    const x = r.cx + r.ux * (h(1) - 0.5) * (r.L / 2 - R);
    const y = r.cy + r.uy * (h(1) - 0.5) * (r.L / 2 - R);
    let clear = pointInRing(x, y, outer);
    for (let q = 0; q < 12 && clear; q++) {
      const px = x + Math.cos((q / 12) * Math.PI * 2) * R;
      const py = y + Math.sin((q / 12) * Math.PI * 2) * R;
      clear = !onMask(paper, M.road, px, py) && !onMask(paper, M.foot, px, py) && !onMask(paper, M.water, px, py);
    }
    if (!clear) continue;
    solids.push(dome(B, x, y, R, h(2)));
  }
  return { solids, draw: () => {} };
}

function dome(B: Build, x: number, y: number, R: number, k: number, z0 = 0): Solid {
  const s = newSolid();
  s.facet = 'future-biodome';
  const nLat = Math.max(4, Math.min(8, Math.round(R / 2.6)));
  const nLon = nLat * 4;
  const phase = k * Math.PI;
  const P = (i: number, j: number) => {
    const th = (i / nLat) * (Math.PI / 2);
    const ph = phase + (j / nLon) * Math.PI * 2 + (i % 2 ? Math.PI / nLon : 0);
    return [x + Math.cos(ph) * Math.cos(th) * R, y + Math.sin(ph) * Math.cos(th) * R, z0 + 0.6 + Math.sin(th) * R];
  };
  for (let i = 0; i < nLat; i++)
    for (let j = 0; j < nLon; j++) {
      s.faces.push([[...P(i, j), ...P(i, j + 1), ...P(i + 1, j + 1)]]);
      s.faces.push([[...P(i, j), ...P(i + 1, j + 1), ...P(i + 1, j)]]);
    }
  const fine = shows(B.cam, LOD.solarSeam, (R * Math.PI) / nLon);
  for (let i = 0; i < nLat; i++) {
    const ring: number[] = [];
    for (let j = 0; j < nLon; j++) ring.push(...P(i, j));
    s.lines.push({ pen: LINEWORK, pts: ring, closed: true });
    // Struts up to the next ring: a zigzag of triangles.
    if (!fine && i % 2) continue;
    const zig: number[] = [];
    for (let j = 0; j <= nLon; j++) zig.push(...P(i, j), ...P(i + 1, j));
    s.lines.push({ pen: LINEWORK, pts: zig });
  }
  // The low ring wall and the outline against the sky.
  const base: number[] = [];
  for (let q = 0; q < 40; q++) base.push(x + Math.cos((q / 40) * Math.PI * 2) * R, y + Math.sin((q / 40) * Math.PI * 2) * R);
  prism(B, [{ pts: base, seam: new Uint8Array(40) }], z0, z0 + 0.6, { roof: false, windows: false, pen: LINEWORK }, s);
  const { right, up } = basis(B.cam);
  const sky: number[] = [];
  for (let q = 0; q <= 40; q++) {
    const a = (q / 40) * Math.PI;
    const c = Math.cos(a) * R;
    const sn = Math.sin(a) * R;
    const pz = z0 + 0.6 + up[2] * sn;
    if (pz < z0 + 0.6) continue;
    sky.push(x + right[0] * c + up[0] * sn, y + right[1] * c + up[1] * sn, pz);
  }
  s.lines.push({ pen: LINEWORK, pts: sky });
  s.casts.push({ ring: base, h: R * 0.75 });
  for (const l of s.lines) l.facet ??= 'future-biodome';
  return s;
}

/** Floating solar: rafts of panels moored on lakes and wide basins, clear of the shore. */
export function floatingSolar(B: Build, paper: Paper, water: Shape[], M: Masks): Extra {
  const solids: Solid[] = [];
  const { cam, set } = B;
  if (!future(set) || !shows(cam, LOD.agrivoltaic)) return { solids, draw: () => {} };
  const wet = (x: number, y: number) => onMask(paper, M.water, x, y) && !onMask(paper, M.calm, x, y) && !onMask(paper, M.under, x, y) && !onMask(paper, M.road, x, y);
  let rafts = 0;
  for (const shape of water) {
    const outer = shape[0].pts;
    const area = Math.abs(ringArea(outer));
    if (area < 12000 || rafts > 1500) continue;
    const { rect: r } = bestRect(outer);
    if (!r || r.w < 50) continue;
    const [k0, k1] = B.key(r.cx, r.cy);
    const h = (salt: number) => hash(k0, k1, set.seed, 12180 + salt);
    if (h(0) > 0.7) continue;
    // One patch, off centre, as big as the water allows.
    const span = Math.min(160, r.L * 0.35);
    const depth = Math.min(90, r.w * 0.3);
    const cx = (h(1) - 0.5) * (r.L - span) * 0.6;
    const cc = (h(2) - 0.5) * (r.w - depth) * 0.6;
    const tilt = r.ux * B.sun[0] + r.uy * B.sun[1];
    for (let c = -depth / 2; c <= depth / 2; c += 5.5)
      for (let a = -span / 2; a <= span / 2; a += 9) {
        const P = (da: number, dc: number) => onRect(r, cx + a + da, cc + c + dc);
        const ends = [P(-4, -1.6), P(4, -1.6), P(4, 1.6), P(-4, 1.6)];
        const room = [P(-9, -6), P(9, -6), P(9, 6), P(-9, 6)];
        if (!ends.every(([x, y]) => wet(x, y)) || !room.every(([x, y]) => wet(x, y))) continue;
        const [mx, my] = P(0, 0);
        const ms = cam.sx(mx, my);
        const mys = cam.sy(mx, my, 0);
        if (ms < paper.x0 - 6 || ms > paper.x1 + 6 || mys < paper.y0 - 6 || mys > paper.y1 + 6) continue;
        const s = newSolid();
        s.facet = 'future-floating-solar';
        const Q = (da: number, dc: number) => {
          const [x, y] = P(da, dc);
          return [x, y, 0.5 + (tilt >= 0 ? -da : da) * 0.05];
        };
        const quad = [Q(-4, -1.6), Q(4, -1.6), Q(4, 1.6), Q(-4, 1.6)];
        const face = [quad.flat()];
        s.faces.push(face);
        s.lines.push({ pen: ROOFS, pts: quad.flat(), closed: true });
        panels(B, s.lines, (da, dc) => Q(da, dc), -4, 4, -1.6, 1.6, 2, 1.6, face, 'future-floating-solar', 'water');
        for (const l of s.lines) l.facet ??= 'future-floating-solar';
        solids.push(s);
        rafts++;
      }
  }
  return { solids, draw: () => {} };
}

/**
 * Trees down the middle of streets: residential streets are de-paved round a row of trees,
 * and wide roads get a planted median. Spaced from each way's own start, so they stay put.
 */
export function roadTrees(B: Build, paper: Paper, ways: Way[], M: Masks): Tree[] {
  const out: Tree[] = [];
  const { set } = B;
  if (!future(set) || set.trees <= 0) return out;
  for (const w of ways) {
    if (w.kind !== 'road' || w.bridge) continue;
    const median = (w.cls === 'primary' || w.cls === 'secondary' || w.cls === 'tertiary' || w.cls === 'trunk') && w.width >= 9;
    const quiet = w.cls === 'minor' && w.width >= 4.5;
    if (!median && !quiet) continue;
    const p = w.pts;
    const total = totalLength(p);
    let cum = 0;
    let next = median ? 8 : 11;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const l = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      while (next <= cum + l) {
        const t = (next - cum) / l;
        const x = p[i] + (p[i + 2] - p[i]) * t;
        const y = p[i + 1] + (p[i + 3] - p[i + 1]) * t;
        next += median ? 8 : 11;
        if (next > total - 6) break;
        if (!onMask(paper, M.road, x, y) || onMask(paper, M.foot, x, y) || onMask(paper, M.water, x, y)) continue;
        const [k0, k1] = B.key(x, y);
        if (hash(k0, k1, set.seed, 12190) > (median ? 0.92 : 0.8)) continue;
        const r = (median ? 2 : 1.6) + hash(k0, k1, set.seed, 12191) * 0.7;
        out.push({ x, y, r, h: r + 3 + hash(k0, k1, set.seed, 12192) * 2, conifer: false, from: 'future-road-trees' });
      }
      cum += l;
    }
  }
  return out;
}

function totalLength(p: number[]): number {
  let s = 0;
  for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return s;
}

/**
 * A footprint with its corners rounded: each corner becomes an arc of radius up to `R`,
 * smaller where the walls beside it are short. Nearly straight corners stay as they are.
 */
export function soften(p: number[], R: number): number[] {
  const n = p.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = (i - 1 + n) % n;
    const j = (i + 1) % n;
    const vx = p[i * 2];
    const vy = p[i * 2 + 1];
    let d1x = p[h * 2] - vx;
    let d1y = p[h * 2 + 1] - vy;
    let d2x = p[j * 2] - vx;
    let d2y = p[j * 2 + 1] - vy;
    const l1 = Math.hypot(d1x, d1y);
    const l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    d1x /= l1;
    d1y /= l1;
    d2x /= l2;
    d2y /= l2;
    const alpha = Math.acos(Math.max(-1, Math.min(1, d1x * d2x + d1y * d2y)));
    if (alpha > (165 * Math.PI) / 180 || alpha < 0.2) {
      out.push(vx, vy);
      continue;
    }
    const tanHalf = Math.tan(alpha / 2);
    const t = Math.min(R / tanHalf, 0.45 * Math.min(l1, l2));
    const r = t * tanHalf;
    if (r < 0.4) {
      out.push(vx, vy);
      continue;
    }
    let bx = d1x + d2x;
    let by = d1y + d2y;
    const bl = Math.hypot(bx, by);
    bx /= bl;
    by /= bl;
    const c = r / Math.sin(alpha / 2);
    const cx = vx + bx * c;
    const cy = vy + by * c;
    const a1 = Math.atan2(vy + d1y * t - cy, vx + d1x * t - cx);
    let a2 = Math.atan2(vy + d2y * t - cy, vx + d2x * t - cx);
    let da = a2 - a1;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    a2 = a1 + da;
    const steps = Math.max(2, Math.ceil(Math.abs(da) / (Math.PI / 12)));
    for (let q = 0; q <= steps; q++) {
      const a = a1 + (da * q) / steps;
      out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
  }
  return out;
}

/**
 * A barrel-vaulted roof over a house: a curved shell along the ridge, with its end arcs, eaves,
 * the line where it turns away from the viewer, and solar film over the sunny half.
 */
export function vault(B: Build, r: Rect, He: number, out: Solid): { Hr: number; at: (u: number, v: number, z: number) => number[] } {
  const o = 0.35;
  const hw = r.w / 2 + o;
  const rise = Math.min(r.w * 0.32, 5);
  const L = r.L / 2 + o;
  const vx = -r.uy;
  const vy = r.ux;
  const at = (u: number, v: number, z: number) => [r.cx + r.ux * u + vx * v, r.cy + r.uy * u + vy * v, z];
  const P = (a: number, t: number) => at(a, hw * Math.cos(t), He + rise * Math.sin(t));
  const n = 14;
  for (let i = 0; i < n; i++) {
    const t0 = (i / n) * Math.PI;
    const t1 = ((i + 1) / n) * Math.PI;
    out.faces.push([[...P(-L, t0), ...P(L, t0), ...P(L, t1), ...P(-L, t1)]]);
  }
  // The ends: a half disc over each end wall, and the arc of the roof's edge.
  for (const a of [-r.L / 2, r.L / 2]) {
    const end: number[] = [];
    for (let i = 0; i <= n; i++) end.push(...at(a, (r.w / 2) * Math.cos((i / n) * Math.PI), He + rise * (r.w / 2 / hw) * Math.sin((i / n) * Math.PI)));
    out.faces.push([end]);
  }
  for (const a of [-L, L]) {
    const arc: number[] = [];
    for (let i = 0; i <= n * 2; i++) arc.push(...P(a, (i / (n * 2)) * Math.PI));
    out.lines.push({ pen: ROOFS, pts: arc });
  }
  for (const t of [0, Math.PI]) out.lines.push({ pen: ROOFS, pts: [...P(-L, t), ...P(L, t)] });
  // Where the shell turns away from the viewer.
  const { view } = basis(B.cam);
  const va = view[0] * vx + view[1] * vy;
  const vz = view[2];
  let ts = Math.atan2(-va / hw, vz / rise);
  if (ts < 0) ts += Math.PI;
  if (ts > 0.05 && ts < Math.PI - 0.05) out.lines.push({ pen: ROOFS, pts: [...P(-L, ts), ...P(L, ts)] });
  // Solar film over the sunny half, standing seams over the other.
  const sunny = vx * B.sun[0] + vy * B.sun[1] >= 0;
  const [s0, s1] = sunny ? [0.18, 1.4] : [Math.PI - 1.4, Math.PI - 0.18];
  panels(B, out.lines, (a, t) => P(a, t), -L + 0.6, L - 0.6, s0, s1, 1.05, 0.3, undefined, 'future-vault', 'details');
  for (let k = 1; k <= 3; k++) {
    const t = sunny ? 1.57 + (k * 1.4) / 4 : 1.57 - (k * 1.4) / 4;
    out.lines.push({ pen: ROOFS, pts: [...P(-L, t), ...P(L, t)], layer: 'roofHatch', facet: 'future-vault' });
  }
  for (const l of out.lines) if (l.pen === ROOFS) l.facet ??= 'future-vault';
  return { Hr: He + rise, at };
}

/**
 * Shading on a sunny wall: deep horizontal fins along every storey, or vertical louvres,
 * standing off the glass.
 */
function shading(out: Solid, ax: number, ay: number, ux: number, uy: number, nx: number, ny: number, len: number, z0: number, z1: number, storey: number, vertical: boolean): void {
  const at = (t: number, d: number): [number, number] => [ax + ux * t + nx * d, ay + uy * t + ny * d];
  const line = (pts: number[]) => out.lines.push({ pen: LINEWORK, pts, facet: 'future-shading' });
  if (vertical) {
    for (let t = 0.6; t < len - 0.3; t += 1.25) {
      const [x0, y0] = at(t, 0);
      const [x1, y1] = at(t, 0.6);
      const fin = [x0, y0, z0 + 0.3, x1, y1, z0 + 0.3, x1, y1, z1 - 0.2, x0, y0, z1 - 0.2];
      out.faces.push([fin]);
      line([x0, y0, z0 + 0.3, x1, y1, z0 + 0.3, x1, y1, z1 - 0.2, x0, y0, z1 - 0.2]);
    }
    return;
  }
  for (let z = z0 + storey - 0.05; z < z1 - 0.4; z += storey) {
    const [x0, y0] = at(0.2, 0);
    const [x1, y1] = at(len - 0.2, 0);
    const [x2, y2] = at(len - 0.2, 0.9);
    const [x3, y3] = at(0.2, 0.9);
    out.faces.push([[x0, y0, z, x1, y1, z, x2, y2, z, x3, y3, z]]);
    line([x0, y0, z, x3, y3, z, x2, y2, z, x1, y1, z]);
  }
}

/** Glass bands round a rounded corner: a line at every floor and a mullion at each facet. */
function bands(out: Solid, face: number[][], ax: number, ay: number, bx: number, by: number, z0: number, z1: number, storey: number): void {
  for (let z = z0 + storey; z < z1 - 0.3; z += storey) out.lines.push({ pen: LINEWORK, pts: [ax, ay, z, bx, by, z], on: face, facet: 'future-glass' });
  out.lines.push({ pen: LINEWORK, pts: [ax, ay, z0 + 0.4, ax, ay, z1 - 0.3], on: face, facet: 'future-glass' });
}

/**
 * Exposed services on a roof: a heat store or water tank in a corner, a pair of pipes on
 * low stands running to it across the roof, and a downpipe from it to the ground.
 */
export function pipes(B: Build, r: Rect, z: number, outer: number[], inside: (x: number, y: number) => boolean, k: [number, number], out: Solid[]): void {
  if (!shows(B.cam, LOD.pipe)) return;
  const h = (salt: number) => hash(k[0], k[1], B.seed, 12200 + salt);
  const sa = h(0) < 0.5 ? 1 : -1;
  const sc = h(1) < 0.5 ? 1 : -1;
  const ta = sa * (r.L / 2 - 1.6);
  const tc = sc * (r.w / 2 - 1.6);
  const [tx, ty] = onRect(r, ta, tc);
  if (!inside(tx, ty) || r.L < 8 || r.w < 6) return;
  const s = newSolid();
  s.facet = 'future-pipes';
  // The tank: a drum with a domed lid.
  const R = 1.0;
  const ring: number[] = [];
  for (let q = 0; q < 14; q++) ring.push(tx + Math.cos((q / 14) * Math.PI * 2) * R, ty + Math.sin((q / 14) * Math.PI * 2) * R);
  prism(B, [{ pts: ring, seam: new Uint8Array(14) }], z, z + 2.4, { roof: true, windows: false, pen: LINEWORK }, s);
  const lid = crown(B, tx, ty, z + 2.4, R * 0.95, 0, 14);
  for (let i = 2; i < lid.length; i += 3) lid[i] = Math.max(z + 2.4, lid[i]);
  s.faces.push([lid]);
  s.lines.push({ pen: LINEWORK, pts: lid, closed: true });
  // Two pipes along the roof and across to the tank.
  const run = (off: number, zz: number) => {
    const pts: number[] = [];
    for (const [a, c] of [[-ta * 0.8, tc - sc * 2.2 + off], [ta - sa * 1.6, tc - sc * 2.2 + off], [ta - sa * 1.6, tc - sc * 1.0], [ta - sa * 1.0, tc]]) {
      const [x, y] = onRect(r, a, c);
      pts.push(x, y, zz);
    }
    s.lines.push({ pen: LINEWORK, pts });
  };
  run(0, z + 0.6);
  run(0.5, z + 0.75);
  for (let a = -ta * 0.8; Math.abs(a - ta) > 2; a += sa * 2.4) {
    const [x, y] = onRect(r, a, tc - sc * 1.95);
    if (inside(x, y)) s.lines.push({ pen: LINEWORK, pts: [x, y, z, x, y, z + 0.75] });
  }
  // A downpipe at the nearest corner of the footprint, with brackets.
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < outer.length; i += 2) {
    const d = Math.hypot(outer[i] - tx, outer[i + 1] - ty);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const cx = outer[best] + (outer[best] - tx) * (0.35 / (bd || 1));
  const cy = outer[best + 1] + (outer[best + 1] - ty) * (0.35 / (bd || 1));
  s.lines.push({ pen: LINEWORK, pts: [tx, ty, z + 0.6, cx, cy, z + 0.6, cx, cy, 0.3] });
  for (let zz = z - 1; zz > 1; zz -= 3) s.lines.push({ pen: LINEWORK, pts: [outer[best], outer[best + 1], zz, cx, cy, zz] });
  for (const l of s.lines) l.facet ??= 'future-pipes';
  out.push(s);
}

/** A glass dome on a big roof: a geodesic shell like the parks' biodomes, on a short drum. */
export function roofDome(B: Build, r: Rect, z: number, inside: (x: number, y: number) => boolean, out: Solid[]): ((x: number, y: number) => boolean) | undefined {
  const R = Math.min(14, r.w * 0.36, r.L * 0.36);
  if (R < 4 || !shows(B.cam, LOD.biodome, R * 2)) return undefined;
  for (let q = 0; q < 8; q++) if (!inside(r.cx + Math.cos(q) * R, r.cy + Math.sin(q) * R)) return undefined;
  const s = dome(B, r.cx, r.cy, R, 0.3, z);
  s.facet = 'future-glass-dome';
  for (const l of s.lines) l.facet = 'future-glass-dome';
  s.casts = [];
  out.push(s);
  return (x, y) => Math.hypot(x - r.cx, y - r.cy) < R + 0.8;
}

/**
 * A tensile shade sail on three or four masts of differing height: the cloth's hems curve
 * in between the corners, and it casts its shadow.
 */
export function sail(corners: number[][], k: number): Solid {
  const s = newSolid();
  s.facet = 'future-sail';
  const n = corners.length;
  const c = [0, 1, 2].map((a) => corners.reduce((sum, p) => sum + p[a], 0) / n);
  const hem: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % n];
    for (let m = 0; m < 6; m++) {
      const t = m / 6;
      const pull = Math.sin(t * Math.PI) * 0.16;
      for (let a = 0; a < 3; a++) hem.push(p[a] + (q[a] - p[a]) * t + (c[a] - (p[a] + (q[a] - p[a]) * t)) * pull);
    }
  }
  // Triangles from the middle, so a warped sail still fills the depth buffer.
  for (let i = 0; i < hem.length / 3; i++) {
    const j = (i + 1) % (hem.length / 3);
    s.faces.push([[...c, hem[i * 3], hem[i * 3 + 1], hem[i * 3 + 2], hem[j * 3], hem[j * 3 + 1], hem[j * 3 + 2]]]);
  }
  s.lines.push({ pen: ROOFS, pts: hem, closed: true });
  // Seams from the highest corner, and the masts with their guy lines.
  const top = corners.reduce((a, p) => (p[2] > a[2] ? p : a), corners[0]);
  for (let m = 1; m <= 2; m++) {
    const t = m / 3;
    const far = corners[(corners.indexOf(top) + 2) % n];
    const mid = [0, 1, 2].map((a) => far[a] + (c[a] - far[a]) * 0.0);
    s.lines.push({ pen: ROOFS, pts: [...top, ...[0, 1, 2].map((a) => top[a] + (mid[a] - top[a]) * (0.85 + 0.1 * t) + (k - 0.5) * 0.2 * (a === 2 ? 0 : 1))] });
  }
  for (const p of corners) {
    s.lines.push({ pen: LINEWORK, pts: [p[0], p[1], 0, p[0], p[1], p[2] + 0.3] });
    const gx = p[0] + (p[0] - c[0]) * 0.2;
    const gy = p[1] + (p[1] - c[1]) * 0.2;
    s.lines.push({ pen: LINEWORK, pts: [p[0], p[1], p[2] + 0.3, gx, gy, 0] });
  }
  s.shade = [[hem]];
  for (const l of s.lines) l.facet ??= 'future-sail';
  return s;
}

/** Shade sails over squares and pedestrian areas, in a loose grid of overlapping sails. */
export function sails(B: Build, paper: Paper, plazas: Shape[], M: Masks): Extra {
  const solids: Solid[] = [];
  const { cam, set } = B;
  if (!future(set) || !shows(cam, LOD.sail)) return { solids, draw: () => {} };
  for (const sq of plazas) {
    const outer = sq[0].pts;
    if (Math.abs(ringArea(outer)) < 250) continue;
    const { rect: r } = bestRect(outer);
    if (!r) continue;
    const S = 9;
    const na = Math.min(6, Math.floor(r.L / S));
    const nc = Math.min(4, Math.floor(r.w / S));
    for (let i = 0; i < na; i++)
      for (let j = 0; j < nc; j++) {
        const a = -((na - 1) * S) / 2 + i * S;
        const c = -((nc - 1) * S) / 2 + j * S;
        const [x, y] = onRect(r, a, c);
        const [k0, k1] = B.key(x, y);
        const h = (salt: number) => hash(k0, k1, set.seed, 12210 + salt);
        if (h(0) > 0.65) continue;
        const flip = h(1) < 0.5 ? 1 : -1;
        const pts = [[-4, -4 * flip, 3.4 + h(2) * 1.2], [4.2, -3.6 * flip, 5.2 + h(3) * 1.5], [3.6 * (h(4) < 0.5 ? 1 : -1), 4.2 * flip, 3.8 + h(5)]].map(([da, dc, z]) => {
          const [px, py] = onRect(r, a + da, c + dc);
          return [px, py, z];
        });
        if (!pts.every(([px, py]) => pointInRing(px, py, outer) && !onMask(paper, M.foot, px, py) && !onMask(paper, M.water, px, py))) continue;
        solids.push(sail(pts, h(6)));
      }
  }
  return { solids, draw: () => {} };
}

/**
 * A glass sunroom against the sunny side of a house: a lean-to of glass on a slim frame,
 * mullions on its walls and glazing bars down its roof.
 */
export function sunroom(B: Build, r: Rect, outside: Uint8Array, He: number, k: number, out: Solid): void {
  if (!shows(B.cam, LOD.glasshouse)) return;
  // Sides: 0 at -w/2, 1 at +L/2, 2 at +w/2, 3 at -L/2, by their outward normals.
  const normals: [number, number][] = [[r.uy, -r.ux], [r.ux, r.uy], [-r.uy, r.ux], [-r.ux, -r.uy]];
  let side = -1;
  let best = 0.1;
  for (let i = 0; i < 4; i++) {
    const d = normals[i][0] * B.sun[0] + normals[i][1] * B.sun[1];
    if (outside[i] && d > best) {
      best = d;
      side = i;
    }
  }
  if (side < 0) return;
  const along = side % 2 === 0 ? r.L : r.w;
  const W = Math.min(along * 0.6, 4 + k * 3);
  const D = 2.4 + k * 0.8;
  if (W < 2.5) return;
  const half = side % 2 === 0 ? r.w / 2 : r.L / 2;
  const [nx, ny] = normals[side];
  const tx = -ny;
  const ty = nx;
  const P = (t: number, d: number, z: number) => [r.cx + nx * (half + d) + tx * t, r.cy + ny * (half + d) + ty * t, z];
  const lo = 2.4;
  const hi = Math.max(lo + 0.3, Math.min(3.2, He - 0.15));
  const zAt = (d: number) => hi + ((lo - hi) * d) / D;
  const s = out;
  const quad = (pts: number[][]) => s.faces.push([pts.flat()]);
  const line = (...pts: number[][]) => s.lines.push({ pen: LINEWORK, pts: pts.flat(), facet: 'future-glasshouse' });
  const a = -W / 2;
  const b = W / 2;
  quad([P(a, D, 0), P(b, D, 0), P(b, D, lo), P(a, D, lo)]);
  quad([P(a, 0, 0), P(a, D, 0), P(a, D, lo), P(a, 0, hi)]);
  quad([P(b, D, 0), P(b, 0, 0), P(b, 0, hi), P(b, D, lo)]);
  quad([P(a, D, lo), P(b, D, lo), P(b, 0, hi), P(a, 0, hi)]);
  line(P(a, 0, 0), P(a, D, 0), P(b, D, 0), P(b, 0, 0));
  line(P(a, D, 0), P(a, D, lo), P(b, D, lo), P(b, D, 0));
  line(P(a, D, lo), P(a, 0, hi), P(b, 0, hi), P(b, D, lo));
  const fine = shows(B.cam, LOD.solarSeam, 0.9);
  const step = fine ? 0.9 : 1.8;
  for (let t = a + step; t < b - 0.3; t += step) {
    line(P(t, D, 0.1), P(t, D, lo), P(t, 0, hi));
  }
  for (let d = step; d < D - 0.3; d += step) {
    line(P(a, d, 0), P(a, d, zAt(d)));
    line(P(b, d, 0), P(b, d, zAt(d)));
  }
  // A transom at door height all round.
  line(P(a, 0, 2.1), P(a, D, 2.1), P(b, D, 2.1), P(b, 0, 2.1));
  s.casts.push({ ring: [P(a, 0, 0), P(a, D, 0), P(b, D, 0), P(b, 0, 0)].flatMap((p) => [p[0], p[1]]), h: lo });
}
