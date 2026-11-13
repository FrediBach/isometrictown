import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { SearchIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LngLat } from '../geo';
import { matchCities, searchPlaces, suggestPlaces, type Place } from '../search';
import { Hint } from './fields';

function shortName(p: Place): string {
  return p.name || p.label.split(',')[0];
}

export function PlaceSearch({ onPick }: { onPick: (center: LngLat, name: string) => void }) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState('');
  const timer = useRef(0);
  const abort = useRef<AbortController | null>(null);

  function show(places: Place[]): void {
    setShown(places);
    setActive(-1);
    setOpen(places.length > 0);
  }

  function pick(p: Place): void {
    setOpen(false);
    setQuery('');
    setStatus('');
    onPick(p.center, shortName(p));
  }

  function onInput(value: string): void {
    setQuery(value);
    clearTimeout(timer.current);
    const q = value.trim();
    if (q.length < 2) {
      show([]);
      return;
    }
    timer.current = window.setTimeout(async () => {
      abort.current?.abort();
      abort.current = new AbortController();
      const signal = abort.current.signal;
      const local = await matchCities(q, 3);
      show(local);
      try {
        const remote = await suggestPlaces(q, signal);
        show([...local, ...remote].slice(0, 7));
      } catch {
        /* keep the local matches */
      }
    }, 180);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (!open || !shown.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (open && active >= 0 && shown[active]) return pick(shown[active]);
    const q = query.trim();
    if (!q) return;
    setStatus('Searching...');
    try {
      const found = await searchPlaces(q);
      if (found.length) pick(found[0]);
      else setStatus(`Nothing found for "${q}".`);
    } catch {
      setStatus('Search is not reachable right now.');
    }
  }

  return (
    <>
      <form className="relative" role="search" autoComplete="off" onSubmit={onSubmit}>
        <div className="flex h-10 items-stretch overflow-hidden rounded-md border border-input bg-card transition-shadow focus-within:border-foreground/40 focus-within:ring-3 focus-within:ring-ring/30">
          <SearchIcon aria-hidden className="ml-3 size-4 shrink-0 self-center text-muted-foreground" />
          <input
            type="search"
            className="min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            placeholder="Search a town or street"
            aria-label="Search a place"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="suggestions"
            aria-expanded={open}
            aria-activedescendant={open && active >= 0 ? `sugg-${active}` : undefined}
            value={query}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
          />
          <button
            type="submit"
            className="m-1 rounded-[4px] bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Go
          </button>
        </div>
        <ul
          id="suggestions"
          role="listbox"
          hidden={!open}
          className="absolute inset-x-0 top-[calc(100%+4px)] z-20 m-0 list-none overflow-hidden rounded-md border border-input bg-popover py-1 text-popover-foreground shadow-[0_12px_32px_rgb(0_0_0/0.14)]"
        >
          {shown.map((p, i) => (
            <li
              key={`${p.label}-${i}`}
              id={`sugg-${i}`}
              role="option"
              aria-selected={i === active}
              className={cn(
                'relative flex cursor-pointer flex-col gap-0.5 py-1.5 pr-3 pl-4 before:absolute before:inset-y-1.5 before:left-1.5 before:w-0.5 before:rounded-full',
                i === active ? 'bg-muted before:bg-signal' : 'hover:bg-muted',
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
            >
              <span className="text-sm font-medium">{shortName(p)}</span>
              <span className="readout truncate text-[11px] text-muted-foreground">{p.label}</span>
            </li>
          ))}
        </ul>
      </form>
      <Hint className="mt-2 mb-0" role="status">
        {status}
      </Hint>
    </>
  );
}
