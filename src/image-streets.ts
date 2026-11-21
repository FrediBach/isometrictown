/**
 * Streets in image mode: a network that joins up, leads somewhere and follows the image.
 * See docs/plans/image-mode.md §10.
 *
 * A field of street directions is blended from a grid or the image's own orientation in the
 * built zones, the image's contours wherever it is clearly oriented, and the edges of zones.
 * Main roads cross the ground by the cheapest way (along the field, through town, over water
 * only where it is narrow); bright lines in the image become streets; then streets are traced
 * along the field from those already laid, at the spacing each zone has. The result is made a
 * planar graph and cleaned until the hard rules of §10.5 hold, and streets are ranked by how
 * many routes across the town use them.
 */
import type { Camera } from './camera';
import { pointInRing } from './geo';
import { meet } from './image-check';
import type { Target } from './image-read';
import { blur, BUILT, LABELS, type Label } from './image-tone';
import { simplify, streamsOf, traceLines } from './image-water';
import { labelAt as zoneAt, type Zones } from './image-zones';
import type { Settings } from './settings';
import { crossingsOf, controlOf, makeRoundabout, radiusOf, type Roundabout } from './image-junctions';
import { hash, patch } from './rng';
import { LOD } from './lod';
import { offsetRing } from './shape';
import { joinedTracks } from './trains';
import { ROAD_WIDTH, type Controls, type Shape, type Stream, type Way } from './tiles';

/** The street network as a graph: node coordinates as flat [x, y, …], edges as polylines between nodes. */
export type Graph = { nodes: number[]; edges: GraphEdge[] };
/** An edge; `ring` marks a stretch of a roundabout, which the rules for streets don't hold to. */
export type GraphEdge = { a: number; b: number; pts: number[]; cls: string; main: boolean; ring?: boolean };

/** Street spacing in each built zone, m, at its densest and its sparsest (§10.4). */
const SPACING: Partial<Record<Label, [number, number]>> = { old: [35, 60], rows: [60, 110], blocks: [60, 110], suburb: [80, 150], towers: [100, 180], works: [120, 250] };
/** A traced street joins another it comes this close to, m. */
const SNAP = 8;
/** Step of the street tracer, m. */
const STEP = 4;
/** Streets shorter than this aren't kept, m. */
const MIN_STREET = 15;
/** The longest street traced in one go, m. */
const MAX_STREET = 1500;
/** The most streets traced, so a coarse scale can't run away. */
const MAX_STREETS = 3000;
/** Smoothing of the street field, m. */
const FIELD_BLUR = 30;
/** Image orientation clearer than this decides organic streets in town. */
const ORIENTED = 0.3;
/** Where the image says nothing, organic streets wander over this distance, m. */
const WANDER = 450;
/** And lean towards the radial round a core from this far out, fully this much farther, m. */
const RADIAL_FROM = 120;
const RADIAL_OVER = 250;

/** The hard rules (§10.5). */
export const RULES = { deadEnd: 25, edge: 10, angle: 35, junctions: 20 };

/** What the street planner needs from the settings. */
export type StreetSettings = Pick<Settings, 'likeness' | 'imageContours' | 'fabric' | 'seed'> & { style: string; vary?: (x: number, y: number, salt: number) => number; roundabouts?: number;
  /** Likeness and More roundabouts where masks set them for part of the picture, at a ground position. */
  likenessAt?: (x: number, y: number) => number;
  roundaboutsAt?: (x: number, y: number) => number;
  /** Streets follow image lines where masks set it, one value per target cell. */
  contours?: Float32Array;
};

const L = (l: Label) => LABELS.indexOf(l);
const WATER = L('water');
const PLAZA = L('plaza');
/** Labels streets are laid through: built land and squares. */
const streetable = (k: number) => BUILT.has(LABELS[k]) || k === PLAZA;

/** A grid of points along streets, for "is there a street near here, and which way does it run". */
class Near {
  private cells = new Map<number, number[]>();
  constructor(private size = 12) {}
  private key(x: number, y: number) {
    return (Math.floor(x / this.size) + 32768) * 65536 + Math.floor(y / this.size) + 32768;
  }
  add(pts: number[], id: number): void {
    for (let i = 2; i < pts.length; i += 2) {
      const [ax, ay, bx, by] = [pts[i - 2], pts[i - 1], pts[i], pts[i + 1]];
      const len = Math.hypot(bx - ax, by - ay);
      if (!len) continue;
      const n = Math.max(1, Math.ceil(len / 3));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const y = ay + ((by - ay) * k) / n;
        const c = this.key(x, y);
        const l = this.cells.get(c);
        const v = [x, y, (bx - ax) / len, (by - ay) / len, id];
        if (l) l.push(...v);
        else this.cells.set(c, v);
      }
    }
  }
  /** Whether any street point lies within `r` of (x, y). */
  any(x: number, y: number, r: number): boolean {
    const s = this.size;
    for (let i = Math.floor((x - r) / s); i <= Math.floor((x + r) / s); i++)
      for (let j = Math.floor((y - r) / s); j <= Math.floor((y + r) / s); j++) {
        const l = this.cells.get((i + 32768) * 65536 + j + 32768);
        if (!l) continue;
        for (let k = 0; k < l.length; k += 5) if ((l[k] - x) ** 2 + (l[k + 1] - y) ** 2 <= r * r) return true;
      }
    return false;
  }
  /** Each street point within `r` of (x, y): position, unit direction and street id. */
  each(x: number, y: number, r: number, fn: (px: number, py: number, ux: number, uy: number, id: number) => void): void {
    const s = this.size;
    for (let i = Math.floor((x - r) / s); i <= Math.floor((x + r) / s); i++)
      for (let j = Math.floor((y - r) / s); j <= Math.floor((y + r) / s); j++) {
        const l = this.cells.get((i + 32768) * 65536 + j + 32768);
        if (!l) continue;
        for (let k = 0; k < l.length; k += 5) if ((l[k] - x) ** 2 + (l[k + 1] - y) ** 2 <= r * r) fn(l[k], l[k + 1], l[k + 2], l[k + 3], l[k + 4]);
      }
  }
}

/** A min-heap of (priority, value) pairs. */
class Heap {
  private p: number[] = [];
  private v: number[] = [];
  get size() {
    return this.p.length;
  }
  push(pri: number, val: number): void {
    const { p, v } = this;
    let i = p.length;
    p.push(pri);
    v.push(val);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (p[up] <= pri) break;
      p[i] = p[up];
      v[i] = v[up];
      i = up;
    }
    p[i] = pri;
    v[i] = val;
  }
  pop(): [number, number] {
    const { p, v } = this;
    const top: [number, number] = [p[0], v[0]];
    const lp = p.pop()!;
    const lv = v.pop()!;
    if (p.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= p.length) break;
        if (c + 1 < p.length && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        p[i] = p[c];
        v[i] = v[c];
        i = c;
      }
      p[i] = lp;
      v[i] = lv;
    }
    return top;
  }
}

const lengthOf = (p: number[]) => {
  let s = 0;
  for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return s;
};

/** Long strokes and single contrast boundaries on the sheet. Leave the two banks of a bright
 * stroke to its centreline, so one white curve does not become three parallel streets. */
function contourGuides(t: Target, strength: number | Float32Array): number[][] {
  const { W, H, cell, edge, dir, ridge, tone } = t;
  const outline = new Uint8Array(W * H);
  const sample = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H ? y * W + x : -1;
  // Masks can set the strength cell by cell; a line then takes the mean along it.
  const at = (i: number) => Math.min(1, typeof strength === 'number' ? strength : strength[i]);
  let top = 0;
  if (typeof strength === 'number') top = Math.min(1, strength);
  else for (let i = 0; i < strength.length; i++) top = Math.max(top, Math.min(1, strength[i]));
  for (let i = 0; i < outline.length; i++) {
    const s = at(i);
    if (s <= 0 || edge[i] < 0.55 - 0.32 * s || t.coherence[i] < 0.55 || t.weight[i] < 0.5) continue;
    const x = i % W, y = Math.floor(i / W);
    let nx = -Math.sin(dir[i]), ny = Math.cos(dir[i]);
    const up = sample(x + Math.round(2 * nx), y + Math.round(2 * ny));
    const down = sample(x - Math.round(2 * nx), y - Math.round(2 * ny));
    if (up < 0 || down < 0) continue;
    if (tone[up] < tone[down]) { nx = -nx; ny = -ny; }
    outline[i] = 1;
    // The reader recognises bright strokes up to 36 mm wide. Search their bright side
    // for the middle, stopping at an intervening edge or transparent paper.
    for (let d = 1; d <= Math.ceil(18 / cell) + 1; d++) {
      const k = sample(x + Math.round(d * nx), y + Math.round(d * ny));
      if (k < 0 || t.weight[k] < 0.5 || (d > 2 && edge[k])) break;
      if (ridge[k] > 0) { outline[i] = 0; break; }
    }
  }
  const shortest = 12 + 24 * (1 - top);
  const lines = [...traceLines((i) => ridge[i] > 0 && at(i) > 0, t, shortest), ...traceLines((i) => !!outline[i], t, shortest)];
  /** The strength along a line, sampled at its points. */
  const along = (pts: number[]) => {
    if (typeof strength === 'number') return top;
    let sum = 0;
    for (let k = 0; k < pts.length; k += 2) {
      const i = sample(Math.floor((pts[k] - t.x0) / cell), Math.floor((pts[k + 1] - t.y0) / cell));
      sum += i < 0 ? 0 : at(i);
    }
    return sum / (pts.length / 2);
  };
  const ranked = lines.map((pts) => ({ pts, length: lengthOf(pts), s: along(pts) })).sort((a, b) => b.length - a.length);
  // Give the strongest shapes a route first. As the dial rises, follow more of each shape
  // out from its middle. The sheet-sized budget keeps photographic texture from filling the town.
  let budget = (W + H) * cell * 2 * top;
  const routes: number[][] = [];
  for (const { pts, length, s } of ranked) {
    const min = 12 + 24 * (1 - s);
    const take = Math.min(length * s, budget);
    if (budget < shortest) break;
    if (take < min) continue;
    const start = (length - take) / 2, stop = start + take;
    const run: number[] = [];
    let travelled = 0;
    for (let k = 2; k < pts.length && travelled < stop; k += 2) {
      const x = pts[k - 2], y = pts[k - 1], dx = pts[k] - x, dy = pts[k + 1] - y;
      const len = Math.hypot(dx, dy);
      if (len && travelled + len > start) {
        const a = Math.max(0, (start - travelled) / len), b = Math.min(1, (stop - travelled) / len);
        if (!run.length) run.push(x + a * dx, y + a * dy);
        run.push(x + b * dx, y + b * dy);
      }
      travelled += len;
    }
    routes.push(run);
    budget -= take;
  }
  return routes;
}

/** What the streets come to: roads and paths as ways, the graph the roads form, turning circles, streams, and the town's cores, largest first. */
export type Streets = { ways: Way[]; paths: Way[]; graph: Graph; circles: Shape[]; streams: Stream[]; cores: [number, number][]; roundabouts: Roundabout[]; controls: Controls };

/** Lay out the streets over a land plan, following the target as `cam` sees it. */
export function streets(z: Zones, target: Target, cam: Camera, set: StreetSettings, parks: Shape[]): Streets {
  const { W, H, cell } = z;
  const n = W * H;
  const likeness = Math.max(0, Math.min(1, set.likeness));
  const grid = set.fabric === 'grid' || (set.fabric === 'auto' && (set.style === 'american' || set.style === 'antipodean'));
  const x1 = z.x0 + W * cell;
  const y1 = z.y0 + H * cell;
  const cellOf = (x: number, y: number) => {
    const i = Math.floor((x - z.x0) / cell);
    const j = Math.floor((y - z.y0) / cell);
    return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i;
  };
  const labelAt = (x: number, y: number) => {
    const c = cellOf(x, y);
    return c < 0 ? -1 : z.label[c];
  };

  // The image where each cell shows: its orientation (as a ground angle), how clear, and thin lines.
  const [ox, oy] = cam.ground(0, 0);
  const [ax, ay] = cam.ground(1, 0);
  const [bx, by] = cam.ground(0, 1);
  const imgAngle = new Float32Array(n);
  const coherence = new Float32Array(n);
  const ridge = new Int8Array(n);
  const blue = new Uint8Array(n);
  const reach = Math.max(0, Math.ceil((cell * cam.s) / target.cell / 2));
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      const x = z.x0 + (i + 0.5) * cell;
      const y = z.y0 + (j + 0.5) * cell;
      const tx = Math.floor((cam.sx(x, y) - target.x0) / target.cell);
      const ty = Math.floor((cam.sy(x, y, 0) - target.y0) / target.cell);
      if (tx < 0 || ty < 0 || tx >= target.W || ty >= target.H) continue;
      const t = ty * target.W + tx;
      const phi = target.dir[t];
      const gx = (ax - ox) * Math.cos(phi) + (bx - ox) * Math.sin(phi);
      const gy = (ay - oy) * Math.cos(phi) + (by - oy) * Math.sin(phi);
      imgAngle[c] = Math.atan2(gy, gx);
      coherence[c] = target.coherence[t] * target.weight[t];
      blue[c] = target.b[t] < -0.02 ? 1 : 0;
      for (let dy = -reach; dy <= reach && !ridge[c]; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          const u = tx + dx;
          const v = ty + dy;
          if (u < 0 || v < 0 || u >= target.W || v >= target.H) continue;
          const r = target.ridge[v * target.W + u];
          // Broad strokes are traced once on the sheet below. Widening their middles to the
          // ground cells would turn a single centreline into several tracks beside one another.
          if (r === 1 || r === -1) {
            ridge[c] = r;
            break;
          }
        }
    }

  // Cores: the middles of the largest dense built areas, or of all built land.
  const settlements = coresOf(z);
  const cores = settlements.map(s => s.middle);

  // The street field, as a blend of orientations doubled (so opposite directions agree), then smoothed.
  const fc = new Float32Array(n);
  const fs = new Float32Array(n);
  const town = new Float32Array(n);
  for (let c = 0; c < n; c++) town[c] = streetable(z.label[c]) ? 1 : 0;
  const edgeOf = town.slice();
  blur(edgeOf, W, H, 2);
  const put = (c: number, angle: number, w: number) => {
    fc[c] += w * Math.cos(2 * angle);
    fs[c] += w * Math.sin(2 * angle);
  };
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      const x = z.x0 + (i + 0.5) * cell;
      const y = z.y0 + (j + 0.5) * cell;
      if (town[c]) {
        if (grid) put(c, 0, 1);
        else if (coherence[c] > ORIENTED) put(c, imgAngle[c], 1);
        else {
          // A slowly wandering orientation, fixed to the ground, and away from a core a pull
          // towards its radials and rings (never at the core itself, where they would meet in a star).
          put(c, patch(x / WANDER, y / WANDER, set.seed, 14030) * Math.PI * 2, 1);
          if (cores.length) {
            let best = cores[0];
            for (const k of cores) if (Math.hypot(k[0] - x, k[1] - y) < Math.hypot(best[0] - x, best[1] - y)) best = k;
            const d = Math.hypot(x - best[0], y - best[1]);
            put(c, Math.atan2(y - best[1], x - best[0]), 0.8 * Math.max(0, Math.min(1, (d - RADIAL_FROM) / RADIAL_OVER)));
          }
        }
      } else put(c, 0, 0.1);
      put(c, imgAngle[c], coherence[c] * (set.likenessAt ? Math.max(0, Math.min(1, set.likenessAt(x, y))) : likeness) * (grid ? 0.6 : 1.2));
      // Along the edges of zones: shores, parks, woods and fields.
      const gx = ((i + 1 < W ? edgeOf[c + 1] : edgeOf[c]) - (i > 0 ? edgeOf[c - 1] : edgeOf[c])) / 2;
      const gy = ((j + 1 < H ? edgeOf[c + W] : edgeOf[c]) - (j > 0 ? edgeOf[c - W] : edgeOf[c])) / 2;
      const m = Math.hypot(gx, gy);
      if (m > 0.02) put(c, Math.atan2(gy, gx) + Math.PI / 2, Math.min(1, m * 4) * 1.5);
    }
  blur(fc, W, H, FIELD_BLUR / cell);
  blur(fs, W, H, FIELD_BLUR / cell);
  /** The field's direction at a point: family 0 along it, 1 across. */
  const dirAt = (x: number, y: number, family: number): [number, number] => {
    const fx = Math.max(0, Math.min(W - 1.001, (x - z.x0) / cell - 0.5));
    const fy = Math.max(0, Math.min(H - 1.001, (y - z.y0) / cell - 0.5));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const c = j * W + i;
    const lerp = (a: Float32Array) => (a[c] * (1 - u) + a[c + 1] * u) * (1 - v) + (a[c + W] * (1 - u) + a[c + W + 1] * u) * v;
    const t = 0.5 * Math.atan2(lerp(fs), lerp(fc)) + (family ? Math.PI / 2 : 0);
    return [Math.cos(t), Math.sin(t)];
  };

  const lines: { pts: number[]; cls: string; main: boolean }[] = [];
  const near = new Near();
  const keep = (pts: number[], cls: string, main = false) => {
    near.add(pts, lines.length);
    lines.push({ pts, cls, main });
  };

  const vary = set.vary ?? ((x: number, y: number, salt: number) => hash(Math.round(x), Math.round(y), set.seed, salt));
  const [cx, cy] = cores[0] ?? [0, 0];
  const roads = mainRoads(z, ridge, cores, cam, dirAt, salt => vary(cx, cy, salt));
  roads.forEach((pts, k) => keep(pts, k ? 'secondary' : 'primary', true));

  // Bright lines in the image: streets in town, paths in parks, tracks in the fields.
  const paths: Way[] = [];
  const minLine = 80 + (30 - 80) * likeness;
  for (const pts of traceLines((c) => ridge[c] > 0 && z.label[c] !== WATER, z, minLine)) {
    const votes = new Map<number, number>();
    for (let i = 0; i < pts.length; i += 2) {
      const k = labelAt(pts[i], pts[i + 1]);
      votes.set(k, (votes.get(k) ?? 0) + 1);
    }
    const top = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    if (top >= 0 && streetable(top)) keep(pts, 'minor');
    else if (top === L('park') || top === L('wood')) paths.push({ pts, kind: 'path', width: 0, cls: 'footway' });
    else if (top === L('field') || top === L('meadow') || top === L('allot')) paths.push({ pts, kind: 'path', width: 0, cls: 'track', unpaved: true });
  }

  // Broad strokes read as local streets in town, walks across squares and parks, or field tracks.
  // Trace in sheet mm before projecting. Break at water and where the kind of route changes.
  const routeAt = (x: number, y: number) => {
    const l = LABELS[labelAt(x, y)];
    if (BUILT.has(l)) return 'road';
    if (l === 'plaza' || l === 'park' || l === 'wood') return 'footway';
    if (l === 'field' || l === 'meadow' || l === 'allot') return 'track';
    return null;
  };
  const layRoute = (sheet: number[], existing?: Near) => {
    let run: number[] = [];
    let route: ReturnType<typeof routeAt> = null;
    const finish = () => {
      if (route && lengthOf(run) >= minLine) {
        const pts = simplify(run, z.cell / 2);
        if (route === 'road') keep(pts, 'minor');
        else paths.push({ pts, kind: 'path', width: 0, cls: route, unpaved: route === 'track' });
        existing?.add(pts, 0);
      }
    };
    let [ax, ay] = cam.ground(sheet[0], sheet[1]);
    for (let i = 2; i < sheet.length; i += 2) {
      const [bx, by] = cam.ground(sheet[i], sheet[i + 1]);
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / z.cell));
      for (let j = 0; j < steps; j++) {
        const x = ax + ((bx - ax) * j) / steps;
        const y = ay + ((by - ay) * j) / steps;
        const dx = (bx - ax) / steps;
        const dy = (by - ay) / steps;
        const mx = x + dx / 2, my = y + dy / 2;
        let next: ReturnType<typeof routeAt> = routeAt(mx, my);
        if (existing && next) {
          const len = Math.hypot(dx, dy);
          // An outline can lie along the seam of two land labels. A street can front the
          // town on either side; this keeps a field-edge lane continuous along the seam.
          const px = -dy / len * z.cell, py = dx / len * z.cell;
          if (routeAt(mx + px, my + py) === 'road' || routeAt(mx - px, my - py) === 'road') next = 'road';
          existing.each(mx, my, Math.max(SNAP, 2 / cam.s), (_x, _y, ux, uy) => {
            if (Math.abs(dx * ux + dy * uy) > len * 0.85) next = null;
          });
        }
        if (next !== route) {
          finish();
          run = next ? [x, y] : [];
          route = next;
        }
        if (route) run.push(x + dx, y + dy);
      }
      ax = bx;
      ay = by;
    }
    finish();
  };
  for (const sheet of traceLines((i) => target.ridge[i] === 2, target, minLine * cam.s * cam.sa)) layRoute(sheet);
  if (set.contours || set.imageContours > 0) {
    const guides = contourGuides(target, set.contours ?? Math.min(1, set.imageContours));
    if (guides.length) {
      const existing = new Near();
      for (const { pts } of [...lines, ...paths]) existing.add(pts, 0);
      for (const sheet of guides) layRoute(sheet, existing);
    }
  }

  // Local streets, traced along the field from the streets already laid.
  const spacingAt = (x: number, y: number) => {
    const c = cellOf(x, y);
    if (c < 0) return 0;
    const s = SPACING[LABELS[z.label[c]]];
    return s ? s[1] - (s[1] - s[0]) * z.level[c] : 0;
  };
  const queue: [number, number, number, number, number][] = [];
  const seed = (id: number) => {
    const p = lines[id].pts;
    let carry = 0;
    for (let i = 2; i < p.length; i += 2) {
      const [sx, sy, ex, ey] = [p[i - 2], p[i - 1], p[i], p[i + 1]];
      const len = Math.hypot(ex - sx, ey - sy);
      let at = carry;
      while (at < len) {
        const x = sx + ((ex - sx) * at) / len;
        const y = sy + ((ey - sy) * at) / len;
        const sp = spacingAt(x, y);
        if (!sp) {
          at += 20;
          continue;
        }
        // Whichever way of the field runs most across the street.
        const [ux, uy] = [(ex - sx) / len, (ey - sy) / len];
        const [d0x, d0y] = dirAt(x, y, 0);
        const family = Math.abs(d0x * ux + d0y * uy) > 0.7071 ? 1 : 0;
        queue.push([x, y, family, 1, id], [x, y, family, -1, id]);
        at += sp;
      }
      carry = at - len;
    }
  };
  const trace = (x: number, y: number, family: number, sign: number, parent: number): number[] | null => {
    const pts = [x, y];
    let [dx, dy] = dirAt(x, y, family);
    dx *= sign;
    dy *= sign;
    const sp = spacingAt(x, y) || 100;
    let travelled = 0;
    const aligned = (px: number, py: number): [number, number] => {
      const [vx, vy] = dirAt(px, py, family);
      return vx * dx + vy * dy < 0 ? [-vx, -vy] : [vx, vy];
    };
    for (;;) {
      const [mx, my] = aligned(x + (dx * STEP) / 2, y + (dy * STEP) / 2);
      const qx = x + mx * STEP;
      const qy = y + my * STEP;
      if (mx * dx + my * dy < Math.cos(0.6)) break;
      if (qx < z.x0 || qy < z.y0 || qx > x1 || qy > y1) {
        pts.push(qx, qy);
        break;
      }
      const k = labelAt(qx, qy);
      if (k < 0 || !streetable(k)) break;
      // Join a street it reaches; stop short of one it would only run beside.
      let snap: [number, number] | null = null;
      let snapD = SNAP;
      let beside = false;
      near.each(qx, qy, Math.max(SNAP, sp / 2), (px, py, ux, uy, id) => {
        const d = Math.hypot(px - qx, py - qy);
        if (d < snapD && (id !== parent || travelled > 12)) {
          snapD = d;
          snap = [px, py];
        }
        if (Math.abs(ux * mx + uy * my) > 0.9 && id !== parent) beside = true;
      });
      if (snap) {
        pts.push(...(snap as [number, number]));
        break;
      }
      if (beside) break;
      pts.push(qx, qy);
      travelled += STEP;
      [x, y, dx, dy] = [qx, qy, mx, my];
      if (travelled > MAX_STREET) break;
    }
    return lengthOf(pts) >= MIN_STREET ? pts : null;
  };
  const grow = () => {
    for (let id = 0; id < lines.length; id++) seed(id);
    let done = 0;
    while (done < queue.length && lines.length < MAX_STREETS) {
      const [x, y, family, sign, parent] = queue[done++];
      const pts = trace(x, y, family, sign, parent);
      if (!pts) continue;
      keep(pts, 'minor');
      seed(lines.length - 1);
    }
    queue.length = 0;
  };
  grow();
  // Built land farther from a street than its spacing (a village across the fields, a corner the
  // tracing never turned into) gets a street through it, and growth goes on from there. Streets
  // only ever close gaps, so one scan in order finds them all.
  const stride = Math.max(1, Math.round(10 / cell));
  for (let j = 0; j < H && lines.length < MAX_STREETS; j += stride)
    for (let i = 0; i < W && lines.length < MAX_STREETS; i += stride) {
      const c = j * W + i;
      if (!BUILT.has(LABELS[z.label[c]])) continue;
      const x = z.x0 + (i + 0.5) * cell;
      const y = z.y0 + (j + 0.5) * cell;
      const sp = spacingAt(x, y);
      if (near.any(x, y, sp * 0.75)) continue;
      const a = trace(x, y, 0, 1, -1);
      const b = trace(x, y, 0, -1, -1);
      const pts = [...reverse(b ?? [x, y]).slice(0, -2), ...(a ?? [x, y])];
      if (lengthOf(pts) < MIN_STREET) continue;
      keep(pts, 'minor');
      seed(lines.length - 1);
      let done = 0;
      while (done < queue.length && lines.length < MAX_STREETS) {
        const [qx, qy, family, sign, parent] = queue[done++];
        const t = trace(qx, qy, family, sign, parent);
        if (t) {
          keep(t, 'minor');
          seed(lines.length - 1);
        }
      }
      queue.length = 0;
    }

  // A planar graph, cleaned until the hard rules hold, joined into one network, and ranked.
  const water = (x: number, y: number) => labelAt(x, y) === WATER;
  const openLand = (x: number, y: number) => {
    const label = labelAt(x, y);
    return label >= 0 && label !== WATER && !streetable(label);
  };
  const g = clean(planar(lines), water, grid ? undefined : openLand);
  // Plan lanes where their true width meets the road rule at reference detail and pen width.
  rank(g, z, ROAD_WIDTH.service * cam.s >= LOD.road.mm);

  // Junctions as real towns of the style control them: some become roundabouts, some get signals.
  const roundabouts: Roundabout[] = [];
  const signals: number[] = [];
  {
    const deg = degrees(g);
    const N = g.nodes.length / 2;
    for (let v = 0; v < N; v++) {
      if (deg[v] < 3) continue;
      const [x, y] = [g.nodes[v * 2], g.nodes[v * 2 + 1]];
      if (x < z.x0 + 40 || y < z.y0 + 40 || x > x1 - 40 || y > y1 - 40) continue;
      const arms = g.edges.filter((e) => (e.a === v) !== (e.b === v)).map((e) => e.cls);
      const at = labelAt(x, y);
      const control = controlOf(arms, at < 0 ? undefined : LABELS[at], set.style, vary(x, y, 14950), set.roundaboutsAt ? set.roundaboutsAt(x, y) : set.roundabouts ?? 0);
      if (control === 'signals') signals.push(x, y);
      if (control !== 'roundabout') continue;
      const top = arms.reduce((a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a));
      const r = radiusOf(top, ROAD_WIDTH[top] ?? ROAD_WIDTH.minor, set.style, vary(x, y, 14951));
      const ring = makeRoundabout(g, v, r, top === 'service' ? 'minor' : top, water);
      if (ring) roundabouts.push(ring);
    }
    compact(g);
  }

  // Turning circles where suburban streets end.
  const deg = degrees(g);
  const circles: Shape[] = [];
  for (let v = 0; v < deg.length; v++) {
    if (deg[v] !== 1) continue;
    const [x, y] = [g.nodes[v * 2], g.nodes[v * 2 + 1]];
    if (labelAt(x, y) !== L('suburb') || x < z.x0 + 30 || y < z.y0 + 30 || x > x1 - 30 || y > y1 - 30) continue;
    const ring: number[] = [];
    for (let k = 0; k < 16; k++) ring.push(x + 9 * Math.cos((k / 16) * 2 * Math.PI), y + 9 * Math.sin((k / 16) * 2 * Math.PI));
    circles.push([{ pts: ring, seam: new Uint8Array(16) }]);
  }

  // Paths round and across the larger parks.
  for (const park of parks) {
    const ring = park[0].pts;
    let area = 0;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) area += (ring[j] - ring[i]) * (ring[j + 1] + ring[i + 1]);
    if (area / 2 < 10000) continue;
    const loop = offsetRing(ring, () => 10);
    if (loop && loop.length >= 6) paths.push({ pts: [...loop, loop[0], loop[1]], kind: 'path', width: 0, cls: 'footway' });
    const across = crossing(ring);
    if (across) paths.push({ pts: across, kind: 'path', width: 0, cls: 'footway' });
  }

  // Thin dark bluish lines are streams and ditches.
  const streams = streamsOf((c) => ridge[c] < 0 && blue[c] === 1, z, 25);
  const ways = waysOf(g, water, roundabouts);
  const zoneAt = (x: number, y: number) => {
    const at = labelAt(x, y);
    return at < 0 ? undefined : LABELS[at];
  };
  const controls: Controls = { signals, crossings: crossingsOf(ways, signals, roundabouts, zoneAt, set.style, vary) };
  return { ways, paths, graph: g, circles, streams, cores: settlements.map(s => s.centre), roundabouts, controls };
}

const reverse = (p: number[]) => {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
};

/** The middles of the largest dense built areas (old town, blocks, towers), or of all built land, in metres. */
function coresOf(z: Zones) {
  const dense = new Set([L('old'), L('blocks'), L('towers')]);
  const pick = (want: (k: number) => boolean) => {
    const seen = new Uint8Array(z.W * z.H);
    const found: { size: number; middle: [number, number]; centre: [number, number] }[] = [];
    for (let c0 = 0; c0 < seen.length; c0++) {
      if (seen[c0] || !want(z.label[c0])) continue;
      const list = [c0];
      seen[c0] = 1;
      let sx = 0;
      let sy = 0;
      for (let q = 0; q < list.length; q++) {
        const c = list[q];
        const i = c % z.W;
        sx += i;
        sy += (c - i) / z.W;
        for (const d of [i > 0 ? c - 1 : -1, i < z.W - 1 ? c + 1 : -1, c - z.W, c + z.W])
          if (d >= 0 && d < seen.length && !seen[d] && want(z.label[d])) {
            seen[d] = 1;
            list.push(d);
          }
      }
      if (list.length * z.cell * z.cell <= 20000) continue;
      // A crescent-shaped neighbourhood can wrap round a lake. Anchor its services on
      // an actual cell of this settlement, as close to its middle as the ground allows.
      const mx = sx / list.length, my = sy / list.length;
      let x = mx, y = my;
      if (!list.includes(Math.round(my) * z.W + Math.round(mx))) {
        let best = Infinity;
        for (const c of list) {
          const i = c % z.W, j = Math.floor(c / z.W);
          const d = (i - mx) ** 2 + (j - my) ** 2;
          if (d < best) { x = i; y = j; best = d; }
        }
      }
      found.push({ size: list.length, middle: [z.x0 + (mx + 0.5) * z.cell, z.y0 + (my + 0.5) * z.cell],
        centre: [z.x0 + (x + 0.5) * z.cell, z.y0 + (y + 0.5) * z.cell] });
    }
    return found.sort((a, b) => b.size - a.size).slice(0, 3);
  };
  const dense3 = pick((k) => dense.has(k));
  return dense3.length ? dense3 : pick((k) => BUILT.has(LABELS[k]));
}

/** Up to two main roads, each the cheapest way from one side of the plan to the other (§10.2). */
function mainRoads(z: Zones, ridge: Int8Array, cores: [number, number][], cam: Camera, dirAt: (x: number, y: number, f: number) => [number, number], roll: (salt: number) => number): number[][] {
  // A coarser grid, about 16 m, for the search; the road is smoothed afterwards.
  const f = Math.max(1, Math.round(16 / z.cell));
  const cs = z.cell * f;
  const RW = Math.ceil(z.W / f);
  const RH = Math.ceil(z.H / f);
  const cost = new Float32Array(RW * RH);
  const rural = new Uint8Array(cost.length), built = new Uint8Array(cost.length);
  let townCell = -1, nearest = Infinity;
  const COST: Partial<Record<Label, number>> = { water: 25, wood: 4, park: 3, plaza: 3, sand: 3, field: 1.6, meadow: 1.6, allot: 2, works: 1.2 };
  for (let j = 0; j < RH; j++)
    for (let i = 0; i < RW; i++) {
      const index = j * RW + i;
      const mx = z.x0 + (i + 0.5) * cs, my = z.y0 + (j + 0.5) * cs;
      const sx = cam.sx(mx, my), sy = cam.sy(mx, my, 0);
      if (sx >= cam.rect[0] && sx <= cam.rect[2] && sy >= cam.rect[1] && sy <= cam.rect[3]) {
        const label = zoneAt(z, mx, my);
        if (label && BUILT.has(label)) {
          built[index] = 1;
          const d = Math.hypot(mx - (cores[0]?.[0] ?? 0), my - (cores[0]?.[1] ?? 0));
          if (d < nearest) { nearest = d; townCell = index; }
        }
        if (label === 'field' || label === 'meadow' || label === 'wood' || label === 'allot') rural[index] = 1;
      }
      let sum = 0;
      let cnt = 0;
      let bright = 0;
      for (let v = j * f; v < Math.min(z.H, (j + 1) * f); v++)
        for (let u = i * f; u < Math.min(z.W, (i + 1) * f); u++) {
          const c = v * z.W + u;
          const l = LABELS[z.label[c]];
          let k = COST[l] ?? 1;
          if (BUILT.has(l) && l !== 'works') {
            const x = z.x0 + (u + 0.5) * z.cell;
            const y = z.y0 + (v + 0.5) * z.cell;
            let d = Infinity;
            for (const [cx, cy] of cores) d = Math.min(d, Math.hypot(cx - x, cy - y));
            k = 1 - 0.4 * Math.exp(-d / 400);
          }
          sum += k;
          cnt++;
          if (ridge[c] > 0) bright = 1;
        }
      cost[j * RW + i] = (sum / cnt) * (bright ? 0.4 : 1);
    }
  const moves = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  // The field's doubled angle at each cell, and each move's, so how well a move follows the
  // field is a dot product: cos 2(φ − θ), 1 along or across it, −1 at 45°.
  const fc = new Float32Array(RW * RH);
  const fs = new Float32Array(RW * RH);
  for (let c = 0; c < RW * RH; c++) {
    const [ux, uy] = dirAt(z.x0 + ((c % RW) + 0.5) * cs, z.y0 + (Math.floor(c / RW) + 0.5) * cs, 0);
    fc[c] = ux * ux - uy * uy;
    fs[c] = 2 * ux * uy;
  }
  const mc = moves.map(([dx, dy]) => (dx * dx - dy * dy) / (dx * dx + dy * dy));
  const ms = moves.map(([dx, dy]) => (2 * dx * dy) / (dx * dx + dy * dy));
  const ml = moves.map(([dx, dy]) => Math.hypot(dx, dy) * cs);
  const route = (from: number[], to: Set<number>): number[] | null => {
    const dist = new Float64Array(RW * RH).fill(Infinity);
    const prev = new Int32Array(RW * RH).fill(-1);
    const heap = new Heap();
    for (const s of from) {
      dist[s] = 0;
      heap.push(0, s);
    }
    while (heap.size) {
      const [d, c] = heap.pop();
      if (d > dist[c]) continue;
      if (to.has(c)) {
        const path: number[] = [];
        for (let k = c; k >= 0; k = prev[k]) path.push(k);
        return path;
      }
      const i = c % RW;
      const j = (c - i) / RW;
      for (let m = 0; m < moves.length; m++) {
        const [di, dj] = moves[m];
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= RW || b >= RH) continue;
        const e = b * RW + a;
        const mid = (j + (dj >> 1)) * RW + i + (di >> 1);
        const misalign = 1 - Math.abs(mc[m] * fc[mid] + ms[m] * fs[mid]);
        const nd = d + ml[m] * ((cost[c] + cost[e] + cost[mid]) / 3) * (1 + 1.5 * misalign);
        if (nd < dist[e]) {
          dist[e] = nd;
          prev[e] = c;
          heap.push(nd, e);
        }
      }
    }
    return null;
  };
  // Space four approaches round the boundary, with independent leeway at each
  // end. The terrain decides where within that stretch the road actually leaves.
  const phase = 4 * roll(14980);
  const gate = (arm: number) => {
    const centre = (phase + arm + 0.55 * (roll(14981 + arm) - 0.5) + 4) % 4;
    const cells: number[] = [];
    const consider = (cell: number, position: number) => {
      const gap = Math.abs(position - centre);
      if (Math.min(gap, 4 - gap) <= 0.12) cells.push(cell);
    };
    for (let i = 0; i < RW; i++) {
      const t = i / Math.max(1, RW - 1);
      consider(i, t);
      consider((RH - 1) * RW + i, 3 - t);
    }
    for (let j = 0; j < RH; j++) {
      const t = j / Math.max(1, RH - 1);
      consider(j * RW + RW - 1, 1 + t);
      consider(j * RW, 4 - t);
    }
    return cells;
  };
  // Keep image-led streets through continuous built land. A 75 m stretch of
  // countryside on the sheet gives an overland approach room to change direction.
  const regionalRoute = (arm: number, original: number[]) => {
    let open = 0;
    for (let k = 1; k < original.length; k++) {
      const a = original[k - 1], b = original[k];
      open = rural[b] ? open + cs * Math.hypot(a % RW - b % RW, Math.floor(a / RW) - Math.floor(b / RW)) : 0;
      if (open < 75) continue;
      const from = gate(arm), to = gate(arm + 2);
      const path = route(from, new Set(to));
      if (!path) return original;
      if (townCell < 0 || path.some(c => built[c])) return path;
      // A cheap crossing can skirt the whole settlement. Bring both approaches
      // to built land near its centre, stopping where the two routes join.
      const centre = new Set([townCell]);
      const left = route(from, centre), right = route(to, centre);
      if (!left || !right) return original;
      let j = 1;
      while (j < Math.min(left.length, right.length) && left[j] === right[j]) j++;
      return [...left.slice(j - 1).reverse(), ...right.slice(j)];
    }
    return original;
  };
  const col = (i: number) => Array.from({ length: RH }, (_, j) => j * RW + i);
  const row = (j: number) => Array.from({ length: RW }, (_, i) => j * RW + i);
  const sides = [col(0), row(0), col(RW - 1), row(RH - 1)];
  const out: number[][] = [];
  for (let arm = 0; arm < 2; arm++) {
    const base = route(sides[arm], new Set(sides[arm + 2]));
    if (!base) continue;
    const p: number[] = [];
    for (const k of regionalRoute(arm, base)) p.push(z.x0 + (k % RW + 0.5) * cs, z.y0 + (Math.floor(k / RW) + 0.5) * cs);
    out.push(p.length >= 6 ? chaikinOpen(p) : p);
  }
  return out;
}

const chaikinOpen = (p: number[]) => {
  let q = p;
  for (let r = 0; r < 2; r++) {
    const o = [q[0], q[1]];
    for (let i = 0; i + 3 < q.length; i += 2) o.push(0.75 * q[i] + 0.25 * q[i + 2], 0.75 * q[i + 1] + 0.25 * q[i + 3], 0.25 * q[i] + 0.75 * q[i + 2], 0.25 * q[i + 1] + 0.75 * q[i + 3]);
    o.push(q[q.length - 2], q[q.length - 1]);
    q = o;
  }
  return q;
};

/** A straight path across a ring through its middle, along its longer side, clipped inside it. */
function crossing(ring: number[]): number[] | null {
  const n = ring.length / 2;
  let cx = 0;
  let cy = 0;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let i = 0; i < n; i++) {
    cx += ring[i * 2] / n;
    cy += ring[i * 2 + 1] / n;
  }
  for (let i = 0; i < n; i++) {
    const dx = ring[i * 2] - cx;
    const dy = ring[i * 2 + 1] - cy;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  if (!pointInRing(cx, cy, ring)) return null;
  const t = 0.5 * Math.atan2(2 * xy, xx - yy);
  const [ux, uy] = [Math.cos(t), Math.sin(t)];
  const end = (s: number) => {
    let d = 0;
    while (d < 5000 && pointInRing(cx + ux * s * (d + 4), cy + uy * s * (d + 4), ring)) d += 4;
    return [cx + ux * s * Math.max(0, d - 8), cy + uy * s * Math.max(0, d - 8)];
  };
  const a = end(-1);
  const b = end(1);
  return Math.hypot(b[0] - a[0], b[1] - a[1]) > 40 ? [...a, ...b] : null;
}

/** Split polylines wherever they cross or one ends on another, and join them at shared nodes. */
export function planar(lines: { pts: number[]; cls: string; main: boolean }[]): Graph {
  const TOL = 1.5;
  const SIZE = 16;
  // Cut points along each line, as positions "segment + fraction", and moved ends.
  const cuts: number[][] = lines.map((l) => [0, l.pts.length / 2 - 1]);
  const segs = new Map<number, number[]>();
  const keyOf = (i: number, j: number) => (i + 32768) * 65536 + j + 32768;
  lines.forEach((l, li) => {
    for (let k = 0; k + 3 < l.pts.length; k += 2) {
      const [ax, ay, bx, by] = l.pts.slice(k, k + 4);
      for (let i = Math.floor(Math.min(ax, bx) / SIZE); i <= Math.floor(Math.max(ax, bx) / SIZE); i++)
        for (let j = Math.floor(Math.min(ay, by) / SIZE); j <= Math.floor(Math.max(ay, by) / SIZE); j++) {
          const key = keyOf(i, j);
          const list = segs.get(key);
          if (list) list.push(li, k / 2);
          else segs.set(key, [li, k / 2]);
        }
    }
  });
  const seg = (li: number, k: number) => lines[li].pts.slice(k * 2, k * 2 + 4);
  const done = new Set<string>();
  for (const list of segs.values()) {
    for (let p = 0; p < list.length; p += 2)
      for (let q = p + 2; q < list.length; q += 2) {
        const [li, ki, lj, kj] = [list[p], list[p + 1], list[q], list[q + 1]];
        if (li === lj && Math.abs(ki - kj) <= 1) continue;
        const id = `${li}:${ki}:${lj}:${kj}`;
        if (done.has(id)) continue;
        done.add(id);
        const [ax, ay, bx, by] = seg(li, ki);
        const [cx, cy, dx, dy] = seg(lj, kj);
        const ex = bx - ax;
        const ey = by - ay;
        const fx = dx - cx;
        const fy = dy - cy;
        const den = ex * fy - ey * fx;
        if (Math.abs(den) > 1e-9) {
          const t = ((cx - ax) * fy - (cy - ay) * fx) / den;
          const u = ((cx - ax) * ey - (cy - ay) * ex) / den;
          if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) {
            cuts[li].push(ki + t);
            cuts[lj].push(kj + u);
          }
        }
      }
  }
  // Ends that stop on (or just short of) another line: a T junction.
  lines.forEach((l, li) => {
    for (const end of [0, l.pts.length / 2 - 1]) {
      const x = l.pts[end * 2];
      const y = l.pts[end * 2 + 1];
      const cand = segs.get(keyOf(Math.floor(x / SIZE), Math.floor(y / SIZE))) ?? [];
      let best: [number, number, number] | null = null;
      let bd = TOL;
      for (let p = 0; p < cand.length; p += 2) {
        const [lj, kj] = [cand[p], cand[p + 1]];
        if (lj === li && Math.abs(kj - Math.min(end, l.pts.length / 2 - 2)) <= 1) continue;
        const [cx, cy, dx, dy] = seg(lj, kj);
        const len2 = (dx - cx) ** 2 + (dy - cy) ** 2;
        if (!len2) continue;
        const u = Math.max(0, Math.min(1, ((x - cx) * (dx - cx) + (y - cy) * (dy - cy)) / len2));
        const d = Math.hypot(cx + (dx - cx) * u - x, cy + (dy - cy) * u - y);
        if (d < bd) {
          bd = d;
          best = [lj, kj, u];
        }
      }
      if (!best) continue;
      const [lj, kj, u] = best;
      const [cx, cy, dx, dy] = seg(lj, kj);
      l.pts[end * 2] = cx + (dx - cx) * u;
      l.pts[end * 2 + 1] = cy + (dy - cy) * u;
      cuts[lj].push(kj + u);
    }
  });
  // Nodes, merged where they nearly meet, and edges between them.
  const nodes: number[] = [];
  const nodeGrid = new Map<number, number[]>();
  const nodeAt = (x: number, y: number) => {
    const i = Math.floor(x / 4);
    const j = Math.floor(y / 4);
    for (let a = i - 1; a <= i + 1; a++)
      for (let b = j - 1; b <= j + 1; b++)
        for (const v of nodeGrid.get(keyOf(a, b)) ?? []) if (Math.hypot(nodes[v * 2] - x, nodes[v * 2 + 1] - y) < TOL) return v;
    const v = nodes.length / 2;
    nodes.push(x, y);
    const k = keyOf(i, j);
    const list = nodeGrid.get(k);
    if (list) list.push(v);
    else nodeGrid.set(k, [v]);
    return v;
  };
  const point = (p: number[], s: number): [number, number] => {
    const k = Math.min(Math.floor(s), p.length / 2 - 2);
    const t = s - k;
    return [p[k * 2] + (p[k * 2 + 2] - p[k * 2]) * t, p[k * 2 + 1] + (p[k * 2 + 3] - p[k * 2 + 1]) * t];
  };
  const edges: GraphEdge[] = [];
  lines.forEach((l, li) => {
    const at = [...new Set(cuts[li].map((v) => Math.round(v * 1e6) / 1e6))].sort((a, b) => a - b);
    for (let c = 1; c < at.length; c++) {
      const [s0, s1] = [at[c - 1], at[c]];
      const pts = [...point(l.pts, s0)];
      for (let k = Math.floor(s0) + 1; k <= Math.ceil(s1) - 1; k++) if (k > s0 && k < s1) pts.push(l.pts[k * 2], l.pts[k * 2 + 1]);
      pts.push(...point(l.pts, s1));
      const a = nodeAt(pts[0], pts[1]);
      const b = nodeAt(pts[pts.length - 2], pts[pts.length - 1]);
      if (a === b) continue;
      pts[0] = nodes[a * 2];
      pts[1] = nodes[a * 2 + 1];
      pts[pts.length - 2] = nodes[b * 2];
      pts[pts.length - 1] = nodes[b * 2 + 1];
      edges.push({ a, b, pts, cls: l.cls, main: l.main });
    }
  });
  return { nodes, edges };
}

/** How many edges meet at each node. */
export function degrees(g: Graph): Int32Array {
  const deg = new Int32Array(g.nodes.length / 2);
  for (const e of g.edges) {
    deg[e.a]++;
    deg[e.b]++;
  }
  return deg;
}

/** The direction an edge leaves a node in, measured to a point some way along it. */
function leaving(e: GraphEdge, v: number): [number, number] {
  const p = e.a === v ? e.pts : reverse(e.pts);
  let k = 2;
  while (k + 2 < p.length && Math.hypot(p[k] - p[0], p[k + 1] - p[1]) < 8) k += 2;
  const dx = p[k] - p[0];
  const dy = p[k + 1] - p[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dx / l, dy / l];
}

/** The old town's label, whose quiet streets are lanes. */
const OLD = LABELS.indexOf('old');
const RANK: Record<string, number> = { primary: 4, secondary: 3, tertiary: 2, minor: 1 };
const weaker = (e: GraphEdge, f: GraphEdge) => (e.main !== f.main ? !e.main : RANK[e.cls] !== RANK[f.cls] ? RANK[e.cls] < RANK[f.cls] : lengthOf(e.pts) < lengthOf(f.pts));

/**
 * Clean the graph until §10.5's rules hold: no edges under 10 m, junctions at least 20 m apart,
 * no dead ends under 25 m, no junction angle under 35°, and one connected network (pieces are
 * joined over dry ground or by a short bridge, or dropped).
 */
export function clean(g: Graph, water: (x: number, y: number) => boolean, openLand?: (x: number, y: number) => boolean): Graph {
  const pass = () => {
    let changed = false;
    // Parallel duplicates and loops.
    const seen = new Map<string, GraphEdge>();
    g.edges = g.edges.filter((e) => {
      if (e.a === e.b) return (changed = true) && false;
      const k = e.a < e.b ? `${e.a},${e.b}` : `${e.b},${e.a}`;
      const o = seen.get(k);
      if (!o) {
        seen.set(k, e);
        return true;
      }
      changed = true;
      if (weaker(o, e)) {
        Object.assign(o, e);
      }
      return false;
    });
    let deg = degrees(g);
    // Short edges, and junctions too close together, collapse to their middle: as many as
    // touch no other collapsing edge at once, then every edge is moved onto the merged nodes.
    const merged = Int32Array.from({ length: g.nodes.length / 2 }, (_, i) => i);
    const busy = new Uint8Array(merged.length);
    for (const e of g.edges) {
      if (e.a === e.b || busy[e.a] || busy[e.b]) continue;
      const len = lengthOf(e.pts);
      if (len >= RULES.edge && !(len < RULES.junctions && deg[e.a] >= 3 && deg[e.b] >= 3)) continue;
      busy[e.a] = busy[e.b] = 1;
      g.nodes[e.a * 2] = (g.nodes[e.a * 2] + g.nodes[e.b * 2]) / 2;
      g.nodes[e.a * 2 + 1] = (g.nodes[e.a * 2 + 1] + g.nodes[e.b * 2 + 1]) / 2;
      merged[e.b] = e.a;
      changed = true;
    }
    for (const f of g.edges) {
      f.a = merged[f.a];
      f.b = merged[f.b];
      if (busy[f.a]) [f.pts[0], f.pts[1]] = [g.nodes[f.a * 2], g.nodes[f.a * 2 + 1]];
      if (busy[f.b]) [f.pts[f.pts.length - 2], f.pts[f.pts.length - 1]] = [g.nodes[f.b * 2], g.nodes[f.b * 2 + 1]];
    }
    g.edges = g.edges.filter((e) => e.a !== e.b);
    deg = degrees(g);
    // Short dead ends.
    g.edges = g.edges.filter((e) => {
      const dead = (deg[e.a] === 1) !== (deg[e.b] === 1) && lengthOf(e.pts) < RULES.deadEnd && !e.main;
      if (dead) changed = true;
      return !dead;
    });
    deg = degrees(g);
    // Sharp angles at junctions and bends: the weaker of the two edges goes.
    const at: number[][] = Array.from({ length: g.nodes.length / 2 }, () => []);
    g.edges.forEach((e, i) => {
      at[e.a].push(i);
      at[e.b].push(i);
    });
    const drop = new Set<number>();
    const limit = Math.cos((RULES.angle * Math.PI) / 180);
    for (let v = 0; v < at.length; v++) {
      const list = at[v].filter((i) => !drop.has(i));
      for (let p = 0; p < list.length; p++)
        for (let q = p + 1; q < list.length; q++) {
          const [ux, uy] = leaving(g.edges[list[p]], v);
          const [wx, wy] = leaving(g.edges[list[q]], v);
          if (ux * wx + uy * wy <= limit) continue;
          drop.add(weaker(g.edges[list[p]], g.edges[list[q]]) ? list[p] : list[q]);
          changed = true;
        }
    }
    g.edges = g.edges.filter((_, i) => !drop.has(i));
    return changed;
  };
  for (let round = 0; round < 16 && pass(); round++);
  join(g, water, openLand);
  for (let round = 0; round < 4 && pass(); round++);
  // Drop any pieces still beyond reach or cut off when cleaning the new junctions.
  keepLargest(g);
  compact(g);
  return g;
}

/** Pieces of the network, as a component number per node (−1 for nodes no edge uses). */
function components(g: Graph): Int32Array {
  const comp = new Int32Array(g.nodes.length / 2).fill(-1);
  const adj: number[][] = Array.from({ length: comp.length }, () => []);
  for (const e of g.edges) {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }
  let next = 0;
  for (let v = 0; v < comp.length; v++) {
    if (comp[v] >= 0 || !adj[v].length) continue;
    const list = [v];
    comp[v] = next;
    for (let q = 0; q < list.length; q++) for (const u of adj[list[q]]) if (comp[u] < 0) {
      comp[u] = next;
      list.push(u);
    }
    next++;
  }
  return comp;
}

/** Split a street into contiguous wet and dry runs, sharing the vertex at each bank. */
function bankRuns(pts: number[], water: (x: number, y: number) => boolean) {
  const runs = [{ pts: pts.slice(0, 2), wet: water(pts[0], pts[1]) }];
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2], ay = pts[i - 1], dx = pts[i] - ax, dy = pts[i + 1] - ay;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2));
    for (let s = 1; s <= steps; s++) {
      const x = ax + (dx * s) / steps, y = ay + (dy * s) / steps;
      const wet = water(x, y);
      const run = runs[runs.length - 1];
      if (wet !== run.wet) {
        run.pts.push(x, y);
        runs.push({ pts: [x, y], wet });
      } else if (s === steps) run.pts.push(x, y);
    }
  }
  return runs;
}

/** Continue a lane out of a dead end, or turn off a through street at a junction.
 * Limit the turn towards the destination so a short approach never doubles back. */
function approachAngle(arms: [number, number][], heading: number): number {
  let best = Infinity;
  for (const [dx, dy] of arms) {
    const angle = Math.atan2(dy, dx) - heading;
    for (const turn of arms.length === 1 ? [Math.PI] : [Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const offset = Math.atan2(Math.sin(angle + turn), Math.cos(angle + turn));
      if (Math.abs(offset) < Math.abs(best)) best = offset;
    }
  }
  return Math.max(-Math.PI / 2, Math.min(Math.PI / 2, best));
}

/** Lay a country lane between the bearings of the streets it meets, sampled in ground metres. */
function countryLane(x: number, y: number, bx: number, by: number, from: [number, number][], to: [number, number][]): number[] {
  const dx = bx - x, dy = by - y, distance = Math.hypot(dx, dy);
  const heading = Math.atan2(dy, dx);
  const a = heading + approachAngle(from, heading);
  const b = heading + Math.PI + approachAngle(to, heading + Math.PI);
  const reach = distance * 0.4;
  const ax = reach * Math.cos(a), ay = reach * Math.sin(a);
  const ex = reach * Math.cos(b), ey = reach * Math.sin(b);
  const steps = Math.ceil(distance / 8);
  const pts = [x, y];
  for (let i = 1; i < steps; i++) {
    const t = i / steps, u = 1 - t;
    const advance = t * t * (3 - 2 * t);
    pts.push(x + advance * dx + 3 * t * u * (u * ax + t * ex),
      y + advance * dy + 3 * t * u * (u * ay + t * ey));
  }
  pts.push(bx, by);
  return pts;
}

/** Join nearby street networks on dry ground where possible, or over a single stretch of water. */
function join(g: Graph, water: (x: number, y: number) => boolean, openLand?: (x: number, y: number) => boolean): void {
  const REACH = 250;
  const comp = components(g);
  const size = new Map<number, number>();
  for (const e of g.edges) size.set(comp[e.a], (size.get(comp[e.a]) ?? 0) + lengthOf(e.pts));
  const main = [...size].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  if (main === undefined) return;
  // The main network's nodes on a grid as big as the reach, so each search looks at nine cells.
  const cells = new Map<number, number[]>();
  const cellKey = (x: number, y: number) => (Math.floor(x / REACH) + 32768) * 65536 + Math.floor(y / REACH) + 32768;
  const addNode = (v: number) => {
    const k = cellKey(g.nodes[v * 2], g.nodes[v * 2 + 1]);
    const l = cells.get(k);
    if (l) l.push(v);
    else cells.set(k, [v]);
  };
  for (let v = 0; v < comp.length; v++) if (comp[v] === main) addNode(v);
  const pieces = new Map<number, number[]>();
  for (let v = 0; v < comp.length; v++) if (comp[v] >= 0 && comp[v] !== main) (pieces.get(comp[v]) ?? pieces.set(comp[v], []).get(comp[v])!).push(v);
  if (!pieces.size) return;
  let addedBridge = false, crossedStreet = false;
  const bridgeSpacing = 150;
  const bridges = new Near(bridgeSpacing);
  const arms: [number, number][][] = Array.from({ length: comp.length }, () => []);
  for (const e of g.edges) {
    for (const v of [e.a, e.b]) arms[v].push(leaving(e, v));
  }
  const limit = Math.cos(RULES.angle * Math.PI / 180);
  const bestLink = (nodes: number[]) => {
    let best: { v: number; u: number; pts: number[]; span?: number[]; cost: number } | undefined;
    const consider = (v: number, u: number, x: number, y: number) => {
      const bx = g.nodes[u * 2], by = g.nodes[u * 2 + 1];
      const d = Math.hypot(bx - x, by - y);
      if (d > REACH || (best && d >= best.cost)) return;
      const pts = [x, y, bx, by];
      const runs = bankRuns(pts, water);
      if (runs[0].wet || runs[runs.length - 1].wet) return;
      if (runs.length === 1) {
        // A gap through several blocks of open land has room for a sweeping approach.
        if (openLand && d >= 75 && [0.25, 0.5, 0.75].every(t => openLand(x + t * (bx - x), y + t * (by - y)))) {
          const lane = countryLane(x, y, bx, by, arms[v], arms[u]);
          // Tighten the bend beside water. The straight alignment is already known to be dry.
          for (let attempt = 0; attempt < 3; attempt++) {
            if (bankRuns(lane, water).length === 1) {
              const cost = lengthOf(lane);
              if (!best || cost < best.cost) best = { v, u, pts: lane, cost };
              return;
            }
            for (let i = 2; i < lane.length - 2; i += 2) {
              const t = i / (lane.length - 2);
              lane[i] = (lane[i] + x + t * (bx - x)) / 2;
              lane[i + 1] = (lane[i + 1] + y + t * (by - y)) / 2;
            }
          }
        }
        best = { v, u, pts, cost: d };
        return;
      }
      if (runs.length !== 3) return;
      const span = runs[1].pts;
      // Every dry link costs less than a bridge. Prefer a short deck and leave at
      // least 150 m between crossings so adjacent streets share the same bridge.
      const cost = REACH + d + lengthOf(span);
      if (best && cost >= best.cost) return;
      const ux = (bx - x) / d, uy = (by - y) / d;
      if (arms[v].some(([dx, dy]) => dx * ux + dy * uy > limit) ||
          arms[u].some(([dx, dy]) => -dx * ux - dy * uy > limit)) return;
      if (bridges.any(span[0], span[1], bridgeSpacing) || bridges.any(span[2], span[3], bridgeSpacing)) return;
      // The approaches may form new junctions on land. Keep the deck clear.
      if (g.edges.some(e => {
        const p = e.pts;
        for (let k = 2; k < p.length; k += 2) {
          if (meet(span[0], span[1], span[2], span[3], p[k - 2], p[k - 1], p[k], p[k + 1])) return true;
        }
        return false;
      })) return;
      best = { v, u, pts, span, cost };
    };
    for (const v of nodes) {
      const x = g.nodes[v * 2], y = g.nodes[v * 2 + 1];
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const u of cells.get(cellKey(x + i * REACH, y + j * REACH)) ?? []) consider(v, u, x, y);
    }
    return best;
  };
  let remaining: number;
  do {
    remaining = pieces.size;
    for (const [piece, nodes] of pieces) {
      const best = bestLink(nodes);
      if (!best) continue;
      const { v, u, pts, span } = best;
      const edge = { a: v, b: u, pts, cls: 'minor', main: false };
      // Most approaches share only their end nodes. Rebuild junctions if a bend meets
      // another street on its way across the gap.
      if (pts.length > 4 && !crossedStreet) crossedStreet = g.edges.some(e => {
        for (let i = 2; i < pts.length; i += 2) {
          const p = e.pts;
          for (let j = 2; j < p.length; j += 2) {
            if (i === 2 && ((j === 2 && e.a === v) || (j === p.length - 2 && e.b === v))) continue;
            if (i === pts.length - 2 && ((j === 2 && e.a === u) || (j === p.length - 2 && e.b === u))) continue;
            if (meet(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], p[j - 2], p[j - 1], p[j], p[j + 1])) return true;
          }
        }
        return false;
      });
      g.edges.push(edge);
      for (const n of [v, u]) arms[n].push(leaving(edge, n));
      if (span) {
        bridges.add(span, 0);
        addedBridge = true;
      }
      for (const w of nodes) addNode(w);
      pieces.delete(piece);
    }
    // Once a bridge opens the far bank, an earlier piece may now have a dry route to it.
  } while (addedBridge && pieces.size && pieces.size < remaining);
  // Split any streets met by the new approaches at their junctions before cleaning again.
  if (addedBridge || crossedStreet) Object.assign(g, planar(g.edges));
}

/** Keep only the largest piece of the network. */
function keepLargest(g: Graph): void {
  const comp = components(g);
  const size = new Map<number, number>();
  for (const e of g.edges) size.set(comp[e.a], (size.get(comp[e.a]) ?? 0) + lengthOf(e.pts));
  const main = [...size].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  g.edges = g.edges.filter((e) => comp[e.a] === main);
}

/** Drop nodes no edge uses, renumbering the rest. */
function compact(g: Graph): void {
  const map = new Int32Array(g.nodes.length / 2).fill(-1);
  const nodes: number[] = [];
  for (const e of g.edges)
    for (const v of [e.a, e.b])
      if (map[v] < 0) {
        map[v] = nodes.length / 2;
        nodes.push(g.nodes[v * 2], g.nodes[v * 2 + 1]);
      }
  for (const e of g.edges) {
    e.a = map[e.a];
    e.b = map[e.b];
  }
  g.nodes = nodes;
}

/**
 * Rank the streets by how many routes between the network's ends use them (a sampled
 * betweenness): main roads keep their class, the busiest of the rest become tertiary, and the
 * quiet streets of the old town become lanes.
 */
function rank(g: Graph, z: Zones, lanes: boolean): void {
  const N = g.nodes.length / 2;
  if (!N) return;
  const adj: [number, number, number][][] = Array.from({ length: N }, () => []);
  g.edges.forEach((e, i) => {
    const w = lengthOf(e.pts) * (e.main ? 0.7 : 1);
    adj[e.a].push([e.b, w, i]);
    adj[e.b].push([e.a, w, i]);
  });
  // Ends near the edge of the plan, where routes come in from beyond it.
  const margin = 4 * z.cell + 20;
  const x1 = z.x0 + z.W * z.cell;
  const y1 = z.y0 + z.H * z.cell;
  let ends = [...Array(N).keys()].filter((v) => {
    const [x, y] = [g.nodes[v * 2], g.nodes[v * 2 + 1]];
    return adj[v].length === 1 && (x < z.x0 + margin || y < z.y0 + margin || x > x1 - margin || y > y1 - margin);
  });
  if (ends.length < 4) ends = [...Array(N).keys()].filter((v) => adj[v].length === 1);
  if (ends.length < 2) return;
  const step = Math.max(1, Math.floor(ends.length / 24));
  const sample = ends.filter((_, i) => i % step === 0).slice(0, 24);
  const use = new Float64Array(g.edges.length);
  for (const s of sample) {
    const dist = new Float64Array(N).fill(Infinity);
    const via = new Int32Array(N).fill(-1);
    const heap = new Heap();
    dist[s] = 0;
    heap.push(0, s);
    while (heap.size) {
      const [d, v] = heap.pop();
      if (d > dist[v]) continue;
      for (const [u, w, i] of adj[v])
        if (d + w < dist[u]) {
          dist[u] = d + w;
          via[u] = i;
          heap.push(d + w, u);
        }
    }
    for (const t of sample) {
      if (t === s || !Number.isFinite(dist[t])) continue;
      for (let v = t; v !== s && via[v] >= 0; ) {
        const e = g.edges[via[v]];
        use[via[v]]++;
        v = e.a === v ? e.b : e.a;
      }
    }
  }
  const order = g.edges.map((_, i) => i).filter((i) => !g.edges[i].main && use[i] > 0).sort((a, b) => use[b] - use[a] || a - b);
  const busy = new Set(order.slice(0, Math.ceil(order.length * 0.15)));
  g.edges.forEach((e, i) => {
    if (!e.main) e.cls = busy.has(i) ? 'tertiary' : 'minor';
    // In the old town, the quiet streets are lanes: narrow, with no pavement to speak of.
    if (lanes && e.cls === 'minor' && labelOfMid(e.pts) === OLD) e.cls = 'service';
  });
  function labelOfMid(p: number[]): number {
    const k = (p.length >> 2) * 2;
    const i = Math.floor((p[k] - z.x0) / z.cell);
    const j = Math.floor((p[k + 1] - z.y0) / z.cell);
    return i < 0 || j < 0 || i >= z.W || j >= z.H ? -1 : z.label[j * z.W + i];
  }
}

/**
 * The graph as ways: edges chained through plain bends into longer streets of one class, and
 * cut where they cross water, the crossings marked as bridges.
 */
function waysOf(g: Graph, water: (x: number, y: number) => boolean, roundabouts: Roundabout[] = []): Way[] {
  const deg = degrees(g);
  // A roundabout goes in whole, as one closed way, so the renderer finds it and plants its island.
  const used = Uint8Array.from(g.edges, (e) => (e.ring ? 1 : 0));
  const at: number[][] = Array.from({ length: g.nodes.length / 2 }, () => []);
  g.edges.forEach((e, i) => {
    at[e.a].push(i);
    at[e.b].push(i);
  });
  const chains: { pts: number[]; cls: string }[] = [];
  g.edges.forEach((e0, i0) => {
    if (used[i0]) return;
    used[i0] = 1;
    let pts = e0.pts.slice();
    // Extend both ways through nodes where only one other edge of the same class goes on.
    for (const forward of [true, false]) {
      let v = forward ? e0.b : e0.a;
      for (;;) {
        if (deg[v] !== 2) break;
        const nxt = at[v].find((i) => !used[i] && g.edges[i].cls === e0.cls);
        if (nxt === undefined) break;
        used[nxt] = 1;
        const e = g.edges[nxt];
        const p = e.a === v ? e.pts : reverse(e.pts);
        pts = forward ? [...pts, ...p.slice(2)] : [...reverse(p).slice(0, -2), ...pts];
        v = e.a === v ? e.b : e.a;
      }
    }
    // A closed chain would read as a roundabout to the renderer, which plants its middle; a
    // loop here is a street round a block, so it goes in as two halves.
    if (pts.length >= 8 && Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]) < 0.5) {
      const m = (pts.length >> 2) * 2;
      chains.push({ pts: pts.slice(0, m + 2), cls: e0.cls }, { pts: pts.slice(m), cls: e0.cls });
    } else chains.push({ pts, cls: e0.cls });
  });
  const ways: Way[] = roundabouts.map((o) => ({ pts: o.pts, kind: 'road', width: ROAD_WIDTH[o.cls] ?? ROAD_WIDTH.minor, cls: o.cls }));
  for (const c of chains) {
    for (const { pts, wet } of bankRuns(c.pts, water)) {
      if (pts.length >= 4) ways.push({ pts, kind: 'road', width: ROAD_WIDTH[c.cls] ?? ROAD_WIDTH.minor, cls: c.cls, bridge: wet || undefined });
    }
  }
  return ways;
}

/** A street tram follows one long avenue serving a town centre, with its own strip between the traffic lanes. */
export function tramRoute(ways: Way[], cores: [number, number][]): Way | null {
  if (!cores.length) return null;
  const avenues = ways.filter(w => w.kind === 'road' && !w.bridge && w.width >= 10 && w.pts.length >= 4);
  const routes = joinedTracks(avenues);
  let best: (typeof routes)[number] | undefined;
  let bestScore = 0;
  for (const track of routes) {
    if (track.L < 260) continue;
    // Count route metres serving the built-up cores. A long road on the outskirts may serve none.
    let score = 0;
    const p = track.pts;
    for (let i = 2; i < p.length; i += 2) {
      const x = (p[i] + p[i - 2]) / 2, y = (p[i + 1] + p[i - 1]) / 2;
      let distance = Infinity;
      for (const [cx, cy] of cores) distance = Math.min(distance, Math.hypot(x - cx, y - cy));
      score += (track.cum[i / 2] - track.cum[i / 2 - 1]) * Math.max(0, 1 - distance / 450);
    }
    if (score > bestScore) {
      best = track;
      bestScore = score;
    }
  }
  if (!best || bestScore < 100) return null;
  for (const street of best.pieces) street.streetTram = true;
  return { pts: best.pts, kind: 'rail', cls: 'transit', sub: 'tram', streetTram: true, width: 2 };
}

/** Breaches of §10.5's rules in a street graph, in words; empty when it keeps them all. */
export function streetRules(g: Graph): string[] {
  const out: string[] = [];
  const deg = degrees(g);
  const comp = components(g);
  const pieces = new Set([...comp].filter((c) => c >= 0)).size;
  if (pieces > 1) out.push(`${pieces} separate networks`);
  const at: number[][] = Array.from({ length: deg.length }, () => []);
  g.edges.forEach((e, i) => {
    at[e.a].push(i);
    at[e.b].push(i);
    const len = lengthOf(e.pts);
    if (e.ring) return;
    if (len < RULES.edge - 1e-6) out.push(`edge of ${len.toFixed(1)} m`);
    if (!e.main && (deg[e.a] === 1) !== (deg[e.b] === 1) && len < RULES.deadEnd - 1e-6) out.push(`dead end of ${len.toFixed(1)} m`);
    if (len < RULES.junctions - 1e-6 && deg[e.a] >= 3 && deg[e.b] >= 3) out.push(`junctions ${len.toFixed(1)} m apart`);
  });
  const limit = Math.cos((RULES.angle * Math.PI) / 180);
  for (let v = 0; v < at.length; v++)
    for (let p = 0; p < at[v].length; p++)
      for (let q = p + 1; q < at[v].length; q++) {
        const [ux, uy] = leaving(g.edges[at[v][p]], v);
        const [wx, wy] = leaving(g.edges[at[v][q]], v);
        if (ux * wx + uy * wy > limit + 1e-6) out.push(`angle of ${((Math.acos(Math.min(1, ux * wx + uy * wy)) * 180) / Math.PI).toFixed(0)}° at a node`);
      }
  return out;
}

