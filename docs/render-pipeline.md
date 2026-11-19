# Render pipeline

`render(town, set, frame, style, onStage, left)` in `src/render.ts` turns a `Town` into five pens of polylines. The pass order matters: masks before placement, all depth before any lines, ground lines before solids.

## Inputs

- `Town` (`src/tiles.ts`): buildings, ways (roads, rails, paths), water, green, wood, plazas, land use and cover, POIs, house numbers, streams, tunnels, lifts, ferries, pools, runways, aprons, peaks, helipads, airports, and OSM `tagged` buildings. All in local metres.
- `Style` (`src/styles.ts`): roof shapes, pitches, overhangs, ridge rules, chimneys, dormers, balconies and so on for the region.
- `Settings`: every switch and slider.

## The `Build` context

Most drawing functions take `B: Build` (`src/buildings.ts`) first:

```ts
type Build = { cam; set; style; sun; left; key };
```

`fate` is what has become of the building being built and `fates` every building's, when Abandonment is above 0 (see [plans/abandonment.md](plans/abandonment.md)); at 0 both are unset and nothing about the drawing changes. `sun` is a horizontal unit vector toward the sun; `left` means traffic keeps left; `key` gives the stable position key for `hash()`. `sunBearing(set)` supplies its compass bearing: with `autoSun` on (the default), 135° in the northern hemisphere and 45° in the southern hemisphere, independent of camera rotation. Manual lighting retains the view-relative `sunAngle`, added to the camera bearing. Cast shadows and wall tone use this same vector.

## Passes

| Stage (`app/stages.ts`) | What happens |
| --- | --- |
| `ground` | `classify()` fills `Building.info`. With Abandonment above 0, `settle()` (`src/decay.ts`) then works out every building's fate into `B.fates` and lowers party heights next to ruins that have come down. Water, pools, green, wood and roads are filled into **masks**. `planGround()` builds the land-cover plan `G` (if `set.ground`); fallow fields and faded pitches are decided here. |
| `buildings` | The cinematic title (if on) is placed first, so buildings it stands in can be left out. Buildings whose screen bounds touch `cam.rect` are built into `Solid`s; their footprints, and the title's, go into `M.foot`. `building()` sets `B.fate` for the one it builds, and roofless ones are drawn by `src/ruins.ts`; their footprints also go into a mask of their own, where only growth may stand. |
| `life` | Trees (placed, then filtered by ground plan, plus orchards, gardens, scrub, hedgerows, street trees, and the growth over an abandoned town from `src/growth.ts`), traffic, parking, trains, then all the **extras** (lifts, ferries, bridges, airfields, aircraft, power, sites…). Each feature asks `src/decay.ts` what has become of its things; a bridge that loses a span clears the road mask over the gap here, before any line reads it. |
| `light` | Trim pitched-roof end outlines where another pitched face continues the same plane. Every solid face and tree sprite is rasterised into the **depth buffer**; `finishDepth()`. Then shadows are swept into `M.shadow`. |
| `lines` | Ground lines: waves, water outlines, park hatch, shadow hatch, ground textures, kerbs (broken in an abandoned town), road cracks, rails, paths, lamps, railings, markings, each extra's `draw()`, fences. Then every solid's lines and tree sprites, traced against depth. Optional Humanize then loosens the visible strokes, before the precise frame and marginalia are added. |
| `plan` | (in the worker) `plan()` joins touching strokes and orders them to cut pen travel; `toSvg()` writes one Inkscape layer per pen. |

## `Paper` (`src/raster.ts`)

The drawing surface over `cam.rect`, at up to 7 px/mm (capped at ~7 M pixels).

- **Depth**: `fillFace(rings3d, pick, face)` rasterises planar 3D polygons and records which face is nearest at each pixel (`owner`); where two faces all but coincide, the first keeps the pixel. A line given `on: face` in its `Line3` (roof hatching does this) is traced with `paper.onFace()`, so it shows only where its own face does, and overlapping parts of one roof don't show two hatchings at once.
  Wall ivy can set `groundFoot` on its leading stem. Samples on the ground plane use ordinary depth visibility as the runner crosses the soil to its wall. Above ground the stem and its leaves follow the supporting face.
  `fillSprite(ring, depth)` rasterises a flat sprite. `finishDepth()` builds a 3×3 max buffer (`far`) used for line visibility. Lines are only traced after this.
- **Roof rims**: pitched outlines name their supporting faces with `Line3.edge`. If the sampled depth rejects a rim against one of those same faces, `Paper.onEdge()` evaluates that face’s plane at the exact sheet position. This corrects self-occlusion from pixel-centre depth without overriding a nearer, unrelated face or sprite. Party and inner ends are emitted rather than assumed hidden; `finishRoofEdges()` removes only portions continued by a coplanar pitched face beyond the end. Other occlusion still goes through the depth buffer.
- **Masks**: `paper.mask()` returns a `Uint8Array` the size of the raster. `fillMask(mask, rings)` fills ground rings (local metres, z = 0); `fillMask3` fills 3D polygons. Read with `paper.on(mask, sx, sy)` (sheet mm) or `onMask(paper, mask, x, y)` from `infra.ts` (local metres).
- **Lines**: `line3(pen, pts3d, test?, closed?)` projects and traces a 3D polyline, keeping only the parts that pass `test` (default `paper.seen`: not hidden behind depth). `sheet(pen, pts, test)` for polylines already on the sheet with depth; `hatchGround(pen, angle, spacing, keep)` for parallel hatching on the ground.
- **Output**: `paper.pens[pen]` is an array of sheet-mm polylines. Strokes shorter than two pen widths are dropped as they finish; draw marks meant to be that small inside `paper.fine(() => …)`.
- **Tally**: when `paper.tally` is set (through `render()`'s last argument), every stroke is also filed under `paper.layer`, which `render()` sets to the feature drawing, such as `roofHatch` or `streets:kerbs`. Facets the catalogue can single out follow after slashes: `ground/fields`, `trees/street-trees/palm`, `details/…/chimney`, and every line of a building carries its kind, roof, window pattern and details (`roofs/house/gabled-roof/grid-windows/guessed-height/chimneys`). Name a facet with `paper.facet(name, draw)`, with `tag(layer, solids, facet)` in `render()`, or with `tagLines(layer, out, draw, facet)` for building details. The LOD lab folds facets back into their feature; the worker keeps the last drawing's tally for the catalogue.

## Masks

`M: Masks` (`src/nature.ts`) is shared by every pass:

| Mask | Holds | Typical use |
| --- | --- | --- |
| `road` | road, plaza, runway, apron surfaces | keep trees, hatch and objects off roads |
| `water` | water bodies, streams, pools | waves, boats, keep things dry |
| `pool` | swimming pools | ripples instead of waves |
| `green` | parks and green land use | grass hatch |
| `wood` | woods | trees, no grass hatch |
| `foot` | building footprints in view | keep objects out of buildings |
| `shadow` | swept cast shadows | shadow hatch |
| `under` | bridge decks | hide water lines under bridges |
| `calm` | padded ship and ferry hulls, with a short tapered trail | no waves there; sailing boats keep off |

## Solids and extras

```ts
type Solid = { faces: number[][][]; lines: Line3[]; casts: { ring: number[]; h: number }[]; shade?: number[][][] };
type Extra = { solids: Solid[]; draw: (paper: Paper) => void };   // src/infra.ts
```

- `faces` go into the depth buffer, so the object hides what is behind it.
- `lines` are traced after depth, so the object is itself hidden correctly. Each line names its pen.
- `casts` are ground outlines with a height, swept away from the sun into `M.shadow`.
- `shade` (optional) holds 3D faces that don't stand on a footprint, such as the cinematic title's floating letters; each is projected along the sun onto the ground into `M.shadow`.
- An `Extra`'s `draw()` runs in the ground-lines pass, for things flat on the ground (markings, aprons, crossbucks' ground parts).

Helpers: `newSolid()`, `prism()` (walls with windows and roofs), `slab()`, `rect()`, `place()` (local frame → world), `measure()`/`at()` (walk a polyline by distance), `walk()` and `shifted()` in `streets.ts`.

## Pens

Indices are constants in `src/settings.ts`, in plot order, darkest last:

| Index | Constant | Draws |
| --- | --- | --- |
| 0 | `SHADOWS` | cast-shadow hatch, shaded walls |
| 1 | `WATER` | waves, pool ripples |
| 2 | `GREENERY` | parks, trees, fields |
| 3 | `ROOFS` | pitched roofs, awning stripes |
| 4 | `LINEWORK` | buildings, streets, everything else, margin |

With `set.mono`, `plan()` merges every pen into `LINEWORK`.

## Performance notes

- Buildings are culled by screen bounds before being built; cull other features too.
- Masks and depth are flat typed arrays; hot loops avoid allocation. Keep it that way.
- `onStage` is called often; the worker throttles counted progress to one message per 50 ms.
- At most 36 tiles per drawing (`MAX_TILES`); beyond that the worker throws `TooBigError`, shown to the user as advice.

### Feature pen overrides

When enabled, `layerPens` routes feature linework into the five existing pens before planning. Solids can carry a `layer`, and individual building lines carry finer identities for windows, roof hatching, roof details and wall shading. A solid identity takes precedence for objects such as trains that reuse building helpers. `tagLines()` marks only appended lines. Ground passes temporarily set `Paper.penOverride`, restored after the pass. Masks, faces, visibility, placement and shadow casting are unchanged. Monochrome still merges all routed output in `plan()`.

## Humanize

`humanize.ts` perturbs visible strokes after hidden-line removal and before joining and ordering. Errors scale with stroke length up to fixed millimetre limits; short marks stay restrained. Each stroke keeps its array identity so catalogue highlights and LOD measurements see the same linework. The map keys of the ground-projected endpoints and the drawing seed determine its variation. Unclipped strokes retain their errors when panned; clipping may change a stroke’s endpoints and therefore its variation. Small overshoots at occlusion boundaries are intentional. Coordinates stay within the drawing rectangle. Frame and margin lettering remain precise. Zero bypasses the pass entirely.

## Preserving empty space

In image mode, `image-space.ts` uses the target's alpha and optional highlight cutoff to reserve bare paper. After Humanize, it splits visible strokes wherever the pen would enter reserved paper, allowing for the pen width and plot coordinates. The feature catalogue receives the same clipped paths as the SVG and plotter. The frame and margin lettering are added afterwards.
