# Architecture

Isometric Town is a static single-page app (Vite, React 19, TypeScript, Tailwind v4, shadcn/ui), deployed to Vercel. There is no backend: the browser fetches public map data, draws the town in a Web Worker and hands back a finished SVG.

## Two threads

```
Main thread (React)                              Worker (src/worker.ts)
───────────────────                              ──────────────────────
App.tsx  ── settings ──►  Renderer  ── Job ──►   loadTown()   vector tiles  ┐
  ▲                     (app/renderer.ts)        loadTags()   Overpass      ├─ in parallel
  │                                              detectRegion() country     ┘
  │                                              render()     → pens of polylines
  │                                              plan()       join + order strokes, stats
  └── RenderResult ◄── Reply (progress | done | error) ◄── toSvg()
```

- **Main thread**: the settings panel, the locator map (MapLibre), place search, the SVG preview and stats. It never does geometry heavier than the locator footprint.
- **Worker**: everything from download to SVG string. It is an ES module worker (`worker: { format: 'es' }` in `vite.config.ts`) because it lazy-loads `country-coder`.
- The `Renderer` runs **one job at a time** and always draws the *latest* settings next; intermediate changes are dropped, not queued. Progress messages from stale jobs are ignored by id.
- **Pen colours restyle the SVG immediately.** `recolor()` (`src/plot.ts`) rewrites the stroke colours in the finished SVG and stats, so palette changes are instant. In image mode a pen change also asks the worker to score the drawing on show again (a `score` job), which costs no redraw.
- **Image mode** (`set.source === 'image'`) takes the place of the first step: instead of `loadTown()`, `loadTags()` and `detectRegion()`, the worker lays out a `Town` from a picture with `imageScene()` (`src/image.ts`) and draws it with the same `render()`. It fetches nothing. The layout uses the Classic pens on white paper as its colour reference. The worker remaps the cached target to the current linework ink and paper when scoring the sheet. The main thread sends the picture with a job only when the worker doesn't have it yet; the worker keeps the last two. See [plans/image-mode.md](plans/image-mode.md).

## Module map

All drawing code lives flat in `src/`. Modules are grouped here by role; names in the left column are files.

**Pipeline and plumbing**

| Module | Role |
| --- | --- |
| `worker.ts` | Worker entry: fetch, render, plan, SVG; posts progress |
| `render.ts` | The pass order of one drawing; owns masks, solids and the line passes |
| `raster.ts` | `Paper`: depth buffer, screen-space masks, hidden-line tracing, hatching, per-pen output |
| `camera.ts` | Orthographic camera: world metres → sheet mm and depth |
| `geo.ts` | Web Mercator, `Frame` (local metres around the centre), ring helpers |
| `plot.ts` | Stroke joining and ordering, plot stats, SVG output, recolouring |
| `gcode.ts` | G-code for GRBL pen plotters, read back from the finished SVG on the main thread (see [ui.md](ui.md#pen-plot)) |
| `rng.ts` | `hash()` for position-keyed randomness, `sequence()` for seeded streams |
| `settings.ts` | `Settings` type, defaults, sheet sizes, pen indices |

**Data in**

| Module | Role |
| --- | --- |
| `tiles.ts` | OpenFreeMap z14 vector tiles → a `Town` in local metres; road widths, POI sets |
| `image.ts` | Image mode: a `Town` laid out from a picture and the fictional place it stands in (`drawnAs()`). Changing the seed, style, street fabric, contours or roundabouts reuses the cached zones and rebuilds the streets and lots. |
| `image-fit.ts`, `image-read.ts`, `image-tone.ts` | Where the image lies on the sheet; the picture read into a target (OKLab, tone, edges, orientation, thin lines); the materials, pen mixing and the likeness score |
| `image-adjacency.ts`, `image-adjacency-data.ts` | Neighbour costs for zoning learnt from which zones border which in real towns. The data file is written by the adjacency lab (`npm run adjacency -- --write`). |
| `image-floorplans.ts`, `image-floorplan-data.ts` | Footprint plans learnt from real towns: the L, T, U and stepped plans each built zone builds, and the rear wings of terraces, picked by how often the zone builds them and how near their usual proportions are, and left out where their shortest wall would not show at the drawing's scale. The data file is written by the floorplan lab (`npm run floorplans -- --write`). Also the guides that turn houses and the backs of terraces towards the picture's contours. |
| `image-junctions.ts`, `image-junction-data.ts` | How junctions are controlled and where people cross, as real towns of the style do it, by the classes of road that meet and the zone: roundabouts built into the street graph as a ring round an island, signals and crossings for `Town.controls`. The data file is written by the junction lab (`npm run junctions -- --write`). |
| `image-zones.ts` | Image mode's land plan: superpixels that follow the image's edges, each labelled water, park, wood, field, suburb, old town and so on to match it. Saturated blue can preserve a small pond or a narrow channel through zoning. Compact ponds get lake ripples even at street scale. Long channels reaching opposite sides of the plan keep their flow texture at wider scales. After the first fit, housing and industrial land within a few blocks help resolve close material matches for parks and works. The preference fades to zero at full likeness. |
| `image-water.ts`, `image-streets.ts` | Zone outlines traced and smoothed, water sorted into lakes, rivers and sea; the street network: a field of directions, main roads by least cost with seeded approaches across open country, streets traced along the field, organic lanes joining street ends across open ground with bends that tighten beside water, cleaned into a planar graph that keeps the rules of the plan's §10.5, and ranked |
| `image-tune.ts` | The predictor: the calibrated materials laid on a grid of about a millimetre over the town as built, each lot at its own level and roof; the tuning loop of the plan's §14, which drawings don't run yet because it gains no likeness, and its hook for refining against a drawing |
| `image-heights.ts` | The Height from image control shapes a copy of the town before drawing. It reads tone along the projected walls, sets heights to suit the available footprint and can join neighbouring plots into a tower site. |
| `image-density.ts` | Samples tone at each plot, adjusts building footprints and leaves some pale plots as open ground. The layout reserves neighbouring plots before expanding buildings. |
| `image-hatching.ts` | Samples tone in sheet millimetres to space hatch lines on projected buildings, ground and cast shadows. |
| `image-space.ts` | Clips the visible town strokes to preserve transparency and optional highlights. Picking and the feature catalogue use the same reserved areas as the plotted sheet. |
| `image-rock.ts` | Fits bare rock and roadside quarries into image-mode meadow before lots are occupied. |
| `image-rail.ts` | Fits a terminus or street-parallel through station, using a separately seeded regional direction to rank frontages and comparing complete routes against proposed housing and the source image. |
| `image-rail-route.ts` | Searches alternative tangents and circular arcs between the platform and the sheet boundary. Reserves the curved track bed and checks crossing angles and spacing along the route. |
| `image-ferries.ts` | Image-mode waterfront access. Assigns small lakes a sailing-boat allowance and reserves paths and piers for crossings between distinct roads on facing banks. At most one lake gets a navigable crossing. |
| `image-amenities.ts` | Image-mode civic uses on existing plots, protected when density changes. Each centre favours the street with the most accessible housing frontages for shops. Likeness controls how strongly shops cluster, keeping their overall count for that layout. Street-front shops, stops and fuel points, meadow campsites and park recreation sites supply the same renderer inputs as their mapped counterparts. |
| `image-ground.ts` | Image mode's open land from the zones: water, squares, parks, woods, meadow, sand, land use; fields and allotments cut into a staggered patchwork with tracks and footpaths between; the trees it plants itself in courtyards and churchyards (`Town.trees`, always empty from map tiles) |
| `image-blocks.ts`, `image-buildings.ts`, `image-check.ts` | Blocks as the faces of the street graph, inset from the streets, their rims cut into lots that share cut lines (corner lots span the corner); footprints on each lot by zone (rows sharing walls, with learnt rear wings; houses, halls and towers in plans learnt from real towns, some halls round open service courts and some towers bevelled), explicit heights smooth along a row, the tags and points `classify()` reads, churches, a town hall and schools with pitches; the rules no building may break (roads, water, parks, woods, squares, each other), which laying out checks as it goes and `plausibility()` checks after |
| `osm.ts` | Overpass roof shapes and building types (best effort, time-boxed) |
| `netcache.ts` | Cache Storage wrapper: cache-first, stale on failure, pruned |
| `styles.ts` | Regional building styles and offline country detection |
| `search.ts` | Place search (Nominatim) and the bundled town list (`public/cities.json`) |

**Inference**

| Module | Role |
| --- | --- |
| `classify.ts` | Per building: kind, height, roof, party walls, street side, shops, landmarks. Writes `Building.info` |
| `traffic.ts` | `urbanity()` and vehicle density/placement |
| `ground.ts` | `planGround()`: land-cover codes, inferred gardens, in-town test; then field and pitch textures |

**Things drawn** (each takes `Build` and returns solids and/or draws onto `Paper`)

`buildings.ts` (walls, cars, `prism`), `facades.ts` (window schemes: a pattern chosen in `classify`, laid out and drawn per wall), `roofs.ts`, `shape.ts` (footprint geometry), `streets.ts`, `infra.ts`, `sites.ts`, `gardens.ts`, `nature.ts` (trees), `trains.ts`, `aircraft.ts`, `ships.ts`, `sport.ts` (players and racing), `vehicles.ts` (models of working vehicles), `power.ts`, `marginalia.ts` + `lettering.ts` (margin notes in single-stroke capitals), `title.ts` (the cinematic title: those capitals thickened into extruded block letters on a street).

**Interface**

`main.tsx`, `App.tsx`, `app/` (model, renderer, settings context, stages, the GRBL plotter driver and its session), `components/` (sections and fields), `components/ui/` (owned shadcn parts), `locator.ts` (MapLibre wrapper), `palettes.ts`, `harmony.ts` (palette generator), `catalogue.ts` (the documented list of everything detected, inferred or made up, for the catalogue dialog), `index.css` (tokens).

## Principles that shape the code

1. **Output is plotter linework.** Everything ends as polylines in sheet millimetres, assigned to one of five pens. No fills, no raster output.
2. **Hidden lines are removed geometrically** with a depth buffer before export, so nothing is drawn twice and nothing shows through.
3. **Deterministic.** The same settings give the same drawing, and panning does not reshuffle made-up detail. All randomness is keyed to absolute map position plus the seed (see [coordinates.md](coordinates.md#determinism)).
4. **Infer, don't require.** OSM rarely has heights or roof shapes. The code guesses from footprint, neighbours, streets, POIs, land use and region, and uses real tags when they exist.
5. **Best effort networking.** Tiles are needed; Overpass tags are a bonus with a 2.5 s grace period. Failures fall back to stale cache.
6. **Plain data.** Geometry is flat `number[]` (`[x0, y0, x1, y1, …]`, or triples for 3D). Few classes (`Camera`, `Frame`, `Paper`, `Renderer`).

## Build and deploy

- `npm run dev` — Vite dev server.
- `npm run build` — `tsc` (type check only, `noEmit`) then `vite build` to `dist/`. This is the main correctness check; there is no test suite.
- `npm run doctor` — React Doctor (also runs in CI on PRs and `main`, advisory).
- Vercel builds with `npm ci && npm run build`; headers and caching are in `vercel.json`.
- `scripts/cities.mjs` regenerates `public/cities.json` from a Natural Earth populated-places GeoJSON.
