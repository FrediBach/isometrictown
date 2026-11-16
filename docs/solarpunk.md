# Solarpunk mode

The **Today | Solarpunk** switch in the preview toolbar draws the same place as a settled, repaired and inhabited future. The art direction is in [solarpunk/intro.md](solarpunk/intro.md) and its recipes; the full plan, with what is built and what is still to come, is [solarpunk/implementation-plan.md](solarpunk/implementation-plan.md).

## Rules the code keeps

- **Same place.** `classify()` runs as always and its `Info` is never changed. Footprints, heights, roof shapes, streets and water stay as they are. The mode only adds marks and, later, swaps a few.
- **Off means unchanged.** With `solarpunk` off, nothing reads a plan, so the drawing is identical whatever `future` and `climate` say (`test/render/future.test.ts`). Every hook checks `B.future` first.
- **One future at every scale.** `planFuture()` never looks at the camera. Level of detail decides only how much of the plan shows.
- **Fixed to the map.** Decisions hash the building's seed (`seedFor(set, info.seed)`, so a locked building rerolls its future too) or its position, with salts from 12000. LOD fades use salts from 9200.

## How it fits the pipeline

1. **Plan** (`src/future.ts`). In `render()`, straight after `classify()` and before context buildings are dropped, `planFuture()` gives every building a `Building.future`: its recipe (`B01` house, `B04` slab…), and whether it gets roof panels, a green roof or a rain tank. Rows decide together through their shared seed, so their panels line up. Landmarks, churches, castles and hospitals keep their roofs. The district plan (`FutureTown`, for now just the climate) goes on `B.future`.
2. **Climate.** `climateOf()` picks one of seven profiles from the style and the centre (`hot_dry` for the arid style, `mountain` for the Alpine one, and so on). The Town section can override it. `CLIMATES` holds what each profile asks for, such as how many roofs get planting or how many houses a tank.
3. **Draw.** Building code reads `b.future` while it builds:
   - `house()`: `roofPanels()` puts one panel group on the sun-facing slope, clear of dormers, chimneys and party walls.
   - `flat()`: plant rooms go up first (`rooftop(…, taken)`), then `futureRoof()` adds rows of panels with aisles and low planting in the room left.
   - `oneWay()`: `sawtoothPanels()` covers the opaque tooth slopes.
   - Each records its wall height in `b.future.eave`.
   - Rain tanks are an `Extra` (`commons.ts`), placed once every footprint is in `M.foot`, beside houses that were built.
4. **Budget.** `motifBudget()` says how much of a building's future shows: the main change alone, with its supporting change (rules `futureTwo`), or with close-scale fittings (`futureDetail`).

## Layers and pens

| Layer | Holds | Pens |
| --- | --- | --- |
| `solar` | panels on pitched, flat and sawtooth roofs | outline `LINEWORK`, a sparse grid every two modules in `SHADOWS` |
| `planting` | green roofs, rain tanks | `GREENERY`; downpipes `WATER` |
| `additions` | frames and canopies (to come) | `LINEWORK`, `ROOFS` |

Panels stand a little off the roof (`standoff()`), so the depth buffer hides the roof hatching under them. When rows on a flat roof are too close to tell apart (`pvRows`), the array becomes one outlined patch. Patches test their shorter side (`pvPatch`) and keep a pen-scaled inset from the roof edge, so they don't blot at coarse scales.

## Checking a change

`npm run lod -- --solarpunk --name sp-after --compare sp-before` draws the lab places in the mode. Compare it with a run of the mode before your change, and with one of the default drawing (no `--solarpunk`). The golden cases `*-solarpunk` in `test/cases.ts` reuse recorded places.
