# Image mode: plan

**Status (2026-11-17):** M0 (plumbing), M1 (reading and zoning), M2 (water and streets), M3 (blocks, parcels and buildings), M4 (ground and trees) and M5 (calibration and the predictor; tuning is built but off, see its notes) are built on the `image-mode` branch; M6 is next. Decisions that are yours to make are in §20. Each has a recommendation, and the plan assumes it until you say otherwise.

**Notes from M0.** The crude town orders its blocks by the ink each actually lays down, not as §19 first had it: paved squares where the image is lightest, then water (lake ripples are nearly as light as paper), then parks, then houses, packed closer and taller where it is darker. Putting water in the darkest parts inverted the tone (the lab scored the disc at −88). `Target` carries a pen-free `tone` (0–1) beside OKLab, and the layout reads only that, so pens can't move a street even by rounding. Auto levels stretch a nearly flat picture less and keep how light it is. Colour, Likeness and Street pattern are settings already, but only Colour is in the panel, since it is the only one that changes anything yet (the score).

**Notes from M1.**
- *Materials are measured, not guessed.* The hand estimates were far off: the renderer's squares are among the darker ground (streets, fountains, people), woods are light (about 0.21 greenery), and a block with one or two towers on open ground is light, not the darkest thing. `npm run calibrate` (the first step of §7.3, at one scale and tilt) draws a sheet of each label and measures it; `MATERIALS` holds the result. Ground labels don't vary with level yet.
- *Pens and structure.* A material's lightness depends on the pens even with Colour at 0, so in tone-only mode (Colour 0, or one pen) zoning compares through a black pen on white paper, and the pens then never move a street. With colour on, the structure key includes the pens, as §15.1 says.
- *Gamut.* §6 step 4 is left for M6. Under Classic nothing reachable is a dark green or a dark blue, so lightness decides there: dark greens become built land, not woods. Explicit trees (M4) and tuning (M5) give greens more weight.
- *Priors that matter.* Sand is only allowed within two superpixels of water, checked after ICM and again after merging, since ICM otherwise invents puddles to justify beaches. The urban gradient (old town, blocks and towers dearer away from the cores) had to be strong to show at all; it also raised likeness. The town is still laid out on M0's street grid, each block taking the zone that covers most of it, with a simple generator per label; streets skip water, woods, fields, meadows, sand and parks.
- *Sizes.* Superpixels are a parcel (24 m) or 5 mm on paper, whichever is larger, which keeps zoning near 300 ms even at A3 1:5000.
- *A shared check.* Planning moves ink by a hair at each join; dense old-town rows make tens of thousands of joins, so `sheetChecks()` now bounds the change per join (2 × 10⁻⁴ mm) as well as as a share of the ink.

**Notes from M2.**
- *Buildings before blocks.* Once streets stop being a grid, buildings need somewhere to stand before M3's blocks and parcels exist, so M2 sets them along both sides of every street by the zone they stand in (rows that share walls, perimeter rows, houses in gardens, towers on open ground, halls with yards), kept off roads and each other by an occupancy raster. M3 replaces this with §11's blocks and parcels. At coarse scales row plots are at least 1.4 mm on paper, so a town stays under the 30,000-building cap.
- *Sand is no longer an ICM label.* It invented puddles to lie beside (a checkerboard of sand and water in light areas). Open ground along water of at least 0.5 ha turns to sand afterwards, where sand suits the image better.
- *Water one superpixel wide is opened away*, unless the image draws its banks (strong edges along it): a chain of water along a smooth band of tone is no river. Zone outlines are smoothed over 8 m before tracing, so they don't ripple along the superpixels' honeycomb.
- *The organic field* takes the image's orientation where it is clear (coherence over 0.3); elsewhere a slowly wandering, map-fixed orientation, leaning towards radials and rings round a core only from 120 m out, so streets never meet in a star at the core. So the seed now changes streets, as §3 rule 5 allows.
- *Calibration at four scales.* The single 1:2500 table made coarse scales much too light (old town gets darker per square millimetre as scale coarsens). `npm run calibrate` now measures 1:1000–1:8000 and materials interpolate in log(scale); only the tilt waits for M5.
- *Done criteria.* The street rules hold for every lab picture at every scale (the lab reports any breach), and the networks read as towns: rings and radials round a core, terraces following curves, cul-de-sacs with turning circles, main roads crossing. Against M1, 17 of 24 lab cases score higher (by up to 30 points); the regressions are at 1:1000 (gradient, bands and landscape, −3 to −4) and 1:8000 (cross −14, stripes −10, disc −6), where M1's grid of perimeter blocks happened to lay down more ink.
- *Time.* At A3 1:2500 the structure (zoning and layout) takes about 750 ms, twice §4's budget; at 1:8000 up to 1.8 s. It is cached, so only changes to the image, view or structure settings pay it. Not yet done: promenades along shores and tracks between fields (M4's field parcels), §10.5's smallest block size (needs M3's blocks), and bridge length and spacing limits beyond what the main roads' cost already gives.

**Notes from M3.**
- *Blocks.* Faces of the street graph after pruning dead ends (a face running up a cul-de-sac and back can't be inset), each inset by half its streets' widths and a 2.5 m pavement; a face that folds is simplified more coarsely and tried again. The block takes the built zone over most of it; lots whose front or back isn't built land are dropped, so parks and woods inside a block stay open.
- *One subdivision for every zone.* Suburbs, works and towers are cut as strips too, only deeper (28–40 m, 45–80 m, 40–70 m), not by oriented-box splits: every lot then fronts a street by construction, and the ground behind a suburban strip is back garden. Corners eat the back of a strip, so the cuts nearest a corner fall where the corner's reach ends, and the two lots meeting at a corner merge into one that spans it, which gives terraces L-shaped corner houses and suburbs square corner plots.
- *Party walls are exact.* Lots on a side share their cut lines, and rows are cut at fractions of the block's depth, the same on every lot, so neighbours share their corners exactly and `classify()` finds the party walls (over 85% of terraced houses have one in the landscape test).
- *Streets the blocks don't reach* (dead ends, the outer edge of the network, blocks too awkward to inset) still get M2's buildings along them, as a gap filler.
- *Plausibility is enforced, not just checked.* `image-check.ts` holds the rules (no footprint on a road, water, a park, a wood, a square or another building, tested 0.6 m inside each outline so shared walls don't count; every building within 90 m of a street), and laying out refuses any footprint that breaks them, so `plausibility()` (re-exported from `image.ts`) is clean in every lab case. An occupancy raster does the quick work; open land on it marks every cell its outline crosses.
- *Closed street chains are split in two.* The renderer takes a closed loop of road under 3,000 m² for a roundabout and plants its middle, which put houses in a park.
- *Landmarks.* Squares of 600 m² or more are rare (most plazas are turning circles), so a church goes beside each one in town and also in every 500 m parish of built town without one within 350 m; the town hall stands beside the largest square with lots near it, or else nearest the middle of the main core, flying its flag; a school (with a pitch in the park, clear of its paths) beside parks of a hectare or more in suburbs and rows. Courtyards stay plain and get no trees until tuning (M5) and `Town.trees` (M4).
- *Results.* Against M2 the likeness moves by −2.3 to +1.6 (the lots change little of the tone); the drawings gain corner houses, sheds, L-shaped houses, churches, town halls and a school with its pitch. Structure at A3 1:2500 is about 1 s (M2: 750 ms), up to 2.6 s at 1:8000.

**Notes from M4.**
- *Ground lives in `image-ground.ts`:* the open land from the zones' outlines, and land use under the buildings, as M2 had it, now with the patchwork and trees below. Water textures stay as M2 sorts them (lake, river, sea); turning a lake into sea where the image is darker is tuning's (M5), as are orchards and village greens.
- *Fields are a patchwork.* Each field zone is laid out in strips 70–150 m wide along its length, each strip cut into parcels of its own lengths (staggered boundaries), and 30% of parcels are cut shorter than the strip is wide, so `ground.ts`, which furrows each parcel along its longer side, turns their furrows across. Pieces under 0.25 ha become meadow. Half the strip boundaries carry a farm track. The renderer's own ploughed and stubble draw, edges and hedgerows do the rest.
- *Allotments come in sites* of about a hectare, cut the same way, with footpaths between. One endless grid of plots was hectares across.
- *No patch beyond belief.* Calibrated at 1:8000, allotments lay down nearly half the paper in green, so zoning used them as its darkest green and turned half the landscape into allotments; and the gradient at 1:5000 had a 155 ha square. Zoning now caps allotments at 5 ha and squares at 2 ha (three times that at full likeness), keeping the part round where each suits the image best and giving the rest its next best label. The landscape at 1:8000 loses 9.8 points of likeness for it: its dark greens have nothing truthful to become until tuning gives woods and trees more weight (M5) and colour arrives (M6).
- *`Town.trees`* carries trees image mode plants itself; `render()` adds them after `placeTrees()` as `image-trees`, only while Trees is on, and the catalogue claims them. M4 plants big trees in the courtyards of perimeter blocks (`blocks` from 2,000 m², rows and old town from 600 m²) and broadleaf trees and dark conifers round churchyards, each on a map-fixed jittered grid, clear of buildings, roads and water by its crown; `plausibility()` checks trees too. Trees where the image wants more green are tuning's (§13.4).
- *Churchyards:* a church whose lot is more than twice its footprint stands in a `cemetery` land use, which the renderer fills with headstones.
- *Landmarks that always land.* Landmark lots are chosen only on ground that shows and that a lot may take; churches prefer lots with a straight front, try a smaller nave or a chapel, and in a row on a bend take the row's own strip; town halls try smaller sizes. Every lab case now has a town hall and churches.
- *Recalibrated* with M3's lots and M4's ground (`npm run calibrate`). Against M3, 12 of 24 lab cases score higher (stripes at 1:2500 and 1:8000 by 8.7 and 14.6) and 9 lower, by up to 3.7 except the landscape at 1:8000. Structure at A3 1:2500 is about 1 s, up to 2.4 s at 1:8000.

**Notes from M5.**
- *Tuning gains nothing, so drawings don't run it.* `image-tune.ts` has §14's loop: rows of terraces and other lots move level and roof, by sweeps, against a predictor blurred to arm's length, with a realism cost weighted by 1 − Likeness. Across the 24 lab cases it changed likeness by −0.3 to +1.0 and cost about 250 ms, so `imageScene()` builds untuned; `imageBuild(…, tuned)` keeps it for experiments, with a hook (`seenBefore`) for §14.3's Refine.
- *Why.* The predictor is §7's materials laid on a grid of about a millimetre over the town as built (not §7.2's prisms), and it agrees with the target to within 0.004 in L once zoning is done: there is nothing left for it to tune. The drawing departs from it by 0.038 in L at arm's length and still 0.022 at 6 mm, region by region, both ways. Three experiments say that departure is how the layout falls, not a wrong tone model: least-squares fitting the materials to real drawings (`npm run calibrate -- --fit`) changed them by a few per cent; tuning fed the real drawing as its predictor gained +0.1; and zoning again against the real drawing's error made it worse (62.8 → 53.7 for the gradient), because a new layout falls differently. Lots also cover only about a sixth of the ground; streets, courtyards and the gap-filling rows the rest.
- *The image's black stays at 0.55 coverage of black.* Mapping it instead to the darkest material the town reaches at the scale (L about 0.84 at 1:2500, 0.87 at 1:1000) changes what the score measures, and the drawings followed the image less: the lab's new *follows* figure (the correlation of the drawing's lightness with the image's across the room, which doesn't depend on the target's range) fell from 0.760 to 0.699. So the darkest images stay out of reach at fine scales: the cross's grey comes out 0.058 lighter than asked, nearly all of its error.
- *What did help is structure.* Built land too narrow to build on is opened away in zoning (towers need 50 m, works 40 m, blocks 28 m, suburbs 22 m, rows and old town 14 m): the stripes at 1:1000 had been zoned as towers too narrow for any tower and drawn almost bare since M2. The old town's quiet streets are lanes (the `service` class, 5 m with a metre's margin) wherever the renderer draws them that narrow, i.e. down to about 1:6000; that darkens the old town a little and reads as one. Denser rows stand on deeper plots, with a back building behind a yard where one fits, which in practice is seldom.
- *Calibration covers tilt.* `MATERIALS` holds 25°, 40° and 55°, each at four scales, interpolated in tilt and log(scale): the tilted stripes golden gained 0.048 from it. The calibration guard (§18.2) checks the predictor against every image golden: total ink within 20%, each pen within 50% (or 2 points), looser than §7.3's 10% because how much roof and how much wall shows depends on which way rows run, which the uniform swatches average over. Each golden also has a likeness floor.
- *Results.* Mean lab likeness is unchanged against M4 (55.0); the image goldens gain on average (gradient 0.642 → 0.659, stripes 0.456 → 0.504, cross 0.721 → 0.733). Single cases swing by several points between nearly equal setups, which is the size of the layout's noise, so the lab's mean and the *follows* figure are the yardsticks to trust. The done criterion of M5 (tuning clearly raising likeness) is not met; what could meet it is a predictor of the actual geometry with much stronger moves, or structure that follows the image more closely still (streets kept out of dark areas, finer grain where it is dark).

In image mode the user gives the app an image instead of a place. The app lays out a town of its own, using no map data at all, so that the finished drawing, seen from a little way off, looks like the image: light where the image is light, dark where it is dark, and as close to its colours as the five pens allow. Close up, it must still be a town that could exist: streets that join up and lead somewhere, houses that face them with gardens behind, squares, parks with paths, woods and fields at the edge, water with banks and bridges.

The two aims pull against each other. Getting the tone right is a halftoning problem. Getting the town right is procedural city generation. This plan does both by building the town in stages, from large structure to small detail. Each stage follows the image only as far as the rules that keep the town believable allow. A **Likeness** slider sets how far the image may bend those rules.

Read [architecture.md](../architecture.md), [render-pipeline.md](../render-pipeline.md), [coordinates.md](../coordinates.md) and [lod.md](../lod.md) first.

**Contents:** 1 What the mode is · 2 A town is a halftone · 3 Rules the mode keeps · 4 How it fits the pipeline · 5 Settings, storage and messages · 6 Reading the image · 7 Tone model and calibration · 8 Zoning · 9 Water · 10 Streets and paths · 11 Blocks and parcels · 12 Buildings · 13 Ground, green and trees · 14 Tuning · 15 Colour and pens · 16 Interface · 17 Changes to existing code · 18 Testing and the likeness lab · 19 Milestones · 20 Decisions for you · 21 Risks · 22 References

---

## 1. What the mode is

- **A second source.** A Map | Image switch heads the first panel section. In Image, the place search and locator map make way for an image well. Everything else (View, Town, Light, Title, Sheet, Pens, Seed) works as before.
- **One renderer.** Image mode is a new way to get a `Town`. In the worker, `imageTown()` takes the place of `loadTown()` and `loadTags()`. `classify()`, `render()`, `plan()` and `toSvg()` run unchanged. Every feature the renderer draws (windows, roof shapes, shadows, cars, people, boats, fences, field textures) comes for free, and so does every later improvement to them.
- **The image is pinned to the sheet.** It fills the drawing area (`cam.rect`). Scale sets how many metres the image spans, so it works like the screen ruling of a halftone: a coarser scale fits more houses under the image and resolves finer detail. Rotation turns the town under the image, and Tilt changes how the town is seen. Both lay the town out afresh, because the image stays where it is on the sheet.
- **No network.** Image mode fetches nothing: no tiles, no Overpass, no Nominatim, no country lookup.
- **Likeness against realism.** One slider (§14.4) trades a closer match for a more ordinary town.

**Not in the first version:** railways, motorways, airfields, lifts and power lines (the image can't suggest where they'd run; M8 in §19 adds some later), terrain, legible text or faces at close scales (the town can't resolve them, §21), and physical ink mixing beyond the simple model in §2.3.

---

## 2. A town is a halftone

### 2.1 Every kind of ground and building has a tone and a colour

A plotter drawing has no fills. What reads as light or dark from a step away is how much of each square millimetre is covered by ink, and in which pens. Every feature lays down its own typical amount:

| From light… | Ink | Pens |
| --- | --- | --- |
| Squares, wide roads, car parks | kerb lines only | `LINEWORK` |
| Beaches and sand | stipple | `LINEWORK` |
| Flat-roofed halls | outlines, rooftop boxes, a few window bands | `LINEWORK`, `SHADOWS` on shaded walls |
| Meadows, lawns | tufts | `GREENERY` |
| Lakes | fine calm ripples | `WATER` |
| Fields | furrows 1.8–2.6 mm apart | `GREENERY` |
| Parks | hatch at `cam.gap(1.8)`, a few trees | `GREENERY` |
| Sea | broad crests | `WATER` |
| Suburbs | houses, gardens, garden trees, fences | `ROOFS`, `GREENERY`, `LINEWORK`, `SHADOWS` |
| Terraced rows | pitched roofs, windows, short shadows | `ROOFS`, `LINEWORK`, `SHADOWS` |
| Woods | overlapping crowns | `GREENERY` |
| Packed old towns | roof hatching everywhere, shaded walls, shadow in narrow streets | `ROOFS`, `LINEWORK`, `SHADOWS` |
| …to dark: towers and slabs | window grids, shaded walls, long cast shadows | `LINEWORK`, `SHADOWS` |

The range of the current renderer, measured over whole sheets in the LOD lab (`lab/out/final-today`: 14 places at 1:500–1:8000): mean ink coverage runs from 0.08 (Zürich Airport at 1:500) to 0.52 (Amsterdam at 1:8000). A packed old town (Nördlingen) sits at 0.33–0.37 at every scale. The lab counts a 1 mm cell as solid from 65% coverage, and scores ink laid there as wasted. So the darkest *believable* tone over a district is roughly 0.5–0.6 coverage. The image's black has to be mapped there, not to solid ink (§6, step 3).

### 2.2 Tone by the parcel, edges by the line

The smallest unit whose tone the planner can set freely is about one parcel: a house with its garden, or a slice of a row. Edges are different. A park boundary, a shore, a kerb or the edge of a shadow can follow any curve to a fraction of a millimetre.

| Scale | A3 drawing area across | A 10 m house on paper | Tone cells across (about one parcel each) |
| --- | --- | --- | --- |
| 1:1000 | 380 m | 10 mm | 20 |
| 1:2000 | 760 m | 5 mm | 40 |
| 1:4000 | 1.5 km | 2.5 mm | 75 (windows have gone, small buildings thin out) |
| 1:8000 | 3 km | 1.25 mm | 40, by the block, as small buildings drop out |

So the plan puts **tone into parcels and edges into lines**: strong edges in the image become streets, shores, park and wood edges, hedges and tree rows (§8, §10). The best range is 1:2000–1:4000. Image mode starts at 1:2500, and the Scale hint shows the tone resolution (§16.1).

### 2.3 Colour is a mix of pens

At viewing distance, a patch of paper with pen coverages `c₀…c₄` looks like this, per linear-RGB channel, if strokes overlap independently:

```
R = R_paper · Π_i (1 − c_i + c_i · R_pen_i / R_paper)
```

At small coverages this is the familiar area-weighted mix. Where strokes cross, it darkens multiplicatively. Real inks, paper and nibs vary, so this is an approximation. It is good enough to rank materials against each other, and nothing depends on its absolute accuracy: the likeness lab (§18.3) compares the drawing with the image through the same model.

Three things follow:

- **There are few reachable colours.** They lie between the paper and each pen, along the curves of the materials that use that pen. Nothing is lighter than paper, and nothing is much more saturated than a pen at 40% coverage. Colours are mapped into that gamut first (§6, step 4).
- **Mixtures make the hues in between.** Red roofs among green trees read as olive or brown, and roof hatching over slate shadows as plum. The planner reaches hues no single pen has by mixing materials within a parcel or a block, as a pointillist would.
- **The palette sets the gamut.** With Classic, the image's blues become water or (dark slate) shadow, its greens parks and woods, and its reds pitched roofs. Its yellows have no good match. **Pens from image** (§15.2) picks pens to suit the image instead.

### 2.4 The image lives on the sheet, the town on the ground

The camera is oblique. Ground features show at `cam.sy(x, y, 0)`. A building of height `h` rises `h · cos(tilt) · cam.s` mm up the sheet from its footprint, hides what stands behind it, and casts a shadow away from the sun. So a dark patch in the image is best made by tall buildings whose footprints stand *below* it on the sheet. Likeness is judged on the sheet, and structure is built on the ground. The tone model (§7) connects the two: it predicts the sheet from the town, with occlusion and shadows, and tuning (§14) corrects the town from the error on the sheet.

### 2.5 A worked example

Take a landscape photo: blue sky across the top third, a green hillside, a red-roofed village at the bottom right, a pale road curving through. Through the camera, the top of the sheet is the far side of the town. The pale, bluish sky becomes a lake with calm ripples along the far shore, and the shoreline becomes a promenade. The hillside becomes fields and meadow, darkening into a wood along its darker ridge, with a farm track along the edge. The village becomes a packed old town of pitched roofs round a small square with a church (§12.4). The pale road becomes the main road, crossing the fields into the village. Suburban houses with gardens fill the mid-tones between village and fields, as a real town grows outwards.

---

## 3. Rules the mode keeps

Each rule is checked by a test (§18).

1. **Map mode is unchanged.** With `source: 'map'`, every existing golden stays byte-identical. Image code runs, consumes hashes and fills masks only in image mode.
2. **One renderer.** Image mode only makes a `Town`. It steers `classify()` through the evidence `classify()` already reads (§12.3), not through special cases in drawing code. It adds three small hooks, all inert in map mode: explicit trees (§13.4), image-made tags that don't count as OSM tags (§12.3), and the margin text (§16.4).
3. **No network.** Nothing in image mode fetches. The test fetch stub throws on any call.
4. **Deterministic.** The same image (by content), settings and seed give the same SVG. There is no `Math.random()`. Hashes use a fixed fictional `Frame` (§5.2) and salts from a reserved range, 14000–14999. LOD fades keep 9100 and up, and grep before taking any salt.
5. **Structure is stable.** Planning has two stages (§4). The *structure* (zones, water, streets, blocks, parcels) depends only on the image and its adjustments, the geometry (sheet, margin, scale, rotation, tilt), the style, Likeness, the street pattern and the seed. The *tuning* (heights, roofs, coverage, trees, ground materials) also depends on what changes tone: Detail, pen width, pens, sun, Shadows, Shade walls, Trees, Cars and the layer switches. Changing Detail or a pen re-tunes the town but never moves a street.
6. **Believable beats like.** The rules in §10.5 and §11.4 are hard constraints. Likeness only weighs the soft costs.
7. **Pass order holds.** Image mode adds no pass to `render()`. Pen colours are the one exception to AGENTS.md rule 6, and only in image mode (§15.1).

---

## 4. How it fits the pipeline

```
Main thread                                       Worker
───────────                                       ──────
file ─► decode, orient, downscale (≤ 1024 px)     Job { draw, set, picture? }
     ─► Picture { id, name, w, h, rgba }  ──────► picture cache (last 2, by id)
     ─► kept in Cache Storage (§5.3)                  │
                                                      ▼
                                                 readImage()  → Target   sheet grid: OKLab, edges, orientation
                                                 zone()       → Zones    ground grid: labels and levels      ┐
                                                 water()      → lakes, rivers, streams                       │ structure,
                                                 streets()    → street graph, paths, plazas                  │ cached by the
                                                 blocks()     → blocks and parcels                           ┘ structure key
                                                 tune()       → lots: kind, storeys, roof, cover, trees      ] cached by the tuning key
                                                 toTown()     → Town
                                                      │
                                                 classify() → render() → plan() → toSvg()   (unchanged)
```

- **Where it runs.** `worker.ts` branches on `set.source`. In image mode it skips `detectRegion()`, `loadTown()` and `loadTags()`, works out the drawn-as settings (§5.2), and calls `imageTown(picture, drawn, cam, box)` with the same `box = cam.region(reachHeight(set))`.
- **Progress.** In image mode the `map` stage reads *Laying out the town*, with a note per step (*Reading the image*, *Laying out streets*, *Dividing blocks*, *Matching tone*). A stage of its own, with an icon, can come later.
- **Caching.** As `assembled` does in `tiles.ts`, the worker keeps the last structure and the last tuned `Town` by key, and hands `render()` a `structuredClone`, because `classify()` writes into buildings. A pen change re-tunes (§15.1) but never re-zones. A Humanize change reuses the tuned town and only redraws.
- **Beyond the drawing area.** The town fills the whole `box`, plus a 60 m margin of buildings marked `context` (as `BUILDING_PAD` does for tiles). Density, terraces and `Town.nearby` then look the same at the sheet's edge as in its middle. Streets run off the sheet, as in a real town. Where there is no image (Fit's margins, transparent pixels), the target has no weight. There the planner follows its priors alone and grows ordinary town or countryside on from the neighbouring zones.
- **Budgets**, for A3 at 1:2500 on a mid-range laptop: reading the image ≤ 150 ms, zoning ≤ 200 ms, structure ≤ 400 ms and tuning ≤ 600 ms. That adds about 1.3 s to the 0.5–1.5 s the render takes. The likeness lab reports the time of each step (§18.3).

---

## 5. Settings, storage and messages

### 5.1 Settings

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `source` | `'map' \| 'image'` | `'map'` | Where the town comes from. |
| `image` | `string` | `''` | Content id of the stored image (§5.3). |
| `imageName` | `string` | `''` | Name for the title block and margin, from the file name. It can be edited in the title block, like the place name. |
| `imageFit` | `'fill' \| 'fit'` | `'fill'` | Fill crops the image to the drawing area. Fit shows all of it, with free ground beside it. |
| `imageFocus` | `[number, number]` | `[0.5, 0.5]` | Middle of the crop in Fill, as fractions of the image. |
| `imageLight` | `number`, −1…1 | `0` | Brightness, as a shift of the tone curve. |
| `imageContrast` | `number`, 0.5…2 | `1` | Contrast round the middle tone. |
| `imageColour` | `number`, 0…1 | `0.7` | How much colour counts against tone. At 0 only lightness is matched, as in one-pen output. |
| `likeness` | `number`, 0…1 | `0.6` | Likeness against realism (§14.4). |
| `fabric` | `'auto' \| 'organic' \| 'grid'` | `'auto'` | Street pattern. Auto picks grid for the North American and Australian styles and organic elsewhere. |

- Add the numbers to `NumberKey`, with `FORMAT` entries. Handle `source`, `fabric` and `imageFit` in `shared()`/`fromQuery()` the way `style` is handled, and encode `imageFocus` the way `center` is. Validate all of them in `loadSettings()`.
- None of them goes in `VIEW_KEYS`, because image mode has no locator map. All the image keys are structure keys (§3, rule 5).
- **Defaults on first switching to Image:** scale 1:2500, tilt 40° (a higher view shifts less of the image up the sheet), power lines off and the title off. They are applied the way a preset's `extra` is applied in `goTo()`, and only to settings the user hasn't changed. Switching back to Map finds the map place untouched.

### 5.2 Drawn-as settings and the fictional place

`set.center`, `set.place` and `set.osmTags` keep the map-mode place, so switching back loses nothing. The worker draws with derived settings instead:

```ts
/** The settings an image-mode drawing is made with: a fictional place for the style, and no OSM tags. */
export function drawnAs(set: Settings): Settings {
  const style = set.style === 'auto' ? IMAGE_STYLE : set.style;
  return { ...set, center: STYLE_PLACE[style], place: set.imageName || 'Image', osmTags: false };
}
```

- `STYLE_PLACE` gives each style a nominal centre. Only its latitude matters: Alpine 47° N, Nordic 60° N, Mediterranean 40° N, Tropical 8° N, Australian and New Zealand 34° S, and so on. Through `set.center` it sets the sun (`sunBearing()`), the equator side that gets more windows, and the palms (`regionalTrees()`), so these follow the style. `Frame` is built from it as usual, so `B.key` and `B.cell` work unchanged.
- `IMAGE_STYLE` (`'central'`) stands in for `auto`. The style picker in the Town section works as usual.
- The `Region` is `{ country: 'Image', code: '', style, left }`, with `left` true for the British and the Australian and New Zealand styles.

### 5.3 Storing the image

- **Normalised on the main thread** (`src/app/image-store.ts`): `createImageBitmap(file, { imageOrientation: 'from-image' })`, drawn on an `OffscreenCanvas` at most 1024 px on its long side, then read back as RGBA. Alpha is kept, and transparent pixels carry no target. The id is the first 16 hex digits of the SHA-256 of the normalised pixels, so the same picture gets the same id however it arrives.
- **Kept** in Cache Storage under `${LOCAL}image/<id>`, in a new store (`IMAGES`, 8 entries, pruned oldest first). This reuses `netcache.ts`'s storage and its fallbacks: without Cache Storage, the image lasts as long as the tab.
- **Formats:** whatever the browser decodes: PNG, JPEG, WebP, GIF (first frame), and AVIF where supported. HEIC usually isn't, and the image well says so in plain words.
- The type is called `Picture`, not `Image`, so it doesn't clash with the DOM's `Image` and `ImageData`.

### 5.4 The worker job

```ts
export type Picture = { id: string; name: string; w: number; h: number; rgba: Uint8ClampedArray };
export type Job = { kind: 'draw'; id: number; set: Settings; picture?: Picture } | …;
```

The `Renderer` sends `picture` (as a transferred copy) only when the worker hasn't seen that id. The worker keeps the last two. If a job names an id the worker lacks, it replies with an `error` that the UI shows as *Choose the image again*.

### 5.5 Share links

Links carry every image setting, the image id included, but not the image. The receiving browser can redraw the drawing only if it has that image stored. Otherwise the image well says *This drawing was made from an image that isn't stored in this browser* and offers to choose one. The image itself can't go in the URL: even 64 × 48 pixels would make links unwieldy.

---

## 6. Reading the image (`image-read.ts`)

`readImage(picture, set, cam) → Target`, on a grid over `cam.rect` with 0.5 mm cells (A3: 760 × 486).

```ts
/** What the drawing should look like, over the drawing area: sheet mm, y down. */
export type Target = {
  x0: number; y0: number; cell: number; W: number; H: number;
  L: Float32Array; a: Float32Array; b: Float32Array; // OKLab, after the tone curve and gamut mapping
  weight: Float32Array;     // 0 where there is no image (Fit's margins, transparent pixels)
  edge: Float32Array;       // edge strength, 0–1
  dir: Float32Array;        // main orientation on the sheet, radians, from the structure tensor
  coherence: Float32Array;  // how strongly oriented, 0–1
  ridge: Int8Array;         // thin bright (+1) or dark (−1) lines
};
```

1. **Fit.** `fitImage(rect, w, h, fit, focus)` maps sheet mm to image pixels. It lives in a small module with no drawing imports, so the preview overlay (§16.2) uses the same mapping. Sampling is bilinear, with a box prefilter where the image is reduced.
2. **Colour space.** sRGB → linear → OKLab. culori is already a dependency, but write the conversion inline for the hot loop.
3. **Tone curve.** Auto levels from the 1st and 99th percentiles of L, then Contrast round the median and Brightness as a gamma shift. L is then mapped *into the drawing's range*: from paper (the paper colour's L) down to the darkest believable material at these settings, which is about 0.5–0.6 coverage of the darkest pens (§2.1, §7). The curve has a soft knee, so the shadows compress gracefully instead of clipping.
4. **Gamut mapping.** For each target L, the reachable chroma in each hue direction comes from the material colours under the current pens (§7). Colours outside the gamut are pulled towards the neutral axis at constant hue and L, as in CSS Color 4's OKLCH gamut mapping. `imageColour` then scales the chroma that remains, and with it how much colour counts in the costs.
5. **Structure.** Gradients of a lightly blurred L (σ = 1 mm). The structure tensor, smoothed at σ = 4 mm, gives `dir` and `coherence`. `edge` is the gradient magnitude after non-maximum suppression and hysteresis, as in Canny's detector. `ridge` comes from the Hessian's larger eigenvalue at σ = 1–2 mm. Thin bright lines want to be streets and paths, and thin dark ones tree rows, hedges or walls.
6. **Mono.** With `set.mono`, a and b are zeroed and the costs use L alone.

---

## 7. The tone model and calibration (`image-tone.ts`)

### 7.1 Materials

Zoning and tuning choose between **materials**. A material is one of the labels of §8 with a level from 0 to 1 (how densely it is built, planted or drawn) and, for built labels, a warmth from 0 to 1 (the share of pitched roofs). For each material, the model gives a pen-coverage vector `c ∈ [0, 1]⁵` per unit of sheet area, which §2.3 turns into a colour with the current pens. Coverage doesn't depend on the palette, so it can be calibrated once, offline. Colour is mixed at run time.

### 7.2 The predictor

`predict(town, set, cam) → Sheet` gives per-pen coverage on a 1 mm sheet grid, plus an owner id per cell saying which lot or ground piece shows there (like `Picks`). It is a deliberately crude, fast stand-in for `render()`:

- **Ground** pieces lay down their calibrated coverage where they show, projected at z = 0: parks, fields, meadows, lawns, water by kind, plazas, and roads with their kerbs and expected cars.
- **Buildings** are prisms, drawn back to front by depth. The roof takes its roof shape's coverage (hatch in `ROOFS` when pitched, an outline when flat). Walls facing the viewer take their window coverage in `LINEWORK`. Where they face away from the sun, they also take the wall-tone ramp in `SHADOWS`, which runs from −0.2 to −0.7 as [lod.md](../lod.md) describes.
- **Shadows** are the footprint swept away from the sun by `h / tan(sunHeight)`. They lay `SHADOWS` coverage on the ground wherever it shows.
- **Trees** are discs, with outline coverage that follows their radius.
- **Level of detail** comes from the same rules the renderer asks: `shows(cam, LOD.building, …)`, `thin(cam, LOD.treeSpacing, …)` and the window steps. The predictor drops what the renderer would drop.

It must support **local updates** for tuning (§14): it can predict a sheet window again from scratch, using a sheet-space index of the objects whose projected bounds touch it.

### 7.3 Calibration from the tally (`npm run calibrate`)

The renderer already files every stroke under the feature that drew it (`Paper.tally`), so calibration is mostly bookkeeping:

1. For each material and level (5 levels, and warmth 0 and 1 for built labels), lay out a uniform 300 × 300 m patch with the image-mode generators, from a flat target and with tuning off.
2. Render it with the real `render()` at 1:1000, 1:2000, 1:4000 and 1:8000 and tilts of 25°, 40° and 55°, at Detail 1 with a 0.35 mm pen.
3. Rasterise the strokes with the ink raster from `lab/metrics.ts`, extended to keep the pens apart. Measure each pen's coverage over the middle third of the patch, and each feature's ink per unit of area or length.
4. Fit the predictor's constants by least squares: coverage per area for each ground texture, per metre of building outline and kerb, per area of wall for each window step, per area of roof for each roof shape, per tree by radius, and cars per metre of road by class.
5. Write the constants to `src/image-tones.ts`, which is generated and committed, with the date and the commit of the renderer they were measured against.

At run time the table is interpolated in log(scale) and in tilt. **Detail** and **pen width** are applied by rule. Textures spaced with `cam.gap()` gain coverage in proportion to Detail and stay about the same across pen widths. Outlines gain coverage in proportion to pen width. Calibration checks both rules at Detail 0.5 and 2 and with a 0.7 mm pen, and stores a measured correction wherever a rule is more than 5% out.

The renderer will keep changing, so **a test guards the calibration**. For the image test cases, the predictor's coverage per pen over the whole sheet must be within 10% of the real drawing's (§18.2). When a drawing change breaks it, rerun `npm run calibrate` and commit the new table with the change.

A run is about 1,500 swatches (16 labels × 5 levels × 2 warmths for built labels × 4 scales × 3 tilts), at about 0.3 s each, so roughly 8 minutes. It is cached like the LOD lab.

### 7.4 Likeness

`likeness(sheet, target, set) → { score, dE, ssim }` turns coverage into colour (§2.3), blurs it to viewing distance with a Gaussian, and compares it in OKLab with the target blurred the same way, weighted by `target.weight`. Lightness counts fully and chroma by `imageColour`. Two blurs are measured: σ = 1.2 mm for arm's length and σ = 3 mm for across the room. SSIM on L at the larger blur catches structure that a mean ΔE misses. `score` is 1 − mean ΔE / ΔE₀, where ΔE₀ is the error of a blank sheet: 0 is no better than blank paper, and 1 is a perfect match.

The worker measures likeness on the **real** strokes of every finished drawing (rasterised at 0.25 mm, about 100 ms for A3) and sends it with `done`, for the stats footer (§16.3).

---

## 8. Zoning (`image-zones.ts`)

`zone(target, set, cam) → Zones` makes a land plan on a ground grid in local metres. The grid cell is about 0.5–1 mm on paper and never under 2 m: 2 m to 1:2000, then 4 m, then 8 m.

### 8.1 Labels

| Label | Becomes | Tone and colour (Classic) |
| --- | --- | --- |
| `water` | lake, sea or river, as its shape decides (§9) | light to mid, blue |
| `plaza` | paved square, pedestrian streets | near white |
| `sand` | beach or sand, only on a shore | near white |
| `meadow` | meadow tufts, perhaps a herd | very light, green |
| `field` | farmland: furrows, stubble, tracks, hedgerows | light, green, oriented |
| `park` | park hatch, paths, scattered trees, pitches where bright | light to mid, green |
| `allot` | allotments or orchards in town | mid, green with sheds |
| `wood` | woods | dark, green |
| `works` | halls and yards, flat or sawtooth roofs | light to mid, neutral |
| `suburb` | detached houses in gardens | light to mid, mixed |
| `rows` | terraced rows with back gardens | mid, warm or neutral |
| `old` | packed old town, perimeter rows, narrow streets | mid-dark to dark, warm |
| `blocks` | perimeter apartment blocks round courtyards | mid-dark, neutral |
| `towers` | towers and slabs on open ground | dark, neutral, high contrast |

Each cell gets a label, a **level** from 0 to 1 within the label's range and, for built labels, a **warmth** from 0 to 1.

### 8.2 Costs

- **Data cost.** `D(cell, label)` is the smallest ΔE between the target and `colour(label, level, warmth)` over all levels and warmths, plus the label's priors. The level and warmth that give it become the cell's. The colours come from §7 under the current pens, so with an unusual palette (water in orange) the image's orange can still become water. Ground labels sample the target where their ground shows on the sheet (z = 0). Built labels sample it **lifted** by half the height typical for their level, at `sy − ½ h · cos(tilt) · s`, because that is where their roofs and walls show (§2.4).
- **Priors.** These are soft, and they count for less as Likeness rises. Sand only lies beside water. Fields and meadows prefer the outskirts, and built labels the middle. `towers` prefer the core and need a level near the top of their range. `works` prefer to touch water or the edge of the region. One small but important prior is the **urban gradient**: the town's core or cores are the centroids of the largest dark built masses, and built density should fall away from them, so an inverted gradient (towers at the edge, a suburb in the middle) costs a little. Several cores are allowed, such as a town and a village.
- **Smoothness** between neighbouring cells: `λ · w_edge · compat(label, label′)`. `w_edge = exp(−edge² / σ²)` makes cuts along image edges cheap. `compat` is a small hand-tuned table: a park next to a suburb or a wood next to a field costs little, while towers next to fields or works inside an old town cost a lot. Water next to anything costs little, because shores are where the image's sharpest edges should go. `λ` falls as Likeness rises.

### 8.3 Solving

1. **Superpixels.** SLIC superpixels (Achanta et al. 2012) on the target resampled to the ground, about one per parcel (some 2,500 for A3 at 1:2500). They follow the image's edges, so zone boundaries do too.
2. **Labelling.** A greedy labelling by data cost, then iterated conditional modes (ICM) with the smoothness term, in a fixed order, until no superpixel changes. If zones are still ragged in the lab, add α-expansion moves (Boykov, Veksler and Zabih 2001), which suit the metric parts of `compat`.
3. **Minimum sizes.** A connected component below its label's minimum area merges into whichever neighbour costs least. The minimums scale with Likeness, from 1.5 ha for a park and 3 ha for a wood at full realism to 0.1 ha at full likeness.
4. **Cleaning.** A morphological open and close per label at the grid's scale, so no zone is a single cell wide unless it is water or a plaza meant as a line.
5. **Levels** are smoothed within each zone (σ = one parcel), so tuning starts from a calm plan and adds the detail itself.

---

## 9. Water (`image-water.ts`)

- **Shapes.** Marching squares on each water component, then Douglas–Peucker at half a cell and Chaikin smoothing for natural banks. Inside built zones, banks are simplified harder and straightened into quays.
- **Kind.** A long, thin component is a river: area over perimeter under about 25 m, or a medial-axis width under 40 m. Its skeleton gives a centre line and widths. Narrower than the `LOD.stream` width, it becomes a `Stream`. Otherwise it is a `river` polygon, with its centre line also in `Town.streams` so `surfaceKind()` finds the flow. Compact bodies are lakes. They become `ocean` where they touch the region's edge along more than a third of a side and the target there is open water. Sea crests are darker than lake ripples, which makes the kind a tone lever tuning can pull too (§13.3).
- **Streams.** Thin dark-blue ridges of 25 m or more that don't touch other water become streams or ditches. Rivers run off the sheet or into a lake, never into a field.
- **Pools** are not zoned. Tuning puts them in suburban gardens where the target wants a small bright blue accent (§14.1).
- Water goes into `Town.water` with its `waterCls`, and streams into `Town.streams`.

---

## 10. Streets and paths (`image-streets.ts`)

The street network carries most of the town's believability and most of the image's structure. It is built as a planar graph, from the most important streets to the least.

### 10.1 The street field

A tensor field on the ground grid, after Chen et al., *Interactive Procedural Street Modeling* (2008), blended from:

- **Grid fields**, one orientation per built zone. *Grid* fabric aligns them with the sheet's isometric axes, turned with Rotation. *Organic* fabric takes the image's main orientation in the zone, or a radial field round the core where the image has none.
- **The image field:** the structure tensor resampled to the ground, weighted by `coherence × likeness`, so streets follow the image's contours.
- **Boundary fields** along shores and along the edges of park, wood and field zones, so streets run beside them.

The blend is smoothed (σ ≈ 30 m) to limit curvature. Its major and minor eigenvector fields give the two street directions everywhere.

### 10.2 Main roads first

One to three through roads (`primary` or `secondary`) cross the region from edge to edge, through or beside the cores. Each is a least-cost path on the grid with 16 neighbours. Paths are cheap where they follow the field and run through built land near the core or along a zone boundary. They are dear across water, so they cross at a narrow point by a bridge, and through woods, parks and plazas. Long bright ridges in the image (§6) make a path cheaper still, so a pale road in the image becomes the main road. Each path is smoothed (Chaikin), then simplified. Organic fabric may add a ring road round an `old` core.

### 10.3 Streets from the image

Bright ridges longer than 80 m at full realism, or 30 m at full likeness, are traced into polylines. In built zones they become minor streets, in parks paths, and in fields tracks. They go in before the local streets, so those snap to them.

### 10.4 Local streets

Streamlines of the field are traced in both directions (RK2, 2 m steps) from seeds along the streets already placed, at a spacing set by the zone and its level:

| Zone | Street spacing |
| --- | --- |
| `old` | 35–60 m, organic |
| `rows`, `blocks` | 60–110 m |
| `suburb` | 80–150 m, a few cul-de-sacs |
| `towers` | 100–180 m |
| `works` | 120–250 m, service roads inside |

Tracing stops at another street (snapping to it within 8 m), at the edge of a zone that takes no streets (park, wood, field, plaza, water), when it comes within half the spacing of a parallel street, or at the edge of the region. A street can cross water only by a bridge, at most one per 150 m of shore and no longer than 250 m.

### 10.5 Clean-up and the hard rules

The graph is planarised (split where streets cross) and cleaned until all of these hold:

- One connected network across the region: separate components are joined by the cheapest added link.
- No dead end shorter than 25 m. Suburbs may keep cul-de-sacs, which end in a turning circle drawn as a plaza.
- No edge shorter than 10 m: short edges are collapsed.
- No junction angle under 35°: the offending edge is removed or merged with its neighbour.
- Junctions at least 20 m apart along a street.
- No block under the zone's smallest block size (600 m² in `old`): small blocks are merged with a neighbour by removing their shortest street.

**Classes.** After cleaning, each street is ranked by how many shortest routes between points on the region's edge run along it, which is a sampled betweenness. The top streets are `primary`, then `secondary`, `tertiary` and `minor`, in proportions set per fabric. Driveways and parking aisles are `service`, with `service: 'driveway'` or `'parking_aisle'`. Widths come from `ROAD_WIDTH`. A way that crosses water is split there, and the crossing gets `bridge: true`. Dense `old` cores may get `sub: 'pedestrian'` streets round the main square.

### 10.6 Paths and plazas

- **Paths** (`kind: 'path'`): a loop and one or two crossings in every park over 1 ha, laid along bright ridges where the image has them; a promenade along shores in town; cut-throughs across blocks over 2 ha; and `track`s between field parcels. Their dashes add `LINEWORK` texture where tuning wants it.
- **Plazas:** `plaza` zones inside the network become `Town.plazas`, bounded by the streets round them. `squares()` gives the big ones a fountain or a statue, and `people()` puts people on them.

---

## 11. Blocks and parcels (`image-blocks.ts`)

### 11.1 Blocks

Blocks are the faces of the planar graph, found by half-edge traversal (always taking the next edge clockwise), less the outer face. Each is inset by half the road width plus a pavement of 2–4 m with `offsetRing()`, and takes the zone that covers most of it. Where a park, wood or plaza zone covers part of a block, that part stays green or paved and gets no parcels (§11.4). Shapes may overlap, and the masks resolve the overlaps as they do with OSM data (`outline()` draws only edges with the mask on one side), so no polygon booleans are needed.

### 11.2 Parcels

| Zone | Subdivision |
| --- | --- |
| `old`, `rows`, `blocks` | **Perimeter strips.** The block ring, offset inwards by a depth `d` (10–14 m in `old`, 12–18 m in `rows`, 14–20 m in `blocks`), gives the courtyard. The strip between them is cut at the corner bisectors and split along each street into lots of width `w` (5–8 m in `old`, 5–9 m in `rows`, 18–40 m in `blocks`), varied by hash. Corner lots span the corner. |
| `suburb` | **Oriented-box splits** (Vanegas et al. 2012): split the largest parcel across its longest frontage until every lot is 300–900 m², keeping at least 12 m of street frontage for each. |
| `works` | Oriented-box splits into lots of 2,000–8,000 m². |
| `towers` | A few lots of 40–80 m, each with one tower or slab and open ground round it. |
| `field` | Field parcels of 1–5 ha, split along the field's direction, with tracks and hedgerows between. |

Every lot records its front edge, the one on the street, and which side edges it shares with its neighbours.

### 11.3 Courtyards

The inner ring of a perimeter block is a courtyard. Tuning decides whether it gets `green` (gardens) or stays plain. In `blocks` zones, courtyards over 2,000 m² may get a few big trees.

### 11.4 Hard rules

- Every lot fronts a street or a path.
- No lot or footprint overlaps a road surface, water, a park, a wood or a plaza. This is checked against the zone raster at the corners, edge midpoints and centre.
- A lot that fills less than 40% of its rectangle (`bestRect().fill`) is merged with a neighbour, so there are no slivers.

---

## 12. Buildings (`image-buildings.ts`)

### 12.1 Footprints

- **Rows and old town:** the lot's strip, to a depth tuning chooses, set on the street line. Neighbours share their side edges exactly, so `classify()` finds party walls (`PARTY_TOL` is 0.9 m), a terrace shares one seed, and rows read as rows.
- **Suburbs:** a rectangle square to the front edge, set back 3–8 m, its area the lot's coverage. Some houses are L- or T-shaped (cross gables come for free), and some have a garage or shed at the back.
- **Works:** one large rectangle per lot. `classify()` puts the offices in the corner nearest the street.
- **Towers:** a square or slab footprint, at least 20 m clear of the next.
- Rings run counter-clockwise and have no seams.

### 12.2 Heights

Heights are given explicitly: `h` in metres with `guess: false`, so `classify()` keeps them. A height is storeys × `style.floor`, plus the same roof allowance for pitched roofs that `classify()` would add itself. Heights stay smooth along a row: neighbours differ by at most one storey at full realism and three at full likeness, landmarks aside.

### 12.3 Steering `classify()` with the evidence it reads

`classify()` decides kind and roof from what the map says, so image mode simply says it:

| To get | Give | `classify()` reads it through |
| --- | --- | --- |
| a kind | `Tagged.building`: `house`, `terrace`, `apartments`, `retail`, `industrial`, `warehouse`, `school`, `church` | `OSM_KIND` |
| a roof shape | `Tagged.roof`: `gabled`, `hipped`, `half-hipped`, `mansard`, `flat`, `skillion`, `sawtooth` | `OSM_ROOF` |
| a ridge direction | `Tagged.across`, to turn ridges to the image's orientation | `Info.across` |
| shop fronts and awnings | a shop POI (`SHOP_POIS`) inside the building | `shops[i]` |
| a place of worship | `Tagged.building` `church` (`mosque` in the arid style, `temple` in the East Asian) | worship kind and roof |
| a town hall's flag | a `town_hall` POI with `sub: 'townhall'` | `townHall` |
| gardens and works | `Town.landuse` `residential`, `commercial`, `retail` or `industrial` round each block | `land[i]`, `paintGardens()` |
| density for traffic and parking | `Town.density.built` and `.shops` from every building and shop | `urbanity()` |

The `Tagged` point sits at each footprint's centroid. `Town.nearby` gets the same land use, POIs and ways, since `classify()` reads those from there.

One change inside `classify()` is needed. The catalogue's *OSM roof tags* entry claims every stroke faceted `tagged-roof` and needs `osmTags`. Image-made tags must not count as OSM tags, so `Tagged` gets `from?: 'image'`, and `classify()` sets `Info.tagged` only when `from` is unset.

`classify()`'s own thresholds could still surprise: it makes anything over 40 m a tower, and untagged halls over 1,500 m² industrial. So unit tests check that each combination of evidence tuning uses gives the intended `Info.kind` and `Info.roof` (§18.1).

Everything else stays the renderer's own choice: window patterns, chimneys, dormers, shutters, balconies, doors and rooftop boxes. Clicking a building in the preview still rerolls those, and seed locks work as they do in map mode.

### 12.4 Landmarks

A town needs a few things it has only one or two of. They make the place believable and give the eye somewhere to rest. The structure places them, and tuning may adjust them:

- a **church** on or beside the main square of every `old` core, and one per 400–600 m of built town;
- a **school** with a pitch beside a park in suburbs and rows (a bright rectangle with markings makes a good highlight);
- a **town hall** on the largest square, flying its flag;
- **halls with sawtooth roofs** in the works zones.

---

## 13. Ground, green and trees (`image-ground.ts`)

### 13.1 Land use and cover

- **`Town.landuse`** for every built block, as §12.3 lists. Suburbs and rows get `residential`, so `paintGardens()` draws lawns and garden trees wherever buildings cover under 30% of a residential area of 2,000 m² or more, and `plots()` fences each house the local way.
- **`Town.green`** for parks, courtyard gardens and village greens. `pitch` land use rectangles in bright parts of parks get marked pitches. `cemetery` land use beside churches gets headstones.
- **`Town.wood`** for woods.
- **`Town.cover`** for fields (`farmland`, which `ground.ts` furrows along each field's length, so fields follow the street field), `meadow`, `orchard`, `vineyard`, `allotments`, `scrub`, `sand` and `beach`. `rock` and `ice` appear only at the edges, in the Alpine style.

### 13.2 Fields

Field parcels alternate between ploughed and stubble by hash, so they read as a patchwork. Tuning turns some into meadow or orchard where the target is lighter or darker. `hedgerows()` lines them as usual.

### 13.3 Water textures

The kind of water is a tone lever: lake ripples are lighter than sea crests. Tuning may turn a large lake into `ocean` where the target is darker.

### 13.4 Explicit trees

Trees are the finest unit of tone the planner has: a crown is 2–4 mm on paper at 1:2000. The renderer places park, wood, garden and street trees itself, and the predictor allows for them by their statistics. Where the target wants more green than that, tuning **adds** trees, by error diffusion along the lots and ground pieces in a fixed order.

That needs one small extension, following the *new map data* recipe in [extending.md](../extending.md):

```ts
// tiles.ts, in Town
/** Trees with a position of their own, as image mode plants them. Always empty from map tiles. */
trees: { x: number; y: number; r: number; h: number; conifer: boolean }[];
```

It goes into `Town` and `empty()`, and through `assemble()`, where it stays empty. `render()` adds the trees to its list after `placeTrees()`, as `from('image-trees', …)`, and keeps them only while `set.trees > 0`. They go through `regionalTrees()` and `legibleTrees()` like any other trees. A catalogue entry claims the facet.

---

## 14. Tuning (`image-tune.ts`)

Structure gives a believable town at roughly the right tone. Tuning makes it match.

### 14.1 What it may change

| Group | Variables | Constraint |
| --- | --- | --- |
| a terrace (lots sharing party walls) | storeys ±1, roof shape, depth | one roof shape per row where the style has `rows` |
| a suburban lot | coverage 0.15–0.45, storeys 1–3, roof, garden trees 0–4, a pool | smooth with its neighbours |
| a works lot | coverage, flat or sawtooth roof, yard trees | |
| a tower | storeys within the zone's range | never under 8 storeys |
| a park, courtyard or field piece | texture (park hatch, meadow, orchard), trees 0–4 per 100 m² | |
| a body of water | lake or sea | |
| a shop front | on or off: awnings add warm stripes | only on `primary`–`tertiary` and pedestrian streets |

### 14.2 The loop

1. Start every group from its zone's level and warmth, through the inverse of §7's table.
2. Predict the sheet (§7.2), and blur its error against the target.
3. For each group, in a fixed order by position key, try each allowed move. Predict again only the window the move touches, with its shadow and the blur radius, and keep the move that lowers `E = E_likeness + E_realism` the most. The owner buffer assigns each cell's error to the group that shows there, so groups with no error are skipped.
4. Repeat for up to six sweeps, until a sweep improves `E` by less than 0.5% or the time budget (600 ms) runs out. The budget is checked only between sweeps, never inside one, so the result doesn't depend on how fast the machine is.

`E_realism` penalises height steps along rows, jumps in coverage between neighbouring lots, and moves away from the zone's typical range, weighted by `1 − likeness`.

### 14.3 Checking against the real drawing (later)

The predictor will never be exact. A **Refine** pass (M8) renders the town and measures each pen's coverage per tone cell from the real strokes. It takes the difference from the prediction as a bias per material for that area, tunes once more and renders again. That doubles the time, so Refine is a key in the Image section, not automatic.

### 14.4 Likeness

| | Realism (0) | Likeness (1) |
| --- | --- | --- |
| zone smoothness `λ` | high | low |
| smallest park, wood, lake | 1.5 ha, 3 ha, 0.5 ha | 0.1 ha each |
| weight of the image in the street field | 0.1 | 0.8 |
| bright lines become streets from | 80 m, fairly straight | 30 m, any curve |
| priors (urban gradient, sand by water) | full | a quarter |
| height steps along a row | 1 storey | 3 storeys |
| tuning ranges | the zone's typical range | the label's full range |

The default is 0.6.

---

## 15. Colour and pens

### 15.1 Pen colours shape the town, in image mode only

AGENTS.md rule 6 keeps pen colours out of the drawing, so a palette change is instant. In image mode the colours have to count: which material best matches an orange depends on which pen is orange. The proposal:

- A pen change still recolours the drawing on show at once, through `recolor()`.
- In image mode it then schedules a re-tune and redraw, debounced like a slider. The structure is cached, so this costs tuning and rendering only.
- Zoning depends on colour too (§8.2). The structure key includes the pens only while `imageColour > 0`, and then only their hues rounded to 10°, so fine adjustments don't re-zone.
- Map mode doesn't change, and the rule's test still holds there.

Rule 6 in AGENTS.md and [ui.md](../ui.md) each get a sentence on the exception. The alternative is in §20.

### 15.2 Pens from image

The palette is the biggest lever on colour. A key in the Pens section, shown in image mode, picks pens for the image:

1. k-means (k = 8, seeded deterministically) on the target's OKLab, weighted by area.
2. Each pen takes the cluster that best fits its role in `harmony.ts`'s `ROLES`: greens for Greenery, blues for Water, the warmest for Roofs, a dark for Shadows and the darkest for Linework.
3. Each colour is clamped into its role's lightness and chroma range. The set must keep the harmoniser's 0.19 OKLab separation and a clearly darkest linework pen. Locked pens are kept, as Harmonise keeps them.

It is an ordinary user action: it writes `set.pens`, the Pens section's Undo can step back from it, and it re-tunes like any pen change.

### 15.3 One pen, and the paper

With Mono, or with `imageColour` at 0, only lightness counts. The paper colour is the custom background when that is on, and white otherwise.

---

## 16. Interface

Visual rules are in [DESIGN.md](../../DESIGN.md). The mode adds no new kinds of control.

### 16.1 Panel

- **Section 1** gets a selector switch, **Map | Image**, under its title. In Image the section is titled *Image*, and it holds:
  - an **image well**: a hairline frame in the drawing area's proportions, with *Drop an image, or choose one* in muted text and a Choose key. Once it holds an image, it shows it with the crop frame, and dragging moves `imageFocus` in Fill. A mono readout gives the pixel size and the name.
  - a **Fill | Fit** selector switch;
  - sliders for **Brightness**, **Contrast**, **Colour** and **Likeness**. Likeness has the hint *Closer to the image, or more like an ordinary town.*;
  - **Street pattern**: Auto | Organic | Grid;
  - a **Refine** key, once M8 is built.
- In image mode the **View** section's Rotation hint reads *Turns the town under the image*, and the Scale hint gives the tone resolution, as in *About 40 houses across.*
- The **title block** shows the image name, editable like a place name.
- **Pens** gets the *From image* key (§15.2).
- Section 1's folded summary gives the name, the fit and the likeness.

### 16.2 Stage

- An **Image** key in the toolbar lays the image over the preview at 50% opacity, aligned to the drawing area with `fitImage()`, to check how they line up.
- A **Squint** key blurs the preview with a CSS filter, so the user sees the tone the town makes.

Both work on the main thread only and cost nothing.

### 16.3 Stats and catalogue

- The stats footer gets a **Likeness** readout (mono, 0–100) from §7.4, with a hint saying what it measures.
- The catalogue gives *Image* as the source in place of *Map* for everything image mode laid out, and *Made up* as usual for what the renderer invents. The entries image mode feeds (buildings, streets, water, parks, woods, fields) get a line on how image mode finds them.

### 16.4 Margin and SVG

- The margin keeps its border, scale bar and north arrow, which hold true for the fictional town. It leaves out the graticule ticks, which would claim a real place. The title is the image name. The view line reads `AFTER AN IMAGE · LOOKING NE (35°) · TILT 40°`, and the imprint keeps its date but drops the map credit.
- The SVG `<desc>` drops the coordinates and the OpenStreetMap credit, since no map data is used. §20 asks you to confirm this.

---

## 17. Changes to existing code

| File | Change |
| --- | --- |
| `src/settings.ts` | The settings of §5.1, with doc comments and defaults. |
| `src/app/model.ts` | `NumberKey`, `FORMAT`, `shared()`, `fromQuery()` and `loadSettings()` for the new keys; image defaults on the first switch. |
| `src/app/renderer.ts` | Send `picture` with a job when the worker lacks it; re-tune on pen changes in image mode (§15.1). |
| `src/app/image-store.ts` (new) | Decode, normalise, hash, keep and load images. |
| `src/worker.ts` | Branch on `set.source`; the picture cache; `drawnAs()`; likeness in `done`. |
| `src/tiles.ts` | `Town.trees`, in `empty()` and `assemble()`; `Tagged.from`. |
| `src/classify.ts` | `Info.tagged` only for OSM tags (§12.3). |
| `src/render.ts` | Add `town.trees` to the tree list (§13.4). Nothing else. |
| `src/marginalia.ts`, `src/plot.ts` | Title, view line, imprint and `<desc>` in image mode (§16.4). |
| `src/app/stages.ts` | The first stage's label in image mode. |
| `src/catalogue.ts`, `catalogue-dialog.tsx` | The `image-trees` entry; the *Image* source in image mode. |
| `src/harmony.ts` | `fromImage()` for Pens from image. |
| `src/components/sections.tsx`, `stage.tsx`, `title-block.tsx` | The controls of §16; a new `image-well.tsx`. |
| `src/netcache.ts` | The `IMAGES` store. |
| `lab/` | `calibrate.ts` and `likeness.ts`; per-pen coverage in `metrics.ts`. |
| Docs | Listed per milestone in §19. |

The new modules stay flat in `src/`, with an `image-` prefix as the `power-*.ts` files have:

| File | Role |
| --- | --- |
| `image.ts` | `imageTown()`, shared types, `drawnAs()`, `STYLE_PLACE`, the two cache keys, `plausibility()` |
| `image-fit.ts` | `fitImage()`, the sheet ↔ image mapping; no drawing imports, so the UI can use it |
| `image-read.ts` | `readImage()` → `Target` (§6) |
| `image-tone.ts` | colour mixing, the predictor and likeness (§7) |
| `image-tones.ts` | the calibrated constants, generated |
| `image-zones.ts` | zoning (§8) |
| `image-water.ts` | water (§9) |
| `image-streets.ts` | the street field, tracing, clean-up, classes, paths (§10) |
| `image-blocks.ts` | blocks and parcels (§11) |
| `image-buildings.ts` | footprints, heights, evidence, landmarks (§12) |
| `image-ground.ts` | land use, cover, green and trees (§13) |
| `image-tune.ts` | tuning (§14) |

AGENTS.md rule 5 (gate with `shows()`) is about drawing code. The planner draws nothing, but it asks the same LOD rules so as not to lay out what can't show. At 1:8000 it makes larger parcels rather than 40,000 sheds for `legible()` to drop, and it never makes more than 30,000 buildings.

---

## 18. Testing and the likeness lab

### 18.1 Unit tests (`test/unit/image-*.test.ts`)

- OKLab conversion, the tone curve, gamut mapping, and `fitImage()` both ways.
- Zoning on tiny synthetic targets: a picture of two halves gives two zones split along the edge, and noise below the minimum size is absorbed.
- After clean-up, the street graph keeps every rule in §10.5 for a set of synthetic fields (random grids, radial, noisy).
- Parcels keep the frontage and sliver rules (§11.4), and terraced lots share edges exactly.
- Evidence (§12.3): each `Tagged` combination tuning uses gives the intended `Info.kind` and `Info.roof`, and image-made tags leave `Info.tagged` false.
- The predictor against coverage worked out by hand for one building, one park and one shadow.
- Determinism: the same picture twice gives a deep-equal `Town`.
- **Stable structure:** changing Detail, pen width, Trees, Shadows, or the pens with `imageColour` at 0, leaves streets, blocks and parcels deep-equal.

### 18.2 Drawing tests (`test/render/image.test.ts`)

- **Pictures made in code** (`test/support/pictures.ts`), so there are no binary fixtures: a gradient from light to dark, a dark disc on light, a blue bottom third under a green middle and a red top, diagonal stripes, a white cross on mid-grey (streets should take the bright lines), and a smooth-noise landscape. Each is a case with a golden, at 1:2500 on A4.
- The checks `sheets.test.ts` makes: finite strokes inside the drawing area, every stroke claimed by a catalogue entry, no ink lost in planning, and an SVG that reads back stroke for stroke.
- **No network:** every case runs with a fetch stub that throws on any call.
- **Plausibility:** `plausibility(town)` (§17) finds no violations in any case.
- **Calibration guard** (§7.3): predicted coverage per pen is within 10% of the drawing's. (Built at M5 as total ink within 20% and each pen within 50%; see the notes from M5.)
- **Likeness floor:** each case must score above a floor set when its golden is first accepted, so a change that makes the gradient read worse fails.
- **Map mode untouched:** the existing goldens don't change, which covers rule 1.
- `gates.test.ts` gets an image base, so switching a layer off in image mode takes away what the catalogue says it should.

### 18.3 The likeness lab (`npm run likeness`)

It works like the LOD lab, headless, through Vite's module runner:

```bash
npm run likeness                                   # every picture in lab/images/ at 1:1000–1:8000
npm run likeness -- --images gradient,disc --scales 2500
npm run likeness -- --name before                  # keep a run under a name
npm run likeness -- --name after --compare before  # what changed, per picture and scale
npm run likeness -- --likeness 0.2                 # another Likeness
npm run likeness -- --pens archive                 # another palette
```

`lab/images/` holds the synthetic pictures and a few real ones under open licences, each chosen to stress something different: a landscape, a portrait, a poster in flat colour, a logo on a transparent background, a dark night scene and a busy texture. The lab can decode them with dev-only decoders (`pngjs`, `jpeg-js`).

Each run writes `lab/out/<name>/`, with the image, the squinted drawing and the drawing side by side for each case, and a report: likeness (score, ΔE at both distances, SSIM), the tone range used, the time of each planning step, plot time, the LOD lab's waste figures and any plausibility violations. Use it for every change to the planner, as the LOD lab is used for drawing changes. Look at the close-ups too: whether the town is believable can only be judged by eye.

---

## 19. Milestones

Each milestone works end to end behind the switch, with tests, and leaves map mode untouched. Sizes are relative.

**M0 Plumbing (M).** The settings, image store, Map | Image switch and image well; `Picture` in the job; `drawnAs()`; the margin and `<desc>`. `imageTown()` returns a crude town from a lightness threshold: water in the darkest parts, and a plain grid of streets with uniform houses everywhere else. The likeness score in `done` and the stats footer; the Image and Squint keys; `npm run likeness` with the synthetic pictures. *Done when* an image can be dropped in, drawn, reloaded from storage and scored, and the map goldens are unchanged.

**M1 Reading and zoning (M).** All of `readImage()` (§6), and zoning with every label, cost, SLIC, ICM and the minimum sizes (§8). A hand-estimated material table stands in for calibration. Debug views of the target and the zones in the likeness lab. *Done when* the synthetic pictures zone as expected and zone edges follow image edges.

**M2 Water and streets (L).** All of §9 and §10: the street field, main roads, streets from the image, local streets, clean-up with every hard rule, classes, bridges, paths and plazas. *Done when* the graph rules hold for every lab picture and the network looks like a town's in the close-ups.

**M3 Blocks, parcels and buildings (L).** §11 and §12: perimeter strips, box splits, courtyards, footprints, heights, evidence for `classify()` and landmarks. *Done when* rows show party walls, suburbs have gardens and fences, churches stand on squares, and `plausibility()` is clean.

**M4 Ground and trees (M).** §13: land use, cover, field patchworks, kinds of water and `Town.trees`. *Done when* every label's ground reads as it should and the catalogue claims `image-trees`.

**M5 Calibration, predictor and tuning (L).** `npm run calibrate`, `image-tones.ts`, the predictor, the tuning loop and the Likeness slider (§7, §14); the calibration guard and the likeness floors in the tests. *Done when* tuning clearly raises the lab's likeness over M4 at Likeness 0.6, with no new plausibility violations and within the time budget.

**M6 Colour (M).** Materials that know the palette, gamut mapping, re-tuning on pen changes (§15.1), Pens from image (§15.2) and Mono. *Done when* the three-band synthetic picture keeps its hues under Classic and under a palette from Pens from image.

**M7 Polish and docs (M).** Hints and summaries, error states (an unsupported format, a missing image), catalogue wording and defaults. Docs: `docs/image-mode.md` (how it works, like the solarpunk branch's `solarpunk.md`), a row in `docs/README.md`, `architecture.md` (the new modules and data source), `data-sources.md` (the image store), `ui.md` (the switch, the well, the pens), `testing.md` (the image cases and the likeness lab), the README's "What it draws" and module table, `DESIGN.md` (the image well) and rule 6's exception in AGENTS.md. Run `npm run doctor`. *Done when* the app has been checked in the browser with the lab's real pictures on A4 and A3 at 1:1000–1:8000.

**M8 Later.** The Refine pass (§14.3). A railway along a long, straight dark ridge, with a station on the main square. A motorway along a bright line across the region at coarse scales. Trams in `blocks` cores. A sun height suited to how dark the image is, while automatic sun is on. Each needs its own lab check.

---

## 20. Decisions for you

The plan assumes the recommendation in each case.

1. **Pen colours as an input in image mode** (§15.1). *Recommended:* yes, always for tuning and, through rounded hues, for zoning. The alternative keeps rule 6 everywhere by matching lightness only and fixing what each hue means (blue is water, green is green). It is simpler, but it does badly with any palette other than Classic.
2. **Attribution.** *Recommended:* in image mode, drop the OpenStreetMap credit from the margin and the SVG, since nothing in the drawing comes from it. Keep it in the About dialog and the README. AGENTS.md rule 7 says to keep the attribution, so this needs your yes.
3. **What scale means.** *Recommended:* the image is pinned to the sheet and scale sets how many metres it spans (§1). The alternative pins the image to the ground, so scale zooms into the image. That feels more like map mode, but at most scales it would crop the image.
4. **Share links without the image** (§5.5). *Recommended:* accept it and say so in the well. Anything else needs a service to hold images, and so a backend.
5. **The Refine pass** (§14.3). *Recommended:* on demand, after M7.
6. **Style for `auto`.** *Recommended:* Central European (§5.2). The alternative guesses a style from the image (lots of bright terracotta suggests Mediterranean), which is fun but fragile.

---

## 21. Risks

| Risk | What we do about it |
| --- | --- |
| Fine detail the town can't resolve (faces, text, texture) | Say so plainly: the Scale hint gives the tone resolution. Edges go into lines (§2.2). The lab's portrait and texture pictures keep the planner honest. |
| Very dark images blot | The tone curve ends at the darkest believable material, not at solid ink (§6). The LOD lab's waste figures are reported for every likeness case. |
| The town looks generated: too regular or too uniform | Seeded variation in widths, setbacks and heights, landmarks, the urban gradient, and organic fabric by default; close-ups judged by eye at every milestone. |
| Streets follow the image into nonsense | Field smoothing, the hard graph rules, and Likeness capping the image's weight in the street field at 0.8. |
| The predictor drifts as the renderer changes | The calibration guard test fails, and `npm run calibrate` fixes it (§7.3). |
| `classify()`'s thresholds misread the evidence | Unit tests for every combination (§12.3). |
| Slow at 1:8000 on A2 | Parcels sized by level of detail, the cap on buildings, budgets checked per sweep, and the cached structure. |
| Re-tuning on a pen change feels sluggish | Recolour first, then re-tune with a debounce, from the cached structure (§15.1). |

---

## 22. References

- Y. Parish and P. Müller, *Procedural Modeling of Cities*, SIGGRAPH 2001: the tradition of grown street networks this plan builds on.
- G. Chen, G. Esch, P. Wonka, P. Müller and E. Zhang, *Interactive Procedural Street Modeling*, ACM Transactions on Graphics 27(3), 2008: tensor fields and streamline tracing (§10).
- C. Vanegas, T. Kelly, B. Weber, J. Halatsch, D. Aliaga and P. Müller, *Procedural Generation of Parcels in Urban Modeling*, Eurographics 2012: oriented-box and skeleton subdivision (§11).
- C. Vanegas, I. Garcia-Dorado, D. Aliaga, B. Benes and P. Waddell, *Inverse Design of Urban Procedural Models*, SIGGRAPH Asia 2012: tuning a generator towards a target (§14).
- R. Achanta, A. Shaji, K. Smith, A. Lucchi, P. Fua and S. Süsstrunk, *SLIC Superpixels Compared to State-of-the-Art Superpixel Methods*, IEEE TPAMI 2012 (§8).
- Y. Boykov, O. Veksler and R. Zabih, *Fast Approximate Energy Minimization via Graph Cuts*, IEEE TPAMI 2001 (§8).
- W.-M. Pang, Y. Qu, T.-T. Wong, D. Cohen-Or and P.-A. Heng, *Structure-Aware Halftoning*, SIGGRAPH 2008: matching tone and structure together, as tuning does.
- A. Hausner, *Simulating Decorative Mosaics*, SIGGRAPH 2001: laying tiles along image edges, as streets follow them here.
- B. Ottosson, *A perceptual color space for image processing*, 2020: OKLab.
