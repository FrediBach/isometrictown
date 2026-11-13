import { useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { num } from '../app/model';
import type { RenderStatus } from '../app/renderer';
import { STAGE_LABEL, STAGES, type Stage } from '../app/stages';

/* Isometric line icons on a 64 unit square, one per step, drawn like a plot: pen down, then lift and go again. */

const S = 1.4;
const at = (x: number, y: number, z = 0) => [32 + (x - y) * 0.866 * S, 38 + (x + y) * 0.5 * S - z * S] as const;
const iso = (x: number, y: number, z = 0) => at(x, y, z).map((v) => v.toFixed(2)).join(' ');
const line = (pts: [number, number, number?][], close = false) => `M${pts.map(([x, y, z]) => iso(x, y, z)).join(' L')}${close ? ' Z' : ''}`;
const rect = (x0: number, y0: number, x1: number, y1: number, z = 0) => line([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], true);

/** The edges of a box you can see from the viewer's side. */
function box(x0: number, y0: number, x1: number, y1: number, h: number): string {
  return [
    line([[x0, y1], [x1, y1], [x1, y0], [x1, y0, h], [x0, y0, h], [x0, y1, h], [x1, y1, h], [x1, y0, h]]),
    line([[x0, y1], [x0, y1, h]]),
    line([[x1, y1], [x1, y1, h]]),
  ].join(' ');
}

const delay = (s: number) => ({ '--d': `${s}s` }) as CSSProperties;

function Draw({ d, at = 0, className }: { d: string; at?: number; className?: string }) {
  return <path d={d} pathLength={1} className={cn('ip-draw', className)} style={delay(at)} />;
}

function MapIcon() {
  const tiles: ReactNode[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const x = -10.5 + i * 7;
      const y = -10.5 + j * 7;
      tiles.push(<path key={`${i}${j}`} d={rect(x, y, x + 6, y + 6)} className="ip-pop fill-current/10" style={delay((i + j) * 0.18 + i * 0.06)} />);
    }
  return <>{tiles}</>;
}

function GroundIcon() {
  return (
    <>
      <Draw d={rect(-12, -12, 12, 12)} />
      {[-8, -4, 0, 4, 8].map((y, k) => (
        <Draw key={y} d={line([[-12, y], [12, y]])} at={0.5 + k * 0.16} className="opacity-60" />
      ))}
    </>
  );
}

function BuildingsIcon() {
  return (
    <>
      <path d={rect(-14, -14, 14, 14)} className="opacity-20" />
      <Draw d={box(-10, 4, -4, 10, 10)} />
      <Draw d={box(-3, -3, 3, 3, 18)} at={0.45} />
      <Draw d={box(4, -10, 10, -4, 13)} at={0.9} />
    </>
  );
}

function LifeIcon() {
  const trees: [number, number, number][] = [
    [-9, 5, 0],
    [-4, -4, 0.3],
    [7, -7, 0.6],
  ];
  return (
    <>
      <path d={rect(-14, -14, 14, 14)} className="opacity-20" />
      {trees.map(([x, y, t]) => {
        const [cx, cy] = at(x, y, 9);
        return (
          <g key={`${x}${y}`} className="ip-pop" style={delay(t)}>
            <path d={line([[x, y], [x, y, 5]])} />
            <circle cx={cx} cy={cy} r={4.4} className="fill-current/10" />
          </g>
        );
      })}
      <Draw d={box(2, 5, 6, 8, 2.2)} at={0.9} />
    </>
  );
}

function LightIcon() {
  return (
    <>
      <g className="ip-spin">
        <circle cx={54} cy={12} r={3.2} />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
          const [c, s] = [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
          return <line key={a} x1={54 + c * 5.4} y1={12 + s * 5.4} x2={54 + c * 7} y2={12 + s * 7} />;
        })}
      </g>
      {/* The sun is up and to the right, so the shadow falls forward and left. */}
      <path d={rect(-3, -3, 3, 11)} className="opacity-30" />
      {[-3, -1, 1, 3, 5, 7, 9].map((y, k) => (
        <Draw key={y} d={line([[-3, y], [3, y + 2]])} at={0.35 + k * 0.12} className="opacity-70" />
      ))}
      <Draw d={box(-3, -9, 3, -3, 11)} />
    </>
  );
}

const SERPENTINE = line([
  [-11, -11],
  [11, -11],
  [11, -5],
  [-11, -5],
  [-11, 1],
  [11, 1],
  [11, 7],
  [-11, 7],
]);

function LinesIcon({ still }: { still: boolean }) {
  const t = { dur: '3.2s', repeatCount: 'indefinite', keyTimes: '0;0.8;1' };
  return (
    <>
      <path d={rect(-13, -13, 13, 13)} className="opacity-20" />
      <path d={SERPENTINE} pathLength={1} strokeDasharray={1} strokeDashoffset={still ? 0 : 1}>
        {!still && <animate attributeName="stroke-dashoffset" values="1;0;0" {...t} />}
      </path>
      {!still && (
        <g className="text-signal">
          <line x1={0} y1={0} x2={0} y2={-9} strokeWidth={2.4} strokeLinecap="round" className="opacity-80" />
          <circle r={1.5} className="fill-current" stroke="none" />
          <animateMotion path={SERPENTINE} keyPoints="0;1;1" calcMode="linear" {...t} />
        </g>
      )}
    </>
  );
}

const STOPS: [number, number][] = [
  [10, 40],
  [18, 22],
  [29, 33],
  [33, 14],
  [44, 27],
  [41, 46],
  [54, 38],
  [52, 18],
];

function PlanIcon() {
  return (
    <>
      <path d={`M${STOPS.map((p) => p.join(' ')).join(' L')}`} className="ip-march text-signal" />
      {STOPS.map(([x, y], i) => (
        <g key={i} className="ip-pop" style={delay(i * 0.12)}>
          <line x1={x - 2.6} y1={y + 1.5} x2={x + 2.6} y2={y - 1.5} />
          <circle cx={x} cy={y} r={1.3} className="fill-current" stroke="none" />
        </g>
      ))}
    </>
  );
}

function StageIcon({ stage, still }: { stage: Stage; still: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-20 overflow-visible', still && 'ip-still')} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round">
      {/* Keyed by step, so each icon starts drawing from the beginning. */}
      <g key={stage}>
        {stage === 'map' && <MapIcon />}
        {stage === 'ground' && <GroundIcon />}
        {stage === 'buildings' && <BuildingsIcon />}
        {stage === 'life' && <LifeIcon />}
        {stage === 'light' && <LightIcon />}
        {stage === 'lines' && <LinesIcon still={still} />}
        {stage === 'plan' && <PlanIcon />}
      </g>
    </svg>
  );
}

const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (cb: () => void) => {
  const mq = matchMedia(REDUCED);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const useReducedMotion = () => useSyncExternalStore(subscribeMotion, () => matchMedia(REDUCED).matches);

function useElapsed(): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    const id = setInterval(() => setMs(performance.now() - t0), 100);
    return () => clearInterval(id);
  }, []);
  return ms;
}

function Panel({ status }: { status: RenderStatus }) {
  const p = status.progress ?? { stage: 'map' as const };
  const step = STAGES.indexOf(p.stage);
  const share = p.total ? Math.min(1, (p.done ?? 0) / p.total) : null;
  const still = useReducedMotion();
  const elapsed = useElapsed();
  const counted = p.total ? `${num(p.done ?? 0)} of ${num(p.total)} ${p.stage === 'map' ? 'tiles' : 'footprints'}` : '';

  return (
    // The toolbar's status line already announces each step, so this stays out of the accessibility tree.
    <div aria-hidden className="dark pointer-events-none absolute inset-0 grid place-items-center p-6">
      <div className="ip-enter w-[272px] rounded-md border bg-background/85 px-5 pt-5 pb-4 text-foreground shadow-[0_16px_48px_rgb(0_0_0/0.45)] backdrop-blur-md">
        <div className="grid place-items-center pb-3">
          <StageIcon stage={p.stage} still={still} />
        </div>
        <div className="micro flex justify-between text-muted-foreground">
          <span>
            Step {step + 1} of {STAGES.length}
          </span>
          <span className="tabular-nums">{(elapsed / 1000).toFixed(1)} s</span>
        </div>
        <div className="mt-1.5 text-[15px] font-medium tracking-tight">{STAGE_LABEL[p.stage]}</div>
        <div className="readout mt-0.5 h-4 truncate text-[11px] text-muted-foreground">{p.note}</div>
        <div className="readout h-4 truncate text-[11px] text-muted-foreground/70">{counted}</div>
        <div className="mt-3.5 flex gap-1">
          {STAGES.map((s, i) => (
            <span key={s} className={cn('relative h-[3px] flex-1 overflow-hidden rounded-full', i < step ? 'bg-foreground/70' : 'bg-foreground/15')}>
              {i === step && (
                <span
                  className={cn('absolute inset-y-0 left-0 rounded-full bg-signal', share === null && 'w-full [animation:lamp_1s_ease-in-out_infinite]')}
                  style={share === null ? undefined : { width: `${Math.max(6, share * 100)}%` }}
                />
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A card over the stage while a drawing is being made: what step it is on, with a small plot of that step. */
export function DrawingProgress({ status }: { status: RenderStatus }) {
  return status.state === 'working' ? <Panel status={status} /> : null;
}
