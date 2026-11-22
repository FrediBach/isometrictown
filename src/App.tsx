import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera } from './camera';
import { Frame, type LngLat } from './geo';
import type { Locator } from './locator';
import { cn } from '@/lib/utils';
import { defaultsAt, loadSettings, persist, REFIT_KEYS, selectPicture, slug, toImageMode, VIEW_KEYS } from './app/model';
import { Renderer, scoreLook, type RenderResult, type RenderStatus } from './app/renderer';
import { SettingsContext, type Change } from './app/settings-context';
import { usePicture, type PictureState } from './app/use-picture';
import { AboutDialog } from './components/about-dialog';
import { LightSection, PensSection, ResetSettings, SeedSection, SheetSection, SourceSection, TitleSection, TownSection, ViewSection } from './components/sections';
import { Preview, Stats, Toolbar, type Zoom } from './components/stage';
import { TitleBlock } from './components/title-block';
import { fitImage, type Placed } from './image-fit';
import type { MaskEditing } from './components/mask-editor';
import { recolor } from './plot';
import { sheetSize, type Settings } from './settings';

// The catalogue pulls in the drawing's own tables, so it loads only when first opened.
const CatalogueDialog = lazy(() => import('./components/catalogue-dialog').then((m) => ({ default: m.CatalogueDialog })));
// So does the plot dialog, which then stays mounted so a plot and its connection outlive closing it.
const PlotDialog = lazy(() => import('./components/plot-dialog').then((m) => ({ default: m.PlotDialog })));

const norm = (deg: number) => ((Math.round(deg) % 360) + 360) % 360;

/** What the drawing is called: the place, or in image mode the image. */
const drawingName = (set: Settings) => (set.source === 'image' ? set.imageName || 'Image' : set.place);

/**
 * Image mode's views over the preview: the picture laid over it when asked, and the mask being
 * edited, if one is selected.
 */
function imageViews(set: Settings, picture: PictureState, rect: [number, number, number, number], overlay: boolean, id: string | null, change: Change, select: (id: string | null) => void): { imageOverlay: { url: string; placed: Placed; rect: typeof rect } | null; masking: MaskEditing | null } {
  const pic = picture.picture;
  if (set.source !== 'image' || !pic) return { imageOverlay: null, masking: null };
  const placed = fitImage(rect, pic.w, pic.h, set.imageFit, set.imageFocus);
  const editing = !!id && set.imageMasks.some((m) => m.id === id);
  return {
    imageOverlay: overlay && picture.url ? { url: picture.url, placed, rect } : null,
    masking: editing ? { masks: set.imageMasks, selected: id, placed, picture: pic, rect, onChange: (masks) => change('imageMasks', masks), onDone: () => select(null) } : null,
  };
}

export function App() {
  const [set, setSet] = useState(loadSettings);
  // The renderer and map callbacks read the latest settings without waiting for a React render.
  const live = useRef(set);
  const locator = useRef<Locator | null>(null);
  const renderer = useRef<Renderer | null>(null);

  const [status, setStatus] = useState<RenderStatus>({ text: '', state: 'idle' });
  const [result, setResult] = useState<RenderResult | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [full, setFull] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [catalogueSeen, setCatalogueSeen] = useState(false);
  const [plotOpen, setPlotOpen] = useState(false);
  const [plotSeen, setPlotSeen] = useState(false);
  // Image mode's views of the preview: the image laid over it, and the drawing blurred to its tone.
  const [overlay, setOverlay] = useState(false);
  const [squint, setSquint] = useState(false);
  // The image-mode mask being edited over the preview.
  const [maskId, setMaskId] = useState<string | null>(null);
  // Bumped by a reset, so sections that keep their own drafts and undo history start afresh.
  const [resets, setResets] = useState(0);

  const commit = useCallback((next: Settings) => {
    live.current = next;
    setSet(next);
  }, []);

  const schedule = useCallback((delay: number) => {
    persist(live.current);
    renderer.current?.schedule(delay);
  }, []);

  // The picture image mode draws from; a stored one is loaded when its id turns up, then drawn.
  const picture = usePicture(set.source === 'image' ? set.image : '', result?.tintedPreview, () => schedule(0));
  const currentPicture = picture.current;

  /** In image mode, score the drawing on show again for new pens or paper; it needn't be drawn again. */
  const rescore = useCallback(() => {
    if (live.current.source !== 'image') return;
    void renderer.current?.score(live.current).then((likeness) => {
      if (likeness) setResult((r) => r && { ...r, likeness });
    });
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
      if (key === 'background' || key === 'customBackground') {
        persist(live.current);
        setResult((r) => r && recolor(r, live.current));
        rescore();
        return;
      }
      if (key === 'bearing') locator.current?.setView(live.current.center, live.current.bearing);
      if (VIEW_KEYS.has(key)) updateFootprint(REFIT_KEYS.has(key));
      schedule(fromSlider ? 220 : 0);
    },
    [commit, rescore, schedule, updateFootprint],
  );

  const settings = useMemo(() => ({ set, change }), [set, change]);

  // A shared link pasted into an open tab only changes the hash; start again from it.
  // `persist()` uses replaceState, which does not fire this.
  useEffect(() => {
    const reload = () => location.reload();
    window.addEventListener('hashchange', reload);
    return () => window.removeEventListener('hashchange', reload);
  }, []);

  function goTo(center: LngLat, name: string, extra: Partial<Settings> = {}): void {
    commit({ ...live.current, center, place: name, ...extra });
    locator.current?.setView(live.current.center, live.current.bearing);
    updateFootprint(true);
    schedule(0);
  }

  /** Switch between drawing a place from the map and a town laid out from an image. */
  function setSource(source: Settings['source']): void {
    if (source === live.current.source) return;
    picture.cancelChoice();
    locator.current = null;
    setResult(null);
    setStatus({ text: '', state: 'idle' });
    commit(source === 'image' ? toImageMode(live.current) : { ...live.current, source });
  }

  /** Read an image file, keep it, and draw from it. */
  async function chooseImage(file: File): Promise<void> {
    const p = await picture.choose(file);
    if (!p || live.current.source !== 'image') return;
    if (p.id !== live.current.image) setResult(null);
    commit(selectPicture(live.current, p));
    schedule(0);
  }

  function onMapMove(center: LngLat, bearing: number): void {
    const s = live.current;
    if (s.source !== 'map') return;
    const moved = Math.abs(center[0] - s.center[0]) + Math.abs(center[1] - s.center[1]) > 1e-6;
    if (!moved && norm(bearing) === Math.round(s.bearing)) return;
    commit({ ...s, center, bearing: norm(bearing) });
    updateFootprint(false);
    schedule(0);
  }

  function onMapReady(loc: Locator): void {
    if (live.current.source !== 'map') return;
    locator.current = loc;
    loc.map.once('load', () => updateFootprint(true));
  }

  function setSeed(seed: number): void {
    commit({ ...live.current, seed });
    schedule(0);
  }

  /** Give the building under a sheet position (mm) a new seed of its own, and keep it. */
  async function reroll(x: number, y: number): Promise<void> {
    const key = await renderer.current?.pick(x, y);
    if (!key) return;
    const locks = live.current.seedLocks;
    let seed = 1 + Math.floor(Math.random() * 99999);
    if (seed === (locks[key] ?? live.current.seed)) seed = (seed % 99999) + 1;
    commit({ ...live.current, seedLocks: { ...locks, [key]: seed } });
    schedule(0);
  }

  const strokes = useCallback((names: string[]) => renderer.current?.strokes(names) ?? Promise.resolve(null), []);

  function openCatalogue(): void {
    setCatalogueSeen(true);
    setCatalogueOpen(true);
  }

  function openPlot(): void {
    setPlotSeen(true);
    setPlotOpen(true);
  }

  function unlockAll(): void {
    commit({ ...live.current, seedLocks: {} });
    schedule(0);
  }

  /** Every setting back to its default, staying where the drawing is. */
  function resetAll(): void {
    commit(defaultsAt(live.current));
    setResets((n) => n + 1);
    locator.current?.setView(live.current.center, live.current.bearing);
    updateFootprint(true);
    schedule(0);
  }

  /** Pen colours only restyle the finished drawing, so they never send it back to the worker. */
  function recolorPens(): void {
    persist(live.current);
    setResult((r) => r && recolor(r, live.current));
    rescore();
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
    a.download = `isometric-town-${slug(drawingName(live.current))}-${live.current.seed}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Escape leaves full size.
  useEffect(() => {
    if (!full) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setFull(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [full]);

  // Switching sources releases the old worker and any map downloads before starting the new drawing.
  useEffect(() => {
    const r = new Renderer(() => live.current, currentPicture, setStatus, setResult);
    renderer.current = r;
    schedule(0);
    return () => {
      renderer.current = null;
      r.dispose();
    };
  }, [currentPicture, schedule, set.source]);

  const image = set.source === 'image';
  const rect = new Camera(set).rect;
  const { imageOverlay, masking } = imageViews(set, picture, rect, overlay, maskId, change, setMaskId);

  return (
    <div className={cn('grid h-screen', full ? 'grid-cols-1' : 'grid-cols-[380px_1fr] max-[900px]:h-auto max-[900px]:grid-cols-1')}>
      {/* Hidden rather than unmounted in full size, so the locator map keeps its state. */}
      <aside hidden={full} className="relative overflow-y-auto border-r border-black/20 bg-background px-[18px] pt-[18px] pb-10 max-[900px]:overflow-visible max-[900px]:border-r-0 max-[900px]:border-b max-[900px]:p-4">
        <SettingsContext value={settings}>
          <TitleBlock onPalette={setPens} />
          <SourceSection onGoTo={goTo} onMapMove={onMapMove} onMapReady={onMapReady} onSource={setSource} picture={picture} onFile={(f) => void chooseImage(f)} mask={maskId} onMask={setMaskId} />
          <ViewSection />
          <TownSection region={result?.region} />
          <LightSection />
          <TitleSection key={`text-${resets}`} />
          <SheetSection />
          <PensSection key={`pens-${resets}`} onPalette={setPens} onPen={setPen} onPenCommit={recolorPens} />
          <SeedSection key={`seed-${resets}`} onSeed={setSeed} onUnlock={unlockAll} />
          <ResetSettings onReset={resetAll} />
        </SettingsContext>
      </aside>

      <main className={cn('grid min-h-0 min-w-0 bg-stage', full ? 'grid-rows-[auto_1fr]' : 'grid-rows-[auto_1fr_auto] max-[900px]:grid-rows-[auto_70vh_auto]')}>
        <Toolbar
          zoom={zoom}
          onZoom={setZoom}
          full={full}
          onFull={setFull}
          status={status}
          canDownload={!!result}
          onDownload={download}
          onAbout={() => setAboutOpen(true)}
          onCatalogue={openCatalogue}
          look={image ? { overlay, squint, onOverlay: setOverlay, onSquint: setSquint } : undefined}
        />
        <Preview result={result} sheet={result?.sheet ?? sheetSize(set)} zoom={zoom} pens={set.pens} mono={set.mono} status={status} onPick={reroll} overlay={imageOverlay} squint={image && squint} masking={masking} />
        {!full && <Stats result={result} look={scoreLook(set)} onPlot={openPlot} />}
      </main>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      {catalogueSeen && (
        <Suspense fallback={null}>
          <CatalogueDialog open={catalogueOpen} onOpenChange={setCatalogueOpen} result={result} set={set} onStrokes={strokes} />
        </Suspense>
      )}
      {plotSeen && (
        <Suspense fallback={null}>
          <PlotDialog open={plotOpen} onOpenChange={setPlotOpen} result={result} place={drawingName(set)} seed={set.seed} />
        </Suspense>
      )}
    </div>
  );
}
