# Interface and state

The interface is one React tree (`src/App.tsx`) with a settings panel on the left and the stage (toolbar, preview, stats) on the right. Visual rules and components are in [DESIGN.md](../DESIGN.md).

## State

`App` holds:

- `set: Settings` — the one settings object. A ref, `live`, mirrors it so the renderer and map callbacks always read the latest value without waiting for a React render.
- `status: RenderStatus` and `result: RenderResult | null` — from the `Renderer`.
- `zoom` and `aboutOpen` — view-only state.

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

Jobs (`Job` in `worker.ts`) are `draw` (settings) or `pick` (a sheet position in mm). Worker messages (`Reply`): `progress` (a `StageProgress`), `done` (svg, stats, counts, region, ms), `error` (with `tooBig`) or `picked` (the building's lock key, or null). `pick()` returns a promise and never touches the draw queue. The worker answers from the last finished drawing, which is the one on show.

## Progress

`app/stages.ts` lists the seven stages and their labels. The worker reports them from inside `render()`; `DrawingProgress` shows the card, after a 350 ms delay so quick redraws don't flash. Adding a stage means adding it to `STAGES`, `STAGE_LABEL` and an icon in `components/drawing-progress.tsx`.

## Persistence

`app/model.ts`:

- `persist()` writes all settings to `localStorage` (`isometrictown:settings`) and the view to the URL hash: `#lat/lng/bearing/scale/seed/place`.
- `loadSettings()` merges defaults ← saved ← hash, then validates (`migratePens`, unknown sheet or style → default, malformed `seedLocks` entries dropped). Seed locks live in `localStorage` only, not in the URL hash.
- New settings fields get their default from `DEFAULT_SETTINGS` automatically for old saved states. Renamed or reshaped fields need a migration in `loadSettings()`.

## Locator map

`locator.ts` wraps MapLibre: `setView()` moves without echoing back as a user move, `setFootprint()` draws the red outline of the ground on the sheet (from `Camera.footprint()`), `fit()` frames it. User pans and rotations come back through `onMapMove` and redraw.

## Panel sections

`components/sections.tsx` holds the numbered sections (Place, View, Town, Light, Sheet, Pens, Seed), built from the field patterns in `components/fields.tsx`. The pens section uses `palettes.ts` (presets) and `harmony.ts` (generated sets).

## Optional drawing colours

`customLayerPens` enables `layerPens`, a partial feature-to-pen mapping keyed by `LAYERS` in `settings.ts`. Missing entries retain the original mix of pens. Assignments redraw and replan so pen groups and statistics remain accurate. OSM roof tags are a data source, not a drawable feature, so they have no pen assignment. Disabling custom assignments keeps them saved; resetting clears them.

`customBackground` and `background` use `recolor()` without scheduling the worker, including in monochrome mode. The SVG root receives a CSS background colour; no filled geometry is added. Disabling it removes the style and restores transparent export. SVG viewers that ignore CSS backgrounds will show their own paper colour.
