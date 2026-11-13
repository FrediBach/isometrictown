import { PEN_NAMES, type Settings } from './settings';

export type PenStats = { name: string; color: string; ink: number; lifts: number; travel: number; seconds: number };
export type PlotStats = {
  pens: PenStats[];
  rawLifts: number;
  rawTravel: number;
  lifts: number;
  travel: number;
  ink: number;
  seconds: number;
};

const JOIN_TOL = 0.03;
const LIFT_SECONDS = 0.3;

function length(l: number[]): number {
  let s = 0;
  for (let i = 2; i < l.length; i += 2) s += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
  return s;
}

function travelOf(lines: number[][]): number {
  let x = 0;
  let y = 0;
  let t = 0;
  for (const l of lines) {
    t += Math.hypot(l[0] - x, l[1] - y);
    x = l[l.length - 2];
    y = l[l.length - 1];
  }
  return t + Math.hypot(x, y);
}

function reversed(l: number[]): number[] {
  const out = new Array<number>(l.length);
  for (let i = 0; i < l.length; i += 2) {
    out[l.length - 2 - i] = l[i];
    out[l.length - 1 - i] = l[i + 1];
  }
  return out;
}

/** Merge polylines that share endpoints into longer strokes. */
export function join(lines: number[][]): number[][] {
  const key = (x: number, y: number) => Math.round(x / JOIN_TOL) * 1048576 + Math.round(y / JOIN_TOL);
  const ends = new Map<number, number[]>();
  const add = (k: number, v: number) => {
    const list = ends.get(k);
    if (list) list.push(v);
    else ends.set(k, [v]);
  };
  lines.forEach((l, i) => {
    add(key(l[0], l[1]), i * 2);
    add(key(l[l.length - 2], l[l.length - 1]), i * 2 + 1);
  });
  const used = new Uint8Array(lines.length);
  const take = (x: number, y: number): number[] | null => {
    const list = ends.get(key(x, y));
    if (!list) return null;
    while (list.length) {
      const v = list.pop()!;
      const i = v >> 1;
      if (used[i]) continue;
      used[i] = 1;
      return v & 1 ? reversed(lines[i]) : lines[i];
    }
    return null;
  };
  const out: number[][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    let chain = lines[i].slice();
    for (;;) {
      const next = take(chain[chain.length - 2], chain[chain.length - 1]);
      if (!next) break;
      for (let k = 2; k < next.length; k++) chain.push(next[k]);
    }
    for (;;) {
      const prev = take(chain[0], chain[1]);
      if (!prev) break;
      const r = reversed(prev);
      chain = r.slice(0, r.length - 2).concat(chain);
    }
    out.push(chain);
  }
  return out;
}

/** Greedy nearest-neighbour ordering, flipping strokes when their far end is closer. */
export function order(lines: number[][]): number[][] {
  const n = lines.length;
  if (n < 2) return lines;
  const CELL = 6;
  const grid = new Map<number, number[]>();
  const cellKey = (cx: number, cy: number) => cx * 65536 + cy;
  const put = (x: number, y: number, v: number) => {
    const k = cellKey(Math.floor(x / CELL), Math.floor(y / CELL));
    const list = grid.get(k);
    if (list) list.push(v);
    else grid.set(k, [v]);
  };
  lines.forEach((l, i) => {
    put(l[0], l[1], i * 2);
    put(l[l.length - 2], l[l.length - 1], i * 2 + 1);
  });
  let maxR = 0;
  for (const l of lines) maxR = Math.max(maxR, Math.abs(l[0]), Math.abs(l[1]), Math.abs(l[l.length - 2]), Math.abs(l[l.length - 1]));
  maxR = Math.ceil(maxR / CELL) + 2;
  const used = new Uint8Array(n);
  const out: number[][] = [];
  let x = 0;
  let y = 0;
  let left = n;
  while (left) {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    let best = -1;
    let bestD = Infinity;
    const visit = (gx: number, gy: number) => {
      const list = grid.get(cellKey(gx, gy));
      if (!list) return;
      for (let k = list.length - 1; k >= 0; k--) {
        const v = list[k];
        const li = v >> 1;
        if (used[li]) {
          list[k] = list[list.length - 1];
          list.pop();
          continue;
        }
        const l = lines[li];
        const px = v & 1 ? l[l.length - 2] : l[0];
        const py = v & 1 ? l[l.length - 1] : l[1];
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
    };
    for (let r = 0; r <= maxR; r++) {
      if (best >= 0 && (r - 1) * CELL > Math.sqrt(bestD)) break;
      if (r === 0) visit(cx, cy);
      for (let i = -r; i <= r && r > 0; i++) {
        visit(cx + i, cy - r);
        visit(cx + i, cy + r);
        if (i > -r && i < r) {
          visit(cx - r, cy + i);
          visit(cx + r, cy + i);
        }
      }
    }
    if (best < 0) break;
    const li = best >> 1;
    used[li] = 1;
    left--;
    const l = best & 1 ? reversed(lines[li]) : lines[li];
    out.push(l);
    x = l[l.length - 2];
    y = l[l.length - 1];
  }
  return out;
}

export type Plotted = { pens: number[][][]; stats: PlotStats };

/** Join, sort and measure every pen. */
export function plan(raw: number[][][], set: Settings): Plotted {
  const sources = set.mono ? [[], [], [], raw.flat()] : raw;
  const pens: number[][][] = [];
  const stats: PenStats[] = [];
  let rawLifts = 0;
  let rawTravel = 0;
  const v = set.speed;
  sources.forEach((lines, i) => {
    rawLifts += lines.length;
    rawTravel += lines.length ? travelOf(lines) : 0;
    const sorted = order(join(lines));
    pens.push(sorted);
    const ink = sorted.reduce((s, l) => s + length(l), 0);
    const travel = sorted.length ? travelOf(sorted) : 0;
    stats.push({
      name: PEN_NAMES[i],
      color: set.pens[i],
      ink,
      lifts: sorted.length,
      travel,
      seconds: ink / v + travel / (v * 2) + sorted.length * LIFT_SECONDS,
    });
  });
  return {
    pens,
    stats: {
      pens: stats,
      rawLifts,
      rawTravel,
      lifts: stats.reduce((s, p) => s + p.lifts, 0),
      travel: stats.reduce((s, p) => s + p.travel, 0),
      ink: stats.reduce((s, p) => s + p.ink, 0),
      seconds: stats.reduce((s, p) => s + p.seconds, 0),
    },
  };
}

function pathData(lines: number[][]): string {
  const parts: string[] = [];
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  for (const l of lines) {
    let d = `M${f(l[0])} ${f(l[1])}`;
    for (let i = 2; i < l.length; i += 2) d += `L${f(l[i])} ${f(l[i + 1])}`;
    parts.push(d);
  }
  return parts.join('');
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** A plotter-ready SVG in millimetres, one Inkscape layer per pen in plot order. */
export function toSvg(pens: number[][][], set: Settings, sheet: [number, number]): string {
  const [w, h] = sheet;
  const layers = pens
    .map((lines, i) => {
      if (!lines.length) return '';
      const label = set.mono ? 'Black' : `${i + 1} ${PEN_NAMES[i]}`;
      return `<g inkscape:groupmode="layer" inkscape:label="${label}" id="pen-${i + 1}" fill="none" stroke="${escape(set.mono ? '#000000' : set.pens[i])}" stroke-width="${Number(set.penWidth)}" stroke-linecap="round" stroke-linejoin="round"><path d="${pathData(lines)}"/></g>`;
    })
    .join('\n');
  const [lng, lat] = set.center;
  const desc = `${set.place} (${lat.toFixed(5)}, ${lng.toFixed(5)}), bearing ${Math.round(set.bearing)}°, 1:${Math.round(set.scale)}. Made with Isometric Town, isometrictown.com. Map data © OpenStreetMap contributors.`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">
<title>${escape(set.place)}, Isometric Town</title>
<desc>${escape(desc)}</desc>
${layers}
</svg>
`;
}
