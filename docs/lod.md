# Level of detail

A pen plotter can't draw anything smaller than a few pen widths. Below that, lines close up into a blot, every stroke still costs a pen lift, and the clutter spoils what is around it. So every drawn thing asks how big it will be **on paper** before it is drawn, and the answer depends on three things:

1. **Zoom.** The map scale sets millimetres per metre (`cam.s`).
2. **Detail.** The setting scales that up or down: Detail 2 keeps things half as big.
3. **Pen width.** A broader pen than 0.35 mm drops things sooner, and opens hatching out so the tone stays the same.

`cam.lod` combines the three: `s × detail × 0.35 / penWidth`. `cam.size(m)` is how big `m` metres is in those terms, in mm.

### Detail per layer

With `customLayerDetail` on, `layerDetail` gives features (keyed by `LAYERS`, less wall shading and the margin, which don't depend on Detail) their own Detail in place of the slider. `cam.within(layer, fn)` runs `fn` with `cam.detail` and `cam.lod` switched to that layer's value and puts them back afterwards; a layer without an override keeps whatever is in force, so scopes nest. `render()` makes and draws every feature inside its layer's scope (the `at()` and `extra()` helpers and `withPen()`); inside a building, `tagLines(B, layer, …)` scopes windows, details and rooftops, roof shapes run as `roofs`, and roof hatching as `roofHatch`. Code that reads `cam.lod`, `cam.gap()` or a rule needs no change, as long as it runs inside its layer's scope: do the work there rather than keeping a value from outside it.

## Rules (`src/lod.ts`)

Each kind of thing has a rule in `LOD`:

```ts
chimney: { m: 0.65, mm: 0.45, what: 'Chimney stacks: width' },
```

- `mm` is the smallest size on paper worth drawing, at Detail 1 with a 0.35 mm pen.
- `m` is the size of a typical one, in metres. A typical thing shows from 1:(1000 · m / mm) and finer (1:1444 here).
- `what` says what is measured. The LOD lab prints it.

Ask with the actual size wherever you know it, so a big thing outlasts a small one of the same kind:

```ts
if (shows(B.cam, LOD.chimney, width, hash(k0, k1, B.seed, SALT))) chimney(…);
```

| Helper | Use it for |
| --- | --- |
| `shows(cam, rule, m?, h?)` | Draw it or not. Pass a stable hash `h` in [0, 1) and things of a kind drop out one by one over one doubling of scale, not all at once. Leave `h` out for things that should switch together (a whole feature, all windows on a wall). |
| `showsAt(cam, rule, m, key, seed, salt)` | The same, hashing a position key for you. |
| `thin(cam, rule, m)` | For things that crowd, such as trees: the share to keep so that the ink stays about the same. |
| `atLeast(cam, rule, m, grow)` | Widen a size, up to `grow` times, until it reads (roads). |
| `spaced(cam, m, mm)` | Metres between repeated things that keep `mm` apart on paper (steps, balusters). |
| `cam.gap(mm)` | Hatch and texture spacing: closed up by Detail, opened out by a broad pen. |
| `cam.tone(mm)` | Tone hatching (shadows, shaded walls) and dash patterns: opened out by a broad pen only. |

Some rules change *how* a thing is drawn rather than whether it is: cars lose their raised cabin and lower body edges when the cabin height no longer reads, keeping a roof outline and a windscreen stroke; windows step down from frames (`window`) to single upright strokes stretched to read (`windowTick`) to one stroke per floor (`windowRow`, every other floor where they crowd) and finally to a plain wall (`floors`), the same steps for every window pattern; narrow streams become a single line, pylons too small for their legs to stand apart become a flat A-frame, and battlements too small to read become a parapet.

Road centre dashes are tested by their projected length, so dashes pointing into the view drop out before those across it. Roof hatching stops 1.25 pen widths short of each endpoint and is tested again at its shortened length, keeping small slopes clear rather than filling them with fragments.

Grass tufts and inferred park and wood trees use smooth, map-fixed density patches, leaving quiet gaps between groups. Tree spacing still follows its LOD rule; woods keep fuller edges. Grass patches span five texture cells, so their paper size follows `cam.gap()`. Water uses longer, shallow ripples in loose bands on the sheet, with spacing and length following `cam.gap()` and a bank clearance of 1.5 physical pen widths. Its quiet gaps are compositional, not inferred currents or depths.

Park hatching uses `cam.gap(1.8)` spacing, doubled under headstones and pitch markings. Four clearance probes at 1.5 physical pen widths keep its strokes apart from park boundaries, roads, water, building footprints, shadows and visible objects in the depth buffer. The outline stays unchanged; narrow slivers may keep only their outline when the hatch has no room.

The `treeCrown` rule gives large broadleaf crowns a gently lobed outline, varied by map position, and large conifers a three-tier silhouette. Smaller crowns retain a simple circle or triangle without interior marks. Conifers test the shorter of crown width and projected height, so a flattened view cannot squeeze branch tiers together. The same crown ring supplies the depth mask and the drawn outline.

Merged window rows and curtain-wall floor lines keep at least `cam.gap(1.5)` between parallel strokes, measured perpendicular to the projected wall direction. Glazing mullions keep `cam.gap(1.2)` of horizontal separation. Ribbon bands too shallow to read collapse to a single floor stroke, and glazing bands start at least 1.5 pen widths inside the projected vertical corners. These rules reduce rows and columns coherently, without changing the building's inferred window pattern.

## What `Paper` does for every stroke

- **Speck filter.** Strokes shorter than two pen widths are dropped in `Paper.end()`: a pen only makes a dot of them, and a gap that short closes up under the pen anyway. Marks meant to be small (summit lettering, stipple) are drawn inside `paper.fine(() => …)`, which skips the filter.

## Adding or tuning a rule

1. Add an entry to `LOD` with an honest typical size and a one-line `what`.
2. Call `shows()` with the real size where the thing is made, and a fresh salt for the fade (grep first; LOD salts are 9100 and up).
3. Run the LOD lab (below) at a few scales and look at the close-ups.

## The LOD lab

`npm run lod` draws a set of test places (`lab/places.ts`: an Alpine village, a canal city, a walled town, a lake village, a marsh town, an airport, Midtown Manhattan, mid-rise Sapporo and farmland) at 1:500 to 1:8000 with the real renderer, headless, through Vite's module runner. Downloads are cached in `lab/.cache`, so reruns don't use the network. OSM tags are off unless you pass `--tags`, so runs are repeatable.

Every stroke is filed under the feature that drew it (`Paper.tally`, with names such as `roofHatch` or `streets:kerbs`; the catalogue's facets after a slash are folded back into their feature), then the lab stamps the strokes onto a 0.1 mm ink raster at the real pen width and scores each feature:

- **specks:** strokes less than two pen widths across, which plot as dots,
- **drowned:** ink laid in 1 mm cells that are already 65% inked or more, so it adds nothing,
- **minutes:** plotting time, counting a lift per joined stroke,
- **waste:** the share of a feature's time spent on specks and drowned ink.

Intentional dots (stipple) count as specks too, so a little waste in sand and marsh is expected.

```bash
npm run lod                                   # everything: 9 places × 5 scales, a few minutes
npm run lod -- --places mollis,amsterdam --scales 1000,4000
npm run lod -- --name before                  # keep a run under a name
npm run lod -- --name after --compare before  # what changed, per case and per feature
npm run lod -- --detail 1.5 --pen 0.5         # another Detail or pen width
npm run lod -- --layer-detail trees:0.5,windows:2   # Detail for some layers only
npm run lod -- --no-png                       # numbers only
```

Each run writes `lab/out/<name>/`: an SVG per case, `report.json`, and `index.html`. The page has a table per place (feature × scale), the whole sheet, the busiest and the middle 30 × 20 mm at true pen width, a waste close-up (specks in magenta, solid cells in red), and the full rule table with the scale each rule cuts in at. PNGs need Chrome or a Playwright Chromium.

What to look for: waste should stay low (it was 15–70% before this system, and is now about 6–25% at every scale), and the close-ups should read cleanly at every scale. A feature that turns red only at coarse scales usually wants a rule; one that is red at every scale is probably drawing at a fixed spacing that ignores `cam.gap()`.
