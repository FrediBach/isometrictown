import { newSolid, type Build, type Solid } from './buildings';
import { pointInRing } from './geo';
import { boat, onMask, type Extra } from './infra';
import { LOD, shows } from './lod';
import type { Masks } from './nature';
import type { Paper, Test } from './raster';
import { hash } from './rng';
import { WATER } from './settings';
import type { Town } from './tiles';
import { local } from './vehicles';

/*
 * Ships under way, picked by the kind of water they are on. Out at sea: container ships,
 * tankers, bulk carriers, cruise ships, coasters, trawlers and tugs, more of the small ones
 * near a harbour. On big lakes, paddle steamers and motor boats. On rivers wide enough,
 * barges carrying hatch covers, containers or an empty hold; on narrow rivers and canals, tour
 * boats. Ships that are moving leave a wake, a V of broken strokes behind the stern.
 */

type Kind = 'container' | 'tanker' | 'bulk' | 'cruise' | 'coaster' | 'trawler' | 'tug' | 'steamer' | 'barge' | 'tour' | 'motor';

/** Length range (m) and beam as a share of length, per kind. */
const SIZE: Record<Kind, [number, number, number]> = {
  container: [150, 230, 1 / 6.8],
  tanker: [140, 220, 1 / 6],
  bulk: [130, 190, 1 / 6.3],
  cruise: [190, 250, 1 / 7.5],
  coaster: [75, 100, 1 / 6],
  trawler: [22, 34, 1 / 4],
  tug: [26, 32, 1 / 3],
  steamer: [45, 60, 1 / 6.5],
  barge: [85, 110, 0],
  tour: [18, 24, 1 / 4.8],
  motor: [7, 12, 0.33],
};

/** Grid (m) on which ships may be placed, fixed to the map, and a finer one for narrow rivers and canals. */
const STEP = 160;
const CANAL_STEP = 60;

/** Ships on open water, by water class, with wakes behind those under way. */
export function ships(B: Build, paper: Paper, town: Town, M: Masks, toAbs: (x: number, y: number) => [number, number], fromAbs: (X: number, Y: number) => [number, number]): Extra {
  const { cam, set } = B;
  const solids: Solid[] = [];
  const wakes: [number, number, number, number, number, number][] = [];
  if (!set.water || !set.life || !town.water.length || !shows(cam, LOD.sailingBoat)) return { solids, draw: () => {} };
  const water = (x: number, y: number) => onMask(paper, M.water, x, y) && !onMask(paper, M.pool, x, y) && !onMask(paper, M.road, x, y) && !onMask(paper, M.foot, x, y);
  /** How far open water runs from (x, y) in direction a, up to `max` metres. */
  const run = (x: number, y: number, a: number, max: number) => {
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const step = Math.max(2, max / 30);
    for (let d = step; d <= max; d += step) if (!water(x + ux * d, y + uy * d)) return d - step;
    return max;
  };
  const bodies = town.water.map((shape, i) => {
    const p = shape[0].pts;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = 0; k < p.length; k += 2) {
      x0 = Math.min(x0, p[k]);
      x1 = Math.max(x1, p[k]);
      y0 = Math.min(y0, p[k + 1]);
      y1 = Math.max(y1, p[k + 1]);
    }
    return { shape, cls: town.waterCls[i] ?? '', box: [x0, y0, x1, y1] };
  });
  const classAt = (x: number, y: number) => {
    for (const b of bodies) {
      const [x0, y0, x1, y1] = b.box;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      if (pointInRing(x, y, b.shape[0].pts) && b.shape.slice(1).every((r) => !pointInRing(x, y, r.pts))) return b.cls;
    }
    return '';
  };
  const harbours = town.pois.filter((p) => p.cls === 'harbor');

  // The grid is laid out in absolute map metres, so ships stay put when the view pans.
  const [rx0, ry0, rx1, ry1] = cam.region(0);
  const [A0x, A0y] = toAbs(rx0, ry0);
  const [A1x, A1y] = toAbs(rx1, ry1);
  const metre = toAbs(1, 0)[0] - toAbs(0, 0)[0];
  // A coarse pass for everything, then a fine one that only finds narrow rivers and canals.
  for (const [step, salt, chance, narrow] of [
    [STEP, 2400, 0.4, false],
    [CANAL_STEP, 2402, 0.25, true],
  ] as const)
    for (let i = Math.floor(A0x / (step * metre)); i <= Math.ceil(A1x / (step * metre)); i++)
      for (let j = Math.floor(A0y / (step * metre)); j <= Math.ceil(A1y / (step * metre)); j++) {
        const h = (k: number) => hash(i, j, set.seed, salt, k);
        if (h(0) > chance) continue;
        let [x, y] = fromAbs((i + 0.15 + 0.7 * h(1)) * step * metre, (j + 0.15 + 0.7 * h(2)) * step * metre);
        if (!water(x, y) || onMask(paper, M.calm, x, y)) continue;
        const cls = classAt(x, y);
        if (narrow ? cls !== 'river' && cls !== 'dock' : cls !== 'ocean' && cls !== 'lake' && cls !== 'river' && cls !== 'dock') continue;
        // The way the water runs longest through here, and how wide it is across that.
        let best = 0;
        let head = 0;
        for (let q = 0; q < 8; q++) {
          const a = (q / 8) * Math.PI;
          const r = run(x, y, a, 400) + run(x, y, a + Math.PI, 400);
          if (r > best) {
            best = r;
            head = a;
          }
        }
        let left = run(x, y, head + Math.PI / 2, 200);
        let right = run(x, y, head - Math.PI / 2, 200);
        // Measured again, finer, where it's narrow.
        if (left + right < 50) {
          left = run(x, y, head + Math.PI / 2, 50);
          right = run(x, y, head - Math.PI / 2, 50);
        }
        const across = left + right;
        if (narrow && across > 32) continue;
        const harbour = harbours.some((p) => Math.hypot(p.x - x, p.y - y) < 1500);
        const kind = pick(cls, best, across, harbour, h);
        if (!kind) continue;
        const [l0, l1, k] = SIZE[kind];
        const L = l0 + (l1 - l0) * h(5);
        const beam = kind === 'barge' ? (L > 100 ? 11.4 : 9.5) : L * k;
        if (best < L * 1.3 || across < beam * 2.5) continue;
        if (!shows(cam, LOD.ship, L, h(9))) continue;
        // Rivers' traffic keeps to the middle and runs along them; out on open water, any heading.
        const along = cls === 'river' || cls === 'dock' || across < L;
        if (along) {
          const o = (left - right) / 2;
          x += Math.cos(head + Math.PI / 2) * o;
          y += Math.sin(head + Math.PI / 2) * o;
        } else head = h(6) * Math.PI * 2;
        if (h(7) < 0.5) head += Math.PI;
        const ux = Math.cos(head);
        const uy = Math.sin(head);
        // The whole hull on water, with room round it.
        const m = Math.max(2, beam * 0.4);
        let fits = true;
        for (const a of [-0.5, -0.25, 0, 0.25, 0.5])
          for (const b of [-1, 0, 1]) {
            const bb = b * (beam / 2 + m);
            const px = x + ux * a * L - uy * bb;
            const py = y + uy * a * L + ux * bb;
            if (!water(px, py) || onMask(paper, M.calm, px, py)) fits = false;
          }
        if (!fits) continue;
        solids.push(ship(B, kind, x, y, ux, uy, L, beam, h));
        // Big ships out at sea are often lying at anchor; the rest are moving.
        const anchored = cls === 'ocean' && L > 120 && h(8) < 0.3;
        const trail = anchored ? 0 : Math.min(L * 1.4, 260);
        if (trail) wakes.push([x - ux * L * 0.5, y - uy * L * 0.5, ux, uy, trail, beam]);
        calm(paper, M, x, y, ux, uy, L, beam, trail);
      }
  return {
    solids,
    draw: (paper) => {
      for (const [x, y, ux, uy, len, beam] of wakes) wake(B, paper, M, x, y, ux, uy, len, beam);
    },
  };
}

/** What kind of ship suits this water: its class, how far it runs, how wide it is, whether a harbour is near. */
function pick(cls: string, run: number, across: number, harbour: boolean, h: (k: number) => number): Kind | null {
  const u = h(3);
  if (cls === 'ocean') {
    if (h(4) > (harbour ? 0.6 : 0.35)) return null;
    if (run > 450 && across > 150) {
      const big: [Kind, number][] = harbour
        ? [
            ['tug', 0.18],
            ['trawler', 0.22],
            ['coaster', 0.14],
            ['container', 0.16],
            ['tanker', 0.1],
            ['bulk', 0.1],
            ['cruise', 0.1],
          ]
        : [
            ['container', 0.24],
            ['tanker', 0.2],
            ['bulk', 0.18],
            ['trawler', 0.16],
            ['coaster', 0.1],
            ['cruise', 0.06],
            ['tug', 0.06],
          ];
      let acc = 0;
      for (const [k, w] of big) if (u < (acc += w)) return k;
      return 'trawler';
    }
    return run > 60 ? (u < 0.5 ? 'trawler' : 'motor') : null;
  }
  if (cls === 'lake') {
    if (h(4) > 0.4) return null;
    if (run > 300 && across > 120 && u < 0.35) return 'steamer';
    return run > 40 ? 'motor' : null;
  }
  // Rivers, canals and docks.
  if (across > 32 && run > 200) return u < 0.75 ? 'barge' : u < 0.9 ? 'tour' : 'motor';
  if (across > 10 && run > 60) return u < 0.6 ? 'tour' : 'motor';
  return null;
}

/** One ship, its middle at (x, y), heading along (ux, uy). */
function ship(B: Build, kind: Kind, x: number, y: number, ux: number, uy: number, L: number, beam: number, h: (k: number) => number): Solid {
  if (kind === 'motor') return boat(B, x, y, ux, uy, L, beam);
  const s = newSolid();
  const T = local(B, s, x, y, ux, uy);
  const hb = beam / 2;
  const pointed = (f: number) =>
    T.body(
      [
        [-L / 2, -hb * 0.92],
        [L * 0.28, -hb],
        [L * 0.42, -hb * 0.7],
        [L / 2, 0],
        [L * 0.42, hb * 0.7],
        [L * 0.28, hb],
        [-L / 2, hb * 0.92],
      ],
      0,
      f,
    );
  /** The superstructure aft: a block of decks, the bridge across the top, a funnel behind. */
  const house = (a0: number, a1: number, f: number, H: number) => {
    T.box(a0, a1, -hb * 0.45, hb * 0.45, f, f + H - 2.5);
    T.box(a0 + (a1 - a0) * 0.35, a1, -hb * 0.95, hb * 0.95, f + H - 2.5, f + H);
    T.box(a0 - L * 0.025, a0, -hb * 0.14, hb * 0.14, f, f + H + 3);
  };
  let hull: number[];
  let top: number;
  switch (kind) {
    case 'container': {
      const f = L * 0.06;
      hull = pointed(f);
      house(-L * 0.44, -L * 0.37, f, L * 0.12);
      // Bays of 40 ft boxes, each split in two stacks across, stacked to different heights.
      let a = -L * 0.34;
      for (let n = 0; a + 12.2 < L * 0.37; n++, a += 13) {
        for (const [b0, b1, salt] of [
          [-hb * 0.9, 0, 0],
          [0, hb * 0.9, 1],
        ] as const) {
          const tiers = 1 + Math.floor(h(20 + n * 2 + salt) * 5);
          T.box(a, a + 12.2, b0, b1, f, f + tiers * 2.6);
        }
      }
      top = f + L * 0.12;
      break;
    }
    case 'tanker': {
      const f = L * 0.05;
      hull = pointed(f);
      house(-L * 0.45, -L * 0.37, f, L * 0.1);
      T.line([-L * 0.35, 0, f + 1.2], [L * 0.42, 0, f + 1.2]);
      T.line([-L * 0.35, hb * 0.3, f + 0.8], [L * 0.42, hb * 0.3, f + 0.8]);
      // The manifold crane amidships.
      T.line([0, -hb * 0.4, f], [0, -hb * 0.4, f + 8], [L * 0.06, 0, f + 6]);
      T.box(L * 0.42, L * 0.48, -hb * 0.5, hb * 0.5, f, f + 2.5);
      top = f + L * 0.1;
      break;
    }
    case 'bulk':
    case 'coaster': {
      const f = L * 0.055;
      hull = pointed(f);
      house(-L * 0.45, -L * 0.37, f, L * (kind === 'bulk' ? 0.1 : 0.12));
      const n = kind === 'bulk' ? 5 + Math.floor(h(20) * 3) : 2;
      const a0 = -L * 0.33;
      const span = (L * 0.73) / n;
      for (let k = 0; k < n; k++) T.box(a0 + span * k + span * 0.12, a0 + span * (k + 1) - span * 0.12, -hb * 0.7, hb * 0.7, f, f + 1.8);
      // Deck cranes between the hatches, jibs stowed forward.
      const cranes = kind === 'bulk' ? 4 : 2;
      for (let k = 1; k <= cranes; k++) {
        const a = a0 + span * Math.min(n - 1, Math.round((k * n) / (cranes + 1)));
        T.box(a - 1, a + 1, -1, 1, f, f + 9);
        T.line([a, 0, f + 8], [a + Math.min(span * 1.6, 24), 0, f + 4]);
      }
      top = f + L * 0.1;
      break;
    }
    case 'cruise': {
      const f = L * 0.04;
      hull = pointed(f);
      // Tiers of decks, each drawn on its own so the decks show as bands.
      const tiers: [number, number, number, number][] = [
        [-0.44, 0.32, 0.47, 5],
        [-0.4, 0.24, 0.43, 4],
        [-0.3, 0.1, 0.34, 2],
      ];
      let z = f;
      for (const [a0, a1, b, decks] of tiers) for (let d = 0; d < decks; d++, z += 2.9) T.box(L * a0, L * a1, -hb * b * 2, hb * b * 2, z, z + 2.9);
      T.box(-L * 0.33, -L * 0.24, -hb * 0.2, hb * 0.2, z, z + 7);
      top = z + 7;
      break;
    }
    case 'trawler': {
      const f = 2.6;
      hull = pointed(f);
      T.box(L * 0.05, L * 0.3, -hb * 0.6, hb * 0.6, f, f + 3.2);
      // The gantry over the stern, and a mast with its outrigger booms swung out.
      T.line([-L / 2 + 1, -hb * 0.7, f], [-L / 2 + 1, -hb * 0.7, f + 6], [-L / 2 + 1, hb * 0.7, f + 6], [-L / 2 + 1, hb * 0.7, f]);
      T.line([L * 0.33, 0, f], [L * 0.33, 0, f + 9]);
      T.line([L * 0.33, 0, f + 2], [L * 0.2, -hb * 2.6, f + 6]);
      T.line([L * 0.33, 0, f + 2], [L * 0.2, hb * 2.6, f + 6]);
      top = f + 6;
      break;
    }
    case 'tug': {
      const f = 2.4;
      hull = pointed(f);
      T.box(-L * 0.08, L * 0.2, -hb * 0.65, hb * 0.65, f, f + 3);
      T.box(L * 0.02, L * 0.17, -hb * 0.5, hb * 0.5, f + 3, f + 5.5);
      T.box(-L * 0.18, -L * 0.1, -hb * 0.2, hb * 0.2, f, f + 6.5);
      top = f + 6;
      break;
    }
    case 'steamer': {
      const f = 1.8;
      hull = pointed(f);
      // Paddle boxes on both sides amidships.
      for (const b of [-1, 1]) T.box(-3.2, 3.2, b > 0 ? hb : -hb - 2.4, b > 0 ? hb + 2.4 : -hb, 0.4, 3.8);
      T.box(-L * 0.42, L * 0.3, -hb * 0.82, hb * 0.82, f, f + 2.8);
      T.box(-L * 0.3, L * 0.14, -hb * 0.65, hb * 0.65, f + 2.8, f + 5.2);
      T.box(-L * 0.06, L * 0.01, -0.8, 0.8, f + 5.2, f + 10);
      T.line([L * 0.38, 0, f], [L * 0.38, 0, f + 10]);
      top = f + 5.2;
      break;
    }
    case 'barge': {
      const f = 2.6;
      hull = T.body(
        [
          [-L / 2, -hb],
          [L / 2 - 2.5, -hb],
          [L / 2, -hb * 0.8],
          [L / 2, hb * 0.8],
          [L / 2 - 2.5, hb],
          [-L / 2, hb],
        ],
        0,
        f,
      );
      // Living quarters and the wheelhouse on top, at the stern.
      T.box(-L / 2 + 1, -L / 2 + 9, -hb * 0.85, hb * 0.85, f, f + 2.6);
      T.box(-L / 2 + 3.5, -L / 2 + 7.5, -hb * 0.55, hb * 0.55, f + 2.6, f + 5);
      const a0 = -L / 2 + 11;
      const a1 = L / 2 - 4;
      const cargo = h(20);
      if (cargo < 0.45) {
        T.box(a0, a1, -hb * 0.85, hb * 0.85, f, f + 1.4);
        for (let a = a0 + 10; a < a1 - 2; a += 10) T.line([a, -hb * 0.85, f + 1.4], [a, hb * 0.85, f + 1.4]);
      } else if (cargo < 0.75) {
        for (let a = a0, n = 0; a + 6 < a1; a += 6.3, n++) T.box(a, a + 6, -hb * 0.85, hb * 0.85, f, f + 2.6 * (1 + Math.floor(h(21 + n) * 3)));
      } else {
        // An empty hold: just its coaming, and the hold's floor showing inside.
        T.box(a0, a1, -hb * 0.85, hb * 0.85, f, f + 0.8);
      }
      top = f + 5;
      break;
    }
    case 'tour': {
      const f = 0.7;
      hull = T.body(
        [
          [-L / 2, -hb],
          [L * 0.36, -hb],
          [L / 2, -hb * 0.4],
          [L / 2, hb * 0.4],
          [L * 0.36, hb],
          [-L / 2, hb],
        ],
        0,
        f,
      );
      // The long glass cabin.
      T.box(-L * 0.42, L * 0.32, -hb * 0.85, hb * 0.85, f, f + 1.6);
      T.line([-L * 0.42, 0, f + 1.6], [L * 0.32, 0, f + 1.6]);
      top = f + 1.6;
      break;
    }
  }
  s.casts.push({ ring: hull, h: top });
  return s;
}

/**
 * Mark the water a ship takes up, with a little room round its hull, and the V of its wake
 * (`trail` metres long, 0 for none), so waves leave it clear and other boats keep off.
 */
export function calm(paper: Paper, M: Masks, x: number, y: number, ux: number, uy: number, L: number, beam: number, trail: number): void {
  const vx = -uy;
  const vy = ux;
  const pad = Math.max(2, beam * 0.3);
  const a = L / 2 + pad;
  const b = beam / 2 + pad;
  paper.fillMask(M.calm, [[x - ux * a - vx * b, y - uy * a - vy * b, x + ux * a - vx * b, y + uy * a - vy * b, x + ux * a + vx * b, y + uy * a + vy * b, x - ux * a + vx * b, y - uy * a + vy * b]]);
  if (!trail) return;
  // The V between the wake's arms, from the stern back: the same angle as the arms in wake().
  const sx = x - ux * L * 0.5;
  const sy = y - uy * L * 0.5;
  const back = Math.atan2(-uy, -ux);
  const ring = [sx - vx * beam * 0.45, sy - vy * beam * 0.45];
  for (const side of [-1, 1]) {
    const t = back - side * WAKE_ANGLE;
    const o = side * beam * 0.45;
    ring.push(sx + vx * o + Math.cos(t) * trail, sy + vy * o + Math.sin(t) * trail);
  }
  ring.push(sx + vx * beam * 0.45, sy + vy * beam * 0.45);
  paper.fillMask(M.calm, [ring]);
}

/** Half the angle a wake opens out at behind the stern (about 20°, as for any ship in deep water). */
const WAKE_ANGLE = 0.34;

/** A wake: two arms of broken strokes opening out from the stern at about 20°, and the churned water straight behind. */
export function wake(B: Build, paper: Paper, M: Masks, x: number, y: number, ux: number, uy: number, len: number, beam: number): void {
  if (!shows(B.cam, LOD.wake, len)) return;
  const test: Test = (sx, sy, d) => paper.on(M.water, sx, sy) && !paper.on(M.road, sx, sy) && !paper.on(M.pool, sx, sy) && paper.seen(sx, sy, d);
  const cam = B.cam;
  const [k0, k1] = B.key(x, y);
  const dash = Math.max(1.5, cam.tone(0.9) / cam.s);
  const gap = Math.max(1.5, cam.tone(1.1) / cam.s);
  const seg = (ax: number, ay: number, bx: number, by: number) => paper.line3(WATER, [ax, ay, 0, bx, by, 0], test);
  for (const side of [-1, 1]) {
    // Each arm starts at its own side of the stern and opens out to that side.
    const a = Math.atan2(-uy, -ux) - side * WAKE_ANGLE;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const ox = x - uy * side * beam * 0.45;
    const oy = y + ux * side * beam * 0.45;
    let n = 0;
    for (let t = 0; t < len; n++) {
      // Dashes shorten and gaps grow as the wake spreads and dies away.
      const fade = t / len;
      const d = dash * (1.6 - fade);
      if (fade < 0.1 || hash(k0, k1, B.set.seed, 2450, n * 2 + (side > 0 ? 1 : 0)) > 0.25 + 0.7 * fade) seg(ox + dx * t, oy + dy * t, ox + dx * (t + d), oy + dy * (t + d));
      t += d + gap * (1 + fade * 2);
    }
  }
  // Churned water straight behind, for a ship's length or so.
  const back = Math.min(len * 0.5, 80);
  for (let t = 0; t < back; t += dash + gap) {
    const o = (hash(k0, k1, B.set.seed, 2451, Math.round(t)) - 0.5) * beam * 0.4;
    seg(x - ux * t - uy * o, y - uy * t + ux * o, x - ux * (t + dash) - uy * o, y - uy * (t + dash) + ux * o);
  }
}
