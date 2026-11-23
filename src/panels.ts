import { plan, pathData, svgDocument, type PenStats, type PlotStats } from './plot';
import { sheetSize, type Settings } from './settings';

/**
 * A drawing split over several sheets, each printed on its own and hung side by side so they
 * make the whole again. The camera draws the whole wall at once, sheets and the gaps between
 * them, so a street leaving one sheet comes back on the next where it would really be; what
 * falls in the margins and gaps is cut away. See docs/coordinates.md#panels.
 */

/** Most sheets across or down. */
export const PANELS_MAX = 4;
/** Widest gap between sheets, mm. */
export const PANEL_GAP_MAX = 200;

/** How a drawing is split over sheets. Sheets are numbered across, then down, from the top left. */
export type Layout = {
  cols: number;
  rows: number;
  /** One sheet, mm. */
  sheet: [number, number];
  /** Space between neighbouring sheets, mm. */
  gap: number;
  /** All the sheets as they hang, gaps included, mm. */
  wall: [number, number];
};

type PanelSettings = Pick<Settings, 'sheet' | 'landscape'> & Partial<Pick<Settings, 'panelCols' | 'panelRows' | 'panelGap'>>;

const count = (v: number | undefined) => Math.max(1, Math.min(PANELS_MAX, Math.round(v ?? 1) || 1));

export function layout(set: PanelSettings): Layout {
  const sheet = sheetSize(set);
  const cols = count(set.panelCols);
  const rows = count(set.panelRows);
  const gap = cols * rows > 1 ? Math.max(0, Math.min(PANEL_GAP_MAX, set.panelGap ?? 0)) : 0;
  return { cols, rows, sheet, gap, wall: [cols * sheet[0] + (cols - 1) * gap, rows * sheet[1] + (rows - 1) * gap] };
}

export const panelCount = (l: Layout) => l.cols * l.rows;

/** Top-left corner of sheet `i` on the wall, mm. */
export function panelOrigin(l: Layout, i: number): [number, number] {
  return [(i % l.cols) * (l.sheet[0] + l.gap), Math.floor(i / l.cols) * (l.sheet[1] + l.gap)];
}

/** Which sheet a wall position lies on, or -1 in a gap or beyond the wall. */
export function panelAt(l: Layout, x: number, y: number): number {
  const [w, h] = l.sheet;
  const c = Math.floor(x / (w + l.gap));
  const r = Math.floor(y / (h + l.gap));
  if (c < 0 || r < 0 || c >= l.cols || r >= l.rows) return -1;
  const eps = 1e-6;
  if (x - c * (w + l.gap) > w + eps || y - r * (h + l.gap) > h + eps) return -1;
  return r * l.cols + c;
}

/** A sheet's place in the set, for titles and file names: row and column from one. */
export function panelName(l: Layout, i: number): { row: number; col: number } {
  return { row: Math.floor(i / l.cols) + 1, col: (i % l.cols) + 1 };
}

type Rect = readonly [number, number, number, number];

/** The pieces of a polyline inside any of some rectangles that don't overlap. */
export function clipToRects(line: number[], rects: readonly Rect[]): number[][] {
  let bx0 = line[0], bx1 = bx0, by0 = line[1], by1 = by0;
  for (let i = 2; i < line.length; i += 2) {
    bx0 = Math.min(bx0, line[i]); bx1 = Math.max(bx1, line[i]);
    by0 = Math.min(by0, line[i + 1]); by1 = Math.max(by1, line[i + 1]);
  }
  const out: number[][] = [];
  for (const [x0, y0, x1, y1] of rects) {
    if (bx1 < x0 || bx0 > x1 || by1 < y0 || by0 > y1) continue;
    if (bx0 >= x0 && bx1 <= x1 && by0 >= y0 && by1 <= y1) return [line];
    let run: number[] = [];
    const end = () => {
      if (run.length >= 4 && (run[0] !== run[run.length - 2] || run[1] !== run[run.length - 1] || run.length > 4)) out.push(run);
      run = [];
    };
    for (let i = 2; i < line.length; i += 2) {
      const ax = line[i - 2], ay = line[i - 1];
      const dx = line[i] - ax, dy = line[i + 1] - ay;
      // Liang–Barsky: the part of the segment between t0 and t1 lies inside.
      let t0 = 0, t1 = 1;
      const edge = (p: number, q: number) => {
        if (p === 0) return q >= 0;
        const t = q / p;
        if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
        return true;
      };
      if (!(edge(-dx, ax - x0) && edge(dx, x1 - ax) && edge(-dy, ay - y0) && edge(dy, y1 - ay))) {
        end();
        continue;
      }
      if (t0 > 0) end();
      if (!run.length) run.push(ax + dx * t0, ay + dy * t0);
      run.push(ax + dx * t1, ay + dy * t1);
      if (t1 < 1) end();
    }
    end();
  }
  return out;
}

/** Cut every stroke to the drawing areas of the sheets, keeping the catalogue's references to the same strokes. */
export function trimToPanels(pens: number[][][], tally: Map<string, number[][]> | null, rects: readonly Rect[]): void {
  const changes = new Map<number[], number[][]>();
  for (let p = 0; p < pens.length; p++) {
    const kept: number[][] = [];
    for (const line of pens[p]) {
      const pieces = clipToRects(line, rects);
      for (const piece of pieces) kept.push(piece);
      if (tally && pieces[0] !== line) changes.set(line, pieces);
    }
    pens[p] = kept;
  }
  if (tally && changes.size) for (const [name, lines] of tally) {
    const kept = lines.flatMap((line) => changes.get(line) ?? [line]);
    if (kept.length) tally.set(name, kept);
    else tally.delete(name);
  }
}

/**
 * Plan a drawing and write its SVG. One sheet is planned and written as it always was. A set
 * of sheets is split by sheet, each planned from its own corner as it will be plotted, and
 * written as one wall-sized SVG: a path per sheet in each pen's layer, `data-panel` numbering
 * it and a translate placing it, from which `panelSvg()` takes each sheet's own file.
 */
export function planDrawing(pens: number[][][], set: Settings, l: Layout): { svg: string; stats: PlotStats } {
  if (panelCount(l) === 1) {
    const planned = plan(pens, set);
    return { svg: svgDocument(planned.pens, set, l.sheet), stats: planned.stats };
  }
  const split = Array.from({ length: panelCount(l) }, () => pens.map(() => [] as number[][]));
  pens.forEach((lines, p) => {
    for (const line of lines) {
      const i = panelAt(l, (line[0] + line[line.length - 2]) / 2, (line[1] + line[line.length - 1]) / 2);
      if (i < 0) continue;
      const [ox, oy] = panelOrigin(l, i);
      const moved = new Array<number>(line.length);
      for (let k = 0; k < line.length; k += 2) {
        moved[k] = line[k] - ox;
        moved[k + 1] = line[k + 1] - oy;
      }
      split[i][p].push(moved);
    }
  });
  const plans = split.map((sheetPens) => plan(sheetPens, set));
  const paths = pens.map((_, p) => plans.flatMap((planned, i) => {
    if (!planned.pens[p].length) return [];
    const [ox, oy] = panelOrigin(l, i);
    return [`<path data-panel="${i + 1}" transform="translate(${ox} ${oy})" d="${pathData(planned.pens[p])}"/>`];
  }).join(''));
  const svg = svgDocument(paths, set, l.wall, `${l.cols} × ${l.rows} sheets of ${l.sheet[0]} × ${l.sheet[1]} mm, hung ${Math.round(l.gap)} mm apart.`);
  return { svg, stats: mergeStats(plans.map((p) => p.stats)) };
}

/** Stats for a set of sheets: each pen's ink, lifts, travel and time over all of them. */
function mergeStats(all: PlotStats[]): PlotStats {
  const pens: PenStats[] = all[0].pens.map((p, i) => ({
    ...p,
    ink: all.reduce((s, a) => s + a.pens[i].ink, 0),
    lifts: all.reduce((s, a) => s + a.pens[i].lifts, 0),
    travel: all.reduce((s, a) => s + a.pens[i].travel, 0),
    seconds: all.reduce((s, a) => s + a.pens[i].seconds, 0),
  }));
  const sum = (k: 'rawLifts' | 'rawTravel' | 'lifts' | 'travel' | 'ink' | 'seconds') => all.reduce((s, a) => s + a[k], 0);
  return { pens, rawLifts: sum('rawLifts'), rawTravel: sum('rawTravel'), lifts: sum('lifts'), travel: sum('travel'), ink: sum('ink'), seconds: sum('seconds') };
}

/** One sheet's own plotter-ready SVG out of a set's wall SVG (see `planDrawing()`), at its own size with its corner at the origin. */
export function panelSvg(svg: string, l: Layout, i: number): string {
  if (panelCount(l) === 1) return svg;
  const [w, h] = l.sheet;
  const { row, col } = panelName(l, i);
  const marker = `<path data-panel="${i + 1}" `;
  return svg
    .replace(/(<svg\b[^>]*?) width="[^"]*" height="[^"]*" viewBox="[^"]*"/, `$1 width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}"`)
    .replace(/<title>([^<]*)<\/title>/, `<title>$1, sheet ${i + 1} of ${panelCount(l)} (row ${row}, column ${col})</title>`)
    .replace(/(<g [^>]*id="pen-\d+"[^>]*>)(.*?)<\/g>\n?/gs, (_, head: string, body: string) => {
      const at = body.indexOf(marker);
      if (at < 0) return '';
      const d = /d="([^"]*)"/.exec(body.slice(at + marker.length))![1];
      return `${head}<path d="${d}"/></g>\n`;
    });
}
