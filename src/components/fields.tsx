import { useId, useState, type ReactNode } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Slider } from '@/components/ui/slider';
import { ToggleKey } from '@/components/ui/toggle-key';
import { cn } from '@/lib/utils';

function Heading({ index, title }: { index: number; title: string }) {
  return (
    <span className="flex items-baseline gap-2.5">
      <span className="readout text-[11px] text-muted-foreground">{String(index).padStart(2, '0')}</span>
      <span className="text-[13px] font-semibold tracking-[-0.005em]">{title}</span>
    </span>
  );
}

/** A numbered block of controls, like a numbered field on a drawing. */
export function Section({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <section className="border-t">
      <h2 className="m-0 flex h-12 items-center font-normal">
        <Heading index={index} title={title} />
      </h2>
      <div className="pb-5">{children}</div>
    </section>
  );
}

/**
 * A numbered section that folds away. Folded, it shows a one-line summary of its
 * settings, so the panel still reads as a complete record of the drawing.
 */
export function FoldingSection({ index, title, summary, defaultOpen = false, children }: { index: number; title: string; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t">
      <CollapsibleTrigger className="group -mx-1.5 flex h-12 w-[calc(100%+12px)] items-center gap-3 rounded-md px-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Heading index={index} title={title} />
        <span className="readout min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground group-data-[state=open]:invisible">{summary}</span>
        <span
          aria-hidden
          className="grid size-[18px] shrink-0 place-items-center rounded-full border border-input bg-card transition-colors group-hover:border-foreground/50 group-data-[state=open]:border-primary group-data-[state=open]:bg-primary"
        >
          <span className="size-1.5 rounded-full bg-input transition-colors group-data-[state=open]:bg-primary-foreground" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-5">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function Hint({ children, className, role }: { children?: ReactNode; className?: string; role?: string }) {
  return (
    <p role={role} className={cn('mt-0.5 mb-3 text-xs leading-relaxed text-pretty text-muted-foreground empty:hidden', className)}>
      {children}
    </p>
  );
}

type SliderFieldProps = {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  ticks?: number;
  hint?: ReactNode;
  onChange: (v: number) => void;
};

/** Label and readout on one line, the dial below, an optional note under it. */
export function SliderField({ label, value, display, min, max, step, ticks, hint, onChange }: SliderFieldProps) {
  const id = useId();
  return (
    <div className="mb-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span id={id} className="text-[13px]">
          {label}
        </span>
        <output className="readout text-foreground">{display}</output>
      </div>
      <Slider className="mt-0.5" aria-labelledby={id} value={[value]} min={min} max={max} step={step} ticks={ticks} onValueChange={([v]) => onChange(v)} />
      {hint && <Hint className="mt-1">{hint}</Hint>}
    </div>
  );
}

export function KeyGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mt-3 grid grid-cols-2 gap-1.5', className)}>{children}</div>;
}

export function Key({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <ToggleKey pressed={on} onPressedChange={onChange}>
      {label}
    </ToggleKey>
  );
}

/** A small mono caption that names a group of controls inside a section. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('micro mb-2', className)}>{children}</div>;
}
