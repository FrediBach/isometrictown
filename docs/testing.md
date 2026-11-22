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
| `model.test.ts` | Share links: every kind of setting round-trips through the address bar, bad values are dropped, old four-pen sets migrate, the scale slider, image-mode settings and defaults |
| `image.test.ts` | Image mode: where the image lies on the sheet both ways, OKLab and pen mixing, the tone curve, Fit's margins and transparency, edges, orientation and thin lines, superpixels, materials, outlines and kinds of water, splitting street lines into a planar graph and cleaning it, the blocks of a street grid and their lots (fronting the street, no slivers, cut lines and building corners shared exactly, corner lots spanning the corner), the occupancy raster, fields cut into parcels of 1–5 ha (some turned across) with tracks inside them and allotments into sites with footpaths, each building type and roof image mode tags becoming the kind it means, a town hall's flag, and none of it counting as OSM tags, the drawn-as place, the likeness score, the image store's format and ids |
| `plot.test.ts` | Joining and ordering strokes, `plan()`, SVG output and `recolor()`, reading pens back with `layersOf()`, machine coordinates for each corner and turn, G-code that keeps the pen up for travel and stays on the bed |
| `grbl.test.ts` | The GRBL streamer against a simulated controller: it never puts more than 128 unanswered bytes on the wire, keeps the buffer busy, reports errors and positions |
| `catalogue.test.ts` | Entries are unique and complete, and point at gates and LOD rules that exist; stroke patterns match as documented |
| `misc.test.ts` | Settings helpers, region detection for known places, lettering, title text, palettes, the harmoniser keeping locked pens |
| `rules.test.ts` | Rules from AGENTS.md checked in the source: no `Math.random()` or clocks in drawing code, no bare comparisons with `cam.lod`, no fetching outside `tiles.ts` |

## Drawing tests (`test/render/`)

These draw whole sheets with the real pipeline (`loadTown` → `render` → `plan` → `toSvg`, as the worker does) from map data recorded in `test/fixtures/net`.

- **`sheets.test.ts`** draws each case in `test/cases.ts`: thirteen places and settings that between them reach almost every feature, regional style and tricky setting. For each one it checks:
  - the golden (below),
  - every stroke is a finite polyline on the sheet, and every feature stays inside the drawing area,
  - every stroke is filed in the tally (only the frame and map notes are not),
  - every feature drawn has a catalogue entry,
  - planning loses no ink and never adds pen lifts,
  - the SVG reads back stroke for stroke with `layersOf()`, in the right colours.

  At the end it draws the first case again and requires the identical SVG, which catches state leaking between drawings.
- **`image.test.ts`** draws towns in image mode from pictures made in code (`test/support/pictures.ts`: a ramp, a disc, colour bands, stripes, a white cross, a soft landscape), with a stub `fetch` that fails on any call. Each has a golden, `test/golden/image-<id>.json`, which also records its likeness score, and the same checks as the map sheets. Each must also score above a likeness floor, set a little under its score when its golden was accepted, and the predictor must still put each pen's ink within 50% (or two percentage points of coverage) of what is drawn. The total ink must be within 20% (or 1.5 percentage points). When a drawing change breaks the guard, rerun `npm run calibrate` and paste the new table in with the change.
- The checks every sheet keeps live in `test/support/checks.ts` (`sheetChecks()`), shared by both.
- **`image-plan.test.ts`** lays out whole scenes without drawing them: the same picture gives the same town, changing Detail, pen width, paper or palette gives the same layout on screen and after reload, a new seed keeps the land plan, zoning splits two halves along their edge and absorbs specks, rows share their walls and the town has a church and a town hall, fields come as a patchwork and courtyards get trees, and every test picture's streets keep the rules of §10.5 (organic and grid in turn) and its town is plausible (`plausibility()`: simple building outlines, every footprint clear of roads, stream banks, water, parks, woods, squares and other buildings, none too far from a street, and no tree on any of those).
- **`gates.test.ts`** switches each setting that switches something on (Windows, Trees, Life, Markings…) off in turn. Whatever the catalogue says needs that setting must then be gone, and the setting must have had something to take away.
- **`pan.test.ts`** pans the view 30 m and 47 m east and checks that trees, cars, people and animals, buildings, roofs, roof details, windows, streets and ground textures lay the same strokes, shifted. 47 m is a multiple of no grid the drawing uses, so a grid tied to the view shows up. Shadows, park grass and water waves are left out: they are tone hatching on the sheet's own grid.

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
- Image mode: a new picture goes in `test/support/pictures.ts`, a new case in `test/render/image.test.ts`. Check a changed planner with the likeness lab too.
- Pure logic: a unit test in `test/unit/`. Use `vi.stubGlobal` for browser globals, as `model.test.ts` does for storage and the address bar.

## The likeness lab

`npm run likeness` draws image mode from the test pictures at 1:1000–1:8000, headless, with the fetch stubbed to fail, and writes `lab/out/<name>/`: per case the picture, what the drawing should look like (the picture after the tone curve, in the range pens on paper reach), what the drawing looks like from arm's length, and the drawing, with two debug views: the target's edges and thin lines, and the land plan as it lands on the sheet. The report gives likeness (score, ΔE at arm's length and across the room, SSIM), how closely the drawing's lightness follows the image's (a correlation across the room, which, unlike the score, doesn't change when the target's range does), the predictor's ink per pen against the drawing's, the share of each zone, the number of streets and any breach of the street rules, the blocks and lots laid out and anything implausible, ink tone, waste and the time of each step. Like the LOD lab, it takes `--images`, `--scales`, `--name` and `--compare`, plus `--likeness`, `--pens <palette>`, `--sheet`, `--detail` and `--pen`. Use it for every change to the image-mode planner and inspect the actual sheets as well as the scores.

The cross reports the percentage of each arm followed by a road or path within 3 mm of its centre and 30° of its direction. The bands report how much of each target hue survives in the drawing, averaged over the interior of that band. A band at 0% is grey or perpendicular to the target hue, 100% matches the target chroma in that direction, and a negative percentage means the drawing leans towards the opposite hue. `image-features.test.ts` guards these measures.

Use `--town-bias` and `--water` from −1 to 1, and `--street-spacing` and `--district-size` from 0.5 to 2. Use `--relief`, `--density`, `--hatching`, `--contours` and `--neighbours` independently or together at strengths from 0 to 1. To compare a skyline with and without local hatching, make two named runs of the same picture at `--relief 1`, adding `--hatching 1` on the second. To inspect reserved paper, try `--images logo --preserve-space` for transparency or `--images gradient --preserve-space --highlight 0.75` for opaque highlights. Compare the drawings and the measured coverage. The predictor uses the calibrated materials' usual heights and hatch spacing and sees the town before clipping. For an experimental build with tunable street-front rows, run `npm run likeness -- --tuned --name tuned --compare untuned` after making the corresponding `--name untuned` run.

The lab also draws two local PNG fixtures. The transparent logo uses the house from `public/logo.svg` with its background removed. The photograph is NASA’s public-domain portrait of Eileen Collins, reduced to 256 × 256 pixels. [Photograph and provenance](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut)

`npm run calibrate` draws a sheet of each zone label at its lowest and highest level (built labels with pitched and with flat roofs), measures each pen's coverage over the middle of it, and prints the `MATERIALS` table for `src/image-tone.ts`, which zoning matches the image against and the predictor lays on the town. Run it after a drawing change that alters what a zone lays down, paste the table in, and check the likeness lab. It measures 1:1000, 1:2500, 1:5000 and 1:8000 (or `--scales`) at one tilt (`--tilt`, 40° by default); the table holds 25°, 40° and 55°, and materials interpolate in log(scale) and in tilt. `--fit` instead fits the table to towns drawn from the test pictures by least squares, with the swatches as the prior: a check that zones lay down in a real town what they lay down alone (at M5 they did, to within a few per cent).

## The floorplan lab

`npm run floorplans` reads the footprints of the adjacency lab's 60 places (labelled the same way, from the same cache) and learns the plans each built zone builds. Each footprint is turned square to the nearest street within 45 m, straightened into a plan whose walls all run along or across the street (one leaning more than 12° over a tenth of its outline is left out, and jogs under 0.8 m are folded away), and scaled into a unit box with the street side at the bottom. Plans are snapped to an 8 × 8 grid and mirrored to one hand, so the same L from many towns counts as one. Row zones (rows, old, blocks) learn only from houses with party walls on both sides, the rest from every footprint above a size that leaves out sheds. Each place counts the same within a zone, and a plan must turn up in three places to be kept. A contact sheet of each zone's plans goes to `lab/out/floorplans/plans.svg` and `.png`: check it by eye after changing the lab. `--places a,b` reads some places only.

`--write` writes the commonest plans of each zone, up to 40, to `src/image-floorplan-data.ts`. The plain box keeps its own share and the kept plans are scaled up to stand for the rarer ones. Accepted at 60 places: the plain box is 53% of suburban houses, 62% of terraced houses, 61% of old-town houses, 60% of houses in perimeter blocks, 45% of towers and 51% of works halls. Across the likeness lab's 32 drawings, the learnt plans took mean likeness from 50.8 to 51.1.

## The junction lab

`npm run junctions` reads the adjacency lab's 60 places and 20 town edges, new towns and suburbs (`lab/junction-places.ts`), since real roundabouts cluster on the outskirts and centres alone would teach image mode to leave them out. Junctions come from the tiles: vertices where three or more road arms meet, with the vertices of one junction within 14 m clustered into one, keyed by the classes of their two busiest arms, their arms (three, or four and more), and the zone the adjacency lab labels round them. Tiles carry no junction tags, so what controls each comes from OpenStreetMap through Overpass, one query per place, cached in `lab/.cache` with the tiles: `junction=roundabout` and `circular` ways (joined into rings, each a junction whose arms are the roads crossing a circle 8 m outside it), `highway=traffic_signals` nodes within 22 m of a junction's middle, and `highway=crossing` nodes, marked or not, with or without signals, at a junction (within 30 m of its middle or of a roundabout's ring) or between junctions.

`--write` writes the tables to `src/image-junction-data.ts`: for each style with 3 places and 300 junctions of its own, and pooled. Each cell is smoothed towards the one above it with the weight of 12 junctions: a zone's towards the key over all zones, and a style's towards the pooled cell with its odds scaled by how much more or less given to roundabouts or signals the style is overall. `--places a,b` reads some places only, without writing. Accepted at 80 places: 10,311 junctions, 2.5% of them roundabouts and 18% of the rest with signals. Styles differ as they do on the ground: suburban crossings of main roads are roundabouts 34% of the time in the Mediterranean style, 21% in the British and 3% in the Central European; quiet four-way suburban crossroads are mini-roundabouts 58% of the time in the Australian style; and the North American style puts signals at 74% of suburban crossings of main roads, against 27% in the Dutch. Town centres alone gave 1.1% roundabouts, which is why the town edges were added. In the likeness lab's 32 drawings, the junctions left mean likeness at 51.1. OSM maps crossings unevenly (Bibury and Almere Haven have none mapped), so crossing rates are a floor.

## The adjacency lab

`npm run adjacency` reads 60 real places (`lab/adjacency-places.ts`: old towns, perimeter-block cities, tower cores, suburbs, terraces, villages, ports and shores, across the regions) through the usual tile loader, cached in `lab/.cache` like the LOD lab. It labels each place's ground with image mode's zone labels on an 8 m grid and counts which labels border which. Open land comes from the map's water, woods, cover, parks and squares. Built land comes from the buildings within 40 m after `classify()`: coverage, footprint size, height, party walls, kind, and how regular the streets are. Freestanding buildings never make an old town. Where dense land shows few party walls, the map has drawn whole blocks as one footprint, so size doesn't count there. The plan is then cleaned to image-mode zone sizes. Label maps go to `lab/out/adjacency/` as PNGs. Check them by eye after changing the labelling (`--places a,b` labels some places only, and `--stats` prints what the buildings round each place look like).

`--write` writes the counts to `src/image-adjacency-data.ts`. `--table` prints the learnt costs beside the hand-made ones. `--eval` cross-validates, leaving one place out at a time: it scores how well each table predicts the label across each real border of the place left out (nats per border, higher is better). Accepted at 60 places: chance −2.169, hand-made −2.066, learnt −1.979, with the learnt table ahead for every kind of place. `--eval --grid` repeats this over the `LEARN` options. The likeness lab's `--neighbours` sets the slider, and its *borders as real towns* score shows how typical the borders of the laid-out plan are.
