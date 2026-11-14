import { mmPerMetre, sheetSize, type Settings } from './settings';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
  /** mm per metre scaled by the detail setting: compare level-of-detail thresholds against this, not `s`. */
  readonly lod: number;
  /** The detail setting: above 1 draws hatching closer and keeps smaller things. */
  readonly detail: number;
  readonly cx: number;
  readonly cy: number;
  /** Drawing area on the sheet, [x0, y0, x1, y1] in mm. */
  readonly rect: [number, number, number, number];
  readonly sheet: [number, number];

  constructor(set: Pick<Settings, 'bearing' | 'tilt' | 'scale' | 'sheet' | 'landscape' | 'margin' | 'marginalia'> & Partial<Pick<Settings, 'detail'>>) {
    const b = (set.bearing * Math.PI) / 180;
    const a = (set.tilt * Math.PI) / 180;
    this.sb = Math.sin(b);
    this.cb = Math.cos(b);
    this.sa = Math.sin(a);
    this.ca = Math.cos(a);
    this.s = mmPerMetre(set);
    this.detail = clamp(set.detail ?? 1, 0.25, 2);
    this.lod = this.s * this.detail;
    this.sheet = sheetSize(set);
    const [w, h] = this.sheet;
    const m = Math.min(set.margin, w / 2 - 10, h / 2 - 10);
    // Map notes need a deeper margin below, as on a printed map. The place stays centred in the drawing.
    const foot = set.marginalia ? Math.min(clamp(m * 0.7, 8, 22), h / 2 - 10 - m) : 0;
    this.rect = [m, m, w - m, h - m - Math.max(0, foot)];
    this.cx = w / 2;
    this.cy = (this.rect[1] + this.rect[3]) / 2;
  }

  /** A hatch or texture spacing on paper, mm, closed up or opened out by the detail setting. */
  gap(mm: number): number {
    return mm / this.detail;
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
