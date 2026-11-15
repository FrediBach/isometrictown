import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, CheckIcon, DownloadIcon, PauseIcon, PlayIcon, ScanIcon, SquareIcon, UnplugIcon, UsbIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/segmented';
import { ToggleKey } from '@/components/ui/toggle-key';
import { cn } from '@/lib/utils';
import { BAUD, hasSerial } from '../app/grbl';
import { metres, minutes, MONO_INK, num, slug } from '../app/model';
import type { RenderResult } from '../app/renderer';
import { usePlotter, type Job, type Plotter } from '../app/use-plotter';
import { bedSize, DEFAULT_SETUP, gcodeFile, layersOf, outline, penDown, penUp, type PenLayer, type PlotterSetup } from '../gcode';
import { SliderField } from './fields';
import { PenDot } from './title-block';

const SETUP_KEY = 'isometrictown:plotter';

function loadSetup(): PlotterSetup {
  try {
    const saved = JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') as Partial<PlotterSetup>;
    return { ...DEFAULT_SETUP, ...saved };
  } catch {
    return DEFAULT_SETUP;
  }
}

function saveSetup(s: PlotterSetup): void {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked */
  }
}

function save(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TEXT = 'm-0 text-[13px] leading-relaxed text-pretty text-muted-foreground';

type PlotDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: RenderResult | null;
  place: string;
  seed: number;
};

/**
 * Plot the drawing on a GRBL pen plotter (made for the UUNA TEK 3.0): straight over USB with
 * Web Serial, pen by pen with a prompt to swap pens, or as a G-code file for a sender.
 * It stays mounted while closed, so a plot carries on and the connection is kept.
 */
export function PlotDialog({ open, onOpenChange, result, place, seed }: PlotDialogProps) {
  const [mode, setMode] = useState<'usb' | 'file'>(hasSerial() ? 'usb' : 'file');
  const [setup, setSetupState] = useState(loadSetup);
  const feed = (result?.speed ?? 40) * 60;
  const plotter = usePlotter(setup, feed);
  const fresh = useMemo<Job | null>(() => (result ? { svg: result.svg, sheet: result.sheet, layers: layersOf(result.svg) } : null), [result]);
  const shown = plotter.job ?? fresh;

  const setSetup = (s: PlotterSetup) => {
    setSetupState(s);
    saveSetup(s);
  };

  function download(layers: PenLayer[], suffix = ''): void {
    if (!shown) return;
    const title = `${place}, Isometric Town, seed ${seed}`;
    save(gcodeFile(layers, { title, sheet: shown.sheet, setup, feed }), `isometric-town-${slug(place)}-${seed}${suffix}.gcode`);
  }

  let body: ReactNode;
  if (!shown?.layers.length) body = <p className={cn(TEXT, 'mt-5')}>There is nothing to plot yet. Wait for the drawing to finish.</p>;
  else if (mode === 'file') body = <FilePanel job={shown} result={result} setup={setup} onSetup={setSetup} feed={feed} onDownload={download} />;
  else if (!hasSerial())
    body = (
      <p className={cn(TEXT, 'mt-5')}>
        Plotting over USB needs Web Serial, which Chrome and Edge have on the desktop. In this browser, download the G-code file and send it with Universal Gcode Sender instead.
      </p>
    );
  else
    body = (
      <>
        <ConnectStep plotter={plotter} />
        <OriginStep plotter={plotter} job={shown} setup={setup} onSetup={setSetup} />
        <PlotStep plotter={plotter} job={shown} fresh={fresh} result={result} />
      </>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="grid max-h-[calc(100vh-32px)] max-w-[min(680px,calc(100vw-32px))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-lg border border-input bg-background p-0 ring-0 sm:max-w-[680px]"
        // A click beside the dialog should not hide a running plot by accident.
        onInteractOutside={(e) => plotter.running && e.preventDefault()}
      >
        <DialogHeader className="flex-row items-end justify-between gap-4 border-b border-input bg-card px-6 py-4 pr-14 text-left max-[560px]:flex-col max-[560px]:items-start">
          <div>
            <DialogTitle className="text-lg leading-tight font-semibold tracking-[-0.02em]">Pen plot</DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-muted-foreground">For the UUNA TEK 3.0 and other GRBL 1.1 plotters, one pen at a time.</DialogDescription>
          </div>
          <Segmented
            aria-label="How to plot"
            value={mode}
            onValueChange={setMode}
            className="h-8 shrink-0"
            items={[
              { value: 'usb', label: 'Over USB' },
              { value: 'file', label: 'G-code file' },
            ]}
          />
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6 pb-6">
          {body}
          {plotter.note && (mode === 'usb' || plotter.note.error) && (
            <p role="status" className={cn(TEXT, 'mt-4', plotter.note.error && 'text-destructive')}>
              {plotter.note.text}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Step({ index, title, dim, children }: { index: number; title: string; dim?: boolean; children: ReactNode }) {
  return (
    <section className={cn('border-t pb-5 first:border-t-0', dim && 'opacity-60')}>
      <h3 className="m-0 flex items-baseline gap-2.5 pt-4 pb-3 font-normal">
        <span className="readout text-[11px] text-muted-foreground">{String(index).padStart(2, '0')}</span>
        <span className="text-[13px] font-semibold tracking-[-0.005em]">{title}</span>
      </h3>
      {children}
    </section>
  );
}

type FilePanelProps = {
  job: Job;
  result: RenderResult | null;
  setup: PlotterSetup;
  onSetup: (s: PlotterSetup) => void;
  feed: number;
  onDownload: (layers: PenLayer[], suffix?: string) => void;
};

function FilePanel({ job, result, setup, onSetup, feed, onDownload }: FilePanelProps) {
  const [w, h] = bedSize(job.sheet, setup);
  return (
    <>
      <Step index={1} title="Plotter set-up">
        <SetupFields setup={setup} onSetup={onSetup} locked={false} />
      </Step>
      <Step index={2} title="Download">
        <p className={cn(TEXT, 'mb-3')}>
          One file holds every pen, in plot order. It sets the origin where the pen stands, so raise the pen and move it over the {setup.corner} corner of the paper before you start. Before each new
          pen it pauses (M0): swap the pen, then resume. Send it with Universal Gcode Sender at {num(BAUD)} baud.
        </p>
        <PenTable layers={job.layers} result={result}>
          {(_, i) => (
            <Button variant="ghost" size="icon-sm" aria-label={`Download pen ${i + 1} on its own`} title="This pen on its own" onClick={() => onDownload([job.layers[i]], `-pen-${i + 1}`)}>
              <DownloadIcon />
            </Button>
          )}
        </PenTable>
        <div className="mt-4 flex items-center justify-between gap-4">
          <span className="readout text-[11px] text-muted-foreground">{`${w} × ${h} mm · ${num(feed)} mm/min`}</span>
          <Button variant="signal" size="lg" className="h-9 rounded-md px-3.5" onClick={() => onDownload(job.layers)}>
            <DownloadIcon data-icon="inline-start" />
            Download G-code
          </Button>
        </div>
      </Step>
    </>
  );
}

function ConnectStep({ plotter: p }: { plotter: Plotter }) {
  const alarm = p.machine.state.startsWith('Alarm');
  const pos = p.machine.pos;
  return (
    <Step index={1} title="Connect">
      <div className="flex items-center justify-between gap-4">
        <p className={TEXT}>{p.connected ? 'The plotter is connected.' : 'Switch the plotter on and plug in its USB cable, then pick its port. It is often called USB Serial or CH340.'}</p>
        {p.connected ? (
          <Button variant="outline" disabled={p.running} onClick={p.disconnect}>
            <UnplugIcon data-icon="inline-start" />
            Disconnect
          </Button>
        ) : (
          <Button disabled={p.phase === 'connecting'} onClick={p.connect}>
            <UsbIcon data-icon="inline-start" />
            {p.phase === 'connecting' ? 'Connecting…' : 'Connect plotter'}
          </Button>
        )}
      </div>
      {p.connected && (
        <div className="readout mt-3 flex min-h-6 items-center gap-2 text-[11px] text-muted-foreground">
          <span aria-hidden className={cn('size-1.5 rounded-full', alarm ? 'bg-destructive' : p.machine.state === 'Idle' ? 'bg-muted-foreground/60' : 'bg-signal')} />
          <span className="text-foreground">{p.machine.state}</span>
          {pos && <span>{`X ${pos[0].toFixed(2)}  Y ${pos[1].toFixed(2)}  Z ${pos[2].toFixed(2)}`}</span>}
          {alarm && (
            <Button variant="outline" size="xs" className="ml-auto" disabled={p.running} onClick={() => p.command(['$X'])}>
              Unlock
            </Button>
          )}
        </div>
      )}
    </Step>
  );
}

type OriginStepProps = { plotter: Plotter; job: Job; setup: PlotterSetup; onSetup: (s: PlotterSetup) => void };

function OriginStep({ plotter: p, job, setup, onSetup }: OriginStepProps) {
  const [step, setStep] = useState<'0.1' | '1' | '10'>('10');
  const [w, h] = bedSize(job.sheet, setup);
  const idle = p.connected && !p.running && p.phase !== 'busy';
  const jog = (dx: number, dy: number) => p.jog(dx * Number(step), dy * Number(step));
  return (
    <Step index={2} title="Paper and origin" dim={!p.connected}>
      <p className={cn(TEXT, 'mb-3')}>
        Tape down the paper; the drawing is {w} × {h} mm{setup.turn ? ', turned a quarter turn' : ''}. Raise the pen, move it over the {setup.corner} corner of the paper with the arrows, and set the origin
        there. Then trace the outline to check that the sheet lies square under the pen.
      </p>
      <div className="flex flex-wrap items-start gap-5">
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Move the pen">
          <span />
          <JogKey label="Away from you" disabled={!idle} onClick={() => jog(0, -1)}>
            <ArrowUpIcon />
          </JogKey>
          <span />
          <JogKey label="Left" disabled={!idle} onClick={() => jog(-1, 0)}>
            <ArrowLeftIcon />
          </JogKey>
          <span className="readout grid place-items-center text-[10px] text-muted-foreground">{step}</span>
          <JogKey label="Right" disabled={!idle} onClick={() => jog(1, 0)}>
            <ArrowRightIcon />
          </JogKey>
          <span />
          <JogKey label="Towards you" disabled={!idle} onClick={() => jog(0, 1)}>
            <ArrowDownIcon />
          </JogKey>
          <span />
        </div>
        <div className="flex min-w-[220px] flex-1 flex-col gap-2">
          <Segmented
            aria-label="Jog step"
            value={step}
            onValueChange={setStep}
            className="h-8"
            items={[
              { value: '0.1', label: '0.1 mm' },
              { value: '1', label: '1 mm' },
              { value: '10', label: '10 mm' },
            ]}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant="outline" disabled={!idle} onClick={() => p.command([penUp(setup)])}>
              Pen up
            </Button>
            <Button variant="outline" disabled={!idle} onClick={() => p.command([penDown(setup)])}>
              Pen down
            </Button>
            <Button variant={p.origin ? 'outline' : 'default'} disabled={!idle} onClick={p.setOriginHere}>
              {p.origin && <CheckIcon data-icon="inline-start" />}
              Set origin here
            </Button>
            <Button variant="outline" disabled={!idle || !p.origin} onClick={() => p.command([...outline(job.sheet, setup), 'G4 P0'])}>
              <ScanIcon data-icon="inline-start" />
              Trace outline
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-4">
        <SetupFields setup={setup} onSetup={onSetup} locked={p.running || p.plotted.some(Boolean)} />
      </div>
    </Step>
  );
}

function JogKey({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="outline" size="icon" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

type PlotStepProps = { plotter: Plotter; job: Job; fresh: Job | null; result: RenderResult | null };

function PlotStep({ plotter: p, job, fresh, result }: PlotStepProps) {
  const ready = p.connected && p.origin && !p.running && p.phase !== 'busy';
  const next = job.layers.findIndex((_, i) => !p.plotted[i]);
  const stale = !!p.job && !!fresh && p.job.svg !== fresh.svg;
  const ink = (l: PenLayer) => (result?.mono ? MONO_INK : l.color);
  return (
    <Step index={3} title="Plot, pen by pen" dim={!p.connected || !p.origin}>
      {stale && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-input bg-card px-3 py-2 text-[13px]">
          <span>The drawing has changed since you started. These are still the pens of the drawing you started with.</span>
          <Button variant="outline" size="sm" disabled={p.running} onClick={p.startOver}>
            Start over
          </Button>
        </div>
      )}
      {p.running && p.active >= 0 ? (
        <Running plotter={p} layer={job.layers[p.active]} color={ink(job.layers[p.active])} />
      ) : (
        next >= 0 && <PenPrompt layer={job.layers[next]} index={next} count={job.layers.length} color={ink(job.layers[next])} />
      )}
      <PenTable layers={job.layers} result={result}>
        {(_, i) => (
          <span className="flex items-center justify-end gap-1">
            {p.plotted[i] && <CheckIcon className="size-3.5 text-muted-foreground" aria-label="Plotted" />}
            <Button variant={i === next && ready ? 'signal' : 'ghost'} size="xs" disabled={!ready} onClick={() => p.plot(i, job)}>
              {p.plotted[i] ? 'Again' : 'Plot'}
            </Button>
          </span>
        )}
      </PenTable>
      <PlotActions plotter={p} next={next} ready={ready} onPlot={() => p.plot(next, job)} />
    </Step>
  );
}

/** Pause, resume and stop while a pen plots; otherwise the button for the next pen. */
function PlotActions({ plotter: p, next, ready, onPlot }: { plotter: Plotter; next: number; ready: boolean; onPlot: () => void }) {
  return (
      <div className="mt-4 flex items-center justify-end gap-2">
        {p.running && (
          <>
            <Button variant="outline" disabled={p.phase === 'stopping'} onClick={p.pause}>
              {p.phase === 'paused' ? <PlayIcon data-icon="inline-start" /> : <PauseIcon data-icon="inline-start" />}
              {p.phase === 'paused' ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="destructive" disabled={p.phase === 'stopping'} onClick={p.stop}>
              <SquareIcon data-icon="inline-start" />
              Stop
            </Button>
          </>
        )}
        {!p.running && next >= 0 && (
          <Button variant="signal" size="lg" className="h-9 rounded-md px-3.5" disabled={!ready} onClick={onPlot}>
            <PlayIcon data-icon="inline-start" />
            Plot pen {next + 1}
          </Button>
        )}
        {!p.running && next < 0 && (
          <Button variant="outline" onClick={p.startOver}>
            Start a new plot
          </Button>
        )}
      </div>
  );
}

function Running({ plotter: p, layer, color }: { plotter: Plotter; layer: PenLayer; color: string }) {
  const state = p.phase === 'stopping' ? 'Stopping' : p.phase === 'paused' ? 'Paused' : 'Plotting';
  return (
    <div className="mb-3 rounded-md border border-input bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-[13px]">
        <span className="flex items-center gap-2">
          <PenDot color={color} />
          {state} pen {p.active + 1}, {layer.label}
        </span>
        <span className="readout text-[11px] text-muted-foreground">{Math.floor(p.progress * 100)}%</span>
      </div>
      <span className="mt-2 block h-1 rounded-full bg-muted">
        <span className="block h-full rounded-full bg-signal transition-[width]" style={{ width: `${p.progress * 100}%` }} />
      </span>
      {p.phase === 'paused' && <p className="m-0 mt-2 text-xs text-muted-foreground">The pen stays where it is. Resume to carry on, or stop to lift it and go back to the origin.</p>}
    </div>
  );
}

/** What to do before the next pen: which pen to put in and how high it should sit. */
function PenPrompt({ layer, index, count, color }: { layer: PenLayer; index: number; count: number; color: string }) {
  return (
    <div className="mb-3 flex items-start gap-3 rounded-md border border-input bg-card px-3 py-2.5 text-[13px] leading-relaxed">
      <PenDot color={color} size={16} className="mt-0.5" />
      <div>
        <div className="font-semibold">
          Put in pen {index + 1} of {count}: {layer.label}
        </div>
        <div className="text-pretty text-muted-foreground">
          With the pen up, clamp it so its tip sits about 3 mm above the paper. Try Pen down to see it touch, then Pen up again. When this pen is done, the plotter lifts it and comes back to the origin.
        </div>
      </div>
    </div>
  );
}

function PenTable({ layers, result, children }: { layers: PenLayer[]; result: RenderResult | null; children: (layer: PenLayer, i: number) => ReactNode }) {
  const th = 'micro pb-2 text-right font-normal';
  const td = 'readout py-[5px] pr-3 text-right align-middle';
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-foreground/70">
          <th className={cn(th, 'text-left')}>Pen, in plot order</th>
          <th className={th}>Ink</th>
          <th className={th}>Lifts</th>
          <th className={cn(th, 'pr-3')}>Time</th>
          <th className="pb-2">
            <span className="sr-only">Action</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {layers.map((layer, i) => {
          const stats = result?.stats.pens[layer.pen];
          return (
            <tr key={layer.pen} className="border-b">
              <td className="py-[5px] pr-3 align-middle">
                <span className="flex items-center gap-2">
                  <PenDot color={result?.mono ? MONO_INK : layer.color} />
                  <span className="readout w-3 text-[11px] text-muted-foreground">{i + 1}</span>
                  {layer.label}
                </span>
              </td>
              <td className={td}>{stats ? metres(stats.ink) : ''}</td>
              <td className={td}>{num(layer.lines.length)}</td>
              <td className={td}>{stats ? minutes(stats.seconds) : ''}</td>
              <td className="w-[96px] py-[3px] text-right">{children(layer, i)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SetupFields({ setup, onSetup, locked }: { setup: PlotterSetup; onSetup: (s: PlotterSetup) => void; locked: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 max-[560px]:grid-cols-1">
      <SliderField
        label="Pen down"
        value={setup.penDown}
        display={`Z ${setup.penDown}`}
        min={1}
        max={10}
        step={0.5}
        ticks={9}
        hint="Z 0 holds the pen up. A higher Z presses it harder onto the paper; the UUNA TEK's travel ends near Z 10."
        onChange={(penDown) => onSetup({ ...setup, penDown })}
      />
      <div className={cn(locked && 'pointer-events-none')}>
        <div className="mb-1 text-[13px]">Origin</div>
        <Segmented
          aria-label="Origin corner"
          value={setup.corner}
          onValueChange={(corner) => !locked && onSetup({ ...setup, corner })}
          className={cn('h-8 w-full', locked && 'opacity-50')}
          items={[
            { value: 'top-left', label: 'Top left' },
            { value: 'bottom-left', label: 'Bottom left' },
          ]}
        />
        <div className={cn('mt-1.5', locked && 'opacity-50')}>
          <ToggleKey pressed={setup.turn} onPressedChange={(turn) => !locked && onSetup({ ...setup, turn })}>
            Turn a quarter turn
          </ToggleKey>
        </div>
        <p className="mt-1 mb-0 text-xs leading-relaxed text-pretty text-muted-foreground">
          {locked ? 'Fixed until this plot is finished, so the pens line up.' : "The UUNA TEK's Y axis runs towards you, so its origin is the top-left corner. Turn a portrait sheet to plot it on a landscape bed."}
        </p>
      </div>
    </div>
  );
}
