# Coordinates, camera and determinism

Getting the coordinate space wrong is the most common way to break a drawing. There are five spaces.

| Space | Units | Axes | Where |
| --- | --- | --- | --- |
| Geographic | degrees | `[lng, lat]` (`LngLat`) | settings, search, locator map |
| Web Mercator ("absolute") | metres | x east, y north | tile decoding, Overpass cells, `B.key`, power-line grid |
| Local ("world") | true metres around the centre | x east, y north, z up | `Town` and all drawing code |
| Sheet | millimetres | x right, **y down** | `Paper`, pens, SVG |
| Depth | metres | grows away from the viewer | depth buffer, visibility tests |

## Frame: Mercator ↔ local

`Frame` (`src/geo.ts`) is built from `set.center`. Local metres are Mercator metres relative to the centre, scaled by `k = cos(lat)`, so they are true to scale near the centre:

```ts
x = (mx - frame.mx0) * frame.k
frame.toLngLat(x, y)   // back to degrees
```

`tiles.ts` decodes features in Mercator, then `assemble()` converts them to local metres and drops anything outside the requested box.

In `render.ts`, `toAbs(x, y)` and `fromAbs(X, Y)` convert between local and absolute Mercator metres. Feature code that must line up across views (tree scatter, power-line grid, wild ground) works in absolute coordinates and converts back.

## Camera: local → sheet

`Camera` (`src/camera.ts`) is orthographic. `bearing` turns the ground so that compass direction points up the sheet; `tilt` is the elevation of the view.

```ts
cam.sx(x, y)        // sheet x, mm
cam.sy(x, y, z)     // sheet y, mm (down)
cam.depth(x, y, z)  // metres, larger = farther
cam.ground(sx, sy)  // sheet → ground point at z = 0
cam.up              // ground unit vector pointing up the sheet (away from viewer)
cam.s               // mm per metre (1000 / scale)
cam.lod             // cam.s × Detail × 0.35 / pen width, for level of detail; per layer inside cam.within()
cam.size(m)         // m metres on paper as level of detail sees it, mm
cam.gap(mm)         // a hatch or texture spacing on paper, mm, scaled by Detail and pen width
cam.tone(mm)        // a tone hatch or dash spacing, mm, scaled by pen width only
cam.rect            // drawing area on the sheet, [x0, y0, x1, y1] mm, inside margins
cam.region(h)       // local bounding box of all ground that can show, incl. buildings of height h in front
```

`cam.lod` drives level of detail: it is `cam.s` scaled up by the Detail setting and down by a pen broader than 0.35 mm. Don't compare it with bare numbers; ask the rules in `src/lod.ts` with the thing's size (`shows(cam, LOD.chimney, width)`), as [lod.md](lod.md) explains. Use `cam.s` itself only for converting between metres and millimetres. Hatch and texture spacings on paper go through `cam.gap()`, so Detail closes them up and a broad pen opens them out. Tone hatching (shadows, shaded walls) and dash patterns use `cam.tone()`, which follows the pen but not Detail. Object counts that have their own slider (trees, traffic) use neither.

`reachHeight(set)` in `render.ts` is the tallest building expected to poke in from below; the worker passes it to `cam.region()` when choosing tiles.

## Rings and winding

- A `Ring` is `{ pts: number[]; seam: Uint8Array }`. `seam[i]` marks edge `i → i+1` as a cut along a tile edge; wall and outline code skips seam edges so tile borders never get drawn.
- A `Shape` is `Ring[]`: outer ring first (counter-clockwise, y up), then holes (clockwise).
- `ringArea()` is signed, positive for counter-clockwise.
- 3D polylines and faces are flat triples `[x, y, z, …]` in local metres.
- Sheet polylines are flat pairs `[x, y, …]` in mm; `Paper.sheet()` takes `[x, y, depth, …]`.

## Determinism

Two random sources, both in `src/rng.ts`:

- **`hash(...ints)`** → `[0, 1)`. Use it for anything placed in the world. Key it on `B.key(x, y)` (local position rounded to absolute Mercator metres), `set.seed`, and a **salt** number unique to that decision:

  ```ts
  const [k0, k1] = B.key(x, y);
  if (hash(k0, k1, B.set.seed, 443) < 0.35) { /* add a helicopter */ }
  ```

  Because the key is absolute, panning or rotating the view does not change what stands where. Reuse of a salt correlates two unrelated decisions, so pick a fresh one (grep for it first).

  For a decision shared by everything nearby (a stretch of parking, a hedge, a gantry every 50 m), key on **`B.cell(x, y, size)`**, the map-fixed cell of `size` Mercator metres that holds the point. Never snap local coordinates (`B.key(Math.round(x / 40) * 40, …)`): local metres are measured from the view's centre, so a grid in them moves when the view pans. For grids of your own, go through `B.toAbs(x, y)`.

  The same goes for anything a decision is measured from. Spacing along a way runs from the way's own ends, which the map fixes, not from a point that depends on what else is loaded. Anything worked out from the area loaded must not change near the drawing when the view moves: `Town.density` (how built up the land is) covers every tile loaded, and `Town.nearby` gives `classify()` land use, POIs, house numbers and streets out to the 250 m that buildings are loaded to as context. `test/render/pan.test.ts` checks it all, so run `npm test`.

- **`sequence(seed)`** → a stream. Only for things that may reshuffle with the view, such as wave strokes over water.

Never use `Math.random()` in drawing code.

Terraced rows share `Info.seed` so neighbouring houses in a row match.

### Seed locks

A building can carry its own seed. Clicking it in the preview gives it a new one, stored in `set.seedLocks` under `lockKey(info.seed)`, so a terrace rerolls as one. `seedFor(set, key)` returns the locked seed or `set.seed`. `classify()` uses it for the building's kind, height and roof, and `building()` sets it as `B.seed` while it builds. Inside `buildings.ts`, key hashes on `B.seed`, not `B.set.seed`, so roof details, rooftop boxes and awnings follow the lock. Everything else keeps `set.seed`.

Picking uses an id buffer kept next to the depth buffer: `Paper.fillFace(face, id)` records which building is nearest at each pixel (`Solid.pick`, set in `render()`). Sprites and other faces write `-1`, so they hide what's behind them. The worker keeps the last drawing's `Picks` and answers `pick` jobs with `pickAt()`.

### Power-route confidence

`Town.powerContext` retains complete land, water, stream, building, road and airfield geometry from the loaded tiles. Power foundations and conductor corridors use this world-space context, including off-sheet endpoints, rather than treating an empty screen mask as clear land. Transmission requires positive mapped land along the corridor; unknown ground rejects it. Rejected supports break a run. A transmission run is emitted only when both end towers, including their tops and arms, lie wholly beyond the print with an 8 mm guard. With power enabled, the loader requests an 800 m outer margin, capped at sixteen additional cached tiles; failed outer requests leave unknown terrain, which cannot justify a route. Only power context uses these extra tiles. The renderer inspects up to two spans beyond the ground box. Routes remain artistic inferences.

Roadside power joins compatible road endpoints using absolute map keys before choosing a side or spacing poles. A unique straight continuation can pass a junction; ambiguous branches remain separate. Routes are oriented and ordered by their absolute endpoint keys, so feature ordering or reversal does not change placement. Offset corners receive dedicated supports and regular poles keep clear of them. Urban eligibility is checked at each support rather than at a feature midpoint. No pole is emitted until an accepted span uses it.
