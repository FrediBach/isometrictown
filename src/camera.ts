import { layout, panelCount, panelOrigin, type Layout } from './panels';
import { mmPerMetre, type LayerId, type Settings } from './settings';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The pen width level-of-detail sizes are tuned for, mm. A broader pen sheds detail sooner. */
export const REF_NIB = 0.35;

/**
 * An orthographic camera looking down at the ground.
 * World: metres, x east, y north, z up. Sheet: millimetres, y down.
 * depth grows away from the viewer, in metres.
 */
export class Camera {
  readonly sb: number;
  readonly cb: number;
  readonly sa: number;
  readonly ca: number;
  /** mm per metre */
  readonly s: number;
  /**
   * mm per metre as level of detail sees it: scaled up by the Detail setting and down by a pen
   * broader than `REF_NIB`. Compare level-of-detail thresholds against this (or use `size()`
   * and `src/lod.ts`), never against `s`. Changes inside `within()`.
   */
  lod: number;
  /** The detail in force: above 1 draws hatching closer and keeps smaller things. Changes inside `within()`. */
  detail: number;
  /** Per-feature Detail overrides, when they are switched on. */
  private readonly over: Partial<Record<LayerId, number>>;
  /** Pen width, mm. */
  readonly nib: number;
  readonly cx: number;
  readonly cy: number;
  /** Drawing area on the sheet, [x0, y0, x1, y1] in mm. Over a set of sheets, the area from the first sheet's to the last one's, gaps included. */
  readonly rect: [number, number, number, number];
  /** The sheet in mm; over a set of sheets, the whole wall they make (`layout.wall`). */
  readonly sheet: [number, number];
  /** How the drawing is split over sheets (one for a single sheet). */
  readonly layout: Layout;
  /** Each sheet's drawing area on the wall, [x0, y0, x1, y1] in mm; just `rect` for a single sheet. */
  readonly panels: [number, number, number, number][];
  /** Each sheet's margin, mm, and the deeper margin below it for map notes. */
  readonly margins: [side: number, foot: number];

  constructor(set: Pick<Settings, 'bearing' | 'tilt' | 'scale' | 'sheet' | 'landscape' | 'margin' | 'marginalia'> & Partial<Pick<Settings, 'detail' | 'penWidth' | 'customLayerDetail' | 'layerDetail' | 'panelCols' | 'panelRows' | 'panelGap'>>) {
    const b = (set.bearing * Math.PI) / 180;
    const a = (set.tilt * Math.PI) / 180;
    this.sb = Math.sin(b);
    this.cb = Math.cos(b);
    this.sa = Math.sin(a);
    this.ca = Math.cos(a);
    this.s = mmPerMetre(set);
    this.detail = clamp(set.detail ?? 1, 0.25, 2);
    this.nib = clamp(set.penWidth ?? REF_NIB, 0.1, 2);
    this.lod = (this.s * this.detail * REF_NIB) / this.nib;
    this.over = (set.customLayerDetail && set.layerDetail) || {};
    this.layout = layout(set);
    this.sheet = this.layout.wall;
    const [w, h] = this.layout.sheet;
    const m = Math.min(set.margin, w / 2 - 10, h / 2 - 10);
    // Map notes need a deeper margin below, as on a printed map. The place stays centred in the drawing.
    const foot = set.marginalia ? Math.min(clamp(m * 0.7, 8, 22), h / 2 - 10 - m) : 0;
    this.margins = [m, Math.max(0, foot)];
    // Every sheet of a set has the same margins, as identical frames would.
    const [W, H] = this.sheet;
    this.rect = [m, m, W - m, H - m - Math.max(0, foot)];
    this.panels = panelCount(this.layout) === 1 ? [this.rect] : Array.from({ length: panelCount(this.layout) }, (_, i) => {
      const [ox, oy] = panelOrigin(this.layout, i);
      return [ox + m, oy + m, ox + w - m, oy + h - m - Math.max(0, foot)];
    });
    this.cx = W / 2;
    this.cy = (this.rect[1] + this.rect[3]) / 2;
  }

  /**
   * Run `fn` at a feature's own Detail, if it has one; otherwise at the Detail already in force,
   * so details inside a feature (windows in a building) follow the feature unless set apart.
   */
  within<T>(layer: LayerId, fn: () => T): T {
    const v = this.over[layer];
    if (v === undefined) return fn();
    const { detail, lod } = this;
    this.detail = clamp(v, 0.25, 2);
    this.lod = (this.s * this.detail * REF_NIB) / this.nib;
    try {
      return fn();
    } finally {
      this.detail = detail;
      this.lod = lod;
    }
  }

  /**
   * A hatch or texture spacing on paper, mm, closed up or opened out by the detail setting and
   * opened out for a broad pen, so the tone stays the same whatever pen draws it.
   */
  gap(mm: number): number {
    return (mm * this.nib) / (REF_NIB * this.detail);
  }

  /** A tone hatch spacing on paper (shadows, shaded walls), mm: opened out for a broad pen, but not changed by Detail. */
  tone(mm: number): number {
    return (mm * this.nib) / REF_NIB;
  }

  /** How big `m` metres is on paper for level of detail: mm at Detail 1 with the reference pen. */
  size(m: number): number {
    return m * this.lod;
  }

  sx(x: number, y: number): number {
    return this.cx + (x * this.cb - y * this.sb) * this.s;
  }

  sy(x: number, y: number, z: number): number {
    return this.cy - ((x * this.sb + y * this.cb) * this.sa + z * this.ca) * this.s;
  }

  depth(x: number, y: number, z: number): number {
    return (x * this.sb + y * this.cb) * this.ca - z * this.sa;
  }

  /** The ground point (z = 0) under a sheet position. */
  ground(sx: number, sy: number): [number, number] {
    const xr = (sx - this.cx) / this.s;
    const yr = -(sy - this.cy) / (this.s * this.sa);
    return [xr * this.cb + yr * this.sb, -xr * this.sb + yr * this.cb];
  }

  /** Depth of the ground seen at sheet row sy. */
  groundDepth(sy: number): number {
    return (-(sy - this.cy) / (this.s * this.sa)) * this.ca;
  }

  /** Ground direction pointing up the sheet (away from the viewer). */
  get up(): [number, number] {
    return [this.sb, this.cb];
  }

  /** The ground quadrilateral that shows inside the drawing area, as local metres. */
  footprint(): [number, number][] {
    const [x0, y0, x1, y1] = this.rect;
    return [this.ground(x0, y0), this.ground(x1, y0), this.ground(x1, y1), this.ground(x0, y1)];
  }

  /**
   * Bounding box of all ground that can show in the drawing area, including tall
   * buildings standing in front of the bottom edge. [minX, minY, maxX, maxY] in metres.
   */
  region(maxHeight: number): [number, number, number, number] {
    const pts = this.footprint();
    const reach = (maxHeight * this.ca) / this.sa;
    const [ux, uy] = this.up;
    for (const [x, y] of pts.slice(2)) pts.push([x - ux * reach, y - uy * reach]);
    const pad = 30;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  }
}
