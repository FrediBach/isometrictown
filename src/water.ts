import type { Build } from './buildings';
import { pointInRing, ringArea } from './geo';
import type { Masks } from './nature';
import type { Paper } from './raster';
import { hash } from './rng';
import { WATER } from './settings';
import type { Shape, Stream, Town } from './tiles';

/** The character of a mapped water surface; unclassified ponds stay quiet. */
export function waterKind(cls: string): 'ocean' | 'lake' | 'river' {
  return cls === 'ocean' || cls === 'sea' ? 'ocean' : cls === 'river' || cls === 'canal' || cls === 'stream' ? 'river' : 'lake';
}

/** Recover narrow channels labelled as lakes when a mapped waterway runs through them. */
export function surfaceKind(cls: string, shape: Shape, streams: Stream[]): ReturnType<typeof waterKind> {
  const kind = waterKind(cls);
  if (kind !== 'lake') return kind;
  const area = Math.abs(shape.reduce((a, r) => a + ringArea(r.pts), 0));
  let length = 0;
  for (const s of streams) for (let i = 0; i + 3 < s.pts.length; i += 2) {
    const ax = s.pts[i], ay = s.pts[i + 1], dx = s.pts[i + 2] - ax, dy = s.pts[i + 3] - ay;
    const len = Math.hypot(dx, dy), n = Math.max(1, Math.ceil(len / 10));
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n, x = ax + dx * t, y = ay + dy * t;
      if (pointInRing(x, y, shape[0].pts) && !shape.some((r, i) => i > 0 && pointInRing(x, y, r.pts))) length += len / n;
    }
  }
  return length > 0 && area / length < 80 ? 'river' : kind;
}

type Segment = { ax: number; ay: number; dx: number; dy: number; len2: number; ux: number; uy: number; vx: number; vy: number };

/** A nearby channel tangent, interpolated through bends, in sheet coordinates. */
export function channelField(paths: number[][], distant = false): (x: number, y: number) => [number, number] | undefined {
  const cells = new Map<string, Segment[]>(), all: Segment[] = [];
  const size = 16, reach = 32;
  for (const pts of paths) {
    const tangent = (i: number): [number, number] => {
      const a = Math.max(0, i - 2), b = Math.min(pts.length - 2, i + 2);
      const dx = pts[b] - pts[a], dy = pts[b + 1] - pts[a + 1], len = Math.hypot(dx, dy) || 1;
      return [dx / len, dy / len];
    };
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], ay = pts[i + 1], dx = pts[i + 2] - ax, dy = pts[i + 3] - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-8) continue;
      const [ux, uy] = tangent(i), [vx, vy] = tangent(i + 2);
      const seg = { ax, ay, dx, dy, len2, ux, uy, vx, vy };
      all.push(seg);
      for (let y = Math.floor((Math.min(ay, ay + dy) - reach) / size); y <= Math.floor((Math.max(ay, ay + dy) + reach) / size); y++) {
        for (let x = Math.floor((Math.min(ax, ax + dx) - reach) / size); x <= Math.floor((Math.max(ax, ax + dx) + reach) / size); x++) {
          const key = `${x},${y}`, list = cells.get(key);
          if (list) list.push(seg); else cells.set(key, [seg]);
        }
      }
    }
  }
  return (x, y) => {
    let best = distant ? Infinity : reach * reach, result: [number, number] | undefined;
    for (const s of cells.get(`${Math.floor(x / size)},${Math.floor(y / size)}`) ?? (distant ? all : [])) {
      const t = Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (y - s.ay) * s.dy) / s.len2));
      const d = (x - s.ax - t * s.dx) ** 2 + (y - s.ay - t * s.dy) ** 2;
      if (d >= best) continue;
      best = d;
      const dx = s.ux * (1 - t) + s.vx * t, dy = s.uy * (1 - t) + s.vy * t;
      const len = Math.hypot(dx, dy);
      result = len > 1e-6 ? [dx / len, dy / len] : [s.dx / Math.sqrt(s.len2), s.dy / Math.sqrt(s.len2)];
    }
    return result;
  };
}

/** Distinct sea crests, calm lake ripples and strokes following river channels. */
export function waves(B: Build, paper: Paper, M: Masks, town: Pick<Town, 'water' | 'waterCls' | 'streams'>, streams: Shape[]): void {
  const cam = paper.cam, seed = B.set.seed;
  const sea = paper.mask(), lake = paper.mask(), river = paper.mask();
  const banks: number[][] = [];
  const project = (pts: number[]) => pts.flatMap((_, i) => i % 2 ? [] : [cam.sx(pts[i], pts[i + 1]), cam.sy(pts[i], pts[i + 1], 0)]);
  town.water.forEach((shape, i) => {
    const kind = surfaceKind(town.waterCls[i], shape, town.streams);
    paper.fillMask(kind === 'ocean' ? sea : kind === 'river' ? river : lake, shape.map((r) => r.pts));
    if (kind === 'river') for (const ring of shape) {
      // Tile cuts are not banks and must not steer the current across a channel.
      let run: number[] = [];
      for (let j = 0; j < ring.pts.length; j += 2) {
        const k = (j + 2) % ring.pts.length;
        if (ring.seam[j / 2]) { if (run.length > 3) banks.push(project(run)); run = []; continue; }
        if (!run.length) run.push(ring.pts[j], ring.pts[j + 1]);
        run.push(ring.pts[k], ring.pts[k + 1]);
      }
      if (run.length > 3) banks.push(project(run));
    }
  });
  for (const shape of streams) paper.fillMask(river, shape.map((r) => r.pts));
  const kindAt = (x: number, y: number) => paper.on(sea, x, y) ? 'ocean' : paper.on(lake, x, y) ? 'lake' : 'river';
  const inset = cam.nib * 1.5;
  const keep = (x: number, y: number, d: number) => paper.on(M.water, x, y)
    && paper.on(M.water, x - inset, y) && paper.on(M.water, x + inset, y)
    && paper.on(M.water, x, y - inset) && paper.on(M.water, x, y + inset)
    && !paper.on(M.pool, x, y) && !paper.on(M.road, x, y) && !paper.on(M.under, x, y)
    && !paper.on(M.calm, x, y) && paper.seen(x, y, d);
  // Anchor the sheet lattice to projected absolute metres, so panning does not reshuffle it.
  const [X, Y] = B.toAbs(0, 0), [X1] = B.toAbs(1, 0), k = 1 / (X1 - X);
  const ox = cam.sx(-X * k, -Y * k), oy = cam.sy(-X * k, -Y * k, 0);
  for (const kind of ['lake', 'ocean'] as const) {
    const ocean = kind === 'ocean', pitch = cam.gap(ocean ? 2.5 : 1.65), step = cam.gap(ocean ? 14 : 10);
    for (let j = Math.floor((paper.y0 - oy) / pitch) - 1; j <= Math.ceil((paper.y1 - oy) / pitch); j++) {
      const y = oy + (j + 0.5) * pitch;
      for (let i = Math.floor((paper.x0 - ox) / step) - 1; i <= Math.ceil((paper.x1 - ox) / step); i++) {
        const r = hash(i, j, seed, 7940), x = ox + (i + hash(j, seed, 7941) * 0.8) * step;
        const len = step * (0.65 + r * 0.25), amp = cam.gap(ocean ? 0.28 + r * 0.18 : 0.025 + r * 0.035);
        const pts: number[] = [], n = Math.ceil(len / 0.3);
        for (let p = 0; p <= n; p++) {
          const t = p / n, yy = y + Math.sin(t * Math.PI * 2) * amp;
          pts.push(x + t * len, yy, cam.groundDepth(yy));
        }
        paper.sheet(WATER, pts, (x, y, d) => kindAt(x, y) === kind && keep(x, y, d));
      }
    }
  }
  const centre = channelField(town.streams.map((s) => project(s.pts))), bank = channelField(banks, true);
  const direction = (x: number, y: number) => centre(x, y) ?? bank(x, y);
  const gap = cam.gap(1.2), cell = gap / 2, occupied = new Set<string>();
  const key = (x: number, y: number) => `${Math.floor((x - ox) / cell)},${Math.floor((y - oy) / cell)}`;
  const free = (x: number, y: number) => {
    for (const [dx, dy] of [[0, 0], [cell, 0], [-cell, 0], [0, cell], [0, -cell]]) if (occupied.has(key(x + dx, y + dy))) return false;
    return true;
  };
  for (let j = Math.floor((paper.y0 - oy) / gap); j <= Math.ceil((paper.y1 - oy) / gap); j++) {
    for (let i = Math.floor((paper.x0 - ox) / gap); i <= Math.ceil((paper.x1 - ox) / gap); i++) {
      let x = ox + (i + 0.5) * gap, y = oy + (j + 0.5) * gap;
      if (!paper.on(river, x, y) || kindAt(x, y) !== 'river' || !free(x, y) || !keep(x, y, cam.groundDepth(y))) continue;
      const len = cam.gap(3 + hash(i, j, seed, 7942) * 4), ds = Math.min(0.3, gap / 3);
      const pts = [x, y, cam.groundDepth(y)];
      let prev = direction(x, y);
      if (!prev) continue;
      // A consistent orientation is only a drawing convention, not inferred downstream flow.
      if (prev[1] < 0 || (prev[1] === 0 && prev[0] < 0)) prev = [-prev[0], -prev[1]];
      for (let t = 0; t < len; t += ds) {
        let dir = direction(x, y);
        if (!dir) break;
        if (dir[0] * prev[0] + dir[1] * prev[1] < 0) dir = [-dir[0], -dir[1]];
        x += dir[0] * ds; y += dir[1] * ds;
        if (!paper.on(river, x, y) || kindAt(x, y) !== 'river' || !free(x, y) || !keep(x, y, cam.groundDepth(y))) break;
        pts.push(x, y, cam.groundDepth(y)); prev = dir;
      }
      if (pts.length < 9 || Math.hypot(x - pts[0], y - pts[1]) < Math.max(cam.nib * 2, gap)) continue;
      paper.sheet(WATER, pts, keep);
      for (let p = 0; p < pts.length; p += 3) occupied.add(key(pts[p], pts[p + 1]));
    }
  }
}
