import { useEffect, useLayoutEffect, useRef } from 'react';
import { DownloadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { metres, minutes, MONO_INK, num } from '../app/model';
import type { RenderResult, RenderStatus } from '../app/renderer';
import { DrawingProgress } from './drawing-progress';
import { PenDot } from './title-block';

export type Zoom = 'fit' | '0.5' | '1' | '2';

type ToolbarProps = {
  zoom: Zoom;
  onZoom: (z: Zoom) => void;
  status: RenderStatus;
  canDownload: boolean;
  onDownload: () => void;
  onAbout: () => void;
};

export function Toolbar({ zoom, onZoom, status, canDownload, onDownload, onAbout }: ToolbarProps) {
  return (
    <div className="dark flex h-14 items-center gap-4 border-b border-black/40 bg-background px-[18px] text-foreground max-[900px]:h-auto max-[900px]:flex-wrap max-[900px]:gap-3 max-[900px]:px-4 max-[900px]:py-2.5">
      <div className="flex items-center gap-3">
        <span className="micro">Preview</span>
        <Segmented
          aria-label="Preview zoom"
          value={zoom}
          onValueChange={onZoom}
          className="h-8"
          items={[
            { value: 'fit', label: 'Fit' },
            { value: '0.5', label: '50%' },
            { value: '1', label: '100%' },
            { value: '2', label: '200%' },
          ]}
        />
      </div>
      <span role="status" className={cn('readout flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground', status.state === 'error' && 'text-destructive')}>
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full transition-colors',
            status.state === 'working' && 'bg-signal shadow-[0_0_6px_var(--signal)] [animation:lamp_1s_ease-in-out_infinite]',
            status.state === 'idle' && 'bg-muted-foreground/40',
            status.state === 'error' && 'bg-destructive',
          )}
        />
        <span className="truncate">{status.text || (status.state === 'idle' && canDownload ? 'Ready' : '')}</span>
      </span>
      <div className="flex-1" />
      <button type="button" onClick={onAbout} className="rounded-sm text-[13px] text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
        About
      </button>
      <Button variant="signal" size="lg" className="h-9 rounded-md px-3.5" disabled={!canDownload} onClick={onDownload}>
        <DownloadIcon data-icon="inline-start" />
        Download SVG
      </Button>
    </div>
  );
}

type PreviewProps = {
  result: RenderResult | null;
  sheet: [number, number];
  zoom: Zoom;
  pens: string[];
  mono: boolean;
  status: RenderStatus;
  /** Called with the sheet position (mm) of a click on the drawing. */
  onPick: (x: number, y: number) => void;
};

export function Preview({ result, sheet, zoom, pens, mono, status, onPick }: PreviewProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!result) return;
    // Parse as XML rather than HTML: the SVG is our own output, and this keeps it out of the HTML parser.
    const doc = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
    paper.current!.replaceChildren(document.importNode(doc.documentElement, true));
  }, [result]);

  // Pen colours change without redrawing: just restyle the preview layers.
  useEffect(() => {
    const svg = paper.current!.querySelector('svg');
    if (!svg || mono) return;
    pens.forEach((c, i) => svg.querySelector<SVGGElement>(`#pen-${i + 1}`)?.setAttribute('stroke', c));
  }, [pens, mono, result]);

  useLayoutEffect(() => {
    const vp = viewport.current!;
    const layout = () => {
      const [w, h] = sheet;
      let scale: number;
      if (zoom === 'fit') {
        const pad = 48;
        scale = Math.min((vp.clientWidth - pad) / w, (vp.clientHeight - pad) / h);
      } else scale = Number(zoom) * (96 / 25.4);
      paper.current!.style.width = `${w * scale}px`;
      paper.current!.style.height = `${h * scale}px`;
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [sheet, zoom]);

  // Clicking a building tries another look for it; the SVG's own transform maps the click to sheet mm.
  // Picking is by pointing only, a shortcut on top of the Seed section, which stays usable by keyboard.
  const pick = useRef(onPick);
  useLayoutEffect(() => {
    pick.current = onPick;
  });
  useEffect(() => {
    const el = paper.current!;
    const click = (e: MouseEvent) => {
      const m = el.querySelector('svg')?.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      pick.current(p.x, p.y);
    };
    el.addEventListener('click', click);
    return () => el.removeEventListener('click', click);
  }, []);

  const working = status.state === 'working';
  return (
    <div className="relative min-h-0">
      <div ref={viewport} className={cn('perforated absolute inset-0', zoom === 'fit' ? 'grid place-items-center overflow-hidden' : 'grid place-items-start overflow-auto p-6')}>
        <div
          ref={paper}
          title={result ? 'Click a building to try another look for it' : undefined}
          className={cn(
            'sheet cursor-crosshair rounded-[2px] bg-paper shadow-[0_1px_2px_rgb(0_0_0/0.4),0_16px_48px_rgb(0_0_0/0.35)] transition-opacity duration-300',
            // Fade the old drawing only once the progress card shows, so quick redraws don't flicker.
            working && 'opacity-55 delay-350',
          )}
        />
      </div>
      <DrawingProgress status={status} />
    </div>
  );
}

const pct = (before: number, after: number) => (before > 0 ? `−${Math.round((1 - after / before) * 100)}%` : '');

export function Stats({ result }: { result: RenderResult | null }) {
  const rows = result ? result.stats.pens.map((p, i) => ({ p, i })).filter(({ p }) => p.lifts > 0) : [];
  const total = result?.stats.seconds || 1;
  const th = 'micro pb-2 text-left font-normal';
  const td = 'py-[5px] pr-3 align-middle';
  const scene = result
    ? [
        `${num(result.counts.buildings)} buildings`,
        result.counts.houses ? `${num(result.counts.houses)} with pitched roofs` : '',
        `${num(result.counts.trees)} trees`,
        result.counts.cars ? `${num(result.counts.cars)} cars` : '',
        result.counts.lamps ? `${num(result.counts.lamps)} lamps` : '',
      ]
        .filter(Boolean)
        .join(', ')
    : '';

  return (
    <footer className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-x-10 gap-y-2 border-t bg-background px-[22px] pt-3.5 pb-3 text-[13px] max-[900px]:grid-cols-1 max-[900px]:px-4">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-foreground/70">
            <th className={th}>Pen, in plot order</th>
            <th className={cn(th, 'w-[28%]')}>
              <span className="sr-only">Share of plot time</span>
            </th>
            <th className={cn(th, 'text-right')}>Ink</th>
            <th className={cn(th, 'text-right')}>Lifts</th>
            <th className={cn(th, 'pr-0 text-right')}>Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, i }) => {
            const share = p.seconds / total;
            const color = result!.mono ? MONO_INK : p.color;
            return (
              <tr key={i} className="border-b">
                <td className={td}>
                  <span className="flex items-center gap-2">
                    <PenDot color={color} />
                    <span className="readout w-3 text-[11px] text-muted-foreground">{result!.mono ? '' : i + 1}</span>
                    {result!.mono ? 'Black' : p.name}
                  </span>
                </td>
                <td className={td} title={`${Math.round(share * 100)}% of plot time`}>
                  <span className="block h-1 rounded-r-full bg-muted">
                    <span className="block h-full rounded-r-full" style={{ width: `${Math.max(share * 100, 1.5)}%`, background: color }} />
                  </span>
                </td>
                <td className={cn(td, 'readout text-right')}>{metres(p.ink)}</td>
                <td className={cn(td, 'readout text-right')}>{num(p.lifts)}</td>
                <td className={cn(td, 'readout pr-0 text-right')}>{minutes(p.seconds)}</td>
              </tr>
            );
          })}
        </tbody>
        {result && (
          <tfoot>
            <tr>
              <td className={cn(td, 'pt-2 font-semibold')} colSpan={2}>
                All pens
              </td>
              <td className={cn(td, 'readout pt-2 text-right font-medium')}>{metres(result.stats.ink)}</td>
              <td className={cn(td, 'readout pt-2 text-right font-medium')}>{num(result.stats.lifts)}</td>
              <td className={cn(td, 'readout pt-2 pr-0 text-right font-medium')}>{minutes(result.stats.seconds)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <dl className="m-0 self-start">
        {result && (
          <>
            <div className="micro flex justify-between border-b border-foreground/70 pb-2">
              <span>Optimised for the plotter</span>
            </div>
            <div className="grid grid-cols-[96px_1fr] items-baseline gap-3 border-b py-1.5">
              <dt className="text-muted-foreground">Pen travel</dt>
              <dd className="readout m-0 flex items-baseline justify-between gap-2 text-[12px]">
                <span>
                  <span className="text-muted-foreground">{metres(result.stats.rawTravel)} → </span>
                  {metres(result.stats.travel)}
                </span>
                <span className="text-muted-foreground">{pct(result.stats.rawTravel, result.stats.travel)}</span>
              </dd>
            </div>
            <div className="grid grid-cols-[96px_1fr] items-baseline gap-3 border-b py-1.5">
              <dt className="text-muted-foreground">Pen lifts</dt>
              <dd className="readout m-0 flex items-baseline justify-between gap-2 text-[12px]">
                <span>
                  <span className="text-muted-foreground">{num(result.stats.rawLifts)} → </span>
                  {num(result.stats.lifts)}
                </span>
                <span className="text-muted-foreground">{pct(result.stats.rawLifts, result.stats.lifts)}</span>
              </dd>
            </div>
            <div className="grid grid-cols-[96px_1fr] items-baseline gap-3 border-b py-1.5">
              <dt className="text-muted-foreground">Scene</dt>
              <dd className="m-0 text-pretty">{scene}</dd>
            </div>
            <div className="grid grid-cols-[96px_1fr] items-baseline gap-3 py-1.5">
              <dt className="text-muted-foreground">Drawn in</dt>
              <dd className="readout m-0 text-[12px]">{(result.ms / 1000).toFixed(1)} s</dd>
            </div>
          </>
        )}
      </dl>
      <p className="col-span-full m-0 text-[11.5px] text-muted-foreground empty:hidden">
        {result && `Times are estimates at ${result.speed} mm/s drawing, twice that for pen-up moves, plus 0.3 s per pen lift. Plot the pens top to bottom.`}
      </p>
    </footer>
  );
}
