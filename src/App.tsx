import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ShuffleIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera } from './camera';
import { Frame, type LngLat } from './geo';
import type { Locator } from './locator';
import { FORMAT, fromSlider, loadSettings, MONO_INK, persist, PRESETS, REFIT_KEYS, slug, toSlider, VIEW_KEYS, type BoolKey, type NumberKey } from './app/model';
import { useNativeChange } from './app/use-native-change';
import { Renderer, type RenderResult, type RenderStatus } from './app/renderer';
import { Caption, FoldingSection, Hint, Key, KeyGrid, Section, SliderField } from './components/fields';
import { LocatorMap } from './components/locator-map';
import { PlaceSearch } from './components/place-search';
import { Preview, Stats, Toolbar, type Zoom } from './components/stage';
import { PalettePicker } from './components/palette-picker';
import { PenDot, TitleBlock } from './components/title-block';
import { currentPalette } from './palettes';
import { cn } from '@/lib/utils';
import { PEN_NAMES, PEN_ROLES, SHEETS, sheetSize, type Settings, type SheetId } from './settings';
import { STYLE_IDS, STYLES } from './styles';

function PenSwatch({ color, label, onInput, onCommit }: { color: string; label: string; onInput: (c: string) => void; onCommit: () => void }) {
  const ref = useNativeChange<HTMLInputElement>(onCommit);
  return <input ref={ref} type="color" className="swatch" value={color} aria-label={label} onChange={(e) => onInput(e.currentTarget.value)} />;
}

const norm = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

export function App() {
  const [set, setSet] = useState(loadSettings);
  // The renderer and map callbacks read the latest settings without waiting for a React render.
  const live = useRef(set);
  const locator = useRef<Locator | null>(null);
  const renderer = useRef<Renderer | null>(null);

  const [status, setStatus] = useState<RenderStatus>({ text: '', state: 'idle' });
  const [result, setResult] = useState<RenderResult | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [seedDraft, setSeedDraft] = useState(String(set.seed));

  const commit = useCallback((next: Settings) => {
    live.current = next;
    setSet(next);
    setSeedDraft(String(next.seed));
  }, []);

  const schedule = useCallback((delay: number) => {
    persist(live.current);
    renderer.current?.schedule(delay);
  }, []);

  const updateFootprint = useCallback((refit: boolean) => {
    const loc = locator.current;
    if (!loc) return;
    const s = live.current;
    const frame = new Frame(s.center);
    const corners = new Camera(s).footprint().map(([x, y]) => frame.toLngLat(x, y));
    loc.setFootprint(corners);
    if (refit) loc.fit(corners, s.bearing);
  }, []);

  /** Apply one control change, with the same side effects for every control. */
  function change<K extends keyof Settings>(key: K, value: Settings[K], fromSlider = false): void {
    commit({ ...live.current, [key]: value });
    if (key === 'bearing') locator.current?.setView(live.current.center, live.current.bearing);
    if (VIEW_KEYS.has(key)) updateFootprint(REFIT_KEYS.has(key));
    schedule(fromSlider ? 220 : 0);
  }

  function goTo(center: LngLat, name: string, extra: Partial<Settings> = {}): void {
    commit({ ...live.current, center, place: name, ...extra });
    locator.current?.setView(live.current.center, live.current.bearing);
    updateFootprint(true);
    schedule(0);
  }

  function onMapMove(center: LngLat, bearing: number): void {
    const s = live.current;
    const moved = Math.abs(center[0] - s.center[0]) + Math.abs(center[1] - s.center[1]) > 1e-6;
    if (!moved && norm(bearing) === Math.round(s.bearing)) return;
    commit({ ...s, center, bearing: norm(bearing) });
    updateFootprint(false);
    schedule(0);
  }

  function setSeed(seed: number): void {
    commit({ ...live.current, seed });
    schedule(0);
  }

  const seedInput = useNativeChange<HTMLInputElement>((el) => {
    const v = Math.round(Number(el.value));
    setSeed(Number.isFinite(v) && v > 0 ? v : 1);
  });

  function setPen(i: number, color: string): void {
    const pens = [...live.current.pens] as Settings['pens'];
    pens[i] = color;
    commit({ ...live.current, pens });
  }

  function download(): void {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `isometric-town-${slug(live.current.place)}-${live.current.seed}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  useEffect(() => {
    const r = new Renderer(() => live.current, setStatus, setResult);
    renderer.current = r;
    updateFootprint(false);
    schedule(0);
    return () => r.dispose();
  }, [schedule, updateFootprint]);

  const slider = (key: NumberKey, label: string, min: number, max: number, step: number, hint?: string) => (
    <SliderField
      label={label}
      min={min}
      max={max}
      step={step}
      hint={hint}
      value={key === 'scale' ? toSlider(set.scale) : set[key]}
      display={FORMAT[key](set[key])}
      onChange={(v) => change(key, key === 'scale' ? fromSlider(v) : v, true)}
    />
  );
  const key = (k: BoolKey, label: string) => <Key label={label} on={set[k]} onChange={(v) => change(k, v)} />;
  const townKeys: [BoolKey, string][] = [
    ['windows', 'Windows'],
    ['roofHatch', 'Roof hatching'],
    ['rooftops', 'Rooftop boxes'],
    ['details', 'Roof details'],
    ['osmTags', 'OSM roof tags'],
    ['lamps', 'Street lamps'],
    ['paths', 'Footpaths'],
    ['rails', 'Railways'],
    ['water', 'Water'],
    ['parks', 'Parks'],
    ['ground', 'Fields and gardens'],
  ];
  const sep = ' · ';
  const region = result?.region;
  const autoStyle = region ? `Auto: ${STYLES[region.style].label} (${region.country})` : 'Auto, from the country';

  return (
    <div className="grid h-screen grid-cols-[380px_1fr] max-[900px]:h-auto max-[900px]:grid-cols-1">
      <aside className="overflow-y-auto border-r border-black/20 bg-background px-[18px] pt-[18px] pb-10 max-[900px]:overflow-visible max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:p-4">
        <TitleBlock set={set} />

        <Section index={1} title="Place">
          <PlaceSearch onPick={(center, name) => goTo(center, name)} />
          <div className="mt-3 mb-3.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="micro mr-0.5">Try</span>
            {PRESETS.map((p) => {
              const current = set.place === p.name;
              return (
                <button
                  key={p.name}
                  type="button"
                  aria-current={current || undefined}
                  onClick={() => goTo(p.center, p.name, { bearing: p.bearing, scale: p.scale })}
                  className={cn(
                    'rounded-sm py-0.5 text-[13px] underline decoration-1 underline-offset-[5px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    current ? 'text-foreground decoration-signal decoration-2' : 'text-muted-foreground decoration-input hover:text-foreground hover:decoration-foreground',
                  )}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
          <LocatorMap
            center={set.center}
            bearing={set.bearing}
            onMove={onMapMove}
            onReady={(loc) => {
              locator.current = loc;
              loc.map.on('load', () => updateFootprint(true));
            }}
          />
          <Hint className="mt-2 mb-0">Drag the map to move. Right-drag or use the compass to turn. The red outline is the ground that lands on the sheet.</Hint>
        </Section>

        <FoldingSection index={2} title="View" defaultOpen summary={[FORMAT.bearing(set.bearing), FORMAT.tilt(set.tilt), FORMAT.scale(set.scale)].join(sep)}>
          {slider('bearing', 'Rotation', 0, 359, 1)}
          {slider('tilt', 'Tilt', 20, 60, 1, 'How high you look from. 30° is the classic isometric look.')}
          {slider('scale', 'Scale', 0, 1000, 1, 'Bigger towns need a smaller scale. Small scales skip windows.')}
          {slider('heightScale', 'Building height', 0.5, 3, 0.05)}
        </FoldingSection>

        <FoldingSection index={3} title="Town" defaultOpen summary={`${townKeys.filter(([k]) => set[k]).length} of ${townKeys.length} layers`}>
          <Caption className="mt-0">Building style</Caption>
          <Select value={set.style} onValueChange={(v) => change('style', v as Settings['style'])}>
            <SelectTrigger aria-label="Building style" className="mb-1 h-9 w-full rounded-md bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-md">
              <SelectItem value="auto" className="rounded-[4px]">
                {autoStyle}
              </SelectItem>
              {STYLE_IDS.map((id) => (
                <SelectItem key={id} value={id} className="rounded-[4px]">
                  {STYLES[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Hint>Roof shapes, pitches and details typical for the region. Auto picks them from the country.</Hint>
          {slider('pitched', 'Pitched roofs', 0, 1, 0.01, 'How many houses get pitched roofs, compared with what is usual for the style.')}
          {slider('trees', 'Trees', 0, 1, 0.01)}
          {slider('cars', 'Parked cars', 0, 1, 0.01)}
          <Caption className="mt-4">Layers</Caption>
          <KeyGrid className="mt-0">{townKeys.map(([k, label]) => <Fragment key={k}>{key(k, label)}</Fragment>)}</KeyGrid>
        </FoldingSection>

        <FoldingSection index={4} title="Light" defaultOpen summary={set.shadows ? `Sun ${FORMAT.sunAngle(set.sunAngle)} at ${FORMAT.sunHeight(set.sunHeight)}` : 'No shadows'}>
          <KeyGrid className="mt-0 mb-4">
            {key('shadows', 'Shadows')}
            {key('shadeWalls', 'Shade walls')}
          </KeyGrid>
          {slider('sunAngle', 'Sun direction', 0, 359, 1)}
          {slider('sunHeight', 'Sun height', 12, 75, 1, 'A low sun casts long shadows.')}
        </FoldingSection>

        <FoldingSection index={5} title="Sheet" summary={[SHEETS[set.sheet].label, set.landscape ? 'landscape' : 'portrait', FORMAT.margin(set.margin)].join(sep)}>
          <div className="mb-4 flex gap-2">
            <Select value={set.sheet} onValueChange={(v) => change('sheet', v as SheetId)}>
              <SelectTrigger aria-label="Sheet size" className="h-9 min-w-0 flex-1 rounded-md bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-md">
                {Object.entries(SHEETS).map(([id, s]) => (
                  <SelectItem key={id} value={id} className="rounded-[4px]">
                    {s.label}
                    <span className="readout text-[11px] text-muted-foreground">
                      {s.size[0]} × {s.size[1]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Segmented
              aria-label="Orientation"
              value={String(set.landscape)}
              onValueChange={(v) => change('landscape', v === 'true')}
              items={[
                { value: 'true', title: 'Landscape', label: <OrientationIcon landscape /> },
                { value: 'false', title: 'Portrait', label: <OrientationIcon /> },
              ]}
            />
          </div>
          {slider('margin', 'Margin', 5, 60, 1)}
          <KeyGrid>
            {key('frame', 'Frame line')}
            {key('marginalia', 'Map notes')}
          </KeyGrid>
          <Hint className="mt-2 mb-0">Map notes letter the margin like a printed town map: title, coordinates, scale bar and north arrow. With the frame line on, a second border carries latitude and longitude ticks. A wider margin gives them more room.</Hint>
        </FoldingSection>

        <FoldingSection
          index={6}
          title="Pens"
          summary={
            <span className="inline-flex items-center gap-2">
              {[set.mono ? 'One pen' : (currentPalette(set.pens)?.name ?? 'Custom'), FORMAT.penWidth(set.penWidth)].join(sep)}
              <span className="inline-flex gap-0.5">
                {(set.mono ? [MONO_INK] : set.pens).map((c, i) => (
                  <PenDot key={i} color={c} size={9} />
                ))}
              </span>
            </span>
          }
        >
          <div className="mb-2 flex items-baseline justify-between">
            <Caption className="mb-0">Palette</Caption>
            <span className="readout text-[11px] text-muted-foreground">{currentPalette(set.pens)?.name ?? 'Custom'}</span>
          </div>
          <PalettePicker
            pens={set.pens}
            disabled={set.mono}
            onPick={(pens) => {
              commit({ ...live.current, pens });
              schedule(0);
            }}
          />
          <Caption className="mt-4">Pens</Caption>
          <ol className={cn('m-0 mb-4 list-none overflow-hidden rounded-md border border-input bg-card p-0 transition-opacity', set.mono && 'opacity-45')}>
            {set.pens.map((color, i) => (
              <li key={i} className="border-b last:border-b-0">
                <label title={PEN_ROLES[i]} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/60">
                  <span className="readout w-3 text-[11px] text-muted-foreground">{i + 1}</span>
                  <PenSwatch color={color} label={`${PEN_NAMES[i]} pen colour`} onInput={(c) => setPen(i, c)} onCommit={() => schedule(0)} />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="text-[13px] font-medium">{PEN_NAMES[i]}</span>
                    <span className="readout text-[11px] text-muted-foreground uppercase">{color}</span>
                  </span>
                </label>
              </li>
            ))}
          </ol>
          {slider('penWidth', 'Pen width', 0.1, 1, 0.05)}
          {slider('speed', 'Plot speed', 10, 120, 5)}
          <KeyGrid>{key('mono', 'One black pen')}</KeyGrid>
        </FoldingSection>

        <Section index={7} title="Seed">
          <div className="flex h-10 items-stretch overflow-hidden rounded-md border border-input bg-card focus-within:border-foreground/40 focus-within:ring-3 focus-within:ring-ring/30">
            <span className="micro self-center pl-3">No.</span>
            <input
              ref={seedInput}
              type="number"
              min={1}
              max={99999}
              step={1}
              aria-label="Seed"
              className="readout min-w-0 flex-1 bg-transparent px-2 text-[14px] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              value={seedDraft}
              onChange={(e) => setSeedDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            <button
              type="button"
              onClick={() => setSeed(1 + Math.floor(Math.random() * 99999))}
              className="m-1 flex items-center gap-1.5 rounded-[4px] border border-input bg-background px-3 text-[13px] font-medium transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.1)]"
            >
              <ShuffleIcon className="size-3.5" />
              Shuffle
            </button>
          </div>
          <Hint className="mt-2 mb-0">Picks which houses get pitched roofs and where trees and cars go.</Hint>
        </Section>
      </aside>

      <main className="grid min-h-0 min-w-0 grid-rows-[auto_1fr_auto] bg-stage max-[900px]:grid-rows-[auto_70vh_auto]">
        <Toolbar zoom={zoom} onZoom={setZoom} status={status} canDownload={!!result} onDownload={download} onAbout={() => setAboutOpen(true)} />
        <Preview result={result} sheet={result?.sheet ?? sheetSize(set)} zoom={zoom} pens={set.pens} mono={set.mono} />
        <Stats result={result} />
      </main>

      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="max-w-[min(540px,calc(100vw-32px))] gap-0 overflow-hidden rounded-lg border border-input bg-background p-0 ring-0 sm:max-w-[540px]">
          <DialogHeader className="flex-row items-center gap-3 border-b border-input bg-card px-6 py-4 text-left">
            <img src="/logo.svg" alt="" width={36} height={36} />
            <div>
              <DialogTitle className="text-lg leading-tight font-semibold tracking-[-0.02em]">Isometric Town</DialogTitle>
              <DialogDescription className="micro mt-1 text-[10.5px] text-muted-foreground">About this tool</DialogDescription>
            </div>
          </DialogHeader>
          <div className="flex flex-col gap-3 px-6 pt-5 pb-5 text-sm leading-relaxed text-pretty">
            <p className="m-0 text-[15px] leading-normal">
              Isometric Town draws any town in isometric 3D as clean linework for pen plotters. Pick a place, frame it, and download an SVG with one layer per pen, ready for an AxiDraw,
              Inkscape or vpype.
            </p>
            <p className="m-0 text-muted-foreground">
              Buildings, streets, water and parks come from OpenStreetMap. Building heights come from the map data where it has them. Roof shapes come from OpenStreetMap where they're
              tagged. Elsewhere they're worked out from each building's shape, its neighbours and the local building style. Trees, cars and lamps are made up, with a seed so the same
              settings always give the same drawing.
            </p>
            <p className="m-0 text-muted-foreground">Hidden lines are removed before you download, so nothing is drawn twice and nothing shows through a wall.</p>
          </div>
          <div className="flex items-end justify-between gap-6 border-t px-6 py-4 text-xs text-muted-foreground [&_a]:underline [&_a]:decoration-input [&_a]:underline-offset-2 hover:[&_a]:text-foreground">
            <p className="m-0 leading-relaxed">
              Map data ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
                OpenStreetMap contributors
              </a>
              . Tiles by{' '}
              <a href="https://openfreemap.org" target="_blank" rel="noopener">
                OpenFreeMap
              </a>
              , schema ©{' '}
              <a href="https://www.openmaptiles.org" target="_blank" rel="noopener">
                OpenMapTiles
              </a>
              . Map view by{' '}
              <a href="https://maplibre.org" target="_blank" rel="noopener">
                MapLibre
              </a>
              .
            </p>
            <a className="readout shrink-0 text-[11px]" href="https://isometrictown.com">
              isometrictown.com
            </a>
          </div>
          <div className="border-t px-6 py-3 text-xs text-muted-foreground">
            <p className="readout m-0 text-[11px]">
              © {new Date().getFullYear()}{' '}
              <a className="underline decoration-input underline-offset-2 hover:text-foreground" href="https://fredibach.com" target="_blank" rel="noopener">
                Fredi Bach
              </a>
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrientationIcon({ landscape = false }: { landscape?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      {landscape ? <rect x="1.5" y="4" width="13" height="8.5" rx="1" /> : <rect x="3.75" y="1.5" width="8.5" height="13" rx="1" />}
    </svg>
  );
}
