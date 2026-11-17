/**
 * Ground, green and trees for image mode (§13 of docs/plans/image-mode.md): the open land each
 * zone becomes, fields cut into a patchwork of parcels with tracks between, churchyards, and the
 * trees image mode plants itself (`Town.trees`), which the renderer draws like any other.
 */
import { pointInRing, ringArea } from './geo';
import type { Block } from './image-blocks';
import type { Footprints, Ground } from './image-check';
import { LABELS, type Label } from './image-tone';
import { maskOf, shapesOf, waterOf } from './image-water';
import { chamferDistance, type Zones } from './image-zones';
import { bestRect } from './shape';
import type { Area, Shape, Town, Way } from './tiles';

/** A hash per decision at a map-fixed point. */
type Vary = (x: number, y: number, salt: number) => number;

/** The open land of a land plan, each kind from its zones' outline. */
export type Land = { water: Shape[]; waterCls: string[]; plazas: Shape[]; parks: Shape[]; wood: Shape[]; fields: Shape[]; allotments: Shape[]; cover: Area[]; landuse: Area[] };

/** Meadow changes to marsh at a water margin and to scrub at the edge of a wood. */
function meadowCover(z: Zones): Area[] {
  const grass = maskOf(z, ['meadow']);
  if (!grass.includes(1)) return [];
  const cover: Area[] = [];
  // The wetter ground takes precedence where a wood runs down to the shore.
  for (const [edge, cls, width] of [['water', 'wetland', 30], ['wood', 'scrub', 24]] as const) {
    const source = LABELS.indexOf(edge);
    if (!z.label.includes(source)) continue;
    const distance = Float32Array.from(z.label, l => l === source ? 0 : Infinity);
    chamferDistance(distance, z.W, z.H, grass);
    const fringe = new Uint8Array(grass.length);
    for (let i = 0; i < fringe.length; i++) {
      // Denser meadow gives the transition a wider strip, in metres at every scale.
      if (grass[i] && distance[i] * z.cell <= width * (0.65 + 0.7 * z.level[i])) {
        fringe[i] = 1;
        grass[i] = 0;
      }
    }
    if (fringe.includes(1)) for (const shape of shapesOf(fringe, z, 4)) cover.push({ shape, cls });
  }
  for (const shape of shapesOf(grass, z, 4)) cover.push({ shape, cls: 'meadow' });
  return cover;
}

/** Every kind of ground a land plan has, as the renderer takes it from the map. */
export function landOf(z: Zones): Land {
  const water = waterOf(z);
  const cover = meadowCover(z);
  for (const shape of shapesOf(maskOf(z, ['sand']), z, 4)) cover.push({ shape, cls: 'beach' });
  // Land use under the buildings, so gardens, fences and works yards come with them.
  const landuse: Area[] = [
    ...shapesOf(maskOf(z, ['suburb', 'rows', 'old', 'blocks', 'towers']), z, 4).map((shape) => ({ shape, cls: 'residential' })),
    ...shapesOf(maskOf(z, ['works']), z, 4).map((shape) => ({ shape, cls: 'industrial' })),
  ];
  return {
    water: water.shapes,
    waterCls: water.cls,
    plazas: shapesOf(maskOf(z, ['plaza']), z, 4),
    parks: shapesOf(maskOf(z, ['park']), z, 4),
    wood: shapesOf(maskOf(z, ['wood']), z, 4),
    fields: shapesOf(maskOf(z, ['field']), z, 4),
    allotments: shapesOf(maskOf(z, ['allot']), z, 4),
    cover,
    landuse,
  };
}

/**
 * How a kind of open land is cut into a patchwork: strips this wide across it, m, cut this long
 * along it; pieces smaller than `min`, m², become `rest`; a share of the strip boundaries carries
 * a path of a class.
 */
type Patchwork = { strip: [number, number]; len: [number, number]; min: number; cls: string; rest: string; paths: number; path: { cls: string; unpaved?: boolean } };
/** Fields of 1–5 ha with farm tracks between (§13.2). */
export const FIELDS: Patchwork = { strip: [70, 150], len: [120, 280], min: 2500, cls: 'farmland', rest: 'meadow', paths: 0.5, path: { cls: 'track', unpaved: true } };
/** Allotment sites of a hectare or so, each its own way round, with footpaths between. */
export const ALLOTMENTS: Patchwork = { strip: [60, 110], len: [70, 150], min: 1200, cls: 'allotments', rest: 'meadow', paths: 1, path: { cls: 'footway' } };

export function patchwork(fields: Shape[], P: Patchwork, vary: Vary): { cover: Area[]; tracks: Way[] } {
  const cover: Area[] = [];
  const tracks: Way[] = [];
  for (const field of fields) {
    const { rect } = bestRect(field[0].pts);
    if (!rect) continue;
    const { cx, cy } = rect;
    const u: [number, number] = [rect.ux, rect.uy];
    const v: [number, number] = [-rect.uy, rect.ux];
    const half = [rect.L / 2, rect.w / 2];
    let b = -half[1];
    for (let row = 0; b < half[1]; row++) {
      const r = (salt: number) => vary(cx + v[0] * b, cy + v[1] * b, salt);
      const width = P.strip[0] + (P.strip[1] - P.strip[0]) * r(14070);
      const b1 = Math.min(half[1], b + width);
      // The last strip takes what is left rather than leave a sliver.
      const top = half[1] - b1 < P.strip[0] * 0.5 ? half[1] : b1;
      let a = -half[0] - P.len[1] * r(14071);
      while (a < half[0]) {
        const q = (salt: number) => vary(cx + u[0] * a + v[0] * b, cy + u[1] * a + v[1] * b, salt);
        // Some parcels are shorter than the strip is wide, so they run, and are ploughed, across it.
        const across = P.cls === 'farmland' && q(14083) < 0.3;
        const a1 = a + (across ? width * (0.45 + 0.3 * q(14072)) : P.len[0] + (P.len[1] - P.len[0]) * q(14072));
        const at = (s: number, t: number) => [cx + u[0] * s + v[0] * t, cy + u[1] * s + v[1] * t];
        const box = [...at(a, b), ...at(a1, b), ...at(a1, top), ...at(a, top)];
        const outer = clip(field[0].pts, box);
        if (outer && ringArea(outer) >= P.min) {
          const holes = field
            .slice(1)
            .map((h) => clip(h.pts, box))
            .filter((h): h is number[] => !!h && Math.abs(ringArea(h)) > 1);
          const shape: Shape = [outer, ...holes].map((pts) => ({ pts, seam: new Uint8Array(pts.length / 2) }));
          // Fruit trees and vines occupy whole parcels and follow the same farm tracks.
          const crop = P.cls === 'farmland' ? q(14708) : 1;
          const cls = crop < 0.12 ? 'orchard' : crop < 0.23 ? 'vineyard' : P.cls;
          cover.push({ shape, cls });
        } else if (outer && ringArea(outer) > 1) cover.push({ shape: [{ pts: outer, seam: new Uint8Array(outer.length / 2) }], cls: P.rest });
        a = a1;
      }
      // A track along the boundary with the next strip, where it runs inside the field.
      if (top < half[1] && r(14073) < P.paths) {
        let run: number[] = [];
        const flush = () => {
          if (run.length >= 2 * 2 && Math.hypot(run[run.length - 2] - run[0], run[run.length - 1] - run[1]) >= 60) tracks.push({ pts: run, kind: 'path', width: 0, ...P.path });
          run = [];
        };
        for (let s = -half[0]; s <= half[0]; s += 8) {
          const x = cx + u[0] * s + v[0] * top;
          const y = cy + u[1] * s + v[1] * top;
          const inside = pointInRing(x, y, field[0].pts) && !field.slice(1).some((h) => pointInRing(x, y, h.pts));
          if (inside) run.push(x, y);
          else flush();
        }
        flush();
      }
      b = top;
    }
  }
  return { cover, tracks };
}

/** Sutherland–Hodgman: a ring clipped to a convex counter-clockwise quad; null if nothing is left. */
function clip(ring: number[], quad: number[]): number[] | null {
  let pts = ring;
  for (let e = 0; e < 4 && pts.length >= 6; e++) {
    const ax = quad[e * 2];
    const ay = quad[e * 2 + 1];
    const bx = quad[((e + 1) % 4) * 2];
    const by = quad[((e + 1) % 4) * 2 + 1];
    const side = (x: number, y: number) => (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    const out: number[] = [];
    for (let i = 0, n = pts.length; i < n; i += 2) {
      const j = (i + 2) % n;
      const [px, py, qx, qy] = [pts[i], pts[i + 1], pts[j], pts[j + 1]];
      const sp = side(px, py);
      const sq = side(qx, qy);
      if (sp >= 0) out.push(px, py);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push(px + (qx - px) * t, py + (qy - py) * t);
      }
    }
    pts = out;
  }
  return pts.length >= 6 ? pts : null;
}

/** Trees: courtyards this large get them, m², at about this spacing, m, as crowns of this radius and height. */
const COURT_TREES: Partial<Record<Label, { min: number; spacing: number; r: number; h: number }>> = {
  blocks: { min: 2000, spacing: 16, r: 4.5, h: 13 },
  rows: { min: 600, spacing: 15, r: 3.2, h: 9 },
  old: { min: 600, spacing: 18, r: 3.5, h: 10 },
};
/** Churchyards are planted at about this spacing, m, with dark conifers among broadleaf trees. */
const YARD_SPACING = 14;

/**
 * The trees image mode plants itself: a few big trees in the courtyards of perimeter blocks,
 * and trees round each churchyard. Each stands on open ground, clear of buildings, roads and
 * water by its crown.
 */
export function treesOf(blocks: Block[], yards: Area[], laid: Footprints, ground: Ground, vary: Vary): Town['trees'] {
  const trees: Town['trees'] = [];
  const clear = (x: number, y: number, r: number) => {
    if (laid.covers(x, y) || ground.under(x, y, r)) return false;
    for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (laid.covers(x + dx, y + dy) || ground.under(x + dx, y + dy)) return false;
    return true;
  };
  /** Trees over a ring on a jittered grid, kept `edge` m in from its outline. */
  const scatter = (ring: number[], spacing: number, edge: number, plant: (x: number, y: number, r: (salt: number) => number) => { r: number; h: number; conifer: boolean } | null) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k < ring.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, ring[k]), Math.min(y0, ring[k + 1]), Math.max(x1, ring[k]), Math.max(y1, ring[k + 1])];
    // The grid is map-fixed, so a courtyard's trees don't shift with its outline.
    for (let gy = Math.floor(y0 / spacing) * spacing; gy < y1; gy += spacing)
      for (let gx = Math.floor(x0 / spacing) * spacing; gx < x1; gx += spacing) {
        const r = (salt: number) => vary(gx, gy, salt);
        const x = gx + spacing * (0.2 + 0.6 * r(14074));
        const y = gy + spacing * (0.2 + 0.6 * r(14075));
        if (!pointInRing(x, y, ring) || toRing(x, y, ring) < edge) continue;
        const t = plant(x, y, r);
        if (t && clear(x, y, t.r)) trees.push({ x, y, ...t });
      }
  };
  for (const b of blocks) {
    const c = COURT_TREES[b.label];
    if (!c || !b.court || ringArea(b.court) < c.min) continue;
    scatter(b.court, c.spacing, c.r + 1, (_, __, r) => (r(14076) < 0.75 ? { r: c.r * (0.8 + 0.4 * r(14077)), h: c.h * (0.85 + 0.3 * r(14078)), conifer: false } : null));
  }
  for (const y of yards) {
    const ring = y.shape[0].pts;
    scatter(ring, YARD_SPACING, 2.5, (_, __, r) => (r(14079) < 0.6 ? { r: 2.2 + r(14080), h: 8 + 4 * r(14081), conifer: r(14082) < 0.5 } : null));
  }
  return trees;
}

/** How far a point is from a ring's outline, m. */
function toRing(x: number, y: number, p: number[]): number {
  let best = Infinity;
  for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2) {
    const dx = p[a] - p[b];
    const dy = p[a + 1] - p[b + 1];
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - p[b]) * dx + (y - p[b + 1]) * dy) / l2));
    best = Math.min(best, Math.hypot(x - p[b] - dx * t, y - p[b + 1] - dy * t));
  }
  return best;
}
