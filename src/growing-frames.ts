import { type Build, type Solid } from './buildings';
import { CLIMATES } from './future';
import { LOD, shows, spaced } from './lod';
import { corridor, GroundIndex, overlaps } from './production';
import { deeper, GREENERY, LINEWORK, WATER, type Settings } from './settings';
import { corners, type Rect } from './shape';
import { storageVessel } from './shared-water';
import { panel } from './solar';
import type { Building, Town } from './tiles';

/** Rectangle along an outside wall, with its inner edge a small distance off the wall. */
function wallRect(b: Building, e: number, depth: number, gap = 0): Rect {
  const p = b.shape[0].pts, j = (e * 2 + 2) % p.length;
  const ax = p[e * 2], ay = p[e * 2 + 1], dx = p[j] - ax, dy = p[j + 1] - ay;
  const len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  return { cx: ax + dx / 2 + uy * (depth + gap) / 2, cy: ay + dy / 2 - ux * (depth + gap) / 2, ux, uy, L: Math.min(60, len - 1), w: depth - gap };
}

/** Reserve full growing galleries against uncropped context and existing additions before drawing. */
export function planGrowingFrames(town: Town, set: Settings): void {
  if (!set.solarpunk || !deeper(set, 'transform')) return;
  const ground = new GroundIndex();
  for (const b of town.buildings) {
    ground.add(b.shape[0].pts);
    const f = b.future;
    if (!f) continue;
    delete f.growingFrames;
    if (f.addition === 'frame' || f.addition === 'porch' || f.addition === 'canopy') for (const e of [f.side, f.side2]) {
      if (e !== undefined && e >= 0) ground.add(corners(wallRect(b, e, 3.2)), b);
    }
  }
  const context = town.productionContext;
  for (const s of context?.shapes ?? [...town.water, ...town.pools, ...town.wood, ...town.green, ...town.plazas, ...town.aprons, ...town.cover.map(a => a.shape)]) ground.add(s[0].pts);
  for (const w of [...town.nearby.ways, ...(context?.runways ?? town.runways)]) corridor(ground, w.pts, Math.max(1, w.width / 2) + 1);
  for (const w of context?.streams ?? town.streams) corridor(ground, w.pts, w.width / 2 + 2);
  const candidates: { b: Building; rects: Rect[]; guards: number[][] }[] = [];
  for (const b of town.buildings) {
    const f = b.future, info = b.info;
    if (!f || !info || f.recipe !== 'B04' || info.roof !== 'flat' || b.min !== 0 || b.h < 9 || b.h > 36 || b.shape.some(r => r.seam.some(Boolean))) continue;
    const sides: { r: Rect; guard: number[]; score: number }[] = [];
    for (let e = 0; e < b.shape[0].pts.length / 2; e++) {
      if (info.party[e] > 0) continue;
      const r = wallRect(b, e, 5), guard = corners(wallRect(b, e, 5.6, 0.15));
      if (r.L < 16 || !ground.clear(guard, b)) continue;
      const toward = info.toStreet ? Math.max(0, r.uy * info.toStreet[0] - r.ux * info.toStreet[1]) : 0;
      sides.push({ r, guard, score: r.L * (1 - 0.8 * toward) });
    }
    sides.sort((a, b) => b.score - a.score || a.r.cx - b.r.cx || a.r.cy - b.r.cy);
    const first = sides[0];
    if (!first) continue;
    const other = sides.find(s => s.r.ux * first.r.ux + s.r.uy * first.r.uy < -0.8);
    const chosen = other ? [first, other] : [first];
    candidates.push({ b, rects: chosen.map(s => s.r), guards: chosen.map(s => s.guard) });
  }
  // All conflicting proposals decline, so feature order never awards shared ground.
  const proposed = new GroundIndex();
  for (const c of candidates) for (const p of c.guards) proposed.add(p, c.b);
  for (const c of candidates) {
    if (c.guards.some(p => !proposed.clear(p, c.b)) || (c.guards.length > 1 && overlaps(c.guards[0], c.guards[1]))) continue;
    c.b.future!.growingFrames = c.rects;
    c.b.future!.addition = 'frame';
  }
}

/** Five-metre food-growing terraces, shared greenhouse bays, columns and a solar shade roof. */
export function growingFrame(B: Build, r: Rect, H: number, s: Solid): void {
  if (!shows(B.cam, LOD.growingFrame, r.w)) return;
  const P = (u: number, v: number, z: number) => [r.cx + r.ux * u - r.uy * v, r.cy + r.uy * u + r.ux * v, z];
  const quad = (a: number, b: number, z: number) => [P(a, 2.5, z), P(b, 2.5, z), P(b, -2.5, z), P(a, -2.5, z)];
  const floor = B.style.floor, step = floor * 2, levels: number[] = [];
  for (let z = floor; z + floor <= H + 0.1; z += step) levels.push(z);
  if (!levels.length) return;
  const top = H + 1.6;
  const bays = Math.max(2, Math.round(r.L / 7)), bw = r.L / bays, u = (i: number) => -r.L / 2 + i * bw;
  const glazed = !CLIMATES[B.future!.climate].gallery && !CLIMATES[B.future!.climate].dry;
  // Shared stores sit on the already reserved ground, below the first growing deck.
  const tankTop = Math.min(2.2, floor - 0.5);
  if (shows(B.cam, LOD.sharedCistern, 4)) {
    for (const t of [u(0.5), u(bays - 0.5)]) {
      const [x, y] = P(t, 0, 0);
      storageVessel(B, s, x, y, 2, 0, tankTop);
    }
    s.lines.push({ pen: WATER, pts: [...P(u(bays), -2.5, tankTop), ...P(u(bays - 0.5), -2.5, tankTop), ...P(u(bays - 0.5), 0, tankTop)] });
    s.lines.push({ pen: WATER, pts: [...P(u(0.5), -2, 0.5), ...P(u(0.5), -2.3, 0.5), ...P(u(bays - 0.5), -2.3, 0.5), ...P(u(bays - 0.5), -2, 0.5)] });
  }
  for (const z of levels) {
    const deck = quad(u(0), u(bays), z).flat();
    s.faces.push([deck]);
    const edge = shows(B.cam, LOD.terraceCrop, 2.5);
    if (edge) s.lines.push({ pen: LINEWORK, pts: deck, closed: true });
    else for (const t of [u(0), u(bays)]) s.lines.push({ pen: LINEWORK, pts: [...P(t, 2.5, z), ...P(t, -2.5, z)] });
    for (let i = 0; i < bays; i++) {
      const a = u(i), b = u(i + 1);
      if (glazed && i % 3 === 1) {
        const front = [...P(a, -2.5, z), ...P(b, -2.5, z), ...P(b, -2.5, z + floor), ...P(a, -2.5, z + floor)];
        s.faces.push([front], [quad(a, b, z + floor).flat()]);
        for (const t of [a, b]) s.faces.push([[...P(t, -2.5, z), ...P(t, 2.5, z), ...P(t, 2.5, z + floor), ...P(t, -2.5, z + floor)]]);
        // Continuous columns already draw the vertical edges; do not trace them twice.
        s.lines.push({ pen: LINEWORK, pts: [...P(a, -2.5, z + floor), ...P(b, -2.5, z + floor)] });
        if (!edge) s.lines.push({ pen: LINEWORK, pts: [...P(a, -2.5, z), ...P(b, -2.5, z)] });
        if (shows(B.cam, LOD.productionFrame, bw)) s.lines.push({ pen: LINEWORK, pts: [...P((a + b) / 2, -2.5, z), ...P((a + b) / 2, -2.5, z + floor)] });
      } else {
        s.lines.push({ pen: GREENERY, pts: [...P(a + 0.7, -1.6, z + 0.8), ...P(b - 0.7, -1.6, z + 0.8)] });
        if (shows(B.cam, LOD.terraceCrop, 2.5)) for (let t = a + 1.5; t < b - 1; t += spaced(B.cam, 2.5, 1.4)) s.lines.push({ pen: GREENERY, pts: [...P(t - 0.6, -1.6, z + 0.8), ...P(t, -1.6, z + 1.5), ...P(t + 0.6, -1.6, z + 0.8)] });
      }
    }
  }
  for (let i = 0; i <= bays; i++) s.lines.push({ pen: LINEWORK, pts: [...P(u(i), -2.5, 0), ...P(u(i), -2.5, top + 0.4)] });
  const roof = quad(u(0), u(bays), top).map(p => [p[0], p[1], p[2] + 0.4]);
  panel(B, s, roof, r.L);
  (s.shade ??= []).push([roof.flat()]);
  if (shows(B.cam, LOD.productionFrame, 5)) s.lines.push({ pen: WATER, pts: [...P(u(0), -2.5, top + 0.4), ...P(u(bays), -2.5, top + 0.4), ...P(u(bays), -2.5, 0.3)] });
}
