<p align="center">
  <img src="public/logo.svg" alt="Isometric Town logo" width="96" />
</p>

<h1 align="center">Isometric Town</h1>

<p align="center">Pick any town and draw it in isometric 3D, as plotter-ready SVG linework.</p>

<p align="center"><b><a href="https://isometrictown.com">isometrictown.com</a></b></p>

Search for a place, drag the little map to frame it, and turn the view. Isometric Town fetches the buildings, streets, water and parks from OpenStreetMap and draws them as an isometric 3D scene. You can download the result as an SVG with one layer per pen.

## What it draws

- **Buildings** use their real footprints and heights from the map data. Windows are set by floor. Most buildings have no height in the map, so their storeys are worked out from what they are, the region and how densely built the town is round them: low houses in suburbs, taller rows and blocks in town centres.
- **Shop fronts** with wide windows and striped awnings line the ground floors where the map has shops, and along busy and pedestrian streets in town centres.
- **Flat roofs** carry boxes, water tanks (on legs in North America) or rows of solar panels, depending on the region.
- **Balconies** hang off flats where that's the habit: deep ones in southern and eastern Europe and East Asia, and in Paris a continuous railing on the second and fifth floors of the street front.
- **Squares** big enough get a fountain or a statue in the middle.
- **Landmarks the map names**: castles get battlements, and in much of Europe pointed corner turrets; the main hospital buildings get a helipad on the roof; town halls fly a flag. Big works may have a tall chimney stack beside them.
- **Street furniture**: bus stops get a shelter and a sign, petrol stations a canopy over the pumps, and busy junctions traffic lights. Mountain tops get a summit cross and their height.
- **Roofs** follow what each building is and where it stands. Houses get gabled, hipped, half-hipped or mansard roofs, and L- and T-shaped houses get cross gables. Terraced rows share party walls, with chimney stacks on them. Paris blocks get mansards with dormers. Dutch canal houses turn stepped or neck gables to the street. Factories get sawtooth roofs, churches get a tower and spire, mosques get a dome and minaret, and temples get tiered roofs.
- **Regional style** is picked from the country: Alpine, Dutch, British, French, Mediterranean, East Asian, North American and more. Each style sets roof shapes, pitches, overhangs, which way ridges run and how many chimneys and dormers there are. You can override it.
- **Streets** get kerb lines, parked cars and street lamps, centre dashes and zebra crossings near busy junctions. Main roads may be lined with trees, and roundabouts get a planted island. Parking aisles get painted bays with cars in them.
- **Railways** get rails and sleepers; narrow gauge sits closer, and trams run under a contact wire hung from poles. In Europe and East Asia main lines run under overhead wires on masts, and station platforms get a canopy on columns. Where a road or railway goes underground there's a portal with an arch. Footpaths are dashed, farm tracks are two wheel ruts, and steps have treads.
- **Cable cars, gondolas, chair lifts and drag lifts** hang from pylons, with cabins, chairs or bars along the cable and stations where they end.
- **Airfields** get runway markings, taxiway lines and planes parked on the aprons.
- **Water** is drawn as wavy strokes, with boats moored along quays and in harbours, and ferries on dotted routes. Bridges over water show their side: masonry arches for most, beams on piers for railways and big roads, and piers stand on rows of posts. Where industrial land meets the water there are quayside cranes and stacks of containers. Swimming pools get a hard edge and level ripples. Parks are hatched, and parks and woods get trees.
- **Fields and pitches** each get their own texture:
  - Fields are furrowed along their length, and some are dashed stubble.
  - Vineyards get trellis rows on stakes, and orchards get rows of fruit trees.
  - Meadows get grass tufts, marshes get blue dashes with tufts, and sand is stippled.
  - Villages and suburbs often map only "residential" round their houses, with no gardens drawn. Where buildings cover less than 30% of such an area, the open ground is drawn as lawn with a few garden trees, and each house gets a plot fenced the local way: hedges, walls, fences or picket fences. Front gardens may have a driveway with a car on it, back gardens a shed or a trampoline.
  - Field edges get hedgerows with the odd tree, most of all in Britain and France.
  - Scrub gets bushes, allotments get plots and sheds, bare rock gets boulders and glaciers get crevasses.
  - Beaches get parasols and towels, campsites get tents and caravans, playgrounds get swings and a slide, and quarries are cut into benches.
  - Big barns out among the fields get a silo or two.
  - Cemeteries get rows of headstones and crosses.
  - Sports pitches get their markings for football, tennis, basketball or a running track, with goals, nets and hoops.
- **Shadows** are hatched on the ground, from a sun you can move.
- **Map notes** letter the margin like a printed town map, in single-stroke capitals. The neat line gets a second border with latitude and longitude ticks. Below the drawing are the place name, its coordinates and view, a scale bar, a round north arrow whose needle runs along north as drawn, parallel to north–south streets, and the imprint.

Most buildings aren't tagged with a roof shape in OpenStreetMap, so roofs are worked out from the footprint, the neighbours, the nearest street, points of interest (places of worship, schools), house numbers and land use. Where OpenStreetMap does tag a roof shape or building type, that's used instead. Trees, cars and lamps are made up. Everything made up is tied to the seed and to map position, so the same settings always give the same drawing, and panning doesn't reshuffle it.

## Made for pen plotters

- Hidden lines are removed geometrically with a depth buffer before export, so nothing shows through a wall and nothing is drawn twice.
- Each pen is its own Inkscape layer, in plot order: shadows, water, greenery, roofs, linework.
- Strokes that touch are joined, and the stroke order is sorted to cut pen-up travel.
- The stats panel shows ink length, pen lifts and an estimated plot time for each pen.
- Sizes are real millimetres for A4, A3, A2, Letter, Tabloid and more.

## How it works

| File | Role |
| --- | --- |
| `src/tiles.ts` | Loads OpenFreeMap vector tiles (z14), clips them to tile edges and marks seams |
| `src/osm.ts` | Fetches tagged roof shapes and building types from Overpass, best effort |
| `src/styles.ts` | Regional building styles and offline country detection |
| `src/classify.ts` | Works out each building's kind, height where the map has none, party walls, street side, shop fronts and roof |
| `src/camera.ts` | Orthographic isometric camera: rotation, tilt, scale |
| `src/shape.ts` | Footprint geometry: best-fit rectangles, splitting into rectangles, inset outlines |
| `src/buildings.ts` | Walls, windows and the choice of roof per building, rooftop boxes, cars |
| `src/roofs.ts` | Pitched, mansard, shed and sawtooth roofs, gables, chimneys, dormers, spires, domes |
| `src/streets.ts` | Road surfaces, kerbs, lamps, rails and trams, footpaths, tracks and steps |
| `src/infra.ts` | Lifts, ferries and moored boats, bridges, station platforms, tunnel portals, airfields, road markings, parking bays, roundabouts |
| `src/gardens.ts` | Garden plots and their hedges and fences, driveways, sheds and trampolines, field hedgerows, street trees |
| `src/sites.ts` | Beaches, campsites, playgrounds, farm silos, ports, quarries, fountains and statues, bus shelters, petrol stations, factory chimneys, summit crosses |
| `src/ground.ts` | Field furrows, vineyards, orchards, meadow and marsh symbols, sand, inferred gardens, headstones, pitch markings |
| `src/nature.ts` | Tree placement and tree sprites |
| `src/raster.ts` | Depth buffer, screen-space ground masks, visibility tracing |
| `src/render.ts` | Runs the passes in order |
| `src/lettering.ts`, `src/marginalia.ts` | Single-stroke lettering and the map notes in the margin |
| `src/plot.ts` | Stroke joining, ordering, plot stats, SVG output |
| `src/worker.ts` | Runs all of the above off the main thread |
| `src/App.tsx`, `src/components/` | The interface, built with React and shadcn/ui (see [DESIGN.md](DESIGN.md)) |

## Run it locally

```bash
npm install
npm run dev
```

## Credits

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Tiles by [OpenFreeMap](https://openfreemap.org), schema © [OpenMapTiles](https://www.openmaptiles.org). Map view by [MapLibre GL](https://maplibre.org). Place search by [Photon](https://photon.komoot.io) and [Nominatim](https://nominatim.org). Roof tags via the [Overpass API](https://overpass-api.de). Country lookup by [country-coder](https://github.com/rapideditor/country-coder). Town list from [Natural Earth](https://www.naturalearthdata.com).

## License

[MIT](LICENSE)
