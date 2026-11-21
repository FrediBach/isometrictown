/**
 * Floorplans for image mode: plans learnt from real towns (`image-floorplan-data.ts`, made by
 * `npm run floorplans`), and guides that turn footprints to follow the picture's contours.
 */
import type { Camera } from './camera';
import { centre } from './image-check';
import { PLAN_GRID, PLANS } from './image-floorplan-data';
import type { Target } from './image-read';
import type { Label } from './image-tone';
import { traceLines } from './image-water';

/** A learnt plan is used only where its shortest wall is at least this long on paper, mm; the plain box stands in for it otherwise. */
export const PLAN_JOG_MM = 0.6;

/** The shortest wall of a unit plan stretched to `W` × `D`, m. */
function shortest(ring: readonly number[], W: number, D: number): number {
  let min = Infinity;
  for (let k = 0; k < ring.length; k += 2) {
    const j = (k + 2) % ring.length;
    min = Math.min(min, Math.abs(ring[j] - ring[k]) * W + Math.abs(ring[j + 1] - ring[k + 1]) * D);
  }
  return min / PLAN_GRID;
}

/**
 * A plan for a building of `label`, as a counter-clockwise ring in the unit box with the street
 * along y = 0, or null for the plain box. Each learnt plan is weighed by how often the zone
 * builds it and, for a detached building `W` wide along the street and `D` deep (m), by how near
 * its usual proportions and size are. For a house in a row, `D` is the main range's depth and
 * only the frontage is weighed: the plan's rear wings reach further back, as `depth` gives.
 * `pick` and `flip` are hashes in [0, 1); `flip` below a half mirrors the plan.
 */
export function learntPlan(label: Label, W: number, D: number, mmPerMetre: number, row: boolean, pick: number, flip: number): { ring: number[]; depth: number } | null {
  const plans = PLANS[label];
  if (!plans?.length) return null;
  const box = plans.find((p) => p.ring.length === 8);
  const boxAspect = box?.aspect ?? 1;
  const weights = plans.map((p) => {
    const span = row ? Math.sqrt(p.area / p.aspect) : 0;
    const depth = row ? (D * p.aspect) / boxAspect : D;
    if (p !== box && shortest(p.ring, W, depth) * mmPerMetre < PLAN_JOG_MM) return 0;
    const sd = Math.max(0.3, p.spread);
    // A row's plain range suits any frontage; its other plans only frontages near their own.
    const shape = row ? (p === box ? 0 : Math.log(W / span) / 0.4) : Math.log(D / W / p.aspect) / sd;
    const size = row ? 0 : Math.log((W * D) / p.area) / 0.9;
    return p.share * Math.exp(-0.5 * (shape * shape + size * size));
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let at = pick * total;
  let k = 0;
  while (k < plans.length - 1 && at >= weights[k]) at -= weights[k++];
  const p = plans[k];
  if (p === box) return null;
  const ring: number[] = [];
  if (flip < 0.5) for (let i = p.ring.length - 2; i >= 0; i -= 2) ring.push(1 - p.ring[i] / PLAN_GRID, p.ring[i + 1] / PLAN_GRID);
  else for (let i = 0; i < p.ring.length; i += 2) ring.push(p.ring[i] / PLAN_GRID, p.ring[i + 1] / PLAN_GRID);
  // Start at the front corner furthest left, so the first wall runs along the street as callers expect.
  let s = 0;
  for (let i = 2; i < ring.length; i += 2) if (ring[i + 1] < ring[s + 1] || (ring[i + 1] === ring[s + 1] && ring[i] < ring[s])) s = i;
  return { ring: [...ring.slice(s), ...ring.slice(0, s)], depth: row ? (D * p.aspect) / boxAspect : D };
}

/** How much of its box a unit plan covers. */
export function planFill(ring: readonly number[]): number {
  let a = 0;
  for (let k = 0; k < ring.length; k += 2) {
    const j = (k + 2) % ring.length;
    a += ring[k] * ring[j + 1] - ring[j] * ring[k + 1];
  }
  return a / 2;
}

type Guide = { x: number; y: number; nx: number; ny: number };
const CELL = 8;

/** Nearby tangents to sustained image contours, indexed in sheet millimetres. */
export class FloorplanGuides {
  private cells = new Map<number, Guide[]>();
  /** How strongly the guides act at a sheet position, mm: the setting's, or as masks set it. */
  private strength: (sx: number, sy: number) => number;

  constructor(t: Target, private cam: Camera, strength: number | ((sx: number, sy: number) => number)) {
    this.strength = typeof strength === 'number' ? () => strength : strength;
    const clear = (i: number) => t.weight[i] >= 0.5 && t.coherence[i] >= 0.35;
    const lines = [...traceLines(i => clear(i) && t.edge[i] >= 0.3, t, 6),
      ...traceLines(i => clear(i) && !!t.ridge[i], t, 6)];
    for (const p of lines) {
      // Measure the chord over a 6 mm window. A compact squiggle can be long without
      // having a consistent direction. Sample by distance so bends and straight runs weigh alike.
      const points: number[][] = [];
      let next = 0;
      for (let k = 2; k < p.length; k += 2) {
        const dx = p[k] - p[k - 2], dy = p[k + 1] - p[k - 1], len = Math.hypot(dx, dy);
        if (!len) continue;
        for (; next <= len; next++) points.push([p[k - 2] + next * dx / len, p[k - 1] + next * dy / len]);
        next -= len;
      }
      for (let i = 3; i + 3 < points.length; i++) {
        const [x, y] = points[i];
        const dx = points[i + 3][0] - points[i - 3][0], dy = points[i + 3][1] - points[i - 3][1];
        const len = Math.hypot(dx, dy);
        if (len < 5.4) continue;
        // The tensor gives a finer angle than a staircase of half-millimetre pixels.
        const at = Math.floor((y - t.y0) / t.cell) * t.W + Math.floor((x - t.x0) / t.cell);
        const tx = Math.cos(t.dir[at]), ty = Math.sin(t.dir[at]);
        const local = clear(at) && Math.abs(tx * dx + ty * dy) > 0.97 * len;
        const key = this.key(x, y);
        const bucket = this.cells.get(key) ?? [];
        bucket.push({ x, y, nx: local ? -ty : -dy / len, ny: local ? tx : dx / len });
        this.cells.set(key, bucket);
      }
    }
  }

  private key(x: number, y: number) {
    return Math.floor(x / CELL) * 65536 + Math.floor(y / CELL);
  }

  private near(x: number, y: number, strength: number) {
    const reach = 4 + 10 * strength;
    let best = reach * reach;
    let found: Guide | undefined;
    for (let i = Math.floor((x - reach) / CELL); i <= Math.floor((x + reach) / CELL); i++)
      for (let j = Math.floor((y - reach) / CELL); j <= Math.floor((y + reach) / CELL); j++)
        for (const g of this.cells.get(i * 65536 + j) ?? []) {
          const d = (x - g.x) ** 2 + (y - g.y) ** 2;
          if (d < best) { best = d; found = g; }
        }
    return found;
  }

  /** Turn a detached house as a whole, easing the turn where the plot is tight. */
  detached(ring: number[], fits: (p: number[]) => boolean): number[] {
    const [cx, cy] = centre(ring);
    const x = this.cam.sx(cx, cy), y = this.cam.sy(cx, cy, 0);
    const strength = this.strength(x, y);
    if (!(strength > 0)) return ring;
    const g = this.near(x, y, strength);
    if (!g) return ring;
    const [gx, gy] = this.cam.ground(x + g.ny, y - g.nx);
    const turn = Math.atan2(gy - cy, gx - cx) - Math.atan2(ring[3] - ring[1], ring[2] - ring[0]);
    const nearest = turn - Math.round(turn / (Math.PI / 2)) * (Math.PI / 2);
    for (const share of [1, 0.5, 0.25]) {
      const a = nearest * strength * share, cos = Math.cos(a), sin = Math.sin(a);
      const p: number[] = [];
      for (let k = 0; k < ring.length; k += 2) {
        const dx = ring[k] - cx, dy = ring[k + 1] - cy;
        p.push(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
      }
      if (fits(p)) return p;
    }
    return ring;
  }

  /** Fit the back of a row to a contour while keeping the street front and party-wall directions. */
  row(ring: number[], fits: (p: number[]) => boolean): number[] {
    const half = ring.length / 2;
    const [cx, cy] = centre(ring.slice(half));
    const strength = this.strength(this.cam.sx(cx, cy), this.cam.sy(cx, cy, 0));
    if (!(strength > 0)) return ring;
    const g = this.near(this.cam.sx(cx, cy), this.cam.sy(cx, cy, 0), strength);
    if (!g) return ring;
    const p = ring.slice();
    for (let k = 0; k < half; k += 2) {
      const rear = ring.length - k - 2;
      const dx = ring[rear] - ring[k], dy = ring[rear + 1] - ring[k + 1];
      const x = this.cam.sx(ring[k], ring[k + 1]), y = this.cam.sy(ring[k], ring[k + 1], 0);
      const sx = this.cam.sx(ring[rear], ring[rear + 1]) - x, sy = this.cam.sy(ring[rear], ring[rear + 1], 0) - y;
      const across = sx * g.nx + sy * g.ny;
      if (Math.abs(across) < 0.25 * Math.hypot(sx, sy)) return ring;
      // Intersect each party wall with the contour, keeping a liveable depth on narrow plots.
      const fraction = ((g.x - x) * g.nx + (g.y - y) * g.ny) / across;
      const change = strength * Math.max(-0.4, Math.min(0.65, fraction - 1));
      p[rear] += dx * change;
      p[rear + 1] += dy * change;
    }
    if (fits(p)) return p;
    const eased = p.map((v, i) => (v + ring[i]) / 2);
    return fits(eased) ? eased : ring;
  }
}
