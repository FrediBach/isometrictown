import { tagLines, type Build, type Solid } from './buildings';
import { LOD, shows, spaced } from './lod';
import { fits } from './production';
import { GREENERY, LINEWORK, WATER } from './settings';
import { bestRect, corners, type Rect } from './shape';
import { panel } from './solar';
import type { Building } from './tiles';

/** A roof farm wholly supported by its host, with four-metre setbacks at each storey. */
export type GardenCrown = { deck: Rect; levels: Rect[] };

/** Fit the complete addition before drawing; holes, seams and narrow hosts decline it. */
export function planGardenCrown(b: Building): GardenCrown | undefined {
  if (b.min > 0 || b.h < 12 || b.h > 60 || b.shape.some((r) => r.seam.some(Boolean))) return;
  const { rect } = bestRect(b.shape[0].pts);
  if (!rect || rect.L < 32 || rect.w < 28) return;
  const deck = { ...rect, L: Math.min(80, rect.L - 2), w: Math.min(50, rect.w - 2) };
  if (!fits(deck, b.shape)) return;
  const count = Math.min(3, Math.floor((deck.w - 10) / 8));
  const levels = Array.from({ length: count }, (_, i) => ({ ...deck, L: deck.L - 8 * (i + 1), w: deck.w - 8 * (i + 1) }));
  return { deck, levels };
}

/** Stepped greenhouse rooms, broad food beds and a raised solar crown, up to fifteen metres tall. */
export function gardenCrown(B: Build, plan: GardenCrown, z: number, s: Solid): void {
  if (!shows(B.cam, LOD.gardenCrown, plan.deck.w)) return;
  const point = (r: Rect, u: number, v: number, h: number) => [r.cx + r.ux * u - r.uy * v, r.cy + r.uy * u + r.ux * v, h];
  const ring = (r: Rect, h: number) => corners(r).flatMap((v, i, p) => i % 2 ? [] : [v, p[i + 1], h]);
  let deck = plan.deck;
  for (const room of plan.levels) {
    tagLines(B, 'additions', s, () => {
      const top = ring(room, z + 3.8), bottom = ring(room, z);
      s.faces.push([top]);
      s.lines.push({ pen: LINEWORK, pts: top, closed: true });
      for (let e = 0; e < 4; e++) {
        const a = e * 3, b = ((e + 1) % 4) * 3;
        s.faces.push([[...bottom.slice(a, a + 3), ...bottom.slice(b, b + 3), ...top.slice(b, b + 3), ...top.slice(a, a + 3)]]);
        s.lines.push({ pen: LINEWORK, pts: [...bottom.slice(a, a + 3), ...top.slice(a, a + 3)] });
      }
      // Wide greenhouse bays supply the structure without a second layer of window texture.
      if (shows(B.cam, LOD.productionFrame, 3.8)) {
        const step = spaced(B.cam, 5, 1.8);
        for (let u = -room.L / 2 + step; u < room.L / 2 - 1; u += step) for (const sign of [-1, 1]) {
          s.lines.push({ pen: LINEWORK, pts: [...point(room, u, sign * room.w / 2, z), ...point(room, u, sign * room.w / 2, z + 3.8)] });
        }
      }
      if (shows(B.cam, LOD.productionFrame, 3.8)) {
        const edge = ring(deck, z + 0.9), base = ring(deck, z);
        s.lines.push({ pen: LINEWORK, pts: edge, closed: true });
        for (let e = 0; e < 4; e++) s.lines.push({ pen: LINEWORK, pts: [...base.slice(e * 3, e * 3 + 3), ...edge.slice(e * 3, e * 3 + 3)] });
      }
    }, 'garden-crown');
    tagLines(B, 'planting', s, () => {
      // Two continuous cultivated strips leave a clear route round the greenhouse rooms.
      for (const sign of [-1, 1]) {
        const v = sign * (deck.w / 2 - 1.4), a = deck.L / 2 - 2;
        const bed = [-0.7, 0.7].flatMap((d, i) => [point(deck, i ? a : -a, v + d, z + 0.65), point(deck, i ? -a : a, v + d, z + 0.65)]).flat();
        s.faces.push([bed]);
        // At distant scales a single crop strip replaces bed edges too close for the pen.
        if (shows(B.cam, LOD.productionFrame, 3.8)) s.lines.push({ pen: GREENERY, pts: bed, closed: true });
        else s.lines.push({ pen: GREENERY, pts: [...point(deck, -a, v, z + 0.7), ...point(deck, a, v, z + 0.7)] });
        if (shows(B.cam, LOD.terraceCrop, 2.5)) {
          const step = spaced(B.cam, 3.5, 1.5);
          for (let u = -a + 1; u < a - 1; u += step) s.lines.push({ pen: GREENERY, pts: [...point(deck, u - 0.9, v, z + 0.7), ...point(deck, u, v, z + 1.6), ...point(deck, u + 0.9, v, z + 0.7)] });
        }
      }
    }, 'terrace-food');
    if (shows(B.cam, LOD.productionFrame, 2.5)) tagLines(B, 'additions', s, () => {
      s.lines.push({ pen: WATER, pts: [...point(room, -room.L / 2, -room.w / 2, z + 3.8), ...point(room, -room.L / 2, -room.w / 2, z + 0.3), ...point(deck, -deck.L / 2 + 1, -deck.w / 2 + 1.4, z + 0.3)] });
    }, 'garden-crown');
    s.casts.push({ ring: corners(room), h: z + 3.8 });
    deck = room;
    z += 3.8;
  }
  tagLines(B, 'solar', s, () => {
    const a = deck.L / 2 + 1, c = deck.w / 2 + 1;
    for (const u of [-a + 2, a - 2]) for (const v of [-c + 2, c - 2]) s.lines.push({ pen: LINEWORK, pts: [...point(deck, u, v, z), ...point(deck, u, v, z + 1.8 + v * 0.07)] });
    const quad = [point(deck, -a, -c, z + 1.8 - c * 0.07), point(deck, a, -c, z + 1.8 - c * 0.07), point(deck, a, c, z + 1.8 + c * 0.07), point(deck, -a, c, z + 1.8 + c * 0.07)];
    panel(B, s, quad, a * 2);
    (s.shade ??= []).push([quad.flat()]);
  }, 'garden-crown');
}
