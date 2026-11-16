import { newSolid, prism, type Build, type Solid } from './buildings';
import { motifBudget } from './future';
import { hash } from './rng';
import { BAY_D, BAY_W, bayUse, onMask, parkingBays, type Extra } from './infra';
import { LOD, shows } from './lod';
import type { Masks } from './nature';
import type { Paper } from './raster';
import { GREENERY, LINEWORK, WATER } from './settings';
import { groundSeg } from './streets';
import type { Town } from './tiles';
import type { KerbSlot } from './traffic';
import type { Tree } from './nature';
import { bicycle } from './vehicles';

/*
 * Solarpunk things on the ground beside buildings and along streets
 * (docs/solarpunk/implementation-plan.md §7.3).
 */

const NONE: Extra = { solids: [], draw: () => {} };

/**
 * Rain tanks: a drum at a back corner of the house, away from the street, with a downpipe
 * from the eaves into it. Only for houses that were built (the plan records their eaves) and
 * that show their supporting change at this scale.
 */
export function rainTanks(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  if (!B.future) return NONE;
  const solids: Solid[] = [];
  for (const b of town.buildings) {
    const f = b.future;
    const i = b.info;
    if (!f?.tank || f.eave === undefined || !i) continue;
    if (motifBudget(B, b) < 2) continue;
    const p = b.shape[0].pts;
    const n = p.length / 2;
    let cx = 0;
    let cy = 0;
    for (let q = 0; q < n; q++) {
      cx += p[q * 2];
      cy += p[q * 2 + 1];
    }
    cx /= n;
    cy /= n;
    const [tx, ty] = i.toStreet ?? [0, 0];
    // The corner furthest from the street, ties broken by position.
    let best = -1;
    let far = -Infinity;
    for (let q = 0; q < n; q++) {
      if (b.shape[0].seam[q] || b.shape[0].seam[(q - 1 + n) % n]) continue;
      const [k0, k1] = B.key(p[q * 2], p[q * 2 + 1]);
      const d = -((p[q * 2] - cx) * tx + (p[q * 2 + 1] - cy) * ty) + hash(k0, k1, B.set.seed, 12050) * 0.5;
      if (d > far) {
        far = d;
        best = q;
      }
    }
    if (best < 0) continue;
    const vx = p[best * 2];
    const vy = p[best * 2 + 1];
    let ox = vx - cx;
    let oy = vy - cy;
    const ol = Math.hypot(ox, oy) || 1;
    ox /= ol;
    oy /= ol;
    const R = 0.55;
    const x = vx + ox * (R + 0.3);
    const y = vy + oy * (R + 0.3);
    const [k0, k1] = B.key(x, y);
    if (!shows(B.cam, LOD.rainTank, R * 2, hash(k0, k1, B.set.seed, 9200))) continue;
    const clear = (qx: number, qy: number) => !onMask(paper, M.road, qx, qy) && !onMask(paper, M.water, qx, qy) && !onMask(paper, M.foot, qx, qy);
    if (![[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]].every(([dx, dy]) => clear(x + dx, y + dy))) continue;
    const s = newSolid();
    const ring: number[] = [];
    for (let q = 0; q < 12; q++) ring.push(x + Math.cos((q / 12) * Math.PI * 2) * R, y + Math.sin((q / 12) * Math.PI * 2) * R);
    const top = 1.5;
    prism(B, [{ pts: ring, seam: new Uint8Array(12) }], 0, top, { roof: true, windows: false, pen: LINEWORK }, s);
    s.casts.push({ ring, h: top });
    // The downpipe runs down the corner of the house and bends over into the tank.
    const px = vx + ox * 0.12;
    const py = vy + oy * 0.12;
    const zEave = Math.max(top + 0.6, f.eave - 0.15);
    s.lines.push({ pen: WATER, pts: [px, py, zEave, px, py, top + 0.35, x, y, top + 0.35, x, y, top] });
    solids.push(s);
  }
  return { solids, draw: () => {} };
}

/** Trees in pits along the freed kerb stretches planted with trees: one every other car's length. */
export function kerbTrees(B: Build, slots: KerbSlot[]): Tree[] {
  const out: Tree[] = [];
  if (!B.future || B.set.trees <= 0) return out;
  let n = 0;
  for (const k of slots) {
    if (k.first) n = 0;
    if (!k.tree || n++ % 2) continue;
    const [k0, k1] = B.key(k.x, k.y);
    const r = 1.8 + hash(k0, k1, B.set.seed, 12112) * 0.6;
    // Some newly planted, most grown: a future built up over decades.
    const young = hash(k0, k1, B.set.seed, 12113) < 0.25;
    out.push({ x: k.x + k.nx * 0.1, y: k.y + k.ny * 0.1, r: young ? r * 0.7 : r, h: (young ? 4.2 : 6) + hash(k0, k1, B.set.seed, 12114) * 1.5, conifer: false, from: 'kerb-trees' });
  }
  return out;
}

/** Tuft symbol in sheet mm, as ground.ts draws it. */
const TUFT = [
  [-0.45, -0.42],
  [-0.22, 0],
  [0, -0.55],
  [0.22, 0],
  [0.45, -0.42],
];

/**
 * The ground marks of freed kerb stretches: square pits round the trees, and rain gardens, a
 * lowered bed in the old parking lane with a new kerb towards the road, a gap in it where the
 * gutter runs in, a dashed contour for the dip and a few low plants.
 */
export function kerbGardens(B: Build, paper: Paper, slots: KerbSlot[]): Extra {
  if (!B.future || !slots.length) return NONE;
  const { cam } = B;
  return {
    solids: [],
    draw: () => {
      if (!shows(cam, LOD.kerbGarden, 2)) return;
      const test = (x: number, y: number, d: number) => paper.seen(x, y, d);
      let n = 0;
      for (const k of slots) {
        if (k.first) n = 0;
        const i = n++;
        const P = (u: number, d: number): [number, number] => [k.x + k.ux * u + k.nx * d, k.y + k.uy * u + k.ny * d];
        const seg = (a: [number, number], b: [number, number], pen = LINEWORK) => {
          groundSeg(paper, pen, a[0], a[1], b[0], b[1], test);
          paper.end();
        };
        if (k.tree) {
          if (i % 2 || B.set.trees <= 0) continue;
          const c = [P(-0.7, -0.6), P(0.7, -0.6), P(0.7, 0.8), P(-0.7, 0.8)];
          for (let q = 0; q < 4; q++) seg(c[q], c[(q + 1) % 4]);
          continue;
        }
        // The new kerb: towards the road, with the inlet left open, and across both ends.
        const lo = -0.95;
        const hi = 1.05;
        seg(P(-2.8, lo), P(-2.2, lo));
        seg(P(-1.4, lo), P(2.8, lo));
        seg(P(-2.8, lo), P(-2.8, hi));
        seg(P(2.8, lo), P(2.8, hi));
        // The water's way in, a short tick through the gap.
        seg(P(-1.8, lo - 0.5), P(-1.8, lo + 0.35), WATER);
        // The dip, dashed at a spacing that reads on paper.
        const dash = cam.tone(1.1) / cam.s;
        const gap = cam.tone(0.8) / cam.s;
        const ring = [P(-2.35, -0.55), P(2.35, -0.55), P(2.35, 0.65), P(-2.35, 0.65)];
        for (let q = 0; q < 4; q++) {
          const [ax, ay] = ring[q];
          const [bx, by] = ring[(q + 1) % 4];
          const len = Math.hypot(bx - ax, by - ay);
          for (let t = 0; t < len; t += dash + gap) {
            const t1 = Math.min(len, t + dash);
            seg([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len], [ax + ((bx - ax) * t1) / len, ay + ((by - ay) * t1) / len], GREENERY);
          }
        }
        const kk = Math.max(1, cam.nib / 0.35);
        for (const u of [-1.1, 1.1]) {
          const [x, y] = P(u, 0.05);
          const sx = cam.sx(x, y);
          const sy = cam.sy(x, y, 0);
          paper.sheet(GREENERY, TUFT.flatMap(([dx, dy]) => [sx + dx * kk, sy + dy * kk, cam.depth(x, y, 0)]), test);
          paper.end();
        }
      }
    },
  };
}

/**
 * Solarpunk car park bays that no longer hold a car: cycle racks with a few bicycles parked,
 * and planted beds with a low kerb round them.
 */
export function lotCommons(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  if (!B.future) return NONE;
  const { cam } = B;
  const solids: Solid[] = [];
  const beds: number[][] = [];
  for (const b of parkingBays(B, paper, town.ways, M)) {
    const use = bayUse(B, b);
    const P = (u: number, d: number): [number, number] => [b.x + b.ux * u + b.nx * (b.v0 + d), b.y + b.uy * u + b.ny * (b.v0 + d)];
    if (use === 'bed') {
      const c = [P(0.35, 0.5), P(BAY_W - 0.35, 0.5), P(BAY_W - 0.35, BAY_D - 0.4), P(0.35, BAY_D - 0.4)];
      beds.push(c.flat());
    } else if (use === 'rack') {
      // A rack across the back of the bay, with bicycles parked nose in.
      const s = newSolid();
      const [ax, ay] = P(0.3, BAY_D - 0.9);
      const [bx, by] = P(BAY_W - 0.3, BAY_D - 0.9);
      s.lines.push({ pen: LINEWORK, pts: [ax, ay, 0.8, bx, by, 0.8] });
      if (shows(cam, LOD.rackBikes, 0.75)) {
        for (const u of [0.55, 1.3, 2.05]) {
          const [x, y] = P(u, BAY_D - 1.6);
          const [k0, k1] = B.key(x, y);
          if (hash(k0, k1, B.set.seed, 12124) < 0.3) continue;
          const bike = bicycle(B, x, y, b.nx, b.ny, false, false);
          s.faces.push(...bike.faces);
          s.lines.push(...bike.lines);
        }
      }
      solids.push(s);
    }
  }
  return {
    solids,
    draw: () => {
      if (!beds.length || !shows(cam, LOD.kerbGarden, 2)) return;
      const test = (x: number, y: number, d: number) => paper.seen(x, y, d);
      const kk = Math.max(1, cam.nib / 0.35);
      for (const c of beds) {
        for (let q = 0; q < 4; q++) {
          groundSeg(paper, GREENERY, c[q * 2], c[q * 2 + 1], c[((q + 1) % 4) * 2], c[((q + 1) % 4) * 2 + 1], test);
          paper.end();
        }
        const x = (c[0] + c[4]) / 2;
        const y = (c[1] + c[5]) / 2;
        const sx = cam.sx(x, y);
        const sy = cam.sy(x, y, 0);
        paper.sheet(GREENERY, TUFT.flatMap(([dx, dy]) => [sx + dx * kk, sy + dy * kk, cam.depth(x, y, 0)]), test);
        paper.end();
      }
    },
  };
}

/** Places people cycle to: railway stations, schools and colleges. */
const CYCLED_TO = new Set(['railway', 'school', 'college']);

/**
 * Cycle racks near stations and schools in solarpunk mode: a rail on the nearest clear ground,
 * with bicycles parked along it.
 */
export function cycleRacks(B: Build, paper: Paper, town: Town, M: Masks): Extra {
  const { cam, set } = B;
  if (!B.future || !shows(cam, LOD.cycle, 1.8)) return NONE;
  const solids: Solid[] = [];
  const placed: [number, number][] = [];
  const clear = (x: number, y: number) => !onMask(paper, M.road, x, y) && !onMask(paper, M.foot, x, y) && !onMask(paper, M.water, x, y);
  for (const p of town.pois) {
    if (!CYCLED_TO.has(p.cls) || placed.some(([x, y]) => Math.hypot(x - p.x, y - p.y) < 60)) continue;
    const [k0, k1] = B.key(p.x, p.y);
    const h = (salt: number) => hash(k0, k1, set.seed, 12130 + salt);
    let spot: [number, number, number, number] | null = null;
    search: for (let r = 6; r <= 34; r += 4)
      for (let q = 0; q < 12; q++) {
        const a = ((q + h(0)) / 12) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const y = p.y + Math.sin(a) * r;
        // The rack runs across the way to the door, so the bicycles point at it.
        const ux = -Math.sin(a);
        const uy = Math.cos(a);
        if (![-3, 0, 3].every((t) => [-1.1, 1.1].every((e) => clear(x + ux * t - uy * e, y + uy * t + ux * e)))) continue;
        spot = [x, y, ux, uy];
        break search;
      }
    if (!spot) continue;
    const [x, y, ux, uy] = spot;
    placed.push([p.x, p.y]);
    const s = newSolid();
    s.lines.push({ pen: LINEWORK, pts: [x - ux * 3, y - uy * 3, 0.8, x + ux * 3, y + uy * 3, 0.8] });
    for (const t of [-3, 3]) s.lines.push({ pen: LINEWORK, pts: [x + ux * t, y + uy * t, 0, x + ux * t, y + uy * t, 0.8] });
    for (let i = 0; i < 8 && shows(cam, LOD.rackBikes, 0.75); i++) {
      if (h(1 + i) < 0.3) continue;
      const t = -2.6 + i * 0.75;
      const bike = bicycle(B, x + ux * t, y + uy * t, -uy, ux, false, false);
      s.faces.push(...bike.faces);
      s.lines.push(...bike.lines);
    }
    solids.push(s);
  }
  return { solids, draw: () => {} };
}
