/**
 * Thumbnails for comparing two drawings at the size the preview shows them (the Fit view, about
 * 900 px across): each pen's strokes are stamped in its colour, the result is blurred a little,
 * and the share of pixels that differ by more than a threshold says how different the sheets
 * look at a glance (docs/solarpunk/bolder-plan.md §8).
 */
/** Preview width in pixels. */
export const THUMB_WIDTH = 900;
/** A pixel counts as changed when a colour channel moves by more than this, 0–255. */
const THRESHOLD = 24;
/** Strokes are stamped at this many samples per pixel each way, then averaged. */
const SS = 2;

export type Thumb = { w: number; h: number; rgb: Uint8Array };

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** Stamp a drawing's pens (sheet mm) on a sheet `size` mm wide, in their colours over the background, and blur it. */
export function thumb(pens: number[][][], colours: string[], background: string, size: [number, number], nib: number): Thumb {
  const k = THUMB_WIDTH / size[0];
  const w = THUMB_WIDTH;
  const h = Math.round(size[1] * k);
  const W = w * SS;
  const H = h * SS;
  const r = Math.max(0.5, (nib / 2) * k * SS);
  const disc: number[] = [];
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r * r + 0.25) disc.push(dx, dy);
  const bg = hex(background);
  const out = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) out.set(bg, i * 3);
  const ink = new Uint8Array(W * H);
  const cover = new Float32Array(w * h);
  pens.forEach((lines, p) => {
    if (!lines.length) return;
    ink.fill(0);
    for (const l of lines) {
      for (let i = 2; i < l.length; i += 2) {
        const ax = l[i - 2] * k * SS;
        const ay = l[i - 1] * k * SS;
        const bx = l[i] * k * SS;
        const by = l[i + 1] * k * SS;
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
        for (let s = i === 2 ? 0 : 1; s <= n; s++) {
          const px = Math.round(ax + ((bx - ax) * s) / n);
          const py = Math.round(ay + ((by - ay) * s) / n);
          for (let d = 0; d < disc.length; d += 2) {
            const x = px + disc[d];
            const y = py + disc[d + 1];
            if (x >= 0 && y >= 0 && x < W && y < H) ink[y * W + x] = 1;
          }
        }
      }
    }
    cover.fill(0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink[y * W + x]) cover[Math.floor(y / SS) * w + Math.floor(x / SS)] += 1 / (SS * SS);
    // Inks multiply over the paper, as layered pens do.
    const c = hex(colours[p] ?? '#000000');
    for (let i = 0; i < w * h; i++) {
      const a = cover[i];
      if (!a) continue;
      for (let ch = 0; ch < 3; ch++) out[i * 3 + ch] *= 1 - a + (a * c[ch]) / 255;
    }
  });
  blur(out, w, h);
  blur(out, w, h);
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(out[i]);
  return { w, h, rgb };
}

/** A 3 × 3 box blur, in place. */
function blur(px: Float32Array, w: number, h: number): void {
  const tmp = new Float32Array(px.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let ch = 0; ch < 3; ch++) {
        let s = 0;
        let n = 0;
        for (let d = -1; d <= 1; d++) {
          const xx = x + d;
          if (xx < 0 || xx >= w) continue;
          s += px[(y * w + xx) * 3 + ch];
          n++;
        }
        tmp[(y * w + x) * 3 + ch] = s / n;
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let ch = 0; ch < 3; ch++) {
        let s = 0;
        let n = 0;
        for (let d = -1; d <= 1; d++) {
          const yy = y + d;
          if (yy < 0 || yy >= h) continue;
          s += tmp[(yy * w + x) * 3 + ch];
          n++;
        }
        px[(y * w + x) * 3 + ch] = s / n;
      }
}

/** Share of pixels inside `rect` (sheet mm, on a sheet `width` mm wide) where the two thumbnails differ. */
export function difference(a: Thumb, b: Thumb, rect: [number, number, number, number], width: number): number {
  const k = a.w / width;
  const x0 = Math.max(0, Math.floor(rect[0] * k));
  const y0 = Math.max(0, Math.floor(rect[1] * k));
  const x1 = Math.min(a.w, Math.ceil(rect[2] * k));
  const y1 = Math.min(a.h, Math.ceil(rect[3] * k));
  let moved = 0;
  let all = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * a.w + x) * 3;
      all++;
      if (Math.abs(a.rgb[i] - b.rgb[i]) > THRESHOLD || Math.abs(a.rgb[i + 1] - b.rgb[i + 1]) > THRESHOLD || Math.abs(a.rgb[i + 2] - b.rgb[i + 2]) > THRESHOLD) moved++;
    }
  return all ? moved / all : 0;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** A thumbnail as a PNG file; `deflate` is zlib's (`node:zlib` deflateSync), passed in so this module stays free of Node. */
export function png(t: Thumb, deflate: (raw: Uint8Array) => Uint8Array): Uint8Array {
  const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const chunk = (type: string, data: Uint8Array): number[] => {
    const body = [...type].map((c) => c.charCodeAt(0)).concat(Array.from(data));
    let c = 0xffffffff;
    for (const v of body) c = CRC[(c ^ v) & 0xff] ^ (c >>> 8);
    return [...u32(data.length), ...body, ...u32((c ^ 0xffffffff) >>> 0)];
  };
  const head = new Uint8Array([...u32(t.w), ...u32(t.h), 8, 2, 0, 0, 0]);
  const raw = new Uint8Array((t.w * 3 + 1) * t.h);
  for (let y = 0; y < t.h; y++) raw.set(t.rgb.subarray(y * t.w * 3, (y + 1) * t.w * 3), y * (t.w * 3 + 1) + 1);
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', head), ...chunk('IDAT', deflate(raw)), ...chunk('IEND', new Uint8Array(0))]);
}
