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
- **Pen colours never go to the worker.** `recolor()` (`src/plot.ts`) rewrites the stroke colours in the finished SVG and stats, so palette changes are instant.

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
| `rng.ts` | `hash()` for position-keyed randomness, `sequence()` for seeded streams |
| `settings.ts` | `Settings` type, defaults, sheet sizes, pen indices |

**Data in**

| Module | Role |
| --- | --- |
| `tiles.ts` | OpenFreeMap z14 vector tiles → a `Town` in local metres; road widths, POI sets |
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

`buildings.ts` (walls, windows, cars, `prism`), `roofs.ts`, `shape.ts` (footprint geometry), `streets.ts`, `infra.ts`, `sites.ts`, `gardens.ts`, `nature.ts` (trees), `trains.ts`, `aircraft.ts`, `power.ts`, `marginalia.ts` + `lettering.ts` (margin notes in single-stroke capitals).

**Interface**

`main.tsx`, `App.tsx`, `app/` (model, renderer, settings context, stages), `components/` (sections and fields), `components/ui/` (owned shadcn parts), `locator.ts` (MapLibre wrapper), `palettes.ts`, `harmony.ts` (palette generator), `index.css` (tokens).

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
