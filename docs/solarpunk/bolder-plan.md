# Solarpunk mode, part 2: bolder changes

The next proposal is [part 3: a town that produces its own future](next-plan.md): widespread energy, water and food systems, larger architectural changes and a visibly different Visionary skyline.

The first plan ([implementation-plan.md](implementation-plan.md)) is built. It is careful and correct, but subtle: a solarpunk drawing looks like today's drawing with small things added. This plan builds on it to make the future obvious at a glance, at the size the drawing is actually seen, while keeping the place recognisable.

Read [../solarpunk.md](../solarpunk.md) first: it explains the planner, the layers and the rules the code keeps. Recipe ids such as `T01` refer to `Solarpunk Recipes.json`.

## Status

- **Built: N0 to N5.** The `depth` setting (default `transform`), its selector, share links and `depth:transform` gate; the lab's new-ink, thumbnail-difference and plot-time figures against today; garden streets, boulevards with cycle tracks, and the urban canopy with courtyard trees; panels as tone, more panelled roofs, rows as one band, and roof gardens; car parks turned into parks, green walls, and frames on every eligible slab, front and back, with planted floors; planted banks with waterside trees, alley cropping, the energy canopy and mosaic paving round it. Retrofit goldens are unchanged, and each solarpunk case has a `-transform` twin. At depth Visionary: pedestrian cores, tram lines with stops, community wind turbines, solar rows over fields, roof pavilions, sky gardens, garden bridges, market halls and daylighted streams, with Mollis and Midtown `-visionary` twins.
- **Not built:** the cable car (§7) needs to know where the steep wooded slopes are, and the map data has no terrain. Floating garden rafts, trellis strips between windows and curved braces are not built either. Pocket-park beds and benches and pedestrian-core market stalls are now built (the public-space follow-up below).
- **§12 decisions:** taken as proposed for now: `transform` is the default and the selector is in the Town section. Not settled yet: the ink budget, the invented landmarks and where roof gardens go.
- **Changed from the plan while building:**
  - Strips stop 6 m short of crossing roads, but the street is narrowed along its whole length, so corners stay paved as build-outs rather than at full carriageway width.
  - Strips are kept apart from `town.green`, in `Reshaped.strips` and a `strip` mask (also filled into `green`), so their ink counts as new and park trees keep off them.
  - Cycle tracks are drawn by `cycleTracks()` with their own riders, not added as `path` ways.
  - Neighbours for junctions come from `town.nearby.ways`, so a long street's narrowing can still change when a junction more than 250 m outside the view comes in. It is rare, and the pan test doesn't see it.
  - Garden streets are minor streets in practice: service roads are 5 m in the tiles, under the 7 m threshold.
  - Hot and dry places get wider tree spacing on strips, but not yet the stone dashes of §3.1.
- **Changed in N2:** panel tone is 0.7 mm rather than 0.6 mm, to keep waste in budget (below). Roof gardens draw small trees in tubs as crowns facing the viewer on the roof, not as tree sprites (sprites stand on the ground). They don't go on works (B19) either, whose roofs keep their panels.
- **Changed in N3:**
  - Car parks have no outline in the tiles, so a car park is found from its aisles: aisles that meet make one, decided whole. Its park is the ground the bays would take, as rectangles along each aisle, and the aisle stays as a footpath. The public-space follow-up adds benches and pairs of garden beds where there is room beside the retained paths.
  - Green walls go only on buildings up to 30 m tall: Midtown's towers stand above lower neighbours on every side, and planting those walls took their windows away. Towers wait for sky gardens (N5). Trellis strips between window columns aren't built.
  - Green walls replace the wall's shade hatching, so the two don't stack up into solid ink.
- **Changed in N4:**
  - Banks are planted along rivers, lakes, ponds and streams, outside dense centres (`urbanity()` over 0.5 means quays). They aren't parks: fields and gardens under a bank keep their texture, and only free ground is hatched. Floating garden rafts on canals aren't built.
  - Alley cropping narrows the strips of wide fields to about 25 m, with a tree row on every margin, rather than turning every other strip into trees.
  - The energy canopy goes on squares of 1,200 m² or more with room for it all round, in place of their invented fountain or statue: a little over half of them, by position, not only the biggest square in view (which would change as the view pans). It is 14–20 m across and 11 m up, so its trunk shows under the rim. It shows at every scale where canopies do, not only where fountains do. Few test places have a square big and open enough; Plaza Mayor in Madrid was used to check it by eye.
  - Curved braces on posts (§9) aren't built yet.
- **Measured** (LOD lab: new ink / pixels that differ at preview size, Retrofit → N1 → N2 → N3 → N4; then plot time and waste against today, after N4):

  | Case | 1:1000 | 1:4000 |
  | --- | --- | --- |
  | Mollis | 9 → 14 → 17 → 18 → 19% / 6 → 11 → 12 → 13 → 13%; ×1.22, +1.4 pts | 3 → 6 → 8 → 8 → 14% / 4 → 8 → 9 → 9 → 13%; ×1.26, +1.0 pts |
  | Amsterdam | 11 → 16 → 21 → 24 → 24% / 9 → 13 → 17 → 19 → 19%; ×1.31, +0.8 pts | 5 → 11 → 18 → 19 → 19% / 7 → 15 → 21 → 23 → 23%; ×1.20, ±0 pts |
  | Midtown | 24 → 26 → 29 → 29 → 29% / 20 → 22 → 24 → 24 → 24%; ×1.37, +1.5 pts | 9 → 9 → 20 → 20 → 20% / 7 → 11 → 20 → 20 → 20%; ×1.36, +1.9 pts |
  | Rye | 12 → 17 → 21 → 22 → 22% / 9 → 13 → 16 → 16 → 16%; ×1.22, +1.4 pts | 2 → 6 → 8 → 9 → 23% / 3 → 5 → 5 → 6 → 15%; ×1.40, +0.3 pts |
  | Hallstatt | 7 → 9 → 12 → 13 → 15% / 3 → 4 → 5 → 5 → 6%; ×1.14, +0.8 pts | 0.4 → 1.3 → 2 → 2 → 5% / 0.3 → 0.8 → 1 → 1 → 2%; ×1.08, +0.6 pts |
  | Trubschachen | 8 → 13 → 15 → 17 → 22% / 6 → 9 → 9 → 10 → 13%; ×1.23, +1.3 pts | 2 → 4 → 4 → 5 → 11% / 3 → 3 → 4 → 4 → 6%; ×1.19, +0.8 pts |

  Waste stays within the 2 points the plan allows. The first version of the panel tone (0.6 mm, with the grid every two modules over it) took Midtown to +2.6 points, so the tone is 0.7 mm and the grid over it needs twice the room. Plot time is well inside the proposed +60%.

  N4 did what it was for: the villages and farmland at 1:4000 (Rye 9% → 23%, Mollis 8% → 14%, Trubschachen 5% → 11%). The §8 targets for Transform are still off: 30–45% new ink at 1:1000 is nearly reached only in Midtown (29%), and 25% of pixels changed nowhere. Since every milestone of Transform is now built, closing that gap is a choice between turning up what exists (more canopy, wider strips, denser tone) and accepting lower targets. Visionary (N5) has its own, higher target.
- **Changed in N5 (part 1):**
  - Pedestrian cores are minor streets where `urbanity()` is over 0.7, in half the 300 m districts. The street keeps its surface (the road mask) but loses kerbs, traffic and parking; two rows of trees stand in the paving with a clear middle lane, and people gather along it. The public-space follow-up adds market stalls along eligible streets, keeping the service lane clear.
  - Tram lines are added on every primary and secondary chain of 600 m or more, a little over half of them, not only the longest one in view. Where two tracks 3 m apart can't be told apart on paper (`tramPair`, about 1:2000), the line is one track down the middle, or the tracks and wires blot (Midtown's rails were 42% waste at 1:4000). Stops aren't built.
  - Wind turbines stand on fields, meadows, open country and marsh, at least 300 m from any building (from `town.density`, so every loaded building counts), one per 700 m cell, at most three on a sheet. Few test views have that much open land: Rye at 1:4000 has one.
  - Solar rows cover every other strip of about a third of the wide fields. Their level of detail is measured by the 12 m row length, so they last to 1:4000, where the fields are.
  - Roof pavilions go on slabs and towers (B04, B05) with flat roofs over 300 m², a little under half of them.
- **Changed in N5 (part 2):**
  - Sky gardens: towers over 60 m tall that are close to a rectangle in plan are built in three parts: the floors below, a glazed core set back 3 m for two storeys, and the floors above. Trees in tubs stand round the terrace.
  - Garden bridges are looked for at the middle of each side street, square across it, between buildings at least 18 m tall standing 12–30 m apart.
  - Market halls: big flat-roofed shops and works (over 1,500 m², at most 15 m tall) get rows of glazed ridge rooflights in place of panels. Their car parks are already parks at Visionary, so no market square is added.
  - Daylighted streams: `tiles.ts` now keeps waterways in tunnels as `Town.culverts`, and at Visionary they join the streams. Where buildings and roads stand over them, they stay over them, so a stream shows only where the ground above is free.
  - Tram stops: a platform each side of the line, with a canopy of panels, every 400 m along each piece of the line, clear of junctions. Trams and stops need Railways on.
- **Measured at Visionary**, after all of N5 (new ink / pixels that differ / plot time / waste against today): Mollis 19% / 14% / ×1.22 / +1.3 pts at 1:1000 and 14% / 14% / ×1.26 / +1.0 at 1:4000; Amsterdam 24% / 19% / ×1.30 / +0.5 and 21% / 22% / ×1.22 / +0.1; Midtown 30% / 25% / ×1.39 / +1.9 and 20% / 21% / ×1.39 / +1.9; Rye 23% / 17% / ×1.22 / +1.2 and 24% / 16% / ×1.42 / +0.4; Hallstatt 15% / 6% / ×1.13 / +0.7 and 5% / 2% / ×1.08 / +0.6; Trubschachen 22% / 13% / ×1.23 / +1.2 and 11% / 7% / ×1.20 / +0.8. Visionary adds only a point or two over Transform: its features are rare by design, and the test views have little open country. The §8 Visionary target (40–60% at 1:1000) is far off, and plot time is far inside the proposed +100%.
- **Public-space follow-up:** converted car parks now get pairs of food beds and path-facing benches at 24 m intervals where their full footprint fits clear of paths, water, buildings and tree crowns. They use the Parks switch and existing bed/bench LOD rules. Pedestrian streets at least 8 m wide get market stalls at 6 m intervals, on a side chosen by map-fixed cells, with junction clearance and a continuous 3.6 m service lane. Stalls use Life and the existing stall LOD rule. These are small-scale details; they do not close the new-ink target gap. An Amsterdam Visionary golden covers the market stalls, and synthetic tests cover clearances, gates and 30/47 m pans.
- **Measured for the public-space follow-up:** `sp-public-before` → `sp-public-after`, Visionary, the six reference places at 1:1000 and 1:4000. Amsterdam at 1:1000 rises from 23.9% to 24.0% new ink and 18.8% to 18.9% changed pixels; market stalls add about 0.4 plot minutes. The waste increase is below 0.1 percentage point in every case; every 1:4000 drawing is unchanged. Today and Retrofit goldens remain unchanged. Browser-generated close-ups were unavailable, so the lab's CPU stroke rasteriser was used for preview and close-up review.

---

## 1. Why the first version is subtle

Measured on the golden cases, the solarpunk layers (panels, planting, additions, and the trees, hedges and markings the mode adds) make up only a small share of the ink:

| Case | Scale | Share of ink that is new |
| --- | --- | --- |
| Rye | 1:900 | 11% |
| Amsterdam | 1:1000 | 11% |
| Midtown | 1:2000 | 10% |
| Mollis | 1:1000 | 9% |
| Hallstatt | 1:800 | 8% |
| Trubschachen | 1:4000 | 2% |

There are four reasons, and each one points at a lever:

1. **The town's plan is untouched.** Streets keep their full carriageway, car parks stay car parks, and roofs and ground keep their textures. At a distance, a drawing is read through its big shapes (road surfaces, green areas, tree masses, roof tone), and none of those changed.
2. **Most additions are small.** Porches, tanks, racks, cycles, benches and stalls are each under 3 m. They fade out from 1:1000 down, which is exactly where most drawings are made.
3. **Panels look like roofs.** A panel group is an outline with a sparse grid, about as much ink as the roof hatching it hides. At a distance it reads as a skylight, not as a roof that produces power.
4. **The defaults are cautious.** The mode only does what the guide's "retrofit" level allows. The guide itself separates *visual intensity* from *depth of intervention*, and it allows bolder changes, such as adaptive reuse or a transformed street network, as an explicit scenario choice. We never offered that choice.

**Target for this plan:** at 1:1000, new ink should make up 30–45% of the drawing at the default setting, and a thumbnail of the sheet at preview size (the Fit view) should be recognisably different from Today's. §8 defines how to measure both.

---

## 2. One new control: depth of intervention

The guide's distinction becomes a setting, so the bold changes are an explicit scenario and not an aesthetic accident.

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `depth` | `'retrofit' \| 'transform' \| 'visionary'` | `'transform'` | How far the future goes. `retrofit` is everything built so far, unchanged. `transform` reshapes streets, car parks, roofs and the tree canopy. `visionary` adds district landmarks, new transit and car-free cores. |

- `Intensity` (`future`) stays as it is: how many eligible places take an optional change, within the chosen depth.
- **UI:** a `Segmented` selector, Retrofit | Transform | Visionary, at the top of the Solarpunk part of the Town section, with a `Hint` that says what each one does. The toolbar keeps its Today | Solarpunk switch.
- **Share links:** `depth` joins the shared keys like `climate`, and `loadSettings()` validates it.
- **Invariants:** with `depth: 'retrofit'`, every current solarpunk golden stays identical. With the mode off, the default goldens stay identical, as now. Each feature below names the lowest depth that turns it on.

---

## 3. Reshape the town before drawing it (the big lever)

Today the planner only tags buildings. The bold version also **rewrites the `Town`** that `render()` draws, right after `planFuture()` and before any mask is filled. Everything downstream (masks, kerbs, traffic, markings, tree placement, park hatching, shadows) then follows automatically.

New function `reshapeTown(town, F, B): Town` in a new module `src/reshape.ts`. It returns a shallow copy with changed `ways`, `green`, `plazas` and new future-only lists, and leaves the input untouched. Decisions are keyed by `B.cell` and way ends, as before, so panning keeps them still.

### 3.1 Garden streets (T01, transform)

Residential and minor streets keep a single shared lane, and the rest of the carriageway becomes planted ground.

- **Eligible:** `minor` and `service` roads that aren't parking aisles, on built-up land (`urbanity() > 0.3`), at least 7 m wide, not bridges.
- **Change:**
  - The way's `width` drops to 3.6 m. That is still one continuous lane, so access, deliveries and emergencies all keep a route (guide: "a narrower necessary-vehicle strip").
  - For each freed side, a strip polygon goes into a new `F.strips` list and into `town.green`, so it gets the park hatch and keeps the road mask off it.
  - The strip ends 6 m short of junctions, where the road keeps its full width for turning.
- **Planting:** a row of street trees on each strip, every 8–10 m, mixing mature and young trees. Climate scales spacing and species (palms in hot, humid places; few trees and more mineral ground with stone dashes in hot, dry ones). Low planting covers what's left of the strip.
- **Effect:** every residential street visibly narrows to a lane between two green bands with tree rows. This is the single most visible change at any scale.

### 3.2 Boulevards (T03, transform)

On primary, secondary and tertiary roads at least 12 m wide, the cross-section is rebuilt within the same corridor:

- two lanes (one each way), as now;
- a planted median with trees (already built, now on every eligible road, not most);
- a **kerb-protected cycle track** on each side, separated from the lanes by a 1 m planted strip. This replaces the painted line;
- a wider pavement with a tree row.

As in §3.1, the strips are polygons that enter `town.green`, and the way's width shrinks to the two lanes. Cycle tracks become new `path` ways, so `footpaths()` draws them and cyclists ride on them. Trucks and buses stay.

### 3.3 Car parks become parks (T07, transform)

Surface parking (`parking_aisle` ways and their bays) is the least valuable ground in town.

- **Transform:** two thirds of car parks, chosen whole by cell, become pocket parks. Their aisles leave `ways`, and their footprint (the bays' union, from `parkingBays()`) enters `town.green`. Each one gets a grove of trees on a loose grid, a path through it, benches, and two or three garden beds. The remaining third keep their bays under solar canopies (as built), with fewer cars.
- **Visionary:** all of them, except a few accessible bays next to the nearest building entrance.

### 3.4 Pedestrian cores (T22, visionary)

In the densest part of town (`urbanity() > 0.7`), streets inside a cell-chosen district of about 300 m become pedestrian.

- Their ways turn into `path` ways with `sub: 'pedestrian'`, and their surface becomes a plaza shape, which `fillRoads()` already treats as paved.
- On them: **groves of trees on a grid** (planted in the plaza surface, as squares are), long rows of market stalls, tables, benches and many more people. A single service lane through the middle stays.
- The network stays connected: through routes (primary and secondary roads) are never pedestrianised, only the minor streets between them. This is the guide's rule: "every road becomes a park" is a failure; a connected movement system with fewer car-dominated spaces is the goal.

### 3.5 Trams (T03, T11, visionary)

A tram line along the busiest connected corridor in view:

- Pick the longest chain of joined primary and secondary ways through the drawing.
- Add twin `rail` ways with `sub: 'tram'` down its middle (the median moves aside). `railways()` and `trains()` already draw tram track, contact wire and tram cars.
- Add a stop every 400 m: a platform with a canopy of panels, reusing `platforms()` geometry.

A tram line is a strong, unmistakable future cue. The guide asks that it have a route with destinations, so it runs only along a connected chain at least 600 m long, end to end.

### 3.6 Water edges (L18, L19, L22, transform)

- **River and stream banks:** a 6–12 m vegetated margin on soft banks becomes `town.green`, with reed belts and lines of trees.
- **Canals:** rows of floating garden rafts moored along the quay.

Streets along the water stay; the margin only takes ground that isn't road, building or quay.

---

## 4. A real urban canopy (all depths from transform)

Trees are the strongest single cue for "green future" in linework, and the fastest to read at 1:4000.

- **Canopy target by climate:** each climate gets a target share of tree cover in town, for example temperate 30%, hot and humid 35%, mountain 20%, coastal 15%, and hot and dry 10% (concentrated shade, not lawns). On top of §3.1–3.4, trees are added where there is room: courtyards, the free ground of plots, the backs of blocks, school yards, church grounds and works edges. Placement stays on map-fixed grids, and only on ground the masks say is free.
- **Groves, not scatter:** trees are placed in clumps of three to seven, with mixed sizes. Clumps read as canopy at a distance, where single trees fade.
- **Courtyard trees (B03):** perimeter blocks with a hole big enough (over 300 m²) get one to three large trees in the court, as the guide's own example.
- **LOD:** the existing tree rules apply. Trees are thinned by `thin()` as ever, but from more candidates, so coarse scales keep a denser mass than today.

---

## 5. Roofs that read from a distance

### 5.1 Panels as tone (transform)

Panels get a **dense tone hatch** inside their outline in the `SHADOWS` pen (`cam.tone(0.6)`, the spacing shaded walls use), clipped to the panel face, in place of the sparse grid. At any scale, a roof with panels then reads as a dark, clean rectangle, unmistakably different from a hatched roof. The module grid stays only close up, drawn over the tone in `LINEWORK`. This one change makes every panel visible from 1:4000.

### 5.2 Roofscape (transform)

- **Panels:** the share of pitched roofs with panels rises to most of them. A row of houses gets one continuous band along the whole row.
- **Flat roofs** get a mix: panels on one part, and on the rest a **roof garden**, drawn with the park hatch over the roof face, planter boxes along the edge and small trees in planters. Roof gardens go on roofs over 400 m² whose building is at most 30 m tall. The guide treats deep roof gardens as special structures, so this is limited to roofs where a structural upgrade is plausible, and never on heritage buildings.
- **Visionary:** a lightweight **roof pavilion**, a glazed timber box under a pergola, on some slabs and towers: an occupied roof terrace.

---

## 6. Buildings that look lived-in and grown-over

- **Green walls (transform):**
  - Blank walls (party walls above a lower neighbour, gable ends without windows, windowless works walls) get a vertical **planting hatch** in the `GREENERY` pen, from a planter at the foot to 60–90% of the height. It is clipped to the wall face (`on: face`) and leaves a ragged top edge.
  - On walls with windows, trellis strips run between window columns.

  This turns many grey walls green at a glance.
- **Frames everywhere (transform):** every eligible slab gets its balcony frame, at the front as well as the back (the street front only where it isn't heritage). Frame bays are planted (as the wonder's are now) on about half of the floors.
- **Sky gardens (visionary):** on towers over 60 m, one or two **double-height planted terraces** cut into the volume at mid-height (B05). They show as a band with trees in planters.
- **Garden bridges (visionary):** between two tall buildings 12–30 m apart across a minor street, one planted footbridge at mid-height, on visible trusses.
- **Adaptive reuse (visionary, B23, T08, I10):**
  - Large retail and works sheds (B08, B19) get a glazed **market hall roof** with a row of skylights in place of the plain flat roof, and the car park in front becomes a market square with stalls.
  - Tall chimneys stay, wrapped with a climbing frame.

---

## 7. Landmarks and landscape at district scale

Each of these is rare by design: the guide wants "a few memorable sites", and they should be the first thing you notice.

- **Branching energy canopy (transform):** on the biggest square in view, a large tree-shaped canopy of panels on branching steel posts, about 20–30 m across. It reuses the station showpiece's branching posts, scaled up, with radial panel divisions so it reads as a solar "tree".
- **Community wind turbine (visionary):** one to three turbines on open land at the edge of town, at least 300 m from buildings, on cells fixed to the map. Tall, simple, unmistakable silhouettes, labelled in the catalogue as invented. The guide warns against inventing wind farms, so this is only on the visionary setting and never more than three per sheet.
- **Agrivoltaics and agroforestry (transform):**
  - In farmland, every other field strip becomes a **tree row** (alley cropping: lines of trees across the field every 20–30 m).
  - At visionary, some fields carry **raised solar rows** with crops or sheep beneath them.

  This takes the farmland from 2% new ink to a field pattern you can see.
- **Restored streams (visionary):** where a stream is mapped underground (`town.tunnels` on waterways, where the tiles have them), it is daylighted: drawn as an open stream with planted banks through the park or street above.
- **Cable car (visionary, mountain climate only):** one line from the valley floor to the nearest steep wooded slope in view, reusing `lifts()`, with a station canopy at each end.

---

## 8. Making "bold" measurable

Two checks join the LOD lab and the tests. Without them, "less subtle" can't be verified.

1. **New-ink share.** The lab report gains a column per case: the share of ink filed under solarpunk layers and facets (a fixed list in `catalogue.ts`: every entry in the `future` group). The targets are 30–45% at 1:1000 and 15–30% at 1:4000 for `transform`, and 40–60% at 1:1000 for `visionary`. A new unit test pins the list against the catalogue so nothing escapes it.
2. **Thumbnail difference.** The lab renders Today and Solarpunk at the Fit preview size (about 900 px wide), blurs both slightly, and reports the share of pixels that differ by more than a threshold. Target: over 25% at the default depth for the town cases. The lab's HTML page shows the two thumbnails side by side for review.

**Ink budget:** bold changes cost plot time. The proposed ceilings are +60% plot time for `transform` and +100% for `visionary` against Today, at any scale. Wasted ink must still rise by at most 2 points.

---

## 9. Line-art treatment for a bolder look

Plotter linework can't fill areas, but it can make tone and texture more expressive:

- **Greenery carries more of the sheet.** Garden streets, roof gardens, green walls and groves all use the `GREENERY` pen, so the colour balance of a solarpunk sheet shifts visibly toward green with any palette. Pens stay user data; no palette change is needed.
- **Panels in the `SHADOWS` pen as tone** (§5.1) give a second strong colour field on roofs.
- **Ornament on new structures (transform):**
  - curved braces at the posts of canopies, pergolas and frames (a quarter-arc between post and beam);
  - radial or herringbone **mosaic paving** on squares and pedestrian cores, as a light texture with a clear centre.

  The guide asks for "a local design vocabulary": braces follow the region's style (rounded in Mediterranean and tropical styles, straight diagonal elsewhere).

---

## 10. Wiring, determinism and tests

- **Module plan:**
  - `src/reshape.ts`: `reshapeTown()`, garden streets, boulevards, car-park parks, pedestrian cores, trams and water margins.
  - The canopy pass goes in `nature.ts` or a new `canopy.ts`.
  - Roof tone, roof gardens and pavilions go in `solar.ts` and `additions.ts`.
  - Green walls, sky gardens and bridges go in `additions.ts`.
  - Landmarks go in a new `landmarks.ts`.
  - Everything is wired through `render()` as now.
- **Order in `render()`:** `classify()` → `planFuture()` → `reshapeTown()` (only at `transform` and above), then the masks are filled from the reshaped town. The context buildings filter stays where it is.
- **Determinism and panning:**
  - Every reshape decision is keyed to `B.cell` or to the way's own ends.
  - Strip polygons are built from each way's own geometry, so a strip never depends on what else is loaded.
  - The tram chain is chosen from `town.nearby.ways` (the 250 m context), so it doesn't flip as the view moves.
  - New pan-test prefixes cover the strips, groves and trams.
- **Tests:**
  - Each existing solarpunk case gains a `transform` twin, re-using recorded map data, and Mollis and Midtown gain a `visionary` twin.
  - The `retrofit` goldens must stay identical.
  - Gates: `depth` gets a gate base like `solarpunk`, and each new feature's catalogue entry names its depth in `needs` through a new gate kind (`depth:transform`).
- **Catalogue:** each new feature gets an entry in the Solarpunk group, with its depth.

---

## 11. Milestones

Each milestone is one visible step and ships on its own. They are ordered by how much they change the look for the effort.

| | Milestone | What changes most | Depth |
| --- | --- | --- | --- |
| **N0** | `depth` setting, UI, gates, tests, the new-ink and thumbnail metrics | (none: the baseline for measuring) | all |
| **N1** | Garden streets, boulevards with cycle tracks, the urban canopy | Every street and the tree mass | transform |
| **N2** | Panel tone, the roofscape (row bands, roof gardens) | Every roof | transform |
| **N3** | Car parks to parks, green walls, frames everywhere | Car parks and blank walls | transform |
| **N4** | Water margins, agroforestry, energy canopy, ornament | Rivers, farmland, the main square | transform |
| **N5** | Pedestrian cores, trams, sky gardens, bridges, roof pavilions, reuse, wind, agrivoltaics, daylighted streams, cable car | District landmarks | visionary |

After each milestone: measure the new-ink share and thumbnail difference against the targets in §8, compare LOD lab runs, and look at the six golden places at Fit size side by side with Today.

---

## 12. Decisions for you

1. **Default depth.** `transform` (proposed) or keep `retrofit` as the default and let people opt in?
2. **Where the depth control lives.** A selector at the top of the Solarpunk part of the Town section (proposed), or a third state on the toolbar switch (Today | Solarpunk | Visionary)?
3. **Ink budget.** Are +60% plot time for `transform` and +100% for `visionary` acceptable? The bold look can't be had at today's +10%.
4. **Invented landmarks.** Wind turbines, trams, cable cars and pedestrian cores are speculative, so they're limited to `visionary` and labelled. Keep them, or leave some out (the wind turbines especially)?
5. **Roof gardens.** Allowed at `transform` on big, low flat roofs (proposed), or only at `visionary`?

---

## 13. Risks

- **Losing the place.** Bold changes could make the town unrecognisable. Mitigation: never move buildings, water or the street network's routes. Only change carriageway width, ground cover, roofs and additions. Squares, landmarks and heritage keep their geometry. The thumbnail check has an upper bound too: if over 60% of pixels differ, the drawing has probably lost the place.
- **Clutter.** Groves, green walls and tone all add ink. Mitigation: tone hatching follows `cam.tone()` and stops where it would close up, groves thin with `thin()`, and the LOD lab's waste check stays the gate.
- **Mask side-effects.** Shrinking roads changes every feature that reads `M.road` (traffic, kerbs, crossings, parking, power poles). That's intended, but each one needs a look, especially zebra crossings, kerbs at strip ends, and parked cars, which must not end up on the strips.
- **Performance.** More green polygons and trees cost raster and trace time. Measure `midtown` and `amsterdam` render time before and after N1. Strips are simple quads, but there are many.
