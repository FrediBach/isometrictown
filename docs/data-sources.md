# Data sources and caching

All data comes from public services, straight from the browser. Be a good citizen: cache, rate-limit and back off.

| Source | Module | Used for | Required? |
| --- | --- | --- | --- |
| [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema), z14 | `tiles.ts` | everything drawn | yes |
| [Overpass API](https://overpass-api.de) (3 mirrors) | `osm.ts` | real roof shapes, roof orientation, building types | no, best effort |
| [Nominatim](https://nominatim.org) | `search.ts` | place search | for search only |
| `public/cities.json` (Natural Earth) | `search.ts` | instant offline town suggestions | bundled |
| `@rapideditor/country-coder` | `styles.ts` | country, regional style, drive side; offline | bundled, lazy |
| OpenFreeMap Positron style | `locator.ts` | the little locator map (MapLibre) | for the UI only |

## Vector tiles (`tiles.ts`)

1. `loadTown(frame, box)` works out which z14 tiles cover `box` (from `cam.region(reachHeight)`). More than 36 → `TooBigError`.
2. The tile URL template comes from the OpenFreeMap TileJSON, cached a day.
3. Each tile is fetched through `netcache` (keyed by `z/x/y`, not the full URL, so a new planet build keeps cached tiles), decoded into a per-tile `Town` in absolute Mercator metres, and kept in an in-memory LRU (64 tiles).
4. `assemble()` merges tiles, converts to local metres, drops features outside the box, and marks **seams** where polygons were clipped at tile edges.

Decoding is where OpenMapTiles classes become app concepts: `ROAD_WIDTH` per road class, path classes, green land uses, key POIs (`KEY_POIS`, `SHOP_POIS`), runway widths by airfield class, glider/helicopter detection from airfield names, stream widths. Buildings without a real height carry `guess: true` (OpenMapTiles' 5 m default), which tells `classify()` to infer storeys.

To use a new OpenMapTiles layer or attribute, decode it in `decode()`, add a field to `Town` (and `empty()`), and carry it through `assemble()`.

## Overpass (`osm.ts`)

- Queried per z15 cell (max 24 cells), with an in-memory cache and a persistent one, and de-duplicated in-flight requests.
- Tries each mirror in turn, 9 s timeout each; after a failure, Overpass is left alone for 2 minutes.
- The worker waits at most `TAG_GRACE_MS` (2.5 s) after the tiles are in. Late tags are simply missed this time and are cached for the next drawing.
- `set.osmTags` turns it off.

## `netcache.ts`

A tiny wrapper around Cache Storage, shared by all tabs and the worker:

- `cached(store, key, ttl, as, load)`: fresh hit → no network; otherwise fetch and store; on failure use a stale copy if there is one.
- Two stores, `TILES` (1500 entries, month TTL) and `META` (5000 entries: TileJSON, Overpass cells). Pruned oldest-first.
- Keys that aren't real URLs use the synthetic `LOCAL` origin.
- Empty results are stored as empty (`x-empty`) so "nothing here" is cached too.
- If Cache Storage is missing (private windows), everything goes to the network.

Bump the store name (`-v1` → `-v2`) if the cached format changes.

## Place search (`search.ts`)

Nominatim is rate-limited to one request per second (`MIN_GAP_MS`) and results are cached in memory. The bundled city list gives suggestions without a request. Regenerate it with `node scripts/cities.mjs <ne_10m_populated_places_simple.geojson>`.

## Attribution

Map data © OpenStreetMap contributors must stay in the SVG `<desc>`, the about dialog and the README credits.
