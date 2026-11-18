import type { Camera } from './camera';
import type { Occupancy } from './image-blocks';
import { containsSite, Ground, Index } from './image-check';
import { toneAt, type Target } from './image-read';
import type { Area, Town } from './tiles';

/** Fit exposed stone into meadow, with worked pits close to a road or farm track. */
export function rockSites(town: Town, meadow: Area[], cam: Camera, target: Target, ground: Ground, occ: Occupancy, vary: (x: number, y: number, salt: number) => number): void {
  if (!meadow.length) return;
  const index = new Index();
  meadow.forEach((a, i) => index.add(i, a.shape[0].pts));
  const [left, top, right, bottom] = cam.rect;
  const pits: [number, number][] = [];

  // Test the centre and rim against the picture, then the whole outline against the land plan.
  function place(x: number, y: number, radius: number, mouth?: [number, number]): boolean {
    const hosts = index.at(x, y);
    if (!hosts.length || ground.front(x, y) < radius + 1) return false;
    const fitsImage = (u: number, v: number) => {
      const sx = cam.sx(u, v), sy = cam.sy(u, v, 0);
      if (sx < left || sx >= right || sy < top || sy >= bottom) return false;
      const tone = toneAt(target, sx, sy);
      return tone !== null && tone < 0.97;
    };
    if (!fitsImage(x, y)) return false;
    const turn = 2 * Math.PI * vary(x, y, 14780);
    const aspect = mouth ? 0.62 + 0.37 * vary(x, y, 14781) : 0.48 + 0.36 * vary(x, y, 14781);
    const count = 7 + Math.floor(4 * vary(x, y, 14782));
    const cos = Math.cos(turn), sin = Math.sin(turn);
    const pts: number[] = [], hole: number[] = [];
    for (let i = 0; i < count; i++) {
      const angle = 2 * Math.PI * (i + 0.35 * vary(x + i, y, 14783)) / count;
      const u = radius * Math.cos(angle), v = radius * aspect * Math.sin(angle);
      const px = x + u * cos - v * sin, py = y + u * sin + v * cos;
      if (!fitsImage(px, py)) return false;
      pts.push(px, py);
      hole.unshift(px, py);
    }
    const host = hosts.map(i => meadow[i]).find(a => containsSite(a.shape, pts));
    if (!host || ground.crossesStream(pts) || !occ.allows(pts, 0)) return false;
    host.shape.push({ pts: hole, seam: new Uint8Array(count) });
    const shape = [{ pts, seam: new Uint8Array(count) }];
    if (mouth) town.landuse.push({ cls: 'quarry', shape, quarryAccess: mouth });
    else town.cover.push({ cls: 'rock', shape });
    occ.fill([pts]);
    return true;
  }

  // Try a pit just beyond the verge. Keep separate workings at least half a kilometre apart.
  for (const w of town.ways) {
    if (w.bridge || !(w.cls === 'track' || w.kind === 'road' && ['minor', 'service', 'tertiary', 'secondary', 'primary'].includes(w.cls))) continue;
    for (let i = 2; i < w.pts.length; i += 2) {
      const dx = w.pts[i] - w.pts[i - 2], dy = w.pts[i + 1] - w.pts[i - 1], length = Math.hypot(dx, dy);
      const mx = w.pts[i] - dx / 2, my = w.pts[i + 1] - dy / 2;
      if (length < 1 || vary(mx, my, 14784) > 0.22) continue;
      const radius = 23 + 14 * vary(mx, my, 14785);
      const offset = (radius + 2 + w.width / 2) * (vary(mx, my, 14786) < 0.5 ? -1 : 1);
      const x = mx - dy * offset / length, y = my + dx * offset / length;
      if (!pits.some(([px, py]) => Math.hypot(x - px, y - py) < 500) && place(x, y, radius, [mx, my])) pits.push([x, y]);
    }
  }
  const [x0, y0, x1, y1] = cam.region(0);
  for (let u = Math.floor(x0 / 120) * 120; u < x1; u += 120)
    for (let v = Math.floor(y0 / 120) * 120; v < y1; v += 120) {
      const x = u + 30 + 60 * vary(u, v, 14787), y = v + 30 + 60 * vary(u, v, 14788);
      place(x, y, 11 + 15 * vary(x, y, 14789));
    }
}
