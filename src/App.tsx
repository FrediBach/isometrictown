import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera } from './camera';
import { Frame, type LngLat } from './geo';
import type { Locator } from './locator';
import { loadSettings, persist, REFIT_KEYS, slug, VIEW_KEYS } from './app/model';
import { Renderer, type RenderResult, type RenderStatus } from './app/renderer';
import { SettingsContext, type Change } from './app/settings-context';
import { AboutDialog } from './components/about-dialog';
import { LightSection, PensSection, PlaceSection, SeedSection, SheetSection, TownSection, ViewSection } from './components/sections';
import { Preview, Stats, Toolbar, type Zoom } from './components/stage';
import { TitleBlock } from './components/title-block';
import { recolor } from './plot';
import { sheetSize, type Settings } from './settings';

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

  const commit = useCallback((next: Settings) => {
    live.current = next;
    setSet(next);
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
  const change = useCallback<Change>(
    (key, value, fromSlider = false) => {
      commit({ ...live.current, [key]: value });
      if (key === 'bearing') locator.current?.setView(live.current.center, live.current.bearing);
      if (VIEW_KEYS.has(key)) updateFootprint(REFIT_KEYS.has(key));
      schedule(fromSlider ? 220 : 0);
    },
    [commit, schedule, updateFootprint],
  );

  const settings = useMemo(() => ({ set, change }), [set, change]);

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

  function onMapReady(loc: Locator): void {
    locator.current = loc;
    loc.map.once('load', () => updateFootprint(true));
  }

  function setSeed(seed: number): void {
    commit({ ...live.current, seed });
    schedule(0);
  }

  /** Pen colours only restyle the finished drawing, so they never send it back to the worker. */
  function recolorPens(): void {
    persist(live.current);
    setResult((r) => r && recolor(r, live.current));
  }

  function setPens(pens: Settings['pens']): void {
    commit({ ...live.current, pens });
    recolorPens();
  }

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

  return (
    <div className="grid h-screen grid-cols-[380px_1fr] max-[900px]:h-auto max-[900px]:grid-cols-1">
      <aside className="overflow-y-auto border-r border-black/20 bg-background px-[18px] pt-[18px] pb-10 max-[900px]:overflow-visible max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:p-4">
        <TitleBlock set={set} />
        <SettingsContext value={settings}>
          <PlaceSection onGoTo={goTo} onMapMove={onMapMove} onMapReady={onMapReady} />
          <ViewSection />
          <TownSection region={result?.region} />
          <LightSection />
          <SheetSection />
          <PensSection onPalette={setPens} onPen={setPen} onPenCommit={recolorPens} />
          <SeedSection onSeed={setSeed} />
        </SettingsContext>
      </aside>

      <main className="grid min-h-0 min-w-0 grid-rows-[auto_1fr_auto] bg-stage max-[900px]:grid-rows-[auto_70vh_auto]">
        <Toolbar zoom={zoom} onZoom={setZoom} status={status} canDownload={!!result} onDownload={download} onAbout={() => setAboutOpen(true)} />
        <Preview result={result} sheet={result?.sheet ?? sheetSize(set)} zoom={zoom} pens={set.pens} mono={set.mono} status={status} />
        <Stats result={result} />
      </main>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </div>
  );
}
