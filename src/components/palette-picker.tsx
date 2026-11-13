import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { currentPalette, PALETTES } from '../palettes';
import type { Settings } from '../settings';

/**
 * A small test plot of one house, drawn with each pen doing its own job:
 * shadow hatching, a tree, the roof and the linework.
 */
function Vignette({ pens: [shade, nature, roof, line] }: { pens: Settings['pens'] }) {
  return (
    <svg aria-hidden viewBox="0 0 48 30" fill="none" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" className="block h-auto w-full">
      <path stroke={shade} d="M29.5 22.5 33 19M31.5 24 36.5 19M34 24.5 38.5 20M36.5 25 40 21.5" />
      <g stroke={nature}>
        <circle cx={40.5} cy={11} r={4.5} />
        <path d="M40.5 15.5v4.5" />
      </g>
      <path stroke={roof} d="M8 12 13 8.5 18 17M13 8.5 23 3.5 28 12M15.5 10.9 25 6.2" />
      <path stroke={line} d="M8 12v9l10 5 10-5v-9M18 17v9M18 17l10-5M11 16.2v2.6M14.6 18v2.6M21.4 19.3v2.6M24.8 17.6v2.6" />
    </svg>
  );
}

/** Pen sets as a row of test plots. Picking one sets all four pens; editing a pen makes the set custom. */
export function PalettePicker({ pens, onPick, disabled }: { pens: Settings['pens']; onPick: (pens: Settings['pens']) => void; disabled?: boolean }) {
  const current = currentPalette(pens);
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      aria-label="Pen palette"
      value={current?.name ?? ''}
      disabled={disabled}
      onValueChange={(name) => {
        const p = PALETTES.find((x) => x.name === name);
        if (p) onPick([...p.pens]);
      }}
      className={cn('grid grid-cols-4 gap-1.5 transition-opacity', disabled && 'opacity-45')}
    >
      {PALETTES.map((p) => (
        <ToggleGroupPrimitive.Item
          key={p.name}
          value={p.name}
          title={`${p.name}: ${p.pens.join(' ').toUpperCase()}`}
          className="group/pal flex min-w-0 flex-col overflow-hidden rounded-md border bg-card text-left transition-[border-color,box-shadow] outline-none hover:border-input focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none data-[state=on]:border-foreground data-[state=on]:shadow-[0_0_0_1px_var(--foreground)]"
        >
          <span className="block bg-paper px-1.5 pt-1.5 pb-1">
            <Vignette pens={p.pens} />
          </span>
          <span aria-hidden className="flex h-[3px]">
            {p.pens.map((c, i) => (
              <span key={i} className="flex-1" style={{ background: c }} />
            ))}
          </span>
          <span className="flex items-center gap-1.5 px-1.5 py-1">
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full ring-1 ring-input transition-colors group-data-[state=on]/pal:bg-foreground group-data-[state=on]/pal:ring-foreground"
            />
            <span className="truncate text-[11px] leading-tight text-muted-foreground group-hover/pal:text-foreground group-data-[state=on]/pal:font-medium group-data-[state=on]/pal:text-foreground">
              {p.name}
            </span>
          </span>
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}
