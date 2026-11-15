import { useEffect, useRef, useState } from 'react';
import { Grbl, Stopped, type MachineStatus } from './grbl';
import { setPlotActivity } from './plot-activity';
import { num } from './model';
import { layerCode, park, penUp, preamble, type PenLayer, type PlotterSetup } from '../gcode';

/** The drawing as it was when plotting began, so a redraw midway can't mix two drawings. */
export type Job = { svg: string; sheet: [number, number]; layers: PenLayer[] };
export type Phase = 'off' | 'connecting' | 'ready' | 'busy' | 'plotting' | 'paused' | 'stopping';
export type Note = { text: string; error?: boolean };

const NO_STATUS: MachineStatus = { state: 'Unknown', pos: null };

/**
 * A plotting session over Web Serial: the connection, the origin, and which pens of the
 * job are plotted. It lives as long as the component that holds it, open dialog or not.
 */
export function usePlotter(setup: PlotterSetup, feed: number) {
  const [phase, setPhase] = useState<Phase>('off');
  const [machine, setMachine] = useState<MachineStatus>(NO_STATUS);
  const [origin, setOrigin] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [plotted, setPlotted] = useState<boolean[]>([]);
  const [active, setActive] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<Note | null>(null);
  const grbl = useRef<Grbl | null>(null);
  const abort = useRef<AbortController | null>(null);

  const running = phase === 'plotting' || phase === 'paused' || phase === 'stopping';

  // Leaving the page mid-plot would cut the stream; ask first.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);
  useEffect(
    () => () => {
      void grbl.current?.close();
    },
    [],
  );

  const report = (e: unknown) => setNote({ text: e instanceof Error ? e.message : String(e), error: true });
  const settle = () => {
    setPhase(grbl.current ? 'ready' : 'off');
    setPlotActivity(grbl.current ? 'Plotter connected' : null);
  };

  async function connect(): Promise<void> {
    setNote(null);
    setPhase('connecting');
    const g = new Grbl(setMachine, () => {
      grbl.current = null;
      abort.current?.abort();
      setPhase('off');
      setOrigin(false);
      setMachine(NO_STATUS);
      setPlotActivity(null);
    });
    try {
      await g.connect();
      grbl.current = g;
      settle();
      await g.run(preamble(setup));
      const max = Math.min(g.settings.get(110) ?? Infinity, g.settings.get(111) ?? Infinity);
      const capped = max < feed ? ` It caps drawing at ${num(max)} mm/min, below the ${num(feed)} mm/min of the plot speed.` : '';
      setNote({ text: `Connected to GRBL ${g.version}.${capped}` });
    } catch (e) {
      settle();
      // Closing the port picker without choosing is not an error.
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) report(e);
    }
  }

  const disconnect = () => grbl.current?.close();

  /** Run a few set-up commands, with the buttons locked meanwhile. */
  async function command(lines: string[], after?: () => void): Promise<void> {
    const g = grbl.current;
    if (!g) return;
    setPhase('busy');
    setNote(null);
    try {
      await g.run(lines);
      after?.();
    } catch (e) {
      report(e);
    }
    settle();
  }

  const setOriginHere = () => command([penUp(setup), 'G92 X0 Y0'], () => setOrigin(true));

  /** Jog by mm on the paper as you face the plotter: x to the right, y towards you. */
  function jog(dx: number, dy: number): void {
    grbl.current?.jog(dx, setup.corner === 'top-left' ? dy : -dy).catch(report);
  }

  /** Plot one pen of the job, starting the job from `fresh` if none is under way. */
  async function plot(i: number, fresh: Job): Promise<void> {
    const g = grbl.current;
    if (!g) return;
    const j = job ?? fresh;
    const done = job ? plotted : j.layers.map(() => false);
    if (!job) {
      setJob(j);
      setPlotted(done);
    }
    const layer = j.layers[i];
    const lines = [...preamble(setup), ...layerCode(layer, j.sheet, setup, feed), ...park(setup)];
    const ctrl = new AbortController();
    abort.current = ctrl;
    setActive(i);
    setProgress(0);
    setPhase('plotting');
    setPlotActivity(`Plotting ${layer.label}`);
    setNote(null);
    let shownAt = 0;
    const tick = (n: number) => {
      const now = performance.now();
      if (now - shownAt < 150 && n < lines.length) return;
      shownAt = now;
      setProgress(n / lines.length);
    };
    try {
      await g.stream(lines, tick, ctrl.signal);
      setPlotted((p) => p.map((v, k) => v || k === i));
      const more = done.some((v, k) => k !== i && !v);
      setNote({ text: more ? `Pen ${i + 1} is done. The pen is up and parked at the origin.` : 'Every pen is plotted. The pen is up and parked at the origin.' });
    } catch (e) {
      if (e instanceof Stopped || ctrl.signal.aborted) setNote({ text: `Stopped pen ${i + 1}. The pen is up and back at the origin. Plot it again to start this pen over.` });
      else {
        report(e);
        // Don't leave the pen pressed on the paper after an error.
        await g.run(park(setup)).catch(() => undefined);
      }
    }
    abort.current = null;
    setActive(-1);
    settle();
  }

  function pause(): void {
    const g = grbl.current;
    const label = job && active >= 0 ? job.layers[active].label : '';
    if (!g) return;
    if (phase === 'plotting') {
      g.hold();
      setPhase('paused');
      setPlotActivity(`Paused ${label}`);
    } else if (phase === 'paused') {
      g.resume();
      setPhase('plotting');
      setPlotActivity(`Plotting ${label}`);
    }
  }

  async function stop(): Promise<void> {
    const g = grbl.current;
    if (!g) return;
    setPhase('stopping');
    setPlotActivity('Stopping');
    abort.current?.abort();
    try {
      await g.stop(penUp(setup));
    } catch (e) {
      report(e);
    }
  }

  function startOver(): void {
    setJob(null);
    setPlotted([]);
    setNote(null);
  }

  return {
    phase,
    machine,
    origin,
    job,
    plotted,
    active,
    progress,
    note,
    running,
    connected: phase !== 'off' && phase !== 'connecting',
    connect,
    disconnect,
    command,
    setOriginHere,
    jog,
    plot,
    pause,
    stop,
    startOver,
  };
}

export type Plotter = ReturnType<typeof usePlotter>;
