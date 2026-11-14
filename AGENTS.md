# AGENTS.md

Isometric Town draws any place from OpenStreetMap as an isometric 3D scene of plotter-ready SVG linework. It is a static Vite + React 19 + TypeScript app with no backend. All drawing happens in a Web Worker.

Read [docs/](docs/README.md) before changing the drawing code. Start with [docs/architecture.md](docs/architecture.md), and read [docs/coordinates.md](docs/coordinates.md) before touching geometry.

## Commands

```bash
npm install
npm run dev      # dev server
npm run build    # tsc type check + vite build: run this to verify every change
npm run doctor   # React Doctor; run after changing React code
npm run lod      # LOD lab: draws test places at 1:500–1:8000 and scores wasted ink (docs/lod.md)
```

There is no test suite. `npm run build` passing is the minimum bar. For drawing changes, compare LOD lab runs before and after (`--name`, `--compare`), look at its close-ups, and say what you could not check by eye.

## Map of the code

- `src/worker.ts`: fetch tiles and tags → `render()` → `plan()` → `toSvg()`.
- `src/render.ts`: pass order for one drawing. New drawn features are wired in here.
- `src/raster.ts`: `Paper` holds the depth buffer, masks, hidden-line tracing and per-pen output.
- `src/tiles.ts`: vector tiles → `Town` in local metres. `src/osm.ts`: Overpass tags, best effort.
- `src/classify.ts`: infers building kind, height and roof. `src/styles.ts`: regional styles.
- `src/lod.ts`: level-of-detail rules, one per kind of thing. `lab/`: the LOD lab.
- Feature modules: `buildings`, `roofs`, `streets`, `infra`, `sites`, `ground`, `gardens`, `nature`, `traffic`, `trains`, `aircraft`, `ships`, `sport`, `vehicles`, `power`, `marginalia`.
- UI: `src/App.tsx`, `src/app/` (state, renderer, persistence), `src/components/`. Visual rules are in [DESIGN.md](DESIGN.md).

## Rules that are easy to break

1. **Pick the right coordinate space.** `Town` and drawing code use local metres (x east, y north, z up). `Paper` and pens use sheet millimetres with y pointing **down**. Use `cam.sx/sy/depth` to project, `paper.on()` for masks in sheet mm and `onMask()` for masks in local metres.
2. **Keep it deterministic.** Never use `Math.random()`. Placed things use `hash(k0, k1, B.set.seed, SALT)` with `[k0, k1] = B.key(x, y)`. Each decision gets its own salt, so grep for a salt before you use it. Made-up detail must not move when the view pans.
3. **Respect the pass order in `render()`.** Fill masks before anything reads them. Call every `fillFace`/`fillSprite` before `finishDepth()`, and every `line3`/`sheet` after it.
4. **Emit linework only.** A feature returns `Solid`s: `faces` go to the depth buffer, `lines` to pens and `casts` to shadows. Flat ground marks go in an `Extra`'s `draw()`. Use the pen constants (`SHADOWS`, `WATER`, `GREENERY`, `ROOFS`, `LINEWORK`), never raw numbers.
5. **Gate features.** Check the relevant setting (`B.set.life`, `.ground`, `.markings`, …) and a level-of-detail rule from `src/lod.ts`: `shows(B.cam, LOD.thing, actualSize, hash)`. Never compare `B.cam.lod` with a bare number, and keep `B.cam.s` for unit conversion. Space hatching and textures with `B.cam.gap(mm)` and tone hatching with `B.cam.tone(mm)`. Use masks (`M.road`, `M.water`, `M.foot`) to keep objects off roads, water and buildings.
6. **Pen colours never trigger a redraw.** They go through `recolor()` on the finished SVG. Don't send colours to the worker.
7. **Be gentle with the network.** Tiles go through `netcache.cached()`. Overpass is optional and time-boxed, and Nominatim is limited to 1 request per second. Don't add blocking dependencies on flaky services. Keep OSM attribution.
8. **Infer from OSM, don't rely on it.** Most tags are missing. Use real tags when they exist and fall back to inference from footprint, neighbours, POIs, land use and region.

## Code style

- Geometry is flat number arrays: `[x0, y0, x1, y1, …]` for 2D and triples for 3D. A `Shape` is the outer ring (counter-clockwise) followed by its holes, and `seam` marks tile-edge cuts that must not be drawn.
- Use the existing short names in hot code: `B` (Build), `M` (Masks), `G` (Ground), `paper`, `cam`, `set`. Avoid allocations in per-pixel and per-vertex loops.
- Comments are plain British English and say *what* and *why* in a sentence. Exported types and functions get a `/** … */` line. Match the tone of the code around you.
- TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`. Prefix intentionally unused params with `_`. The `@/` alias maps to `src/`.
- UI: shadcn/ui parts live in `src/components/ui` and belong to this repo. Use tokens from `src/index.css` and stay inside the five-colour palette (see DESIGN.md). Settings controls use `useSettings().change`.

## Common tasks

Recipes are in [docs/extending.md](docs/extending.md):

- **New drawn feature**: write an `Extra` in the right module and add it to `extras` in `render.ts`. Add a line to the README's "What it draws".
- **New setting**: add it to `Settings` and `DEFAULT_SETTINGS`, to `NumberKey`/`BoolKey` (plus `FORMAT` for numbers), and as a control in `sections.tsx`.
- **New map data**: decode it in `tiles.ts` `decode()`, add it to `Town` and `empty()`, and carry it through `assemble()`.

When a change makes the docs wrong, update `docs/`, `README.md` (feature list and module table) or `DESIGN.md` in the same change.
