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

## Renderer (`app/renderer.ts`)

Owns the worker. `schedule(delay)` debounces; `dispatch()` sends a `Job` with a `structuredClone` of the latest settings only if the worker is idle. When a job finishes, the next queued one goes out. Results are recoloured with the current pens on arrival, since they may have changed during the job.

Worker messages (`Reply` in `worker.ts`): `progress` (a `StageProgress`), `done` (svg, stats, counts, region, ms) or `error` (with `tooBig`).

## Progress

`app/stages.ts` lists the seven stages and their labels. The worker reports them from inside `render()`; `DrawingProgress` shows the card, after a 350 ms delay so quick redraws don't flash. Adding a stage means adding it to `STAGES`, `STAGE_LABEL` and an icon in `components/drawing-progress.tsx`.

## Persistence

`app/model.ts`:

- `persist()` writes all settings to `localStorage` (`isometrictown:settings`) and the view to the URL hash: `#lat/lng/bearing/scale/seed/place`.
- `loadSettings()` merges defaults ← saved ← hash, then validates (`migratePens`, unknown sheet or style → default).
- New settings fields get their default from `DEFAULT_SETTINGS` automatically for old saved states. Renamed or reshaped fields need a migration in `loadSettings()`.

## Locator map

`locator.ts` wraps MapLibre: `setView()` moves without echoing back as a user move, `setFootprint()` draws the red outline of the ground on the sheet (from `Camera.footprint()`), `fit()` frames it. User pans and rotations come back through `onMapMove` and redraw.

## Panel sections

`components/sections.tsx` holds the numbered sections (Place, View, Town, Light, Sheet, Pens, Seed), built from the field patterns in `components/fields.tsx`. The pens section uses `palettes.ts` (presets) and `harmony.ts` (generated sets).
