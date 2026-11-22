import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { CircleHelpIcon, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { PictureState, PictureStatus } from '../app/use-picture';
import { dragFocus, fitImage, type Placed } from '../image-fit';
import type { Settings } from '../settings';

type Focus = Settings['imageFocus'];
type Rect = [number, number, number, number];

type Props = {
  picture: PictureState;
  /** The drawing area on the sheet, mm, whose proportions the well takes. */
  rect: Rect;
  fit: Settings['imageFit'];
  focus: Focus;
  onFile: (file: File) => void;
  onFocus: (focus: Focus) => void;
};

const KEY =
  'flex items-center gap-1.5 rounded-[4px] border border-input bg-background px-3 py-1.5 text-[13px] font-medium transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.1)]';

/** Arrow keys move the crop by this share of the drawing area; with Shift, by more. */
const NUDGE = 0.02;
const SHOVE = 0.1;

/**
 * Moving the crop in Fill: drag the image, or use the arrow keys. While a drag is under way the
 * well shows it at once, and the setting changes (and the town is laid out again) when it ends.
 */
function useCrop(rect: Rect, size: { w: number; h: number } | null, fit: Settings['imageFit'], focus: Focus, onFocus: (f: Focus) => void, width: () => number) {
  const [drag, setDrag] = useState<{ x: number; y: number; from: Focus; now: Focus } | null>(null);
  const [x0, y0, x1, y1] = rect;
  const placed = size ? fitImage(rect, size.w, size.h, fit, drag?.now ?? focus) : null;
  const movable = !!placed && fit === 'fill' && (placed.w > x1 - x0 + 0.01 || placed.h > y1 - y0 + 0.01);
  /** Pointer movement in px as mm on the sheet. */
  const toMm = (px: number) => (px / (width() || 1)) * (x1 - x0);

  return {
    placed,
    movable,
    dragging: !!drag,
    onPointerDown(e: PointerEvent<HTMLDivElement>) {
      if (!movable) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ x: e.clientX, y: e.clientY, from: focus, now: focus });
    },
    onPointerMove(e: PointerEvent<HTMLDivElement>) {
      if (!drag || !size) return;
      const start = fitImage(rect, size.w, size.h, fit, drag.from);
      setDrag({ ...drag, now: dragFocus(start, rect, toMm(e.clientX - drag.x), toMm(e.clientY - drag.y)) });
    },
    onPointerUp() {
      if (!drag) return;
      setDrag(null);
      if (drag.now[0] !== focus[0] || drag.now[1] !== focus[1]) onFocus(drag.now);
    },
    onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
      const step = e.shiftKey ? SHOVE : NUDGE;
      const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (!d || !placed || !movable) return;
      e.preventDefault();
      onFocus(dragFocus(placed, rect, d[0] * (x1 - x0), d[1] * (y1 - y0)));
    },
  };
}

/** What an empty well says, with a key to choose an image. */
function Prompt({ status, onChoose }: { status: PictureStatus; onChoose: () => void }) {
  const text = status === 'loading' ? 'Reading the image…' : status === 'missing' ? 'This drawing was made from an image that isn’t stored in this browser.' : 'Drop an image, or choose one';
  return (
    <div className="absolute inset-0 grid place-items-center p-4 text-center">
      <div className="flex flex-col items-center gap-2.5">
        <ImageIcon aria-hidden className="size-5 text-muted-foreground/70" />
        <p className="m-0 text-xs leading-relaxed text-pretty text-muted-foreground">{text}</p>
        {status !== 'loading' && (
          <button type="button" className={KEY} onClick={onChoose}>
            Choose…
          </button>
        )}
      </div>
    </div>
  );
}

/** Explain the image cues beside the upload and crop controls. */
function ImageGuide() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="icon-sm" variant="outline" className="absolute top-1.5 right-1.5" aria-label="How an image becomes a town">
          <CircleHelpIcon aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader className="pr-6">
          <DialogTitle>How an image becomes a town</DialogTitle>
          <DialogDescription>The town follows your picture’s light, colour and outlines. Nearby streets and buildings also influence what fits.</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-3 text-sm leading-relaxed [&_dt]:font-medium [&_dd]:text-muted-foreground">
          <div><dt>Light and dark</dt><dd>Pale areas tend to become open ground or scattered houses. Dark areas favour denser blocks. Height from image can turn a dark silhouette into a skyline.</dd></div>
          <div><dt>Colour</dt><dd>Bright blue patches can become ponds and long blue bands can become rivers. Greens favour meadows, parks and woods. Warm reds favour pitched roofs.</dd></div>
          <div><dt>Lines and edges</dt><dd>A stripe can guide a street through houses or a path across a field. Strong outlines can also guide the direction of streets and buildings.</dd></div>
          <div><dt>Blank paper</dt><dd>Turn on Preserve empty space to leave transparent areas blank. Lower the highlight cutoff to leave light areas clear too.</dd></div>
        </dl>
      </DialogContent>
    </Dialog>
  );
}

/** The picture placed in the well as it lies on the sheet. */
function Placement({ url, placed, rect }: { url: string; placed: Placed; rect: Rect }) {
  const [x0, y0, x1, y1] = rect;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      className="pointer-events-none absolute max-w-none"
      style={{ left: pct(placed.x - x0, x1 - x0), top: pct(placed.y - y0, y1 - y0), width: pct(placed.w, x1 - x0), height: pct(placed.h, y1 - y0) }}
    />
  );
}

/**
 * A frame in the drawing area's proportions that holds the image as it will lie on the sheet.
 * Drop an image on it or choose one; in Fill, drag the image (or use the arrow keys) to move the crop.
 */
export function ImageWell({ picture, rect, fit, focus, onFile, onFocus }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const { picture: pic, url, status, error } = picture;
  const crop = useCrop(rect, pic, fit, focus, onFocus, () => frame.current?.clientWidth ?? 0);
  const choose = () => input.current?.click();

  function drop(e: DragEvent): void {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <div className="mb-3">
      <div className="relative">
        <div
          ref={frame}
          role="group"
          aria-label={pic ? `${pic.name || 'Image'}${crop.movable ? '. Drag or use the arrow keys to move the crop.' : ''}` : 'Image well'}
          tabIndex={crop.movable ? 0 : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          onPointerDown={crop.onPointerDown}
          onPointerMove={crop.onPointerMove}
          onPointerUp={crop.onPointerUp}
          onPointerCancel={crop.onPointerUp}
          onKeyDown={crop.onKeyDown}
          className={cn(
            'relative w-full touch-none overflow-hidden rounded-md border border-input bg-card outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50',
            over && 'border-foreground/50 bg-muted',
            crop.movable && (crop.dragging ? 'cursor-grabbing' : 'cursor-grab'),
          )}
          style={{ aspectRatio: `${rect[2] - rect[0]} / ${rect[3] - rect[1]}` }}
        >
          {crop.placed && url ? <Placement url={url} placed={crop.placed} rect={rect} /> : <Prompt status={status} onChoose={choose} />}
        </div>
        <ImageGuide />
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) onFile(file);
        }}
      />
      {pic && (
        <p className="mt-1.5 mb-0 flex items-baseline justify-between gap-3 text-[12px]">
          <span className="readout min-w-0 truncate text-[11px] text-muted-foreground" title={pic.name}>
            {pic.w} × {pic.h} px{pic.name ? ` · ${pic.name}` : ''}
          </span>
          <button type="button" className="shrink-0 underline underline-offset-4" onClick={choose}>
            Choose another
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1.5 mb-0 text-xs leading-relaxed text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
