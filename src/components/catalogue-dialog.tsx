import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SearchIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { metres, num } from '../app/model';
import type { RenderResult } from '../app/renderer';
import { ENTRIES, entryLayer, filed, GATE_LABEL, gateOn, GROUPS, matcher, showsFrom, SOURCES, type Entry, type Source } from '../catalogue';
import { LOD } from '../lod';
import type { LayerId, Settings } from '../settings';
import type { Strokes } from '../worker';
import { PIN_KIND_IDS, PIN_KINDS, PINS_MAX, type PinKindId } from '../image-pins';
import { PIN_ICONS } from './pin-icons';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: RenderResult | null;
  set: Settings;
  /** Ask the worker for the strokes the drawing on show filed under some tally names. */
  onStrokes: (names: string[]) => Promise<Strokes | null>;
  /** In image mode with a picture, pin a kind of thing to it; missing where none can be pinned. */
  onPin?: (kind: PinKindId) => void;
};

/** What an entry comes to in the drawing on show. `present` is null when there's no drawing. */
type Found = { names: string[]; strokes: number; ink: number; count: number | null; present: boolean | null };

const MATCHERS = new Map(ENTRIES.map((e) => [e.id, (e.strokes ?? []).map(matcher)]));
const BY_ID = new Map(ENTRIES.map((e) => [e.id, e]));
const SOURCE_FILTERS: ('all' | Source)[] = ['all', 'map', 'tags', 'inferred', 'invented'];

/** Every entry against the drawing on show: which strokes and how many of it there are. */
function survey(result: RenderResult | null, set: Settings): Map<string, Found> {
  const names = result ? Object.keys(result.features).map(filed) : [];
  const active = set.style === 'auto' ? result?.region.style : set.style;
  const out = new Map<string, Found>();
  for (const e of ENTRIES) {
    const tests = MATCHERS.get(e.id)!;
    const hit = tests.length ? names.filter((f) => tests.some((t) => t(f))) : [];
    let strokes = 0;
    let ink = 0;
    for (const f of hit) {
      const [s, i] = result!.features[f.name];
      strokes += s;
      ink += i;
    }
    const count = e.count && result ? e.count.reduce((a, k) => a + (result.census[k] ?? 0), 0) : null;
    let present: boolean | null = null;
    if (result) {
      if (e.style) present = e.style === active;
      else if (e.strokes || e.count) present = strokes > 0 || (count ?? 0) > 0;
      // Things with no strokes of their own (a habit, the side of the road) are there when switched on.
      else present = (e.needs ?? []).every((g) => gateOn(set, g));
    }
    out.set(e.id, { names: hit.map((f) => f.name), strokes, ink, count, present });
  }
  return out;
}

const plural = (n: number, unit: string) => `${num(n)} ${unit}${n === 1 ? '' : 's'}`;
const scale = (n: number) => `1:${num(Math.round(n))}`;

/** Why an entry isn't in the drawing on show, as far as the settings can tell. */
function absence(e: Entry, set: Settings): string {
  const off = (e.needs ?? []).filter((g) => !gateOn(set, g));
  if (off.length) return `Switched off: ${off.map((g) => GATE_LABEL[g] ?? g).join(', ')}.`;
  const layer = entryLayer(e);
  const small = (e.lod ?? []).map((r) => [r, showsFrom(set, r, layer)] as const).filter(([, from]) => from < set.scale);
  if (small.length && small.length === (e.lod ?? []).length) return `Too small at ${scale(set.scale)}: a typical one shows from ${scale(Math.max(...small.map(([, f]) => f)))} at this Detail and pen.`;
  return 'None in this view. The map may have none here, or the seed placed none.';
}

const results = new WeakMap<RenderResult, number>();
let resultNo = 0;
/** A stable number for each drawing, to key the strokes asked of it. */
const idOf = (r: RenderResult) => {
  let n = results.get(r);
  if (n === undefined) results.set(r, (n = ++resultNo));
  return n;
};

export function CatalogueDialog({ open, onOpenChange, result, set, onStrokes, onPin }: Props) {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | Source>('all');
  const [onlyHere, setOnlyHere] = useState(false);
  const [selected, setSelected] = useState(ENTRIES[0].id);
  const [view, setView] = useState<'near' | 'sheet'>('near');
  const q = useDeferredValue(query.trim().toLowerCase());

  const found = useMemo(() => (open ? survey(result, set) : null), [open, result, set]);
  const url = useSvgUrl(open ? result : null);
  const visible = useMemo(
    () =>
      ENTRIES.filter((e) => {
        if (source !== 'all' && !e.source.includes(source)) return false;
        if (onlyHere && !found?.get(e.id)?.present) return false;
        if (!q) return true;
        return `${e.name} ${e.what} ${e.how} ${e.regions ?? ''}`.toLowerCase().includes(q);
      }),
    [q, source, onlyHere, found],
  );
  const here = found ? [...found.values()].filter((f) => f.present).length : 0;
  const entry = BY_ID.get(selected) ?? ENTRIES[0];
  const f = found?.get(entry.id);

  const list = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = visible.findIndex((v) => v.id === selected);
    const next = visible[Math.max(0, Math.min(visible.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    setSelected(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-entry="${next.id}"]`)?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(780px,calc(100vh-32px))] max-w-[min(1120px,calc(100vw-32px))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-lg border border-input bg-background p-0 ring-0 sm:max-w-[1120px]">
        <DialogHeader className="flex-row items-end justify-between gap-4 border-b border-input bg-card px-6 py-4 pr-14 text-left">
          <div>
            <DialogTitle className="text-lg leading-tight font-semibold tracking-[-0.02em]">Catalogue</DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-muted-foreground">Everything the drawing finds in the map, works out from it, or makes up.</DialogDescription>
          </div>
          <span className="readout shrink-0 text-[11px] text-muted-foreground max-[640px]:hidden">{result ? `${here} of ${ENTRIES.length} in this drawing` : `${ENTRIES.length} entries`}</span>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[300px_minmax(0,1fr)] max-[760px]:grid-cols-1 max-[760px]:grid-rows-[minmax(0,40%)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r border-input max-[760px]:border-r-0 max-[760px]:border-b">
            <div className="flex flex-col gap-2 border-b px-3 py-3">
              <label className="flex h-9 items-center gap-2 rounded-md border border-input bg-card px-2.5 focus-within:ring-3 focus-within:ring-ring/50">
                <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <input type="text" enterKeyHint="search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Search" aria-label="Search the catalogue" className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
              </label>
              <div className="flex items-center gap-2">
                <Select value={source} onValueChange={(v) => setSource(v as 'all' | Source)}>
                  <SelectTrigger aria-label="Source" className="h-8 min-w-0 flex-1 rounded-md bg-card text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-md">
                    {SOURCE_FILTERS.map((s) => (
                      <SelectItem key={s} value={s} className="rounded-[4px]">
                        {s === 'all' ? 'All sources' : SOURCES[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  aria-pressed={onlyHere}
                  disabled={!result}
                  onClick={() => setOnlyHere(!onlyHere)}
                  className="flex h-8 shrink-0 items-center gap-2 rounded-md border border-input bg-card px-2.5 text-[13px] outline-none hover:border-foreground/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <Lamp on={onlyHere} />
                  In drawing
                </button>
              </div>
            </div>
            <div ref={list} role="listbox" aria-label="Catalogue entries" onKeyDown={move} className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-4">
              {GROUPS.map((g, gi) => {
                const items = visible.filter((e) => e.group === g.id);
                if (!items.length) return null;
                return (
                  <div key={g.id} role="group" aria-labelledby={`cat-${g.id}`}>
                    <div id={`cat-${g.id}`} className="flex items-baseline gap-2 px-2 pt-3 pb-1">
                      <span className="readout text-[10.5px] text-muted-foreground">{String(gi + 1).padStart(2, '0')}</span>
                      <span className="micro">{g.title}</span>
                    </div>
                    {items.map((e) => {
                      const it = found?.get(e.id);
                      const on = e.id === entry.id;
                      return (
                        <button
                          key={e.id}
                          type="button"
                          role="option"
                          aria-selected={on}
                          data-entry={e.id}
                          tabIndex={on ? 0 : -1}
                          onClick={() => setSelected(e.id)}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md px-2 py-[5px] text-left text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                            on ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
                            !on && it?.present === false && 'text-muted-foreground',
                          )}
                        >
                          <Lamp on={!!it?.present} inverse={on} />
                          <span className="min-w-0 flex-1 truncate">{e.name}</span>
                          {it?.count ? <span className={cn('readout text-[11px]', on ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{num(it.count)}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {!visible.length && <p className="px-2 py-6 text-[13px] text-muted-foreground">Nothing matches.</p>}
            </div>
          </div>

          <Detail key={entry.id} entry={entry} found={f} result={result} url={url} set={set} open={open} view={view} onView={setView} onStrokes={onStrokes} onPin={onPin} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** An object URL for a drawing's SVG, to show it as an image; revoked when the drawing changes. */
function useSvgUrl(result: RenderResult | null): string | null {
  const [url, setUrl] = useState<{ of: RenderResult; url: string } | null>(null);
  useEffect(() => {
    if (!result) return;
    const u = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
    setUrl({ of: result, url: u });
    return () => URL.revokeObjectURL(u);
  }, [result]);
  return url && url.of === result ? url.url : null;
}

/** A status lamp: filled when the thing is in the drawing, an empty ring when not. */
function Lamp({ on, inverse = false }: { on: boolean; inverse?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn('size-2 shrink-0 rounded-full border', inverse ? (on ? 'border-primary-foreground bg-primary-foreground' : 'border-primary-foreground/60') : on ? 'border-primary bg-primary' : 'border-input')}
    />
  );
}

type DetailProps = {
  entry: Entry;
  found: Found | undefined;
  result: RenderResult | null;
  /** The drawing's SVG as an image URL. */
  url: string | null;
  set: Settings;
  open: boolean;
  view: 'near' | 'sheet';
  onView: (v: 'near' | 'sheet') => void;
  onStrokes: Props['onStrokes'];
  onPin?: Props['onPin'];
};

const ROW = 'grid grid-cols-[112px_minmax(0,1fr)] items-baseline gap-4 border-b py-2 max-[640px]:grid-cols-1 max-[640px]:gap-1';
const DT = 'text-[12.5px] text-muted-foreground';

/** What an entry comes to in the drawing on show, or why it isn't there. */
function InDrawing({ entry: e, found: f, result, set }: Pick<DetailProps, 'entry' | 'found' | 'result' | 'set'>) {
  if (!result) return <span className="text-muted-foreground">Nothing drawn yet.</span>;
  if (e.style) return f?.present ? 'Drawn in this style.' : <span className="text-muted-foreground">Another style is in use.</span>;
  const now = e.now?.({ set, region: result.region });
  const counted = f?.count ? plural(f.count, e.unit ?? 'building') : '';
  const tally = f && f.strokes > 0 ? `${plural(f.strokes, 'stroke')}, ${metres(f.ink)} of ink` : '';
  if (now || counted || tally) return <span className="readout text-[12px]">{[now, counted, tally].filter(Boolean).join(' · ')}</span>;
  if (f?.present === false || e.strokes || e.count) return <span className="text-muted-foreground">{absence(e, set)}</span>;
  return <span className="text-muted-foreground">Not counted.</span>;
}

/** The level-of-detail rules an entry obeys, and whether a typical one shows at the scale drawn. */
function Rules({ rules, set, layer }: { rules: NonNullable<Entry['lod']>; set: Settings; layer: LayerId | undefined }) {
  return (
    <dd className="m-0 flex flex-col gap-1.5 text-[13.5px]">
      {rules.map((r) => {
        const from = showsFrom(set, r, layer);
        const shows = from >= set.scale;
        return (
          <span key={r} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
            <span className="text-pretty">{LOD[r].what}</span>
            <span className={cn('readout text-right text-[11.5px]', !shows && 'text-muted-foreground')} title={`A typical one is ${LOD[r].m} m and needs ${LOD[r].mm} mm on paper at Detail 1 with a 0.35 mm pen`}>
              from {scale(from)} {shows ? '✓' : '·'}
            </span>
          </span>
        );
      })}
      <span className="text-[12px] text-muted-foreground">Coarsest scale a typical one shows at, with this Detail and pen. This drawing is at {scale(set.scale)}; bigger ones last longer.</span>
    </dd>
  );
}

function Detail({ entry: e, found: f, result, url, set, open, view, onView, onStrokes, onPin }: DetailProps) {
  const group = GROUPS.find((g) => g.id === e.group)!;
  // Image mode can be told where to put some things: the kinds of pin that place this one.
  const pinnable = set.source === 'image' ? PIN_KIND_IDS.filter((k) => PIN_KINDS[k].entry === e.id) : [];
  const pinned = set.imagePins.filter((p) => pinnable.includes(p.kind)).length;

  return (
    <div className="min-h-0 overflow-y-auto px-7 pt-5 pb-8 max-[640px]:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="micro">{group.title}</span>
        <span className="flex flex-wrap gap-1.5">
          {e.source.map((s) => (
            <span key={s} title={SOURCES[s].note} className="readout rounded-full border border-input px-2 py-px text-[10.5px] text-muted-foreground">
              {SOURCES[s].label}
            </span>
          ))}
        </span>
      </div>
      <h3 className="mt-2 mb-2 text-xl leading-tight font-semibold tracking-[-0.02em]">{e.name}</h3>
      <p className="m-0 max-w-[68ch] text-[15px] leading-normal text-pretty">{e.what}</p>

      {(e.strokes || e.count) && <Preview entry={e} found={f} result={result} url={url} set={set} open={open} view={view} onView={onView} onStrokes={onStrokes} />}

      <dl className="mt-5 mb-0 border-t border-foreground/70">
        <div className={ROW}>
          <dt className={DT}>How it’s found</dt>
          <dd className="m-0 max-w-[68ch] text-[13.5px] leading-relaxed text-pretty">{e.how}</dd>
        </div>
        {pinnable.length > 0 && (
          <div className={ROW}>
            <dt className={DT}>Pin one</dt>
            <dd className="m-0 flex flex-col items-start gap-2 text-[13.5px]">
              <span className="max-w-[68ch] text-pretty">{pinnable.map((k) => PIN_KINDS[k].note).join(' ')} {pinned ? `This drawing has ${plural(pinned, 'pin')} for it.` : ''}</span>
              <span className="flex flex-wrap gap-1.5">
                {pinnable.map((k) => {
                  const Icon = PIN_ICONS[k];
                  return (
                    <button key={k} type="button" disabled={!onPin} onClick={() => onPin?.(k)} aria-label={`Pin ${PIN_KINDS[k].label.toLowerCase()} to the picture`} title="Pin it to the middle of the picture, then drag it where you want it" className="flex h-8 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-[13px] outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:text-muted-foreground">
                      <Icon aria-hidden />
                      {PIN_KINDS[k].label}
                    </button>
                  );
                })}
              </span>
              {!onPin && <span className="text-[12px] text-muted-foreground">{`Choose an image first. A drawing keeps at most ${PINS_MAX} pins.`}</span>}
            </dd>
          </div>
        )}
        {e.regions && (
          <div className={ROW}>
            <dt className={DT}>By region</dt>
            <dd className="m-0 max-w-[68ch] text-[13.5px] leading-relaxed text-pretty">{e.regions}</dd>
          </div>
        )}
        <div className={ROW}>
          <dt className={DT}>This drawing</dt>
          <dd className="m-0 text-[13.5px]">
            <InDrawing entry={e} found={f} result={result} set={set} />
          </dd>
        </div>
        {e.source.map((s) => (
          <div key={s} className={ROW}>
            <dt className={DT}>{SOURCES[s].label}</dt>
            <dd className="m-0 text-[13.5px] text-muted-foreground">{SOURCES[s].note}</dd>
          </div>
        ))}
        {!!e.needs?.length && (
          <div className={ROW}>
            <dt className={DT}>Switched by</dt>
            <dd className="m-0 flex flex-col gap-1 text-[13.5px]">
              {e.needs.map((g) => (
                <span key={g} className="flex items-center gap-2">
                  <Lamp on={gateOn(set, g)} />
                  {GATE_LABEL[g] ?? g}
                  <span className="readout text-[11px] text-muted-foreground">{gateOn(set, g) ? 'on' : 'off'}</span>
                </span>
              ))}
            </dd>
          </div>
        )}
        {!!e.lod?.length && (
          <div className={ROW}>
            <dt className={DT}>Level of detail</dt>
            <Rules rules={e.lod} set={set} layer={entryLayer(e)} />
          </div>
        )}
        {e.facts?.map(([k, v]) => (
          <div key={k} className={ROW}>
            <dt className={DT}>{k}</dt>
            <dd className="m-0 text-[13.5px] text-pretty">{v}</dd>
          </div>
        ))}
        {!!e.strokes?.length && (
          <div className={ROW}>
            <dt className={DT}>Filed as</dt>
            <dd className="readout m-0 text-[11.5px] break-words text-muted-foreground">{e.strokes.join('  ')}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/** Width of the close-up, mm on the sheet. */
const NEAR_MM = 64;
/** Tallest the preview gets, px, so the notes below stay in reach. */
const PREVIEW_H = 420;

/** The part of the sheet to show: a close-up round `focus` (mm), or the whole sheet. */
function viewBox([w, h]: [number, number], focus: [number, number] | null | undefined): number[] {
  if (!focus) return [0, 0, w, h];
  const vw = Math.min(w, NEAR_MM);
  const vh = Math.min(h, vw * 0.6);
  return [Math.max(0, Math.min(w - vw, focus[0] - vw / 2)), Math.max(0, Math.min(h - vh, focus[1] - vh / 2)), vw, vh];
}

function previewCaption(e: Entry, f: Found | undefined, set: Settings, strokes: Strokes | null | undefined, near: boolean): string {
  if (!f?.names.length) return f?.count ? 'Its strokes aren’t filed on their own, so they can’t be picked out.' : absence(e, set);
  if (strokes === undefined) return 'Finding its strokes…';
  if (strokes === null) return 'Its strokes couldn’t be fetched.';
  return near ? `Close-up of the densest patch, ${NEAR_MM} mm across.` : 'The whole sheet.';
}

/** The drawing on show, faded, with this entry's own strokes picked out in the signal colour. */
function Preview({ entry: e, found: f, result, url, set, open, view, onView, onStrokes }: DetailProps) {
  const [got, setGot] = useState<{ key: string; strokes: Strokes | null } | null>(null);
  const names = f?.names;
  // The drawing and the names asked for, one per line: the survey reruns when settings change,
  // and this asks again only for another drawing or other names.
  const key = result && names?.length ? [idOf(result), ...names].join('\n') : '';

  useEffect(() => {
    if (!open || !key) return;
    let live = true;
    void onStrokes(key.split('\n').slice(1)).then((strokes) => {
      if (live) setGot({ key, strokes });
    });
    return () => {
      live = false;
    };
  }, [open, key, onStrokes]);

  if (!result) return null;
  const strokes = got?.key === key ? got.strokes : undefined;
  const [w, h] = result.sheet;
  const focus = view === 'near' ? strokes?.focus : null;
  const vb = viewBox(result.sheet, focus);
  const caption = previewCaption(e, f, set, strokes, !!focus);

  return (
    <figure className="mt-4 mb-0">
      <div className="relative overflow-hidden rounded-[3px] border border-input bg-paper" style={{ aspectRatio: `${vb[2]} / ${vb[3]}`, maxWidth: `${(PREVIEW_H * vb[2]) / vb[3]}px` }}>
        <svg viewBox={vb.join(' ')} className="absolute inset-0 size-full" role="img" aria-label={`${e.name} in the drawing`}>
          {url && <image href={url} x={0} y={0} width={w} height={h} opacity={0.3} style={{ filter: 'grayscale(1)' }} />}
          {strokes?.d && (
            <path
              d={strokes.d}
              fill="none"
              stroke="var(--signal)"
              strokeLinecap="round"
              strokeLinejoin="round"
              {...(focus ? { strokeWidth: Math.max(0.25, set.penWidth) } : { strokeWidth: 1.25, vectorEffect: 'non-scaling-stroke' })}
            />
          )}
        </svg>
      </div>
      <figcaption className="mt-2 flex items-center justify-between gap-4">
        <span className="text-[12px] text-muted-foreground">{caption}</span>
        {!!names?.length && (
          <Segmented
            aria-label="Preview"
            value={view}
            onValueChange={onView}
            className="h-8 shrink-0"
            items={[
              { value: 'near', label: 'Close-up' },
              { value: 'sheet', label: 'Sheet' },
            ]}
          />
        )}
      </figcaption>
    </figure>
  );
}
