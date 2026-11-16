Build the mode around one central rule: **the future version should remain recognizably the same place, with transformed systems and a richer everyday life.** Preserve the apartment block’s proportions, the factory’s roof rhythm, the railway’s connections, and the landscape’s regional character. Then change how those places provide shelter, energy, movement, food, water, habitat, and shared space.

I created two complementary references:

- **[Solarpunk_Transformation_Atlas.pdf](https://chatgpt.com/library?file_id=libfile_fde3_f-e395cb7a696081919f996f5f67348df6_f27f370b36fc8191b9feb1c82eec7be6&account_id=personal)** — a 49-page guide with **103 object recipes**, climate profiles, illustrated transformations, eight worked examples, drawing rules, and sources.
- **[solarpunk_object_recipes.json](https://chatgpt.com/library?file_id=libfile_fde3_f-fa115e231ec08191ae9ea5d565907720_f27f370b36fc8191b9feb1c82eec7be6&account_id=personal)** — the recipes organized into preservation, transformation, drawing, and condition fields, with illustrative OSM matching hints. These are qualitative rules for your tool, rather than executable tag predicates.

The guide below develops the main approach and object transformations directly. The proposed appearances are an artistic interpretation; the sources ground the physical constraints, map semantics, and real architectural precedents.

## 1. Define what this solarpunk future looks like

### A future accumulated through care

A convincing default is a settled future several decades ahead. Buildings and infrastructure have been repaired, adapted, and sometimes repurposed. Trees have had time to grow. Several generations of improvements coexist.

The visual character should communicate:

- **Continuity:** recognizable roofs, street patterns, industrial structures, field boundaries, and landmarks.
- **Generosity:** comfortable entrances, shaded waiting places, useful balconies, public seating, accessible paths, and shared facilities.
- **Visible production:** workshops, deliveries, cultivation, material sorting, maintenance, and functioning utilities.
- **Ecological specificity:** the vegetation and water systems belong to the local environment.
- **Care over time:** repaired surfaces, maintained drains, pruned trees, renewed components, and inhabited outdoor spaces.

Retaining useful buildings also has a real environmental rationale: UNEP’s material strategy includes reducing new material demand through component reuse and repurposing existing buildings. That makes retained masonry, repaired concrete, and visible additions appropriate foundations for this aesthetic. [UNEP - UN Environment Programme](https://www.unep.org/en/news-and-stories/story/why-making-buildings-greener-crucial-countering-climate-change?utm_source=chatgpt.com)

### Preserve identity before adding features

For each object, identify its strongest recognizable characteristics:

| Object | Useful identity anchors |
|---|---|
| House | Footprint, roof shape, entrance, relationship to garden |
| Apartment block | Height, long or compact mass, floor rhythm, stair cores |
| Historic building | Silhouette, facade proportions, ornament, courtyard |
| Factory | Shed spans, sawtooth roofs, chimney, cranes, loading yard |
| Railway station | Hall, platforms, roof spans, track arrangement |
| Bridge | Structural system, span, supports, approach alignment |
| Agricultural parcel | Boundary, row direction, terraces, access tracks |
| River or wetland | Course, banks, channels, terrain, vegetation structure |

Preserve several of these visibly. An object loses its identity when foliage and new structures conceal every distinguishing feature.

### Use four levels of transformation

| Level | Transformation | Appropriate default |
|---|---|---|
| **Retrofit** | Preserve use and geometry; improve envelope, shade, energy, water handling, and surroundings. | Most existing objects, especially with incomplete data. |
| **Addition** | Add a supported balcony frame, veranda, canopy, pavilion, gallery, or other secondary structure. | Where space and a plausible support arrangement exist. |
| **Adaptive reuse** | Preserve the shell or infrastructure while changing its role. | Disused objects or an explicitly chosen redevelopment scenario. |
| **Retirement and restoration** | Remove selected equipment, release land, restore habitat, or replace obsolete structures. | Coordinated scenarios that account for the displaced function. |

This gives your generator an important distinction: **visual intensity and intervention depth are separate controls.** A building can look dramatically solarpunk through a generous shade structure and lively public ground floor while retaining its original use and mass.

### Give selected places moments of wonder

Every object does not need the same amount of transformation. Concentrate ambitious features at a few memorable sites:

- An apartment slab gains an inhabited outer frame with shared terraces.
- A station forecourt becomes a public room beneath a branching energy canopy.
- A school acquires an outdoor learning arcade linking its existing wings.
- A redundant industrial frame shelters a market or performance courtyard.
- A waterfront develops a sequence of working quays, civic terraces, and restored habitat.

Show supports, entrances, service routes, and the original structure within these compositions. Their ambition becomes believable when the drawing explains how people use them.

## 2. Build a common visual vocabulary

### Buildings should reveal layers

Keep older construction visible beneath newer environmental adaptations:

- Masonry walls with repaired joints and carefully fitted shutters.
- Concrete frames with renewed infill, exterior shading, and balcony additions.
- Industrial sheds with retained structural rhythm and replacement roof systems.
- Existing courtyards with new planted ground, sheltered edges, and useful small buildings.

New construction can use lighter frames, patterned screens, curved braces, slatted pergolas, or botanical ornament. Repeat a local family of details without applying one architectural style worldwide.

For monochrome rendering, material differences need distinct marks: sparse irregular joints for stone, restrained coursing for brick, spaced grain and joints for timber, folded edges for metal, and clean module divisions for photovoltaics.

### Roofs need allocation

Treat every roof as a limited surface shared by several possible uses:

1. Existing equipment and openings.
2. Access and maintenance routes.
3. Solar generation.
4. Suitable planting.
5. Optional occupied space.

Choose a compatible combination. A pitched domestic roof might receive one coherent panel group. A school roof might combine panels, rooflights, and equipment. A specially designed terrace might support deeper planting.

Low-growing extensive roof vegetation and an intensive rooftop garden containing trees have different structural and maintenance requirements. A map polygon cannot establish that either is feasible; large rooftop trees should therefore be conditional features with visible planting depth and substantial support. [US EPA](https://www.epa.gov/heatislands/using-green-roofs-reduce-heat-islands?utm_source=chatgpt.com)

### Vegetation should have an understandable home

Give plants:

- Ground or a visible planter.
- Space for roots and eventual crown growth.
- Plausible light and water.
- Maintenance access.
- A relationship to the site’s use.

Use ground-rooted trellises, courtyard trees, planted street edges, and modest roof vegetation frequently. Reserve spectacular elevated gardens for selected structures.

Distinguish planting forms graphically. An orchard has spaced rows; woodland has irregular canopy groups; reeds form upright clusters; meadow uses low broken strokes; dry scrub leaves substantial bare ground.

### Make systems legible through a few clues

You do not need to draw every pipe or cable. A small number of connections can explain the scene:

- A downpipe entering a tank.
- A planted depression receiving runoff through a curb opening.
- Charging equipment beside a vehicle depot.
- Sorted components beside a repair workshop.
- A shore-power connection at a berth.
- A shared tool shed beside garden plots.

Rain gardens and swales should appear as landforms that receive and convey water. EPA describes bioretention as a sunken collection area and swales as shallow channels; a raised decorative planter has a different function. [US EPA](https://www.epa.gov/green-infrastructure/types-green-infrastructure?utm_source=chatgpt.com)

## 3. Let climate change the appearance

Use a declared climate profile before selecting plants, facade systems, and public-space treatments. The following are proposed visual profiles. The underlying principle—that shading, ventilation, orientation, glazing, and form should respond to climate—is established in climate-responsive design guidance. [YourHome](https://www.yourhome.gov.au/passive-design/design-climate?utm_source=chatgpt.com)

| Context | Characteristic future appearance |
|---|---|
| **Temperate, seasonally wet** | Deciduous shade, rain gardens, hedgerows, sheltered seating, selected ventilated winter gardens, visible seasonal change. |
| **Hot and dry** | Deep reveals, arcades, screened courtyards, broad pergolas, covered water storage, mineral surfaces, concentrated drought-adapted planting. |
| **Hot and humid** | Deep eaves, shaded verandas, ventilated roofs, permeable screens, covered walkways, generous drainage, maintained air paths. |
| **Cold or high latitude** | Compact envelopes, vestibules, sheltered entrances, carefully placed sunspaces, seasonal cultivation, clear snow-storage areas. |
| **Monsoonal or flood-exposed** | Clear drainage and overflow routes, appropriate raised services, floodable public ground, robust sheltered circulation. |
| **Windy or coastal** | Low robust vegetation, sheltered courts, compact supported canopies, exposed working edges, shoreline treatments matched to wave conditions. |
| **Mountainous** | Contour-following terraces, retained walls, compact building clusters, modest spans, protected drainage, established cableway access where relevant. |

Combine climate with local morphology: masonry centre, timber town, courtyard settlement, concrete housing district, industrial waterfront, agricultural village, or suburb.

An arid solarpunk settlement can be visually abundant through shade, craft, and public activity while remaining sparsely vegetated. Solar-powered pumping also does not remove water limits: FAO identifies groundwater over-abstraction as a concern associated with expanding solar pumping. [FAO](https://www.fao.org/land-water/water/agricultural-water-management/water-harvesting-and-storage?utm_source=chatgpt.com)

## 4. Transform buildings according to their existing type

The table describes the visible transformation. Apply climate, support, access, and source-confidence rules to each recipe.

| Existing object | Preserve | Future appearance |
|---|---|---|
| **Detached house or bungalow** | Domestic scale, footprint, roof pitch, front door. | Repaired envelope, shutters or external shades, modest porch, selected roof panels, water tank, productive garden, useful shed. |
| **Terraced houses** | Narrow plots, party walls, repeated roof bays, individual entrances. | Coordinated roof-energy groups and street shade, varied shutters and repairs, small workshops or bicycle stores in existing outbuildings. |
| **Historic tenement or perimeter block** | Street wall, cornice, window proportions, courtyard. | Restored facade, planted courtyard, carefully placed rear galleries, useful ground-floor rooms, discreet roof upgrades. |
| **Modern apartment slab** | Long mass, floor rhythm, stair cores. | A supported outer frame of balconies, shaded galleries, or climate-appropriate winter gardens; generous entrances and shared ground-level gardens. |
| **Residential tower** | Height, slenderness, structural rhythm, skyline role. | Fine shading screens, a few substantial terrace zones, an inhabited podium, sheltered entrances, and significant planting on suitable ground. |
| **Office tower** | Skyline silhouette, facade grid, principal entrances. | Environmental facade layer, selected terraces, a public-facing ground floor, and compatible mixed uses in suitable portions. |
| **Office campus** | Existing buildings, courts, mature trees. | Connected shaded walking routes, shared work and learning spaces, planted former parking areas, common meeting pavilions. |
| **Small shops and mixed-use streets** | Storefront rhythm, plot widths, upper-floor access. | Awnings, repair and refill activities, sheltered counters, cargo-cycle deliveries, ordinary shops, and occasional tables or market stalls. |
| **Supermarket or retail shed** | Broad roof, entrance, delivery side. | Large coherent roof arrays, a sheltered food-market frontage, reuse services, reduced parking, retained loading and refrigeration equipment. |
| **Shopping mall** | Main halls, atria, structural spans. | Retail combined with repair, education, civic rooms, and markets; stronger external entrances; selected new courtyards in an intensive reuse scenario. |
| **School** | Classroom wings, hall, entrances, play areas. | Shaded schoolyard, outdoor classrooms, a modest teaching garden, covered cycle storage, suitable roof energy, clear pedestrian arrival. |
| **University or research campus** | Distinct laboratories, lecture halls, courts, historic buildings. | Shared workshops, demonstration gardens, shaded routes, visible campus utilities, and selectively accessible civic spaces. |
| **Hospital or clinic** | Medical organization, ward blocks, emergency approach. | Sheltered accessible arrival, recovery courtyards, comfortable covered links, improved envelope, and reliable utility infrastructure. |
| **Care home** | Familiar residential scale and garden connections. | Verandas, short accessible garden loops, frequent resting places, manageable growing beds, sheltered communal rooms. |
| **Library, town hall, community centre** | Civic entrance, main hall, public forecourt. | Shaded meeting space, lending or repair rooms, comfortable public seating, an inviting threshold, and daily community activity. |
| **Museum, theatre, cinema** | Distinctive hall, stage/service block, historic features. | Reused rooms, learning workshops, carefully improved envelope, sheltered arrival, and an outdoor performance courtyard where space allows. |
| **Religious building** | Specific sacred silhouette, symbols, orientation, actual use. | Repaired fabric, accessible approach, shaded gathering grounds, carefully placed systems on ancillary structures. |
| **Hotel or hostel** | Room rhythm, entrance, courtyard or tower form. | Shaded balconies, shared terraces, restrained gardens, bicycle arrival, selected roof systems, retained servicing and privacy. |
| **Stadium or sports hall** | Bowl or hall, playing surface, spectator geometry. | Suitable roof shading or generation, comfortable approaches, transit and cycle access, water collection, planted perimeter. |
| **Warehouse or workshop** | Clear spans, loading doors, sawtooth roofs, yard. | Continuing production, repair, storage, or recovery logistics; improved roof systems; sheltered material handling; planted nonworking edges. |
| **Barn and farm outbuildings** | Regional roofs, agricultural grouping, yard relationships. | Repaired shells, suitable roof energy, tanks, seed storage, shared equipment, processing, and farm workshops. |
| **Greenhouse or nursery** | Transparent structure, growing rows, service aisles. | Ridge vents, partial shade screens, water capture, potting facilities, compact service buildings, retained light-admitting surfaces. |
| **Garage or shed** | Compact shell, simple roof, large opening. | Bicycle storage, shared tools, small repair room, utility equipment, modest work canopy. |
| **Derelict or unfinished building** | Recoverable frame, significant walls, historic traces. | Stabilized structure, deliberate new infill, useful temporary occupation, or a maintained courtyard within retained remains. |
| **Incrementally built neighborhood** | Fine-grained paths, homes, livelihoods, local construction. | In-place repairs, drainage, shade, durable roofs, shared services, safer access, and small additions within the existing fabric. |
| **Emergency or secure institution** | Operational layout, entrances, service routes. | Compatible envelope and energy improvements, sheltered staff spaces, better outdoor areas; changed institutional use requires an explicit scenario. |
| **Monument, castle, fortification** | Landmark form, walls, inscriptions, sightlines. | Conservation, improved approaches, discreet services, and carefully adapted surroundings. |
| **Unclassified building** | All reliable geometry. | One or two restrained cues: roof-energy patch, modest shade, repaired frontage, or nearby planting. |

Two precedents and constraints are particularly useful:

**Apartment extensions can provide a strong, believable transformation language.** Lacaton and Vassal’s housing projects, including Grand Parc with Frédéric Druot and Christophe Hutin, retained existing buildings while adding generous extensions, winter gardens, and balconies. [The Pritzker Architecture Prize](https://www.pritzkerprize.com/laureates/anne-lacaton-and-jean-philippe-vassal?utm_source=chatgpt.com)

**Heritage needs a building-specific approach.** Historic England emphasizes context, significance, occupants, and interacting interventions. For your renderer, this supports retaining the principal architectural expression and concentrating stronger additions on appropriate secondary surfaces or adjacent structures. [Historic England](https://historicengland.org.uk/advice/technical-advice/retrofit-and-energy-efficiency-in-historic-buildings/whole-building-approach-for-historic-buildings/?utm_source=chatgpt.com)

For hospitals, workshops, shops, and farm buildings, keep the operational space visible. For office-to-housing or parking-to-housing conversions, require a deliberate reuse scenario: the footprint alone cannot establish suitable daylight, floor geometry, or access.

## 5. Transform transportation as a connected system

Decide corridor-level changes before placing individual assets. A beautiful tram stop needs a route; a cycleway needs continuous connections; a restored traffic island needs a safe way to reach it.

| Existing object | Preserve | Future appearance |
|---|---|---|
| **Residential street** | Alignment, junctions, entrances. | A narrower necessary-vehicle strip, generous walking space, cycle priority, selected delivery bays, shade trees in soil, planted drainage pockets. |
| **Commercial main street** | Shopfronts, crossings, service needs. | Broad sheltered frontage, connected cycle access, compact delivery areas, market spaces, and transit where a useful route fits. |
| **Arterial boulevard** | Through connection and major junctions. | Selected lanes reassigned to transit, cycling, walking, or planted medians; recognizable long parallel movement bands. |
| **Rural road or track** | Winding alignment, gradients, field access. | Quiet vehicles, occasional sheltered stops, appropriate verges and hedges, modest cycle connections where feasible. |
| **Motorway and interchange** | Regional role, ramps, embankments. | Functional freight and intercity movement, less redundant paving, deliberate habitat crossings, restored peripheral land, selected retired ramp traces. |
| **Intersection or roundabout** | Connected movements and sightlines. | Shorter crossings, refuge areas, continuous cycle movement, low planting, and clearly organized waiting space. |
| **Surface parking** | Necessary access and accessible arrival. | A mixture of retained bays, solar canopies, planted ground, bicycle storage, stormwater areas, and optional compatible infill. |
| **Parking structure** | Frame, ramps, deck rhythm. | Mobility and repair hub, bicycle storage, some parking, suitable ground-floor workshops, facade shading. |
| **Fuel station** | Familiar canopy and service building. | In a reuse scenario, charging, vehicle repair, shared mobility, collection services, and sheltered waiting. |
| **Service alley** | Loading doors, turning pockets, utility access. | Cargo cycles, compact delivery vehicles, reusable-container collection, maintained hardstanding, planting beyond the working route. |
| **Rail corridor** | Track alignment, switches, gradients, crossings. | Compatible cleaner traction, selective overhead equipment, improved stations, maintained track bed, restored margins outside operational space. |
| **Freight yard** | Track fan, switching logic, handling space. | Cleaner locomotives, intermodal transfer, repair sheds, sorted material bays, habitat on genuinely redundant ground. |
| **Railway station** | Hall, platforms, roof spans, entrances. | Welcoming forecourt, sheltered accessible approaches, bicycle parking, integrated transfers, suitable new energy canopies. |
| **Bus or tram stop** | Boarding edge and route relationship. | Compact shelter, seating, clear information, comfortable adjacent planting, unobstructed accessible movement. |
| **Bus or tram depot** | Entrances, sheds, apron, servicing. | Charging or electrical equipment, modern maintenance, roof systems, sheltered staff areas, a planted perimeter. |
| **Bridge or tunnel** | Engineering form and through connection. | Reallocated travel space where plausible, repaired structure, clearer approaches, improved drainage, restrained lightweight additions. |
| **Airport** | Runways, taxiways, aprons, operational clearances. | Rail-connected terminal, efficient shading, electric ground equipment, selective roof or parking solar; redundant land can change only under a closure scenario. |
| **Cargo port** | Berths, navigation, cranes, container lanes, rail. | Shore power, cleaner handling equipment, organized logistics, repaired warehouses, public or ecological edges where compatible. |
| **Ferry terminal or marina** | Dock arrangement, access, navigation gaps. | Sheltered waiting, accessible boarding, shore charging, appropriate small electric vessels, retained maintenance facilities. |
| **Cableway** | Cable alignment, towers, terrain relationship. | Modernized existing equipment, connected station access, suitable shading, repaired construction scars. |
| **Footway, cycleway, steps** | Useful connections, destinations, gradients. | Improved surfaces, continuity, resting points, shade, and genuinely connected alternatives where steps prevent access. |
| **Public square** | Civic axes, surrounding facades, gathering capacity. | A generous shade edge, sheltered market or meeting areas, seating, selected planting, and an open centre. |

Planting and drainage can be integrated with transit streets, but pedestrian intensity and boarding needs govern placement. NACTO’s guidance is useful grounding for that relationship. [NACTO](https://nacto.org/publication/transit-street-design-guide/station-stop-elements/green-infrastructure/?utm_source=chatgpt.com)

Airports need a distinct ecological treatment: wetlands and other wildlife-attracting land uses can conflict with active aviation. Concentrate the visual transformation on terminals, access, equipment, and suitable surfaces. [Federal Aviation Administration](https://www.faa.gov/airports/airport_safety/wildlife/management?utm_source=chatgpt.com)

At ports, shore power supplies an especially legible real-world cue: a vessel connects to shore-side electricity while berthed, reducing reliance on onboard diesel generation. [Port of Los Angeles](https://portoflosangeles.org/environment/air-quality/ocean-going-vessel-emission-reduction?utm_source=chatgpt.com)

## 6. Keep industry and utilities visibly functional

Industrial solarpunk benefits from recognizable machinery, orderly material flows, repaired structures, and healthier interfaces with surrounding places.

| Existing object | Future interpretation and visual cues |
|---|---|
| **Light factory** | Retain sheds and working yards. Show fabrication, repair, remanufacture, sorted inputs, finished goods, rooflights, and useful roof generation. |
| **Unknown industrial site** | Preserve known masses and equipment. Apply modest envelope, access, and perimeter improvements while leaving the process unspecified. |
| **Steelworks** | Retain halls, cranes, rail, and material routes. A chosen process scenario may introduce electric furnaces, scrap handling, or suitable lower-emission primary production infrastructure. |
| **Cement works** | Keep silos, conveyors, and raw-material connections. Show blending, alternative-input handling, process upgrades, and any explicitly selected capture infrastructure. |
| **Refinery or chemical works** | Choose a defined future role: specialized production, compatible alternative feedstocks, material recovery, or staged retirement. Retain appropriate tanks and pipe racks. |
| **Mine or quarry** | Active sites retain extraction and haul access, with improved containment and restoration on released areas. Closed sites retain benches, geological character, managed water, and selected industrial traces. |
| **Recycling or waste-transfer site** | Ordered material bays, covered sorting, repair space, collection routes, and distinct public drop-off and processing areas. |
| **Landfill** | Active areas remain managed. Closed areas show appropriate ground cover, drainage, monitoring, and compatible uses while retaining the containment landform. |
| **Fossil power station** | Under an explicit retirement scenario, reuse suitable halls and grid connections for storage, grid services, heat infrastructure, or fabrication; retain selected landmarks. |
| **Other operating power station** | Preserve the actual generation role, cooling, grid connection, and service needs. Improve compatible buildings and landscape edges. |
| **Hydropower dam or weir** | Keep water-level relationships, spillways, and powerhouse where operating. Improve compatible habitat connections; removal requires a basin-scale scenario. |
| **Solar farm** | Ordered arrays, access lanes, electrical equipment, and suitable vegetation, grazing, or crop use where the selected system supports it. |
| **Wind installation** | Strong, widely separated turbine silhouettes, exposed setting, foundations, maintenance tracks, and compatible surrounding habitat. |
| **Substation and power lines** | Continuous connections, recognizable equipment, maintained access, and planting outside working clearances. |
| **Energy storage or heat plant** | Plain modular buildings, tanks or cabinets, service doors, and coherent connections to energy sources and users. |
| **Waterworks or pumping station** | Preserve its actual role: intake, pumping, treatment, storage, or distribution. Show maintained process structures and protected operations. |
| **Water tower or storage reservoir** | Retain landmark form, utility purpose, inspection access, and appropriate surrounding landscape. |
| **Wastewater plant** | Preserve basins, process buildings, and maintenance paths. Add appropriate recovery, reuse equipment, and conditional downstream planted treatment areas. |
| **Telecommunications or data facility** | Retain antennas, connections, cooling, and servicing. Improve equipment and buildings; use heat recovery only where a useful destination exists. |

Industrial transformation must involve the process and its supporting systems. IEA’s steel and cement analysis identifies enabling electricity, hydrogen, and—in relevant pathways—carbon-dioxide infrastructure as part of the transition. Treat particular technologies as scenario choices. [IEA](https://www.iea.org/reports/demand-and-supply-measures-for-the-steel-and-cement-transition/executive-summary?utm_source=chatgpt.com)

Keep three distinctions clear:

- **Generation, storage, and distribution are separate functions.** A battery site needs charging energy; local generation still needs networks.
- **Water treatment and landscaping are separate functions.** Water reuse involves treatment and a subsequent use; a reedbed alone does not explain an entire treatment works. [US EPA](https://www.epa.gov/waterreuse/basic-information-about-water-reuse?utm_source=chatgpt.com)
- **A visible roof array does not establish energy sufficiency.** Use panels as part of the scene’s system, without implying that they power every industrial process.

Rooftop wind should be a selective motif. DOE identifies turbulence and vibration concerns for roof-mounted turbines, making ubiquitous little turbines a weak default. [Department of Energy](https://www.energy.gov/cmei/systems/frequently-asked-questions-small-distributed-wind-systems?utm_source=chatgpt.com)

## 7. Transform landscapes while preserving their ecology and use

For many natural places, the transformation is healthier continuity, reduced disturbance, or a better edge with human activity. UNEP’s restoration principles emphasize local context and warn that inappropriate species introduction can create further degradation. [UNEP - UN Environment Programme](https://www.unep.org/en/news-and-stories/story/panel-unveils-10-guiding-principles-campaign-revive-earth?utm_source=chatgpt.com)

| Existing landscape | Preserve | Future appearance |
|---|---|---|
| **Urban park** | Main paths, established trees, gathering places, open recreation. | A mosaic of shade groves, meadow, rain gardens, maintained lawns, and small useful facilities. |
| **Allotments or community garden** | Plot structure, sheds, paths. | Varied beds, shared tools, rain tanks, compost, accessible growing areas, shaded communal table. |
| **Sports field or track** | Playing surface, markings, oval, spectator relationships. | Shade at the edges, suitable spectator roofs, cycle access, planted drainage margins. |
| **Golf course** | Fairways, greens, terrain, clubhouse. | Less ornamental upkeep outside playing areas, appropriate rough, habitat links, clearer water management. |
| **Cemetery** | Graves, memorials, paths, cultural planting. | Quiet shade, compatible meadow areas, improved paths, discreet maintenance facilities. |
| **Formal or historic garden** | Axes, terraces, specimen trees, walls, cultural composition. | Repaired structure, discreet water capture, suitable planting adaptation, improved access. |
| **Arable fields** | Parcel geometry, entrances, productive ground. | Crop-strip variety, cover-crop textures, habitat margins, appropriate hedges or tree rows, clear machinery routes. |
| **Pasture or agricultural meadow** | Grazing or hay-making identity, gates, open sward. | Diverse low textures, rotational subdivisions, suitable shelter, protected stream edges. |
| **Orchard** | Tree rows and harvesting lanes. | Mixed tree ages, appropriate understory, replacement gaps, compact packing and water facilities. |
| **Vineyard or terraced crops** | Rows, trellises, contour direction, retaining walls. | Vegetated inter-row strips, repaired terraces, erosion-control margins, modest storage. |
| **Farmyard** | Barns, silos, animal routes, hardstanding. | Roof systems, water tanks, covered manure or compost handling, animal shade, repair workshop. |
| **Rice paddies or irrigated cultivation** | Bunds, levels, terraces, water distribution. | Legible control structures, seasonal crop and water textures, vegetated margins, appropriate pumping and storage. |
| **Woodland** | Extent, clearings, significant trees, routes. | Varied canopy sizes, gaps, healthier edges, restrained deadwood detail, connections across habitat breaks. |
| **Productive forestry** | Working blocks, access, harvesting role. | Mixed-age patches, retained habitat, riparian buffers, phased regeneration, useful timber yards. |
| **Natural grassland or savanna** | Open horizon and characteristic vegetation. | Repaired edges, low-texture diversity, reduced fragmentation, appropriate scattered trees. |
| **Heath, scrub, alpine ground** | Low vegetation, exposed rock, landform. | Recovery of disturbed patches, concentrated paths, modest access structures. |
| **Desert or dry rocky land** | Bare ground, sparse vegetation, seasonal channels. | Concentrated shade and activity nodes, protected drainage, modest planting near credible water sources. |
| **Natural river or stream** | Course, valley, tributaries, crossings. | Selected wider vegetated margins, connected floodplain patches, setback paths, occasional access points. |
| **Engineered urban waterway** | Channel alignment, bridges, necessary protection. | Compatible planted terraces or flood benches, repaired masonry, setback routes, retained hydraulic passage. |
| **Canal and locks** | Navigation width, straight reaches, towpath, gates. | Repaired banks, appropriate electric vessels, cycle access, planting outside operational areas. |
| **Drainage ditch or irrigation channel** | Connected flow paths and field functions. | Suitable grass or reed margins, controlled outlets, small crossings, maintenance strips. |
| **Lake or pond** | Shoreline and open-water dominance. | Selected vegetated shallows, protected quiet shores, concentrated fishing or boating access. |
| **Reservoir** | Storage function, dam, intake, fluctuating shoreline. | Improved catchment edges, monitoring, erosion control, restrained visitor facilities. |
| **Marsh or reedbed** | Open wetland pattern and water connections. | More continuous habitat, shallow irregular edges, limited perimeter boardwalks or hides. |
| **Bog, fen, peatland** | Low vegetation and wet-ground character. | Conditional rewetting, reduced disturbance, restrained access, interrupted redundant drains where appropriate. |
| **Mangrove or saltmarsh** | Tidal channels and distinct vegetation form. | Restored continuity, room for tidal processes, small access structures outside the core. |
| **Sheltered estuary or bay** | Tidal interface, navigation, working access. | Locally suitable marsh shelves, low sills, softer slopes, setback paths, retained necessary protection. |
| **Beach, dunes, exposed coast** | Sand, dunes, headlands, open shoreline. | Protected dune vegetation, consolidated boardwalk crossings, activity set back from sensitive edges. |
| **Aquaculture** | Pond or cage geometry, service routes, handling. | Appropriate spacing, monitoring, treatment, and locally suitable mixed cultivation where supported. |
| **Brownfield** | Useful structures, parcel identity, industrial memory. | Repair markets, workshops, non-food planting, and explicitly assessed growing areas. |
| **Protected natural area** | Habitat core and conservation purpose. | Fewer disturbances, stronger habitat connections, modest edge facilities, selective paths. |
| **Playground, picnic area, campsite** | Recreation and open space. | Robust shade, accessible facilities, repairable equipment, water and waste services, protected adjacent habitat. |

Three distinctions help prevent attractive but implausible outcomes:

**Agroforestry is one production system among several.** FAO describes combinations of woody plants with crops or animals, tailored to environmental conditions and farmers’ needs. Preserve substantial open cultivation where that remains appropriate. [fao.org](https://www.fao.org/agroforestry/about-agroforestry/overview/?utm_source=chatgpt.com)

**Coastal treatments depend on exposure.** NOAA identifies sheltered estuaries, bays, and rivers as good candidates for living shorelines; open-ocean beaches require different treatment. [NOAA Fisheries](https://www.fisheries.noaa.gov/insight/understanding-living-shorelines?utm_source=chatgpt.com)

**Vacancy does not establish clean soil.** EPA recommends contamination assessment before urban agriculture on potentially affected land. Raised beds are a possible part of a considered approach, rather than proof that the entire site is suitable. [US EPA](https://www.epa.gov/brownfields/urban-agriculture?utm_source=chatgpt.com)

## 8. Translate these transformations into isometric line art

### Make the main change readable at the export size

A useful drawing hierarchy is:

1. Original silhouette and terrain.
2. Structural edges and major routes.
3. The main future intervention.
4. Vegetation and secondary systems.
5. Small objects and people.

For a small building, choose **one dominant intervention and one supporting feature**. Examples:

- House: shaded porch plus roof-energy patch.
- Apartment block: balcony frame plus shared ground garden.
- Station: generous canopy plus bicycle arrival.
- Factory: organized recovery yard plus roof system.
- Arid square: shade arcade plus public seating.

This gives each object a readable role.

### Assign distinctive graphic signatures

| Motif | Line-art treatment |
|---|---|
| Solar array | Coherent rectangular group, sparse grid, slight mounting offset |
| Shade pergola | Thin plane or slats, repeated posts, usable space below |
| Winter garden | Offset facade frame, large transparent-looking panes, existing building visible behind |
| Trellis | Light support grid with partial climbing growth |
| Rain garden | Lower contour, curb opening, low texture, overflow relationship |
| Orchard | Regularly spaced crowns and harvesting lanes |
| Woodland | Irregular canopy groups, gaps, occasional exposed trunks |
| Meadow | Sparse low strokes and broad open areas |
| Reeds | Narrow upright clusters along wet edges |
| Dry scrub | Small separated masses with substantial negative space |
| Repair facility | Open bay, bench, sorted parts, handling canopy |
| Working utility | A few clear machines, tanks, doors, and connections |

Use restrained hatching to explain depth. Leave some walls, water surfaces, playing fields, and dry ground relatively quiet.

### Preserve one physical scenario across zoom levels

At distant scale, show spatial changes: shade groups, roof patches, reduced paving, connected habitat, and stronger public edges.

At middle scale, show balcony frames, shelters, garden beds, treatment basins, and selected equipment.

At close scale, add railings, vents, tank connections, signs, tools, and occupation.

The underlying future should remain the same when the viewer zooms. Detail becomes visible; buildings and networks should not acquire a different configuration.

### Render growth stage separately from required space

Reserve room for eventual tree crowns, but draw each plant at the maturity selected by the scenario. Mix retained mature trees with newer planting.

Choose one season and a consistent sun direction. Dry grasses, leafless trees, pruned orchards, and snow-storage areas can all belong in a successful solarpunk scene.

## 9. Translate the guide into rules for OSM objects

### Separate form, use, and lifecycle

This is especially important for your existing map pipeline. OSM’s building typology can differ from current function: a church-shaped building may contain a library or homes. Read the relevant use information separately. [OpenStreetMap Wiki](https://wiki.openstreetmap.org/wiki/Building?utm_source=chatgpt.com)

Maintain an internal record containing:

- Original tags and geometry.
- Building or object form.
- Current use.
- Operating or lifecycle state.
- Evidence confidence.
- Climate and local character.
- Selected intervention.
- Identity anchors.
- Generated additions and their conditions.

Preserve building parts, courtyards, and raised portions. Total building height includes the roof; `layer` describes relative ordering at crossings rather than metres of elevation. [OpenStreetMap Wiki](https://wiki.openstreetmap.org/wiki/Simple_3D_buildings?utm_source=chatgpt.com)

### Generate from the district toward the detail

A practical order is:

1. Resolve source geometry and semantics.
2. Select climate, season, maturity, and architectural character.
3. Establish connected transport, service, water, and habitat systems.
4. Choose each object’s recipe and identity anchors.
5. Reserve operational, access, and maintenance space.
6. Fit the main transformation and supporting elements.
7. Reject collisions, unsupported structures, and broken connections.
8. Render accepted geometry at the appropriate detail level.

Use stable seeds tied to source identity, scenario version, and rule identity. Coordinate district decisions so adjacent tiles agree.

### Put eligibility before randomness

A rule should describe its prerequisites and fallback.

For example:

**Courtyard tree**

- Requires an actual courtyard or suitable ground area.
- Reserves rooting and crown space.
- Preserves entrances and useful daylight.
- Uses a climate-appropriate form.
- Falls back to lower planting or a modest shade structure if space is insufficient.

**Parking-to-mobility-hub conversion**

- Requires an explicit reuse scenario.
- Retains usable circulation and structure.
- Allocates repair, storage, boarding, and retained parking deliberately.
- Avoids assuming that housing can fit without further information.

**Industrial water feature**

- Requires evidence of the actual process and water role.
- Preserves treatment and containment where relevant.
- Does not reinterpret every tank as drinking-water storage.

Generic pumping stations and storage tanks can handle many substances. Their content or substance information matters before selecting a water-specific transformation. [OpenStreetMap Wiki](https://wiki.openstreetmap.org/wiki/Tag%3Aman_made%3Dpumping_station?utm_source=chatgpt.com)

## 10. A complete example: an ordinary apartment block

Imagine the input contains a five-storey rectangular apartment building, a flat roof, surface parking, and a residential street.

**Preserve:** the building’s height, footprint, long silhouette, stair cores, facade rhythm, and entrance positions.

**Primary transformation:** add a light external frame that provides deeper balconies or shaded galleries. Carry its posts visibly to the ground. In an appropriate cold-climate variant, enclose selected bays as ventilated winter gardens.

**Roof:** place coherent photovoltaic groups around reserved equipment and access. Leave roof trees out unless the scenario supplies a suitably supported planting structure.

**Ground:** convert part of the parking forecourt into a shared garden with trees rooted in soil, accessible paths, seating, a small repair shed, and modest growing beds. Retain necessary servicing and accessible arrival.

**Street:** reallocate selected parking spaces to shade and planted drainage, keep a continuous access route, and connect cycling improvements to neighboring streets.

**Human detail:** add a few occupied balconies, laundry, bicycles, gardening activity, or people repairing something beneath the shared shelter.

**Graphic hierarchy:** the original slab remains the dominant mass. The balcony frame is the strongest new architectural element. Ground-level trees soften its setting. Roof panels provide a quieter technical cue.

The resulting image should let the viewer understand three things immediately: **what this place used to be, how it has changed, and how people now live there.** That is a useful test for every transformation in the mode.