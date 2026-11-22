import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { toImage, toSheet, type Placed } from '../image-fit';
import { isGround, PIN_KINDS, pinName, type ImagePin, type PinOutcomes } from '../image-pins';
import { PIN_ICONS } from './pin-icons';

/** What showing and dragging the pin being edited over the preview needs: the pins, the one being edited, and where the picture lies on the sheet. */
export type PinEditing = {
  pins: ImagePin[];
  selected: string;
  placed: Placed;
  picture: { w: number; h: number };
  outcomes?: PinOutcomes;
  onChange: (pins: ImagePin[]) => void;
  onSelect: (id: string | null) => void;
};

/** A symbol's radius on screen, px, and its icon's size. */
const BADGE = 10;
const ICON = 12;
/** Arrow keys move a pin by this share of the picture; with Shift, by more. */
const NUDGE = 0.005;
const SHOVE = 0.05;
/** A pointer that moves less than this, px, has clicked rather than dragged. */
const CLICK = 3;

type Drag = { id: string; from: [number, number]; start: ImagePin; screen: [number, number]; moved: boolean };

/**
 * The pin being edited over the preview, as a symbol, with a dashed circle for the ground a ground
 * pin takes. Drag the symbol to move it; click it, or press Escape, to stop editing it. Arrow keys
 * move it. The drawing changes when a drag ends. A pin left out of the drawing shows faint, and
 * one the town had no room for is ringed in red. Other pins stay out of sight.
 */
export function PinLayer({ pins, selected, placed, picture, outcomes, onChange, onSelect, sheet }: PinEditing & { sheet: [number, number] }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<ImagePin | null>(null);
  const [mmPx, setMmPx] = useState(0.25);

  // Symbols keep their size on screen, whatever the zoom.
  useLayoutEffect(() => {
    const el = svg.current!;
    const measure = () => setMmPx(sheet[0] / Math.max(1, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sheet]);

  const { w, h } = picture;
  const short = Math.min(placed.w, placed.h);
  /** Picture pixels under a pointer. */
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return toImage(placed, p.x, p.y);
  };
  const commit = (p: ImagePin) => onChange(pins.map((o) => (o.id === p.id ? p : o)));

  const begin = (e: PointerEvent<SVGGElement>, p: ImagePin) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: p.id, from: at(e), start: p, screen: [e.clientX, e.clientY], moved: false };
    setDraft(p);
  };
  const move = (e: PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.screen[0], e.clientY - d.screen[1]) < CLICK) return;
    d.moved = true;
    const [px, py] = at(e);
    setDraft({ ...d.start, x: d.start.x + (px - d.from[0]) / w, y: d.start.y + (py - d.from[1]) / h });
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.moved && draft) commit(draft);
    else onSelect(d.id === selected ? null : d.id);
    setDraft(null);
  };

  const key = (e: KeyboardEvent<SVGGElement>, p: ImagePin) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onSelect(null);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(p.id === selected ? null : p.id);
      return;
    }
    const step = (e.shiftKey ? SHOVE : NUDGE) * Math.min(w, h);
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    commit({ ...p, x: p.x + d[0] / w, y: p.y + d[1] / h });
  };

  const R = BADGE * mmPx;
  const I = ICON * mmPx;
  // Only the pin being edited shows, as only the mask being edited does.
  const shown = pins.filter((p) => p.id === selected).map((p) => (draft && p.id === draft.id ? draft : p));
  return (
    <svg
      ref={svg}
      aria-label="Pins on the drawing"
      viewBox={`0 0 ${sheet[0]} ${sheet[1]}`}
      preserveAspectRatio="none"
      data-no-pick
      className="pointer-events-none absolute inset-0 size-full touch-none select-none"
    >
      {shown.map((p) => {
        const [x, y] = toSheet(placed, p.x * w, p.y * h);
        const on = p.id === selected;
        const missed = !p.off && outcomes?.[p.id] === false;
        const Icon = PIN_ICONS[p.kind];
        const name = pinName(p, pins);
        const tone = missed ? 'stroke-destructive' : on ? 'stroke-signal' : 'stroke-foreground/70';
        return (
          <g key={p.id} opacity={p.off ? 0.4 : 1}>
            {isGround(p.kind) && <circle cx={x} cy={y} r={p.r * short} fill="none" className={tone} strokeWidth={on ? 1.25 : 1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
            {/* The soft edge: held inside the inner ring, free beyond the outer. */}
            {isGround(p.kind) && p.feather > 0 && [-0.5, 0.5].map((f) => {
              const r = (p.r + f * p.feather) * short;
              return r > 0 && <circle key={f} cx={x} cy={y} r={r} fill="none" className={tone} strokeOpacity={0.5} strokeWidth={0.75} strokeDasharray="1 3" vectorEffect="non-scaling-stroke" />;
            })}
            <g
              role="button"
              tabIndex={0}
              aria-label={`${name}${missed ? ', no room' : ''}. Drag to move, arrow keys to nudge, Enter to edit.`}
              aria-pressed={on}
              className="pointer-events-auto cursor-grab outline-none focus-visible:[&>circle]:stroke-ring"
              onPointerDown={(e) => begin(e, p)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onKeyDown={(e) => key(e, p)}
            >
              <title>{`${name}: ${PIN_KINDS[p.kind].label.toLowerCase()}${missed ? ' (no room for it)' : ''}. Drag to move it, click to edit it.`}</title>
              <circle cx={x} cy={y} r={R} className={`fill-paper ${tone}`} strokeWidth={on ? 2 : 1.25} vectorEffect="non-scaling-stroke" />
              <Icon x={x - I / 2} y={y - I / 2} width={I} height={I} strokeWidth={2} className={missed ? 'text-destructive' : on ? 'text-signal' : 'text-foreground'} aria-hidden />
            </g>
          </g>
        );
      })}
    </svg>
  );
}
