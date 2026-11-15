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

/** Blend connected river and lake surfaces across a band in sheet millimetres. */
export function riverBlend(paper: Paper, river: Uint8Array, lake: Uint8Array, width: number): (x: number, y: number) => number {
  const step = Math.min(1, width / 8), W = Math.ceil((paper.x1 - paper.x0) / step), H = Math.ceil((paper.y1 - paper.y0) / step);
  const kind = new Uint8Array(W * H), distance = new Float32Array(W * H).fill(width);
  const queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = paper.x0 + (i + 0.5) * step, y = paper.y0 + (j + 0.5) * step;
    kind[j * W + i] = paper.on(lake, x, y) ? 2 : paper.on(river, x, y) ? 1 : 0;
  }
  // Only a shared wet edge starts a transition; opposite banks do not blend across land.
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (!kind[k]) continue;
    if ((i > 0 && kind[k - 1] && kind[k - 1] !== kind[k]) || (i + 1 < W && kind[k + 1] && kind[k + 1] !== kind[k])
      || (j > 0 && kind[k - W] && kind[k - W] !== kind[k]) || (j + 1 < H && kind[k + W] && kind[k + W] !== kind[k])) {
      distance[k] = 0; queue[tail++] = k;
    }
  }
  while (head < tail) {
    const k = queue[head++], i = k % W, j = Math.floor(k / W), d = distance[k] + step;
    if (d >= width) continue;
    for (let side = 0; side < 4; side++) {
      const n = side === 0 ? (i > 0 ? k - 1 : -1) : side === 1 ? (i + 1 < W ? k + 1 : -1)
        : side === 2 ? (j > 0 ? k - W : -1) : (j + 1 < H ? k + W : -1);
      if (n < 0 || !kind[n] || distance[n] <= d) continue;
      distance[n] = d; queue[tail++] = n;
    }
  }
  return (x, y) => {
    const i = Math.max(0, Math.min(W - 1, Math.floor((x - paper.x0) / step)));
    const j = Math.max(0, Math.min(H - 1, Math.floor((y - paper.y0) / step))), k = j * W + i;
    const t = 0.5 + (paper.on(lake, x, y) ? -1 : 1) * distance[k] / (2 * width);
    return t * t * (3 - 2 * t);
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
  const mappedRiver = river.slice();
  for (const shape of streams) paper.fillMask(river, shape.map((r) => r.pts));
  const blend = riverBlend(paper, river, lake, cam.gap(12));
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
  const centre = channelField(town.streams.map((s) => project(s.pts))), bank = channelField(banks, true);
  // River and canal centre lines take priority within mapped river areas. A small tributary
  // must not turn the main current sideways just because its endpoint is closer to a bank.
  const main = channelField(town.streams.filter((s) => s.width >= 7).map((s) => project(s.pts)));
  // Both textures turn through the same field at a mouth, avoiding a crossed hatch.
  const channel = (x: number, y: number) => (paper.on(mappedRiver, x, y) ? main(x, y) : undefined) ?? centre(x, y) ?? bank(x, y);
  const direction = (x: number, y: number): [number, number] | undefined => {
    const dir = channel(x, y);
    if (!dir) return undefined;
    const weight = blend(x, y);
    if (weight === 1) return dir;
    const angle = Math.atan2(dir[1] * (dir[0] < 0 ? -1 : 1), Math.abs(dir[0])) * weight;
    return [Math.cos(angle), Math.sin(angle)];
  };
  const gap = cam.gap(1.2), occupied = new Map<string, number[]>();
  const cellKey = (i: number, j: number) => `${i},${j}`;
  const free = (x: number, y: number) => {
    const i = Math.floor((x - ox) / gap), j = Math.floor((y - oy) / gap);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const points = occupied.get(cellKey(i + dx, j + dy));
      if (!points) continue;
      for (let k = 0; k < points.length; k += 2) if ((x - points[k]) ** 2 + (y - points[k + 1]) ** 2 < gap * gap) return false;
    }
    return true;
  };
  for (const kind of ['lake', 'ocean'] as const) {
    const ocean = kind === 'ocean', pitch = cam.gap(ocean ? 2.5 : 2.6), step = cam.gap(ocean ? 14 : 10);
    for (let j = Math.floor((paper.y0 - oy) / pitch) - 1; j <= Math.ceil((paper.y1 - oy) / pitch); j++) {
      const y = oy + (j + 0.5) * pitch;
      for (let i = Math.floor((paper.x0 - ox) / step) - 1; i <= Math.ceil((paper.x1 - ox) / step); i++) {
        const r = hash(i, j, seed, 7940), x = ox + (i + hash(j, seed, 7941) * 0.8) * step;
        const len = step * (0.65 + r * 0.25), amp = cam.gap(ocean ? 0.28 + r * 0.18 : 0.025 + r * 0.035);
        const pts: number[] = [], n = Math.ceil(len / 0.3);
        let dx = 0, dy = 0;
        for (let p = 0; p <= n; p++) {
          const t = p / n, px = x + t * len + dx, py = y + dy;
          const yy = py + Math.sin(t * Math.PI * 2) * amp;
          pts.push(px, yy, cam.groundDepth(yy));
          const weight = blend(px, py);
          const dir = !ocean && weight > 0 && weight < 1 && paper.on(M.water, px, py) ? direction(px, py) : undefined;
          const sign = dir && dir[0] < 0 ? -1 : 1;
          dx += ((dir ? dir[0] * sign : 1) - 1) * len / n; dy += (dir ? dir[1] * sign : 0) * len / n;
        }
        const threshold = hash(i, j, seed, 7945);
        const accepts = (x: number, y: number, d: number) => (ocean ? kindAt(x, y) === kind
          : kindAt(x, y) !== 'ocean' && blend(x, y) < threshold) && keep(x, y, d);
        paper.sheet(WATER, pts, accepts);
        // Reserve lake strokes before tracing river strokes through the shared band.
        if (!ocean) for (let p = 0; p < pts.length; p += 3) {
          const x = pts[p], y = pts[p + 1];
          if (blend(x, y) === 0 || !accepts(x, y, pts[p + 2])) continue;
          const key = cellKey(Math.floor((x - ox) / gap), Math.floor((y - oy) / gap));
          const points = occupied.get(key);
          if (points) points.push(x, y); else occupied.set(key, [x, y]);
        }
      }
    }
  }
  const keepRiver = (x: number, y: number) => (paper.on(river, x, y) || paper.on(lake, x, y)) && kindAt(x, y) !== 'ocean' && keep(x, y, cam.groundDepth(y));
  for (let j = Math.floor((paper.y0 - oy) / gap); j <= Math.ceil((paper.y1 - oy) / gap); j++) {
    for (let i = Math.floor((paper.x0 - ox) / gap); i <= Math.ceil((paper.x1 - ox) / gap); i++) {
      // Break alignment with the seeding lattice without moving decisions when the map pans.
      const x = ox + (i + 0.1 + hash(i, j, seed, 7943) * 0.8) * gap;
      const y = oy + (j + 0.1 + hash(i, j, seed, 7944) * 0.8) * gap;
      const threshold = hash(i, j, seed, 7946);
      const accepts = (x: number, y: number) => blend(x, y) > threshold && keepRiver(x, y);
      if (!accepts(x, y) || !free(x, y)) continue;
      const first = direction(x, y);
      if (!first) continue;
      const len = cam.gap(3 + hash(i, j, seed, 7942) * 4), ds = Math.min(0.3, gap / 3);
      const arms: number[][] = [];
      let length = 0;
      for (const sign of [-1, 1]) {
        const arm: number[] = [];
        let px = x, py = y, prev = [first[0] * sign, first[1] * sign];
        for (let t = 0; t < len / 2; t += ds) {
          let dir = direction(px, py);
          if (!dir) break;
          if (dir[0] * prev[0] + dir[1] * prev[1] < 0) dir = [-dir[0], -dir[1]];
          const nx = px + dir[0] * ds, ny = py + dir[1] * ds;
          if (!accepts(nx, ny) || !free(nx, ny)) break;
          arm.push(nx, ny, cam.groundDepth(ny)); length += ds;
          px = nx; py = ny; prev = dir;
        }
        arms.push(arm);
      }
      // Crowded remnants are omitted instead of filling the channel with dot-like fragments.
      if (length < Math.max(cam.nib * 2, gap * 2)) continue;
      const pts: number[] = [];
      for (let k = arms[0].length - 3; k >= 0; k -= 3) pts.push(arms[0][k], arms[0][k + 1], arms[0][k + 2]);
      pts.push(x, y, cam.groundDepth(y), ...arms[1]);
      paper.sheet(WATER, pts, keep);
      for (let k = 0; k < pts.length; k += 3) {
        const key = cellKey(Math.floor((pts[k] - ox) / gap), Math.floor((pts[k + 1] - oy) / gap));
        const points = occupied.get(key);
        if (points) points.push(pts[k], pts[k + 1]); else occupied.set(key, [pts[k], pts[k + 1]]);
      }
    }
  }
}
