/**
 * G-code for GRBL pen plotters, tuned for the UUNA TEK 3.0 (a DrawCore board running GRBL 1.1).
 *
 * The pen hangs on a real Z axis: Z0 holds it up and a larger Z presses it onto the paper.
 * X grows to the right and Y grows towards you, so with the work origin on the top-left
 * corner of the paper the sheet's own millimetres (y down) go straight through.
 */

/** One pen's strokes in sheet millimetres, in plot order, as read back from the finished SVG. */
export type PenLayer = { pen: number; label: string; color: string; lines: number[][] };

/** How the plotter is set up. It belongs to the machine, not the drawing, so it is kept apart from `Settings`. */
export type PlotterSetup = {
  /** Z height that presses the pen onto the paper, in mm. */
  penDown: number;
  /** Z height that holds the pen clear of the paper, in mm. */
  penUp: number;
  /** Which corner of the paper the work origin sits on. Top left suits the UUNA TEK, whose Y grows towards you. */
  corner: 'top-left' | 'bottom-left';
  /** Turn the drawing a quarter turn clockwise, to plot a portrait sheet on a landscape bed. */
  turn: boolean;
};

export const DEFAULT_SETUP: PlotterSetup = { penDown: 10, penUp: 0, corner: 'top-left', turn: false };

/** Pen lift and drop speed, in mm/min. */
export const Z_FEED = 2500;
/** Paths are simplified to this deviation, in mm: far below a pen's width, but it spares GRBL's planner many tiny moves. */
const SIMPLIFY = 0.02;

/** Read the pen layers back from a drawing made by `toSvg()`, skipping empty pens. */
export function layersOf(svg: string): PenLayer[] {
  const out: PenLayer[] = [];
  const re = /<g [^>]*inkscape:label="([^"]*)" id="pen-(\d+)" fill="none" stroke="([^"]*)"[^>]*><path d="([^"]*)"\/><\/g>/g;
  for (let m = re.exec(svg); m; m = re.exec(svg)) {
    const lines = parsePath(m[4]);
    if (lines.length) out.push({ pen: Number(m[2]) - 1, label: m[1].replace(/^\d+ /, ''), color: m[3], lines });
  }
  return out;
}

/** Path data of only M and L commands (what `pathData()` writes) as polylines. */
function parsePath(d: string): number[][] {
  const lines: number[][] = [];
  let cur: number[] | null = null;
  const re = /([ML])(-?[\d.]+) (-?[\d.]+)/g;
  for (let m = re.exec(d); m; m = re.exec(d)) {
    if (m[1] === 'M') {
      cur = [];
      lines.push(cur);
    }
    cur!.push(Number(m[2]), Number(m[3]));
  }
  return lines.filter((l) => l.length >= 4);
}

/** The bed area the drawing takes up on the plotter, in mm, after any turn. */
export function bedSize(sheet: [number, number], setup: PlotterSetup): [number, number] {
  return setup.turn ? [sheet[1], sheet[0]] : sheet;
}

/** Maps sheet mm (y down) to machine mm for a setup. */
export function machine(sheet: [number, number], setup: PlotterSetup): (x: number, y: number) => [number, number] {
  const h = sheet[1];
  const bh = bedSize(sheet, setup)[1];
  return (x, y) => {
    let X = x;
    let Y = y;
    if (setup.turn) {
      X = h - y;
      Y = x;
    }
    if (setup.corner === 'bottom-left') Y = bh - Y;
    return [X, Y];
  };
}

/** Ramer–Douglas–Peucker on a flat polyline, keeping its ends. */
function simplify(l: number[], eps: number): number[] {
  const n = l.length / 2;
  if (n < 3) return l;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [0, n - 1];
  const e2 = eps * eps;
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const ax = l[a * 2];
    const ay = l[a * 2 + 1];
    const dx = l[b * 2] - ax;
    const dy = l[b * 2 + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = e2;
    for (let i = a + 1; i < b; i++) {
      const px = l[i * 2] - ax;
      const py = l[i * 2 + 1] - ay;
      let d: number;
      if (len2 === 0) d = px * px + py * py;
      else {
        const c = px * dy - py * dx;
        d = (c * c) / len2;
      }
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push(a, best, best, b);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(l[i * 2], l[i * 2 + 1]);
  return out;
}

const f = (v: number) => (Math.round(v * 100) / 100).toString();

/** Lines that lift the pen. */
export const penUp = (setup: PlotterSetup) => `G1 Z${f(setup.penUp)} F${Z_FEED}`;
/** Lines that lower the pen. */
export const penDown = (setup: PlotterSetup) => `G1 Z${f(setup.penDown)} F${Z_FEED}`;

/**
 * One pen's strokes as G-code moves, without header or pauses. Travel is rapid (G0),
 * which GRBL caps at the machine's own top speed ($110/$111), and drawing runs at `feed` mm/min.
 */
export function layerCode(layer: PenLayer, sheet: [number, number], setup: PlotterSetup, feed: number): string[] {
  const to = machine(sheet, setup);
  const out: string[] = [];
  const up = penUp(setup);
  const down = penDown(setup);
  for (const raw of layer.lines) {
    const l = simplify(raw, SIMPLIFY);
    const [x0, y0] = to(l[0], l[1]);
    out.push(`G0 X${f(x0)} Y${f(y0)}`, down);
    for (let i = 2; i < l.length; i += 2) {
      const [x, y] = to(l[i], l[i + 1]);
      out.push(i === 2 ? `G1 X${f(x)} Y${f(y)} F${Math.round(feed)}` : `G1 X${f(x)} Y${f(y)}`);
    }
    out.push(up);
  }
  return out;
}

/** Lines that put the machine in millimetres and absolute moves with the pen up. */
export const preamble = (setup: PlotterSetup) => ['G21', 'G90', penUp(setup)];

/** Lift the pen and go back to the origin, where pens are swapped. */
export const park = (setup: PlotterSetup) => [penUp(setup), 'G0 X0 Y0'];

/** The sheet's outline traced with the pen up, to check the paper is placed right. */
export function outline(sheet: [number, number], setup: PlotterSetup): string[] {
  const [w, h] = bedSize(sheet, setup);
  return [penUp(setup), 'G0 X0 Y0', `G0 X${f(w)} Y0`, `G0 X${f(w)} Y${f(h)}`, `G0 X0 Y${f(h)}`, 'G0 X0 Y0'];
}

type FileInfo = { title: string; sheet: [number, number]; setup: PlotterSetup; feed: number };

/**
 * A whole plot as one G-code file for a sender such as Universal Gcode Sender. It sets the
 * origin where the pen stands, then plots each pen in turn with an M0 pause to swap pens.
 */
export function gcodeFile(layers: PenLayer[], info: FileInfo): string {
  const { setup, sheet, feed } = info;
  const [bw, bh] = bedSize(sheet, setup);
  const corner = setup.corner;
  const head = [
    `; ${info.title.replace(/[\r\n]+/g, ' ')}`,
    '; Made with Isometric Town, isometrictown.com. Map data (c) OpenStreetMap contributors.',
    `; GRBL 1.1 G-code for the UUNA TEK 3.0 pen plotter. Plot area ${f(bw)} x ${f(bh)} mm${setup.turn ? ', drawing turned a quarter turn clockwise' : ''}.`,
    `; Before you start: raise the pen and move it over the ${corner} corner of the paper.`,
    `; Pen up Z${f(setup.penUp)}, pen down Z${f(setup.penDown)}, drawing at ${Math.round(feed)} mm/min.`,
    `; ${layers.length} pen${layers.length === 1 ? '' : 's'}. The plot pauses (M0) before each new pen: swap it, then resume.`,
    ...preamble(setup),
    'G92 X0 Y0',
  ];
  const body: string[] = [];
  layers.forEach((layer, i) => {
    body.push('', `; Pen ${i + 1} of ${layers.length}: ${layer.label} (${layer.color})`);
    if (i > 0) body.push(...park(setup), `M0 ; Put in pen ${i + 1}, ${layer.label}, then resume`);
    // A pen can run to hundreds of thousands of lines, too many to spread into push().
    for (const line of layerCode(layer, sheet, setup, feed)) body.push(line);
  });
  return [...head, ...body, '', '; Done', ...park(setup), ''].join('\n');
}
