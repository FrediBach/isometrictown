# Abandonment: plan

**Status (2026-11-19):** M0 to M5 are built: the slider runs from the town as it is to overgrown ruins. M6 (polish) remains, with broken bridges and roofless canopies, which aren't built. Decisions that are yours to make are in §12. Each has a recommendation, and the plan assumes it until you say otherwise.

**Notes from M5.**
- *Growth* (`growth.ts wildGrowth()`, filed as `wild-growth`) plants on a map-fixed grid 6.5 m apart. Each spot's ground goes wild over its own span of the slider: gardens 0.25–0.85, parks 0.3–0.95, open country 0.35–1, fallow fields and meadows 0.45–1 (young woodland), ruin floors and yards 0.5–1, roads 0.65–1. Of the spots on each, a share (gardens 50%, parks 45%, fields and ruins 40%, open 22%, yards 18%, roads 10%, scaled by Trees) comes up at its own point and grows from a bush into a sapling into a tree; a third stay bushes. Conifers as `WILD` has them for the region. Nothing is taken away as the slider rises (a young conifer is never narrower than its bush); the unit test checks it.
- *Ruins stay readable.* Crowns that would reach over a standing wall stay bushes, and spots that can't keep even a bush clear are left out. Ruins fill a mask of their open floors (the footprint inset by the wall and 0.8 m more) as they are built, and only growth stands there; everything else still keeps off the footprint. No explicit cap on hidden wall length was needed: at 1, Mollis, Betschwanden and Emmental read as footprints under trees.
- *Coarse scales* grow fewer: the share is thinned by `(size on paper of 6.5 m / 4 mm)²` where that is under 1, so the growth keeps about the same tone at any scale. That halved its added plotting time at 1:2500.
- *Ivy* climbs the outside walls of shells and ruins in view (`ivy()`, GREENERY, filed under `trees` with the facet `ivy`): a wavy stroke up to 50–90% of the wall, on up to 35% of walls by the end.
- *Left over from M4:* pylon spans break and hang down from one tower (pylons stand); wooden poles lean, lie down and go, and wires run only between upright poles, a wire hanging from the last one standing; garden and allotment sheds lose their roofs, then fall; trampolines go; pitch markings and goals go, pitch by pitch (0.2–0.6).
- *Ink at the end of the slider,* against 0, across Mollis, Emmental, Midtown and Nördlingen: at 1:1000 plotting time −29% to −5%, at 1:2500 +16% to +21% (Midtown +92%, its frames and their shadows); wasted ink within 1.3 points either way, except Midtown at 1:1000 (+2.7).
- *Not built:* broken bridge decks (D6), roofless platform and bus-shelter canopies, the region's endpoints beyond conifer shares (§4.4: sand drifts, higher arid ruins, denser tropical growth), orchards and vineyards running wild, hedges growing out, tufts inside ruins.

**Notes from M4.**
- *Pace, again.* Fates are now `p = (d − 0.3 u) / 0.7`: each building starts at 0.3 × its resistance and takes 0.7 of the slider, instead of M3's linear `d · 2.2 − 1.2 u`, which made Mollis all footprints by 0.75. Now Mollis is derelict by 0.35, mostly shells at 0.5, mostly broken shells at 0.65 and mostly footprints from 0.75, all of them by 0.9.
- *`stand`* is the share of a building's wall height left: all of it until progress 0.65, then down to 12% by 1 (churches 45%, civic 30%, towers 18%, blocks 15%).
- *Ragged walls* (`ruins.ts ragged()`): each wall of the band breaks into runs (1.4 m, or 2.5 mm on paper if longer), each standing to `stand × (0.4 … 1.3)` of the eaves, keyed on the run's middle, with up to a whole `stand` more within 2.5 m of a corner, so corners stand longest. Steps too small to see on paper are levelled down to the lower neighbour. Each run has its own outside and inside faces, top, end face where it steps, shade hatching and shadow. Gables fall at their own point once the walls start to come down. Window openings in ragged walls are not drawn.
- *Fallbacks.* A footprint that can't be inset by the wall's thickness is tried a hair thick, then drawn as its outside walls open at the top. No building keeps its roof past the shell stage any more (before, those fell back to an intact building).
- *Rubble* (`heap()`) lies along the foot of each wall, outside (unless a neighbour stands against it) and inside: a slope from up to 1.1 m on the wall to an uneven toe up to 2.2 m out, wider and higher the more height has gone, with a few stones. Each toe point's reach is keyed on where it is, so the toe runs on unbroken from run to run; per-run heaps had looked like fur.
- *Party walls* (§5.1): `classify()` now records which building is next door along each party edge (`Info.partyWith`), and `settle()` works out every fate before anything is drawn (kept on `Build.fates`), lowering a party height to the lowest a ruined neighbour's walls come down to (`LOWEST`), so the wall it leaves bare is drawn.
- *Frames* (`frame()`): towers, and flat-roofed blocks 15 m or taller, lose their walls and stand as floor slabs (a face and one outline each, at least 2.5 mm apart on paper) on columns (at least 12 m apart, boxes where they read, else strokes). The façade gives way from the top down, from 85% of the floors at the start of the shell stage to none by 0.75 of the tower's progress; top floors go as it falls.
- *Ink.* Against 0, at 0.85 across Mollis, Emmental, Midtown and Nördlingen at 1:1000 and 1:2500, wasted ink is lower or within half a point, except Midtown, and plotting time −36% to +5%. Two fixes came from the lab: a wall's inside top edge is drawn only where it stands at least 2.3 pen widths clear of the outside one on paper (foreshortening closed walls running away from the viewer up into one blot), and walls too low on paper to show their foot apart from their top keep only the top.
- *Midtown costs more:* +80–90% plotting time at 1:2500 and 2–5 points more waste. Gutted towers are see-through, so frames behind show through frames in front. Keeping façades low on the floors helped little; thinning further would lose the look. Left as it is.
- *Image mode* turns its rows into terraced footprint ruins; the landscape at 1:2500 scores 0.525 at 0.9 (0.567 at 0), as a ruined town is much lighter than the one laid out.
- *Not yet:* power lines and poles coming down, broken bridge decks, roofless platform and bus shelter canopies, garden sheds and trampolines (all planned for M4; they go with M5 now), window openings in ragged walls, church towers falling (they stand to the end, as §5.6 says).
- *Tests:* ragged walls only come lower as `stand` falls, never above the eaves, with rubble once height has gone; a frame keeps fewer floors as it falls; goldens `midtown-abandon-80` and `mollis-abandon-100`.

**Notes from M3.**
- *Shells are caught where walls are built,* not drawn by a generator of their own. `house()` (and so `church()`) already knows its wings, eave height and which ends are gables, so for a shell it calls `shell()` with the wall ring at the eaves and `gable()` on each outside, non-party end: full triangles for gabled roofs, trapezoids to 60% of the rise for half-hipped, none for hipped. Every other roof (skirt, mansard, shed, sawtooth, mosque, temple, flat) skips its generator and `body()` makes a plain shell to the eaves the roof sat on. Churches keep their towers and spires; they fall in M4.
- *The wall band* (`ruins.ts shell()`) is the footprint inset by the wall's thickness (`offsetRing()`), run backwards so its faces turn inwards, and both go through `prism()`: outside faces with doors and shop fronts, inside faces with windows only. The tops are one face with the inside rings as holes. Thickness goes by kind (sheds 0.22 m, houses 0.35 m, blocks and towers 0.4 m, churches and civic buildings 0.6 m) and is drawn up to 2.5 times as thick to show its top (`LOD.wallTop`, 0.8 mm); thinner on paper, walls are a hair thick and only the outside top is drawn. Of 1,293 shells in Nördlingen at 0.55, 9 footprints couldn't be inset and kept their roofs.
- *Insides are shaded.* At 1:2500 the near wall hides a shell's floor and the far wall's inside face looked like a flat roof. Every inside face is now hatched as in shade (`shadeWall(…, inShade)`), whichever way it faces, which is what tells a shell from a roof at a distance.
- *Party walls* show their top only along the inside edge, so two shells side by side show a wall's thickness between them and don't both draw one line; an intact neighbour's roof hides it. The plan's recomputing of party heights from fates waits for M4, when walls first come down below a neighbour's eaves.
- *Windows in shells* are empty openings: no glass, bars, cracks or shutters; boards nailed over ground-floor windows stay. Shadows are cast wall by wall, so light falls into the shell. Interiors keep the footprint mask, so nothing grows or parks inside until M5.
- *Pace.* `SPREAD` went from 0.6 to 1.2: buildings had gone over only a quarter of the slider (550 of Mollis's 564 were shells at 0.6). Now shells arrive between about 0.35 and 0.65 (43, 378 and 551 at 0.35, 0.5 and 0.65).
- *Cost.* Against 0, at 0.65 across Mollis, Emmental, Midtown and Nördlingen at 1:1000 and 1:2500, wasted ink is within 1.5 points either way (lower at 1:2500) and plotting time −8% to +10%, except Midtown (+35% to +47%): its towers are tall hollow shells with windowed, shaded insides, which M4's frames replace. Weeds were made bigger (`LOD.weed`) after the lab found them specks.
- *Tests:* `test/unit/ruins.test.ts` (the band's hole lies inside the footprint, nothing stands above the walls, one shadow per wall, slivers are refused, gables rise to the ridge or stop short); the golden `nordlingen-abandon-65`.

**Notes from M2.**
- *Fates are made in `building()`,* not in a pass of their own: it already swaps in the building's seed, and now sets `B.fate` from `fateOf()` the same way, so no change to `render()`'s order was needed. A building's resistance is half its 150 m neighbourhood, three tenths its own hash (half of that its terrace row's) and a fifth how sturdy its kind is. Progress was `d · 1.6 − 0.6 · u` (see M3 for the change).
- *The catalogue counts* `closed-up` and `derelict` buildings: `building()` marks its solids and `render()` adds the mark to the building's facets.
- *Windows* (`facades.ts worn()`): shuttered windows close; three quarters of ground-floor windows are boarded (frame and three slightly skewed boards, `LOD.board`); the rest break, a jagged line across one corner where glazing bars would show, and lose their bars. Doors are boarded with a cross; shop windows are boarded in panels and lose their awnings. Windows drawn as single strokes or rows don't change.
- *Roof holes* are discs in plan, cut out of the roof hatching (`roofs.ts outside()`); every third stroke runs on across them as a bare rafter. Up to three per building, opening from progress 0.3 and growing. They need no change to the depth buffer.
- *Dormers stay* until the roof goes (M3): taking them off left the roof looking untouched, not derelict. Chimneys, rooftop boxes and solar panels go, and the town hall's flag comes down early.
- *Kerbs* break in 6 m stretches (`kept()` with a share that never goes: half on main roads, a third on others, so the street pattern stays). Scraps under 1.5 m are dropped. Bends follow the stretch at their vertex.
- *Cracks* (`streets.ts cracks()`, `streets:cracks`) are zigzags in from one kerb, sized by their own length (`LOD.crack`) and drawn straight when the zigzag wouldn't read, with an upright tuft of weeds later (`LOD.weed`). At 1:2500 this halved their wasted ink, to about 10%.
- *Lamps, fences and fields:* lamps lose their heads, lean, lie down and go (`stepsGone()`, four steps); garden fences lose rails bay by bay, then posts; driveway cars follow `parkedCar()`; mapped farmland goes fallow as meadow and keeps its edges and hedgerows. Image mode's fields do the same.
- *LOD lab* takes `--set key=value,…` for any setting. At 0.5 against 0, across Mollis, Emmental and Midtown at 1:1000 and 1:2500, wasted ink stays within 0.5 points either way and plotting time falls 4–11%.
- *Tests:* fates and roof holes never go back, stepped decay is complete at the end of its span, and the new golden `betschwanden-abandon-50` shows a derelict village.

**Notes from M0 and M1.**
- *No `Build.decay`.* Modules read `B.set.abandon` directly; a field on `Build` would only copy it. The `Wild` field and `Fate` arrive with M2 and M5.
- *`decay.ts` so far:* `stretch()`, `resistance()` (a 150 m map-fixed patch blended with the thing's own hash), `gone()` and `left()` for things at a position, `past()` for things already keyed on their own cells (trains, herds, racing, helicopters), `LEAVES` with each kind of life's span, `parkedCar()` for the car-or-wreck-or-gone fate shared by kerb parking and bays, and `kept()`, which cuts a line into map-fixed runs and drops the faded ones (footpaths, taxiway and runway side lines).
- *Salts 9800–9856* are taken by decay; grep before using one.
- *Wrecks* are filed by facet (`cars/wreck`, `cars:parking/wreck`), since `extra()` overwrites a solid's `part`. They count in the census as `wreck`, and not in `counts.cars`.
- *Trains* that have stopped still count as placed on their track, so no other train comes in to take the place.
- *Not yet:* standing carriages in stations, tractors left as wrecks in fields, sunk boats, playground swings and pitch markings (with §8's ground in M5), the one last plane left behind (D5).
- *Tests:* `test/unit/decay.test.ts` checks nothing is gone at 0 and everything at the end of its span, nothing comes back, things go over the span rather than at once, fates stay put under a pan, and `kept()` only shrinks. Every existing golden is unchanged. `mollis-abandon-35` is the first golden with the slider up (40 wrecks, no moving cars). The gates test draws its Abandonment base at 0.3.

One new slider, **Abandonment**, takes any drawing, from the map or from an image, from the town as it is now (0) to a town people have long left: first fewer people and less traffic, then boarded windows and roofs falling in, then roofless shells, and at the end only overgrown ruins, mostly low walls along the old footprints, with trees growing out of them. At 0 nothing changes, down to the last stroke.

Read [architecture.md](../architecture.md), [render-pipeline.md](../render-pipeline.md), [coordinates.md](../coordinates.md) and [lod.md](../lod.md) first.

**Contents:** 1 What the slider does · 2 Rules it keeps · 3 How it fits the pipeline · 4 The decay model · 5 Buildings · 6 Streets, rail and infrastructure · 7 Life and traffic · 8 Ground, gardens and growth · 9 Settings, interface and catalogue · 10 Testing · 11 Milestones · 12 Decisions for you · 13 Risks

---

## 1. What the slider does

The slider runs through four phases. They overlap: at any setting some streets are further gone than others, as in a real town.

| Slider | Phase | What you see |
| --- | --- | --- |
| 0 | Lived in | The drawing as it is today. |
| 0–0.25 | **Emptying** | People, moving traffic, trains, aircraft and ships thin out and are gone by the end. Herds and farm machines go. Fields still look ploughed. The first houses on the outskirts have their shutters closed and windows boarded. Road markings begin to fade. |
| 0.25–0.5 | **Neglect** | Broken windows, holes in roofs, chimneys and dormers gone, fences with gaps, sheds leaning. Some cars stay where they were left. Weeds grow in road cracks. Fields lie fallow as meadow, lawns go shaggy and bushes appear in gardens. |
| 0.5–0.75 | **Collapse** | Roofs fall in. Houses stand as shells with their gables and empty window openings. Wall tops break and rubble lies at their feet. Kerbs break up, lamps lean and fall, power lines hang down and wooden poles lean. Trees grow in gardens and through pavements. |
| 0.75–1 | **Overgrown ruins** | Walls are mostly down to the footprint, from knee to head height. Corners, gable ends and church towers stand longest. There are trees inside the ruins and scrub everywhere. Minor roads are faint tracks, main roads broken strips. Fields have become young woodland. Water, landforms and the street pattern stay where they were. |

At 1 the town still reads as a town from above: the street pattern and every footprint stay legible. That is the point of the drawing, so growth must never bury the ruins (§8.4).

---

## 2. Rules it keeps

1. **0 is the identity.** With Abandonment at 0 every golden stays byte-identical. Every new branch is behind `d > 0`, and no existing hash changes its salt or arguments.
2. **Monotone.** Raising the slider never brings anything back. A wall that is 2 m high at 0.8 is no higher at 0.9, a car that is gone at 0.3 stays gone at 0.4, and a tree growing at 0.6 is still there at 0.7. This is what makes a series of drawings at rising settings read as time passing, and it is tested (§10).
3. **Deterministic and fixed to the map.** Each thing's fate comes from `hash(k0, k1, B.set.seed, SALT)` on its position key, and patch-wide decisions come from `B.cell()`, so panning never changes which house has fallen. Salts are new and grepped for.
4. **Linework and LOD as everywhere else.** Each new mark has an `LOD` rule and a catalogue entry. Rubble, cracks and weeds use `cam.gap()` and `cam.tone()` spacing. Pen constants only, never raw numbers.
5. **Pens are unchanged.** Decay changes geometry, not colour. Ruins use LINEWORK and ROOFS as buildings do, growth GREENERY, so recolouring stays instant.
6. **Settings stay in charge.** Trees at 0 still means no trees, so no wild trees either. Life off still means no people. Ground off means no fallow-field texture. Traffic sets how many cars the town had, and Abandonment takes them away from there.

---

## 3. How it fits the pipeline

Map mode and image mode both end in a `Town` that `render()` draws. Abandonment works entirely inside `render()` and the feature modules, so it works in both modes without separate code paths, and it needs no new map data and no network.

```
loadTown / imageScene ─► Town ─► render()
                                   classify()
                                   decay(town, B)   ◄─ new: a Fate for every building and a Wild field
                                   party walls again with the heights decay left
                                   … ground, buildings, life, growth, lines …
```

- **New module `src/decay.ts`.** It holds the phase curve, `progress()` (§4.1), the `Wild` field (§4.3), each building's `Fate` (§5.1) and the shared constants. Feature modules ask it and stay in charge of their own drawing.
- **New module `src/ruins.ts`.** It draws buildings that have lost their roofs (§5.3–5.5), with ragged walls, rubble and openings. It sits beside `buildings.ts` and reuses `prism()`, `shadeWall()` and `offsetRing()`.
- **`Build` gains `decay: number`** (the slider, 0 for unchanged) and **`wild: Wild | null`**, so every module reads them the same way. `Building` gains an optional `fate` that `decay()` sets.
- **The cached town must not change.** Image mode caches its built `Town` across redraws (`image.ts`, keyed on `STRUCTURE`), and `abandon` is not in that key, so moving the slider costs no new layout. `decay()` therefore writes only to the per-render copy (`town = { ...town, buildings: … }`, as the title clearing does) and to new fields. It never changes `b.h` or `b.shape` in place.
- **Pass order.** `decay()` runs after `classify()` and before `planGround()`, because ground, masks and trees all read fates. Ruins fill their faces before `finishDepth()`, like any solid. Wild trees join the tree list before sprites are filled. Cracks, faded kerbs and weeds are ground lines, drawn after `finishDepth()`.
- **Masks.** A roofless ruin fills `M.foot` only with its wall band, not its whole footprint, so trees and scrub can grow inside it. A new mask `M.ruin` covers the inside of roofless ruins, so cars, people and parking stay out. Late in the slider, the overgrown parts of minor roads are cleared from `M.road` for tree placement only, through a new `M.overgrown` that `placeTrees` and the wild growth read. Traffic still reads `M.road`.

---

## 4. The decay model

### 4.1 Progress

The slider `d` is turned into a **progress** `p ∈ [0, 1]` for each thing:

```
p = clamp((d · (1 + σ) − σ · u) , 0, 1)
```

`u ∈ [0, 1)` is the thing's **resistance**, and σ (about 0.6) sets how far apart the first and last things go. At d = 0, p is 0 for everything (rule 1). At d = 1, p is 1 for everything. p never falls as d rises (rule 2). Every thing reads its own state from its p through thresholds, so a house can be boarded up (p 0.15) while the one opposite is roofless (p 0.55).

### 4.2 Resistance

`u` blends three parts, so decay comes in neighbourhoods and not as speckle:

- **Patch (≈ 50%).** Smooth value noise on map-fixed cells of about 150 m (`B.cell(x, y, 150)`, bilinear between cell hashes). Whole streets empty together.
- **Own (≈ 30%).** The thing's own hash, so neighbours are not identical. Terraced houses share the terrace's `info.seed` for half of this, so rows mostly go together, with a single house fallen here and there.
- **Kind (≈ 20%).** Sturdy things last. Churches, castles and civic buildings resist most, towers and large stone blocks next, then houses. Sheds, garages and allotment huts go first. Urbanity (`traffic.ts urbanity()`) adds a little: the outskirts empty first and the centre last.

Everything that decays draws its `u` this way, with its own salt: buildings, roads, fences, power lines, fields.

### 4.3 The `Wild` field

How far nature has taken back a piece of ground. `wild(x, y)` gives p for the ground itself, with the same patch noise and a resistance by surface: gardens, fields and parks go wild first, verges and minor roads next, main roads and squares last. Growth (§8) reads it. It is computed on demand, so there is no raster to keep in step with the view.

### 4.4 Region

The regional style changes the endpoint, not the timing:

- **Arid:** little growth. Sand drifts against walls, and ruins stand higher because mud brick and stone last in dry air.
- **Tropical:** growth is fastest and densest, and walls go further down.
- **Nordic and alpine:** conifers in the growth.
- **Mediterranean:** scrub rather than woods, with cypresses and olive-like broadleaves.

These sit in a `DECAY` table in `decay.ts`, keyed by style, next to `WILD` in `ground.ts`.

---

## 5. Buildings

This is the largest part of the work. A building's progress sets its **stage**:

| p | Stage | Drawn by |
| --- | --- | --- |
| < 0.12 | 0 Lived in | today's code |
| 0.12–0.3 | 1 Closed: shutters shut, windows boarded on the ground floor, no shop awnings | today's code, with switches |
| 0.3–0.5 | 2 Derelict: windows broken, holes in the roof, no chimneys, dormers or rooftop boxes, sagging ridge | today's code, with switches |
| 0.5–0.65 | 3 Shell: no roof, walls at full height, gables standing, window openings | `ruins.ts` |
| 0.65–0.85 | 4 Broken shell: ragged tops, gables partly down, rubble | `ruins.ts` |
| 0.85–1 | 5 Footprint ruin: walls 0.4–3 m, corners higher, rubble mounds, growth inside | `ruins.ts` |

### 5.1 Fate

`decay()` gives each building a `Fate`: `{ p, stage, stand, keep }`. `stand` is the share of its height its walls keep (1 for stages 0–3, falling to about 0.15 by p = 1, with landmarks keeping more). `keep` holds per-building choices: which gable falls, whether the tower stands. `decay()` then works out party walls again from the heights that are left, so when a terraced house falls, its neighbour's side wall shows. This is a small function taken out of `classify.ts` and reused, not a second classify.

Counts and census gain `derelict`, `shell` and `ruin` facets, so the catalogue and the stats can say how many of each are drawn.

### 5.2 Stages 1 and 2: switches in today's code

These are small changes in code that already exists, each read from `B.fate` (set by `building()` like `B.seed`):

- **`facades.ts`:** a window is drawn closed (shutters shut where the style has them), **boarded** (the frame with two or three horizontal planks), or **broken** (the frame without glazing bars, with one diagonal crack or a missing corner pane). Each window decides by its own hash, so the share rises with p. Shop fronts lose their awnings and get boards.
- **`roofs.ts`:** **holes** where slates or tiles are gone. A hole is an irregular quad on the roof plane, with no hatching inside and its rafters drawn as two or three strokes across it. It is a gap in the hatch, not a gap in the depth buffer, so it costs no visibility change. In late stage 2 the ridge sags a little (the ridge line is drawn as a shallow curve) and one slope may have a hole that reaches the eave.
- **`buildings.ts`:** chimneys, dormers, solar panels, rooftop boxes, flags and helipad helicopters go in stage 2, each on its own hash. Balconies lose their railings.

### 5.3 Stage 3: shells

A roofless building is drawn as a **wall band**: the outer ring and a ring inset by the wall thickness (0.35 m for houses, 0.5 m for stone landmarks, 0.25 m for sheds), made with `offsetRing()`. The band goes to `prism()` as the outer ring with the inset ring as a hole. `prism()` already draws holes, and its facing test does the right thing: from above you see the outside of the near walls, the inside of the far walls and the tops between them. Where the band is too narrow to read at the scale (`LOD.wallTop`, below), the top is a single line.

- **Gables stay.** A house that had a gabled or half-hipped roof keeps its gable triangles above the eaves, using the profile `house()` would have given it. That outline is the strongest sign of a ruined house.
- **Openings.** Window openings are outlines on the wall faces, as windows are today, with no frames or bars. True holes in the depth buffer, so that you could see through a window, are left out of the first version (§12, D4).
- **Courtyard blocks, mansards and skirt roofs** lose their roof, and the band follows every ring of the footprint.
- **Churches** keep the nave walls and the tower, which keeps its roof or spire longer than the nave: its own `p` is reduced (§5.6).
- **Towers and large flat-roofed blocks** become **frames** (§5.5).

### 5.4 Stages 4 and 5: ragged walls and rubble

Walls no longer have a level top. **`ragged(B, band, profile, out)`** in `ruins.ts` builds each wall edge as a strip of quads with a varying top. The profile is a stepped, piecewise-linear height along the edge, made from map-keyed hashes per metre of wall (keyed on the wall's ends, so it doesn't change with the view) and follows three rules:

- **Corners stand higher** than the middle of a wall, and wall ends next to a corner fall away in steps, the way masonry breaks.
- **Openings break first.** The wall over a window opening falls before the wall beside it, so ruins keep their rhythm of piers.
- **Monotone.** The profile at p is the profile at 1 scaled up from the floor: each point's height is `min(H, H · f(p) + slack(t))` with `f` falling. A wall point never rises as p grows.

The top strip between the outer and inner profile is a face, its two edges are lines, and the vertical steps are lines. `shadeWall()` already takes a `top(t)` function, so shaded walls follow the broken top. Shadows cast from the band's rings at the wall height, not from the whole footprint at its old height.

**Rubble** goes where walls have fallen: low mounds along the foot of a broken wall, outside and inside, as many as the lost height warrants. A mound is a solid, a low irregular wedge whose faces go to the depth buffer, with an outline and a few short stone strokes (`LOD.rubble` for the mound, `LOD.stones` for the strokes). At stage 5 the inside of the footprint is mostly mound and growth.

### 5.5 Frames for towers and big blocks

Concrete buildings don't come down like stone ones. Buildings classified `tall`, `apartment` or large `industrial` become a frame from stage 3: floor slabs as thin flat plates at each storey, columns at the corners and every 6 m along the edges, and the façade gone from floors at random, top floors first. From stage 4 the upper floors are missing and the top slabs hang at an angle, and from stage 5 a stump of two or three floors stands on a rubble mound. Each slab is a `prism()` 0.3 m thick, and each column a thin box. The frame has its own LOD rules (`LOD.slab`, `LOD.column`) and falls back to a ragged band where the frame wouldn't read.

### 5.6 Landmarks and terraces

- **Churches, castles and town halls** have their `u` raised (§4.2) and keep `stand` at about 0.5 at the end. A church tower stays upright as the last tall thing in the town. The town hall loses its flag in stage 2.
- **Terraces:** each house has its own fate but leans on its row (§4.2), so a row falls mostly together. Party walls follow §5.1. The gable end of a surviving house next to a fallen one shows its full profile.
- **Seed locks.** A building clicked to its own seed keeps it, and its fate uses that seed, so a locked house falls the same way every time.

### 5.7 Ivy

From stage 2, walls facing the viewer can carry ivy: a few climbing GREENERY strokes on the wall face (a `Line3` with `on` set to the face, so it shows only where the wall does), growing from the ground with p. On ruins, ivy climbs the corners. It belongs to the `trees` layer, part `ivy`, and has its own LOD rule.

---

## 6. Streets, rail and infrastructure

The street pattern stays: roads are the skeleton that makes the ruin a town. What changes is their surface and their edges.

| Thing | Module | Over the slider |
| --- | --- | --- |
| Road markings, zebras, parking bays, runway marks | `infra.ts` | Dashes and stripes drop out one by one on their own hash, from 0.1. Gone by about 0.5. |
| Kerbs | `streets.ts curbs()` | Gaps open in kerb lines from about 0.3. `groundSeg` is cut into map-keyed runs of a few metres and each run drops on its hash. By the end only scraps remain on minor roads. Main roads keep more. |
| Cracks | `streets.ts`, new | From about 0.25, short zigzag cracks across and along carriageways, LINEWORK, spaced with `cam.gap()`, `LOD.crack`. They grow longer and more frequent with the road's p. |
| Weeds | `streets.ts`, new | Grass tufts in the cracks (GREENERY), then bands of scrub creeping in from the verges, so minor roads narrow. Late, minor roads go into `M.overgrown` and trees may stand on them. |
| Footpaths | `streets.ts footpaths()` | Dashes drop out from 0.3. Paths in parks and woods go first. |
| Lamps | `streets.ts lamps()` | Heads go, then the posts lean (a tilted stroke), then they lie on the ground, then they are gone. |
| Bridges | `infra.ts bridges()` | They stand. Railings get gaps. At the end, a few spans of footbridges and minor road bridges have a gap in the deck (decision D6). |
| Railways | `streets.ts railways()`, `trains.ts` | Trains stop in the Emptying phase. A few carriages stay standing in stations and sidings. Later, sleepers drop out, rails get gaps and the trackbed fills with scrub. Overhead masts stay longest. Contact wire goes at about 0.5. |
| Platforms, bus stops, fuel stations | `infra.ts`, `sites.ts` | Canopies lose their roofs as buildings do (stage 3 from the same p), then their posts. |
| Power lines | `power.ts` | Steel pylons stay to the end. Spans of wire break and one end hangs down, from about 0.45. Wooden poles lean from about 0.5 and lie down by 0.8. |
| Airfields | `infra.ts airfields()`, `aircraft.ts` | Aircraft gone in the Emptying phase, except perhaps one left on the apron (D5). Runways crack and markings fade like roads. |
| Ports | `sites.ts ports()` | Cranes stay. Containers are left where they stood and then lose their doors. |
| Squares and fountains | `sites.ts squares()` | Fountains dry up (no water strokes). Statues stay. Trees through the paving late. |

---

## 7. Life and traffic

All of these are densities that already exist. Each is multiplied by a factor from the phase curve, and the hash that already decides each one stays the same. A thing is kept only if `hash < density × keep(d)`, and so things drop out one by one and never come back (rule 2).

| Life | Factor | Notes |
| --- | --- | --- |
| Moving cars, buses, lorries | 1 → 0 by d ≈ 0.2 | `traffic.ts amount` |
| Parked cars | 1 → 0.3 by 0.25, then wrecks | The remaining cars are **wrecks**: the same car, drawn with no wheels, a little askew. Some are left at odd angles on the carriageway. Wrecks thin out after 0.6 and are gone by 0.9 under growth. A new `wreck()` in `vehicles.ts`. |
| People | 1 → 0 by 0.15 | `sites.ts people()`, sport players |
| Livestock, farm machines | 1 → 0 by 0.2 | A few tractors are left in fields as wrecks, like cars. |
| Trains | 1 → 0 by 0.2 | Standing carriages, see §6. |
| Aircraft | 1 → 0 by 0.1 | |
| Ships and boats under way | 1 → 0 by 0.2 | `ships.ts`, `infra.ts sailing()`, ferries |
| Moored boats | 1 → 0.5, then wrecks | Some sink at their moorings: the hull drawn tilted and cut at the waterline. |
| Beaches, campsites, playgrounds | | Parasols and towels gone by 0.15. Tents gone, caravans left. Swings hang from one chain, then the frames fall. |
| Shop and town centre urbanity | unchanged | It still sets building kinds and heights through `classify()`, which is the town as it was. |

`counts.cars` keeps counting moving and parked cars. Wrecks go into a separate `wrecks` facet in the census, so the stats don't claim traffic in a dead town.

---

## 8. Ground, gardens and growth

### 8.1 Fields and open land (`ground.ts`)

Each ground cover follows the succession of abandoned land, read from `wild(x, y)`:

- **Fields:** furrows → stubble and fallow (meadow tufts) → meadow with bushes → scrub → young woodland. Field patterns fade: hedgerows remain and grow wider, and become the lines that show where the fields were.
- **Orchards:** rows stay but gaps appear, with bushes between them.
- **Vineyards:** rows break up and fill with scrub.
- **Allotments:** sheds collapse (as buildings do), plots go to scrub.
- **Meadows and pastures:** more bushes, then trees.
- **Cemeteries:** headstones lean (a small tilt per stone), then grass covers them.
- **Pitches:** markings fade (as road markings do), then meadow.
- **Pools:** dry, with the basin outline only.

The change is made in `planGround()`, which gives each patch the cover it has at d: a field that has gone wild is planned as meadow or scrub, and the existing `drawGround` draws it. No new textures are needed for this, only new routes through the existing ones.

### 8.2 Gardens (`gardens.ts`)

Fences get gaps and lean, as kerbs and poles do. Garden sheds and trampolines follow their own fates. Hedges grow wider and lose their clipped edge. Garden trees grow bigger (a larger crown) and new ones seed.

### 8.3 Parks and woods

Lawn hatching turns to meadow tufts, then to scrub with trees. Woods spread at their edges into neighbouring wild ground. Park paths go as footpaths do.

### 8.4 Wild growth (`nature.ts`, new `wildGrowth()`)

One new tree source, `wild-growth`, plants bushes, saplings and trees where `wild()` is high: in gardens, ruins, verges, overgrown roads, fallow fields and the trackbed. It uses the existing tree sprites, `regionalTrees()` and `legibleTrees()`, the `treeSpacing` LOD rule, and density patches, so it looks like the trees already drawn. Its density scales with the Trees slider.

Growth must leave the ruins readable (§1):

- No tree stands on a wall band (`M.foot`).
- Crowns in a ruin are small, and only big ruins get trees inside.
- A cap on the share of footprint edge length that crowns can hide, checked as the trees are placed: a tree that would hide more of a ruin's walls than the cap allows is left out or made a bush.
- Bushes and scrub come before trees, and are lower.

---

## 9. Settings, interface and catalogue

- **Setting.** `abandon: number` (0–1) in `Settings`, `DEFAULT_SETTINGS` at 0, in `NumberKey`, and in `FORMAT` as the phase name and percentage (`Neglect · 40%`).
- **Control.** In the Town section below Traffic, for both sources: `<NumberSetting name="abandon" label="Abandonment" … hint="From the town as it is to overgrown ruins: people leave, houses fall in, nature takes over." />`. The section summary adds the phase when it isn't 0. See D1 for where it goes.
- **Image mode.** `abandon` stays out of `STRUCTURE` and `LOOK`, so the slider never lays the town out again. Likeness is scored on the drawing as drawn, so a ruined town scores lower: §7's materials are measured on living towns. That is fair, and it shows in the score (D3).
- **Title.** The cinematic title is not affected (D7).
- **Catalogue (`src/catalogue.ts`).** New entries, each `invented`, gated by Abandonment, with its LOD rules and tally names: boarded and broken windows, roof holes, shells, ragged walls, frames, rubble, ivy, cracks, weeds, wrecks, leaning lamps and poles, hanging wires, standing carriages, wild growth. `Gate` gains `'abandon'`.
- **LOD rules (`src/lod.ts`).** `wallTop` (wall thickness on paper), `rubble`, `stones`, `slab`, `column`, `roofHole`, `board`, `crack`, `weed`, `ivy`, `wreck`, each with `m`, `mm` and `what` like the others.
- **README** gains a line in "What it draws", and the module table gains `decay` and `ruins`. `docs/render-pipeline.md` gains the decay pass and the new masks. `docs/extending.md` gains a note: a new drawn feature should say what it does as the town decays, even if that is "it goes at the Emptying phase".

---

## 10. Testing

- **Identity.** Every existing golden unchanged with `abandon: 0`. This is the first test, and it guards everything else.
- **Monotone (unit, `test/unit/decay.test.ts`).** For a grid of d values, `progress()` never falls, stages never fall, `stand` never rises, wall profiles never rise at any point, and the sets of cars, people and street furniture shown only shrink. Wild trees only grow in number.
- **Fixed to the map (unit).** A building's fate and a wall's profile are the same when computed from two views offset by a pan, through `B.key` and `B.cell`.
- **Ruin geometry (unit).** Wall bands are valid rings with the hole inside the outer ring. No wall point stands above the building's original height. Party walls exposed by a fallen neighbour are drawn at the survivor's height.
- **Goldens (`test/cases.ts`).** New cases on data already recorded, so no `test:record` is needed: `mollis-abandon-35` (Neglect), `nordlingen-abandon-65` (terraces in Collapse), `midtown-abandon-80` (frames), `mollis-abandon-100` (overgrown ruins), and one image case at 0.7 (`image.test.ts`). Each must pass the usual checks: every stroke claimed by the catalogue, sheet checks, and plausibility for the image case.
- **LOD lab.** Runs at 0, 0.5 and 1 (`npm run lod -- --set abandon=0.5`; the lab needs a `--set` flag for any setting), comparing wasted ink. Ruins add a lot of short strokes (rubble, cracks, ragged steps), so this is where the LOD rules are tuned.
- **Timing.** At A3 1:2500, a full Abandonment drawing may take at most 25% longer than the same drawing at 0. Growth is the likely cost.

---

## 11. Milestones

Each milestone ends with `npm run build`, `npm test` and an LOD lab comparison, and each can ship on its own: the slider is useful from M1.

- **M0 — Plumbing.** The setting, control, `FORMAT`, `decay.ts` with `progress()`, resistance and the phase curve, `Build.decay`, the catalogue gate, the unit tests for identity, monotone and pan. Nothing drawn changes yet.
- **M1 — Emptying.** §7 in full: traffic, parked cars, people, livestock, trains, aircraft, ships and boats thin out. Wrecks for cars and tractors. Markings and footpaths fade. First golden at 0.35.
- **M2 — Neglect.** §5.1–5.2: fates, boarded and broken windows, roof holes, lost chimneys and rooftop details. Kerb gaps, cracks, weeds, fences, leaning lamps. Fields to fallow (§8.1, first step).
- **M3 — Shells.** `ruins.ts`: wall bands, gables, openings, party walls from fates, shadows from bands, `M.ruin` and the masks. Churches and towers keep their towers.
- **M4 — Ruins.** `ragged()`, rubble, footprint ruins, frames for towers and big blocks. Power lines and poles, bridges, platforms and canopies.
- **M5 — Growth.** The `Wild` field, the full succession on open land, gardens and parks, `wildGrowth()` with the readability cap, ivy, overgrown roads and trackbeds, regional endpoints (§4.4). Goldens at 0.8 and 1.
- **M6 — Polish.** LOD tuning against the lab, timing, docs, README, the image-mode golden, and a look at the whole range on every test place.

---

## 12. Decisions for you

- **D1. Where the slider goes.** There is no Advanced section in the panel today. *Recommendation:* the Town section, below Traffic, since it changes the town for both sources. The alternative is a new folding section ("Time") that later could hold a season or a time of day.
- **D2. Name.** *Recommendation:* "Abandonment", with the phase shown as its value. Alternatives: "Decay", "Years left".
- **D3. Image mode compensation.** A ruined town is lighter than the town image mode laid out. *Recommendation:* no compensation in the first version; the score simply shows it. Later, zoning could be run with materials measured for the chosen Abandonment, at the cost of a new layout on every move of the slider.
- **D4. See-through openings.** True holes in the depth buffer for windows and doors in shells, so you see the far wall or the sky through them. *Recommendation:* not in the first version; outlines read well at most scales, and holes would need new work in `Paper` for faces with holes in vertical walls.
- **D5. One last thing left behind.** A plane on the apron, a bus at its stop, a train in the station. *Recommendation:* yes, a few, as rare as landmarks: they tell the story.
- **D6. Collapsing bridges.** *Recommendation:* only footbridges and minor road bridges, and only at the end, so the street pattern stays readable.
- **D7. The title.** *Recommendation:* unaffected. An option to weather the letters (cracks, a fallen letter) could come later.
- **D8. Time-lapse.** Because the model is monotone, a series of sheets at rising settings tells a story. *Recommendation:* not now; it could later be a small export in the Pen Plot or Sheet section.

---

## 13. Risks

- **Ink and clutter.** Rubble, cracks and growth can add many short strokes that cost plotting time and muddy the drawing. Each gets an LOD rule from the start, and the LOD lab at d = 1 is a gate for M4 and M5.
- **Growth buries the town.** Without the cap in §8.4, d = 1 is a forest. The cap and the "bushes first" rule are part of M5's done criteria, judged by eye on every test place.
- **Hidden lines in ruins.** Roofless buildings show insides, which no code draws today. The wall band through `prism()` handles plain footprints, but awkward footprints (very thin wings, rings with many holes) may give bands that fold. `offsetRing()` returns `null` when it can't inset; then the building falls back to a single-line ragged wall with no top strip.
- **Stage 1–2 switches spread through hot code.** Windows and roofs are the busiest code in the renderer. The switches read one field (`B.fate`) and branch once per wall or roof, not per stroke, and the identity test catches any change at 0.
- **Timing.** Fates are cheap. Ruins are cheaper than roofs. Growth is the cost: it is spaced by the same LOD rules as other trees, and capped.
- **Monotonicity is easy to break.** Any choice that uses `p` as a hash input, or picks among options by thresholds that move with d, can make a thing come back. Every choice is made once from the thing's own hash, and only the share kept moves with d. The unit tests check this for every feature, so each new decay feature adds itself to them.
