import { newSolid, tagLines, type Build, type Solid } from './buildings';
import { pointInRing, ringArea } from './geo';
import { LOD, shows } from './lod';
import { corridor, fits, GroundIndex, overlaps } from './production';
import { hash } from './rng';
import { deeper, LINEWORK, WATER } from './settings';
import { bestRect, corners, type Rect } from './shape';
import { energyCanopy, panel } from './solar';
import type { Town } from './tiles';

/** A public solar roof, its complete envelope and its individual column reservations. */
export type PublicRoof = { key: string; envelope: Rect; kind: 'tree' | 'arcade'; bays: number; posts: Rect[] };

/** Stable identity shared by a source square and its roof, independent of the sheet. */
export function squareKey(B: Build, r: Rect): string { return B.key(r.cx, r.cy).join(','); }

/** Plan complete roofs before trees and furniture, allowing paths under roofs but never through columns. */
export function planPublicEnergy(B: Build, town: Town): PublicRoof[] {
  if (!B.future || !deeper(B.set, 'transform')) return [];
  const context = town.publicContext;
  // Only explicitly identified pedestrian polygons qualify; generic plazas also contain airfields.
  const squares = context?.squares ?? town.publicSquares ?? [];
  const obstacles = new GroundIndex(), routes = new GroundIndex();
  for (const s of context?.obstacles ?? [...town.water, ...town.pools, ...town.wood, ...town.green, ...town.aprons, ...town.helipads]) obstacles.add(s[0].pts);
  for (const s of context?.buildings ?? town.buildings.map((b) => b.shape)) {
    obstacles.add(s[0].pts);
    corridor(obstacles, [...s[0].pts, ...s[0].pts.slice(0, 2)], 3.2);
  }
  for (const w of context?.ways ?? [...town.nearby.ways, ...town.runways]) {
    corridor(routes, w.pts, Math.max(1, w.width / 2) + 1);
    if (w.kind !== 'path' || w.bridge) corridor(obstacles, w.pts, Math.max(1, w.width / 2) + 2);
  }
  for (const s of context?.streams ?? town.streams) corridor(obstacles, s.pts, s.width / 2 + 2);
  const seen = new Set<string>(), proposals: PublicRoof[] = [];
  for (const square of squares) {
    const area = Math.abs(ringArea(square[0].pts)), { rect: r } = bestRect(square[0].pts);
    if (!r || area < 1200 || area > 40000) continue;
    // Canonical axes keep duplicate polygons with reversed rings from reversing the stepped bays.
    if (Math.abs(r.L - r.w) < 1e-7 && Math.abs(r.uy) > Math.abs(r.ux)) [r.ux, r.uy] = [-r.uy, r.ux];
    if (r.ux < -1e-8 || (Math.abs(r.ux) <= 1e-8 && r.uy < 0)) { r.ux = -r.ux; r.uy = -r.uy; }
    const key = squareKey(B, r), [k0, k1] = B.key(r.cx, r.cy);
    if (hash(k0, k1, B.set.seed, 12400) >= 0.8) continue;
    const rings = square.map((ring) => ring.pts.reduce<string[]>((a, _, i, p) => { if (!(i % 2)) a.push(B.key(p[i], p[i + 1]).join(',')); return a; }, []).sort().join(';'));
    const identity = [rings[0], ...rings.slice(1).sort()].join('|');
    if (seen.has(identity)) continue;
    seen.add(identity);
    const variants: { L: number; w: number; kind: PublicRoof['kind']; bays: number }[] = [];
    if (deeper(B.set, 'visionary')) {
      for (const length of [96, 64, 44, 40]) for (const width of [32, 24, 16]) {
        const L = Math.min(length, r.L - 8), w = Math.min(width, r.w - 8);
        if (L >= 40 && w >= 16 && !variants.some((v) => v.L === L && v.w === w)) variants.push({ L, w, kind: 'arcade', bays: Math.ceil(L / 22) });
      }
      variants.sort((a, b) => b.L * b.w - a.L * a.w);
    }
    for (const radius of [25, 20, 15, 10]) {
      const R = Math.min(radius, r.w * 0.4, r.L * 0.4);
      if (R >= 10 && !variants.some((v) => v.kind === 'tree' && v.w === R * 2)) variants.push({ L: R * 2, w: R * 2, kind: 'tree', bays: 1 });
    }
    // Pedestrian polygons often join a square to several narrow streets. Search the full
    // source geometry for an interior patch rather than treating its bounding centre as the square.
    const points: { x: number; y: number; d: number }[] = [{ x: r.cx, y: r.cy, d: 0 }];
    const step = Math.max(12, Math.sqrt(r.L * r.w / 512));
    for (let i = -Math.floor(r.L / (2 * step)); i <= Math.floor(r.L / (2 * step)); i++) {
      for (let j = -Math.floor(r.w / (2 * step)); j <= Math.floor(r.w / (2 * step)); j++) {
        if (!i && !j) continue;
        const u = i * step, v = j * step, x = r.cx + r.ux * u - r.uy * v, y = r.cy + r.uy * u + r.ux * v;
        if (pointInRing(x, y, square[0].pts)) points.push({ x, y, d: i * i + j * j });
      }
    }
    points.sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y);
    const viable = points.filter((p) => fits({ ...r, cx: p.x, cy: p.y, L: 22, w: 18 }, square));
    let chosen: PublicRoof | undefined;
    for (const v of variants) {
      for (const point of viable) {
        const e = { ...r, cx: point.x, cy: point.y, L: v.L, w: v.w }, R = e.w / 2, roof = corners(e), posts: Rect[] = [];
        if (!fits({ ...e, L: e.L + 2, w: e.w + 2 }, square) || !obstacles.clear(roof)) continue;
        const post = (u: number, v: number) => posts.push({ ...e, cx: e.cx + e.ux * u - e.uy * v, cy: e.cy + e.uy * u + e.ux * v, L: 1.8, w: 1.8 });
        if (v.kind === 'arcade') {
          for (let j = 0; j < v.bays; j++) for (const sign of [-1, 1]) post(-e.L / 2 + (j + 0.5) * e.L / v.bays, sign * e.w * 0.3);
        } else {
          post(0, 0);
          if (R >= 12) for (let j = 0; j < 6; j++) {
            // The round canopy's supports use world axes, matching energyCanopy().
            posts.push({ ...e, cx: e.cx + Math.cos(j * Math.PI / 3) * R * 0.38 * 0.7, cy: e.cy + Math.sin(j * Math.PI / 3) * R * 0.38 * 0.7, L: 1.8, w: 1.8 });
          }
        }
        if (posts.some((p) => !routes.clear(corners(p)))) continue;
        chosen = { key, envelope: e, kind: v.kind, bays: v.bays, posts };
        break;
      }
      if (chosen) break;
    }
    if (chosen) proposals.push(chosen);
  }
  // Overlapping squares both decline; traversal order must not award shared public ground.
  return proposals.filter((p, i) => !proposals.some((q, j) => i !== j && overlaps(corners(p.envelope), corners(q.envelope))));
}

/** Keep tree crowns outside the roof without closing the occupied ground beneath it. */
export function underPublicRoof(roofs: PublicRoof[], x: number, y: number, radius = 0): boolean {
  return roofs.some(({ envelope: r }) => Math.abs((x - r.cx) * r.ux + (y - r.cy) * r.uy) < r.L / 2 + radius && Math.abs(-(x - r.cx) * r.uy + (y - r.cy) * r.ux) < r.w / 2 + radius);
}

/** Public solar roofs: a branching tree or linked, stepped bays around a continuous skylight. */
export function publicEnergy(B: Build, roofs: PublicRoof[]): Solid[] {
  const out: Solid[] = [];
  for (const roof of roofs) {
    const r = roof.envelope;
    if (!shows(B.cam, LOD.publicRoof, Math.min(r.L, r.w))) continue;
    if (roof.kind === 'tree') { out.push(energyCanopy(B, r.cx, r.cy, r.w / 2)); continue; }
    const s = newSolid(), bay = r.L / roof.bays;
    const P = (u: number, v: number, z: number) => [r.cx + r.ux * u - r.uy * v, r.cy + r.uy * u + r.ux * v, z];
    tagLines(B, undefined, s, () => {
      for (let j = 0; j < roof.bays; j++) {
        const u = -r.L / 2 + (j + 0.5) * bay, a = u - bay / 2 + 0.45, b = u + bay / 2 - 0.45, lift = (j % 2) * 2.5;
        for (const sign of [-1, 1]) {
          const inner = sign * 1.8, outer = sign * r.w / 2, column = sign * r.w * 0.3;
          const face = [P(a, inner, 10 + lift), P(b, inner, 10 + lift), P(b, outer, 13 + lift), P(a, outer, 13 + lift)];
          panel(B, s, face, bay - 0.9);
          (s.shade ??= []).push([face.flat()]);
          s.lines.push({ pen: LINEWORK, pts: [...P(u, column, 0), ...P(u, column, 7.5)] });
          for (const end of [a + 1, b - 1]) for (const v of [inner, outer]) s.lines.push({ pen: LINEWORK, pts: [...P(u, column, 7.5), ...P(end, v, (v === inner ? 10 : 13) + lift)] });
          if (shows(B.cam, LOD.productionFrame, 2.5)) {
            s.lines.push({ pen: WATER, pts: [...P(a, inner, 10 + lift), ...P(b, inner, 10 + lift)] });
            s.lines.push({ pen: WATER, pts: [...P(u, inner, 10 + lift), ...P(u, column, 7), ...P(u, column, 0)] });
          }
        }
      }
      // Continuous beams join the stepping leaves and preserve an open central route.
      for (const sign of [-1, 1]) s.lines.push({ pen: LINEWORK, pts: [...P(-r.L / 2 + bay / 2, sign * r.w * 0.3, 7.5), ...P(r.L / 2 - bay / 2, sign * r.w * 0.3, 7.5)] });
      for (const p of roof.posts) s.casts.push({ ring: corners({ ...p, L: 0.6, w: 0.6 }), h: 7.5 });
    }, 'energy-arcade');
    out.push(s);
  }
  return out;
}
