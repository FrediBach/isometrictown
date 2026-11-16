import { newSolid, prism, type Build, type Solid } from './buildings';
import { ringArea } from './geo';
import { LOD, shows, spaced } from './lod';
import { corridor, fits, GroundIndex, overlaps } from './production';
import { squareKey } from './public-energy';
import { deeper, GREENERY, LINEWORK, WATER } from './settings';
import { bestRect, corners, type Rect } from './shape';
import { panel } from './solar';
import type { Town } from './tiles';

/** A shared rainwater court with a complete maintenance envelope on a mapped square or campus. */
export type WaterCourt = { key: string; envelope: Rect; tower: boolean };

/** Fit storage on public ground, keeping routes, buildings and earlier structures clear. */
export function planSharedWater(B: Build, town: Town, reserved: readonly { envelope: Rect }[] = []): WaterCourt[] {
  if (!B.future || !B.set.ground || !deeper(B.set, 'transform')) return [];
  const context = town.publicContext;
  const squares = [...(context?.squares ?? town.publicSquares ?? []).map(shape => ({ shape, campus: false })), ...(context?.waterSites ?? []).map(shape => ({ shape, campus: true }))];
  const ground = new GroundIndex();
  for (const s of context?.obstacles ?? [...town.water, ...town.pools, ...town.wood, ...town.green, ...town.aprons, ...town.helipads]) ground.add(s[0].pts);
  for (const s of context?.buildings ?? town.buildings.map(b => b.shape)) {
    ground.add(s[0].pts);
    // Leave room for existing entrances and the full depth of productive apartment galleries.
    corridor(ground, [...s[0].pts, ...s[0].pts.slice(0, 2)], 5.8);
  }
  for (const w of context?.ways ?? [...town.nearby.ways, ...town.runways]) corridor(ground, w.pts, Math.max(1, w.width / 2) + 1.5);
  for (const w of context?.streams ?? town.streams) corridor(ground, w.pts, w.width / 2 + 2);
  for (const s of context?.waterObstacles ?? []) ground.add(s[0].pts);
  for (const r of reserved) ground.add(corners(r.envelope));
  const seen = new Set<string>(), proposals: WaterCourt[] = [];
  for (const source of squares) {
    const square = source.shape;
    const area = Math.abs(ringArea(square[0].pts)), { rect: r } = bestRect(square[0].pts);
    if (!r || area < 600 || area > (source.campus ? 250000 : 40000) || r.L < 20 || r.w < 18) continue;
    if (Math.abs(r.L - r.w) < 1e-7 && Math.abs(r.uy) > Math.abs(r.ux)) [r.ux, r.uy] = [-r.uy, r.ux];
    if (r.ux < -1e-8 || (Math.abs(r.ux) <= 1e-8 && r.uy < 0)) { r.ux = -r.ux; r.uy = -r.uy; }
    const rings = square.map(ring => ring.pts.reduce<string[]>((a, _, i, p) => { if (!(i % 2)) a.push(B.key(p[i], p[i + 1]).join(',')); return a; }, []).sort().join(';'));
    const identity = [rings[0], ...rings.slice(1).sort()].join('|');
    if (seen.has(identity)) continue;
    seen.add(identity);
    const points: { x: number; y: number; d: number }[] = [];
    const step = Math.max(12, Math.sqrt(r.L * r.w / 256));
    for (let i = -Math.floor(r.L / (2 * step)); i <= Math.floor(r.L / (2 * step)); i++) for (let j = -Math.floor(r.w / (2 * step)); j <= Math.floor(r.w / (2 * step)); j++) {
      points.push({ x: r.cx + r.ux * i * step - r.uy * j * step, y: r.cy + r.uy * i * step + r.ux * j * step, d: i * i + j * j });
    }
    points.sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y);
    for (const p of points) {
      const envelope = { ...r, cx: p.x, cy: p.y, L: 18, w: 16 };
      const guard = { ...envelope, L: 20, w: 18 };
      if (!fits(guard, square) || !ground.clear(corners(guard))) continue;
      proposals.push({ key: squareKey(B, r), envelope, tower: deeper(B.set, 'visionary') });
      break;
    }
  }
  return proposals.filter((p, i) => !proposals.some((q, j) => i !== j && overlaps(corners({ ...p.envelope, L: 20, w: 18 }), corners({ ...q.envelope, L: 20, w: 18 }))));
}

/** A closed cylindrical vessel, with sparse technical detail and a clear storage silhouette. */
export function storageVessel(B: Build, s: Solid, x: number, y: number, radius: number, lo: number, hi: number): void {
  const ring = (z: number) => Array.from({ length: 24 }, (_, i) => {
    const a = i * Math.PI / 12;
    return [x + Math.cos(a) * radius, y + Math.sin(a) * radius, z];
  }).flat();
  const bottom = ring(lo), top = ring(hi), first = s.faces.length;
  s.faces.push([top]);
  for (let i = 0; i < 24; i++) {
    const a = i * 3, b = ((i + 1) % 24) * 3;
    s.faces.push([[...bottom.slice(a, a + 3), ...bottom.slice(b, b + 3), ...top.slice(b, b + 3), ...top.slice(a, a + 3)]]);
  }
  s.lines.push({ pen: WATER, pts: bottom, closed: true }, { pen: WATER, pts: top, closed: true });
  for (const sign of [-1, 1]) {
    const dx = B.cam.cb * radius * sign, dy = -B.cam.sb * radius * sign;
    s.lines.push({ pen: LINEWORK, pts: [x + dx, y + dy, lo, x + dx, y + dy, hi] });
  }
  if (shows(B.cam, LOD.waterService, radius)) {
    const [ux, uy] = B.cam.up;
    s.lines.push({ pen: WATER, pts: [x - ux * radius, y - uy * radius, lo + 0.7, x - ux * radius, y - uy * radius, hi - 0.7] });
  }
  // An elevated tank casts its own faces, leaving the air below the vessel open.
  if (lo > 1) (s.shade ??= []).push(...s.faces.slice(first));
  else s.casts.push({ ring: bottom.filter((_, i) => i % 3 !== 2), h: hi });
}

/** Shared cistern pairs or a supported water tower, collectors, irrigation pipes and planted beds. */
export function sharedWater(B: Build, courts: WaterCourt[]): Solid[] {
  const out: Solid[] = [];
  for (const court of courts) {
    if (!shows(B.cam, LOD.sharedWater, 8)) continue;
    const r = court.envelope, s = newSolid();
    const P = (u: number, v: number, z: number) => [r.cx + r.ux * u - r.uy * v, r.cy + r.uy * u + r.ux * v, z];
    const post = (u: number, v: number, h: number) => {
      const [x, y] = P(u, v, 0);
      const ring = corners({ ...r, cx: x, cy: y, L: 0.8, w: 0.8 });
      prism(B, [{ pts: ring, seam: new Uint8Array(4) }], 0, h, { roof: false, windows: false, pen: LINEWORK }, s);
      s.casts.push({ ring, h });
    };
    if (court.tower) {
      for (const u of [-4.8, 4.8]) for (const v of [-4.8, 4.8]) post(u, v, 12);
      const deck = [-1, 1].flatMap((v, i) => [P(i ? 5.4 : -5.4, v * 5.4, 12), P(i ? -5.4 : 5.4, v * 5.4, 12)]).flat();
      s.faces.push([deck]); (s.shade ??= []).push([deck]); s.lines.push({ pen: LINEWORK, pts: deck, closed: true });
      storageVessel(B, s, r.cx, r.cy, 4, 12, 18);
      // A broad funnel collects rain; two opposing facets generate power for the service equipment.
      const at = (a: number, rad: number, z: number) => P(Math.cos(a) * rad, Math.sin(a) * rad, z);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, b = (i + 1) * Math.PI / 4;
        const quad = [at(a, 6.5, 22), at(b, 6.5, 22), at(b, 1, 20.8), at(a, 1, 20.8)];
        if (i === 1 || i === 5) panel(B, s, quad, 5.5);
        else { s.faces.push([quad.flat()]); s.lines.push({ pen: LINEWORK, pts: [...quad[0], ...quad[1]] }); }
        (s.shade ??= []).push([quad.flat()]);
      }
      for (const u of [-1, 1]) s.lines.push({ pen: LINEWORK, pts: [...P(u, 0, 18), ...P(u, 0, 20.8)] });
      s.lines.push({ pen: WATER, pts: [...P(0, -4, 14), ...P(0, -5.8, 14), ...P(0, -5.8, 0.7), ...P(0, -6.5, 0.7)] });
      if (shows(B.cam, LOD.waterService, 6)) for (const v of [-4.8, 4.8]) {
        s.lines.push({ pen: LINEWORK, pts: [...P(-4.8, v, 0), ...P(4.8, v, 10)] }, { pen: LINEWORK, pts: [...P(4.8, v, 0), ...P(-4.8, v, 10)] });
      }
    } else {
      for (const u of [-3.5, 3.5]) {
        const [x, y] = P(u, 0, 0);
        prism(B, [{ pts: corners({ ...r, cx: x, cy: y, L: 5.6, w: 5.6 }), seam: new Uint8Array(4) }], 0, 0.4, { roof: true, windows: false, pen: LINEWORK }, s);
        storageVessel(B, s, x, y, 2.5, 0.4, 5);
      }
      for (const u of [-6.5, 6.5]) for (const v of [-4.5, 4.5]) post(u, v, 8.8);
      for (const sign of [-1, 1]) {
        const quad = [P(-7, 0, 7), P(7, 0, 7), P(7, sign * 5, 9), P(-7, sign * 5, 9)];
        if (sign === -1) panel(B, s, quad, 14);
        else { s.faces.push([quad.flat()]); s.lines.push({ pen: LINEWORK, pts: [...quad[1], ...quad[2], ...quad[3], ...quad[0]] }); }
        (s.shade ??= []).push([quad.flat()]);
      }
      s.lines.push({ pen: WATER, pts: [...P(0, 0, 7), ...P(0, 0, 5.3), ...P(-3.5, 0, 5.3), ...P(-3.5, 0, 5)] }, { pen: WATER, pts: [...P(0, 0, 5.3), ...P(3.5, 0, 5.3), ...P(3.5, 0, 5)] });
      s.lines.push({ pen: WATER, pts: [...P(3.5, -2.5, 1), ...P(3.5, -6.5, 1), ...P(0, -6.5, 1)] });
    }
    for (const v of [-6.5, 6.5]) {
      s.lines.push({ pen: GREENERY, pts: [...P(-6, v, 0.7), ...P(6, v, 0.7)] });
      if (shows(B.cam, LOD.terraceCrop, 2.5)) for (let u = -5; u <= 5; u += spaced(B.cam, 2.5, 1.4)) s.lines.push({ pen: GREENERY, pts: [...P(u - 0.7, v, 0.7), ...P(u, v, 1.5), ...P(u + 0.7, v, 0.7)] });
    }
    out.push(s);
  }
  return out;
}
