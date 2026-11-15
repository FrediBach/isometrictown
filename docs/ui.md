# Interface and state

The interface is one React tree (`src/App.tsx`) with a settings panel on the left and the stage (toolbar, preview, stats) on the right. Visual rules and components are in [DESIGN.md](../DESIGN.md).

## State

`App` holds:

- `set: Settings` — the one settings object. A ref, `live`, mirrors it so the renderer and map callbacks always read the latest value without waiting for a React render.
- `status: RenderStatus` and `result: RenderResult | null` — from the `Renderer`.
- `zoom`, `full`, `aboutOpen` and `catalogueOpen` — view-only state. `full` hides the settings panel and stats so the preview fills the window; Escape leaves it.

## Changing a setting

Every control goes through one function from `SettingsContext` (`app/settings-context.ts`):

```ts
const { set, change } = useSettings();
change('trees', 0.8, /* fromSlider */ true);
```

`change()` commits the new settings, updates the locator map when a view key changed (`VIEW_KEYS`, and refits for `REFIT_KEYS`), persists, and schedules a redraw: immediately, or after 220 ms while a slider is moving.

`NumberSetting` and `BoolSetting` (`components/controls.tsx`) bind a slider or key to a setting by name. Their names are typed by `NumberKey` / `BoolKey` in `app/model.ts`, and slider read-outs come from `FORMAT`.

Exceptions to the redraw:

- **Pen colours** (`setPen`, `setPens`, `recolorPens`) only call `recolor()` on the existing result. No worker round-trip.
- **Place and seed** changes go through `goTo()` and `setSeed()`, which commit and schedule directly.
- **Clicking a building** in the preview calls `reroll()`: it asks the renderer which building is at that sheet position, gives it a new entry in `seedLocks` and redraws. `unlockAll()` (the Seed section's Unlock all) clears them.

## Renderer (`app/renderer.ts`)

Owns the worker. `schedule(delay)` debounces; `dispatch()` sends a `Job` with a `structuredClone` of the latest settings only if the worker is idle. When a job finishes, the next queued one goes out. Results are recoloured with the current pens on arrival, since they may have changed during the job.

Jobs (`Job` in `worker.ts`) are `draw` (settings), `pick` (a sheet position in mm) or `strokes` (tally names). Worker messages (`Reply`): `progress` (a `StageProgress`), `done` (svg, stats, counts, census, features, region, ms), `error` (with `tooBig`), `picked` (the building's lock key, or null) or `strokes` (path data and the densest spot). `pick()` and `strokes()` return promises and never touch the draw queue. The worker answers from the last finished drawing, which is the one on show.

`census` counts the buildings and trees in the drawing by facet (`house`, `gabled-roof`, `shutters`, `palm`, `street-trees`); `features` gives strokes and ink per tally name (see [render-pipeline.md](render-pipeline.md#paper-srcrasterts)).

## Progress

`app/stages.ts` lists the seven stages and their labels. The worker reports them from inside `render()`; `DrawingProgress` shows the card, after a 350 ms delay so quick redraws don't flash. Adding a stage means adding it to `STAGES`, `STAGE_LABEL` and an icon in `components/drawing-progress.tsx`.

## Catalogue

`components/catalogue-dialog.tsx`, opened from the toolbar, lists every entry in `src/catalogue.ts`: what is drawn, how it is found or made up, what switches it, its level-of-detail rules (with the coarsest scale a typical one shows at, for the current Detail and pen), and for regional styles a reference card built from the tables that drive the drawing. Against the drawing on show it reports counts from `census` and strokes from `features`, matched by each entry's `strokes` patterns, and says why an entry is missing (switched off, too small at this scale, none in view). Selecting an entry asks the worker for its strokes and shows them in the signal colour over the faded drawing, as a close-up of the densest patch or the whole sheet.

It is loaded lazily on first open, because it imports the regional tables from the drawing modules. Its survey only runs while it is open.

## Persistence

`app/model.ts`:

- `persist()` writes all settings to `localStorage` (`isometrictown:settings`) and the drawing to the URL hash: `#lat/lng/bearing/scale/seed/place/key=value&…`. The seventh part lists every setting that differs from `DEFAULT_SETTINGS` (`toQuery()`), seed locks and pens included, so a link reproduces the drawing. Only `speed` stays out, as it belongs to the plotter, not the drawing. Colours drop their `#`, pens are comma-separated, `layerPens` is `layer:pen,…` and `seedLocks` is `x,y:seed;…`.
- `loadSettings()` merges defaults ← saved ← hash, then validates (`migratePens`, unknown sheet or style → default, malformed `seedLocks` entries dropped). A hash with the seventh part (even an empty one) first resets every shared setting to its default, so the receiver's own saved settings don't leak into a shared drawing. An old six-part hash only sets the view and keeps the rest from `localStorage`.
- Pasting a link into an open tab fires `hashchange`, and `App` reloads to read it. `persist()` uses `replaceState`, which does not fire it.
- New settings fields get their default from `DEFAULT_SETTINGS` automatically for old saved states. Renamed or reshaped fields need a migration in `loadSettings()`.

## Locator map

`locator.ts` wraps MapLibre: `setView()` moves without echoing back as a user move, `setFootprint()` draws the red outline of the ground on the sheet (from `Camera.footprint()`), `fit()` frames it. User pans and rotations come back through `onMapMove` and redraw.

## Panel sections

`components/sections.tsx` holds the numbered sections (Place, View, Town, Light, Title, Sheet, Pens, Seed), built from the field patterns in `components/fields.tsx`. The pens section uses `palettes.ts` (presets) and `harmony.ts` (generated sets).

## Optional drawing colours

`customLayerPens` enables `layerPens`, a partial feature-to-pen mapping keyed by `LAYERS` in `settings.ts`. Missing entries retain the original mix of pens. Assignments redraw and replan so pen groups and statistics remain accurate. OSM roof tags are a data source, not a drawable feature, so they have no pen assignment. Disabling custom assignments keeps them saved; resetting clears them.

`customBackground` and `background` use `recolor()` without scheduling the worker, including in monochrome mode. The SVG root receives a CSS background colour; no filled geometry is added. Disabling it removes the style and restores transparent export. SVG viewers that ignore CSS backgrounds will show their own paper colour.
