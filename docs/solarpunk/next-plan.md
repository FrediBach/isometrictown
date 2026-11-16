# Solarpunk mode, part 3: a town that produces its own future

Follow-up to [bolder-plan.md](bolder-plan.md). **Status: implementation started. The first P1 structures, rooftop and neighbourhood wind plus connected public roofs from P2, P3 rooftop farms, tower garden bands and productive apartment galleries, the first P4 shared water systems, and part of P0 are built; the remaining work is proposed.** Read [../solarpunk.md](../solarpunk.md) for the current implementation and [intro.md](intro.md) for the art direction.

## Implementation status

- **First P1 slice built:** raised solar wings on suitable flat roofs; coordinated rear gardens with a solar growing house, two broad food beds and a 2.6 m cistern; standalone cisterns where a whole garden cannot fit. Hot climates use open growing shelters. These start at Transform. Today and Retrofit retain their previous drawings.
- **P2 structures built:** eight-metre rooftop vertical-axis wind assemblies, full rotor/service reservations, and rejection of roofs sheltered by taller neighbours. Branching public solar roofs span 20–50 m in Transform; Visionary connects two to five stepped solar bays over 40–96 m, with branching columns, a central skylight and rainwater collectors. Neighbourhood wind masts are now built as well: 35 m at Transform, selected 72 m machines in Visionary, with map-fixed spacing and no sheet-ranked cap. Public roofs now use full world-space envelopes and separate column reservations before trees and furniture. Wider civic/parking coverage and the complete neighbourhood-scale visual acceptance remain outstanding.
- **First P3 slice built:** Visionary slabs and commercial blocks with suitable flat roofs gain two or three stepped greenhouse storeys, four-metre growing terraces, irrigation and a solar crown. The complete addition stays within the host footprint and replaces its competing roof equipment. Ordinary towers now gain two to four broad garden bands with greenhouse cores, cultivation strips, small trees and corner columns. From Transform, clear apartment walls now gain five-metre productive galleries with shared greenhouse bays, food-growing terraces, columns and raised solar shade roofs. Full context clearance and competing-proposal rejection coordinate their ground reservations.
- **First P4 water slice built:** mapped pedestrian squares and education campuses can gain shared rainwater courts: paired five-metre tanks beneath a solar collector at Transform, or a 22 m supported water tower at Visionary. Productive apartment galleries gain paired four-metre cisterns beneath their first decks. Full context and route clearance keep public courts off playing fields, natural cover and occupied ground. Broader district connections and stepped water basins remain outstanding.
- **Planning:** `src/production.ts` reserves complete world-space footprints before context buildings are dropped. Roof holes, access margins, existing additions, transport routes, water, woodland and other land uses are excluded. Ground obstacles are retained from ordinary loaded tiles before the drawing-box filter, without extra network requests. Rear plots require mapped residential land. Neighbours competing for one plot both decline, independently of traversal order. Structures use separate LOD rules; zooming does not choose a new plot.
- **P0 started:** frozen Transform and Visionary lab baselines across the original six places plus Sapporo; planned/accepted/rejected site counts in the lab; direct Visionary-versus-Transform thumbnail, time and waste comparisons. Counts cover the loaded drawing area, including hidden sites, and are not a visible-coverage score.
- **Still outstanding in P0/P1:** a complete four-depth review board, broader garden inference where residential land is unmapped, coordinated pitched-roof/porch energy packages, and a neighbourhood that meets all of §6's Fit-size acceptance criteria. Existing pitched-roof panel decisions remain unchanged. Broader district water networks and ground-level growing halls belong to later work.
- **Visual result so far:** the new structures read clearly in close-ups, and solar wings alter the outline of suitable flat roofs. Whole-sheet changes remain modest, especially in historic places and at 1:4000. This is an initial implementation, not completion of the plan's bold visual target. Rooftop wind now changes suitable roof silhouettes. Ground wind now punctuates suitable productive land. Stepped garden buildings and productive galleries now change suitable silhouettes; connected districts remain outstanding in P4.



### First implementation checks

Named lab runs: `sp3-transform-before` → `sp3-transform-release` and `sp3-visionary-before` → `sp3-visionary-release`, seven places at 1:1000 and 1:4000, default 0.35 mm pens. The final uncropped-obstacle safeguard also has a `sp3-transform-verified` run. Selected Transform results (new-ink share / changed preview pixels against Today):

| Case | Before | After |
| --- | --- | --- |
| Mollis, 1:1000 | 18.5% / 13.3% | 20.0% / 14.2% |
| Rye, 1:1000 | 21.8% / 16.4% | 24.1% / 17.4% |
| Midtown, 1:4000 | 20.1% / 19.8% | 21.7% / 20.2% |
| Sapporo, 1:4000 | 24.2% / 25.0% | 26.3% / 25.6% |

The default-pen runs remain below ×1.6 plot time for Transform and ×2 for Visionary, and below +2 percentage points of waste against Today. Redundant beams across the solar surface were removed after the first version pushed Midtown just over that waste limit. The direct Visionary-versus-Transform differences remain small (about 0.2–4.5%); the later skyline milestones are still necessary.

The wider-pen check (`sp3-wide-pen`, Mollis, Rye and Sapporo at 1:500 and 1:8000 with 0.5 mm pens) found Rye at about +2.2 waste points against Today. An isolated pre-change checkout also measured +2.2 there: this is an existing budget exception, not a passing result. The wider-pen run preceded the final beam simplification.

Fit-size before/after sheets at both main scales, monochrome samples, busiest-area close-ups and targeted growing-house/cistern/solar-wing close-ups were reviewed with the CPU stroke rasteriser. Browser PNG generation was unavailable. The close-ups demonstrate the new structures; they do not establish whole-neighbourhood coverage. The 0.5 mm/1:8000 sheets and every possible climate/bearing combination were not checked by eye. Render timings were collected with other checks running and are not a controlled performance benchmark.

`npm run build` and `npm test` pass (979 tests). Nine Transform/Visionary goldens were reviewed and updated. All Today and Retrofit goldens remain unchanged. Unit tests cover full footprints, holes, narrow crossings, enclosed and off-sheet obstacles, conflicting neighbours, gates, source ordering, scale/bearing independence and 30/47/310 m translations; the existing rendered 30/47 m pan tests also pass.


### Rooftop wind and public-roof checks

Named comparisons: `sp4-transform-before` → `sp4-transform-final` and `sp4-visionary-before` → `sp4-visionary-final`, the same seven places at 1:1000 and 1:4000 with 0.35 mm pens. Maximum plot time against Today is ×1.491 for Transform and ×1.495 for Visionary. Maximum extra waste is +1.97 and +1.93 percentage points respectively; the incremental change from the preceding implementation is under +0.19 points. These are plot-time estimates, not controlled renderer performance measurements.

Reviewed the nine changed golden sheets as a Fit-size board, selected paired sheets and monochrome previews, and targeted rooftop-wind close-ups in Mollis, Amsterdam, Midtown and Sapporo. Narrow paired blade edges were simplified after the first review. The sampled town views do not demonstrate the larger public roofs: a controlled 90 m square verifies the 50/64 m spans, holes and enclosed-building rejection, and a separate CPU-rendered close-up checks the skylight and branches. Stricter clearance can remove an earlier canopy that overlapped occupied space. Browser PNGs remain unavailable; no physical pen plot, wide-pen run or exhaustive bearing/climate visual review was made for this slice. The final skylight refinement affects the controlled canopy example, not the sampled lab sheets, which contain no energy canopy.

Build and all 985 tests pass after reviewing and accepting nine Transform/Visionary goldens. Today and Retrofit goldens remain unchanged. New tests cover wind envelopes, roof holes, taller context neighbours, hospitals, depth gates, map translations and view independence, plus the public-roof footprint checks. Whole-sheet differences are still modest; this slice does not meet the complete neighbourhood acceptance criteria.


### Neighbourhood wind checks

`sp5-transform-before` → `sp5-transform-release` and `sp5-visionary-before` → `sp5-visionary-release` compare seven places at 1:1000 and 1:4000 with default 0.35 mm pens. New masts are visible around Mollis and Emmental at 1:4000; the other sampled town centres do not gain ground turbines. Maximum incremental plot-time estimate is under +0.03%; maximum additional waste is under +0.01 percentage points. Dense urban sites still need the later building/public-space interventions to achieve the broader visual goal.

Reviewed paired Emmental sheets, the changed Emmental golden, and targeted Transform/Visionary wind close-ups in Mollis and Emmental with the CPU rasteriser. A hidden simplified shaft found during review was corrected and given a rendered regression test. An isolated 1:1000 machine check also led to a connecting stroke when the nacelle is too narrow to draw as a box. Browser PNG generation remains unavailable. Physical plots, wide pens, every bearing/climate and 1:8000 sheets were not checked by eye in this slice.

Build and all 1,005 tests pass after accepting the one intentional Emmental Transform golden change: turbine strokes and meadow marks removed from their reserved footprints. Today and Retrofit goldens remain unchanged. Wind tests cover 30/47/310 m pans, scale, bearing, source order, Power-line independence, true-metre separation at high latitude, enclosed obstacles and holes, habitat exclusions, depth/settings gates, larger machines in place and off-sheet bases. Source land-cover subclasses and complete ordinary-tile wind obstacles are retained without extra network requests. At that stage P2 still needed connected public solar roofs and world-space public-space reservations; those are now implemented for mapped pedestrian squares.


### Connected public-roof checks

`sp6-transform-before` → `sp6-transform-release` and `sp6-visionary-before` → `sp6-visionary-release` compare the same seven places at 1:1000 and 1:4000 with 0.35 mm pens. A connected roof appears in Amsterdam at 1:4000; Midtown gains branching canopies, mostly hidden by surrounding towers. The other sampled centres do not gain visible public roofs. Maximum incremental plot time is under +0.07%, and extra waste under +0.004 percentage points. Whole-sheet change remains modest: this is a substantial local structure, not yet a town-wide transformation.

The planner now searches interior patches of irregular pedestrian polygons instead of treating their bounding centres as usable squares. It allows pedestrian paths under roofs while reserving columns separately. Controlled 96 m examples were reviewed at 1:1000 and 1:4000, together with real Amsterdam/Midtown close-ups, paired sheets and the two changed Midtown goldens. Smaller branching canopies simplify their radial ribs. The golden changes replace the affected squares' centrepieces and adjust shadows; their new roofs are largely occluded in those views. CPU rasterisation was used because browser PNG generation remains unavailable. Physical plots, wide pens, 1:8000 sheets and every climate/bearing combination were not checked by eye.

Build and all 1,026 tests pass after accepting the two intentional goldens. Today and Retrofit retain their previous drawings. New tests cover complete envelopes, interior search, column/path clearance, bridges, water, holes, depth gates, duplicate and reversed polygons, 30/47/310 m pans, and rendered depth through the central skylight. Public roofs currently require mapped pedestrian polygons; broader parking/civic coverage and P3's stepped garden buildings remain outstanding.


### P3 rooftop farm check

Compared `sp7-transform-before` with `sp7-transform-after`, and `sp7-visionary-before` with `sp7-visionary-clear`, across Mollis, Amsterdam, Midtown, Rye, Hallstatt, Emmental and Sapporo at 1:1000 and 1:4000 with the default 0.35 mm pen. Transform is identical. Visionary changes Midtown and Sapporo at both scales; the other five centres have no visible change from this slice. Maximum incremental plotting time is +0.40%, and extra waste +0.032 percentage points. Across these sheets, Visionary stays below ×1.495 plotting time and +1.882 waste points relative to Today.

The first version crowded narrow bed edges and railings at distant scale. The final version retains the greenhouse volumes and solar crown, simplifies beds to single cultivation strokes and omits close railing detail. Reviewed isolated 1:1000/1:4000 examples, real Midtown/Sapporo close-ups, paired whole sheets including monochrome, and the changed Midtown Visionary golden. CPU rasterisation was used because the browser PNG renderer remains unavailable. Physical plots, wide pens, whole 1:8000 sheets and every climate/bearing combination were not checked by eye. Unit geometry checks cover 1:8000, full footprint support, holes, seams, pan stability, roof coordination and depth visibility of terrace routes.

Build and all 1,037 tests pass. Only the Midtown Visionary golden changes: stepped additions replace competing roof equipment and occlude some lines behind them. This begins P3; Transform external growing frames and multiple tower garden bands remain to be built. The whole-sheet transformation is still limited by the supply of suitable flat-roofed hosts.


### P3 tower garden check

Compared `sp8-visionary-before` with `sp8-visionary-glass` across the same seven places at 1:1000 and 1:4000, with the default 0.35 mm pen. The new bands change Midtown at both scales and Sapporo at 1:4000. Maximum added plotting time is +3.18%, and extra waste +0.035 percentage points. Across the sampled sheets, Visionary stays below ×1.500 plotting time and +1.847 waste points relative to Today.

Reviewed isolated towers at 1:1000 and 1:4000, real Midtown/Sapporo close-ups, paired whole sheets including monochrome, and the changed Midtown Visionary golden. Repeated openings are visible in the tower district; the other five centres do not gain visible bands. Ordinary window grids inside the garden cores are replaced by broad greenhouse ribs, continuous fin screens are omitted on those hosts, and tree crowns retain a bounded physical height. CPU rasterisation was used because browser PNG generation remains unavailable. Physical plotting, wide pens, whole 1:8000 sheets and every climate/bearing combination were not checked by eye. Tests cover column visibility through the depth buffer at 1:1000/1:4000/1:8000 and three bearings, footprint clearance, holes, seams, band spacing, panning, raised bases, depth gates and protected buildings.

Build and all 1,042 tests pass. Only the Midtown Visionary golden changes. Today, Retrofit and Transform retain their existing goldens. This completes the repeated tower-band slice of P3; substantial external growing frames at Transform remain outstanding. These decks project from recessed cores within the original tower footprint; extensions beyond that footprint still need neighbourhood clearance planning.


### P3 productive-gallery check

Compared `sp9-transform-before` with `sp9-transform-clear` and `sp9-visionary-before` with `sp9-visionary-clear`, across the same seven places at 1:1000 and 1:4000 with 0.35 mm pens. Galleries change Rye and Sapporo at both scales, plus Amsterdam and Midtown at 1:4000. The other three sampled centres have no visible change. Maximum incremental plotting time is +2.28% at Transform and +2.27% at Visionary; extra waste stays below +0.166 percentage points. Across these samples, total plotting time stays below ×1.525 / ×1.534 relative to Today, and waste below +1.968 / +1.867 points respectively.

Reviewed isolated galleries at 1:1000/1:4000, real close-ups, paired whole sheets including monochrome, and the changed Rye Transform golden. The five-metre extensions and solar roofs alter suitable apartment silhouettes, but whole-sheet change remains limited by available space. Duplicated greenhouse edges were removed, and crowded deck outlines simplify at distant scales. The solar shade roof stands two metres above the host eave. CPU rasterisation was used because browser PNG generation remains unavailable. Physical plots, wide pens, whole 1:8000 sheets and every climate/bearing combination were not checked by eye.

Tests cover complete context obstacles (including tiny enclosed polygons), paths, streams, off-sheet neighbours, old additions, mutually conflicting proposals, stable placement under panning and changed projection/detail, depth gates, party walls, finite bounded geometry and depth visibility through open versus glazed bays. Build and all 1,051 tests pass. Only the Rye Transform golden changes: galleries and their shadows replace smaller additions, occlude nearby linework and reserve ground that previously held one tree. Today and Retrofit remain unchanged. This implements P3's external productive frames on suitable flat-roofed apartments; broader building types and the plan's full neighbourhood-level acceptance remain outstanding.


### P4 shared-water check

Compared `sp10-transform-before` with `sp10-transform-checked` and `sp10-visionary-before` with `sp10-visionary-checked`, across the same seven places at 1:1000 and 1:4000 with 0.35 mm pens. Public water courts appear in Amsterdam and Rye at 1:4000; gallery cisterns also change close views of Rye and Sapporo. Maximum incremental plotting time is +0.095% at Transform and +0.093% at Visionary; extra waste stays below +0.005 percentage points. Total plotting time remains below ×1.525 / ×1.534 relative to Today, and extra waste below +1.968 / +1.867 points respectively. These estimates are not controlled renderer benchmarks.

Reviewed isolated paired cisterns, the 22 m tower and gallery storage at close scale, real water-court close-ups, selected paired whole sheets including monochrome, and the changed Rye Transform golden with the CPU rasteriser. Elevated tanks cast their actual faces, preserving open space beneath them. The court structures are readable locally, but sparse mapped clear ground keeps whole-sheet change small. This does not establish the plan's full neighbourhood acceptance. Browser PNG generation remains unavailable. Physical plots, wide pens, whole 1:8000 sheets and every climate/bearing combination were not checked by eye.

Tests cover complete court and maintenance envelopes, holes, concave boundaries, enclosed obstacles, roads, paths, railways, bridges, streams, natural cover, playing fields, earlier structures, duplicate/reversed sources, competing proposals, 30/47/310 m pans, projection and detail independence, gates, finite geometry and depth through open tower supports. Campus context comes from ordinary loaded tiles without new requests. Build and all 1,075 tests pass. Only the reviewed Rye Transform golden changes, adding gallery cistern strokes and their occlusion/shadows; Today and Retrofit remain unchanged. Broader district connections, stepped water basins and coverage reporting for water courts remain outstanding.


## 1. The brief

Make the change immediately visible. This is a town where households, businesses and public institutions all want to generate energy, collect water, grow food and share useful space. The future should read through the skyline, the buildings and the street network before anyone zooms in to find a bicycle or a planter.

The visual language is **productive gardens joined to visible technology**: planted terraces carried on exposed frames, wind rotors above roofs, solar wings over occupied space, greenhouse ribs, water tanks with collection gutters and pipes, and cultivation organised around shared equipment. Greenery alone is not enough. Generic futuristic buildings alone are not enough either. The town needs both, visibly working together.

The previous plan built many features but kept the most dramatic ones rare. Its final Visionary measurements differ from Transform by only a point or two in many cases. Adding stalls did not change any 1:4000 drawing. This follow-up changes the scale and prevalence of interventions, rather than extending the list of small accessories.

**Desired first impression:** roofs produce power and food; buildings have grown terraces; streets sit beneath solar structures and gardens; wind and water infrastructure punctuate the skyline. The old place remains legible underneath a substantial new layer of construction.

## 2. Depth and permission to change the silhouette

Keep the existing three depths and the Transform default. No new slider is needed.

| Depth | Role in this plan |
| --- | --- |
| Retrofit | Freeze the existing result. Preserve its goldens. |
| Transform | Make productive roofs, household water systems, private food gardens and neighbourhood energy structures widespread. Add substantial external structures where they fit. |
| Visionary | Rebuild the skyline and public realm: stepped building extensions, elevated garden routes, large solar roofs, community growing halls and inhabited water terraces. |

The current documentation says building heights and roof shapes stay unchanged. **This plan deliberately changes that contract at Visionary.** Preserve source geometry and `Info` as the record of today's town; derive proposed massing separately. Existing footprints, street alignments, waterways and protected landmarks remain identity anchors. Extensions may change height, roof silhouette and the space above streets. They must have visible support and a usable connection to the ground or an existing building.

Do not flatten heritage districts into a common megastructure. Concentrate major additions on ordinary housing, slabs, shops, works and suitable public ground. Historic roofs can participate through adjacent shared systems. A constrained place may remain less transformed than a modern district.

## 3. Every ordinary property participates

Replace rare, independent decoration choices with a **productive-property plan**. Every eligible ordinary building receives a primary energy intervention and a water/food intervention when space permits. Intensity varies their extent and complexity; at the default, participation should already be widespread.

Choose compatible packages from building form, use, climate and available space. Reserve their geometry together so a greenhouse, tank and turbine do not each claim the same roof. A property that cannot accommodate a feature gets a meaningful alternative, or records why it cannot fit; do not force an object through a chimney or invent a garden on a road.

| Property | Main energy form | Water and food form | Immediate visual change |
| --- | --- | --- | --- |
| House or terrace | Broad solar wing, with occasional raised wind rotor where clear | Large cistern beside the house; productive rear garden or attached growing house | A repeated roof-and-garden pattern across the whole neighbourhood |
| Apartment block | Solar crown and a supported rooftop wind assembly on suitable buildings | Stepped growing balconies, shared greenhouse and grouped tanks on a service frame | A planted, inhabited frame changes the building's outline |
| Tower | Distinct solar crown; selected freestanding rotor frames above it | Broad planted terrace bands and communal growing decks | Several major breaks in the tower silhouette |
| Shop or works | Sawtooth solar roof or large energy canopy; mast turbines on suitable open plots | Growing hall on suitable reused sites; visible rainwater storage | A productive complex with a recognisable technical roof |
| School, station or civic site | Solar roof over forecourt or yard | Shared greenhouse and a water tower or cistern court | One large public structure with activity beneath it |
| Farm | Wind masts, solar growing shelters and barn roofs | Irrigation storage, greenhouse ranges and planted field divisions | Energy, cultivation and storage form a connected working landscape |

These are artistic scenarios, not claims that roof strength, wind yield, water quality or agricultural suitability have been assessed. Label invented interventions in the catalogue. Do not put food production on an industrial site solely because it looks vacant; prefer a visibly contained growing structure with a defined reuse recipe.

## 4. The big visual changes

### A. A wind-powered skyline

Wind power becomes a recurring part of the town rather than a rare turbine outside it.

- **Transform:** clear roof corners on suitable low and mid-rise buildings get vertical-axis rotor assemblies, approximately 4–8 m tall, on exposed braced frames. Show two or three curved blades around an axis, a generator housing and a service platform. Choose exposed, unobstructed sites; ordinary sheltered houses favour solar instead.
- Add neighbourhood wind masts on suitable open civic, works and farm plots. Use a distinct three-blade silhouette, approximately 20–40 m overall, with full rotor clearance.
- **Visionary:** larger shared wind structures, approximately 40–80 m overall, form recurring landmarks on open district edges and productive sites. Keep the existing large rural turbines where suitable.
- Replace the current view-ranked, three-per-sheet turbine selection with map-fixed spacing and exclusion rules. Density belongs to the world, not the current crop of the sheet. Test this explicitly before increasing coverage.
- Do not weaken rotor clearance to make a view busier. Reject collisions with buildings, other rotors, bridges and transport corridors. Do not treat marsh or protected open habitat as default turbine land.

**Fit-size signature:** a repeated skyline of recognisable wind machines, with different scales for a roof, a neighbourhood and the countryside. At 1:4000, retain the larger masts and simplify roof assemblies only where their physical size still reads.

### B. Solar wings and public energy roofs

Roof panels already exist. The next step is to turn solar collection into architecture.

- **Transform:** supported solar wings rise above suitable flat roofs and extend over terraces. On pitched housing, coherent arrays follow the roof, while selected porches and garden shelters carry visibly tilted solar planes. Preserve light and access below.
- Large car parks that remain, civic forecourts and suitable squares gain branching solar roofs spanning roughly 20–50 m. They shelter markets, cycle storage, workshops and growing space.
- **Visionary:** connected solar bays cover substantial portions of selected public squares or pedestrian corridors, roughly 40–100 m along a site where it fits. Break the roof into overlapping leaves or stepped planes so it has a strong silhouette and admits light.
- Show trunks, branching beams, collector panels, gutters and occupied space underneath. Make structural divisions broad enough to survive distant views; do not rely on dense module grids.

**Fit-size signature:** large, elevated geometric roofs interwoven with planted ground. These should be among the first shapes the viewer notices.

### C. Garden buildings, not window boxes

- **Transform:** selected ordinary apartment blocks acquire a deep external growing frame, with substantial terrace decks, shared greenhouse bays and solar shading above. Reserve the ground and carry columns visibly down to it.
- **Visionary:** suitable slabs and large commercial blocks acquire stepped additions: broad inhabited garden terraces at several levels, greenhouse rooms behind them and a solar crown above. Prototype terraces around 3–6 m deep and additions of one to three storeys, then constrain them to available space and the host building's proportions.
- Towers receive several broad garden bands with projecting supported decks, rather than one subtle recessed strip. Keep enough of the original vertical mass visible to recognise the tower.
- Growing decks have repeated cultivation beds, low crops and selected small trees. Trellises, exposed braces, irrigation headers and greenhouse ribs supply the technical character.
- Use one dominant structural rhythm per building. Replace competing facade texture beneath an addition where appropriate, rather than drawing every existing line through it.

**Fit-size signature:** buildings become stepped, planted structures. Their outline changes even when all five pens are rendered in black.

### D. Private food gardens and greenhouse neighbourhoods

Food growing should be ordinary and widespread, visibly present behind houses and on communal roofs.

- **Transform:** suitable private gardens become coherent productive plots: substantial parallel beds, trellised rows, one clear access path, a greenhouse or solar growing shelter, and a water tank. Keep some open domestic space and existing important trees.
- Treat adjacent properties individually but align their growing rhythm with the plots, so a street reads as a whole neighbourhood of food production. Never turn every garden into an identical stamp.
- At medium scale, draw greenhouse roofs, trellis frames and irrigation spines. At coarse scale, keep the greenhouse volumes and broad planted strips; drop individual vegetables, taps and tools.
- **Visionary:** suitable blocks and reused sheds gain long community greenhouse halls and productive roofs. Join a growing hall to tanks and an energy roof as one composition, with servicing and pedestrian access left clear.
- Climate changes the architecture: shaded growing courts and solar pergolas in hot, dry places; ventilated growing shelters in hot, humid ones; glazed winter gardens in cold places. Avoid a universal glass dome or lawn.

**Fit-size signature:** food production becomes a repeating land-use pattern and a new family of roof volumes, not scattered little beds.

### E. Water infrastructure you can actually see

- **Transform:** suitable houses get clearly legible cylindrical or rectangular cisterns, roughly 2–4 m across, integrated with the garden or an external service frame. Connect roof gutters to the tank and the tank to the growing area with simplified visible pipe runs.
- Apartments, civic sites and growing halls use grouped tanks and larger shared storage, roughly 4–8 m across where the site permits. Leave maintenance space. Tanks on elevated structures need an explicit supporting frame; do not place heavy vessels arbitrarily on roofs.
- **Visionary:** selected districts gain water towers, stepped planted basins and greenhouse/service structures organised around water collection. Use existing mapped banks or genuinely free ground; retain hydraulic passage and street crossings.
- Keep storage, irrigation and drainage visually distinct. Do not label inferred water as potable or manufacture waterfalls without terrain data.

**Fit-size signature:** tank clusters, service towers and broad water-garden terraces sit alongside the solar and wind forms. Small pipes support the story at close scale; they do not carry it alone.

### F. Elevated garden routes and transformed streets

Existing garden bridges are isolated objects. Visionary should offer a connected, inhabited layer above selected blocks.

- Build short, connected routes of broad planted decks between compatible garden buildings and civic structures, with clear landing terraces. Prototype widths of 5–8 m and spans of 12–30 m, expanding only where geometry supports it.
- Every route needs explicit access: a drawn stair/lift tower or a landing into an accessible building level. Avoid bridges ending at blank walls or isolated platforms.
- Combine selected ground-level pedestrian streets with long solar arcades, food-growing edges, water-storage nodes and groves. Preserve a continuous service route and clear intersections.
- Keep main roads, railways and navigation corridors operational. Elevated decks need three-dimensional clearance; a clear ground mask is insufficient.
- Limit elevated networks to suitable districts. These are large designed compositions, not a bridge across every street.

**Fit-size signature:** a second, planted circulation layer connects buildings above a visibly transformed public realm.

## 5. Plan compositions, then draw their parts

Extend the existing future planner with property packages and bounded district compositions. Names and types should follow the implementation, but each planned intervention needs an owner, world-space bounds, occupied volumes, support/landing locations and a reason for acceptance or rejection.

1. Read source geometry and preserve the Today interpretation.
2. Select property packages and district candidates using stable source identity or map-fixed cells.
3. Reserve large structures first: massing, deck routes, solar roofs, greenhouse halls and wind clearances.
4. Fit water storage, productive gardens and supporting systems into the remaining space.
5. Fill masks and depth from the accepted geometry, then draw its linework in the existing pass order.

Planning must not depend on zoom, bearing, visible pixels or a ranking of sites on the current sheet. LOD simplifies a fixed physical scenario. Use world-space collision tests for the placement of major structures; screen masks alone cannot establish off-sheet support or clearance.

Audit context requirements before composing across blocks. The previous plan already records view-dependent street narrowing when distant junctions enter the 250 m context. Tram-chain membership, shared car parks and district selection also need boundary tests. Bound each new composition's dependency radius; use cached, bounded context if needed, and reject proposals where required context is missing. Do not introduce an unlimited district search or a blocking terrain service.

## 6. Visual acceptance: immediately obvious means immediately obvious

The primary review is a four-way sheet: **Today, Retrofit, Transform and Visionary**, at identical settings and Fit size, plus monochrome versions. Visionary must look like a substantially rebuilt solarpunk town beside Transform. A colour shift, increased hatch density or a few additional objects is not a pass.

For each representative modern town or district:

- At 1:1000, identify at least three substantial changes without zooming: for example productive roofs, garden-building silhouettes, and wind/water structures.
- At 1:4000, retain at least two broad changes: for example solar roofs and planted deck networks, or greenhouse ranges and wind masts. Do not enlarge small objects as scale changes to achieve this.
- Across eligible ordinary properties, energy production and food/water provision should read as the norm. Report eligible, accepted and rejected counts so sparse results can be traced to missing space, over-restrictive rules or drawing loss.
- Review recognisability through retained street routes, major footprints, landmarks, shoreline and regional character. Historic or heavily constrained views are explicit exceptions to coverage goals, not excuses to overload them.

Keep new-ink share, thumbnail difference, plot time and waste in the lab. Add **Visionary versus Transform** comparisons; today's baseline alone cannot measure whether the depths have become distinct. Freeze comparison settings and thresholds. Treat the old 40–60% Visionary new-ink goal as an ambition, not evidence of success: heavier hatching can raise it without improving the scene. Likewise, a large pixel difference is a prompt to review identity, not automatic proof that the place is lost.

Retain the previous proposed plot-time ceilings of ×1.6 Today for Transform and ×2 Today for Visionary, and at most +2 percentage points of wasted ink, as provisional engineering budgets. Start by replacing subordinate texture and simplifying hidden/detail lines. If a compelling structural change cannot fit, record the visual comparison and measured cost before proposing a revised budget. These limits have not been newly approved by this plan.

## 7. Milestones

Each milestone ships a visible result, a before/after comparison and its tests. Build the large forms before their small fittings.

| Milestone | Work | Required visual result |
| --- | --- | --- |
| P0 — Visual baseline and composition contracts | Freeze current reference sheets; add depth-to-depth comparison and eligibility reporting; define world-space reservations and context bounds | A review board that exposes today's weak differences and names the intended large changes for each place |
| P1 — Productive neighbourhoods | Property packages; solar wings; private food plots; greenhouse volumes; prominent cisterns | An ordinary residential district visibly produces energy and food and collects water across most suitable properties |
| P2 — Wind and public energy architecture | Roof wind assemblies, neighbourhood masts, large branching solar roofs; replace view-ranked turbine caps | A different skyline and substantial new roof planes above public space |
| P3 — Garden buildings | Deep growing frames; stepped Visionary additions; multiple tower terraces and solar crowns | Building silhouettes change decisively, including in monochrome |
| P4 — Connected garden districts | Elevated routes with landings/access; solar arcades; growing halls; shared water structures | Visionary changes the district's spatial organisation, not just individual roofs |
| P5 — Climate, coverage and clarity | Regional variants, sparse-case review, collision fixes, LOD simplification and plot-budget tuning | Strong results across town types, with honest exceptions and no dependence on colour or close zoom |

Start P1 with an ordinary residential view and P3 with a slab district. Do not let a spectacular hand-picked square be the only proof that the mode works. After each milestone, review all six original reference places and at least one additional modern residential/industrial case that actually exercises the new geometry.

## 8. Implementation and verification

Likely touchpoints: `future.ts` for packages and climates; `reshape.ts` for ground allocation and corridors; `solar.ts` for energy roofs and growing shelters; `additions.ts` and `buildings.ts` for frames and proposed massing; `landmarks.ts` for wind and elevated connections; `commons.ts` and `landscape.ts` for water and productive ground. Split out a focused module when a substantial new system warrants one. Add catalogue entries and LOD rules for every new motif.

Before drawing changes, read [../architecture.md](../architecture.md), [../coordinates.md](../coordinates.md), [../render-pipeline.md](../render-pipeline.md), [../lod.md](../lod.md) and [../testing.md](../testing.md).

- Preserve Today and Retrofit goldens. Review each intended Transform/Visionary change in `test/out/*.svg` before accepting goldens.
- Test full footprints, rotor sweeps, supports, landing levels, service access and conflicts among packages. Include missing-context rejection and crowded sites where the correct result is omission.
- Check 30 m and 47 m pans, larger pans across context/tile boundaries, reordered source features and reversed way geometry. Fixed structures must survive those changes; sheet tone remains exempt as documented.
- Check scale and bearing changes preserve the physical plan. Exercise settings gates, climate overrides, seed locks and catalogue coverage.
- Use recorded real cases alongside synthetic geometry. Add fixture coverage for an ordinary garden neighbourhood, a modern slab district, a large civic square and a productive works/farm site as needed.
- Compare named LOD runs before and after each drawing milestone at 1:1000 and 1:4000; check affected cases at 1:500 and 1:8000 and with wider pens. Inspect Fit sheets and true-pen close-ups, and report anything not checked by eye.
- Run `npm run build` and `npm test`; run `npm run doctor` if React changes. Measure render time on Amsterdam and Midtown as well as plot cost.

Example baseline commands (the lab id for Trubschachen is `emmental`):

```bash
npm run lod -- --solarpunk --depth transform --places mollis,amsterdam,midtown,rye,hallstatt,emmental --scales 1000,4000 --name sp3-transform-before
npm run lod -- --solarpunk --depth visionary --places mollis,amsterdam,midtown,rye,hallstatt,emmental --scales 1000,4000 --name sp3-visionary-before
npm run lod -- --solarpunk --depth visionary --places mollis,amsterdam,midtown,rye,hallstatt,emmental --scales 1000,4000 --name sp3-visionary-after --compare sp3-visionary-before
```

Update the mode documentation's silhouette contract when P3 is implemented, and keep this plan's status tied to actual results. Baseline numbers in the preceding plan are historical measurements, not a fresh run for this proposal.

## 9. Outside this follow-up

Terrain-dependent cable cars, invented waterfalls, universal rooftop forests and isolated decorative braces are not priorities. Neither is increasing hatch density to meet an ink percentage. First deliver widespread productive systems and major, readable changes to architecture and public space.

No new depth or default change is proposed. The outstanding choice is how far the first Visionary massing prototype should go; P3 should present concrete before/after drawings and measured costs so that decision can be made from visible results.
