import type { KeyboardEvent, ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { MONO_INK } from '../app/model';
import { useSettings } from '../app/settings-context';
import { currentPalette, PALETTES } from '../palettes';
import { PEN_NAMES, sheetSize, SHEETS, type Settings } from '../settings';

export function PenDot({ color, size = 12, className }: { color: string; size?: number; className?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ring-1 ring-black/20 ring-inset ${className ?? ''}`} style={{ background: color, width: size, height: size }} />;
}

/** One cell of the title block. A `live` cell holds a control, which does its own clipping so its hover and focus marks show. */
function Fact({ label, title, live, children }: { label: string; title?: string; live?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0 px-3.5 pt-2.5 pb-3">
      <dt className="micro">{label}</dt>
      <dd className={`m-0 mt-1 text-sm font-semibold tracking-[-0.01em] ${live ? 'min-w-0' : 'truncate'}`} title={title}>
        {children}
      </dd>
    </div>
  );
}

/** The place name, edited in place. It looks like the other facts until it has focus, and commits on Enter or blur. */
function PlaceName() {
  const { set, change } = useSettings();

  function commit(input: HTMLInputElement): void {
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (name && name !== set.place) change('place', name);
    else input.value = set.place;
  }

  function key(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      // Keep Escape from also leaving full size.
      e.preventDefault();
      e.currentTarget.value = set.place;
      e.currentTarget.blur();
    }
  }

  return (
    <input
      // A new key resets the draft whenever the place changes elsewhere.
      key={set.place}
      defaultValue={set.place}
      aria-label="Place name"
      title="Rename the place on the sheet"
      spellCheck={false}
      autoComplete="off"
      maxLength={80}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={key}
      className="-mx-1 block w-[calc(100%+0.5rem)] truncate rounded-[3px] bg-transparent px-1 font-[inherit] tracking-[inherit] text-inherit outline-none hover:bg-muted focus:bg-muted focus:text-clip"
    />
  );
}

/** The pen dots, with a quiet chevron that opens the palettes. */
function PaletteMenu({ pens, mono, onPalette }: { pens: Settings['pens']; mono: boolean; onPalette: (pens: Settings['pens']) => void }) {
  const current = currentPalette(pens);
  const dots = (
    <span className="flex h-5 items-center gap-1">
      {(mono ? [MONO_INK] : pens).map((c, i) => (
        <PenDot key={PEN_NAMES[i]} color={c} size={14} />
      ))}
    </span>
  );
  if (mono) return dots;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Pen palette: ${current?.name ?? 'Custom'}`}
        className="group/pm -mx-1 flex items-center gap-1 rounded-[3px] px-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-muted"
      >
        {dots}
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 text-muted-foreground/70 transition-[color,rotate] group-hover/pm:text-foreground group-data-[state=open]/pm:rotate-180 group-data-[state=open]/pm:text-foreground"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-52 origin-(--radix-dropdown-menu-content-transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 [animation-duration:100ms] data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          <DropdownMenu.Label className="micro px-1.5 pt-1 pb-1.5">Palette</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={current?.name ?? ''}
            onValueChange={(name) => {
              const p = PALETTES.find((x) => x.name === name);
              if (p) onPalette([...p.pens]);
            }}
          >
            {PALETTES.map((p) => (
              <DropdownMenu.RadioItem
                key={p.name}
                value={p.name}
                title={p.pens.join(' ').toUpperCase()}
                className="relative flex cursor-default items-center gap-3 rounded-md py-1.5 pr-2 pl-7 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[state=checked]:font-medium"
              >
                <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <CheckIcon className="size-3.5" />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span className="flex-1 truncate">{p.name}</span>
                <span aria-hidden className="flex items-center gap-1">
                  {p.pens.map((c, i) => (
                    <PenDot key={PEN_NAMES[i]} color={c} size={12} />
                  ))}
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          {!current && <p className="m-0 mt-1 border-t border-border px-1.5 pt-1.5 pb-1 text-xs text-muted-foreground">The pens are a custom set. Picking a palette replaces all five.</p>}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The drawing's title block, as in the corner of a technical drawing: what is on the sheet. */
export function TitleBlock({ onPalette }: { onPalette: (pens: Settings['pens']) => void }) {
  const { set } = useSettings();
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
        <Fact label="Place" live>
          <PlaceName />
        </Fact>
        <Fact label="Sheet" title={`${w} × ${h} mm`}>
          {SHEETS[set.sheet].label} <span className="font-normal text-muted-foreground">{set.landscape ? 'landscape' : 'portrait'}</span>
        </Fact>
        <Fact label="Scale">
          <span className="readout text-sm font-medium">1:{Math.round(set.scale).toLocaleString('en')}</span>
        </Fact>
        <Fact label="Pens" live>
          <PaletteMenu pens={set.pens} mono={set.mono} onPalette={onPalette} />
        </Fact>
      </dl>
    </header>
  );
}
