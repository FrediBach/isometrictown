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

## Pen plot

The **Pen Plot** button in the stats footer opens `components/plot-dialog.tsx`. It is lazily loaded on first open and then stays mounted, so a plot carries on, and the connection is kept, while the dialog is closed. `app/plot-activity.ts` is a tiny store the dialog writes to from its handlers; the button reads it to light its lamp.

- `gcode.ts` reads the pen layers back out of the finished SVG (`layersOf()`), so plotting needs nothing from the worker and always matches what is on show, colours included. `layerCode()` maps sheet mm to machine mm (`machine()`: optional quarter turn, origin top left or bottom left), simplifies each stroke to 0.02 mm and writes `G0` travel, `G1 Z` pen moves at 2500 mm/min and `G1` drawing at the plot speed (`speed` × 60 mm/min). `gcodeFile()` writes one file for all pens with `G92 X0 Y0` at the start and `M0` before each new pen.
- `app/grbl.ts` drives GRBL 1.1 over Web Serial at 115200 baud. Lines stream with character counting (at most 127 bytes in GRBL's receive buffer), and real-time bytes skip the queue: `?` every 250 ms for status, `!` hold, `~` resume. `stream()` ends with `G4 P0`, which GRBL answers only once the moves are done. `stop()` holds, waits for the carriage to stop, soft-resets to drop the rest of the job, unlocks, lifts the pen and goes back to the origin using the last `WCO` it saw.
- `app/use-plotter.ts` is the session: connection phase, whether the origin is set, and the job. The job is a snapshot of the drawing taken when its first pen starts, so a redraw midway can't mix two drawings; the dialog offers Start over when the drawing has changed. The origin corner and the turn are locked once a pen has plotted, so the layers line up.
- The plotter set-up (pen-down Z, origin corner, turn) belongs to the machine, not the drawing. It is kept in `localStorage` under `isometrictown:plotter`, not in `Settings`, so it never reaches the URL.

The UUNA TEK 3.0 runs GRBL 1.1 on a DrawCore board. The pen hangs on a Z axis with Z0 up and about Z10 at full press. X grows to the right and Y towards you, so the origin is the top-left corner of the paper. These defaults follow the community UUNA TEK controller and the maker's G-code guide.

## Persistence

`app/model.ts`:

- `persist()` writes all settings to `localStorage` (`isometrictown:settings`) and the drawing to the URL hash: `#lat/lng/bearing/scale/seed/place/key=value&…`. The seventh part lists every setting that differs from `DEFAULT_SETTINGS` (`toQuery()`), seed locks and pens included, so a link reproduces the drawing. Only `speed` stays out, as it belongs to the plotter, not the drawing. Colours drop their `#`, pens are comma-separated, `layerPens` is `layer:pen,…` and `seedLocks` is `x,y:seed;…`.
- `loadSettings()` merges defaults ← saved ← hash, then validates (`migratePens`, unknown sheet or style → default, malformed `seedLocks` entries dropped). A hash with the seventh part (even an empty one) first resets every shared setting to its default, so the receiver's own saved settings don't leak into a shared drawing. An old six-part hash only sets the view and keeps the rest from `localStorage`.
- Pasting a link into an open tab fires `hashchange`, and `App` reloads to read it. `persist()` uses `replaceState`, which does not fire it.
- New settings fields get their default from `DEFAULT_SETTINGS` automatically for old saved states. Renamed or reshaped fields need a migration in `loadSettings()`.

## Locator map

`locator.ts` wraps MapLibre: `setView()` moves without echoing back as a user move, `setFootprint()` draws the red outline of the ground on the sheet (from `Camera.footprint()`), `fit()` frames it. User pans and rotations come back through `onMapMove` and redraw.

## Panel sections

`components/sections.tsx` holds the numbered sections (Place, View, Town, Light, Title, Sheet, Pens, Seed), built from the field patterns in `components/fields.tsx`. The Town section opens with the Era selector switch (Realistic or Solarpunk, `set.era`); like any drawing setting it redraws and travels in share links. The pens section uses `palettes.ts` (presets) and `harmony.ts` (generated sets).

Light defaults to Automatic sun: geographic south-east in the north and north-east in the south. Turning it off exposes the existing view-relative direction slider; the section summary always shows the resulting compass bearing. Old saved settings with an adjusted sun angle, and old share links with an explicit sun angle, retain manual lighting. Links carry `autoSun` explicitly alongside a non-default manual angle so automatic lighting can retain that angle without changing mode when shared.

## Optional drawing colours

`customLayerPens` enables `layerPens`, a partial feature-to-pen mapping keyed by `LAYERS` in `settings.ts`. Missing entries retain the original mix of pens. Assignments redraw and replan so pen groups and statistics remain accurate. OSM roof tags are a data source, not a drawable feature, so they have no pen assignment. Disabling custom assignments keeps them saved; resetting clears them.

`customLayerDetail` enables `layerDetail`, a partial feature-to-Detail mapping shown under the Detail slider in the View section (`DETAIL_LAYERS` in `settings.ts`). Each value replaces the slider for that feature; missing entries follow it. Details on a building follow the building's Detail unless they have their own (see [lod.md](lod.md)). It is stored and shared like `layerPens` (`layer:detail,…`). The catalogue's "shows from" scales use the Detail of the layer an entry is filed under.

`customBackground` and `background` use `recolor()` without scheduling the worker, including in monochrome mode. The SVG root receives a CSS background colour; no filled geometry is added. Disabling it removes the style and restores transparent export. SVG viewers that ignore CSS backgrounds will show their own paper colour.
