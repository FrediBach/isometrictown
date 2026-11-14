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
cam.lod             // cam.s times the Detail setting, for level-of-detail thresholds
cam.gap(mm)         // a hatch or texture spacing on paper, mm, scaled by the Detail setting
cam.rect            // drawing area on the sheet, [x0, y0, x1, y1] mm, inside margins
cam.region(h)       // local bounding box of all ground that can show, incl. buildings of height h in front
```

`cam.lod` is the level-of-detail switch: features check thresholds like `cam.lod < 0.25` (scale coarser than 1:4000 at normal detail) and skip themselves. It is `cam.s` times the Detail setting, so a higher Detail keeps small things at coarser scales. Use `cam.s` itself only for converting between metres and millimetres. Hatch and texture spacings on paper go through `cam.gap()`, so Detail closes them up or opens them out. Tone hatching (shadows, shaded walls), dash patterns and object counts that have their own slider (trees, traffic) don't use it.

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

- **`sequence(seed)`** → a stream. Only for things that may reshuffle with the view, such as wave strokes over water.

Never use `Math.random()` in drawing code.

Terraced rows share `Info.seed` so neighbouring houses in a row match.

### Seed locks

A building can carry its own seed. Clicking it in the preview gives it a new one, stored in `set.seedLocks` under `lockKey(info.seed)`, so a terrace rerolls as one. `seedFor(set, key)` returns the locked seed or `set.seed`. `classify()` uses it for the building's kind, height and roof, and `building()` sets it as `B.seed` while it builds. Inside `buildings.ts`, key hashes on `B.seed`, not `B.set.seed`, so roof details, rooftop boxes and awnings follow the lock. Everything else keeps `set.seed`.

Picking uses an id buffer kept next to the depth buffer: `Paper.fillFace(face, id)` records which building is nearest at each pixel (`Solid.pick`, set in `render()`). Sprites and other faces write `-1`, so they hide what's behind them. The worker keeps the last drawing's `Picks` and answers `pick` jobs with `pickAt()`.
