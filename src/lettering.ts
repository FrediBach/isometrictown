/**
 * Single-stroke capitals for the map margin, so lettering plots as one pass of the pen.
 * Glyphs sit on a grid 6 units tall: y = 0 is the cap line, y = 6 the baseline.
 * Corners are chamfered rather than round, in the manner of stencil lettering on technical drawings.
 */

type Glyph = { w: number; s: number[][] };

const O = [1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0];
const P = [0, 6, 0, 0, 3, 0, 4, 1, 4, 2.2, 3, 3.2, 0, 3.2];

const GLYPHS: Record<string, Glyph> = {
  A: { w: 4, s: [[0, 6, 2, 0, 4, 6], [0.67, 4, 3.33, 4]] },
  B: { w: 4, s: [[0, 6, 0, 0, 2.8, 0, 3.6, 0.7, 3.6, 2.2, 2.8, 2.9, 0, 2.9], [2.8, 2.9, 4, 3.8, 4, 5.1, 3.1, 6, 0, 6]] },
  C: { w: 4, s: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5]] },
  D: { w: 4, s: [[0, 0, 0, 6, 2.5, 6, 4, 4.5, 4, 1.5, 2.5, 0, 0, 0]] },
  E: { w: 3.6, s: [[3.6, 0, 0, 0, 0, 6, 3.6, 6], [0, 3, 2.8, 3]] },
  F: { w: 3.6, s: [[3.6, 0, 0, 0, 0, 6], [0, 3, 2.8, 3]] },
  G: { w: 4, s: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 3.4, 2.2, 3.4]] },
  H: { w: 4, s: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]] },
  I: { w: 0, s: [[0, 0, 0, 6]] },
  J: { w: 3, s: [[3, 0, 3, 5, 2, 6, 1, 6, 0, 5]] },
  K: { w: 4, s: [[0, 0, 0, 6], [4, 0, 0, 4], [1.4, 2.6, 4, 6]] },
  L: { w: 3.4, s: [[0, 0, 0, 6, 3.4, 6]] },
  M: { w: 5, s: [[0, 6, 0, 0, 2.5, 4, 5, 0, 5, 6]] },
  N: { w: 4, s: [[0, 6, 0, 0, 4, 6, 4, 0]] },
  O: { w: 4, s: [O] },
  P: { w: 4, s: [P] },
  Q: { w: 4, s: [O, [2.4, 4.4, 4.3, 6.4]] },
  R: { w: 4, s: [P, [2.2, 3.2, 4, 6]] },
  S: { w: 4, s: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]] },
  T: { w: 4, s: [[0, 0, 4, 0], [2, 0, 2, 6]] },
  U: { w: 4, s: [[0, 0, 0, 5, 1, 6, 3, 6, 4, 5, 4, 0]] },
  V: { w: 4, s: [[0, 0, 2, 6, 4, 0]] },
  W: { w: 5.4, s: [[0, 0, 1.35, 6, 2.7, 1.6, 4.05, 6, 5.4, 0]] },
  X: { w: 4, s: [[0, 0, 4, 6], [4, 0, 0, 6]] },
  Y: { w: 4, s: [[0, 0, 2, 3, 4, 0], [2, 3, 2, 6]] },
  Z: { w: 4, s: [[0, 0, 4, 0, 0, 6, 4, 6]] },
  '0': { w: 3.6, s: [[1, 0, 2.6, 0, 3.6, 1, 3.6, 5, 2.6, 6, 1, 6, 0, 5, 0, 1, 1, 0]] },
  '1': { w: 3.6, s: [[0.6, 1.2, 1.8, 0, 1.8, 6], [0.4, 6, 3.2, 6]] },
  '2': { w: 3.6, s: [[0, 1, 1, 0, 2.6, 0, 3.6, 1, 3.6, 2.2, 0, 6, 3.6, 6]] },
  '3': { w: 3.6, s: [[0, 1, 1, 0, 2.6, 0, 3.6, 1, 3.6, 2, 2.6, 2.9, 1.4, 2.9], [2.6, 2.9, 3.6, 3.8, 3.6, 5, 2.6, 6, 1, 6, 0, 5]] },
  '4': { w: 3.6, s: [[2.8, 6, 2.8, 0, 0, 4.2, 3.6, 4.2]] },
  '5': { w: 3.6, s: [[3.4, 0, 0.3, 0, 0, 2.8, 2.6, 2.6, 3.6, 3.6, 3.6, 5, 2.6, 6, 1, 6, 0, 5]] },
  '6': { w: 3.6, s: [[3.4, 0.6, 2.6, 0, 1, 0, 0, 1, 0, 5, 1, 6, 2.6, 6, 3.6, 5, 3.6, 3.8, 2.6, 2.8, 1, 2.8, 0, 3.8]] },
  '7': { w: 3.6, s: [[0, 0, 3.6, 0, 1.3, 6]] },
  '8': { w: 3.6, s: [[1, 2.9, 0.2, 2, 0.2, 1, 1, 0, 2.6, 0, 3.4, 1, 3.4, 2, 2.6, 2.9, 1, 2.9, 0, 3.9, 0, 5, 1, 6, 2.6, 6, 3.6, 5, 3.6, 3.9, 2.6, 2.9]] },
  '9': { w: 3.6, s: [[0.2, 5.4, 1, 6, 2.6, 6, 3.6, 5, 3.6, 1, 2.6, 0, 1, 0, 0, 1, 0, 2.2, 1, 3.2, 2.6, 3.2, 3.6, 2.2]] },
  '.': { w: 0, s: [[0, 5.5, 0, 6]] },
  ',': { w: 0.4, s: [[0.4, 5.4, 0.4, 6, 0, 6.9]] },
  ':': { w: 0, s: [[0, 1.6, 0, 2.1], [0, 5.5, 0, 6]] },
  ';': { w: 0.4, s: [[0.4, 1.6, 0.4, 2.1], [0.4, 5.4, 0.4, 6, 0, 6.9]] },
  '-': { w: 2.4, s: [[0, 3.2, 2.4, 3.2]] },
  '–': { w: 3.4, s: [[0, 3.2, 3.4, 3.2]] },
  '/': { w: 3, s: [[3, 0, 0, 6]] },
  '(': { w: 1.2, s: [[1.2, -0.3, 0, 1.4, 0, 4.6, 1.2, 6.3]] },
  ')': { w: 1.2, s: [[0, -0.3, 1.2, 1.4, 1.2, 4.6, 0, 6.3]] },
  "'": { w: 0, s: [[0, 0, 0, 1.6]] },
  '’': { w: 0.4, s: [[0.4, 0, 0, 1.6]] },
  '&': { w: 4, s: [[4, 6, 0.6, 2.2, 0.6, 0.8, 1.4, 0, 2.4, 0, 3, 0.8, 3, 1.6, 0, 3.8, 0, 5, 1, 6, 2.4, 6, 4, 3.6]] },
  '+': { w: 3, s: [[0, 3.2, 3, 3.2], [1.5, 1.7, 1.5, 4.7]] },
  '×': { w: 2.6, s: [[0, 1.9, 2.6, 4.5], [2.6, 1.9, 0, 4.5]] },
  '·': { w: 0, s: [[0, 2.9, 0, 3.4]] },
  '°': { w: 1.4, s: [[0.5, 0, 0.9, 0, 1.4, 0.5, 1.4, 0.9, 0.9, 1.4, 0.5, 1.4, 0, 0.9, 0, 0.5, 0.5, 0]] },
  '′': { w: 0.6, s: [[0.6, 0, 0, 1.7]] },
  '″': { w: 1.6, s: [[0.6, 0, 0, 1.7], [1.6, 0, 1, 1.7]] },
  '©': { w: 6, s: [[2, 0, 4, 0, 6, 2, 6, 4, 4, 6, 2, 6, 0, 4, 0, 2, 2, 0], [4, 2.2, 3.5, 1.7, 2.5, 1.7, 1.9, 2.3, 1.9, 3.7, 2.5, 4.3, 3.5, 4.3, 4, 3.8]] },
};

/** Accents, as combining marks after NFKD, drawn over the letter's centre c. */
const MARKS: Record<string, (c: number) => number[][]> = {
  '̀': (c) => [[c - 0.6, -2, c + 0.4, -0.9]],
  '́': (c) => [[c - 0.4, -0.9, c + 0.6, -2]],
  '̂': (c) => [[c - 1, -0.9, c, -1.9, c + 1, -0.9]],
  '̃': (c) => [[c - 1.2, -1.1, c - 0.5, -1.8, c + 0.5, -1.1, c + 1.2, -1.8]],
  '̈': (c) => [[c - 0.9, -1.6, c - 0.9, -1.1], [c + 0.9, -1.6, c + 0.9, -1.1]],
  '̊': (c) => [[c - 0.4, -2.2, c + 0.4, -2.2, c + 0.6, -1.6, c + 0.4, -1, c - 0.4, -1, c - 0.6, -1.6, c - 0.4, -2.2]],
  '̌': (c) => [[c - 1, -1.9, c, -0.9, c + 1, -1.9]],
  '̧': (c) => [[c, 6, c + 0.6, 6.7, c - 0.3, 7.3]],
  '̨': (c) => [[c + 0.8, 6, c, 6.6, c + 0.9, 7.3]],
};

/** Letters NFKD leaves whole, spelled with the ones we have. */
const SPELL: Record<string, string> = { Æ: 'AE', Œ: 'OE', Ø: 'O', Ł: 'L', Đ: 'D', Þ: 'TH', Ð: 'D', Ħ: 'H', ẞ: 'SS', '‘': "'", '"': '″', '“': '″', '”': '″', '—': '–' };

const GAP = 1.6;
const SPACE = 2.8;

type Item = { g: Glyph | null; marks: string[] };

function items(text: string): Item[] {
  const out: Item[] = [];
  for (const ch of text.toUpperCase().normalize('NFKD')) {
    if (MARKS[ch]) {
      out[out.length - 1]?.marks.push(ch);
      continue;
    }
    if (/\p{M}/u.test(ch)) continue;
    const spelled = SPELL[ch] ?? ch;
    for (const c of spelled) out.push({ g: c === ' ' ? null : (GLYPHS[c] ?? null), marks: [] });
  }
  return out;
}

const advance = (it: Item, track: number) => (it.g ? it.g.w + GAP + track : SPACE + track);

/** True when every character of the text has a glyph, so it can be lettered as written. */
export function letterable(text: string): boolean {
  for (const ch of text.toUpperCase().normalize('NFKD')) {
    if (ch === ' ' || MARKS[ch] || /\p{M}/u.test(ch)) continue;
    for (const c of SPELL[ch] ?? ch) if (!GLYPHS[c]) return false;
  }
  return true;
}

/** Width of a line of lettering in mm, at cap height h. */
export function measure(text: string, h: number, track = 0): number {
  const list = items(text);
  let w = 0;
  for (const it of list) w += advance(it, track);
  return list.length ? ((w - GAP - track) * h) / 6 : 0;
}

export type Letter = {
  /** Cap height in mm. */
  h: number;
  align?: 'left' | 'center' | 'right';
  /** Extra letter spacing, in grid units. */
  track?: number;
  /** Reading direction as a unit vector on the sheet; letters stand up to its left. */
  dir?: [number, number];
};

/** Polylines for a line of lettering, with (x, y) on the baseline at the alignment point. */
export function letter(text: string, x: number, y: number, o: Letter): number[][] {
  const u = o.h / 6;
  const track = o.track ?? 0;
  const [dx, dy] = o.dir ?? [1, 0];
  const [ux, uy] = [dy, -dx];
  const w = measure(text, o.h, track);
  let pen = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
  const out: number[][] = [];
  const put = (gx: number, s: number[]) => {
    const line: number[] = [];
    for (let i = 0; i < s.length; i += 2) {
      const lx = pen + (gx + s[i]) * u;
      const up = (6 - s[i + 1]) * u;
      line.push(x + lx * dx + up * ux, y + lx * dy + up * uy);
    }
    out.push(line);
  };
  for (const it of items(text)) {
    if (it.g) {
      for (const s of it.g.s) put(0, s);
      for (const m of it.marks) for (const s of MARKS[m](it.g.w / 2)) put(0, s);
    }
    pen += advance(it, track) * u;
  }
  return out;
}
