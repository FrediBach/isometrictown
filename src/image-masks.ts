/**
 * Masks in image mode: shapes drawn on the picture, each with its own values for some of the
 * settings. Inside a mask its values apply, outside the drawing's own, and across the mask's
 * feathered edge the two mix. Masks stack in order, each mixing towards its own values over what
 * the ones before it left, as adjustment masks do in a photo editor.
 *
 * Shapes are kept in fractions of the picture's width and height, so they stay on the same part
 * of the picture when the crop moves. This module draws nothing: the interface uses it too, to
 * show and edit the masks over the preview.
 */
import { toSheet, type Placed } from './image-fit';
import type { Grid } from './image-tone';
import { gridFabric, type Settings } from './settings';
import { IMAGE_STYLE } from './styles';

/** Settings a mask can set for its part of the picture, in the order the panel lists them. */
export const MASK_KEYS = [
  'imageLight', 'imageContrast', 'likeness', 'imageNeighbours', 'imageTownBias', 'imageDistrictSize', 'imageWater',
  'imageRelief', 'imageDensity', 'imageHatching', 'imageFloorplans', 'imageHighlight',
  'fabric', 'imageStreetSpacing', 'imageContours', 'imageRoundabouts',
  'heightScale', 'windows', 'roofHatch', 'rooftops', 'details', 'shadeWalls',
  'pitched', 'trees', 'cars', 'abandon', 'humanize',
] as const;
export type MaskKey = (typeof MASK_KEYS)[number];
/** On/off settings a mask can turn on or off: 1 is on, 0 off. Across the feather the nearer side wins. */
export const MASK_SWITCHES = ['windows', 'roofHatch', 'rooftops', 'details', 'shadeWalls'] as const satisfies readonly MaskKey[];
export type MaskSwitch = (typeof MASK_SWITCHES)[number];
/** Settings each building is drawn with on its own, from where it stands. */
export const BUILDING_KEYS: readonly MaskKey[] = ['heightScale', ...MASK_SWITCHES];

/** The shapes a mask can take. */
export type MaskShape = 'ellipse' | 'rect' | 'polygon';

/** A mask over part of the picture, with the settings it changes there. */
export type ImageMask = {
  /** Stable name for the interface; the drawing never reads it. */
  id: string;
  shape: MaskShape;
  /**
   * An ellipse or rectangle: [cx, cy, rx, ry], its middle and half its width and height. A polygon:
   * its corners [x0, y0, x1, y1, …]. In fractions of the picture's width (x) and height (y).
   */
  pts: number[];
  /** Turn of an ellipse or rectangle, degrees clockwise on the picture. */
  angle: number;
  /** How far the corners of a rectangle or polygon are rounded, 0 (sharp) to 1 (as round as the sides allow). */
  round: number;
  /** Width of the soft edge, as a share of the picture's shorter side, centred on the outline. */
  feather: number;
  /** How fully the mask's values apply inside it, 0 to 1. */
  amount: number;
  /** Apply the values outside the shape instead of inside it. */
  invert: boolean;
  /** Left out of the drawing, but kept. */
  off: boolean;
  /** The settings this mask changes; the rest follow the drawing's. */
  values: Partial<Record<MaskKey, number>>;
};

/** Widest feather, as a share of the picture's shorter side. */
export const FEATHER_MAX = 0.5;
/** Most corners a polygon may have. */
export const POLYGON_MAX = 64;
/** Most masks a drawing keeps. */
export const MASKS_MAX = 24;

/** Settings image mode's mask stages are keyed on: the image is read again only for these. */
export const READ_KEYS: readonly MaskKey[] = ['imageLight', 'imageContrast'];
/** Zone preferences a mask can change. */
export const ZONE_KEYS = ['likeness', 'imageNeighbours', 'imageTownBias', 'imageDistrictSize', 'imageWater'] as const satisfies readonly MaskKey[];
/** Laid out again only for these. */
export const LAYOUT_KEYS: readonly MaskKey[] = [...ZONE_KEYS, 'fabric', 'imageStreetSpacing', 'imageContours', 'imageRoundabouts'];
/** Built again only for these; the rest only change how the town is drawn. */
export const BUILD_KEYS: readonly MaskKey[] = ['imageDensity', 'imageFloorplans'];

/** The range of each mask key, as the panel's sliders have them. */
export const MASK_RANGE: Record<MaskKey, [number, number]> = {
  imageLight: [-1, 1],
  imageContrast: [0.5, 2],
  likeness: [0, 1],
  imageNeighbours: [0, 1],
  imageTownBias: [-1, 1],
  imageDistrictSize: [0.5, 2],
  imageWater: [-1, 1],
  imageStreetSpacing: [0.5, 2],
  imageRelief: [0, 1],
  imageDensity: [-1, 1],
  imageHatching: [0, 1],
  imageFloorplans: [0, 1],
  imageHighlight: [0, 1],
  fabric: [0, 1],
  imageContours: [0, 1],
  imageRoundabouts: [0, 2],
  heightScale: [0.5, 3],
  windows: [0, 1],
  roofHatch: [0, 1],
  rooftops: [0, 1],
  details: [0, 1],
  shadeWalls: [0, 1],
  pitched: [0, 1],
  trees: [0, 1],
  cars: [0, 1],
  abandon: [0, 1],
  humanize: [0, 1],
};

/** Highlight cutoff the drawing stands for where Preserve empty space is off: nothing kept blank. */
export const NO_SPACE = 2;

/** The value a key has outside every mask. Preserve empty space off is a cutoff nothing reaches. */
export function mainValue(set: Settings, key: MaskKey): number {
  if (key === 'fabric') return gridFabric(set.fabric, set.style === 'auto' ? IMAGE_STYLE : set.style);
  if (key === 'imageHighlight') return set.imagePreserveSpace ? set.imageHighlight : NO_SPACE;
  const v = set[key];
  return typeof v === 'boolean' ? Number(v) : v;
}

/** Masks that take part in the drawing. */
export const activeMasks = (masks: readonly ImageMask[] | undefined) => (masks ?? []).filter((m) => !m.off && m.amount > 0 && Object.keys(m.values).length > 0);

/** Whether any mask in the drawing changes one of `keys`. */
export const masksSet = (masks: readonly ImageMask[] | undefined, keys: readonly MaskKey[]) => activeMasks(masks).some((m) => keys.some((k) => m.values[k] !== undefined));

/** A key for caching a stage that depends on `keys`: the masks that change any of them, and only those values. */
export function masksKey(masks: readonly ImageMask[] | undefined, keys: readonly MaskKey[]): string {
  const out: unknown[] = [];
  for (const m of activeMasks(masks)) {
    const values = keys.filter((k) => m.values[k] !== undefined).map((k) => [k, m.values[k]]);
    if (values.length) out.push([m.shape, m.pts, m.angle, m.round, m.feather, m.amount, m.invert, values]);
  }
  return out.length ? JSON.stringify(out) : '';
}

/** Points of a full ellipse outline. */
const ELLIPSE_STEPS = 96;
/** Points of each rounded corner. */
const CORNER_STEPS = 10;

/** A polygon with each corner rounded by `round` of the shorter of its two sides' halves, as a quadratic curve. */
export function roundCorners(p: readonly number[], round: number): number[] {
  const n = p.length / 2;
  if (round <= 0 || n < 3) return p.slice();
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const ax = p[((i + n - 1) % n) * 2], ay = p[((i + n - 1) % n) * 2 + 1];
    const bx = p[i * 2], by = p[i * 2 + 1];
    const cx = p[((i + 1) % n) * 2], cy = p[((i + 1) % n) * 2 + 1];
    const la = Math.hypot(ax - bx, ay - by), lc = Math.hypot(cx - bx, cy - by);
    const d = Math.min(1, round) * 0.5 * Math.min(la, lc);
    if (d <= 1e-9) {
      out.push(bx, by);
      continue;
    }
    const sx = bx + ((ax - bx) / la) * d, sy = by + ((ay - by) / la) * d;
    const ex = bx + ((cx - bx) / lc) * d, ey = by + ((cy - by) / lc) * d;
    for (let k = 0; k <= CORNER_STEPS; k++) {
      const t = k / CORNER_STEPS, u = 1 - t;
      out.push(u * u * sx + 2 * u * t * bx + t * t * ex, u * u * sy + 2 * u * t * by + t * t * ey);
    }
  }
  return out;
}

/**
 * The corners of a mask's shape before rounding, in picture pixels: an ellipse's outline, a
 * rectangle's four corners, or the polygon's own.
 */
export function maskCorners(m: Pick<ImageMask, 'shape' | 'pts' | 'angle'>, w: number, h: number): number[] {
  if (m.shape === 'polygon') return m.pts.map((v, i) => v * (i % 2 ? h : w));
  const [cx, cy, rx, ry] = m.pts;
  const a = (m.angle * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const X = cx * w, Y = cy * h, RX = rx * w, RY = ry * h;
  const at = (u: number, v: number) => [X + u * cos - v * sin, Y + u * sin + v * cos];
  if (m.shape === 'rect') return [...at(-RX, -RY), ...at(RX, -RY), ...at(RX, RY), ...at(-RX, RY)];
  const out: number[] = [];
  for (let k = 0; k < ELLIPSE_STEPS; k++) {
    const t = (k / ELLIPSE_STEPS) * Math.PI * 2;
    out.push(...at(Math.cos(t) * RX, Math.sin(t) * RY));
  }
  return out;
}

/** A mask's outline in picture pixels, with its corners rounded. */
export function maskOutline(m: ImageMask, w: number, h: number): number[] {
  const corners = maskCorners(m, w, h);
  return m.shape === 'ellipse' ? corners : roundCorners(corners, m.round);
}

/** A mask's outline on the sheet, mm, for a picture `w` × `h` pixels placed at `placed`. */
export function sheetOutline(m: ImageMask, placed: Placed, w: number, h: number): number[] {
  const p = maskOutline(m, w, h);
  for (let i = 0; i < p.length; i += 2) [p[i], p[i + 1]] = toSheet(placed, p[i], p[i + 1]);
  return p;
}

/** Signed distance from a point to a closed outline: positive inside. */
function signedDistance(p: readonly number[], x: number, y: number): number {
  let best = Infinity;
  let inside = false;
  const n = p.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const ax = p[j], ay = p[j + 1], bx = p[i], by = p[i + 1];
    if ((by > y) !== (ay > y) && x < ((ax - bx) * (y - by)) / (ay - by) + bx) inside = !inside;
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    const d = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
    if (d < best) best = d;
  }
  return inside ? Math.sqrt(best) : -Math.sqrt(best);
}

/** How much of a mask applies at a signed distance `sd` from its outline, for a feather `f` wide. */
function falloff(sd: number, f: number): number {
  if (f <= 1e-6) return sd >= 0 ? 1 : 0;
  const t = Math.max(0, Math.min(1, 0.5 + sd / f));
  return t * t * (3 - 2 * t);
}

/** Side of the coarse grid signed distances are found on before they are interpolated, mm. */
const COARSE = 2;

/**
 * How much of a mask applies on each cell of `grid` (sheet mm), 0 to 1. Signed distances are found on
 * a coarse grid and interpolated, which keeps a sharp edge sharp and costs little.
 */
export function maskWeights(m: ImageMask, outline: readonly number[], feather: number, grid: Grid): Float32Array {
  const { x0, y0, cell, W, H } = grid;
  const out = new Float32Array(W * H);
  const step = Math.max(cell, COARSE);
  const CW = Math.ceil((W * cell) / step) + 2;
  const CH = Math.ceil((H * cell) / step) + 2;
  // Beyond the outline's box by more than half the feather, a mask is wholly off.
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (let i = 0; i < outline.length; i += 2) {
    bx0 = Math.min(bx0, outline[i]); bx1 = Math.max(bx1, outline[i]);
    by0 = Math.min(by0, outline[i + 1]); by1 = Math.max(by1, outline[i + 1]);
  }
  const reach = feather / 2 + step * 2;
  const far = -(feather + step * 4);
  const sd = new Float32Array(CW * CH);
  for (let j = 0; j < CH; j++) {
    const y = y0 + (j - 0.5) * step;
    for (let i = 0; i < CW; i++) {
      const x = x0 + (i - 0.5) * step;
      sd[j * CW + i] = x < bx0 - reach || x > bx1 + reach || y < by0 - reach || y > by1 + reach ? far : signedDistance(outline, x, y);
    }
  }
  const amount = Math.max(0, Math.min(1, m.amount));
  for (let y = 0; y < H; y++) {
    const fy = ((y + 0.5) * cell) / step + 0.5;
    const j = Math.min(CH - 2, Math.floor(fy)), v = fy - j;
    for (let x = 0; x < W; x++) {
      const fx = ((x + 0.5) * cell) / step + 0.5;
      const i = Math.min(CW - 2, Math.floor(fx)), u = fx - i;
      const k = j * CW + i;
      const d = (sd[k] * (1 - u) + sd[k + 1] * u) * (1 - v) + (sd[k + CW] * (1 - u) + sd[k + CW + 1] * u) * v;
      const w = falloff(d, feather);
      out[y * W + x] = (m.invert ? 1 - w : w) * amount;
    }
  }
  return out;
}

/**
 * The settings that vary across the sheet, on a grid of sheet cells: each key the masks change has
 * its value on every cell, mixed from the drawing's value through each mask in turn. Keys no mask
 * changes have none, and read as the drawing's own.
 */
export class MaskField {
  private readonly fields = new Map<MaskKey, Float32Array | null>();
  private readonly weights: { mask: ImageMask; w: Float32Array }[];

  constructor(readonly masks: readonly ImageMask[], private readonly set: Settings, readonly grid: Grid, placed: Placed, picture: { w: number; h: number }) {
    const short = Math.min(placed.w, placed.h);
    this.weights = activeMasks(masks).map((mask) => ({
      mask,
      w: maskWeights(mask, sheetOutline(mask, placed, picture.w, picture.h), Math.max(0, Math.min(FEATHER_MAX, mask.feather)) * short, grid),
    }));
  }

  /** Whether any mask changes `key`. */
  varies(key: MaskKey): boolean {
    return this.weights.some((m) => m.mask.values[key] !== undefined);
  }

  /** The value of `key` on every cell, or null where no mask changes it. */
  field(key: MaskKey): Float32Array | null {
    if (this.fields.has(key)) return this.fields.get(key)!;
    let out: Float32Array | null = null;
    for (const { mask, w } of this.weights) {
      const v = mask.values[key];
      if (v === undefined) continue;
      out ??= new Float32Array(w.length).fill(mainValue(this.set, key));
      for (let i = 0; i < w.length; i++) if (w[i] > 0) out[i] += w[i] * (v - out[i]);
    }
    this.fields.set(key, out);
    return out;
  }

  /** The value of `key` at a sheet position, mm: the nearest cell's, or the drawing's off the grid's edge. */
  at(key: MaskKey, sx: number, sy: number): number {
    const f = this.field(key);
    if (!f) return mainValue(this.set, key);
    const { x0, y0, cell, W, H } = this.grid;
    const x = Math.max(0, Math.min(W - 1, Math.floor((sx - x0) / cell)));
    const y = Math.max(0, Math.min(H - 1, Math.floor((sy - y0) / cell)));
    return f[y * W + x];
  }

  /** The largest value `key` takes anywhere, the drawing's own included. */
  peak(key: MaskKey): number {
    const f = this.field(key);
    let top = mainValue(this.set, key);
    if (f) for (let i = 0; i < f.length; i++) if (f[i] > top) top = f[i];
    return top;
  }
}

/** Something that projects local metres onto the sheet, as the camera does. */
type Projects = { sx: (x: number, y: number) => number; sy: (x: number, y: number, z: number) => number };

/** The value of `key` where a point on the ground (local metres) shows on the sheet. */
export function groundValue(masks: MaskField, cam: Projects, key: MaskKey, x: number, y: number): number {
  return masks.at(key, cam.sx(x, y), cam.sy(x, y, 0));
}

/** A new mask's id, unique among `masks`. */
export function newMaskId(masks: readonly ImageMask[]): string {
  let n = masks.length + 1;
  while (masks.some((m) => m.id === `m${n}`)) n++;
  return `m${n}`;
}

/** A new mask of a shape, in the middle of a picture `w` × `h` pixels, round on the picture whatever its proportions. */
export function newMask(shape: MaskShape, masks: readonly ImageMask[], w: number, h: number): ImageMask {
  const r = 0.2 * Math.min(w, h);
  const rx = r / w, ry = r / h;
  const pts = shape === 'polygon'
    ? [0.5 - rx, 0.5 - ry * 0.8, 0.5 + rx * 0.9, 0.5 - ry, 0.5 + rx, 0.5 + ry * 0.7, 0.5 - rx * 0.7, 0.5 + ry]
    : [0.5, 0.5, rx, ry];
  return { id: newMaskId(masks), shape, pts, angle: 0, round: 0, feather: 0.08, amount: 1, invert: false, off: false, values: {} };
}

/** How far a copy is nudged from its original, as a share of the picture's shorter side, so it shows. */
const COPY_NUDGE = 0.03;

/** A copy of a mask with an id of its own, nudged down and right on a picture `w` × `h` pixels. */
export function duplicateMask(m: ImageMask, masks: readonly ImageMask[], w: number, h: number): ImageMask {
  const dx = (COPY_NUDGE * Math.min(w, h)) / w, dy = (COPY_NUDGE * Math.min(w, h)) / h;
  const pts = m.shape === 'polygon' ? m.pts.map((v, i) => v + (i % 2 ? dy : dx)) : [m.pts[0] + dx, m.pts[1] + dy, m.pts[2], m.pts[3]];
  return { ...m, id: newMaskId(masks), pts, values: { ...m.values } };
}

/** A mask mirrored across the picture's middle: left for right (`x`) or top for bottom (`y`). */
export function mirrorMask(m: ImageMask, axis: 'x' | 'y'): ImageMask {
  const flip = axis === 'x' ? 0 : 1;
  const pts = m.shape === 'polygon' ? m.pts.map((v, i) => (i % 2 === flip ? 1 - v : v)) : m.pts.map((v, i) => (i === flip ? 1 - v : v));
  // A mirror turns the other way; −0 is kept out of storage.
  return { ...m, pts, angle: m.angle ? -m.angle : 0 };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: unknown, lo: number, hi: number, def: number) => (finite(v) ? Math.max(lo, Math.min(hi, v)) : def);

/** Masks from storage or a link: known shapes, numbers in range, known keys only. Anything broken is dropped. */
export function validMasks(raw: unknown): ImageMask[] {
  if (!Array.isArray(raw)) return [];
  const out: ImageMask[] = [];
  for (const m of raw.slice(0, MASKS_MAX)) {
    if (!m || typeof m !== 'object') continue;
    const r = m as Record<string, unknown>;
    const shape = r.shape === 'ellipse' || r.shape === 'rect' || r.shape === 'polygon' ? r.shape : null;
    if (!shape || !Array.isArray(r.pts) || !r.pts.every(finite)) continue;
    const pts = (r.pts as number[]).map((v) => Math.max(-2, Math.min(3, v)));
    if (shape === 'polygon' ? pts.length < 6 || pts.length % 2 || pts.length > POLYGON_MAX * 2 : pts.length !== 4) continue;
    if (shape !== 'polygon') {
      pts[2] = Math.max(0.002, Math.abs(pts[2]));
      pts[3] = Math.max(0.002, Math.abs(pts[3]));
    }
    const values: ImageMask['values'] = {};
    if (r.values && typeof r.values === 'object') {
      for (const k of MASK_KEYS) {
        const v = (r.values as Record<string, unknown>)[k];
        if (!finite(v)) continue;
        values[k] = (MASK_SWITCHES as readonly MaskKey[]).includes(k) ? Number(v >= 0.5) : Math.max(MASK_RANGE[k][0], Math.min(MASK_RANGE[k][1], v));
      }
    }
    const id = typeof r.id === 'string' && /^[a-z0-9]{1,12}$/.test(r.id) && !out.some((o) => o.id === r.id) ? r.id : newMaskId(out);
    out.push({
      id,
      shape,
      pts,
      angle: clamp(r.angle, -360, 360, 0),
      round: clamp(r.round, 0, 1, 0),
      feather: clamp(r.feather, 0, FEATHER_MAX, 0.08),
      amount: clamp(r.amount, 0, 1, 1),
      invert: r.invert === true,
      off: r.off === true,
      values,
    });
  }
  return out;
}
