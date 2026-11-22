/**
 * Zoning in image mode: a land plan on a grid over the ground, saying what each patch of the
 * town is (water, park, wood, field, suburb, old town…), how dense, and how many of its roofs
 * are pitched, so that the drawing's tone and colour follow the image. See
 * docs/plans/image-mode.md §8.
 *
 * The ground is cut into superpixels about a parcel across that follow the image's edges (SLIC),
 * each gets the label whose material best matches the image where it shows (lifted, for
 * buildings, to where their roofs and walls land on the sheet), and neighbours are then made to
 * agree, cheaply across the image's edges and dearly elsewhere (ICM). Patches too small for their
 * kind are merged away. Likeness weighs the image against the priors that keep the town ordinary.
 */
import type { Camera } from './camera';
import { learnCompat } from './image-adjacency';
import { PAIRS } from './image-adjacency-data';
import { DARKEST, type Target } from './image-read';
import { blur, BUILT, chromaWeight, LABELS, lightnessAt, materialColour, type Label } from './image-tone';
import type { Settings } from './settings';

/** A land plan on a ground grid in local metres: cell (i, j) has its centre at (x0 + (i + ½) cell, y0 + (j + ½) cell). */
export type Zones = {
  x0: number;
  y0: number;
  cell: number;
  W: number;
  H: number;
  /** Index into `LABELS` per cell. */
  label: Uint8Array;
  /** How densely built, planted or drawn, 0–1, within the label's range. */
  level: Float32Array;
  /** Share of pitched roofs, 0–1, for built labels. */
  warmth: Float32Array;
  /** The superpixel each cell belongs to. */
  sp: Int32Array;
};

/** Ground cell size, m: about a millimetre on paper, never under 2 m. */
export function zoneCell(scale: number): number {
  return scale <= 2000 ? 2 : scale <= 4000 ? 4 : 8;
}

/** About one superpixel per parcel, m across, but never finer than the drawing can show tone, mm on paper. */
const SUPERPIXEL = 24;
const SUPERPIXEL_MM = 5;
/** SLIC's compactness: a colour difference worth one superpixel's distance. */
const COMPACT = 0.03;
const SLIC_ROUNDS = 5;
/** Typical height of each label's buildings, m: the image is read half that high, where their roofs and walls show. */
export const HEIGHT: Partial<Record<Label, number>> = { works: 8, suburb: 7, rows: 11, old: 15, blocks: 20, towers: 50 };
/** Maximum difference in OKLab fit for which a dark, neutral patch can keep a mix of regional and flat roofs. */
const ROOF_FIT_TOLERANCE = 0.02;
const LEVELS = [0, 0.25, 0.5, 0.75, 1];
/** Radius over which built-up land counts as town rather than country, m. */
const URBAN_RADIUS = 160;

/** Soft costs that keep a town ordinary, in ΔE: a base for each label, and how much it minds being in town or out of it. */
const BASE: Record<Label, number> = { water: 0.006, plaza: 0.008, sand: 0.006, meadow: 0.004, field: 0.004, park: 0.002, allot: 0.008, wood: 0.004, works: 0.008, suburb: 0, rows: 0.003, old: 0.006, blocks: 0.006, towers: 0.012 };
/** Positive: wants the town; negative: wants the country. */
const URBAN: Partial<Record<Label, number>> = { works: 0.006, suburb: 0.008, rows: 0.01, old: 0.012, blocks: 0.012, towers: 0.025, plaza: 0.006, field: -0.012, meadow: -0.01, wood: -0.008 };
/**
 * The urban gradient: dense labels cost more the farther they are from a core (the middle of
 * one of the largest dense built masses), fading in from their free radius over `CORE_FADE` m.
 * Rows ease off later. Cores are masses of at least `CORE_MIN` ha, at most `CORES` of them.
 */
const CORE_COST: Partial<Record<Label, [cost: number, free: number]>> = { old: [0.045, 150], blocks: [0.035, 300], towers: [0.045, 200], rows: [0.015, 600] };
const CORE_FADE = 400;
const CORE_MIN = 2;
const CORES = 3;
/** Mean edge strength along a superpixel's shore that says the image draws a bank there. */
const BANK_EDGE = 0.3;
/** Blue-water advantage in ΔE that can retain a pond or a narrow channel through clean-up. */
const CLEAR_WATER = 0.02;
/** Smallest clearly coloured pond, m². */
const POND_AREA = 400;
/** Water a beach may lie beside: a body of at least this much, m². */
const BEACH_WATER = 5000;
/** Smoothness between differing neighbours, at full realism, in ΔE per superpixel side. */
const SMOOTH = 0.006;
/** Smallest patch of each label at full realism, ha; at full likeness, `MIN_LIKE` for all. */
export const MIN_AREA: Record<Label, number> = { water: 0.5, plaza: 0.15, sand: 0.2, meadow: 1, field: 2, park: 1.5, allot: 0.5, wood: 3, works: 1, suburb: 1, rows: 0.6, old: 0.6, blocks: 0.6, towers: 0.8 };
const MIN_LIKE = 0.1;
/**
 * Largest patch of a label at full realism, ha. Only allotments expand at higher likeness: no town has a
 * hundred hectares of allotments or a paved square the size of a district, however well their
 * texture matches the image. What lies beyond is relabelled.
 */
const SQUARE_AREA = 2500; // m², about a 50 m square
const MAX_AREA: Partial<Record<Label, number>> = { allot: 5, plaza: SQUARE_AREA / 10000 };
/**
 * The narrowest a patch of each built label can be and still be built on, m: a tower needs its
 * plot and the open ground round it, a terrace a street front and a yard. Narrower parts would
 * stay bare, so they take the next best label.
 */
const MIN_WIDTH: Partial<Record<Label, number>> = { towers: 50, works: 40, blocks: 28, suburb: 22, rows: 14, old: 14 };

const L = (name: Label) => LABELS.indexOf(name);
const GREEN = new Set<Label>(['meadow', 'field', 'park', 'allot', 'wood']);
const DENSE = new Set<Label>(['old', 'blocks', 'towers']);
/** Pairs of built labels and how badly they sit side by side. */
const BUILT_PAIRS: Record<string, number> = {
  'suburb rows': 0.3, 'rows old': 0.3, 'old blocks': 0.4, 'blocks towers': 0.4, 'rows blocks': 0.4, 'suburb blocks': 0.6,
  'suburb old': 0.7, 'rows towers': 0.7, 'suburb towers': 0.8, 'old towers': 1.2, 'works old': 1.5,
};

/** How badly two labels sit next to each other (§8.2): cheap for water, a park by houses or a wood by fields, dear for towers in fields. */
export function compat(a: Label, b: Label): number {
  if (a === b) return 0;
  if (a === 'water' || b === 'water') return a === 'sand' || b === 'sand' ? 0 : 0.1;
  if (a === 'sand' || b === 'sand') return 0.6;
  if (a === 'plaza' || b === 'plaza') return BUILT.has(a === 'plaza' ? b : a) ? 0.3 : 0.5;
  const ga = GREEN.has(a);
  const gb = GREEN.has(b);
  if (ga && gb) return (a === 'wood' && b === 'field') || (a === 'field' && b === 'wood') || (a === 'park' && b === 'meadow') || (a === 'meadow' && b === 'park') ? 0.2 : 0.3;
  if (!ga && !gb) return BUILT_PAIRS[`${a} ${b}`] ?? BUILT_PAIRS[`${b} ${a}`] ?? 0.6;
  const [green, built] = ga ? [a, b] : [b, a];
  if (green === 'park') return 0.4;
  if (green === 'allot') return built === 'suburb' || built === 'rows' ? 0.4 : 0.8;
  if (DENSE.has(built)) return green === 'wood' ? 1.2 : 1.5;
  return built === 'works' ? 0.8 : 0.6;
}

/**
 * Whether zoning matches colour using the layout palette. A tone-only plan uses black on white.
 */
export const colourCounts = (set: Pick<Settings, 'imageColour' | 'mono'>) => !set.mono && set.imageColour > 0;
/** The pens and paper zoning sees when only lightness counts. */
export const REFERENCE = { pens: ['#000000', '#000000', '#000000', '#000000', '#000000'] as Settings['pens'], mono: false, customBackground: false, background: '#ffffff' };

/** `compat()` for every pair of label indices, looked up in the hot loops. */
const COMPAT = Float32Array.from({ length: LABELS.length ** 2 }, (_, i) => compat(LABELS[Math.floor(i / LABELS.length)], LABELS[i % LABELS.length]));
/** The same, learnt from which zones border which in real towns (see `image-adjacency.ts`). */
const LEARNT = Float32Array.from(learnCompat(PAIRS, compat).flat());

/** The costs between neighbours, from the hand-made table at 0 to the one learnt from real towns at 1. */
export function compatTable(neighbours: number): Float32Array {
  const t = Math.max(0, Math.min(1, neighbours));
  return t > 0 ? COMPAT.map((h, i) => h + t * (LEARNT[i] - h)) : COMPAT;
}

/** What zoning needs from the settings. */
export type ZoneSettings = Pick<Settings, 'scale' | 'tilt' | 'likeness' | 'imageNeighbours' | 'imageTownBias' | 'imageWater' | 'imageDistrictSize' | 'imageColour' | 'mono' | 'pens' | 'customBackground' | 'background'>;

/**
 * Zone the ground in `box` (local metres) to look like the target through `cam`. The pens shape
 * the materials' colours, so they count here; the tone of what is drawn does not depend on them.
 */
/** Settings masks set for parts of the picture, at a ground position. */
export type ZoneLocal = Partial<Record<'likeness' | 'neighbours' | 'townBias' | 'water' | 'districtSize', (x: number, y: number) => number>>;

export function zone(target: Target, set: ZoneSettings, cam: Camera, box: readonly number[], local: ZoneLocal = {}): Zones {
  const cell = zoneCell(set.scale);
  const [bx0, by0, bx1, by1] = box;
  const W = Math.max(1, Math.ceil((bx1 - bx0) / cell));
  const H = Math.max(1, Math.ceil((by1 - by0) / cell));
  const n = W * H;
  const likeness = Math.max(0, Math.min(1, set.likeness));
  // Masks can set Likeness for part of the picture; each superpixel takes the mean of its cells.
  const clamp01 = (f?: (x: number, y: number) => number) => f && ((x: number, y: number) => Math.max(0, Math.min(1, f(x, y))));
  const likeAt = clamp01(local.likeness);
  // So can Neighbourhoods as in real towns: each pair of superpixels mixes the two tables by their mean.
  const nbAt = clamp01(local.neighbours);
  const pairCost = compatTable(set.imageNeighbours);
  const across = Math.max(SUPERPIXEL, SUPERPIXEL_MM / cam.s, 2 * cell);
  const colour = colourCounts(set);
  const chroma = colour ? chromaWeight(set) : 0;
  const seen = colour ? set : { ...set, ...REFERENCE };
  // Lightness alone: the target's tone, in the reference's range.
  const refPaper = 1;
  const refDark = lightnessAt('#ffffff', '#000000', DARKEST);

  // The target where each ground cell shows on the sheet, at the heights the labels are read at.
  const lifts = [0, ...new Set(Object.values(HEIGHT).map((h) => h / 2))];
  const liftOf = (l: Label) => lifts.indexOf((HEIGHT[l] ?? 0) / 2);
  const lab = new Float32Array(n * 3);
  const weight = new Float32Array(n);
  const dark = new Float32Array(n);
  const edge = new Float32Array(n);
  const reach = Math.max(0, Math.ceil((cell * cam.s) / target.cell / 2));
  const column = (x: number, y: number) => Math.max(0, Math.min(target.W - 1, Math.floor((cam.sx(x, y) - target.x0) / target.cell)));
  const row = (x: number, y: number, z: number) => Math.max(0, Math.min(target.H - 1, Math.floor((cam.sy(x, y, z) - target.y0) / target.cell)));
  // Keep each sample at the same precision as the ground colours used by SLIC.
  const lightness = (t: number) => colour ? target.L[t] : Math.fround(refDark + (refPaper - refDark) * target.tone[t]);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      const x = bx0 + (i + 0.5) * cell;
      const y = by0 + (j + 0.5) * cell;
      const cx = column(x, y), cy = row(x, y, 0);
      const t = cy * target.W + cx;
      lab[c * 3] = lightness(t);
      if (colour) {
        lab[c * 3 + 1] = target.a[t];
        lab[c * 3 + 2] = target.b[t];
      }
      weight[c] = target.weight[t];
      dark[c] = weight[c] * (1 - target.tone[t]);
      // An edge anywhere under the cell counts: edges are thin and cells aren't.
      let e = 0;
      for (let ey = Math.max(0, cy - reach); ey <= Math.min(target.H - 1, cy + reach); ey++)
        for (let ex = Math.max(0, cx - reach); ex <= Math.min(target.W - 1, cx + reach); ex++) e = Math.max(e, target.edge[ey * target.W + ex]);
      edge[c] = e;
    }
  }

  // How much like town the land round each cell is, from how dark the image is there; no image counts as middling.
  const has = weight.slice();
  blur(dark, W, H, URBAN_RADIUS / cell);
  blur(has, W, H, URBAN_RADIUS / cell);
  const urban = new Float32Array(n);
  for (let c = 0; c < n; c++) urban[c] = Math.max(0, Math.min(1, ((has[c] > 0.05 ? dark[c] / has[c] : 0.45) - 0.15) / 0.6));

  const sp = slic(lab, W, H, Math.round(across / cell));
  const count = sp.reduce((m, v) => Math.max(m, v + 1), 0);

  // What each superpixel looks like, and which superpixels touch, with how strong an edge runs between them.
  const area = new Float32Array(count);
  const spLab = lifts.map(() => new Float32Array(count * 3));
  const spWeight = new Float32Array(count);
  const spUrban = new Float32Array(count);
  const spLike = new Float32Array(count);
  const spNb = new Float32Array(count);
  const townBias = new Float32Array(count);
  const waterBias = new Float32Array(count);
  const districtSize = new Float32Array(count);
  // Only ground colours decide the superpixels. Sample the other heights directly into
  // those superpixels so each height needs three sums per patch instead of per cell.
  for (let j = 0; j < H; j++) {
    const y = by0 + (j + 0.5) * cell;
    for (let i = 0; i < W; i++) {
      const x = bx0 + (i + 0.5) * cell;
      const c = j * W + i, s = sp[c];
      area[s]++;
      spWeight[s] += weight[c];
      spUrban[s] += urban[c];
      spLike[s] += likeAt ? likeAt(x, y) : likeness;
      if (nbAt) spNb[s] += nbAt(x, y);
      if (local.townBias) townBias[s] += local.townBias(x, y);
      if (local.water) waterBias[s] += local.water(x, y);
      if (local.districtSize) districtSize[s] += local.districtSize(x, y);
      for (let ch = 0; ch < 3; ch++) spLab[0][s * 3 + ch] += lab[c * 3 + ch];
      const cx = column(x, y);
      for (let k = 1; k < lifts.length; k++) {
        const t = row(x, y, lifts[k]) * target.W + cx;
        const sum = spLab[k];
        sum[s * 3] += lightness(t);
        if (colour) {
          sum[s * 3 + 1] += target.a[t];
          sum[s * 3 + 2] += target.b[t];
        }
      }
    }
  }
  for (let s = 0; s < count; s++) {
    spWeight[s] /= area[s];
    spUrban[s] /= area[s];
    spLike[s] /= area[s];
    spNb[s] /= area[s];
    townBias[s] = local.townBias ? townBias[s] / area[s] : set.imageTownBias;
    waterBias[s] = local.water ? waterBias[s] / area[s] : set.imageWater;
    districtSize[s] = local.districtSize ? districtSize[s] / area[s] : set.imageDistrictSize;
    for (let k = 0; k < lifts.length; k++) for (let ch = 0; ch < 3; ch++) spLab[k][s * 3 + ch] /= area[s];
  }
  const sides = new Map<number, [number, number]>();
  const side = (a: number, b: number, e: number) => {
    const key = a < b ? a * count + b : b * count + a;
    const v = sides.get(key);
    if (v) {
      v[0]++;
      v[1] += e;
    } else sides.set(key, [1, e]);
  };
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      if (i + 1 < W && sp[c] !== sp[c + 1]) side(sp[c], sp[c + 1], Math.max(edge[c], edge[c + 1]));
      if (j + 1 < H && sp[c] !== sp[c + W]) side(sp[c], sp[c + W], Math.max(edge[c], edge[c + W]));
    }
  /** A superpixel's side, in cells. */
  const sideCells = across / cell;
  const lambda = (a: number, b: number) => SMOOTH * (1.2 - (likeAt ? (spLike[a] + spLike[b]) / 2 : likeness));
  /** Per superpixel: [neighbour, weight of the shared side (already cheapened by the edge along it), mean edge strength along it, the pair's Neighbourhoods where masks set it]. */
  const nbrs: [number, number, number, number][][] = Array.from({ length: count }, () => []);
  for (const [key, [len, e]] of sides) {
    const a = Math.floor(key / count);
    const b = key % count;
    const w = lambda(a, b) * (districtSize[a] + districtSize[b]) / 2 * Math.exp(-((e / len / 0.35) ** 2)) * Math.min(1.5, len / sideCells);
    const t = (spNb[a] + spNb[b]) / 2;
    nbrs[a].push([b, w, e / len, t]);
    nbrs[b].push([a, w, e / len, t]);
  }

  // Data cost: the closest the label's material comes to the image, plus the priors.
  const K = LABELS.length;
  const colours = LABELS.map((l) => LEVELS.map((v) => (BUILT.has(l) ? [0, 1] : [1]).map((w) => materialColour(l, v, w, seen))));
  const priorOf = (s: number) => 1 - 0.75 * (likeAt ? spLike[s] : likeness);
  const blueWater = new Float32Array(count);
  const data = new Float32Array(count * K);
  const bestLevel = new Float32Array(count * K);
  const bestWarmth = new Float32Array(count * K);
  for (let s = 0; s < count; s++) {
    // Blue ink covers only a small part of a water swatch. On saturated blue ground its
    // lightness can lose to grass even in the middle of a pond. Give the hue a say there.
    // Dark blues can be better matched by slate roofs and shadows than by sparse ripples.
    const a = spLab[0][s * 3 + 1], b = spLab[0][s * 3 + 2];
    const tone = (spLab[0][s * 3] - target.dark) / (target.paper - target.dark || 1);
    blueWater[s] = chroma * Math.max(0, -b - Math.max(0, a) - 0.025) * Math.max(0, Math.min(1, 3 * (tone - 0.5)));
    blueWater[s] *= 1 + waterBias[s];
    for (let k = 0; k < K; k++) {
      const l = LABELS[k];
      const t = spLab[liftOf(l)];
      let best = Infinity;
      const housing = l === 'suburb' || l === 'rows' || l === 'old' || l === 'blocks';
      const targetChroma = Math.hypot(t[s * 3 + 1], t[s * 3 + 2]);
      const distance = (col: readonly number[]) => {
        const dL = t[s * 3] - col[0];
        const da = t[s * 3 + 1] - col[1];
        const db = t[s * 3 + 2] - col[2];
        return Math.sqrt(dL * dL + chroma * chroma * (da * da + db * db));
      };
      LEVELS.forEach((v, li) => {
        const [first, pitched] = colours[k][li];
        const flatCost = distance(first);
        const pitchedCost = pitched ? distance(pitched) : Infinity;
        const d = Math.min(flatCost, pitchedCost);
        if (d >= best) return;
        best = d;
        bestLevel[s * K + k] = v;
        bestWarmth[s * K + k] = Number(pitchedCost < flatCost);
        if (housing && pitched && flatCost <= pitchedCost) {
          // Both swatches can be too light for a dark, neutral area. Let the regional roof
          // style break close ties there, fading its say as the image gains colour.
          const shortfall = Math.min(first[0], pitched[0]) - t[s * 3];
          const gap = Math.min(ROOF_FIT_TOLERANCE, shortfall) - targetChroma;
          if (gap > 0) bestWarmth[s * K + k] = Math.max(0, 1 - (pitchedCost - flatCost) / gap);
        }
      });
      const u = URBAN[l] ?? 0;
      const urb = u > 0 ? u * (1 - spUrban[s]) : -u * spUrban[s];
      // A preference tips close material matches. Water has its own dial, independent of built and green land.
      let preference = 0;
      if (BUILT.has(l)) preference = 0.035 * townBias[s];
      else if (GREEN.has(l)) preference = -0.035 * townBias[s];
      else if (l === 'water') preference = blueWater[s] + 0.045 * waterBias[s];
      data[s * K + k] = spWeight[s] * (best - preference) + priorOf(s) * (BASE[l] + urb);
    }
  }

  // Greedy by data, then iterated conditional modes with the neighbours, in a fixed order.
  const WATER = L('water');
  const SAND = L('sand');
  const label = new Uint8Array(count);
  for (let s = 0; s < count; s++) {
    let best = 0;
    for (let k = 1; k < K; k++) if (k !== SAND && data[s * K + k] < data[s * K + best]) best = k;
    label[s] = best;
  }
  // Sand comes only after, along real water (below).
  const cost = (s: number, k: number) => {
    if (k === SAND) return Infinity;
    let c = data[s * K + k];
    if (nbAt) {
      for (const [t, w, , mix] of nbrs[s]) {
        const i = k * K + label[t];
        c += w * (COMPAT[i] + mix * (LEARNT[i] - COMPAT[i]));
      }
    } else for (const [t, w] of nbrs[s]) c += w * pairCost[k * K + label[t]];
    return c;
  };
  const settle = (no?: Set<number>) => {
    // After the first sweep a cost can change only where a neighbour changed its label.
    const dirty = new Uint8Array(count).fill(1);
    for (let round = 0; round < 12; round++) {
      let changed = 0;
      for (let s = 0; s < count; s++) {
        if (!dirty[s]) continue;
        dirty[s] = 0;
        let best = label[s];
        let bc = cost(s, best);
        for (let k = 0; k < K; k++) {
          // Neighbours only add cost, so the data cost alone can rule a label out.
          if (k === label[s] || data[s * K + k] >= bc - 1e-9 || no?.has(k)) continue;
          const c = cost(s, k);
          if (c < bc - 1e-9) {
            bc = c;
            best = k;
          }
        }
        if (best !== label[s]) {
          label[s] = best;
          for (const [t] of nbrs[s]) dirty[t] = 1;
          changed++;
        }
      }
      if (!changed) break;
    }
  };
  settle();
  // Read the first land plan over a few blocks. Only break close material matches within
  // open green land or built land, and fade this preference out at full likeness.
  if (likeAt ? spLike.some((v) => v < 1) : likeness < 1) {
    const works = L('works'), park = L('park');
    const homes = new Float32Array(n), yards = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      const k = label[sp[c]];
      if (k === works) yards[c] = 1;
      else if (BUILT.has(LABELS[k])) homes[c] = 1;
    }
    blur(homes, W, H, 80 / cell);
    blur(yards, W, H, 80 / cell);
    const residential = new Float32Array(count), industrial = new Float32Array(count);
    for (let c = 0; c < n; c++) {
      residential[sp[c]] += homes[c];
      industrial[sp[c]] += yards[c];
    }
    for (let s = 0; s < count; s++) {
      const housing = residential[s] / area[s], industry = industrial[s] / area[s];
      const strength = 0.018 * (1 - (likeAt ? spLike[s] : likeness)) * spWeight[s];
      const land = LABELS[label[s]];
      if (land === 'meadow' || land === 'field' || land === 'park')
        data[s * K + park] -= strength * housing;
      if (BUILT.has(land))
        data[s * K + works] += strength * (housing - industry);
    }
    settle();
  }
  // The urban gradient: find the cores, then make density fall away from them, and settle again.
  const cores = coresOf(label, nbrs, area, sp, W, (CORE_MIN * 10000) / (cell * cell));
  if (cores.length) {
    const cx = new Float32Array(count);
    const cy = new Float32Array(count);
    for (let c = 0; c < n; c++) {
      cx[sp[c]] += c % W;
      cy[sp[c]] += Math.floor(c / W);
    }
    for (let s = 0; s < count; s++) {
      let d = Infinity;
      for (const [x, y] of cores) d = Math.min(d, Math.hypot(cx[s] / area[s] - x, cy[s] / area[s] - y) * cell);
      for (const [l, [c, free]] of Object.entries(CORE_COST) as [Label, [number, number]][]) data[s * K + L(l)] += priorOf(s) * c * Math.max(0, Math.min(1, (d - free) / CORE_FADE));
    }
    settle();
  }
  // Patches too small for their kind join whichever neighbour suits them best.
  const mergeSmall = () => {
    for (let pass = 0; pass < 6; pass++) {
      const comp = new Int32Array(count).fill(-1);
      const comps: number[][] = [];
      for (let s = 0; s < count; s++) {
        if (comp[s] >= 0) continue;
        const list = [s];
        comp[s] = comps.length;
        for (let q = 0; q < list.length; q++)
          for (const [t] of nbrs[list[q]])
            if (comp[t] < 0 && label[t] === label[s]) {
              comp[t] = comps.length;
              list.push(t);
            }
        comps.push(list);
      }
      let merged = 0;
      const order = comps.map((_, i) => i).sort((a, b) => comps[a].length - comps[b].length || a - b);
      for (const ci of order) {
        const list = comps[ci];
        const k = label[list[0]];
        const real = MIN_AREA[LABELS[k]];
        const cells = list.reduce((a, s) => a + area[s], 0);
        const like = likeAt ? list.reduce((a, s) => a + spLike[s] * area[s], 0) / cells : likeness;
        const size = local.districtSize ? list.reduce((a, s) => a + districtSize[s] * area[s], 0) / cells : set.imageDistrictSize;
        // A distinctly blue pond can be smaller than an inferred patch of open water.
        const pond = k === WATER && list.some(s => blueWater[s] > CLEAR_WATER);
        const min = pond ? POND_AREA : (real + (Math.min(real, MIN_LIKE) - real) * like) * 10000 * size * size;
        if (cells * cell * cell >= min) continue;
        const around = new Set<number>();
        for (const s of list) for (const [t] of nbrs[s]) if (label[t] !== k) around.add(label[t]);
        if (!around.size) continue;
        let best = -1;
        let bc = Infinity;
        for (const o of around) {
          const c = list.reduce((a, s) => a + data[s * K + o], 0);
          if (c < bc) {
            bc = c;
            best = o;
          }
        }
        for (const s of list) label[s] = best;
        merged++;
      }
      if (!merged) break;
    }
  };

  mergeSmall();
  // Patches too large for their kind keep as much as they may round the part that suits them
  // best, grown outwards; the rest takes the next best label, and small leftovers merge again.
  {
    const seen = new Uint8Array(count);
    let cut = 0;
    for (let s0 = 0; s0 < count; s0++) {
      const k = label[s0];
      const real = MAX_AREA[LABELS[k]];
      if (seen[s0] || real === undefined) continue;
      const list = [s0];
      seen[s0] = 1;
      for (let q = 0; q < list.length; q++)
        for (const [t] of nbrs[list[q]])
          if (!seen[t] && label[t] === k) {
            seen[t] = 1;
            list.push(t);
          }
      const like = likeAt ? list.reduce((a, s) => a + spLike[s] * area[s], 0) / list.reduce((a, s) => a + area[s], 0) : likeness;
      const max = real * (LABELS[k] === 'allot' ? 1 + 2 * like : 1) * 10000;
      if (list.reduce((a, s) => a + area[s], 0) * cell * cell <= max) continue;
      let seed = list[0];
      for (const s of list) if (data[s * K + k] < data[seed * K + k]) seed = s;
      const keep = new Uint8Array(count);
      const grow = [seed];
      keep[seed] = 1;
      let kept = area[seed] * cell * cell;
      for (let q = 0; q < grow.length && kept < max; q++)
        for (const [t] of nbrs[grow[q]])
          if (!keep[t] && label[t] === k && kept + area[t] * cell * cell <= max) {
            keep[t] = 1;
            kept += area[t] * cell * cell;
            grow.push(t);
          }
      for (const s of list) {
        if (keep[s]) continue;
        let best = -1;
        for (let o = 0; o < K; o++) if (o !== SAND && o !== k && o !== WATER && (best < 0 || data[s * K + o] < data[s * K + best])) best = o;
        label[s] = best;
        cut++;
      }
    }
    if (cut) {
      settle(new Set(Object.keys(MAX_AREA).map((l) => L(l as Label))));
      mergeSmall();
    }
  }
  // Built land too narrow to build on is opened away: per label, the cells at least half the
  // width from its edge, grown back by as much; superpixels mostly outside that take their next
  // best label.
  {
    const cellLabel = new Uint8Array(n);
    for (let c = 0; c < n; c++) cellLabel[c] = label[sp[c]];
    const keep = new Uint8Array(n);
    for (const [l, width] of Object.entries(MIN_WIDTH) as [Label, number][]) {
      const k = L(l);
      const r = width / 2 / cell;
      if (r < 1 || !label.includes(k)) continue;
      const core = distanceIn(cellLabel, k, W, H);
      for (let c = 0; c < n; c++) core[c] = core[c] >= r ? 0 : Infinity;
      chamferDistance(core, W, H);
      for (let c = 0; c < n; c++) if (cellLabel[c] === k && core[c] <= r) keep[c] = 1;
    }
    const kept = new Float32Array(count);
    for (let c = 0; c < n; c++) if (keep[c]) kept[sp[c]]++;
    let opened = 0;
    for (let s = 0; s < count; s++) {
      const k = label[s];
      if (MIN_WIDTH[LABELS[k]] === undefined || MIN_WIDTH[LABELS[k]]! / 2 / cell < 1 || kept[s] >= area[s] * 0.5) continue;
      let best = -1;
      for (let o = 0; o < K; o++) if (o !== SAND && o !== k && o !== WATER && (best < 0 || data[s * K + o] < data[s * K + best])) best = o;
      label[s] = best;
      opened++;
    }
    if (opened) mergeSmall();
  }
  // Water no more than a superpixel across is opened away, unless the image draws its banks: a
  // chain of water along a smooth band of tone is no river. Water stays where some of it is
  // surrounded by water, or edged by the image, and grows back one step from there.
  const inner = new Uint8Array(count);
  for (let s = 0; s < count; s++) {
    if (label[s] !== WATER) continue;
    const shore = nbrs[s].filter(([t]) => label[t] !== WATER);
    if (blueWater[s] > CLEAR_WATER || shore.length <= 0.25 * nbrs[s].length || shore.reduce((a, [, , e]) => a + e, 0) / shore.length >= BANK_EDGE) inner[s] = 1;
  }
  for (let s = 0; s < count; s++) {
    if (label[s] !== WATER || inner[s] || nbrs[s].some(([t]) => inner[t])) continue;
    let best = -1;
    for (let k = 0; k < K; k++) if (k !== SAND && k !== WATER && (best < 0 || data[s * K + k] < data[s * K + best])) best = k;
    label[s] = best;
  }
  // Beaches last: open ground along real water (not a puddle) turns to sand where sand suits the
  // image better. Left to ICM, sand invents puddles to lie beside.
  const BEACHY = new Set([L('meadow'), L('park'), L('field'), L('plaza')]);
  const lake = new Uint8Array(count);
  {
    const seen = new Uint8Array(count);
    for (let s = 0; s < count; s++) {
      if (seen[s] || label[s] !== WATER) continue;
      const list = [s];
      seen[s] = 1;
      for (let q = 0; q < list.length; q++)
        for (const [t] of nbrs[list[q]])
          if (!seen[t] && label[t] === WATER) {
            seen[t] = 1;
            list.push(t);
          }
      if (list.reduce((a, t) => a + area[t], 0) * cell * cell >= BEACH_WATER) for (const t of list) lake[t] = 1;
    }
  }
  for (let s = 0; s < count; s++)
    if (BEACHY.has(label[s]) && nbrs[s].some(([t]) => lake[t]) && data[s * K + SAND] < data[s * K + label[s]]) label[s] = SAND;

  // The clean-up passes can merge paved areas or remove the housing that enclosed them.
  // Read the finished plan before assigning materials to its squares.
  const plaza = L('plaza');
  if (label.includes(plaza)) {
    const ground = Uint8Array.from(sp, s => label[s]);
    const open = [L('meadow'), L('park'), L('field')];
    rejectSquares(ground, W, H, cell, c => {
      const s = sp[c];
      if (label[s] === plaza) label[s] = open.reduce((a, b) => data[s * K + a] <= data[s * K + b] ? a : b);
    });
  }

  // Levels and warmth from each superpixel's label, calmed within each zone.
  const lv = new Float32Array(count);
  const wm = new Float32Array(count);
  for (let s = 0; s < count; s++) {
    let sum = bestLevel[s * K + label[s]] * area[s];
    let ws = bestWarmth[s * K + label[s]] * area[s];
    let tot = area[s];
    for (const [t] of nbrs[s]) {
      if (label[t] !== label[s]) continue;
      sum += bestLevel[t * K + label[t]] * area[t];
      ws += bestWarmth[t * K + label[t]] * area[t];
      tot += area[t];
    }
    lv[s] = sum / tot;
    wm[s] = ws / tot;
  }

  const out: Zones = { x0: bx0, y0: by0, cell, W, H, label: new Uint8Array(n), level: new Float32Array(n), warmth: new Float32Array(n), sp };
  for (let c = 0; c < n; c++) {
    out.label[c] = label[sp[c]];
    out.level[c] = lv[sp[c]];
    out.warmth[c] = wm[sp[c]];
  }
  return out;
}

/** Visit the cells of paved patches too large for a square or outside the built-up interior. */
export function rejectSquares(ground: Uint8Array, W: number, H: number, cell: number, reject: (c: number) => void): void {
  const plaza = L('plaza');
  // Leave at least a shallow block of built land between a square and the countryside.
  // Unknown ground outside the plan counts as open, including when every cell is paved.
  const open = Float32Array.from(ground, (k, c) =>
    c < W || c >= ground.length - W || c % W === 0 || c % W === W - 1 || (k !== plaza && !BUILT.has(LABELS[k])) ? 0 : Infinity);
  chamferDistance(open, W, H);
  const seen = new Uint8Array(ground.length);
  for (let start = 0; start < ground.length; start++) {
    if (ground[start] !== plaza || seen[start]) continue;
    const patch = [start];
    seen[start] = 1;
    let interior = true, left = W, right = 0, bottom = H, top = 0;
    for (let q = 0; q < patch.length; q++) {
      const c = patch[q], x = c % W, y = Math.floor(c / W);
      if ((open[c] - 1) * cell < 24) interior = false;
      left = Math.min(left, x); right = Math.max(right, x);
      bottom = Math.min(bottom, y); top = Math.max(top, y);
      for (const t of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (ground[t] !== plaza || seen[t]) continue;
        seen[t] = 1;
        patch.push(t);
      }
    }
    // The span also rules out long ribbons of paving that fit under the area limit.
    if (!interior || patch.length * cell * cell > SQUARE_AREA || (1 + Math.max(right - left, top - bottom)) * cell > 75)
      for (const c of patch) reject(c);
  }
}

/**
 * SLIC superpixels (Achanta et al. 2012) on a grid of OKLab colours, about `S` cells across, made
 * connected. Returns each cell's superpixel, numbered from 0.
 */
export function slic(lab: Float32Array, W: number, H: number, S: number): Int32Array {
  const n = W * H;
  const cx: number[] = [];
  const cy: number[] = [];
  const cl: number[] = [];
  for (let y = S / 2; y < H; y += S)
    for (let x = S / 2; x < W; x += S) {
      const c = Math.floor(y) * W + Math.floor(x);
      cx.push(x);
      cy.push(y);
      cl.push(lab[c * 3], lab[c * 3 + 1], lab[c * 3 + 2]);
    }
  const k = cx.length;
  const assign = new Int32Array(n).fill(-1);
  const dist = new Float32Array(n);
  const m2 = 1 / (COMPACT * COMPACT);
  const s2 = 1 / (S * S);
  for (let round = 0; round < SLIC_ROUNDS; round++) {
    dist.fill(Infinity);
    for (let q = 0; q < k; q++) {
      const x0 = Math.max(0, Math.floor(cx[q] - S));
      const x1 = Math.min(W - 1, Math.ceil(cx[q] + S));
      const y0 = Math.max(0, Math.floor(cy[q] - S));
      const y1 = Math.min(H - 1, Math.ceil(cy[q] + S));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const c = y * W + x;
          const dL = lab[c * 3] - cl[q * 3];
          const da = lab[c * 3 + 1] - cl[q * 3 + 1];
          const db = lab[c * 3 + 2] - cl[q * 3 + 2];
          const d = (dL * dL + da * da + db * db) * m2 + ((x - cx[q]) ** 2 + (y - cy[q]) ** 2) * s2;
          if (d < dist[c]) {
            dist[c] = d;
            assign[c] = q;
          }
        }
    }
    const sum = new Float64Array(k * 6);
    for (let c = 0; c < n; c++) {
      const q = assign[c];
      sum[q * 6] += c % W;
      sum[q * 6 + 1] += Math.floor(c / W);
      for (let ch = 0; ch < 3; ch++) sum[q * 6 + 2 + ch] += lab[c * 3 + ch];
      sum[q * 6 + 5]++;
    }
    for (let q = 0; q < k; q++) {
      const m = sum[q * 6 + 5];
      if (!m) continue;
      cx[q] = sum[q * 6] / m;
      cy[q] = sum[q * 6 + 1] / m;
      for (let ch = 0; ch < 3; ch++) cl[q * 3 + ch] = sum[q * 6 + 2 + ch] / m;
    }
  }

  // Connected pieces, each its own superpixel; scraps join the one they touch first.
  const out = new Int32Array(n).fill(-1);
  const min = Math.max(1, (S * S) / 4);
  let next = 0;
  const queue: number[] = [];
  for (let start = 0; start < n; start++) {
    if (out[start] >= 0) continue;
    const q = assign[start];
    queue.length = 0;
    queue.push(start);
    out[start] = next;
    let touching = -1;
    for (let h = 0; h < queue.length; h++) {
      const c = queue[h];
      const x = c % W;
      for (const d of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) {
        if (d < 0 || d >= n) continue;
        if (out[d] < 0 && assign[d] === q) {
          out[d] = next;
          queue.push(d);
        } else if (out[d] >= 0 && out[d] !== next && touching < 0) touching = out[d];
      }
    }
    if (queue.length < min && touching >= 0) for (const c of queue) out[c] = touching;
    else next++;
  }
  return out;
}

/** The label at a ground point, or null outside the plan. */
export function labelAt(z: Zones, x: number, y: number): Label | null {
  const i = Math.floor((x - z.x0) / z.cell);
  const j = Math.floor((y - z.y0) / z.cell);
  return i < 0 || j < 0 || i >= z.W || j >= z.H ? null : LABELS[z.label[j * z.W + i]];
}

/** Middles of the largest masses of dense built superpixels (old town, blocks, towers) of at least `min` cells, in cells. */
function coresOf(label: Uint8Array, nbrs: readonly (readonly number[])[][], area: Float32Array, sp: Int32Array, W: number, min: number): [number, number][] {
  const dense = new Set([L('old'), L('blocks'), L('towers')]);
  const count = label.length;
  const comp = new Int32Array(count).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < count; s++) {
    if (comp[s] >= 0 || !dense.has(label[s])) continue;
    const id = sizes.length;
    const list = [s];
    comp[s] = id;
    for (let q = 0; q < list.length; q++)
      for (const [t] of nbrs[list[q]])
        if (comp[t] < 0 && dense.has(label[t])) {
          comp[t] = id;
          list.push(t);
        }
    sizes.push(list.reduce((a, t) => a + area[t], 0));
  }
  const big = sizes.map((size, id) => ({ size, id })).filter((m) => m.size >= min).sort((a, b) => b.size - a.size || a.id - b.id).slice(0, CORES);
  const sum = new Map(big.map((m) => [m.id, [0, 0]]));
  for (let c = 0; c < sp.length; c++) {
    const t = sum.get(comp[sp[c]]);
    if (!t) continue;
    t[0] += c % W;
    t[1] += Math.floor(c / W);
  }
  return big.map((m) => [sum.get(m.id)![0] / m.size, sum.get(m.id)![1] / m.size]);
}

/** Per cell, how far it is inside the patch of label `k`, in cells (0 outside), by a two-pass chamfer. */
function distanceIn(label: Uint8Array, k: number, W: number, H: number): Float32Array {
  const d = new Float32Array(W * H);
  for (let c = 0; c < d.length; c++) d[c] = label[c] === k ? Infinity : 0;
  chamferDistance(d, W, H);
  return d;
}

/** Chamfer distance in place: each cell takes its distance to the nearest zero, in cells. A mask limits where distances may spread. */
export function chamferDistance(d: Float32Array, W: number, H: number, mask?: Uint8Array): void {
  const D = Math.SQRT2;
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const c = j * W + i;
      if (mask && !mask[c]) continue;
      let v = d[c];
      if (i > 0) v = Math.min(v, d[c - 1] + 1);
      if (j > 0) {
        v = Math.min(v, d[c - W] + 1);
        if (i > 0) v = Math.min(v, d[c - W - 1] + D);
        if (i < W - 1) v = Math.min(v, d[c - W + 1] + D);
      }
      d[c] = v;
    }
  for (let j = H - 1; j >= 0; j--)
    for (let i = W - 1; i >= 0; i--) {
      const c = j * W + i;
      if (mask && !mask[c]) continue;
      let v = d[c];
      if (i < W - 1) v = Math.min(v, d[c + 1] + 1);
      if (j < H - 1) {
        v = Math.min(v, d[c + W] + 1);
        if (i < W - 1) v = Math.min(v, d[c + W + 1] + D);
        if (i > 0) v = Math.min(v, d[c + W - 1] + D);
      }
      d[c] = v;
    }
}

