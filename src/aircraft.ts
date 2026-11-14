import { newSolid, type Build, type Solid } from './buildings';
import { pointInRing, ringArea } from './geo';
import { measure, at, place, rect, slab, onMask, type Extra } from './infra';
import type { Masks } from './nature';
import type { Paper, Test } from './raster';
import { hash } from './rng';
import { LINEWORK } from './settings';
import { bestRect } from './shape';
import type { Airport, Town } from './tiles';

/*
 * Aircraft: airliners at the big airports' stands, light aircraft parked on small airfields'
 * aprons, one aircraft lined up on each runway in view, rows of gliders beside gliding strips, and
 * helicopters on helipads. What sort of field it is comes from the nearest airfield label: its
 * class (international down to private) and whether its name says gliders or helicopters.
 */

/** Airfield classes whose aprons hold airliners rather than light aircraft. */
const BIG = new Set(['international', 'regional', 'military']);

type Local = number[][];

/** Shorthand for drawing in a frame along ux, uy: a forward, b to the left, z up, all times k. */
function frame(B: Build, s: Solid, x: number, y: number, ux: number, uy: number, k: number) {
  const P = (a: number, b: number, z: number) => [x + (ux * a - uy * b) * k, y + (uy * a + ux * b) * k, z * k];
  const S = (pts: Local) => place(x, y, ux, uy, pts.map(([a, b]) => [a * k, b * k]));
  return {
    P,
    /** A solid of footprint pts from z0 to z1. */
    body: (pts: Local, z0: number, z1: number) => {
      const ring = S(pts);
      slab(B, s, ring, z0 * k, z1 * k);
      return ring;
    },
    /** A thin flat or tilted plate: a wing, a tailplane, a fin. */
    plate: (pts: number[][]) => {
      const flat = pts.flatMap(([a, b, z]) => P(a, b, z));
      s.faces.push([flat]);
      s.lines.push({ pen: LINEWORK, pts: flat, closed: true });
    },
    line: (...pts: number[][]) => s.lines.push({ pen: LINEWORK, pts: pts.flatMap(([a, b, z]) => P(a, b, z)) }),
  };
}

/** An airliner: fuselage, swept wings, tailplane, fin and engines. */
export function airliner(B: Build, x: number, y: number, ux: number, uy: number, k: number): Solid {
  const s = newSolid();
  const F = frame(B, s, x, y, ux, uy, k);
  const body = F.body(
    [
      [-17, -1.8],
      [12, -1.8],
      [17, 0],
      [12, 1.8],
      [-17, 1.8],
    ],
    1.2,
    4.8,
  );
  for (const f of [1, -1]) {
    F.body(
      [
        [3, 1.8 * f],
        [-6, 17 * f],
        [-9, 17 * f],
        [-5, 1.8 * f],
      ],
      2.3,
      2.7,
    );
    F.body(
      [
        [-13, 1.8 * f],
        [-16, 6 * f],
        [-17.5, 6 * f],
        [-16.5, 1.8 * f],
      ],
      4.0,
      4.3,
    );
    F.body(rect(-3.5, 0.5, 5 * f - 0.8, 5 * f + 0.8), 1.0, 2.3);
  }
  F.plate([
    [-17, 0, 4.8],
    [-12, 0, 4.8],
    [-15.5, 0, 10],
    [-17.5, 0, 10],
  ]);
  s.casts.push({ ring: body, h: 4.8 * k });
  return s;
}

/** A light aircraft: a high- or low-winged single, or a twin with an engine on each wing. */
export function lightPlane(B: Build, x: number, y: number, ux: number, uy: number, v: number): Solid {
  const s = newSolid();
  const twin = v > 0.8;
  const high = !twin && v < 0.5;
  const F = frame(B, s, x, y, ux, uy, twin ? 1.2 : 1);
  const body = F.body(
    [
      [4.0, 0],
      [3.4, 0.55],
      [1.0, 0.6],
      [-1.5, 0.5],
      [-4.3, 0.15],
      [-4.3, -0.15],
      [-1.5, -0.5],
      [1.0, -0.6],
      [3.4, -0.55],
    ],
    0.7,
    1.75,
  );
  F.body(rect(-0.6, 1.5, -0.5, 0.5), 1.75, 2.0);
  const zw = high ? 2.0 : 0.8;
  const span = twin ? 6 : 5.5;
  F.plate([
    [1.7, -span, zw],
    [1.7, span, zw],
    [0.3, span, zw],
    [0.1, -span, zw],
  ]);
  if (high)
    for (const f of [1, -1]) {
      F.line([0.9, 0.6 * f, 0.9], [0.9, 2.8 * f, 2.0]);
      F.line([0.4, 0.6 * f, 0.7], [0.4, 1.3 * f, 0.05]);
    }
  else for (const f of [1, -1]) F.line([0.6, 1.6 * f, 0.8], [0.6, 1.6 * f, 0.05]);
  F.line([3.2, 0, 0.7], [3.2, 0, 0.05]);
  if (twin)
    for (const f of [1, -1]) {
      F.body(rect(-0.6, 2.6, 2.0 * f - 0.4, 2.0 * f + 0.4), 0.75, 1.4);
      F.line([2.65, 2.0 * f, 0.35], [2.65, 2.0 * f, 1.8]);
    }
  else F.line([4.05, 0.15, 0.35], [4.05, -0.15, 2.1]);
  F.plate([
    [-3.4, -1.7, 1.25],
    [-3.4, 1.7, 1.25],
    [-4.3, 1.5, 1.25],
    [-4.3, -1.5, 1.25],
  ]);
  F.plate([
    [-4.3, 0, 1.6],
    [-3.2, 0, 1.7],
    [-3.9, 0, 2.9],
    [-4.4, 0, 2.9],
  ]);
  s.casts.push({ ring: body, h: 1.75 });
  return s;
}

/** A glider resting on its wheel, one wingtip down on the grass. */
export function glider(B: Build, x: number, y: number, ux: number, uy: number, v: number): Solid {
  const s = newSolid();
  const F = frame(B, s, x, y, ux, uy, 1);
  const body = F.body(
    [
      [3.5, 0],
      [2.8, 0.35],
      [0.5, 0.4],
      [-1, 0.3],
      [-4.0, 0.1],
      [-4.0, -0.1],
      [-1, -0.3],
      [0.5, -0.4],
      [2.8, -0.35],
    ],
    0.15,
    0.95,
  );
  F.body(rect(0.6, 2.6, -0.3, 0.3), 0.95, 1.2);
  // The wing tilts so one tip rests on the ground.
  const down = v < 0.5 ? 1 : -1;
  const z = (b: number) => 0.9 - (b * down * 0.75) / 7.5;
  const span = 7.5 + v * 1.5;
  F.plate(
    [
      [0.3, -span],
      [0.8, -span],
      [1.4, 0],
      [0.8, span],
      [0.3, span],
      [0.0, 0],
    ].map(([a, b]) => [a, b, z(b * (7.5 / span))]),
  );
  F.plate([
    [-4.0, 0, 0.6],
    [-3.2, 0, 0.8],
    [-3.6, 0, 1.9],
    [-4.1, 0, 1.9],
  ]);
  F.plate([
    [-3.6, -1.5, 1.9],
    [-3.6, 1.5, 1.9],
    [-4.1, 1.4, 1.9],
    [-4.1, -1.4, 1.9],
  ]);
  s.casts.push({ ring: body, h: 0.95 });
  return s;
}

/** A helicopter on its skids, at height z (a rooftop pad, or 0). */
export function helicopter(B: Build, x: number, y: number, z: number, ux: number, uy: number, v: number): Solid {
  const s = newSolid();
  const k = 0.85 + v * 0.3;
  const F = frame(B, s, x, y, ux, uy, k);
  const lift = (pts: number[][]) => pts.map(([a, b, zz]) => [a, b, zz + z / k]);
  const zb = z / k;
  const cabin = F.body(
    [
      [2.8, 0],
      [2.2, 0.9],
      [-1.6, 1.1],
      [-2.4, 0.6],
      [-2.4, -0.6],
      [-1.6, -1.1],
      [2.2, -0.9],
    ],
    zb + 0.55,
    zb + 2.5,
  );
  F.body(rect(-1.6, 0.6, -0.6, 0.6), zb + 2.5, zb + 3.0);
  F.body(rect(-8.4, -2.4, -0.25, 0.25), zb + 1.8, zb + 2.3);
  F.plate(lift([
    [-8.4, 0, 2.0],
    [-7.6, 0, 2.0],
    [-8.0, 0, 3.5],
    [-8.6, 0, 3.5],
  ]));
  F.plate(lift([
    [-6.0, -1.1, 2.05],
    [-6.0, 1.1, 2.05],
    [-6.6, 1.1, 2.05],
    [-6.6, -1.1, 2.05],
  ]));
  // Skids, with struts up to the cabin.
  for (const f of [1, -1]) {
    F.line(...lift([[-2.2, 1.15 * f, 0.05], [2.2, 1.15 * f, 0.05], [2.7, 1.15 * f, 0.35]]));
    for (const a of [-1.2, 1.2]) F.line(...lift([[a, 1.15 * f, 0.05], [a, 0.8 * f, 0.6]]));
  }
  // Main rotor: two to four blades from the mast, at rest at an angle of their own.
  F.line(...lift([[-0.5, 0, 3.0], [-0.5, 0, 3.35]]));
  const blades = 2 + Math.floor(v * 3);
  const turn = v * 7.3;
  for (let i = 0; i < blades; i++) {
    const t = turn + (i / blades) * Math.PI * 2;
    F.line(...lift([[-0.5, 0, 3.35], [-0.5 + Math.cos(t) * 5.4, Math.sin(t) * 5.4, 3.3]]));
  }
  // Tail rotor on the left of the fin.
  for (const t of [0.6, 2.2]) F.line(...lift([[-8.2 + Math.cos(t) * 0.8, 0.35, 3.0 + Math.sin(t) * 0.8], [-8.2 - Math.cos(t) * 0.8, 0.35, 3.0 - Math.sin(t) * 0.8]]));
  s.casts.push({ ring: cabin, h: z + 2.5 * k });
  return s;
}

/** Join runway pieces that meet end to end. */
function joined(lines: number[][]): number[][] {
  const key = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  const left = lines.map((p) => [...p]);
  const out: number[][] = [];
  while (left.length) {
    let cur = left.pop()!;
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i];
        const [s0, s1] = [key(cur[0], cur[1]), key(cur[cur.length - 2], cur[cur.length - 1])];
        const [p0, p1] = [key(p[0], p[1]), key(p[p.length - 2], p[p.length - 1])];
        const rev = (q: number[]) => q.flatMap((_, j) => (j % 2 ? [] : [q[q.length - 2 - j], q[q.length - 1 - j]]));
        if (s1 === p0) cur = [...cur, ...p.slice(2)];
        else if (s1 === p1) cur = [...cur, ...rev(p).slice(2)];
        else if (s0 === p1) cur = [...p, ...cur.slice(2)];
        else if (s0 === p0) cur = [...rev(p), ...cur.slice(2)];
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}

/** The nearest airfield label within reach of a point. */
function nearest(airports: Airport[], x: number, y: number, reach = 4000): Airport | null {
  let best: Airport | null = null;
  let bd = reach;
  for (const a of airports) {
    const d = Math.hypot(a.x - x, a.y - y);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

/** Aircraft on aprons, runways and helipads, and the markings on ground helipads. */
export function aviation(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const { set, cam } = B;
  const solids: Solid[] = [];
  const marks: number[][] = [];
  const r = (x: number, y: number, salt: number) => {
    const [k0, k1] = B.key(x, y);
    return hash(k0, k1, set.seed, salt);
  };
  const onSheet = (x: number, y: number) => {
    const sx = cam.sx(x, y);
    const sy = cam.sy(x, y, 0);
    return sx > paper.x0 - 10 && sx < paper.x1 + 10 && sy > paper.y0 - 10 && sy < paper.y1 + 15;
  };
  const clear = (x: number, y: number) => onSheet(x, y) && !onMask(paper, M.foot, x, y) && !onMask(paper, M.water, x, y);
  const life = set.life && cam.s >= 0.12;

  const pads = town.helipads.map((h) => bestRect(h[0].pts).rect).filter((R) => !!R);
  const nearPad = (x: number, y: number) => pads.some((R) => Math.hypot(R!.cx - x, R!.cy - y) < 20);

  // Aprons: airliners at the stands of big airports, light aircraft in rows on small fields.
  for (const a of life ? town.aprons : []) {
    const outer = a[0].pts;
    const area = Math.abs(ringArea(outer));
    const { rect: R } = bestRect(outer);
    if (!R || area < 800) continue;
    const field = nearest(town.airports, R.cx, R.cy);
    const big = field ? BIG.has(field.cls) : area > 20000;
    const inside = (x: number, y: number) => pointInRing(x, y, outer) && a.slice(1).every((h) => !pointInRing(x, y, h.pts));
    // Big airports' smaller aprons are for general aviation: light aircraft, like a small field's.
    if (big && area >= 4000 && R.w >= 40) {
      const count = Math.min(4, Math.floor(R.L / 48));
      for (let k = 0; k < count; k++) {
        const t = (k - (count - 1) / 2) * 48;
        const x = R.cx + R.ux * t;
        const y = R.cy + R.uy * t;
        if (!inside(x, y) || !clear(x, y) || r(x, y, 420) > 0.75) continue;
        const f = r(x, y, 421) < 0.5 ? 1 : -1;
        solids.push(airliner(B, x, y, -R.uy * f, R.ux * f, 0.85 + 0.3 * r(x, y, 422)));
      }
      continue;
    }
    // Light aircraft parked in rows, noses all one way, with gaps where planes are out flying.
    const facing = r(R.cx, R.cy, 423) < 0.5 ? 1 : -1;
    let n = 0;
    // Noses point across the apron, so wings run along it: rows are a span and a bit apart.
    for (let b = -R.w / 2 + 7; b <= R.w / 2 - 7; b += 13)
      for (let t = -R.L / 2 + 9; t <= R.L / 2 - 9 && n < 30; t += 17) {
        const x = R.cx + R.ux * t - R.uy * b;
        const y = R.cy + R.uy * t + R.ux * b;
        if (!inside(x, y) || !clear(x, y) || nearPad(x, y) || r(x, y, 424) > 0.55) continue;
        const v = r(x, y, 425);
        const ux = -R.uy * facing;
        const uy = R.ux * facing;
        solids.push(field?.gliders && v < 0.5 ? glider(B, x, y, ux, uy, v * 2) : lightPlane(B, x, y, ux, uy, v));
        n++;
      }
  }

  // Runways: one aircraft lined up near an end, and gliders lined up beside gliding strips.
  if (life)
    for (const p of joined(town.runways.filter((w) => w.cls === 'runway').map((w) => w.pts))) {
      const cum = measure(p);
      const L = cum[cum.length - 1];
      if (L < 200) continue;
      const w = town.runways.find((q) => q.cls === 'runway' && q.pts[0] === p[0] && q.pts[1] === p[1])?.width ?? town.runways.find((q) => q.cls === 'runway')?.width ?? 30;
      const [mx, my] = at(p, cum, L / 2);
      const field = nearest(town.airports, mx, my);
      const gliders = !!field?.gliders;
      if (r(mx, my, 430) > 0.75) continue;
      // From whichever end is in view, rolling towards the other.
      const fromStart = r(mx, my, 431) < 0.5;
      for (const end of fromStart ? [0, 1] : [1, 0]) {
        const t = end === 0 ? 60 : L - 60;
        const [x, y, ux0, uy0] = at(p, cum, t);
        if (!clear(x, y)) continue;
        const ux = end === 0 ? ux0 : -ux0;
        const uy = end === 0 ? uy0 : -uy0;
        if (gliders) {
          // A glider on tow: the tug forty metres ahead, the rope between them.
          solids.push(glider(B, x, y, ux, uy, r(x, y, 432)));
          const tx = x + ux * 40;
          const ty = y + uy * 40;
          solids.push(lightPlane(B, tx, ty, ux, uy, 0.6));
          solids[solids.length - 1].lines.push({ pen: LINEWORK, pts: [x + ux * 3.5, y + uy * 3.5, 0.5, tx - ux * 4.3, ty - uy * 4.3, 0.9] });
        } else if (w >= 40 && L > 1500) solids.push(airliner(B, x, y, ux, uy, 0.85 + 0.3 * r(x, y, 433)));
        else solids.push(lightPlane(B, x, y, ux, uy, r(x, y, 434)));
        // A row of gliders waiting on the grass beside the strip.
        if (gliders) {
          const side = r(x, y, 435) < 0.5 ? 1 : -1;
          const count = 3 + Math.floor(r(x, y, 436) * 4);
          for (let i = 0; i < count; i++) {
            const [gx0, gy0] = at(p, cum, end === 0 ? t + 25 + i * 20 : t - 25 - i * 20);
            const gx = gx0 - uy0 * side * (w / 2 + 12);
            const gy = gy0 + ux0 * side * (w / 2 + 12);
            if (clear(gx, gy) && !onMask(paper, M.road, gx, gy)) solids.push(glider(B, gx, gy, ux, uy, r(gx, gy, 437)));
          }
        }
        break;
      }
    }

  // Ground helipads: a circle and an H, and often a helicopter standing on it.
  for (const h of town.helipads) {
    const outer = h[0].pts;
    const area = Math.abs(ringArea(outer));
    const { rect: R } = bestRect(outer);
    if (!R || area < 80 || area > 6000 || !onSheet(R.cx, R.cy)) continue;
    const rad = Math.min(R.w, R.L) / 2 - 1;
    if (rad < 4) continue;
    // Pads mapped on a building are on its roof.
    const roof = town.buildings.find((b) => pointInRing(R.cx, R.cy, b.shape[0].pts));
    const z = (roof ? roof.h * set.heightScale + 0.05 : 0);
    const ring: number[] = [];
    for (let q = 0; q <= 28; q++) ring.push(R.cx + Math.cos((q / 28) * Math.PI * 2) * rad, R.cy + Math.sin((q / 28) * Math.PI * 2) * rad, z);
    marks.push(ring);
    const P = (a: number, c: number) => [R.cx + R.ux * a - R.uy * c, R.cy + R.uy * a + R.ux * c, z];
    const e = rad * 0.45;
    marks.push([...P(-e, -e * 0.7), ...P(e, -e * 0.7)], [...P(-e, e * 0.7), ...P(e, e * 0.7)], [...P(0, -e * 0.7), ...P(0, e * 0.7)]);
    const field = nearest(town.airports, R.cx, R.cy, 600);
    if (life && r(R.cx, R.cy, 440) < (field?.heli ? 0.85 : 0.55)) {
      const t = r(R.cx, R.cy, 441) * Math.PI * 2;
      solids.push(helicopter(B, R.cx, R.cy, z, Math.cos(t), Math.sin(t), r(R.cx, R.cy, 442)));
    }
  }

  const test: Test = (x, y, d) => paper.seen(x, y, d);
  return { solids, draw: (p) => marks.forEach((m) => p.line3(LINEWORK, m, test)) };
}
