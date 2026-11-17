/**
 * Tuning for image mode (§14 of docs/plans/image-mode.md): the structure gives a believable town
 * at roughly the right tone, and tuning makes it match. Each row of terraces, and each other lot,
 * is a group whose level (how densely and how high it is built) and roof (pitched or flat) may
 * move within limits that Likeness sets; trees are then planted where the drawing is still
 * lighter than the image wants.
 *
 * The predictor is the calibrated materials of §7 laid on a grid of about a millimetre on paper:
 * each cell takes the material of the lot that shows there, at the lot's own level and roof, or
 * else of its zone. It is blurred to arm's length and compared with the target blurred the same
 * way, in OKLab, lightness fully and chroma by Colour. Each group in turn takes the move that
 * lowers the error plus a realism cost the most, for a few sweeps.
 */
import type { Camera } from './camera';
import { pointInRing } from './geo';
import { lotRing, ROWS, type Block, type Lot } from './image-blocks';
import { DARKEST, type Target } from './image-read';
import { blur, BUILT, chromaWeight, hexToLinear, lightnessAt, inksOf, LABELS, material, mix, oklab, paperOf, type Label } from './image-tone';
import { colourCounts, HEIGHT, REFERENCE, type Zones } from './image-zones';
import { hash } from './rng';
import type { Settings } from './settings';

/** Blur of arm's length, mm on paper, as the likeness score's nearer distance. */
const ARM = 1.2;
/** The most sweeps, and the least improvement of a sweep that is worth another. */
const SWEEPS = 6;
const ENOUGH = 0.005;
/** Steps of level a group may take. */
const STEP = 0.1;
/** How far from its zone's level a group may move at full realism, and how much farther at full likeness. */
const REACH: [number, number] = [0.2, 0.8];
/** Realism, per cell, at full realism: for each step of level from the zone's, for a step from a row neighbour's, and for a roof changed from the one chance gave it. */
const AWAY = 0.004;
const SMOOTH = 0.006;
const FLIP = 0.0015;
/** The calibration's pen width, mm: outlines gain ink in proportion to the pen. */
const CAL_NIB = 0.35;

/** How the drawing really came out, per predictor cell read at `at`, blurred by `sigma` mm: OKLab, 3 per cell. */
export type Seen = (at: Int32Array, sigma: number) => Float32Array;

/** The prediction for blocks as they are, with no moves: for the calibration guard and the likeness lab. */
export const predict = (blocks: Block[], z: Zones, target: Target, cam: Camera, set: TuneSettings, box: readonly number[]): Prediction => tune(blocks, z, target, cam, set, box, { moves: false });

/** Settings tuning reads: what changes the tone of what is drawn, and Likeness. */
export type TuneSettings = Pick<Settings, 'scale' | 'tilt' | 'likeness' | 'detail' | 'penWidth' | 'imageColour' | 'mono' | 'pens' | 'customBackground' | 'background' | 'seed' | 'trees'>;

/** The predictor's grid, and what it ended with, for planting trees and for the lab. */
export type Prediction = {
  x0: number;
  y0: number;
  cell: number;
  W: number;
  H: number;
  /** Per cell: the lot that shows there (index into `lots`), or −1 for the zone's own ground; the zone cell under it; and the target cell it is read at (−1 off the sheet). */
  owner: Int32Array;
  ground: Int32Array;
  at: Int32Array;
  lots: Lot[];
  /** Predicted colour, unblurred, and the target, both OKLab, 3 per cell; the weight of each cell. */
  colour: Float32Array;
  target: Float32Array;
  weight: Float32Array;
  /** Predicted coverage of each pen, on average over the cells the image covers, for the calibration guard. */
  pens: number[];
  chroma: number;
  /** The blur, in cells, and a cell's side on paper, mm. */
  sigma: number;
  cellMm: number;
  /** Coverage of each pen for a material, with Detail and pen width applied. */
  cover: (label: Label, level: number, warmth: number) => number[];
  /** The colour of a coverage vector, as the predictor sees it. */
  colourOf: (c: number[]) => [number, number, number];
  /** Mean error before and after tuning, and the sweeps it took. */
  before: number;
  after: number;
  sweeps: number;
};

/**
 * Tune the lots of `blocks` in place: each gets the level and roof (warmth 0 or 1) that make the
 * drawing most like the target, within the realism Likeness asks for. Only lots on ground that
 * shows (`box`) are tuned.
 */
export function tune(blocks: Block[], z: Zones, target: Target, cam: Camera, set: TuneSettings, box: readonly number[], opts: { moves?: boolean; seenBefore?: Seen } = {}): Prediction {
  const { moves = true, seenBefore } = opts;
  const likeness = Math.max(0, Math.min(1, set.likeness));
  const colour = colourCounts(set);
  const chroma = colour ? chromaWeight(set) : 0;
  const seen = colour ? set : { ...set, ...REFERENCE };
  const refDark = lightnessAt('#ffffff', '#000000', DARKEST);
  const paper = hexToLinear(paperOf(seen));
  const inks = inksOf(seen);
  // Textures spaced by Detail gain ink with it, outlines with the pen; tone hatching keeps its tone.
  const rule = [1, set.detail, set.detail, set.detail, set.penWidth / CAL_NIB];
  const cover = (label: Label, level: number, warmth: number) => material(label, level, warmth, set.scale, set.tilt).map((v, k) => Math.min(1, v * rule[k]));
  const colourOf = (c: number[]): [number, number, number] => {
    const rgb = [0, 0, 0];
    mix(paper, inks, seen.mono ? [0, 0, 0, 0, Math.min(1, c.reduce((a, v) => a + v, 0))] : c, rgb);
    const lab: [number, number, number] = [0, 0, 0];
    oklab(rgb[0], rgb[1], rgb[2], lab);
    return lab;
  };
  const memo = new Map<number, [number, number, number]>();
  const colourAt = (k: number, level: number, warmth: number) => {
    const key = (k * 32 + Math.round(level / STEP)) * 2 + (warmth >= 0.5 ? 1 : 0);
    let c = memo.get(key);
    if (!c) memo.set(key, (c = colourOf(cover(LABELS[k], level, warmth >= 0.5 ? 1 : 0))));
    return c;
  };
  const zoneColour = (k: number, level: number, warmth: number) => colourOf(cover(LABELS[k], level, warmth));

  // The grid: about a millimetre on paper, over the ground that shows.
  const cell = Math.max(1, 1 / cam.s);
  const [bx0, by0, bx1, by1] = box;
  const W = Math.max(1, Math.ceil((bx1 - bx0) / cell));
  const H = Math.max(1, Math.ceil((by1 - by0) / cell));
  const n = W * H;
  const sigma = ARM / (cell * cam.s);

  // The target blurred to arm's length, read where each cell's label shows: half its buildings' height up.
  const tL = Float32Array.from(target.L);
  const ta = Float32Array.from(target.a);
  const tb = Float32Array.from(target.b);
  const tw = Float32Array.from(target.weight);
  const tsig = ARM / target.cell;
  for (const v of [tL, ta, tb, tw]) blur(v, target.W, target.H, tsig);
  const tone = colour ? null : Float32Array.from(target.tone);
  if (tone) blur(tone, target.W, target.H, tsig);
  const zoneAt = (x: number, y: number) => {
    const i = Math.floor((x - z.x0) / z.cell);
    const j = Math.floor((y - z.y0) / z.cell);
    return i < 0 || j < 0 || i >= z.W || j >= z.H ? -1 : j * z.W + i;
  };
  const want = new Float32Array(n * 3);
  const weight = new Float32Array(n);
  const ground = new Int32Array(n).fill(-1);
  const at = new Int32Array(n).fill(-1);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      const x = bx0 + (i + 0.5) * cell;
      const y = by0 + (j + 0.5) * cell;
      const zc = zoneAt(x, y);
      ground[c] = zc;
      const lift = zc >= 0 ? (HEIGHT[LABELS[z.label[zc]]] ?? 0) / 2 : 0;
      const tx = Math.floor((cam.sx(x, y) - target.x0) / target.cell);
      const ty = Math.floor((cam.sy(x, y, lift) - target.y0) / target.cell);
      if (tx < 0 || ty < 0 || tx >= target.W || ty >= target.H) continue;
      const t = ty * target.W + tx;
      at[c] = t;
      weight[c] = tw[t];
      want[c * 3] = tone ? refDark + (1 - refDark) * tone[t] : tL[t];
      want[c * 3 + 1] = tone ? 0 : ta[t];
      want[c * 3 + 2] = tone ? 0 : tb[t];
    }

  // Which lot shows in each cell, and the groups: rows of terraces share a roof, other lots have their own.
  const lots: Lot[] = [];
  for (const b of blocks) for (const l of b.lots) lots.push(l);
  const owner = new Int32Array(n).fill(-1);
  const cells: number[][] = lots.map(() => []);
  lots.forEach((l, li) => {
    const ring = lotRing(l);
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let k = 0; k < ring.length; k += 2) [x0, y0, x1, y1] = [Math.min(x0, ring[k]), Math.min(y0, ring[k + 1]), Math.max(x1, ring[k]), Math.max(y1, ring[k + 1])];
    for (let j = Math.max(0, Math.floor((y0 - by0) / cell)); j <= Math.min(H - 1, Math.floor((y1 - by0) / cell)); j++)
      for (let i = Math.max(0, Math.floor((x0 - bx0) / cell)); i <= Math.min(W - 1, Math.floor((x1 - bx0) / cell)); i++) {
        const c = j * W + i;
        if (owner[c] < 0 && pointInRing(bx0 + (i + 0.5) * cell, by0 + (j + 0.5) * cell, ring)) {
          owner[c] = li;
          cells[li].push(c);
        }
      }
  });
  const K = LABELS.indexOf.bind(LABELS);
  const kOf = lots.map((l) => K(l.label));
  const home = lots.map((l) => l.level);
  // The roof chance gave each group, which realism prefers to keep.
  const roofKey = (l: Lot) => (ROWS.has(l.label) ? `${l.block}:${l.side}` : `${l.block}:${l.side}:${l.index}`);
  const roofs = new Map<string, number[]>();
  lots.forEach((l, li) => {
    if (!cells[li].length || !BUILT.has(l.label)) return;
    const key = roofKey(l);
    (roofs.get(key) ?? roofs.set(key, []).get(key)!).push(li);
  });
  const roof = new Uint8Array(lots.length);
  const chance = new Uint8Array(lots.length);
  for (const list of roofs.values()) {
    const l = lots[list[0]];
    const pitched = hash(l.block, ROWS.has(l.label) ? l.side : l.side * 4096 + l.index, set.seed, 14090) < l.warmth ? 1 : 0;
    for (const li of list) roof[li] = chance[li] = pitched;
  }
  const level = Float32Array.from(home);
  // Neighbours along a street side, for the smoothness of a row.
  const nextTo: number[][] = lots.map(() => []);
  const bySide = new Map<string, number[]>();
  lots.forEach((l, li) => {
    const key = `${l.block}:${l.side}`;
    (bySide.get(key) ?? bySide.set(key, []).get(key)!).push(li);
  });
  for (const list of bySide.values()) {
    list.sort((a, b) => lots[a].index - lots[b].index);
    for (let k = 1; k < list.length; k++)
      if (lots[list[k]].index === lots[list[k - 1]].index + 1) {
        nextTo[list[k]].push(list[k - 1]);
        nextTo[list[k - 1]].push(list[k]);
      }
  }

  // The prediction, unblurred.
  const col = new Float32Array(n * 3);
  const paint = (c: number, v: readonly number[]) => {
    col[c * 3] = v[0];
    col[c * 3 + 1] = v[1];
    col[c * 3 + 2] = v[2];
  };
  const groundMemo = new Map<number, [number, number, number]>();
  for (let c = 0; c < n; c++) {
    const li = owner[c];
    if (li >= 0) paint(c, colourAt(kOf[li], level[li], roof[li]));
    else {
      const zc = ground[c];
      if (zc < 0) {
        paint(c, colourOf([0, 0, 0, 0, 0]));
        continue;
      }
      const k = z.label[zc];
      const key = (k * 32 + Math.round(z.level[zc] / STEP)) * 32 + Math.round(z.warmth[zc] * 20);
      let v = groundMemo.get(key);
      if (!v) groundMemo.set(key, (v = zoneColour(k, Math.round(z.level[zc] / STEP) * STEP, Math.round(z.warmth[zc] * 20) / 20)));
      paint(c, v);
    }
  }

  // The residual after blurring, per cell and channel; and its weighted error.
  const res = new Float32Array(n * 3);
  const bias = new Float32Array(n * 3);
  const residual = () => {
    let e = 0;
    let wsum = 0;
    for (let ch = 0; ch < 3; ch++) {
      const plane = new Float32Array(n);
      for (let c = 0; c < n; c++) plane[c] = col[c * 3 + ch];
      blur(plane, W, H, sigma);
      for (let c = 0; c < n; c++) {
        const r = plane[c] + bias[c * 3 + ch] - want[c * 3 + ch];
        res[c * 3 + ch] = r;
        if (weight[c] > 0) e += weight[c] * r * r * (ch ? chroma : 1);
        if (!ch) wsum += weight[c];
      }
    }
    return e / Math.max(1e-9, wsum);
  };
  /** Weighted error over some cells if each moved by `d`. */
  const errorWith = (list: number[], d: readonly number[]) => {
    let e = 0;
    for (const c of list) {
      const w = weight[c];
      if (!w) continue;
      const r0 = res[c * 3] + d[0];
      const r1 = res[c * 3 + 1] + d[1];
      const r2 = res[c * 3 + 2] + d[2];
      e += w * (r0 * r0 + chroma * (r1 * r1 + r2 * r2));
    }
    return e;
  };
  const shift = (list: number[], d: readonly number[]) => {
    for (const c of list)
      for (let ch = 0; ch < 3; ch++) {
        res[c * 3 + ch] += d[ch];
        col[c * 3 + ch] += d[ch];
      }
  };
  const realism = 1 - likeness;
  const reach = REACH[0] + REACH[1] * likeness;
  const away = (li: number, v: number) => (AWAY * realism * Math.abs(v - home[li])) / STEP;
  const smooth = (li: number, v: number) => nextTo[li].reduce((a, o) => a + (SMOOTH * realism * Math.abs(v - level[o])) / STEP, 0);

  // Refining: how the drawing really came out, blurred, less what the predictor made of it, is
  // a bias per cell that every prediction carries from now on.
  if (seenBefore) {
    const real = seenBefore(at, ARM);
    const planes = [0, 1, 2].map((ch) => {
      const v = new Float32Array(n);
      for (let c = 0; c < n; c++) v[c] = col[c * 3 + ch];
      blur(v, W, H, sigma);
      return v;
    });
    for (let c = 0; c < n; c++) if (at[c] >= 0) for (let ch = 0; ch < 3; ch++) bias[c * 3 + ch] = real[c * 3 + ch] - planes[ch][c];
  }
  const before = residual();
  let error = before;
  let sweeps = 0;
  for (; moves && sweeps < SWEEPS; sweeps++) {
    // Roofs: each row or lot tries the other roof, at the levels it has.
    for (const list of roofs.values()) {
      const all = list.flatMap((li) => cells[li]);
      if (!all.length) continue;
      const now = errorWith(all, [0, 0, 0]) + list.reduce((a, li) => a + cells[li].length * FLIP * realism * (roof[li] !== chance[li] ? 1 : 0), 0);
      let flipped = 0;
      for (const li of list) {
        const a = colourAt(kOf[li], level[li], roof[li]);
        const b = colourAt(kOf[li], level[li], 1 - roof[li]);
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        flipped += errorWith(cells[li], d) + cells[li].length * FLIP * realism * (1 - roof[li] !== chance[li] ? 1 : 0);
      }
      if (flipped < now - 1e-9)
        for (const li of list) {
          const a = colourAt(kOf[li], level[li], roof[li]);
          const b = colourAt(kOf[li], level[li], 1 - roof[li]);
          shift(cells[li], [b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
          roof[li] = 1 - roof[li];
        }
    }
    // Levels: each lot tries every step within its reach.
    lots.forEach((_, li) => {
      const list = cells[li];
      if (!list.length || !BUILT.has(lots[li].label)) return;
      const cur = colourAt(kOf[li], level[li], roof[li]);
      let best = level[li];
      let bestCost = errorWith(list, [0, 0, 0]) + list.length * (away(li, level[li]) + smooth(li, level[li]));
      let bestD = [0, 0, 0];
      const lo = Math.max(0, home[li] - reach);
      const hi = Math.min(1, home[li] + reach);
      for (let v = Math.ceil(lo / STEP) * STEP; v <= hi + 1e-9; v += STEP) {
        const c = colourAt(kOf[li], v, roof[li]);
        const d = [c[0] - cur[0], c[1] - cur[1], c[2] - cur[2]];
        const cost = errorWith(list, d) + list.length * (away(li, v) + smooth(li, v));
        if (cost < bestCost - 1e-9) {
          bestCost = cost;
          best = v;
          bestD = d;
        }
      }
      if (best !== level[li]) {
        shift(list, bestD);
        level[li] = best;
      }
    });
    const e = residual();
    const gain = error - e;
    error = e;
    if (gain < ENOUGH * before) {
      sweeps++;
      break;
    }
  }

  if (moves)
    lots.forEach((l, li) => {
      if (!cells[li].length || !BUILT.has(l.label)) return;
      l.level = level[li];
      l.warmth = roof[li];
    });

  // Ink per pen over the grid, for the calibration guard.
  const pens = [0, 0, 0, 0, 0];
  let counted = 0;
  for (let c = 0; c < n; c++) {
    if (at[c] < 0 || weight[c] <= 0) continue;
    counted++;
    const li = owner[c];
    const zc = ground[c];
    const v = li >= 0 ? cover(lots[li].label, level[li], roof[li]) : zc >= 0 ? cover(LABELS[z.label[zc]], z.level[zc], z.warmth[zc]) : [0, 0, 0, 0, 0];
    for (let k = 0; k < 5; k++) pens[k] += v[k];
  }
  for (let k = 0; k < 5; k++) pens[k] /= Math.max(1, counted);
  return { x0: bx0, y0: by0, cell, W, H, owner, ground, at, lots, colour: col, target: want, weight, pens, chroma, sigma, cellMm: cell * cam.s, cover, colourOf, before, after: error, sweeps };
}
