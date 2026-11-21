import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { toImage, toSheet, type Placed } from '../image-fit';
import { FEATHER_MAX, maskWeights, POLYGON_MAX, sheetOutline, type ImageMask } from '../image-masks';

type Rect = [number, number, number, number];

/** What editing a mask over the preview needs: the masks, the one being edited, and where the picture lies on the sheet. */
export type MaskEditing = {
  masks: ImageMask[];
  selected: string;
  placed: Placed;
  picture: { w: number; h: number };
  rect: Rect;
  onChange: (masks: ImageMask[]) => void;
  onDone: () => void;
};

/** Handle radius on screen, px. */
const HANDLE = 5;
/** How far the turning handle stands beyond the shape, px. */
const TURN_OFF = 22;
/** Smallest half-size of an ellipse or rectangle, picture pixels. */
const MIN_HALF = 2;
/** Arrow keys move the mask by this share of the picture; with Shift, by more. */
const NUDGE = 0.005;
const SHOVE = 0.05;
/** Cells across the drawing area for the mask's preview: enough to show the feather, cheap to redo on every move. */
const PREVIEW_CELLS = 360;

type Drag =
  | { kind: 'move'; from: [number, number]; start: ImageMask }
  | { kind: 'vertex'; index: number; start: ImageMask }
  | { kind: 'size'; u: number; v: number; start: ImageMask }
  | { kind: 'turn'; start: ImageMask };

const points = (p: readonly number[]) => p.reduce((s, v, i) => s + (i % 2 ? `,${v.toFixed(2)} ` : v.toFixed(2)), '');

/** A mask moved by `dx`, `dy`, in fractions of the picture. */
function moved(m: ImageMask, dx: number, dy: number): ImageMask {
  return { ...m, pts: m.shape === 'polygon' ? m.pts.map((v, i) => v + (i % 2 ? dy : dx)) : [m.pts[0] + dx, m.pts[1] + dy, m.pts[2], m.pts[3]] };
}

/** The mask a drag has made, with the pointer at picture pixels (`px`, `py`); `snap` turns in steps of 15°. */
function dragged(d: Drag, px: number, py: number, w: number, h: number, snap: boolean): ImageMask {
  const s = d.start;
  if (d.kind === 'move') return moved(s, (px - d.from[0]) / w, (py - d.from[1]) / h);
  if (d.kind === 'vertex') {
    const pts = s.pts.slice();
    pts[d.index * 2] = px / w;
    pts[d.index * 2 + 1] = py / h;
    return { ...s, pts };
  }
  const [cx, cy, rx, ry] = s.pts;
  const dx = px - cx * w, dy = py - cy * h;
  if (d.kind === 'turn') {
    const turned = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    const angle = snap ? Math.round(turned / 15) * 15 : turned;
    return { ...s, angle: ((angle + 540) % 360) - 180 };
  }
  // Sizes symmetrically about the middle, along the shape's own axes.
  const a = (s.angle * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const lu = Math.abs(dx * cos + dy * sin), lv = Math.abs(-dx * sin + dy * cos);
  return { ...s, pts: [cx, cy, d.u ? Math.max(MIN_HALF, lu) / w : rx, d.v ? Math.max(MIN_HALF, lv) / h : ry] };
}

/** A handle on the sheet, mm: the drag it starts, and for a polygon's corner the mask without it. */
type Handle = { x: number; y: number; title: string; cursor: string; drag: Drag; small?: boolean; without?: ImageMask };

/** A polygon's handles: a dot on each corner, and a smaller one in each side to pull out a new corner. */
function polygonHandles(mask: ImageMask, at: (px: number, py: number) => [number, number], w: number, h: number): Handle[] {
  const out: Handle[] = [];
  const n = mask.pts.length / 2;
  for (let i = 0; i < n; i++) {
    const [x, y] = at(mask.pts[i * 2] * w, mask.pts[i * 2 + 1] * h);
    out.push({
      x, y, title: n > 3 ? 'Drag to move this corner; double-click to remove it' : 'Drag to move this corner', cursor: 'move',
      drag: { kind: 'vertex', index: i, start: mask },
      without: n > 3 ? { ...mask, pts: mask.pts.filter((_, k) => k >> 1 !== i) } : undefined,
    });
  }
  if (n >= POLYGON_MAX) return out;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const mx = (mask.pts[i * 2] + mask.pts[j * 2]) / 2, my = (mask.pts[i * 2 + 1] + mask.pts[j * 2 + 1]) / 2;
    const [x, y] = at(mx * w, my * h);
    const pts = [...mask.pts.slice(0, (i + 1) * 2), mx, my, ...mask.pts.slice((i + 1) * 2)];
    out.push({ x, y, title: 'Drag to pull out a new corner', cursor: 'copy', small: true, drag: { kind: 'vertex', index: i + 1, start: { ...mask, pts } } });
  }
  return out;
}

/** An ellipse's or rectangle's handles: one on each side (and corner) to size it, and one on a stem `off` picture pixels above it to turn it. */
function boxHandles(mask: ImageMask, at: (px: number, py: number) => [number, number], w: number, h: number, off: number): { handles: Handle[]; stem: number[] } {
  const [cx, cy, rx, ry] = mask.pts;
  const a = (mask.angle * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const X = cx * w, Y = cy * h, RX = rx * w, RY = ry * h;
  const local = (u: number, v: number) => at(X + u * cos - v * sin, Y + u * sin + v * cos);
  const sides: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (mask.shape === 'rect') sides.push([1, 1], [-1, 1], [1, -1], [-1, -1]);
  const handles: Handle[] = sides.map(([u, v]) => {
    const [x, y] = local(u * RX, v * RY);
    return { x, y, title: 'Drag to resize', cursor: u && v ? 'nwse-resize' : u ? 'ew-resize' : 'ns-resize', drag: { kind: 'size', u: Math.abs(u), v: Math.abs(v), start: mask } };
  });
  const [ox, oy] = local(0, -RY - off);
  handles.push({ x: ox, y: oy, title: 'Drag to turn; hold Shift to turn in steps of 15°', cursor: 'grab', drag: { kind: 'turn', start: mask } });
  return { handles, stem: [...local(0, -RY), ox, oy] };
}

/**
 * The mask being edited, over the preview: its strength as a tint (full inside, fading across the
 * feather), its outline, and handles. Drag the shape to move it; drag a handle to size, turn or
 * reshape it. On a polygon, drag the dot in the middle of a side to add a corner there, and
 * double-click a corner to take it away. Arrow keys move the mask, Escape ends editing. The
 * drawing changes when a drag ends.
 */
export function MaskEditor({ masks, selected, placed, picture, rect, onChange, onDone, sheet }: MaskEditing & { sheet: [number, number] }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<ImageMask | null>(null);
  const [mmPx, setMmPx] = useState(0.25);
  const saved = masks.find((m) => m.id === selected);
  const mask = draft ?? saved;

  // Handles keep their size on screen, whatever the zoom.
  useLayoutEffect(() => {
    const el = svg.current!;
    const measure = () => setMmPx(sheet[0] / Math.max(1, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet]);

  const { w, h } = picture;
  // Keyed on values: the placement and drawing area are new objects on every render of the app.
  const look = mask ? JSON.stringify([mask, placed, picture.w, picture.h, rect]) : '';
  const tint = useMemo(() => (look ? tintOf(...(JSON.parse(look) as [ImageMask, Placed, number, number, Rect])) : null), [look]);
  if (!mask) return null;

  /** Picture pixels under a pointer. */
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return toImage(placed, p.x, p.y);
  };
  const sheetAt = (px: number, py: number) => toSheet(placed, px, py);
  const commit = (m: ImageMask) => onChange(masks.map((o) => (o.id === m.id ? m : o)));

  const begin = (e: PointerEvent<SVGElement>, d: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    svg.current!.setPointerCapture(e.pointerId);
    drag.current = d;
    setDraft(d.start);
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current) setDraft(dragged(drag.current, ...at(e), w, h, e.shiftKey));
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (draft && draft !== d.start) commit(draft);
    setDraft(null);
  };

  const key = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onDone();
      return;
    }
    const step = (e.shiftKey ? SHOVE : NUDGE) * Math.min(w, h);
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d || !saved) return;
    e.preventDefault();
    commit(moved(saved, d[0] / w, d[1] / h));
  };

  const outline = sheetOutline(mask, placed, w, h);
  const r = HANDLE * mmPx;
  const { handles, stem } = mask.shape === 'polygon'
    ? { handles: polygonHandles(mask, sheetAt, w, h), stem: null }
    : boxHandles(mask, sheetAt, w, h, TURN_OFF * mmPx * placed.ppm);

  const [x0, y0, x1, y1] = rect;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <>
      {tint && (
        <div
          aria-hidden
          className="pointer-events-none absolute bg-signal opacity-45"
          style={{ left: pct(x0, sheet[0]), top: pct(y0, sheet[1]), width: pct(x1 - x0, sheet[0]), height: pct(y1 - y0, sheet[1]), maskImage: `url(${tint})`, maskSize: '100% 100%', WebkitMaskImage: `url(${tint})`, WebkitMaskSize: '100% 100%' }}
        />
      )}
      <svg
        ref={svg}
        role="application"
        aria-label="Mask over the drawing. Drag to move it, arrow keys to nudge it, Escape to finish."
        tabIndex={0}
        viewBox={`0 0 ${sheet[0]} ${sheet[1]}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full touch-none outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={key}
      >
        {masks.filter((m) => m.id !== mask.id && !m.off).map((m) => (
          <polygon key={m.id} points={points(sheetOutline(m, placed, w, h))} fill="none" className="stroke-signal/60" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        ))}
        <polygon
          points={points(outline)}
          fill="transparent"
          className="cursor-move stroke-signal"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
          onPointerDown={(e) => begin(e, { kind: 'move', from: at(e), start: mask })}
        >
          <title>Drag to move the mask</title>
        </polygon>
        {stem && <line x1={stem[0]} y1={stem[1]} x2={stem[2]} y2={stem[3]} className="stroke-signal" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
        {handles.map((hd, i) => (
          <circle
            key={i}
            cx={hd.x}
            cy={hd.y}
            r={hd.small ? r * 0.7 : r}
            className={hd.small ? 'fill-paper stroke-signal' : 'fill-signal stroke-paper'}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: hd.cursor }}
            onPointerDown={(e) => begin(e, hd.drag)}
            onDoubleClick={hd.without && (() => commit(hd.without!))}
          >
            {hd.title && <title>{hd.title}</title>}
          </circle>
        ))}
      </svg>
    </>
  );
}

/** The mask's strength over the drawing area as an image whose opacity is the strength, for a CSS mask. */
function tintOf(mask: ImageMask, placed: Placed, w: number, h: number, rect: Rect): string {
  const [x0, y0, x1, y1] = rect;
  const cell = Math.max(0.5, (x1 - x0) / PREVIEW_CELLS);
  const W = Math.max(1, Math.ceil((x1 - x0) / cell)), H = Math.max(1, Math.ceil((y1 - y0) / cell));
  const feather = Math.min(FEATHER_MAX, mask.feather) * Math.min(placed.w, placed.h);
  // Shown at full strength even while off, so it can still be edited.
  const weights = maskWeights({ ...mask, amount: Math.max(0.2, mask.amount) }, sheetOutline(mask, placed, w, h), feather, { x0, y0, cell, W, H });
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < weights.length; i++) img.data[i * 4 + 3] = Math.round(weights[i] * 255);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

