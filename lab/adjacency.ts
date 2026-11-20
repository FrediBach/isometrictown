/**
 * The adjacency lab: reads real places from the map, labels their ground with image mode's
 * zone labels, and counts which labels border which. `npm run adjacency` drives it through
 * `lab/adjacency.mjs`, which turns the counts into the table in `src/image-adjacency.ts`.
 *
 * Open land comes from what the map draws (water, woods, cover, parks, squares). Built land is
 * read from the buildings round each cell after `classify()`: how much of the ground they cover,
 * how big and tall they are, whether they share party walls and what kind they are. The plan is
 * then cleaned to the sizes image-mode zones have, so the boundaries counted are between zones,
 * not between a house and its garden.
 */
import { classify } from '../src/classify';
import { Frame, ringArea } from '../src/geo';
import { LABELS, type Label } from '../src/image-tone';
import { compat, MIN_AREA } from '../src/image-zones';
import { learnCompat, type LearnOptions } from '../src/image-adjacency';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { detectRegion, STYLES } from '../src/styles';
import { loadTown, type Shape, type Town } from '../src/tiles';
import { CORPUS, type CorpusPlace } from './adjacency-places';

export { CORPUS, LABELS, compat, learnCompat };
export type { LearnOptions };

/** Ground cell, m. */
export const CELL = 8;
/** Half the side of the square read round each place, m. */
const HALF = 900;
/** Radius of the window a cell's built character is read over, m: about a parcel's neighbourhood. */
const NEAR = 40;
/** Radius over which land counts as in town, m, as in zoning. */
const TOWN = 160;
/** Radius street density is read over, m: a few blocks. */
const STREETS = 80;
const BINS = 18;
const UNKNOWN = 255;
const K = LABELS.length;
const L = (l: Label) => LABELS.indexOf(l);

export type PlaceResult = {
  id: string;
  W: number;
  H: number;
  label: Uint8Array;
  /** Boundary between differing labels, in cell sides, K × K and symmetric. */
  pairs: Float64Array;
  /** Cells of each label. */
  cells: Float64Array;
  /** Built cells' characters, for checking the thresholds. */
  chars: (Character & { label: Label })[];
  /** The town read, in local metres; the label grid's south-west corner is at (x0, y0). */
  town: Town;
  x0: number;
  y0: number;
  error?: string;
};

/** Fill the cells whose centres lie inside a shape (even-odd over all its rings). */
function fill(shape: Shape, W: number, H: number, x0: number, y0: number, put: (c: number) => void): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of shape)
    for (let k = 1; k < r.pts.length; k += 2) {
      minY = Math.min(minY, r.pts[k]);
      maxY = Math.max(maxY, r.pts[k]);
    }
  const j0 = Math.max(0, Math.ceil((minY - y0) / CELL - 0.5));
  const j1 = Math.min(H - 1, Math.floor((maxY - y0) / CELL - 0.5));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const y = y0 + (j + 0.5) * CELL;
    xs.length = 0;
    for (const r of shape) {
      const p = r.pts;
      const n = p.length / 2;
      for (let a = 0, b = n - 1; a < n; b = a++) {
        const ya = p[a * 2 + 1];
        const yb = p[b * 2 + 1];
        if (ya > y !== yb > y) xs.push(p[a * 2] + ((y - ya) / (yb - ya)) * (p[b * 2] - p[a * 2]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / CELL - 0.5));
      const i1 = Math.min(W - 1, Math.floor((xs[k + 1] - x0) / CELL - 0.5));
      for (let i = i0; i <= i1; i++) put(j * W + i);
    }
  }
}

/** Sums over a square window of radius `r` cells, from a summed-area table. */
function windowSum(v: Float64Array, W: number, H: number, r: number): Float64Array {
  const S = new Float64Array((W + 1) * (H + 1));
  for (let j = 0; j < H; j++) {
    let row = 0;
    for (let i = 0; i < W; i++) {
      row += v[j * W + i];
      S[(j + 1) * (W + 1) + i + 1] = S[j * (W + 1) + i + 1] + row;
    }
  }
  const out = new Float64Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const a = Math.max(0, i - r);
      const b = Math.min(W, i + r + 1);
      const c = Math.max(0, j - r);
      const d = Math.min(H, j + r + 1);
      out[j * W + i] = S[d * (W + 1) + b] - S[c * (W + 1) + b] - S[d * (W + 1) + a] + S[c * (W + 1) + a];
    }
  return out;
}

/** What the buildings round a cell say it is. */
export type Character = { grid: number; streets: number; cov: number; foot: number; h: number; party: number; work: number; tall: number; apt: number; house: number };

/** The built label for a neighbourhood's character, the inverse of what each label builds (see `image-buildings.ts`). */
export function builtLabel(c: Character): Label {
  if (c.work >= 0.5) return 'works';
  if (c.tall >= 0.3 || c.h >= 30) return 'towers';
  // Freestanding buildings, unless so dense that the map has drawn whole blocks as one.
  if (c.party < 0.5 && c.cov < 0.45) {
    if (c.apt >= 0.5 || c.foot >= 450 || c.h >= 13) return c.h >= 25 ? 'towers' : 'blocks';
    return 'suburb';
  }
  if (c.cov >= 0.36) return blockiness(c) > 0 ? 'blocks' : 'old';
  if (c.cov >= 0.22) {
    if (c.party >= 0.7 && c.foot < 125) return 'rows';
    if (c.apt >= 0.5 || c.h >= 14 || c.foot >= 300) return blockiness(c) > 0 ? 'blocks' : 'old';
    return 'old';
  }
  if (c.party >= 0.7 && c.foot < 110) return 'rows';
  return 'suburb';
}

/**
 * Above zero, dense land reads as perimeter blocks; below, as old town: big footprints, height
 * and a street grid against small, low, organic fabric. Where dense buildings share few party
 * walls, the map has drawn whole blocks as one footprint (much of Italy), so size says nothing.
 */
export function blockiness(c: Character): number {
  const foot = c.party >= 0.5 ? Math.log2(c.foot / 210) : 0;
  return foot + (c.h - 16) / 4 + (c.grid - 0.85) * 4;
}

/** Read one real place and label its ground. */
export async function labelPlace(place: CorpusPlace): Promise<PlaceResult> {
  const set: Settings = { ...DEFAULT_SETTINGS, center: place.center, place: place.id, bearing: 0, scale: 4000, osmTags: false };
  const frame = new Frame(set.center);
  const box: [number, number, number, number] = [-HALF, -HALF, HALF, HALF];
  const [region, town] = await Promise.all([detectRegion(set.center), loadTown(frame, box)]);
  const style = STYLES[region.style] ?? STYLES.generic;
  // As render() keys it, so classify() reads the same evidence.
  classify(town, style, set, (x, y) => [Math.round(frame.mx0 + x / frame.k), Math.round(frame.my0 + y / frame.k)]);

  const W = Math.round((2 * HALF) / CELL);
  const H = W;
  const n = W * H;
  const x0 = -HALF;
  const y0 = -HALF;
  const open = new Uint8Array(n).fill(UNKNOWN);
  const set_ = (l: Label) => (c: number) => (open[c] = L(l));
  // Lowest priority first: later layers win.
  const green = new Uint8Array(n);
  for (const s of town.green) fill(s, W, H, x0, y0, (c) => (green[c] = 1));
  for (const a of town.cover) {
    const l: Label | null = a.cls === 'farmland' || a.cls === 'vineyard' ? 'field' : a.cls === 'meadow' || a.cls === 'scrub' || a.cls === 'wetland' ? 'meadow' : a.cls === 'allotments' || a.cls === 'orchard' ? 'allot' : a.cls === 'beach' || a.cls === 'sand' ? 'sand' : null;
    if (l) fill(a.shape, W, H, x0, y0, set_(l));
  }
  for (const s of town.wood) fill(s, W, H, x0, y0, set_('wood'));
  for (const s of town.plazas) fill(s, W, H, x0, y0, set_('plaza'));
  const water = new Uint8Array(n);
  for (const s of town.water) fill(s, W, H, x0, y0, (c) => (water[c] = 1));
  const work = new Uint8Array(n);
  for (const a of town.landuse) if (a.cls === 'industrial' || a.cls === 'railway' || a.cls === 'garages' || a.cls === 'military') fill(a.shape, W, H, x0, y0, (c) => (work[c] = 1));
  const resi = new Uint8Array(n);
  for (const a of town.landuse) if (a.cls === 'residential') fill(a.shape, W, H, x0, y0, (c) => (resi[c] = 1));

  // What the buildings lay down, at their centres.
  const A = new Float64Array(n);
  const AH = new Float64Array(n);
  const N = new Float64Array(n);
  const party = new Float64Array(n);
  const works = new Float64Array(n);
  const tall = new Float64Array(n);
  const apt = new Float64Array(n);
  const house = new Float64Array(n);
  for (const b of town.buildings) {
    if (b.context || b.min > 0 || !b.info) continue;
    const p = b.shape[0].pts;
    const area = Math.abs(ringArea(p));
    if (area < 25) continue;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < p.length; k += 2) {
      cx += p[k];
      cy += p[k + 1];
    }
    cx /= p.length / 2;
    cy /= p.length / 2;
    const i = Math.floor((cx - x0) / CELL);
    const j = Math.floor((cy - y0) / CELL);
    if (i < 0 || j < 0 || i >= W || j >= H) continue;
    const c = j * W + i;
    const kind = b.info.kind;
    A[c] += area;
    AH[c] += area * b.h;
    N[c]++;
    if (b.info.party.some((v) => v > 0)) party[c] += area;
    if (kind === 'industrial' || (work[c] && kind !== 'house' && kind !== 'terrace')) works[c] += area;
    if (kind === 'tall') tall[c] += area;
    if (kind === 'apartment') apt[c] += area;
    if (kind === 'house') house[c] += area;
  }
  // Street length, m, deposited along each street every 2 m; footways count half, as alleys or as paths across a yard.
  const street = new Float64Array(n);
  // And by direction, in 10° bins over half a turn, for how much of it keeps to a grid.
  const bins = Array.from({ length: BINS }, () => new Float64Array(n));
  for (const w of town.ways) {
    if (w.kind === 'rail' || w.cls === 'motorway' || w.cls === 'trunk' || w.bridge) continue;
    const weight = w.kind === 'path' ? (w.sub === 'pedestrian' || w.cls === 'pedestrian' ? 1 : 0.5) : 1;
    const p = w.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const dx = p[k + 2] - p[k];
      const dy = p[k + 3] - p[k + 1];
      const len = Math.hypot(dx, dy);
      const bin = Math.floor((((Math.atan2(dy, dx) + Math.PI) % Math.PI) / Math.PI) * BINS) % BINS;
      const steps = Math.max(1, Math.round(len / 2));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        const i = Math.floor((p[k] + dx * t - x0) / CELL);
        const j = Math.floor((p[k + 1] + dy * t - y0) / CELL);
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        street[j * W + i] += (weight * len) / steps;
        bins[bin][j * W + i] += (weight * len) / steps;
      }
    }
  }
  const land = Float64Array.from(water, (w) => (w ? 0 : CELL * CELL));
  const r = Math.round(NEAR / CELL);
  const [sA, sAH, sN, sParty, sWork, sTall, sApt, sHouse, sLand] = [A, AH, N, party, works, tall, apt, house, land].map((v) => windowSum(v, W, H, r));
  const R = Math.round(TOWN / CELL);
  const [tA, tLand] = [A, land].map((v) => windowSum(v, W, H, R));
  const S = Math.round(STREETS / CELL);
  const [gStreet, gLand] = [street, land].map((v) => windowSum(v, W, H, S));
  const gBins = bins.map((v) => windowSum(v, W, H, S));
  /** Share of the street length near a cell within 10° of two perpendicular directions, at the best such pair. */
  const gridness = (c: number): number => {
    const total = gStreet[c];
    if (total <= 0) return 0;
    let best = 0;
    const q = BINS / 2;
    for (let d = 0; d < q; d++) {
      let s = 0;
      for (const b of [d - 1, d, d + 1, d + q - 1, d + q, d + q + 1]) s += gBins[(b + BINS) % BINS][c];
      best = Math.max(best, s);
    }
    return best / total;
  };
  const character = (c: number): Character => ({
    streets: (gStreet[c] / Math.max(1, gLand[c])) * 10000,
    grid: gridness(c),
    cov: sA[c] / Math.max(1, sLand[c]),
    foot: sA[c] / Math.max(1, sN[c]),
    h: sAH[c] / Math.max(1, sA[c]),
    party: sParty[c] / Math.max(1, sA[c]),
    work: sWork[c] / Math.max(1, sA[c]),
    tall: sTall[c] / Math.max(1, sA[c]),
    apt: sApt[c] / Math.max(1, sA[c]),
    house: sHouse[c] / Math.max(1, sA[c]),
  });

  const label = new Uint8Array(n).fill(UNKNOWN);
  const chars: (Character & { label: Label })[] = [];
  for (let c = 0; c < n; c++) {
    if (!water[c] && open[c] === UNKNOWN && !green[c] && sN[c] >= 2 && c % 7 === 0) {
      const ch = character(c);
      chars.push({ ...ch, label: builtLabel(ch) });
    }
    if (water[c]) label[c] = L('water');
    else if (open[c] !== UNKNOWN) label[c] = open[c];
    else if (green[c]) label[c] = tA[c] / Math.max(1, tLand[c]) >= 0.08 ? L('park') : L('meadow');
    else if (sN[c] >= 2 || (sN[c] >= 1 && sA[c] >= 400)) label[c] = L(builtLabel(character(c)));
    else if (work[c]) label[c] = L('works');
    else if (resi[c] && tA[c] / Math.max(1, tLand[c]) >= 0.04) label[c] = L('suburb');
  }
  // Built land the window read too thinly (a yard, a wide street) takes the town round it.
  {
    const near = Array.from({ length: K }, (_, k) => windowSum(Float64Array.from(label, (v) => (v === k ? 1 : 0)), W, H, r));
    for (let c = 0; c < n; c++) {
      if (label[c] !== UNKNOWN || tA[c] / Math.max(1, tLand[c]) < 0.06) continue;
      let best = UNKNOWN;
      let most = 0;
      for (let k = 0; k < K; k++) {
        if (!['works', 'suburb', 'rows', 'old', 'blocks', 'towers'].includes(LABELS[k])) continue;
        if (near[k][c] > most) {
          most = near[k][c];
          best = k;
        }
      }
      if (most > 0) label[c] = best;
    }
  }
  clean(label, W, H);

  const pairs = new Float64Array(K * K);
  const cells = new Float64Array(K);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      const a = label[c];
      if (a === UNKNOWN) continue;
      cells[a]++;
      for (const d of [i + 1 < W ? c + 1 : -1, j + 1 < H ? c + W : -1]) {
        if (d < 0) continue;
        const b = label[d];
        if (b === UNKNOWN || b === a) continue;
        pairs[a * K + b]++;
        pairs[b * K + a]++;
      }
    }
  return { id: place.id, W, H, label, pairs, cells, chars, town, x0, y0 };
}

/** A majority filter, then patches below their label's smallest zone merged into the neighbour they share most edge with. */
function clean(label: Uint8Array, W: number, H: number): void {
  const n = W * H;
  for (let round = 0; round < 2; round++) {
    const next = label.slice();
    const votes = new Uint16Array(K);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const c = j * W + i;
        if (label[c] === UNKNOWN) continue;
        votes.fill(0);
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const a = i + di;
            const b = j + dj;
            if (a < 0 || b < 0 || a >= W || b >= H) continue;
            const v = label[b * W + a];
            if (v !== UNKNOWN) votes[v]++;
          }
        let best = label[c];
        for (let k = 0; k < K; k++) if (votes[k] > votes[best]) best = k;
        if (votes[best] >= 5) next[c] = best;
      }
    label.set(next);
  }
  // Smallest patches first, so a sliver merges before the patch it lies in is judged.
  for (let round = 0; round < 4; round++) {
    const comp = new Int32Array(n).fill(-1);
    const sizes: number[] = [];
    const stack: number[] = [];
    for (let c = 0; c < n; c++) {
      if (label[c] === UNKNOWN || comp[c] >= 0) continue;
      const id = sizes.length;
      let size = 0;
      comp[c] = id;
      stack.push(c);
      while (stack.length) {
        const e = stack.pop()!;
        size++;
        const i = e % W;
        const j = (e - i) / W;
        for (const d of [i > 0 ? e - 1 : -1, i + 1 < W ? e + 1 : -1, j > 0 ? e - W : -1, j + 1 < H ? e + W : -1]) {
          if (d >= 0 && comp[d] < 0 && label[d] === label[c]) {
            comp[d] = id;
            stack.push(d);
          }
        }
      }
      sizes.push(size);
    }
    const border = new Map<number, Float64Array>();
    for (let c = 0; c < n; c++) {
      if (comp[c] < 0) continue;
      const min = (MIN_AREA[LABELS[label[c]]] * 10000) / (CELL * CELL);
      if (sizes[comp[c]] >= min) continue;
      const i = c % W;
      const j = (c - i) / W;
      for (const d of [i > 0 ? c - 1 : -1, i + 1 < W ? c + 1 : -1, j > 0 ? c - W : -1, j + 1 < H ? c + W : -1]) {
        if (d < 0 || comp[d] === comp[c] || label[d] === UNKNOWN) continue;
        let v = border.get(comp[c]);
        if (!v) border.set(comp[c], (v = new Float64Array(K)));
        v[label[d]]++;
      }
    }
    if (!border.size) break;
    const into = new Map<number, number>();
    for (const [id, v] of border) {
      let best = 0;
      for (let k = 1; k < K; k++) if (v[k] > v[best]) best = k;
      if (v[best] > 0) into.set(id, best);
    }
    for (let c = 0; c < n; c++) {
      const t = comp[c] >= 0 ? into.get(comp[c]) : undefined;
      if (t !== undefined) label[c] = t;
    }
  }
}

/** Boundary counts per place, as the runner saves them. */
export type PlaceCounts = Record<string, { kind: string; pairs: number[]; cells: number[] }>;

const square = (flat: ArrayLike<number>): number[][] => Array.from({ length: K }, (_, a) => Array.from({ length: K }, (_, b) => flat[a * K + b]));

/** Counts summed over places, each scaled to 1,000 cell sides of boundary, as the table is made. */
function pool(places: PlaceCounts, ids: string[]): number[][] {
  const out = Array.from({ length: K }, () => new Array<number>(K).fill(0));
  for (const id of ids) {
    const p = places[id].pairs;
    const sum = p.reduce((s, v) => s + v, 0) / 2;
    if (sum) for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) out[a][b] += (p[a * K + b] / sum) * 1000;
  }
  return out;
}

/**
 * Mean log-likelihood, nats per boundary side, of the label across each boundary given the label
 * on this side, when the chance of label b beside a is its share of boundary times exp(−β cost).
 */
function logLik(costs: number[][], share: number[], beta: number, test: number[][]): number {
  let ll = 0;
  let n = 0;
  for (let a = 0; a < K; a++) {
    let z = 0;
    for (let b = 0; b < K; b++) if (b !== a) z += share[b] * Math.exp(-beta * costs[a][b]);
    for (let b = 0; b < K; b++) {
      if (b === a || !test[a][b]) continue;
      ll += test[a][b] * Math.log(Math.max(1e-12, (share[b] * Math.exp(-beta * costs[a][b])) / z));
      n += test[a][b];
    }
  }
  return ll / Math.max(1e-9, n);
}

/** The β that fits the training counts best. */
function fitBeta(costs: number[][], share: number[], train: number[][]): number {
  let best = 0;
  let bl = -Infinity;
  for (let beta = 0; beta <= 40; beta += 0.25) {
    const l = logLik(costs, share, beta, train);
    if (l > bl) {
      bl = l;
      best = beta;
    }
  }
  return best;
}

/**
 * Leave one place out: learn from the others, score on it. Returns the mean held-out
 * log-likelihood of each table, nats per boundary side, overall and by kind of place.
 */
export function crossValidate(places: PlaceCounts, hand: (a: Label, b: Label) => number, learn: (pairs: number[][]) => number[][]): Record<string, Record<string, number>> {
  const ids = Object.keys(places);
  const handCosts = LABELS.map((a) => LABELS.map((b) => (a === b ? 0 : hand(a, b))));
  const zero = handCosts.map((row) => row.map(() => 0));
  const scores: Record<string, Record<string, number[]>> = {};
  const add = (table: string, kind: string, v: number) => {
    scores[table] ??= {};
    (scores[table][kind] ??= []).push(v);
    (scores[table].all ??= []).push(v);
  };
  for (const id of ids) {
    const train = pool(places, ids.filter((i) => i !== id));
    const test = pool(places, [id]);
    const share = train.map((row) => row.reduce((s, v) => s + v, 0));
    const tot = share.reduce((s, v) => s + v, 0);
    for (let k = 0; k < K; k++) share[k] /= tot;
    const kind = places[id].kind;
    const tables: Record<string, number[][]> = { chance: zero, hand: handCosts, learnt: learn(train) };
    for (const [name, costs] of Object.entries(tables)) add(name, kind, logLik(costs, share, fitBeta(costs, share, train), test));
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [table, byKind] of Object.entries(scores)) out[table] = Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.reduce((s, x) => s + x, 0) / v.length]));
  return out;
}

export { square };
