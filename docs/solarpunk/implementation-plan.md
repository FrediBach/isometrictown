# Solarpunk mode: implementation plan

This plan turns the art direction in [intro.md](intro.md), `Solarpunk Recipes.json` (103 recipes) and `Solarpunk Transformation Atlas.pdf` into work on this codebase. The mode is a switch that draws the same place, at the same view and seed, as a settled solarpunk future. The guide was written without knowing the renderer, so this plan also says which of its rules carry over directly, which need a different form, and which this renderer can't support yet.

**Status (2026-11-16):** all six milestones (M0–M5) are built, with tests and goldens, and the app has been checked in the browser. How the built part works is in [../solarpunk.md](../solarpunk.md). Your answers to the questions in §14 are recorded there and applied throughout.

- **Built:** the toolbar switch, climate and intensity, planner, catalogue and imprint label; roof panels, green roofs and rain tanks; cycles, fewer cars, kerb rain gardens and tree pits, street trees, cycle lanes, planted medians, car park canopies, racks and beds, chargers, planted bus shelters, platform panels, station forecourts and racks, electrified lines and buried town wires; balcony frames (winter gardens, galleries, a planted wonder per 200 m), porches and their climate variants, entrance canopies, sun fins, trellises, awnings, square pergolas and stalls, school pergolas; park meadows, benches and dips, reeds, food beds, works hedges, crop strips, hedgerows, orchards, paddocks, allotment tanks and trellises, shore power; people at stalls, pergolas and schools, washing lines, cargo bikes at shops, dry stone channels in hot dry places.
- **Ink:** against the default drawing, plot time rises 0–26% at any LOD lab place and scale (most under 10%), and wasted ink by at most 1.4 points.
- **Open:** checking each climate on a fitting preset town (needs map data that isn't recorded), and showpiece versions of schools, stations and squares beyond their pergolas and canopies.

Read [../architecture.md](../architecture.md), [../render-pipeline.md](../render-pipeline.md), [../coordinates.md](../coordinates.md) and [../lod.md](../lod.md) first. Recipe ids such as `B04` or `T07` refer to `Solarpunk Recipes.json`.

---

## 1. What the mode is

**One rule from the guide drives the design:** the future must still be recognisably the same place. Systems change (shelter, energy, movement, water, food, habitat, shared space), but identity doesn't.

In this renderer that becomes:

- **Same input.** The same `Town`, `classify()` result, heights, roofs, footprints, street network, water and land cover. Solarpunk mode adds and swaps marks. It never re-infers what a building *is*.
- **Retrofit and addition only (v1).** Of the guide's four intervention levels, v1 implements *retrofit* and *addition*. *Adaptive reuse* and *retirement* need lifecycle evidence (`disused:*`, `abandoned:*`), which the vector tiles don't carry, or an authored scenario. They are deferred (§13).
- **A small motif budget.** Each building gets one primary transformation and at most one supporting system (atlas §1.4, intro §8). A few "moments of wonder" per district get more.
- **The same future at every scale.** Which building gets a balcony frame, which street gets trees, and which parking lot gets canopies are decided without looking at the camera. Level of detail decides only how much of that future is *drawn* (atlas §9.4).
- **Linework only.** Everything is `Solid`s and `Extra`s, drawn with the five pens and traced against the depth buffer, like every other feature.

**Non-goals for v1:** changes of use, demolition, new tram routes, river relocation, rooftop forests, wind turbines and solar farms that the map doesn't show, and anything that depends on terrain (contour terraces, planted embankments) or on soil, contamination or structural data we don't have.

---

## 2. How the guide maps onto this renderer

| Guide asks for | What this renderer can do | Decision |
| --- | --- | --- |
| Separate form, use and lifecycle; keep source data immutable (atlas §2.1, §2.4) | `classify()` writes `Building.info` (form and inferred use). There is no lifecycle data. | Add a separate, read-only-to-everyone-else `Building.future` record, written by a new planner after `classify()`. `Info` stays untouched. |
| Evidence hierarchy: tags → site relations → morphology → scenario (atlas §2.3) | POIs, land use, `Kind`, footprint, party walls, street side and region are already inferred. | Each recipe chooses on that evidence, most specific first (§5). Unknown use falls back to `B27` (restrained cues). |
| Climate profiles (7) | `Style` (region) and latitude. No climate data. | `climateOf(style, lat, town)` picks a profile, which the user can override (§6). |
| Line-weight hierarchy 1.6 / 1.0 / 0.6 / 0.3 (atlas §9.1) | A pen has one width. Stroke width can't vary within a pen. | The hierarchy is expressed through *ink density and fade order*. Silhouettes keep their continuous outlines. Additions use fewer interior strokes and drop out one LOD step earlier. Texture follows `cam.gap()` at wide spacings. Pens carry the system colour (§7). |
| Screen-size motif thresholds (~30 px, ~100 px) (atlas §9.4) | LOD rules in sheet mm, scaled by Detail and pen width | Two new LOD rules implement the motif budget (§8). |
| Stable seeds from source identity, scenario and rule (intro §9) | `hash(k0, k1, seed, SALT)`, `B.key`, `B.cell`, `info.seed`, seed locks | Every decision is keyed on `info.seed` (lock-aware) or `B.cell`, with its own salt in a reserved range (§4.6). |
| District coordination across tiles (atlas §10.1, step 9) | `Town.nearby` and 250 m context buildings for `classify()` | The planner runs *before* context buildings are dropped, so district picks agree from every view (§4.3). |
| Label the drawing as an interpretation (atlas §2.4) | Margin notes and imprint | Prefix the imprint with `SOLARPUNK INTERPRETATION ·` (§9.3). |

---

## 3. Invariants (each is checked by a test)

1. **Off means unchanged.** With `solarpunk: false`, every existing golden stays byte-identical, *whatever the other future settings are*. Solarpunk code never consumes a hash, mask pixel or array order that the default drawing depends on.
2. **Classification is unchanged.** `classify()` gives identical `Info` with the mode on or off. Recipe choice reads `Info`; it never writes it.
3. **Scale-independent plan.** `planFuture()` gives the same `Future` records at 1:500 and 1:8000 (unit test). Only drawing consults `cam`.
4. **Pan-stable.** Made-up future detail stays put when the view pans 30 m and 47 m (`pan.test.ts`).
5. **Locks reroll the future too.** Clicking a building rerolls its future with its look, because future hashes use `seedFor(set, info.seed)`.
6. **Every stroke is claimed.** Each new tally name has a catalogue entry (the existing `sheets.test.ts` rule).
7. **Pass order holds.** Future faces go in before `finishDepth()`, future lines are drawn after it, and the masks a future feature reads are filled before it runs.

---

## 4. Architecture

### 4.1 Settings (`src/settings.ts`, `src/app/model.ts`)

| Setting | Type | Default | Meaning |
| --- | --- | --- | --- |
| `solarpunk` | `boolean` | `false` | The mode switch. It gates everything below. |
| `future` | `number` 0–1 | `0.5` | **Visual intensity**: how many eligible sites take an optional motif, and how many get a "wonder". It never makes an ineligible placement eligible (atlas §10.3). |
| `climate` | `'auto' \| ClimateId` | `'auto'` | Climate profile override, handled like `style`. |

- Add `solarpunk` to `BoolKey` and `future` to `NumberKey`, with a `FORMAT` entry (`"Restrained" / "Settled" / "Exuberant"` bands or a percentage). Handle `climate` in `shared()`/`fromQuery()` the way `style` is handled, and validate it in `loadSettings()`.
- None of these is a `VIEW_KEYS`/`REFIT_KEYS` member.
- Intervention depth stays fixed at retrofit + addition in v1. Keep the name `scenario` free for later (§13).

### 4.2 New modules

All drawing code stays flat in `src/`:

| File | Role |
| --- | --- |
| `src/future.ts` | Types (`ClimateId`, `RecipeId`, `Motif`, `Future`, `FutureTown`), `climateOf()`, `CLIMATES` (profile parameters, §6), `planFuture()` (the planner, §4.3), `motifBudget()` (§8). Pure logic, no drawing. |
| `src/solar.ts` | Energy motifs: pitched-roof PV patch, flat-roof arrays (replacing `solar()` in `buildings.ts` while the mode is on), sawtooth PV, PV canopy over parking and forecourts, charging posts, equipment cabinets. |
| `src/additions.ts` | Supported building additions: balcony frames, winter gardens, galleries, porches and verandas, trellises, shade fins, entrance canopies, pergolas. |
| `src/commons.ts` | Ground-level future `Extra`s: rain gardens and tree pits, garden beds, rain tanks with downpipes, cycle racks, benches and tables, market stalls, material bays, reed margins, shore-power cabinets. |

Modify: `render.ts` (wiring), `buildings.ts` (hooks), `traffic.ts`, `infra.ts` (`parking`, `markings`), `gardens.ts` (`streetTrees`), `sites.ts` (`busStops`, `fuel`, `squares`, `stations`, `ports`), `streets.ts` (`ELECTRIC`), `power.ts` (town poles), `ground.ts` (parks, fields, gardens), `vehicles.ts` (bicycle, cargo bike), `marginalia.ts`, `lod.ts`, `catalogue.ts`, `palettes.ts`, the UI and docs.

### 4.3 The planner: `planFuture()`

```ts
/** What the solarpunk future does with one building. Never read by `classify()`. */
export type Future = {
  recipe: RecipeId;            // 'B01' … 'B28'
  primary?: Motif;             // the one dominant intervention
  support?: Motif;             // one supporting system
  wonder?: boolean;            // a district's moment of wonder: gets a bigger primary
  side?: number;               // outer-ring edge index the addition hangs on, if any
  roofPv?: 'slope' | 'flat' | 'saw' | 'none';
  greenRoof?: boolean;         // extensive low planting on a flat roof
  tank?: boolean;              // rain tank with a downpipe at a back corner
};
export type Motif = 'frame' | 'winterGarden' | 'gallery' | 'porch' | 'veranda' | 'trellis' | 'fins' | 'canopy' | 'pergola' | 'awnings' | 'yard' | 'bikeStore';

/** District decisions shared by many features, keyed to map cells so every view agrees. */
export type FutureTown = {
  climate: ClimateId;
  /** Per way index: reallocated street (fewer kerb cars, trees, rain gardens), as stretches along the way. */
  streets: Map<Way, StreetPlan>;
  /** Parking aisles whose lots get PV canopies, by aisle. */
  lots: Set<Way>;
  /** Squares, school yards and station forecourts chosen as wonders. */
  wonders: { x: number; y: number; kind: 'square' | 'school' | 'station' | 'slab' }[];
};

export function planFuture(town: Town, style: Style, set: Settings, key: Key, cell: Cell): FutureTown;
```

**Where it runs.** In `render()`, directly after `classify()` and *before* the line that drops `context` buildings. Context buildings must take part so that district picks ("one wonder per 200 m cell") see every candidate in a cell from any view. A 200 m cell is inside the 250 m `CONTEXT_PAD`. Note this next to the filter.

**Order inside the planner** (atlas §10.1, condensed to what our data supports):

1. **Climate.** `climateOf()` (§6).
2. **District systems.**
   - Streets get a `StreetPlan` per way: tree spacing, kerb parking share and rain-garden stretches, decided per `B.cell(x, y, 60)` along the way. Never decide per whole way, because tile clipping splits ways.
   - Lots: each parking aisle gets a cell-keyed chance, scaled by `set.future`.
   - Wonders: among the candidates in each `B.cell(x, y, 200)`, the one with the highest `hash(…, 12090)` wins, if that hash is above `1 − 0.6·future`.
3. **Per building.** Choose the recipe (§5), then reserve space (street side, door edge, party walls, shop front), then the primary and supporting motifs from the recipe's options the climate allows. Eligibility runs first and randomness second (atlas §10.3):

   ```ts
   const options = RECIPES[recipe].primary.filter((m) => fits(m, b, info) && CLIMATES[c].allows(m));
   const primary = options.length && f(1) < share(set.future) ? options[Math.floor(f(2) * options.length)] : fallback;
   ```

4. **Fallback chain.** If a motif doesn't fit (the wall is too short, it would stand on a road, the frame's posts would land in water), the planner falls back as the recipe says (`frame → porch/awnings → trellis → nothing`). A building is never forced to change. Ordinary maintained buildings belong in this future too (`B27`).

The ground-level fit tests need masks. Masks are in sheet space and only cover the view, so the planner tests against the **world-space** geometry `Town` already holds: roads (`ways` with widths), water shapes and other footprints, using the classifier's `Grid`. That keeps the plan independent of the view. Drawing code still checks `M.road`/`M.water`/`M.foot` as usual before it emits anything.

`f(salt)` is `hash(seed[0], seed[1], seedFor(set, seed), 12000 + salt)`, with `seed = info.seed`. Terraces share `info.seed`, so a row gets coordinated roof modules and awnings (`B02`) for free. Use `hash(k[0], k[1], …)` with the building's own key wherever a row should *vary* (shutters, pots).

### 4.4 Wiring in `render()`

| Stage | Addition |
| --- | --- |
| `ground` | `const F = set.solarpunk ? planFuture(town, style, set, B.key, B.cell) : null` after `classify()`, before the context filter. Pass `F` into `B` as an optional `future` field on `Build`, so building code reaches it without changing signatures. |
| `buildings` | `building()` reads `b.future` and `B.future`. Additions that stand outside the footprint (frames, porches) fill their ground ring into `M.foot` straight after the building, so trees and cars keep off them. |
| `life` | Future trees join the tree list (tagged `from: 'future-trees'`). New extras go into `extras` under their layers: `extra('planting', 'raingardens', …)`, `extra('solar', 'canopies', …)`, `extra('additions', 'pergolas', …)`, `extra('life', 'cycles', …)`, `extra('streets', 'stalls', …)`. Existing extras read `B.future` to change behaviour (fuel → charging, bus stop roofs and so on). |
| `light` | Nothing new: future faces are ordinary faces, and future casts are ordinary casts. |
| `lines` | Ground marks (rain-garden contours, garden beds, reed clusters, crop strips) are drawn in their extras' `draw()` and in `drawGround()` branches. |

`F` is `null` when the mode is off, and every hook starts with `if (!B.future) return` (or keeps the existing path), which is how invariant 1 holds.

### 4.5 Layers and pens

Add three entries to `LAYERS`. This automatically gives them per-layer Detail and pen overrides:

| Layer | Label | Holds | Default pens |
| --- | --- | --- | --- |
| `solar` | Solar and energy | PV patches and arrays, PV canopies, chargers, cabinets | outline `LINEWORK`, module grid `SHADOWS` (reads as dark glass in most palettes) |
| `additions` | Frames and canopies | balcony frames, winter gardens, porches, pergolas, fins, entrance and forecourt canopies, stalls | `LINEWORK`; slats and shade cloth `ROOFS` (like awning stripes) |
| `planting` | Future planting | green roofs, trellis growth, rain gardens, garden beds, reeds, tree pits | `GREENERY`; rain-garden inlets and overflow, downpipes and tanks' water marks `WATER` |

The pens make the systems legible: water handling in the water pen, growth in the greenery pen, energy in a dark pen. That stands in for the guide's "make systems legible through a few clues".

Future trees stay in the `trees` layer. Cycles and people stay in `life`. Street tree pits and kerb extensions go in `planting` (their trees in `trees`).

### 4.6 Determinism and salts

- Reserve **12000–12999** for solarpunk decisions and **9200–9299** for solarpunk LOD fades. Grep before you take one; the highest in use today is around 9108.
- Building motifs key on `info.seed` with `seedFor()`. Ground motifs key on `B.key`. Shared stretches key on `B.cell`. Grids (garden beds, crop strips, PV modules on canopies) are laid out from the feature's own geometry (its `bestRect`), never from local coordinates.
- No `Math.random()`, no clocks (`rules.test.ts` already enforces both).

### 4.7 Catalogue

Add `GroupId` `'future'` titled **Solarpunk**, placed after `'power'`. Every new thing gets an entry with `source: ['invented']` (or `['inferred', 'invented']` where it hangs on inferred use), `needs: ['solarpunk', …]`, its LOD rules, `strokes` (such as `solar:canopies`, `*/pv-roof`, `planting:raingardens`) and `facts` naming its recipe ids. Add `'solarpunk'` to `GATE_LABEL`. Existing entries whose strokes the mode removes (kerb cars, town poles, some trampolines) don't change: the gate test only checks that *needing* entries vanish when their gate is off.

Add census facets for buildings: `future-<recipe>` and `<motif>`, so the catalogue can count "12 balcony frames" and pick them out.

---

## 5. Recipe coverage

Recipes are matched on what we infer today (`Kind`, `Info` flags, POIs inside the footprint, land use under it, `Way.cls/sub/service`, ground codes). The **M** column is the milestone (§12): `–` means not reachable with our data (deferred), `·` means already true of the drawing with no change needed.

### Buildings

| Recipe | Triggered by | Primary → support (fallback) | M |
| --- | --- | --- | --- |
| B01 house | `kind house` | PV patch on the sun slope → rain tank + downpipe; porch or veranda by climate (fallback: tank only) | 1, 3 |
| B02 terrace | `kind terrace` | coordinated PV modules along the row (row seed) → awnings or pots; varied shutters | 1, 3 |
| B03 historic block | `apartment` with party walls in a dense core, `gableFront`, mansard `blocks` style | street front untouched; trellis or gallery on the court side only (side facing away from `toStreet`); courtyard tree if a hole is big enough | 3 |
| B04 apartment slab | `apartment`, `bestRect` L ≥ 30 m, L/w ≥ 2.5, H ≤ 30 m | **balcony frame** on the long side away from the street, posts to the ground (cold: some bays become winter gardens; hot-humid: open galleries) → shared garden beds on the frame side | 3 |
| B05 residential tower / B06 office | `kind tall` | fine shade fins on the sun-facing walls → a sheltered entrance canopy; one terrace with planters when it's a wonder | 3 |
| B07 shops | `info.shop` | awnings on every bay (no 25% skip) → cargo bikes, tables at the kerb (close scale) | 3, 5 |
| B08 supermarket | `industrial` or `apartment` holding a shop POI, area > 1500 m², flat roof | full-roof PV array with access aisles → entrance canopy | 1, 3 |
| B10 school | `civic` on `school/kindergarten` land use or POI | yard pergola or shade canopy → teaching-garden beds, covered cycle racks | 3, 4 |
| B11 university | `civic` on `university/college` | PV on flat roofs → shaded routes (pergola along a path), demo plots | 1, 4 |
| B12 hospital | `hospital` | helipad kept; covered entrance canopy → recovery-court trees. No roof PV where the helipad is | 3 |
| B14 library, town hall | `townHall`, library POI | open forecourt canopy → table and benches; the flag stays | 3 |
| B15 museum, theatre | museum or theatre POI | forecourt seating → no roof change | 3 |
| B16 worship | `kind worship` | **no change to the building**; shaded benches and trees in its grounds | 4 |
| B18 sports hall | `civic` on pitch or stadium, or a large flat-roofed hall beside pitches | roof PV → planted perimeter | 1 |
| B19 warehouse, industrial | `kind industrial` | PV on flat roofs and the opaque sawtooth slopes → material bays under a canopy in the yard; planted margin | 1, 4 |
| B20 barn | `industrial` in farmyard or farmland | PV on the sun slope → tank by the barn (farmyards already have silos and tractors) | 1 |
| B22 garage, shed | `kind shed` | bike store (open door, cycles out front) → nothing | 3 |
| B25 fire station, police | POI | charging canopy over the apron → planted boundary | 3 |
| B27 unclassified | any building without another recipe | one cue: a PV patch *or* a trellis *or* nothing | 1 |
| B28 castle, monument | `castle` | no change; paths and shade nearby | · |
| B09, B13, B17, B21, B23, B24, B26 | no reliable signal in tiles (malls, care homes, hotels, greenhouses, derelict, informal, prisons) | fall back to B27, except B17 hotels with a `lodging` POI, which get B04 balconies without the frame | – / 3 |

### Transport

| Recipe | Triggered by | Transformation | M |
| --- | --- | --- | --- |
| T01 residential street | `road` `minor` / `residential` / `living_street` | fewer kerb cars; tree pits every 12–18 m where the pavement allows; rain-garden kerb extensions in some stretches; cycles | 2 |
| T02 commercial street | the busy streets classify already gives shops | awnings (B07), stalls and tables, steady cycles, compact delivery vans | 2, 5 |
| T03 boulevard | `primary/secondary/tertiary`, width ≥ 12 m | planted centre strip where width allows (median trees inside the road mask band, kept clear of lanes), a painted cycle lane, fewer cars | 2 |
| T04 rural road | rural `tertiary/unclassified/track` | unchanged ribbon; hedges on verges at a higher hedgerow chance | 4 |
| T05 motorway | `motorway` | fewer cars, more coaches and trucks; gantries kept. Habitat crossings need terrain: deferred | 2 |
| T06 roundabout | `roundabouts()` islands | lower planting (bushes plus one tree) | 2 |
| T07 surface parking | `service=parking_aisle` | some rows of bays under **PV canopies**; some bays become garden beds and cycle racks; a few cars stay | 2 |
| T10 fuel station | `fuel` POI | pumps → charging posts; canopy roof gets a module grid | 2 |
| T11 rail corridor | `rail` main lines | catenary on main lines in every region (extend `ELECTRIC`); yards and spurs unchanged | 2 |
| T13 station | `railway` POI and `platforms()` | platform canopies get module grids; forecourt cycle racks; forecourt canopy when it's a wonder | 2, 3 |
| T14 bus stop | `bus_stop` POI | the shelter gets a green roof (tufts on the roof slab) and a bench | 2 |
| T18 port | `ports()` | a shore-power cabinet with a cable to a moored ship | 4 |
| T19 ferry, marina | ferries, moorings | unchanged boats; a sheltered waiting canopy at the ferry landing | 4 |
| T21 paths | paths | unchanged (they're already continuous) | · |
| T22 squares | `squares()` | shade pergola along one or two edges, ring of trees, a few market stalls; fountain or statue and an open centre kept | 3 |
| T08, T09, T12, T15, T16, T17, T20 | parking structures, alleys, depots, airports, lifts: little or no data | T17: PV on aprons' service buildings only when they're mapped as buildings; others unchanged | – |

### Industry and utilities

| Recipe | Triggered by | Transformation | M |
| --- | --- | --- | --- |
| I01–I03 | industrial land use and buildings | B19 on buildings; planted margin along land-use edges that don't face a road | 1, 4 |
| I10 chimney | `chimneys()` | kept as a landmark (atlas: "perhaps a retained chimney") | · |
| I15 power lines | `powerLines()` | transmission lines kept; roadside wooden poles in town dropped (undergrounded), poles on country roads kept. **Decision needed** (§14) | 2 |
| I04–I09, I11–I14, I16–I20 | plant types the tiles don't describe | not drawn; never invented | – |

### Landscape

| Recipe | Triggered by | Transformation | M |
| --- | --- | --- | --- |
| L01 park | `M.green` | mosaic: map-fixed patches switch from lawn hatch to meadow tufts; shallow rain-garden contours near paths; benches; broad open areas kept | 4 |
| L02 allotments | `ALLOTMENT` | rain tanks at the sheds, compost bays, trellis rows in some plots | 4 |
| L03 pitches | pitches | unchanged markings; a canopy at the touchline when it's a wonder | 4 |
| L05 cemetery | `CEMETERY` | unchanged | · |
| L06 fields | `FIELD` | **crop strips**: 2–4 strips per field along its long axis, each with its own furrow direction or stubble, with grass margins between; boundary trees more often | 4 |
| L07 meadow | `MEADOW` | a rotational fence line in some meadows, plus troughs | 4 |
| L08 orchard | `ORCHARD` | mixed crown sizes, some gaps for replacements | 4 |
| L13 woods | `M.wood` | unchanged (already irregular, with patchy gaps) | · |
| L18/L19 rivers, L22 lakes | water edges | **reed clusters** on soft banks (next to green, meadow, wetland or garden ground, never at quays, roads or buildings) | 4 |
| L24 marsh | `WETLAND` | upright reed clusters join the marsh dashes | 4 |
| Residential gardens | `GARDEN` | food beds in some back gardens, a tank by the house (with B01), fewer lawns in hot-dry | 4 |
| L17 desert | arid style, `SAND` | unchanged ground; shade structures only in town | · |
| L09–L12, L14–L16, L20, L21, L23, L25–L33 | either unchanged by design ("let grasslands remain open") or not in our data | no change | · / – |

---

## 6. Climate profiles

`climateOf(style, lat, town)` in `future.ts`, unless `set.climate` overrides it:

| Profile | Picked when |
| --- | --- |
| `hot_dry` | style `arid`, or `american`/`antipodean` with \|lat\| < 36 and little mapped green |
| `hot_humid` | style `tropical`, or \|lat\| < 23.5 |
| `monsoonal` | UN M49 regions 034/035 (South and South-east Asia). Treated as `hot_humid` plus stronger drainage motifs |
| `cold` | style `nordic`, or \|lat\| > 58 |
| `mountain` | style `alpine` (there's no terrain, so this is a proxy) |
| `coastal` | ocean in `town.waterCls` inside the drawn box, and none of the above |
| `temperate` | everything else |

Each profile is a row in `CLIMATES` that the planner and drawing code read. Nothing compares climate ids inline.

| Parameter | temperate | hot_dry | hot_humid | cold | mountain | coastal |
| --- | --- | --- | --- | --- | --- | --- |
| Balcony frame infill | open + some winter gardens | screened galleries, deep shade | open galleries | winter gardens | open | compact, fewer bays |
| Porch type | porch | deep arcade porch | veranda (full side) | glazed vestibule | porch | compact porch |
| Green roofs | yes | no | yes | sparse | yes | low only |
| Rain gardens and swales | many | dry channels (no planting, stone edge) | many | few | some | some |
| Pergolas and shade | some | many (primary motif) | many | few | few | compact |
| Extra street trees | ×1.5 | ×0.5, palms and cypresses per region | ×1.5 | ×1 | ×1 | ×0.7, low |
| Lawn → beds | some | most lawns → mineral ground plus a few beds near tanks | some | few | some | some |
| Rain tanks | some | many (covered) | many | few | some | some |
| Reeds at water | yes | only at mapped water | yes | yes | yes | sheltered water only |

Season is fixed at summer in v1. The guide's "one season" rule holds, and seasonal sprites are deferred (§13).

---

## 7. Motif library

Every motif names its geometry, pen, LOD rule, the masks it respects, and its fallback. Sizes are metres and pens are the constants. All new LOD rules go in `src/lod.ts` with honest typical sizes; the values below are starting points for the LOD lab.

### 7.1 Energy (`solar.ts`, layer `solar`)

- **PV patch on a pitched roof.** One coherent rectangle on the main roof's sun-facing slope, built with `Pitched.at(u, v, z)` so it sits in the roof plane, lifted 0.08 m along the normal. It's inset 0.6 m from eaves, ridge and verges, and it avoids chimney and dormer positions. Do this by sharing the chimney and dormer placement maths from `roofDetailsLines`, so the space is reserved before the panels go in (atlas §4.2).
  - Faces: one quad (so the roof hatch under it is hidden). Lines: the outline in `LINEWORK`, then module rows and columns in `SHADOWS` at ≥ 1.0 m pitch, widened by `spaced()`.
  - Rules: `pvPatch { m: 4, mm: 1.2 }` for the outline (atlas: "at small scale, a single outlined patch") and `pvGrid { m: 1, mm: 0.9 }` for the grid.
  - Roof hatching must skip the patch. Draw roof hatch lines with `on: face` as today. The patch face is nearer, so the depth buffer already hides the hatch under it. Check with the `roof-hatching` unit test.
  - Not on `worship`, `castle`, gable-front street fronts or mansards (heritage, B03 and B16).
- **Flat-roof array.** Rewrite `solar()` into a roof allocator `allocateRoof(rect, inside, equipment)`. It keeps a 1.0 m access margin and an aisle every 4 rows, and keeps the plant-room boxes `rooftop()` already places (equipment first, atlas §4.2). It returns row rectangles; tilted rows as today, plus a back edge so tilted panels read differently from skylights. In the mode, arrays appear in every region (not only `SOLAR` regions) and with much higher probability. `TANKS` regions keep a tank or two beside a smaller array, so the regional look survives.
- **Sawtooth PV.** Modules on the opaque (steep-back or shallow) slopes of `sawtoothRoof`, leaving the glazed faces clear (atlas §11.3).
- **PV canopy.** A thin slab 4.5 m up on posts every 5 m, over a row of parking bays or a forecourt. Module grid in `SHADOWS`. It casts a shadow. Rule `canopy { m: 5, mm: 1.5 }`; posts have their own `spaced()`. Used by T07, T10, T13, B25 and B08.
- **Charging post.** A 0.4 × 0.3 × 1.4 m box with a cable arc. Rule `charger { m: 0.6, mm: 0.5 }`. Two pump positions at fuel stations become four posts; kerb chargers go beside some bays.
- **Equipment cabinet.** A 1.5 × 0.8 × 1.8 m box beside canopy lots and arrays on big roofs (atlas: generation needs equipment).

### 7.2 Additions (`additions.ts`, layer `additions`)

- **Balcony frame (B04).**
  - On wall edge `future.side`, from 0 to the eaves, depth 2.4 m, a bay every 3.4 m (match the facade's `bay`, so the frame follows the structural rhythm).
  - Posts run to the ground at each bay line. A slab edge sits at each floor (`style.floor`). Rails are the balcony-rail logic, rule `balconyRail`.
  - Faces: the outer frame plane, hit-tested by bay so windows behind stay visible through open bays. Use posts and slabs as thin faces, *not* a full plane, except for winter-garden bays, which get a glazed face with 2 mullions so the wall behind is hidden but drawn faint (fewer lines).
  - Casts: the frame footprint at its full height.
  - Fill `M.foot` with the frame ring.
  - Rules: `frame { m: 2.4, mm: 1.2 }` (whole frame; below it only the roof and ground changes show), `framePost { m: 0.25, mm: 0.35 }` (posts thin out by `spaced()`).
  - Fallback if the ground strip hits roads or other footprints: shallow balconies (existing `balconies: 1` drawing, forced on).
- **Gallery (hot-humid).** The same frame with open bays only and a continuous shade rail at each floor.
- **Porch or veranda (B01, B13).** Over the door edge (`prism` already finds it), 1.8–2.4 m deep, two or four posts, a mono-pitch roof in `ROOFS` with hatch. The veranda runs the whole wall. A vestibule (cold) is a small glazed box. Rule `porch { m: 2, mm: 1 }`.
- **Awnings (B07).** Reuse `shopfront()`. With the mode on, the `hash(…, 340) < 0.25` skip becomes a fresh-salt skip at 5%, so nearly every bay gets one. The striped canvas stays. No new geometry.
- **Trellis or green facade.** A grid of 0.6 m spaced uprights plus 2 horizontals, rooted in a ground planter strip (a thin box 0.4 m high) in `LINEWORK`, with climbing growth as sparse trailing arcs in `GREENERY` covering 30–70% of the grid's height. It goes only on windowless walls: blank facades, exposed party-wall upper parts, industrial walls. Leave windows and doors clear (atlas §9.2). Rule `trellis { m: 0.6, mm: 0.6 }`.
- **Shade fins (B05, B06).** Vertical fins every 1.5 m on sun-facing walls of `tall` buildings, 0.6 m deep, `LINEWORK`. They replace the curtain-wall mullion lines on those walls rather than adding to them (ink budget). Rule `fins { m: 1.5, mm: 0.9 }`.
- **Entrance canopy.** A flat slab of 3 × 2 m on two posts over the door, for civic and tall buildings.
- **Pergola (B10, B14, T22, L01).**
  - A rectangle of posts every 3 m with a slat top in `ROOFS`. Slats are parallel strokes at `cam.gap(1.0)`, never denser than reads.
  - Faces: none for the slats (open), so things show under them. Posts are lines. Shade cloth bays (hot-dry) are faces.
  - Casts: a slatted shadow is too fine, so cast only for shade-cloth bays.
  - Rule `pergola { m: 3, mm: 1.2 }`.
- **Market stall.** A 2.5 × 1.5 m table with a pitched cloth roof, striped in `ROOFS` like awnings. Rule `stall { m: 2, mm: 0.9 }`.

### 7.3 Water and planting (`commons.ts`, layer `planting`)

- **Rain tank with downpipe (B01).** A drum 1.2 m across and 1.6 m tall at the rear corner of the house (away from `toStreet`), with a downpipe from eaves to tank in `WATER`. It must be clear of `M.road` and other footprints. Rule `tank { m: 1.2, mm: 0.8 }`.
- **Rain garden or kerb extension (T01).**
  - In a street stretch the plan marks: a lowered bed between kerb and carriageway, 6–10 m long and 1.8 m wide, drawn as a dashed inner contour in `GREENERY`, one break in the kerb line where the inlet is (the `curbs()` pass must skip that span, so pass the breaks in through the `StreetPlan`), and a short `WATER` arrow-less tick for the inlet.
  - Inside are low tufts (reuse the tuft symbol). No permanent water texture (atlas §9.2).
  - Rule `rainGarden { m: 6, mm: 2 }`; below it only the tree pits show.
- **Tree pit.** A square 1.4 m outline at the base of every street tree when its rule shows. The trees themselves are `Tree`s (from `streetTrees()` with the plan's spacing and avenue chance).
- **Dry channel (hot-dry).** In place of a planted rain garden: a stone-edged channel, two parallel strokes with stipple between.
- **Green roof.** Low tufts on a flat roof face, drawn with `on: face` and spaced `cam.gap(3.2)` (the ground tuft grid), keeping the 1 m access margin and the arrays' footprint. No trees on roofs, ever (atlas §4.2; the "every roof is a forest" failure).
- **Garden beds.** Rectangles of 1.2 × 4 m in rows with 0.6 m paths, a few crop strokes inside, plus a small shed or tank. They go on parking bays converted under T07, B04 frame sides, school yards and some back gardens. Rule `bed { m: 1.2, mm: 0.8 }`.
- **Reed clusters.** 3–6 short upright strokes, fanned, in `GREENERY`, at 1.5–3 m from the water edge on soft banks. Placed on a map-fixed grid (absolute coordinates like the tufts), tested against `M.water` (the cluster's foot must be *off* water but within 3 m of it), `M.road`, `M.foot` and paths. Rule `reed { m: 1.2, mm: 0.7 }`. Draw them inside `paper.fine()` only if the speck filter would drop the strokes; prefer strokes long enough to pass.
- **Hedge margin.** For industrial perimeters and crop-strip margins: reuse `hedgerows()` with a fresh salt and the plan's edges.

### 7.4 Life (`vehicles.ts`, `sites.ts`, layer `life`)

- **Bicycle.** Two wheel ellipses (projected circles) and a frame stroke. **Cargo bike**: plus a box. In `LINEWORK`. Rule `cycle { m: 1.8, mm: 1.2 }`; only at close scale (atlas §9.4).
- **Cycle rack.** A row of 4–8 inverted-U strokes with bikes in some of them, at stations, schools and converted bays.
- **Bench and table.** A slab on 2 legs, at pergolas, squares and forecourts.
- **Washing line.** A sag curve between two balcony-frame posts at a few bays. Close scale only.
- **People.** `people()` gains placements under pergolas, at stalls and tables, and in school yards, with a higher count on pedestrian streets. The existing figure model and LOD rule apply.

---

## 8. Level of detail and the motif budget

**Budget by projected size.** `motifBudget(B, b)` returns how many layers of the plan to draw for a building:

```ts
const size = Math.sqrt(Math.abs(ringArea(b.shape[0].pts)));
if (!shows(B.cam, LOD.futureTwo, size)) return 1;      // only the primary, simplified
if (!shows(B.cam, LOD.futureDetail, size)) return 2;   // primary + support
return 3;                                              // + close-scale life and fittings
```

Starting values are `futureTwo { m: 12, mm: 4 }` (≈ 30 px at the paper's 7 px/mm) and `futureDetail { m: 20, mm: 14 }` (≈ 100 px), matching atlas §9.4. They're rules, so Detail and pen width move them like everything else.

**Order of fading** (atlas §9.4, distant → close):

1. Distant: the PV patch outline, street trees, canopy slabs over lots, park mosaic, crop strips. These are the spatial changes.
2. Middle: frame posts and floor slabs, porches, pergolas, garden beds, rain gardens, module grids, reeds.
3. Close: cycles, benches, stalls, washing lines, chargers, cabinets, tank downpipes, people.

**Ink budget.** The guide warns against "every object has every technology". Check in the LOD lab that the mode doesn't raise *waste* (specks and drowned ink) above the default drawing's at any scale. A first target: the mode adds at most 35% to total plot time at 1:1000 for Mollis, at `future = 0.5`.

---

## 9. Changes to existing features (mode on only)

### 9.1 Traffic and parking

- `traffic()`: in `amount`, multiply private cars by `0.4 + 0.3·(1 − future)`. Keep buses, trucks and the platoon logic. Replace about 40% of the removed cars with cycles in the lanes at close scale.
- Kerb parking: multiply the stretch chance by `0.5`. Freed stretches become tree pits and rain gardens through the `StreetPlan`, so they don't stand empty.
- `parking()`: in lots the plan selects, about 30% of bays keep cars, rows under a PV canopy keep their bays, and some end bays become cycle racks or beds. Markings stay where bays stay.

### 9.2 Streets, rails and power

- `streetTrees()`: the avenue chance comes from the climate's multiplier and also covers `minor` and `residential` streets ≥ 8 m wide. On streets narrower than that, trees go only where the pavement test passes twice (room for a crown, as today). This is the "geometric budget" check: never put four rows of trees in a lane.
- `ELECTRIC`: in the mode, main lines carry catenary in every region.
- `power.ts`: town distribution poles: see the decision in §14. The default proposal is to drop them in town and keep country roads and transmission.

### 9.3 Margin

`marginalia.ts`: prefix the imprint with `SOLARPUNK INTERPRETATION · ` when the mode is on. `fit()` already shrinks the imprint to the width. Don't put it in the view note, which drops out when space is short.

### 9.4 Palette

No new palette (decision 4). Pens stay user data, and the mode never changes them.

---

## 10. Interface

Following DESIGN.md (decision 1):

- A `Segmented` selector switch **Today | Solarpunk** in the preview toolbar, beside the zoom switch. It maps to `solarpunk`. *(Built.)*
- At the end of the Town section, under a **Solarpunk** caption: a `Select` **Climate** (Auto, showing the profile worked out from the region, then the seven profiles) and an **Intensity** slider (`future`). *(Built.)*
- The imprint says `SOLARPUNK INTERPRETATION`, so a shared drawing is never mistaken for today's map. *(Built.)*
- The Catalogue lists a **Solarpunk** group. With the mode off, its entries show as not in the drawing. *(Built.)*
- `npm run doctor` after UI work.

---

## 11. Testing and verification

**Unit tests** (`test/unit/future.test.ts`):

- `climateOf()` for each preset region and the latitude edges.
- `planFuture()` is deterministic, independent of scale (the same records at 1:500 and 1:8000) and of the view (pan the frame centre and compare records keyed by `info.seed`), and changes only the locked building's record when one is rerolled.
- Recipe choice: a fixture slab gets B04 with a frame on the side away from the street. A church gets no roof PV. A house's PV patch rectangle stays inside the sun slope and clear of chimney positions.
- `allocateRoof()` keeps margins and equipment, and returns nothing for a roof that is too small.
- `motifBudget()` steps 1 → 2 → 3 with scale.

**Drawing tests:**

- **Off is unchanged.** All 13 current goldens must pass unchanged. Add one test: draw `mollis-default` with `solarpunk: false, future: 1, climate: 'hot_dry'` and require the same SVG hash as the golden.
- **New cases** in `test/cases.ts`, reusing places, scales and sheets that are already recorded, so `test:record` should fetch nothing (confirm it):
  - `mollis-solarpunk`: Mollis at 1:1000, the default settings plus the mode (Alpine/mountain climate, houses, a slab or two, fields at the edge, a stream).
  - `amsterdam-solarpunk`: heritage fronts kept, trams, canals with reeds kept off quays, shops with awnings.
  - `midtown-solarpunk`: towers with fins, boulevards, much less traffic, PV on flat roofs.
  - `emmental-solarpunk`: coarse farmland. Crop strips, hedges and barn PV must read at 1:4000 without blotting.
  - `rye-solarpunk` (optional): marsh reeds, left-hand traffic, coastal profile.
- **Gates.** Add a `SOLARPUNK_BASE` (Mollis with the mode on) and route `'solarpunk'` to it, as `POWER_BASE` is routed for power. Future entries that also need `trees`, `cars`, `ground`, `life` or `markings` list those, so switching each off removes its future part too.
- **Pan.** Add the Mollis solarpunk case to `pan.test.ts`, checking facets `solar`, `additions`, `planting` and future trees.
- **Catalogue.** Existing tests cover completeness once the entries are in.

**LOD lab:**

- Add `--solarpunk` (sets the mode on every place) to `lab/`.
- For each milestone: `npm run lod -- --name sp-before` on the commit before it, then `npm run lod -- --solarpunk --name sp-after --compare sp-before`, and look at the close-ups at 1:500, 1:1000, 1:2000, 1:4000 and 1:8000.
- Also run once with `--detail 0.5 --pen 0.7`. PV grids and pergola slats are the most likely to drown.

**Review by eye** (atlas §12.3, condensed; ask these of every case SVG):

1. Can you still tell each building's type and two identity anchors?
2. Does every addition stand on posts or a wall, and every plant in ground or a visible planter?
3. Are streets still continuous movement bands, with no road turned into a park?
4. Are fields, pitches, water and dry ground still open and quiet?
5. Does each motif stay under its budget at export size?

Say in the PR what could not be checked by eye.

---

## 12. Milestones

Each milestone ships on its own, passes `npm run build` and `npm test`, comes with LOD lab compares, and updates the docs.

**M0: Foundations (no visible change except the label)** *(done)*

- Settings, model keys and share links. Toolbar switch, climate and intensity controls.
- `future.ts`: types, `CLIMATES`, `climateOf()`, the `planFuture()` skeleton (recipe choice only, no motifs), the `B.future` hook, and the call position in `render()`.
- `LAYERS`: `solar`, `additions`, `planting`. The catalogue group and gate label. The imprint label.
- Tests: the `future.test.ts` basics, the off-identity test, `mollis-solarpunk` (golden = default plus the label), and the gate base.

**M1: Roofs: energy, water and green (the strongest distant cue)** *(done: pitched, flat and sawtooth panels, green roofs, rain tanks)*

- PV patch on pitched roofs, the flat-roof allocator and arrays, sawtooth PV, green roofs, rain tanks with downpipes.
- B01, B02, B08, B11, B18, B19, B20 and B27 roof parts.
- LOD rules `pvPatch`, `pvGrid`, `pvRows`, `rainTank`, `greenRoof`, `futureTwo`, `futureDetail`.
- Cases: add `midtown-solarpunk` and `emmental-solarpunk`.

**M2: Streets and mobility** *(done, cycle lanes and planted medians included; the rain garden's inlet gap is in its own new kerb, so the street's kerb, now its back edge, rightly keeps no break)*

- `StreetPlan`: tree pits and spacing, rain gardens with kerb breaks, fewer kerb cars. Traffic reduction plus cycles. Parking-lot PV canopies, beds and racks.
- Fuel → charging. Bus-stop green roofs. Station canopy module grids and cycle racks. Catenary everywhere. Town poles (per the decision in §14).
- LOD rules `canopy`, `charger`, `rainGarden`, `cycle`.
- Case: add `amsterdam-solarpunk`.

**M3: Building additions and wonders** *(done, station forecourt canopies included; frames go on rows and perimeter blocks too, as rear galleries)*

- Balcony frames, winter gardens and galleries (B04, B17). Porches, verandas and vestibules. Awnings everywhere on shop fronts. Trellises. Shade fins. Entrance canopies.
- Wonders: one slab frame, school yard pergola, station forecourt canopy or square shade edge per 200 m cell.
- Market stalls on squares. `M.foot` filling for additions.
- LOD rules `frame`, `framePost`, `porch`, `trellis`, `fins`, `pergola`, `stall`.

**M4: Landscape** *(done, all of it: paddocks, allotment tanks and trellises, park benches and rain-garden dips, shore power)*

- Park mosaic and rain-garden basins. Crop strips with margins. Rotational meadow fences and troughs. Orchard gaps and ages. Reed margins at rivers, lakes and marsh. Garden beds in residential gardens. Allotment tanks and trellises. Industrial planted margins. Port shore power.
- LOD rules `reed`, `bed`.
- Optional case: `rye-solarpunk`.

**M5: Life, climate tuning and polish** *(done, cargo bikes at shops included; checking each profile on its own preset town needs map data not yet recorded)*

- People at pergolas, stalls and yards. Washing lines. Benches and tables. Cargo bikes at shops.
- Climate pass: draw each profile on a fitting preset (Jumeirah Village Circle hot-dry, Pointe-Noire hot-humid, Ærøskøbing coastal, Sapporo cold, Hallstatt mountain) and tune `CLIMATES` by eye.
- A final ink-budget pass in the LOD lab. Docs.

---

## 13. Deferred, with what would unlock each

| Feature | Blocked by | Unlocks with |
| --- | --- | --- |
| Adaptive reuse (B23, T08, T10 reuse, I10) | no lifecycle tags in tiles | Overpass: add `disused:*`, `abandoned:*`, `building=construction` to the existing time-boxed query, plus a `scenario: 'retrofit' \| 'reuse'` setting |
| Season (leafless trees, dry grass, pruned orchards) | tree sprites have one season | a `season` setting and leafless broadleaf sprites (trunk and branch strokes) |
| Terraces, embankment planting, habitat bridges (T05, L09, mountain) | no terrain | elevation data |
| Solar farms, wind turbines, substations (I13–I16) | not in the tiles | Overpass `power=*` (best effort), drawn only where mapped |
| New tram routes, cycleway networks | needs a network planner | a corridor pass over `ways` with continuity checks (atlas §5) |
| Historic detection beyond worship, castle, town hall and gable fronts | no `historic=*` in tiles | Overpass `historic`, `heritage` |
| Rooftop trees, intensive roof gardens | the guide makes them conditional on structure we can't know | an authored "wonder" only, behind a further setting |

---

## 14. Decisions (answered 2026-11-16)

Answers: (1) the switch lives in the preview toolbar, (2) drop town poles, keep country ones, (3) reduce cars and add cycles, (4) no new palette, (5) intensity default 0.5, (6) v1 is M0–M3. The questions as asked:


1. **Where the switch lives.** The plan puts *Today | Solarpunk* at the top of a new Future section. The alternative is a key in the toolbar, more prominent but outside the numbered-panel pattern.
2. **Town power poles.** Drop roadside poles in town in the mode (reads as "cared for", fewer wires), or keep them (preserve infrastructure, atlas rule 5)? Proposed: drop in town, keep in the country.
3. **Cars.** Reduce private cars to roughly 40–70% and add cycles (proposed), or keep car counts and only change parking?
4. **Palette.** Offer a Solarpunk palette and a one-click button (proposed), or switch pens automatically with the mode? Switching automatically would break the "pens are user data" rule, so it isn't recommended.
5. **Intensity default.** Proposed 0.5 ("settled"). Higher values add more optional motifs and wonders, but never ineligible ones.
6. **Scope of v1.** M0–M3 make a convincing mode on their own (roofs, streets, additions). M4–M5 can follow separately.

---

## 15. Risks

- **Ink and clutter.** PV grids, slats and trellises are dense by nature. Mitigation: everything spaced through `cam.gap()`/`spaced()`, strict fade order, LOD lab waste checks per milestone.
- **Golden churn.** Changes to shared helpers (`solar()`, `shopfront()`, `curbs()`) could move the default drawing. Mitigation: branch on `B.future` at the call site, leave default paths textually intact, and rely on the off-identity test.
- **Pan instability from district picks.** Mitigation: the planner runs before the context filter, uses cells smaller than `CONTEXT_PAD`, and has pan tests on the solarpunk case.
- **Masks are view-bound.** The planner's fit tests use world geometry rather than sheet masks, so the same additions are chosen from every view. Drawing still re-checks masks before emitting.
- **Performance.** A balcony frame adds many faces on big slabs. Cull additions with the building (they're inside its solids), and keep frame faces to posts, slabs and glazed bays only. Measure render time on `midtown-solarpunk` against `midtown`.

---

## 16. Docs to update with the code

- `README.md`: a "Solarpunk mode" paragraph in "What it draws", and the module table (`future.ts`, `solar.ts`, `additions.ts`, `commons.ts`).
- `docs/architecture.md`: the module map, and a line on the planner.
- `docs/render-pipeline.md`: the planner's position in the ground stage, the new layers, and `B.future`.
- `docs/coordinates.md`: the 200 m wonder cells and why the planner runs before the context filter.
- `docs/lod.md`: the new rules and the motif budget.
- `docs/extending.md`: a recipe for "add a solarpunk motif" (planner option, motif function, layer, LOD rule, catalogue entry, case).
- `docs/testing.md`: the new cases, the off-identity test, the gate base.
- `DESIGN.md`: the Future section and the title-block tag.
- `docs/solarpunk/`: keep this plan current as milestones land. Mark recipes done in §5.
