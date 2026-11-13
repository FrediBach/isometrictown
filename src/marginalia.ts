import type { Camera } from './camera';
import type { Frame } from './geo';
import { letter, letterable, measure } from './lettering';
import type { Settings } from './settings';

/**
 * The margin of the sheet, set out like a printed bird's-eye town map: a double neat line
 * with graticule ticks, a title, the map's position and view, a scale bar, a north arrow
 * drawn on the ground plane, and the imprint. All in single strokes for the plotter.
 */

type Lines = number[][];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** An angle as degrees, minutes and seconds, e.g. 52°22′30″N. Seconds are whole. */
export function dms(deg: number, pos: string, neg: string, withSeconds = true): string {
  const hemi = deg < 0 ? neg : pos;
  let s = Math.round(Math.abs(deg) * 3600);
  if (!withSeconds) s = Math.round(s / 60) * 60;
  const d = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d}°${pad(m)}′${withSeconds ? `${pad(sec)}″` : ''}${hemi}`;
}

const lat = (v: number, sec = true) => dms(v, 'N', 'S', sec);
const lng = (v: number, sec = true) => dms(v, 'E', 'W', sec);

function compassWord(bearing: number): string {
  const words = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return words[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];
}

function scaleText(n: number): string {
  const r = Math.round(n);
  return r >= 10000 ? r.toLocaleString('en').replace(/,/g, ' ') : String(r);
}

/** Graticule steps, in seconds of arc. */
const STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200, 18000, 36000];

function pickStep(metresPerStep: number, metresPerSecond: number): number {
  const want = metresPerStep / metresPerSecond;
  return STEPS.find((s) => s >= want * 0.75) ?? STEPS[STEPS.length - 1];
}

function rect(x0: number, y0: number, x1: number, y1: number): number[] {
  return [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0];
}

/** Ticks and labels where whole minutes or seconds of latitude and longitude cross the neat line. */
function graticule(cam: Camera, frame: Frame, g: number, t: number): Lines {
  const out: Lines = [];
  const [x0, y0, x1, y1] = cam.rect;
  const latOf = (sx: number, sy: number) => frame.toLngLat(...cam.ground(sx, sy))[1] * 3600;
  const lngOf = (sx: number, sy: number) => frame.toLngLat(...cam.ground(sx, sy))[0] * 3600;
  const metresPerSec = 30.87;
  const latStep = pickStep(42 / cam.s, metresPerSec);
  const lngStep = pickStep(42 / cam.s, metresPerSec * frame.k);
  const off = 0.9;

  type Edge = { a: [number, number]; b: [number, number]; out: [number, number]; dir: [number, number] };
  const edges: Edge[] = [
    { a: [x0, y0], b: [x1, y0], out: [0, -1], dir: [1, 0] },
    { a: [x1, y0], b: [x1, y1], out: [1, 0], dir: [0, 1] },
    { a: [x0, y1], b: [x1, y1], out: [0, 1], dir: [1, 0] },
    { a: [x0, y0], b: [x0, y1], out: [-1, 0], dir: [0, -1] },
  ];
  for (const e of edges) {
    const at = (k: number): [number, number] => [e.a[0] + (e.b[0] - e.a[0]) * k, e.a[1] + (e.b[1] - e.a[1]) * k];
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
    // Tick whichever lines cross this edge more often: meridians if it runs east-west on the ground.
    const [gax, gay] = cam.ground(...e.a);
    const [gbx, gby] = cam.ground(...e.b);
    const meridians = Math.abs(gbx - gax) >= Math.abs(gby - gay);
    const f = (k: number) => (meridians ? lngOf : latOf)(...at(k));
    const step = meridians ? lngStep : latStep;
    const fa = f(0);
    const fb = f(1);
    const ticks: { k: number; label: string }[] = [];
    for (let n = Math.ceil(Math.min(fa, fb) / step); n * step <= Math.max(fa, fb); n++) {
      const v = n * step;
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (f(mid) < v === fa < fb) lo = mid;
        else hi = mid;
      }
      const deg = v / 3600;
      ticks.push({ k: (lo + hi) / 2, label: meridians ? lng(deg, step < 60) : lat(deg, step < 60) });
    }
    ticks.sort((p, q) => p.k - q.k);
    let last = -Infinity;
    for (const tk of ticks) {
      const w = measure(tk.label, t);
      const pos = tk.k * len;
      // Keep clear of the corners and of the previous label.
      if (pos - w / 2 < g + 1 || pos + w / 2 > len - g - 1 || pos - w / 2 < last + 2.5) continue;
      last = pos + w / 2;
      const [px, py] = at(tk.k);
      out.push([px, py, px + e.out[0] * g, py + e.out[1] * g]);
      const d = g + off;
      // Labels stand on the side facing the map, except below it, where they hang from the line.
      const base: [number, number] = e.out[1] === 1 ? [px, py + d + t] : [px + e.out[0] * d, py + e.out[1] * d];
      out.push(...letter(tk.label, base[0], base[1], { h: t, align: 'center', dir: e.dir }));
    }
  }
  return out;
}

/**
 * A round compass whose needle points along north as drawn: the way a north-south street
 * runs on the sheet, which the tilt pulls away from the bearing itself.
 */
function northArrow(cam: Camera, cx: number, cy: number, r: number, t: number): Lines {
  const out: Lines = [];
  // North on the sheet is where a step north on the ground lands; east is square to it on the dial.
  const nx = -cam.sb;
  const ny = -cam.cb * cam.sa;
  const l = Math.hypot(nx, ny) || 1;
  const [ux, uy] = [nx / l, ny / l];
  const to = (e: number, n: number): [number, number] => [cx + (n * ux - e * uy) * r, cy + (n * uy + e * ux) * r];
  const ring: number[] = [];
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    ring.push(...to(Math.cos(a), Math.sin(a)));
  }
  out.push(ring);
  for (const [e, n] of [
    [1, 0],
    [0, -1],
    [-1, 0],
  ]) out.push([...to(e, n), ...to(e * 1.18, n * 1.18)]);
  const N = to(0, 0.92);
  const S = to(0, -0.62);
  const E = to(0.17, 0);
  const W = to(-0.17, 0);
  out.push([...N, ...E, ...S, ...W, ...N]);
  out.push([...N, ...to(0, 0), ...S]);
  // Fill the north half of the needle with a few strokes.
  for (const k of [0.35, 0.7]) out.push([...to(-0.17 * (1 - k), 0.92 * k), ...to(0.17 * (1 - k), 0.92 * k)]);
  // N beyond the tip, upright.
  const [tx, ty] = to(0, 1.12);
  const dx = tx - cx;
  const dy = ty - cy;
  const dl = Math.hypot(dx, dy) || 1;
  const gap = t * 0.85;
  out.push(...letter('N', tx + (dx / dl) * gap, ty + (dy / dl) * gap + t / 2, { h: t, align: 'center' }));
  return out;
}

const BAR_METRES = [20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];

/** Ground length of a scale bar that fits in maxWidth mm, and how many parts it has. */
function barLength(cam: Camera, maxWidth: number): { m: number; parts: number } | null {
  const fit = BAR_METRES.filter((m) => m * cam.s <= maxWidth);
  if (!fit.length) return null;
  const m = fit[fit.length - 1];
  const lead = String(m).replace(/0+$/, '');
  return { m, parts: lead === '5' || lead === '25' ? 5 : 4 };
}

const distance = (m: number) => (m >= 1000 ? `${m / 1000} KM` : `${m} M`);

/** An alternating scale bar of the true scale across the sheet, with the ratio above. */
function scaleBar(cam: Camera, set: Settings, x: number, cy: number, bar: { m: number; parts: number }, t: number): Lines {
  const out: Lines = [];
  const w = bar.m * cam.s;
  const bh = Math.max(1.1, t * 0.7);
  const top = cy - bh / 2;
  out.push(...letter(`SCALE 1:${scaleText(set.scale)}`, x, top - t * 0.75, { h: t, track: 0.6 }));
  out.push(rect(x, top, x + w, top + bh));
  const seg = w / bar.parts;
  const pitch = Math.max(0.25, set.penWidth * 0.9);
  for (let i = 0; i < bar.parts; i++) {
    const sx = x + i * seg;
    if (i) out.push([sx, top, sx, top + bh]);
    if (i % 2) continue;
    // Solid parts, filled by strokes along the bar, back and forth.
    let k = 0;
    for (let y = top + pitch; y < top + bh - pitch * 0.5; y += pitch) out.push(k++ % 2 ? [sx + seg, y, sx, y] : [sx, y, sx + seg, y]);
  }
  const below = top + bh + t * 0.75 + t;
  out.push(...letter('0', x, below, { h: t, align: 'center' }));
  if (Number.isInteger(bar.m / 2)) out.push(...letter(String(bar.m / 2), x + w / 2, below, { h: t, align: 'center' }));
  out.push(...letter(distance(bar.m), x + w, below, { h: t, align: 'center' }));
  return out;
}

/** Shrink a cap height so the line fits in maxWidth. */
function fit(text: string, h: number, maxWidth: number, track = 0, min = 0.9): number {
  const w = measure(text, h, track);
  return w > maxWidth ? Math.max(min, (h * maxWidth) / w) : h;
}

export function marginalia(set: Settings, cam: Camera, frame: Frame, now = new Date()): Lines {
  const out: Lines = [];
  const H = cam.sheet[1];
  const [x0, y0, x1, y1] = cam.rect;
  const m = x0;
  const g = set.frame ? clamp(m * 0.1, 1.2, 2.5) : 0;
  const t = clamp(m * 0.085, 1.3, 2);

  if (set.frame && m >= 6) {
    out.push(rect(x0 - g, y0 - g, x1 + g, y1 + g));
    out.push(...graticule(cam, frame, g, t));
  }

  // The bottom margin carries the title on the left and the scale and north arrow on the right.
  const top = y1 + (set.frame ? g + 0.9 + t : 0) + clamp(m * 0.12, 1.5, 4);
  const bottom = H - clamp(m * 0.22, 2.5, 9);
  const room = bottom - top;
  if (room < 4.5) return out;

  const s = clamp(room * 0.13, 1.2, 2.3);
  // Room for the N above or below the needle, whichever way north points.
  const r = Math.min(8, (room - 2.8 * s) / 2);
  let right = x1;
  if (r >= 2.5) {
    out.push(...northArrow(cam, x1 - r * 1.2, (top + bottom) / 2, r, s));
    right = x1 - r * 2.4 - 6;
  }
  const bar = barLength(cam, Math.min(60, (x1 - x0) * 0.22, right - x0 - 40));
  if (bar && room >= 3 * s + 2) {
    const bw = bar.m * cam.s;
    const lw = measure(distance(bar.m), s) / 2;
    const bx = right - bw - lw;
    out.push(...scaleBar(cam, set, bx, (top + bottom) / 2, bar, s));
    right = bx - lw - 8;
  }

  const width = right - x0;
  if (width < 30) return out;
  const [clng, clat] = set.center;
  const place = letterable(set.place) ? set.place : `${lat(clat)} ${lng(clng)}`;
  // Headroom above the caps for accents, then the two small lines tucked under the title.
  const T = fit(place, Math.min(9, (room - 4.1 * s) / 1.4), width, 1.4, 2);
  const base = top + T * 1.4;
  out.push(...letter(place, x0, base, { h: T, track: 1.4 }));

  const where = `${lat(clat)} ${lng(clng)} · LOOKING ${compassWord(set.bearing)} (${Math.round(set.bearing)}°) · TILT ${Math.round(set.tilt)}°`;
  const imprint = `MAP DATA © OPENSTREETMAP CONTRIBUTORS · DRAWN WITH ISOMETRICTOWN.COM · ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
  const line1 = base + s * 2.2;
  const line2 = line1 + s * 1.9;
  out.push(...letter(where, x0, line1, { h: fit(where, s, width, 0.3), track: 0.3 }));
  out.push(...letter(imprint, x0, line2, { h: fit(imprint, s, width, 0.3), track: 0.3 }));
  return out;
}
