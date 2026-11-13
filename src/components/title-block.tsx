import type { ReactNode } from 'react';
import { MONO_INK } from '../app/model';
import { sheetSize, SHEETS, type Settings } from '../settings';

export function PenDot({ color, size = 12, className }: { color: string; size?: number; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ring-1 ring-black/20 ring-inset ${className ?? ''}`} style={{ background: color, width: size, height: size }} />;
}

function Fact({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 px-3.5 pt-2.5 pb-3">
      <dt className="micro">{label}</dt>
      <dd className="m-0 mt-1 truncate text-sm font-semibold tracking-[-0.01em]" title={title}>
        {children}
      </dd>
    </div>
  );
}

/** The drawing's title block, as in the corner of a technical drawing: what is on the sheet. */
export function TitleBlock({ set }: { set: Settings }) {
  const [w, h] = sheetSize(set);
  return (
    <header className="mb-5 overflow-hidden rounded-lg border border-input bg-card">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <img src="/logo.svg" alt="" width={40} height={40} className="flex-none" />
        <div className="min-w-0">
          <h1 className="m-0 text-xl leading-tight font-semibold tracking-[-0.025em]">Isometric Town</h1>
          <p className="m-0 mt-0.5 text-xs text-muted-foreground">Any town, drawn in 3D for pen plotters</p>
        </div>
      </div>
      <dl className="m-0 grid grid-cols-[1.25fr_1fr] border-t border-input [&>*:nth-child(-n+2)]:border-b [&>*:nth-child(odd)]:border-r">
        <Fact label="Place">{set.place}</Fact>
        <Fact label="Sheet" title={`${w} × ${h} mm`}>
          {SHEETS[set.sheet].label} <span className="font-normal text-muted-foreground">{set.landscape ? 'landscape' : 'portrait'}</span>
        </Fact>
        <Fact label="Scale">
          <span className="readout text-sm font-medium">1:{Math.round(set.scale).toLocaleString('en')}</span>
        </Fact>
        <Fact label="Pens">
          <span className="flex h-5 items-center gap-1">
            {(set.mono ? [MONO_INK] : set.pens).map((c, i) => (
              <PenDot key={i} color={c} size={14} />
            ))}
          </span>
        </Fact>
      </dl>
    </header>
  );
}
