import { facing, prism, shadeWall, type PrismOptions, type Solid, type WallRing, type Build } from './buildings';
import { LOWEST } from './decay';
import { hash } from './rng';
import type { Info } from './classify';
import { atLeast, LOD, shows } from './lod';
import { LINEWORK } from './settings';
import { offsetRing, type Rect } from './shape';
import { ivy } from './growth';

/*
 * Ruins: buildings that have lost their roofs, for the Abandonment slider (see
 * docs/plans/abandonment.md §5). A shell is its walls as a band, the footprint with a ring
 * inset by the wall's thickness as its hole, so from above you see the outside of the near
 * walls, the inside of the far ones and the tops between. Gables stand on over the end walls.
 */

/** How thick a ruin's walls are, in metres: sheds are thin, churches and civic buildings stone. */
export function wallThickness(info: Info | undefined): number {
  switch (info?.kind) {
    case 'shed':
      return 0.22;
    case 'worship':
    case 'civic':
      return 0.6;
    case 'tall':
    case 'apartment':
    case 'industrial':
      return 0.4;
    default:
      return 0.35;
  }
}

/**
 * How far apart on paper (mm) a wall's two top edges are, for the wall from a to b that is
 * `d` metres thick: foreshortening closes up walls that run away from the viewer.
 */
function apart(B: Build, ax: number, ay: number, bx: number, by: number, d: number): number {
  const c = B.cam;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ex = c.sx(bx, by) - c.sx(ax, ay);
  const ey = c.sy(bx, by, 0) - c.sy(ax, ay, 0);
  const nx = (-(by - ay) / len) * d;
  const ny = ((bx - ax) / len) * d;
  const ox = c.sx(ax + nx, ay + ny) - c.sx(ax, ay);
  const oy = c.sy(ax + nx, ay + ny, 0) - c.sy(ax, ay, 0);
  const el = Math.hypot(ex, ey);
  return el > 1e-9 ? Math.abs(ex * oy - ey * ox) / el : Math.hypot(ox, oy);
}

/** Whether a wall's two top edges stand far enough apart on paper to draw both. */
function twoTops(B: Build, ax: number, ay: number, bx: number, by: number, d: number): boolean {
  return apart(B, ax, ay, bx, by, d) >= B.cam.nib * 2.3;
}

/** A ring's points the other way round, with its seams and party heights to match. */
function reversed(r: WallRing): WallRing {
  const n = r.pts.length / 2;
  const pts: number[] = [];
  const seam = new Uint8Array(n);
  const party = r.party ? new Float32Array(n) : undefined;
  for (let i = 0; i < n; i++) {
    const k = n - 1 - i;
    pts.push(r.pts[k * 2], r.pts[k * 2 + 1]);
    // Edge i of the reversed ring is edge k - 1 of the original, run backwards.
    const e = (k - 1 + n) % n;
    seam[i] = r.seam[e];
    if (party) party[i] = r.party![e];
  }
  return { pts, seam, party };
}

/**
 * A roofless shell: walls `t` metres thick standing to `z1`. `o` are the options the walls
 * would have had under a roof; windows become openings (see `facades.ts`). Returns false
 * when the footprint can't be inset by the wall's thickness, so the caller can draw it
 * another way.
 */
export function shell(B: Build, rings: WallRing[], z1: number, t: number, o: Omit<PrismOptions, 'roof'>, out: Solid, z0 = 0, thin = false): boolean {
  // Thickened up to twice to show its top; still too thin, it is drawn a hair thick, and its
  // inside faces, openings and foot still show that the roof has gone.
  const wide = atLeast(B.cam, LOD.wallTop, t, 2.5);
  const top = !thin && shows(B.cam, LOD.wallTop, wide);
  const d = top ? wide : Math.min(t, 0.08);
  const inner: WallRing[] = [];
  for (const r of rings) {
    // Inward is to the left of every ring: the outer one runs counter-clockwise, courtyards clockwise.
    // A footprint that can't be inset even a hair is drawn with no thickness: its far walls'
    // inside faces still show it is open.
    const pts = offsetRing(r.pts, () => d) ?? (thin ? r.pts.slice() : null);
    if (!pts) return false;
    // Faces turned towards the inside of the building: the same edges, run the other way.
    inner.push(reversed({ pts, seam: r.seam, party: r.party?.map(() => 0) }));
  }
  // The outer walls with their doors and shop fronts; the inner faces with windows only.
  prism(B, rings, z0, z1, { ...o, roof: false }, out);
  const from = out.lines.length;
  prism(B, inner, z0, z1, { roof: false, windows: o.windows, pen: o.pen, facade: o.facade, shutters: o.shutters }, out);
  // Inside a shell the walls are in shade, which is what tells it from a flat roof at a
  // distance: the inside faces are all shaded, not just those turned from the sun.
  out.lines = out.lines.filter((l, i) => i < from || l.layer !== 'shadeWalls');
  for (const r of inner) {
    const p = r.pts;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!r.seam[i]) shadeWall(B, p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1], z0, () => z1, out, false, true);
    }
  }
  // Ivy up the outside walls in view.
  for (const r of rings) {
    const p = r.pts;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (!r.seam[i] && !(r.party && r.party[i] > z0) && facing(B, p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1])) ivy(B, p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1], z0, z1, out);
    }
  }
  // The tops of the walls: one face between the outer rings and the inner ones.
  const band = [...rings, ...inner].map((r) => {
    const f: number[] = [];
    for (let i = 0; i < r.pts.length; i += 2) f.push(r.pts[i], r.pts[i + 1], z1);
    return f;
  });
  out.faces.push(band);
  for (const r of top ? [...rings, ...inner] : rings) {
    const n = r.pts.length / 2;
    const pts: number[] = [];
    let run = false;
    // Wall tops round each ring, broken at seams. A party wall's top is drawn only along its
    // inside edge, so two shells side by side show it as two lines a wall's thickness apart, and
    // each doesn't draw the other's.
    const outside = rings.includes(r);
    const flush = () => {
      if (pts.length >= 6) out.lines.push({ pen: o.pen, pts: pts.slice() });
      pts.length = 0;
      run = false;
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // An inside edge closed up against the outside one on paper is left out.
      const near = !outside && !twoTops(B, r.pts[i * 2], r.pts[i * 2 + 1], r.pts[j * 2], r.pts[j * 2 + 1], d);
      if (r.seam[i] || near || (outside && r.party && r.party[i] > 0)) {
        flush();
        continue;
      }
      if (!run) pts.push(r.pts[i * 2], r.pts[i * 2 + 1], z1);
      pts.push(r.pts[j * 2], r.pts[j * 2 + 1], z1);
      run = true;
    }
    flush();
  }
  // Each wall casts its own shadow, so light falls into the shell.
  for (let k = 0; k < rings.length; k++) {
    const a = rings[k].pts;
    const b = inner[k].pts;
    const n = a.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // The inner ring runs backwards: point i of the outer ring is point n - 1 - i of the inner one.
      const bi = n - 1 - i;
      const bj = n - 1 - j;
      out.casts.push({ ring: [a[i * 2], a[i * 2 + 1], a[j * 2], a[j * 2 + 1], b[bj * 2], b[bj * 2 + 1], b[bi * 2], b[bi * 2 + 1]], h: z1 });
    }
  }
  return true;
}

/**
 * A gable left standing at one end of a roofless house: the triangle (or, where the roof
 * was half-hipped, the trapezoid) over the end wall of rectangle `r`, `t` metres thick. `end`
 * is +1 for the end at +L/2, -1 for the other; `upTo` is the share of the gable's rise left.
 */
export function gable(B: Build, r: Rect, end: 1 | -1, He: number, tan: number, t: number, upTo: number, out: Solid): void {
  const hw = r.w / 2;
  const rise = hw * tan;
  const wide = atLeast(B.cam, LOD.wallTop, t, 2.5);
  const top = shows(B.cam, LOD.wallTop, wide);
  t = top ? wide : Math.min(t, 0.08);
  const zTop = He + rise * upTo;
  const vx = -r.uy;
  const vy = r.ux;
  // The end wall's outside face, and its inside face t metres in.
  const at = (n: number, v: number, z: number) => [r.cx + r.ux * (end * r.L / 2 - end * n) + vx * v, r.cy + r.uy * (end * r.L / 2 - end * n) + vy * v, z];
  // Its outline across the wall, from one eave to the other, as (v, z).
  const outline: [number, number][] = upTo >= 1 ? [[-hw, He], [0, zTop], [hw, He]] : [[-hw, He], [-hw * (1 - upTo), zTop], [hw * (1 - upTo), zTop], [hw, He]];
  const face = (n: number) => outline.flatMap(([v, z]) => at(n, v, z));
  out.faces.push([face(0)], [face(t)]);
  for (let i = 0; i + 1 < outline.length; i++) {
    const [v0, z0] = outline[i];
    const [v1, z1] = outline[i + 1];
    out.faces.push([[...at(0, v0, z0), ...at(0, v1, z1), ...at(t, v1, z1), ...at(t, v0, z0)]]);
  }
  out.lines.push({ pen: LINEWORK, pts: face(0) });
  // Its inside edge, and across the top at each corner, where the thickness shows.
  if (top) {
    out.lines.push({ pen: LINEWORK, pts: face(t) });
    for (const [v, z] of outline) out.lines.push({ pen: LINEWORK, pts: [...at(0, v, z), ...at(t, v, z)] });
  }
  // Shaded like the wall below it, on the face that turns from the sun.
  const [ax, ay] = at(0, end > 0 ? -hw : hw, 0);
  const [bx, by] = at(0, end > 0 ? hw : -hw, 0);
  const profile = (s: number) => {
    const v = end > 0 ? -hw + 2 * hw * s : hw - 2 * hw * s;
    const d = Math.abs(v);
    return upTo >= 1 ? He + rise * (1 - d / hw) : Math.min(zTop, He + rise * (1 - d / hw));
  };
  shadeWall(B, ax, ay, bx, by, He, profile, out, true);
  out.shade = [...(out.shade ?? []), [face(0)]];
}

/** Length of the runs a ruined wall breaks into, in metres; longer where short runs wouldn't read. */
function runLength(B: Build): number {
  return Math.max(1.4, B.cam.gap(2.5) / B.cam.s);
}

/**
 * A wall that has started to come down: each wall of the band breaks into runs of masonry,
 * each standing to its own height. `stand` is the share of the height `H` still standing:
 * runs stand between 0.4 and 1.3 of that, and within 2.5 m of a corner up to a whole
 * `stand` more, so corners stand longest. Heights are keyed on where each run is on the
 * map, and only ever get lower as `stand` falls. Where height has gone, rubble lies at the
 * foot. Returns false when the band can't be made (see `shell()`).
 */
export function ragged(B: Build, rings: WallRing[], H: number, t: number, stand: number, o: Omit<PrismOptions, 'roof'>, out: Solid, z0 = 0, thin = false): boolean {
  const cam = B.cam;
  const wide = atLeast(cam, LOD.wallTop, t, 2.5);
  const top = !thin && shows(cam, LOD.wallTop, wide);
  const d = top ? wide : Math.min(t, 0.08);
  const inner: number[][] = [];
  for (const r of rings) {
    const pts = offsetRing(r.pts, () => d) ?? (thin ? r.pts.slice() : null);
    if (!pts) return false;
    inner.push(pts);
  }
  const run = runLength(B);
  const flat = cam.gap(0.9) / (cam.s * cam.ca);
  const low = Math.max(cam.gap(0.9), cam.nib * 2.5);
  const seed = B.set.seed;
  const pen = o.pen;
  const L = (pts: number[]) => {
    out.lines.push({ pen, pts });
  };
  // Rubble for the height that has gone: wider and higher heaps the lower the walls.
  const lostH = (H - z0) * (1 - stand);
  const w = Math.min(2.2, lostH * 0.3);
  const lift = Math.min(1.1, lostH * 0.12);
  const heaped = lostH > 0.5 && shows(cam, LOD.rubble, 2 * w);
  rings.forEach((r, ri) => {
    const P = r.pts;
    const Q = inner[ri];
    const n = P.length / 2;
    /** Heights of the runs of each edge, kept to draw the corners. */
    const heights: number[][] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const len = Math.hypot(P[j * 2] - P[i * 2], P[j * 2 + 1] - P[i * 2 + 1]);
      const m = Math.max(1, Math.round(len / run));
      const zs: number[] = [];
      for (let k = 0; k < m; k++) {
        const tm = (k + 0.5) / m;
        const [k0, k1] = B.key(P[i * 2] + (P[j * 2] - P[i * 2]) * tm, P[i * 2 + 1] + (P[j * 2 + 1] - P[i * 2 + 1]) * tm);
        const a = LOWEST + 0.9 * hash(k0, k1, seed, 9960);
        const corner = Math.max(0, 1 - Math.min(tm, 1 - tm) * len / 2.5);
        zs.push(z0 + Math.max(0.3, (H - z0) * Math.min(1, stand * (a + corner))));
      }
      // A step too small to see on paper is levelled down to its neighbour, so it isn't a speck.
      for (let k = 1; k < m; k++) if (Math.abs(zs[k] - zs[k - 1]) < flat) zs[k] = zs[k - 1] = Math.min(zs[k], zs[k - 1]);
      heights.push(zs);
    }
    for (let i = 0; i < n; i++) {
      if (r.seam[i]) continue;
      const j = (i + 1) % n;
      const zs = heights[i];
      const m = zs.length;
      const at = (pts: number[], u: number): [number, number] => [pts[i * 2] + (pts[j * 2] - pts[i * 2]) * u, pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * u];
      const partyZ = Math.max(z0, r.party ? r.party[i] : 0);
      const outFacing = facing(B, P[i * 2], P[i * 2 + 1], P[j * 2], P[j * 2 + 1]);
      // The inside face runs the other way.
      const inFacing = facing(B, Q[j * 2], Q[j * 2 + 1], Q[i * 2], Q[i * 2 + 1]);
      // The inside top edge only where it stands clear of the outside one on paper.
      const both = top && twoTops(B, P[i * 2], P[i * 2 + 1], P[j * 2], P[j * 2 + 1], d);
      for (let k = 0; k < m; k++) {
        const z = zs[k];
        const [ax, ay] = at(P, k / m);
        const [bx, by] = at(P, (k + 1) / m);
        const [cx, cy] = at(Q, (k + 1) / m);
        const [dx, dy] = at(Q, k / m);
        // Outside, above any neighbour's wall against it.
        // A wall too low on paper to show its foot apart from its top keeps only its top.
        const footed = (z - partyZ) * cam.ca * cam.s >= low;
        if (outFacing && partyZ < z) {
          out.faces.push([[ax, ay, partyZ, bx, by, partyZ, bx, by, z, ax, ay, z]]);
          if (footed) L([ax, ay, partyZ, bx, by, partyZ]);
          shadeWall(B, ax, ay, bx, by, partyZ, () => z, out);
          ivy(B, ax, ay, bx, by, partyZ, z, out);
        }
        if (inFacing) {
          out.faces.push([[dx, dy, z0, cx, cy, z0, cx, cy, z, dx, dy, z]]);
          if ((z - z0) * cam.ca * cam.s >= low) L([cx, cy, z0, dx, dy, z0]);
          shadeWall(B, cx, cy, dx, dy, z0, () => z, out, false, true);
        }
        // The broken top, and its edges.
        out.faces.push([[ax, ay, z, bx, by, z, cx, cy, z, dx, dy, z]]);
        if (partyZ < z) L([ax, ay, z, bx, by, z]);
        if (both) L([dx, dy, z, cx, cy, z]);
        out.casts.push({ ring: [ax, ay, bx, by, cx, cy, dx, dy], h: z });
        // A step down to the next run: its end face, with an edge down each face and across the top.
        if (k + 1 < m && Math.abs(zs[k + 1] - z) > 0.05) {
          const lo = Math.min(z, zs[k + 1]);
          const hi = Math.max(z, zs[k + 1]);
          out.faces.push([[bx, by, lo, cx, cy, lo, cx, cy, hi, bx, by, hi]]);
          if (hi > partyZ) L([bx, by, Math.max(lo, partyZ), bx, by, hi]);
          if (both) L([cx, cy, lo, cx, cy, hi]);
          if (both) L([bx, by, hi, cx, cy, hi]);
        }
      }
      // Rubble along the foot of the wall, outside (unless a neighbour stands against it) and in.
      if (heaped) {
        const along = (pts: number[]) => Array.from({ length: m + 1 }, (_, k) => at(pts, k / m));
        if (partyZ <= z0) heap(B, along(P), 1, w, lift, 9962, out);
        heap(B, along(Q), -1, w, lift, 9964, out);
      }
    }
    // Corners: an upright at each, up to the taller of the two walls meeting there.
    for (let i = 0; i < n; i++) {
      const h = (i - 1 + n) % n;
      if (r.seam[i] || r.seam[h]) continue;
      const zc = Math.max(heights[h][heights[h].length - 1], heights[i][0]);
      const zp = Math.max(z0, r.party ? Math.max(r.party[h], r.party[i]) : 0);
      if (zc > zp) L([P[i * 2], P[i * 2 + 1], zp, P[i * 2], P[i * 2 + 1], zc]);
      if (top) L([Q[i * 2], Q[i * 2 + 1], z0, Q[i * 2], Q[i * 2 + 1], zc]);
      // Where the two walls stand to different heights, the step at the corner.
      const zl = Math.min(heights[h][heights[h].length - 1], heights[i][0]);
      if (top && zc - zl > 0.05) L([P[i * 2], P[i * 2 + 1], zc, Q[i * 2], Q[i * 2 + 1], zc]);
    }
  });
  return true;
}

/**
 * Rubble heaped along the foot of a wall: `wall` is points along it, `side` +1 for heaps
 * outside it (to its right, as rings run) or -1 inside. The heap slopes from about `lift`
 * up the wall to an uneven toe about `w` out, with a few stones on it. Each point's reach is
 * keyed on where it is, so neighbouring runs share their ends and the toe runs on unbroken.
 */
function heap(B: Build, wall: [number, number][], side: 1 | -1, w: number, lift: number, salt: number, out: Solid): void {
  const seed = B.set.seed;
  const [x0, y0] = wall[0];
  const [x1, y1] = wall[wall.length - 1];
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 0.5) return;
  const nx = ((y1 - y0) / len) * side;
  const ny = (-(x1 - x0) / len) * side;
  const g = (x: number, y: number, s: number) => {
    const [k0, k1] = B.key(x, y);
    return hash(k0, k1, seed, salt + s * 10);
  };
  const toe = wall.map(([x, y]) => {
    const r = w * (0.55 + 0.6 * g(x, y, 0));
    return [x + nx * r, y + ny * r, 0];
  });
  const up = wall.map(([x, y]) => lift * (0.6 + 0.6 * g(x, y, 1)));
  for (let k = 0; k + 1 < wall.length; k++) {
    const [ax, ay] = wall[k];
    const [bx, by] = wall[k + 1];
    out.faces.push([[...toe[k], ...toe[k + 1], bx, by, up[k + 1], ax, ay, up[k]]]);
    // A few stones on the slope, where they read.
    if (!shows(B.cam, LOD.stones, 0.5) || g(ax, ay, 2) < 0.5) continue;
    const u = 0.2 + 0.6 * g(ax, ay, 3);
    const v = 0.3 + 0.4 * g(ax, ay, 4);
    const x = ax + (bx - ax) * u + (toe[k][0] - ax) * v;
    const y = ay + (by - ay) * u + (toe[k][1] - ay) * v;
    const z = up[k] * (1 - v) * 0.9;
    out.lines.push({ pen: LINEWORK, pts: [x - 0.25, y, z, x, y + 0.1, z + 0.2, x + 0.25, y, z], facet: 'rubble' });
  }
  out.lines.push({ pen: LINEWORK, pts: toe.flat(), facet: 'rubble' });
}

/**
 * A concrete tower that has lost its walls: floor slabs on columns, the top floors gone as
 * it comes down. `storey` is the storey height; slabs closer than 2.5 mm on paper are left
 * out in step, every other one and so on. Columns stand at the corners and every 12 m or more.
 * `walls`, the share of its floors that keep their façade (`o`), stand solid below the frame.
 */
export function frame(B: Build, rings: WallRing[], H: number, storey: number, stand: number, out: Solid, z0 = 0, o?: Omit<PrismOptions, 'roof'>, walls = 0): void {
  const cam = B.cam;
  const top = z0 + (H - z0) * stand;
  const count = Math.max(1, Math.floor((top - z0) / storey + 1e-6));
  // The façade still stands on the lower floors, up to a floor line; the frame shows above it.
  const kept = Math.min(count, Math.floor((walls * (top - z0)) / storey));
  if (kept > 0 && o) prism(B, rings, z0, z0 + kept * storey, { ...o, roof: false }, out);
  const from = z0 + kept * storey;
  // Every nth slab, so they keep apart on paper.
  let step = 1;
  while (storey * step * cam.ca * cam.s < cam.gap(2.5) && step < 64) step *= 2;
  // A slab is too thin to show its edge on paper: its top face and one outline round it.
  // Once it has started to fall, the top floor has gone and columns stick up past the last slab.
  const last = stand < 1 ? count - 1 : count;
  for (let f = kept > 0 ? kept : step; f <= last; f += step) {
    const z = z0 + f * storey;
    const at = rings.map((r) => {
      const ring: number[] = [];
      for (let i = 0; i < r.pts.length; i += 2) ring.push(r.pts[i], r.pts[i + 1], z);
      return ring;
    });
    out.faces.push(at);
    for (const ring of at) out.lines.push({ pen: LINEWORK, pts: ring, closed: true });
  }
  // Columns: boxes where they read, else single strokes.
  const box = shows(cam, LOD.column, 0.5);
  const zTop = z0 + count * storey;
  for (const r of rings) {
    const p = r.pts;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      if (r.seam[i]) continue;
      const j = (i + 1) % n;
      const len = Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]);
      const m = Math.max(1, Math.round(len / Math.max(12, cam.gap(6) / cam.s)));
      for (let k = 0; k < m; k++) {
        // Just inside the slab edge.
        const u = k / m;
        const x = p[i * 2] + (p[j * 2] - p[i * 2]) * u;
        const y = p[i * 2 + 1] + (p[j * 2 + 1] - p[i * 2 + 1]) * u;
        const [k0, k1] = B.key(x, y);
        // A few columns have gone from the top floors already.
        const zc = Math.max(from + storey, zTop - storey * Math.floor(hash(k0, k1, B.set.seed, 9970) * 3 * (1 - stand)));
        if (zc <= from) continue;
        if (box) prism(B, [{ pts: [x - 0.25, y - 0.25, x + 0.25, y - 0.25, x + 0.25, y + 0.25, x - 0.25, y + 0.25], seam: new Uint8Array(4) }], from, zc, { roof: false, windows: false, pen: LINEWORK }, out);
        else out.lines.push({ pen: LINEWORK, pts: [x, y, from, x, y, zc] });
      }
    }
  }
  out.casts.push({ ring: rings[0].pts, h: zTop });
}

/** A roofless building's walls to `z1`: a whole shell while they all stand, ragged once they start to come down. */
export function ruin(B: Build, rings: WallRing[], z1: number, t: number, o: Omit<PrismOptions, 'roof'>, out: Solid, z0 = 0): boolean {
  const stand = B.fate?.stand ?? 1;
  // Its own thickness, then a hair thick (or none) where the footprint can't be inset that far.
  for (const thin of [false, true]) if (stand >= 1 ? shell(B, rings, z1, t, o, out, z0, thin) : ragged(B, rings, z1, t, stand, o, out, z0, thin)) return true;
  return false;
}

/** Whether a roofless house's gables still stand: each falls at its own point once the walls start to come down. */
export function gablesStand(B: Build): boolean {
  const f = B.fate;
  if (!f || f.stand >= 1) return true;
  return f.stand > 0.75 + 0.2 * hash(f.key[0], f.key[1], B.set.seed, 9972);
}
