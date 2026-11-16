# Testing

`npm test` type-checks the tests and runs them all, in about 15 seconds, with no network. Run it after every change. It runs in CI on every push and pull request (`.github/workflows/test.yml`), next to `npm run build`.

```bash
npm test               # type check the tests, then everything
npm run test:unit      # only the unit tests, well under a second
npm run test:watch     # unit tests, rerun on save
npm run test:update    # accept changed goldens, after looking at them
npm run test:record    # fetch map data for new or changed cases
```

There are two kinds of test, in two Vitest projects.

## Unit tests (`test/unit/`)

These are small and exact, for the parts that are pure functions.

| File | What it pins down |
| --- | --- |
| `search.test.ts` | Search persistence, language keys, duplicate submissions, spacing, cooldowns, cancellation and unavailable storage |
| `network.test.ts` | Overpass cooldowns across worker reloads, tile concurrency and stalled response bodies |
| `osm.test.ts` | Overpass mirror cooldowns, fallback success, recovery, increasing pauses, `Retry-After` and timeouts |
| `roof-hatching.test.ts` | Gable shading continues to the roof profile; a recorded Bauma wing keeps roof faces and hatch strokes coplanar despite unequal overhangs |
| `roof-visibility.test.ts` | Exposed and occluded roof ends, full and partial coplanar joins, real gaps, rotations and panning, plus a recorded Mollis rim where pixel depth hid its own edge |
| `geometry.test.ts` | `hash()` values (every made-up thing depends on them), Mercator and `Frame`, ring area, `bestRect`, `offsetRing`, the camera's projection, `ground()`, `region()`, `gap()`/`tone()`, `within()` |
| `lod.test.ts` | Every rule in `LOD` cuts in where `coarsest()` says, the fade order, bigger things lasting longer, Detail and pen width, `thin`, `atLeast`, `spaced` |
| `model.test.ts` | Share links: every kind of setting round-trips through the address bar, bad values are dropped, old four-pen sets migrate, the scale slider |
| `plot.test.ts` | Joining and ordering strokes, `plan()`, SVG output and `recolor()`, reading pens back with `layersOf()`, machine coordinates for each corner and turn, G-code that keeps the pen up for travel and stays on the bed |
| `grbl.test.ts` | The GRBL streamer against a simulated controller: it never puts more than 128 unanswered bytes on the wire, keeps the buffer busy, reports errors and positions |
| `catalogue.test.ts` | Entries are unique and complete, and point at gates and LOD rules that exist; stroke patterns match as documented |
| `misc.test.ts` | Settings helpers, region detection for known places, lettering, title text, palettes, the harmoniser keeping locked pens |
| `public-commons.test.ts` | Pocket-park and market furniture: clear paths, junctions, tree crowns, feature gates, LOD and map-fixed placement |
| `wind.test.ts` | Wind sites across pans, scale and bearing; rotor separation, complete clearance, mapped meadow subclasses, depth/settings gates, off-sheet bases and visible shaft simplification |
| `public-energy.test.ts` | Public roof envelopes, interior-patch search, column/path clearance, holes and obstacles, open skylight depth, gates, pans, canonical axes and duplicate source polygons |
| `production.test.ts` | Productive-property footprints, roof holes, enclosed obstacles, mapped paths, overlapping neighbours, gates and view-independent plans |
| `shared-water.test.ts` | Water courts and campuses: complete clearance, source identity, conflicts, scale/pan stability, gates, bounded geometry and visible space beneath elevated storage |
| `growing-frames.test.ts` | Productive galleries: full context obstacles, conflicting neighbours, stable plans, gates, bounded geometry and greenhouse depth versus open hot-climate bays |
| `tower-gardens.test.ts` | Repeated tower openings: spacing, supported footprints, holes, seams, pan stability and visible columns at multiple scales and bearings |
| `garden-building.test.ts` | Stepped rooftop farms: full support, holes and seams, height limits, roof coordination, stable plans across pans and projection, finite geometry at 1:1000–1:8000 |
| `future.test.ts` | Solarpunk planning: climates by region, the same plan from any view, landmarks kept, Intensity only adds, a lock rerolls one building |
| `rules.test.ts` | Rules from AGENTS.md checked in the source: no `Math.random()` or clocks in drawing code, no bare comparisons with `cam.lod`, no fetching outside `tiles.ts` |

## Drawing tests (`test/render/`)

These draw whole sheets with the real pipeline (`loadTown` → `render` → `plan` → `toSvg`, as the worker does) from map data recorded in `test/fixtures/net`.

- **`sheets.test.ts`** draws each case in `test/cases.ts`: twenty-seven places and settings (fourteen of them in solarpunk mode, on places already recorded: six at depth Retrofit, which must not change as the bolder depths are built, their Transform twins, and Mollis and Midtown at Visionary) that between them reach almost every feature, regional style and tricky setting. For each one it checks:
  - the golden (below),
  - every stroke is a finite polyline on the sheet, and every feature stays inside the drawing area,
  - every stroke is filed in the tally (only the frame and map notes are not),
  - every feature drawn has a catalogue entry,
  - planning loses no ink and never adds pen lifts,
  - the SVG reads back stroke for stroke with `layersOf()`, in the right colours.

  At the end it draws the first case again and requires the identical SVG, which catches state leaking between drawings.
- **`gates.test.ts`** switches each setting that switches something on (Windows, Trees, Life, Markings…) off in turn. Whatever the catalogue says needs that setting must then be gone, and the setting must have had something to take away.
- **`pan.test.ts`** pans the view 30 m and 47 m east and checks that trees, cars, people and animals, buildings, roofs, roof details, windows, streets and ground textures lay the same strokes, shifted. 47 m is a multiple of no grid the drawing uses, so a grid tied to the view shows up. Shadows, park grass and water waves are left out: they are tone hatching on the sheet's own grid. A second pair of drawings in solarpunk mode checks panels, green roofs, rain tanks, garden-street strips and groves the same way; the planting hatch of strips, of car parks turned into parks and of planted banks is tone and left out.
- **`future.test.ts`** checks that the solarpunk settings change nothing while the mode is off, that the mode adds its panels and imprint, and that every stroke only the mode draws is claimed by the catalogue's Solarpunk group, so the lab's new-ink share counts it.

The imprint in the margin dates each sheet, so drawing tests pin the clock to `DRAWN_ON` in `test/support/clock.ts`.

### Goldens

Each case has a golden file, `test/golden/<id>.json`, with strokes and ink per feature (`streets:kerbs`) and per facet (`buildings/gabled-roof`), the plan, the counts and census, and a hash of the SVG. Drawing is deterministic, so any change to the drawing changes a golden, and the features show *what* changed.

A changed golden is a question, not necessarily a bug:

1. Read the diff. If a feature you didn't touch moved, that's a regression.
2. Look at the drawings. Every run writes each case's SVG to `test/out/<id>.svg` (in CI, failed runs upload them). For close-ups and wasted ink, compare LOD lab runs before and after (see [lod.md](lod.md#the-lod-lab)).
3. If the change is what you meant, run `npm run test:update` and commit the goldens with the change.

### Map data fixtures

Tests never use the network: `test/setup.ts` replaces `fetch` with one that answers from `test/fixtures/net` and throws for anything not recorded. Each response is a `<sha1>.json` (URL, status, type) and a gzipped `<sha1>.gz`, keyed like the LOD lab's cache.

When you add a case or move one (place, scale, sheet, tilt: anything that changes which tiles it needs), run `npm run test:record`. It fetches only what's missing, from the LOD lab's `lab/.cache` where it can, and waits longer than the app does for slow Overpass mirrors. To record everything from scratch (a new planet build, say), delete `test/fixtures/net` first. The goldens will change with the data, so check them as above.

Only `mollis-default` uses OSM tags; the other cases keep `osmTags` off.

## Adding tests

- A new drawn feature: the drawing tests will want a catalogue entry for its tally name, and its golden will change. If no case draws it, add or adjust a case in `test/cases.ts` and run `npm run test:record`.
- A new switch: give its catalogue entries `needs` and `strokes`, and `gates.test.ts` checks it. Where an entry's strokes don't need the switch, leave them out of that entry; another entry can claim them. If neither base sheet has anything for it to switch off, add a base, as `RURAL_BASE` does for railways and power lines.
- Pure logic: a unit test in `test/unit/`. Use `vi.stubGlobal` for browser globals, as `model.test.ts` does for storage and the address bar.
