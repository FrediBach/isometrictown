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

`sun` is a horizontal unit vector toward the sun; `left` means traffic keeps left; `key` gives the stable position key for `hash()`.

## Passes

| Stage (`app/stages.ts`) | What happens |
| --- | --- |
| `ground` | `classify()` fills `Building.info`. Water, pools, green, wood and roads are filled into **masks**. `planGround()` builds the land-cover plan `G` (if `set.ground`). |
| `buildings` | Buildings whose screen bounds touch `cam.rect` are built into `Solid`s; their footprints go into `M.foot`. |
| `life` | Trees (placed, then filtered by ground plan, plus orchards, gardens, scrub, hedgerows, street trees), traffic, parking, trains, then all the **extras** (lifts, ferries, bridges, airfields, aircraft, power, sites…). |
| `light` | Every solid face and tree sprite is rasterised into the **depth buffer**; `finishDepth()`. Then shadows are swept into `M.shadow`. |
| `lines` | Ground lines: waves, water outlines, park hatch, shadow hatch, ground textures, kerbs, rails, paths, lamps, railings, markings, each extra's `draw()`, fences. Then every solid's lines and tree sprites, traced against depth. Frame and marginalia last. |
| `plan` | (in the worker) `plan()` joins touching strokes and orders them to cut pen travel; `toSvg()` writes one Inkscape layer per pen. |

## `Paper` (`src/raster.ts`)

The drawing surface over `cam.rect`, at up to 7 px/mm (capped at ~7 M pixels).

- **Depth**: `fillFace(rings3d)` rasterises planar 3D polygons; `fillSprite(ring, depth)` a flat sprite. `finishDepth()` builds a 3×3 max buffer (`far`) used for line visibility. Lines are only traced after this.
- **Masks**: `paper.mask()` returns a `Uint8Array` the size of the raster. `fillMask(mask, rings)` fills ground rings (local metres, z = 0); `fillMask3` fills 3D polygons. Read with `paper.on(mask, sx, sy)` (sheet mm) or `onMask(paper, mask, x, y)` from `infra.ts` (local metres).
- **Lines**: `line3(pen, pts3d, test?, closed?)` projects and traces a 3D polyline, keeping only the parts that pass `test` (default `paper.seen`: not hidden behind depth). `sheet(pen, pts, test)` for polylines already on the sheet with depth; `hatchGround(pen, angle, spacing, keep)` for parallel hatching on the ground.
- **Output**: `paper.pens[pen]` is an array of sheet-mm polylines. Strokes shorter than two pen widths are dropped as they finish; draw marks meant to be that small inside `paper.fine(() => …)`.
- **Tally**: when `paper.tally` is set (only the LOD lab sets it, through `render()`'s last argument), every stroke is also filed under `paper.layer`, which `render()` sets to the feature drawing, such as `roofHatch` or `streets:kerbs`.

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

## Solids and extras

```ts
type Solid = { faces: number[][][]; lines: Line3[]; casts: { ring: number[]; h: number }[] };
type Extra = { solids: Solid[]; draw: (paper: Paper) => void };   // src/infra.ts
```

- `faces` go into the depth buffer, so the object hides what is behind it.
- `lines` are traced after depth, so the object is itself hidden correctly. Each line names its pen.
- `casts` are ground outlines with a height, swept away from the sun into `M.shadow`.
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
