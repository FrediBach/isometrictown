import type { Build, Solid } from './buildings';
import { LOD, shows } from './lod';
import { fits } from './production';
import { GREENERY, LINEWORK } from './settings';
import { bestRect, corners, type Rect } from './shape';
import type { Building } from './tiles';

/** Repeated nine-metre garden floors around a continuous tower core. */
export type TowerGardens = { core: number[]; supports: number[]; depth: number; bands: [number, number][] };

/** Keep broad terraces and their supports inside the host, clear of holes and cut footprints. */
export function towerGardens(b: Building, z0: number, H: number): TowerGardens | null {
  if (H < 60 || H - z0 < 55 || b.shape.length !== 1 || b.shape[0].seam.some(Boolean)) return null;
  const { rect, fill } = bestRect(b.shape[0].pts);
  if (!rect || fill < 0.9 || rect.w < 20) return null;
  const depth = Math.min(5, rect.w * 0.2);
  const inset = (d: number): Rect => ({ ...rect, L: rect.L - d * 2, w: rect.w - d * 2 });
  if (!fits(inset(0.7), b.shape)) return null;
  const count = Math.min(4, Math.max(2, Math.floor((H - z0) / 55)));
  const bands: [number, number][] = [];
  for (let i = 1; i <= count; i++) {
    const za = z0 + Math.round(((H - z0) * i / (count + 1) - 4.5) / 3.5) * 3.5;
    bands.push([za, za + 9]);
  }
  return { core: corners(inset(depth)), supports: corners(inset(1.3)), depth, bands };
}

/** Corner columns carry the upper tower; cultivation strips leave a route beside the core. */
export function towerDeck(B: Build, plan: TowerGardens, za: number, zb: number, s: Solid): void {
  const { supports: p, core } = plan;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i], y = p[i + 1], ring: number[][] = [];
    for (let j = 0; j < 8; j++) {
      const a = j * Math.PI / 4;
      ring.push([x + Math.cos(a) * 0.6, y + Math.sin(a) * 0.6]);
    }
    let near = ring[0];
    for (let j = 0; j < 8; j++) {
      const a = ring[j], b = ring[(j + 1) % 8];
      s.faces.push([[...a, za, ...b, za, ...b, zb, ...a, zb]]);
      if (B.cam.depth(a[0], a[1], za) < B.cam.depth(near[0], near[1], za)) near = a;
    }
    s.lines.push({ pen: LINEWORK, pts: [...near, za, ...near, zb] });
  }
  for (let i = 0; i < core.length; i += 2) {
    const j = (i + 2) % core.length, dx = core[j] - core[i], dy = core[j + 1] - core[i + 1];
    const len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const at = (t: number, d: number, h: number) => [core[i] + ux * t + uy * d, core[i + 1] + uy * t - ux * d, h];
    // Broad greenhouse ribs replace the host's window pattern through the growing floors.
    if (shows(B.cam, LOD.productionFrame, 9)) {
      const step = Math.max(6, B.cam.gap(1.8));
      for (let t = step; t < len - 1; t += step) s.lines.push({ pen: LINEWORK, pts: [...at(t, 0.05, za), ...at(t, 0.05, zb)] });
    }
    const d = plan.depth - 1.5;
    // A single long growing strip reads at town scale without closing into a dark border.
    s.lines.push({ pen: GREENERY, pts: [...at(1, d, za + 0.8), ...at(len - 1, d, za + 0.8)] });
    if (shows(B.cam, LOD.terraceCrop, 2.5)) {
      const step = Math.max(4, B.cam.gap(1.5));
      for (let t = 2; t < len - 2; t += step) s.lines.push({ pen: GREENERY, pts: [...at(t - 0.8, d, za + 0.8), ...at(t, d, za + 1.8), ...at(t + 0.8, d, za + 0.8)] });
    }
  }
}
