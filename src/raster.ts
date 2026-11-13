import type { Camera } from './camera';

/** Visibility test for a point on the sheet (mm) at a given depth (m). */
export type Test = (x: number, y: number, d: number) => boolean;

const STEP = 0.5;
const EPS = 0.08;
const MIN_RUN = 0.12;

/**
 * Scan-convert polygon rings (pixel coordinates, flat x,y) with the even-odd rule.
 * Calls span(y, xa, xb) for every covered run of pixel centres.
 */
export function scan(rings: ArrayLike<number>[], W: number, H: number, span: (y: number, xa: number, xb: number) => void): void {
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const r of rings) {
    for (let i = 1; i < r.length; i += 2) {
      if (r[i] < ymin) ymin = r[i];
      if (r[i] > ymax) ymax = r[i];
    }
  }
  const r0 = Math.max(0, Math.ceil(ymin - 0.5));
  const r1 = Math.min(H - 1, Math.ceil(ymax - 0.5) - 1);
  if (r1 < r0) return;
  const rows: number[][] = Array.from({ length: r1 - r0 + 1 }, () => []);
  for (const r of rings) {
    const n = r.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const x0 = r[j];
      const y0 = r[j + 1];
      const x1 = r[i];
      const y1 = r[i + 1];
      if (y0 === y1) continue;
      const ya = Math.min(y0, y1);
      const yb = Math.max(y0, y1);
      const from = Math.max(r0, Math.ceil(ya - 0.5));
      const to = Math.min(r1, Math.ceil(yb - 0.5) - 1);
      const k = (x1 - x0) / (y1 - y0);
      for (let row = from; row <= to; row++) rows[row - r0].push(x0 + (row + 0.5 - y0) * k);
    }
  }
  for (let row = r0; row <= r1; row++) {
    const xs = rows[row - r0];
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(W - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      if (xa <= xb) span(row, xa, xb);
    }
  }
}

/**
 * The drawing surface: a depth buffer for hidden-line removal, screen-space ground
 * masks, and per-pen polylines in sheet millimetres.
 */
export class Paper {
  readonly W: number;
  readonly H: number;
  readonly ppm: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly z: Float32Array;
  far: Float32Array;
  readonly pens: number[][][] = [[], [], [], []];
  private run: number[] | null = null;
  private runPen = 0;
  readonly seen: Test;

  constructor(readonly cam: Camera, maxPixels = 7e6) {
    [this.x0, this.y0, this.x1, this.y1] = cam.rect;
    const w = this.x1 - this.x0;
    const h = this.y1 - this.y0;
    this.ppm = Math.min(7, Math.sqrt(maxPixels / (w * h)));
    this.W = Math.ceil(w * this.ppm);
    this.H = Math.ceil(h * this.ppm);
    this.z = new Float32Array(this.W * this.H).fill(Infinity);
    this.far = this.z;
    this.seen = (x, y, d) => d <= this.far[this.index(x, y)] + EPS;
  }

  mask(): Uint8Array {
    return new Uint8Array(this.W * this.H);
  }

  index(x: number, y: number): number {
    let px = ((x - this.x0) * this.ppm) | 0;
    let py = ((y - this.y0) * this.ppm) | 0;
    if (px < 0) px = 0;
    else if (px >= this.W) px = this.W - 1;
    if (py < 0) py = 0;
    else if (py >= this.H) py = this.H - 1;
    return py * this.W + px;
  }

  on(mask: Uint8Array, x: number, y: number): boolean {
    if (x < this.x0 || y < this.y0 || x >= this.x1 || y >= this.y1) return false;
    return mask[this.index(x, y)] === 1;
  }

  private px(x: number): number {
    return (x - this.x0) * this.ppm;
  }

  private py(y: number): number {
    return (y - this.y0) * this.ppm;
  }

  /** Rasterise a planar 3D polygon (flat x,y,z rings, the first is the outline) into the depth buffer. */
  fillFace(rings: number[][]): void {
    const cam = this.cam;
    const outer = rings[0];
    const m = outer.length / 3;
    if (m < 3) return;
    const P: number[][] = rings.map((r) => {
      const out = new Array<number>((r.length / 3) * 2);
      for (let i = 0, j = 0; i < r.length; i += 3, j += 2) {
        out[j] = this.px(cam.sx(r[i], r[i + 1]));
        out[j + 1] = this.py(cam.sy(r[i], r[i + 1], r[i + 2]));
      }
      return out;
    });
    const D = new Array<number>(m);
    for (let i = 0; i < m; i++) D[i] = cam.depth(outer[i * 3], outer[i * 3 + 1], outer[i * 3 + 2]);
    const p = P[0];
    let i1 = 1;
    let best = -1;
    for (let i = 1; i < m; i++) {
      const dd = (p[i * 2] - p[0]) ** 2 + (p[i * 2 + 1] - p[1]) ** 2;
      if (dd > best) {
        best = dd;
        i1 = i;
      }
    }
    let i2 = -1;
    let det = 0;
    for (let i = 1; i < m; i++) {
      const c = (p[i1 * 2] - p[0]) * (p[i * 2 + 1] - p[1]) - (p[i * 2] - p[0]) * (p[i1 * 2 + 1] - p[1]);
      if (Math.abs(c) > Math.abs(det)) {
        det = c;
        i2 = i;
      }
    }
    if (i2 < 0 || Math.abs(det) < 0.05) return;
    const [x0, y0, d0] = [p[0], p[1], D[0]];
    const [ax, ay, ad] = [p[i1 * 2] - x0, p[i1 * 2 + 1] - y0, D[i1] - d0];
    const [bx, by, bd] = [p[i2 * 2] - x0, p[i2 * 2 + 1] - y0, D[i2] - d0];
    const a = (ad * by - bd * ay) / det;
    const b = (ax * bd - bx * ad) / det;
    const c = d0 - a * x0 - b * y0;
    const z = this.z;
    const W = this.W;
    scan(P, W, this.H, (y, xa, xb) => {
      const row = y * W;
      const base = b * (y + 0.5) + c;
      for (let x = xa; x <= xb; x++) {
        const d = a * (x + 0.5) + base;
        if (d < z[row + x]) z[row + x] = d;
      }
    });
  }

  /** Rasterise a flat sprite (sheet mm ring) at one depth. */
  fillSprite(ring: number[], depth: number): void {
    const P = ring.map((v, i) => (i % 2 ? this.py(v) : this.px(v)));
    const z = this.z;
    const W = this.W;
    scan([P], W, this.H, (y, xa, xb) => {
      const row = y * W;
      for (let x = xa; x <= xb; x++) if (depth < z[row + x]) z[row + x] = depth;
    });
  }

  /** The value a mask holds at a sheet position, 0 outside the drawing area. */
  at(mask: Uint8Array, x: number, y: number): number {
    if (x < this.x0 || y < this.y0 || x >= this.x1 || y >= this.y1) return 0;
    return mask[this.index(x, y)];
  }

  /** Mark ground rings (flat x,y local metres at z = 0) in a mask, with 1 or another code. */
  fillMask(mask: Uint8Array, rings: ArrayLike<number>[], value = 1): void {
    const cam = this.cam;
    const P = rings.map((r) => {
      const out = new Array<number>(r.length);
      for (let i = 0; i < r.length; i += 2) {
        out[i] = this.px(cam.sx(r[i], r[i + 1]));
        out[i + 1] = this.py(cam.sy(r[i], r[i + 1], 0));
      }
      return out;
    });
    const W = this.W;
    scan(P, W, this.H, (y, xa, xb) => mask.fill(value, y * W + xa, y * W + xb + 1));
  }

  /** Done filling depth: build the 3×3 max buffer used for line visibility. */
  finishDepth(): void {
    const { W, H, z } = this;
    const tmp = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) {
        let m = z[r + x];
        if (x > 0 && z[r + x - 1] > m) m = z[r + x - 1];
        if (x < W - 1 && z[r + x + 1] > m) m = z[r + x + 1];
        tmp[r + x] = m;
      }
    }
    const far = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const r = y * W;
      for (let x = 0; x < W; x++) {
        let m = tmp[r + x];
        if (y > 0 && tmp[r - W + x] > m) m = tmp[r - W + x];
        if (y < H - 1 && tmp[r + W + x] > m) m = tmp[r + W + x];
        far[r + x] = m;
      }
    }
    this.far = far;
  }

  /** Trace a 3D polyline (flat x,y,z), keeping only the parts that pass the test. */
  line3(pen: number, pts: number[], test: Test = this.seen, closed = false): void {
    const cam = this.cam;
    const n = pts.length / 3;
    let px = cam.sx(pts[0], pts[1]);
    let py = cam.sy(pts[0], pts[1], pts[2]);
    let pd = cam.depth(pts[0], pts[1], pts[2]);
    const fx = px;
    const fy = py;
    const fd = pd;
    for (let i = 1; i <= (closed ? n : n - 1); i++) {
      const k = (i % n) * 3;
      const x = i === n ? fx : cam.sx(pts[k], pts[k + 1]);
      const y = i === n ? fy : cam.sy(pts[k], pts[k + 1], pts[k + 2]);
      const d = i === n ? fd : cam.depth(pts[k], pts[k + 1], pts[k + 2]);
      this.seg(pen, px, py, pd, x, y, d, test);
      px = x;
      py = y;
      pd = d;
    }
    this.end();
  }

  /** A 3D segment. */
  seg3(pen: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, test: Test = this.seen): void {
    const c = this.cam;
    this.seg(pen, c.sx(ax, ay), c.sy(ax, ay, az), c.depth(ax, ay, az), c.sx(bx, by), c.sy(bx, by, bz), c.depth(bx, by, bz), test);
    this.end();
  }

  /** A polyline already on the sheet, flat x,y,depth. */
  sheet(pen: number, pts: number[], test: Test = this.seen, closed = false): void {
    const n = pts.length / 3;
    for (let i = 1; i <= (closed ? n : n - 1); i++) {
      const a = (i - 1) * 3;
      const b = (i % n) * 3;
      this.seg(pen, pts[a], pts[a + 1], pts[a + 2], pts[b], pts[b + 1], pts[b + 2], test);
    }
    this.end();
  }

  /** A polyline drawn flat on the ground, in sheet mm (flat x,y). */
  ground2(pen: number, pts: number[], test: Test): void {
    const c = this.cam;
    for (let i = 2; i < pts.length; i += 2) {
      this.seg(pen, pts[i - 2], pts[i - 1], c.groundDepth(pts[i - 1]), pts[i], pts[i + 1], c.groundDepth(pts[i + 1]), test);
    }
    this.end();
  }

  /** Sample one sheet-space segment and extend or start visible runs. */
  seg(pen: number, ax: number, ay: number, ad: number, bx: number, by: number, bd: number, test: Test): void {
    const dx = bx - ax;
    const dy = by - ay;
    let t0 = 0;
    let t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [ax - this.x0, this.x1 - ax, ay - this.y0, this.y1 - ay];
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) {
        if (q[k] < 0) {
          this.end();
          return;
        }
      } else {
        const r = q[k] / p[k];
        if (p[k] < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
    }
    if (t0 >= t1) {
      this.end();
      return;
    }
    if (t0 > 0) this.end();
    if (this.run && this.runPen !== pen) this.end();
    const sx = ax + dx * t0;
    const sy = ay + dy * t0;
    const sd = ad + (bd - ad) * t0;
    const ex = ax + dx * t1;
    const ey = ay + dy * t1;
    const ed = ad + (bd - ad) * t1;
    const len = Math.hypot(ex - sx, ey - sy) * this.ppm;
    const n = Math.max(1, Math.ceil(len / STEP));
    let lx = sx;
    let ly = sy;
    if (this.run && test(sx, sy, sd)) this.run.push(sx, sy);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = sx + (ex - sx) * t;
      const y = sy + (ey - sy) * t;
      if (test(x, y, sd + (ed - sd) * t)) {
        if (!this.run) {
          this.run = [x, y];
          this.runPen = pen;
        }
      } else if (this.run) {
        this.run.push(lx, ly);
        this.end();
      }
      lx = x;
      ly = y;
    }
    if (this.run) this.run.push(ex, ey);
    if (t1 < 1) this.end();
  }

  end(): void {
    const r = this.run;
    this.run = null;
    if (!r || r.length < 4) return;
    let len = 0;
    const out = [r[0], r[1]];
    for (let i = 2; i < r.length; i += 2) {
      const l = Math.hypot(r[i] - out[out.length - 2], r[i + 1] - out[out.length - 1]);
      if (l < 1e-4) continue;
      len += l;
      out.push(r[i], r[i + 1]);
    }
    if (len >= MIN_RUN && out.length >= 4) this.pens[this.runPen].push(out);
  }

  /**
   * Parallel hatch lines across the whole drawing area at a sheet angle, drawn on the ground.
   * keep(x, y) chooses where they show; hidden ground is skipped automatically.
   */
  hatchGround(pen: number, angle: number, spacing: number, keep: (x: number, y: number) => boolean): void {
    const a = (angle * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const corners = [
      [this.x0, this.y0],
      [this.x1, this.y0],
      [this.x1, this.y1],
      [this.x0, this.y1],
    ];
    const ns = corners.map(([x, y]) => x * nx + y * ny);
    const us = corners.map(([x, y]) => x * ux + y * uy);
    const nMin = Math.min(...ns);
    const nMax = Math.max(...ns);
    const uMin = Math.min(...us) - 1;
    const uMax = Math.max(...us) + 1;
    const cam = this.cam;
    const test: Test = (x, y, d) => keep(x, y) && this.seen(x, y, d);
    for (let t = Math.ceil(nMin / spacing) * spacing; t <= nMax; t += spacing) {
      const ax = nx * t + ux * uMin;
      const ay = ny * t + uy * uMin;
      const bx = nx * t + ux * uMax;
      const by = ny * t + uy * uMax;
      this.seg(pen, ax, ay, cam.groundDepth(ay), bx, by, cam.groundDepth(by), test);
      this.end();
    }
  }
}
