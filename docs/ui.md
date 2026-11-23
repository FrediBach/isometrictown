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

The **Humanize** slider, under Drawing detail in map mode and View in image mode, runs from 0–100%. It is saved and shared with the drawing and affects exported SVG and G-code as well as the preview.

Exceptions to the redraw:

- **Pen colours** (`setPen`, `setPens`, `recolorPens`) only call `recolor()` on the existing result. No redraw: in image mode they, and the background colour, ask the worker to score the drawing on show again (`Renderer.score()`), since how like the image it looks depends on the pens. The footer shows a score once it matches the displayed pens and paper.
- **Draw from** (the Map | Image switch) goes through `setSource()`. The first switch to Image applies `IMAGE_DEFAULTS` (scale, tilt, power lines, title) to settings still at their defaults. Choosing a different image keeps it in the image store, sets its title from the filename and centres the crop. Choosing the image named by a shared link restores the saved title and crop.
- **Place and seed** changes go through `goTo()` and `setSeed()`, which commit and schedule directly.
- **Clicking a building** in the preview calls `reroll()`: it asks the renderer which building is at that sheet position, gives it a new entry in `seedLocks` and redraws. `unlockAll()` (the Seed section's Unlock all) clears them.

## Renderer (`app/renderer.ts`)

Owns the worker. `schedule(delay)` debounces; `dispatch()` sends a `Job` with a `structuredClone` of the latest settings only if the worker is idle. When a job finishes, the next queued one goes out. Results are recoloured with the current pens on arrival, since they may have changed during the job. Switching sources clears the sheet and releases the previous worker. Replacing an image clears the sheet until the worker finishes the new one. A reply for the previous picture is discarded.

Jobs (`Job` in `worker.ts`) are `draw` (settings, and in image mode the picture when the worker hasn't been sent it), `pick` (a sheet position in mm), `strokes` (tally names) or `score` (settings). Worker messages (`Reply`): `progress` (a `StageProgress`), `done` (svg, stats, counts, census, features, region, ms, and in image mode `likeness`), `error` (with `tooBig`, or `missing` when the worker lacks the picture, which the renderer answers by sending it again), `picked` (the building's lock key, or null), `strokes` (path data and the densest spot) or `scored` (likeness). `pick()`, `strokes()` and `score()` return promises and never touch the draw queue. In image mode the renderer sends nothing until the picture is on hand. The worker answers from the last finished drawing, which is the one on show.

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

- `persist()` writes all settings to `localStorage` (`isometrictown:settings`) and the drawing to the URL hash: `#lat/lng/bearing/scale/seed/place/key=value&…`. The seventh part lists every setting that differs from `DEFAULT_SETTINGS` (`toQuery()`), seed locks and pens included, so a link reproduces the drawing. Only `speed` stays out, as it belongs to the plotter, not the drawing. Colours drop their `#`, pens are comma-separated, `layerPens` is `layer:pen,…`, `seedLocks` is `x,y:seed;…` and `imageFocus` is `x,y` and `imageMasks` and `imagePins` are JSON with numbers to four places. A link in image mode carries the image's id and settings but not the image: another browser can draw it only if it has that image stored, and the image well says so when it hasn't.
- `loadSettings()` merges defaults ← saved ← hash, then validates (`migratePens`, unknown sheet or style → default, malformed `seedLocks` entries dropped). A hash with the seventh part (even an empty one) first resets every shared setting to its default, so the receiver's own saved settings don't leak into a shared drawing. An old six-part hash only sets the view and keeps the rest from `localStorage`.
- Pasting a link into an open tab fires `hashchange`, and `App` reloads to read it. `persist()` uses `replaceState`, which does not fire it.
- New settings fields get their default from `DEFAULT_SETTINGS` automatically for old saved states. Renamed or reshaped fields need a migration in `loadSettings()`.

## Locator map

`locator.ts` wraps MapLibre: `setView()` moves without echoing back as a user move, `setFootprint()` draws the red outline of the ground on the sheet (from `Camera.footprint()`), `fit()` frames it. User pans and rotations come back through `onMapMove` and redraw.

## Sets of sheets

The Sheet section's **Sheets across** and **Sheets down** (1–4 each) split the drawing over a set of sheets, and **Gap between sheets** sets the space between them as they hang, frames included (see [coordinates.md](coordinates.md#panels)). `RenderResult.layout` says how the drawing on show is split, and `sheet` is then the whole wall. The preview (`Sheets` in `components/stage.tsx`) lays a sheet of paper under each panel with the stage showing through the gaps; the paper colour moves from the SVG onto the sheets. **Download** gives one SVG for a single sheet, and for a set a ZIP (`app/zip.ts`, deflated with `CompressionStream` where there is one) of one SVG per sheet, named by row and column. The plot dialog shows a small plan of the set to pick the sheet to plot; it is fixed while that sheet's plot is under way, and the pen table measures that sheet's own strokes. G-code files carry the sheet's row and column in their name and title.

## Panel sections

`components/sections.tsx` holds the numbered sections (Place, View, Town, Light, Title, Sheet, Pens, Seed), built from the field patterns in `components/fields.tsx`. The pens section uses `palettes.ts` (presets) and `harmony.ts` (generated sets).

Section 1 starts with the **Map | Image** switch. In Image, drop or choose a picture in the image well (`components/image-well.tsx`). With Fill selected, dragging or using the arrow keys moves the crop. Brightness and Contrast adjust the tones the controls below read. Colour, Likeness and Street pattern set the overall character of the town. Street pattern blends from organic lanes to a regular grid in 1% steps. It starts at the regional style’s default, which you can restore after adjusting the slider.

- **Neighbourhoods as in real towns** places districts beside each other as they lie in 60 real places: works on the water, suburbs out by the fields, towers among blocks and squares, old towns away from meadows. At 0% zoning keeps its hand-made rules.
- **Countryside ↔ town** tips close matches between open land and built neighbourhoods. **Water preference** separately favours wetter or drier land. Both start at *Balanced*.
- **District size** sets how readily neighbouring patches become one district. **Street spacing** sets the distance between local streets within each built district. Both range from 0.5× to 2× and start at 1×. All four controls can be set inside masks.
- **Height from image** raises towers in the darkest parts of the picture and tapers buildings down in lighter areas.
- **Building density** sets the overall coverage on ordinary plots. Below *Normal*, more plots stand empty and buildings take less ground. Above it, buildings extend into available space. Masks can set this baseline locally.
- **Building density from image** below zero opens plots across the picture, especially in pale areas. Above zero it gives buildings more ground in dark blocks and opens space for gardens in pale blocks.
- **Hatching from image** changes how closely roofs, walls, fields, parks and cast shadows are hatched. It follows the tone where the strokes land on the sheet.
- **House floorplans follow image lines** turns detached houses and shapes the rear walls of terraces along sustained contours. Raising it increases the distance a contour can influence and how far the walls move. Terraces retain their street fronts and the direction of their shared walls.
- **Country road winding** shapes the connecting lanes across open ground in an organic street pattern. At 0% the links are direct. The default 50% eases them into existing streets. Higher values also steer through roads along winding corridors across country. At 100%, shorter connections can bend and long lanes can make deep S-bends. Near a lake the planner tries the other side of a bend before tightening it.
- **More roundabouts** makes more junctions roundabouts than real towns of the style would, ten times the odds at 50% and a hundred times at 100%; at 200% nearly every junction with room is one, keeping them where busy roads meet first. At 0% junctions follow real towns.
- **Streets follow image lines** traces bright centrelines and long outlines as roads or paths. At 0% it lays no routes from either. The selected street pattern fills the surrounding neighbourhoods.
- **Preserve empty space** clears town linework from transparent areas, holes and Fit margins. With the switch on, **Highlight cutoff** initially reads *Transparency only*. Set it to 90% to clear areas with adjusted lightness of 90% or higher. The frame and margin lettering can still be plotted.

Preserve empty space starts off. Saved drawings and share links carry these choices.

**Masks** (`components/mask-panel.tsx`, below the image settings) set some of the settings differently in part of the picture. The Ellipse, Rectangle and Polygon keys add one in the middle of the picture and select it. The list picks, hides (eye) and removes them. The selected mask's card has Feather, Round corners (rectangle and polygon), Amount, Invert and In the drawing, arrows to move it earlier or later, Duplicate (a copy just after it, nudged down and right, and selected), Mirror left to right and Mirror top to bottom (across the picture's middle, turning the other way), and a dial for every setting a mask can change, grouped as Image, Streets, Town from the image, Buildings and Town. Under Streets, Street pattern blends from Organic to Grid inside the mask. Feather softens the transition into neighbouring streets. A dial follows the drawing's own value, in grey, until it is moved; the reset key beside its readout makes it follow again. Preserve empty space reads *Off* at the end of its dial. Windows, Roof hatching, Rooftop boxes, Roof details and Shade walls are selector switches: *As on* (or *As off*) follows the drawing, On and Off set it inside the mask.

**Add source tint** opens a colour picker, a blend mode and **Tint amount**. Colour preserves the source luminosity. Normal, Multiply, Screen and Overlay also change tone. The mask's Amount, feather, inversion and visibility apply to the tint, and later masks blend over earlier ones. The image well and Image overlay show the tinted picture when its drawing finishes. The uploaded pixels stay available for editing or removing a tint.

**Pins** (`components/pin-panel.tsx`, below Masks) place things from the catalogue on the picture (`src/image-pins.ts`). Add a pin lists the kinds as Landmarks, Streets and Ground, and puts the new one in the middle of the picture, selected. So does the Pin one row in the catalogue entry each kind places, which also closes the catalogue. The list shows each pin's symbol and name and a mono readout of what became of it in the drawing on show (*in the town*, *no room*, or *hidden*), with eye and bin keys. The selected pin's card says what it makes, says why it was left out if it was, and for ground kinds has Size, the circle's radius as a share of the picture's shorter side, and Feather, a soft edge across it in the same units: the ground inside it is held, and across it the picture shapes the edge. The folded summary counts the pins and those with no room. While a pin is selected, and only then, the preview shows it as a round symbol that keeps its size at any zoom (`components/pin-layer.tsx`), with a dashed circle for a ground pin (and faint dotted rings at the inner and outer edge of its feather), in the signal colour, or red when the town had no room for it; other pins stay out of sight, as other masks do. Dragging the symbol moves the pin; clicking it, Escape or Done lets go and hides it. A focused symbol moves with the arrow keys. Clicks on a symbol don't pick the building under it. A selected mask hides the pins while it is edited, and selecting a pin lets go of the mask. Pins are stored with the settings and travel in links as JSON, like masks.

While a mask is selected the preview shows it (`components/mask-editor.tsx`): its strength as a tint in the signal colour, full inside and fading across the feather, its outline and handles, and the other masks' outlines dashed. Dragging the shape moves it, the side and corner handles size it about its middle, and the handle on the stem turns it (Shift for 15° steps). A polygon has a handle on each corner; dragging the smaller dot in a side pulls out a new corner there, and double-clicking a corner removes it. Arrow keys nudge the mask, and Escape or Done ends editing. While editing, clicks on the preview don't pick buildings. The drawing is redrawn when a drag ends.

The place search and locator mount only in Map mode. Returning to Map restores the centre and bearing from settings. `app/use-picture.ts` loads the stored picture when `set.image` changes and hands the renderer the one on hand. In image mode the toolbar adds two view keys, **Image** (the picture over the drawing area at half strength, placed with `fitImage()`) and **Squint** (the preview blurred by 1.5 mm, to show its tone), and the stats footer a **Likeness** readout.

Light defaults to Automatic sun: geographic south-east in the north and north-east in the south. Turning it off exposes the existing view-relative direction slider; the section summary always shows the resulting compass bearing. Old saved settings with an adjusted sun angle, and old share links with an explicit sun angle, retain manual lighting. Links carry `autoSun` explicitly alongside a non-default manual angle so automatic lighting can retain that angle without changing mode when shared.

## Optional drawing colours

`customLayerPens` enables `layerPens`, a partial feature-to-pen mapping keyed by `LAYERS` in `settings.ts`. Missing entries retain the original mix of pens. Assignments redraw and replan so pen groups and statistics remain accurate. OSM roof tags are a data source, not a drawable feature, so they have no pen assignment. Disabling custom assignments keeps them saved; resetting clears them.

`customLayerDetail` enables `layerDetail`, a partial feature-to-Detail mapping shown under the Detail slider in Drawing detail (map mode) or View (image mode) (`DETAIL_LAYERS` in `settings.ts`). Each value replaces the slider for that feature; missing entries follow it. Details on a building follow the building's Detail unless they have their own (see [lod.md](lod.md)). It is stored and shared like `layerPens` (`layer:detail,…`). The catalogue's "shows from" scales use the Detail of the layer an entry is filed under.

`customBackground` and `background` use `recolor()` without scheduling the worker, including in monochrome mode. The SVG root receives a CSS background colour; no filled geometry is added. Disabling it removes the style and restores transparent export. SVG viewers that ignore CSS backgrounds will show their own paper colour.
