# Data sources and caching

All data comes from public services, straight from the browser. Be a good citizen: cache, rate-limit and back off.

| Source | Module | Used for | Required? |
| --- | --- | --- | --- |
| [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema), z14 | `tiles.ts` | everything drawn | yes |
| [Overpass API](https://overpass-api.de) (3 mirrors) | `osm.ts` | real roof shapes, roof orientation, building types | no, best effort |
| [Nominatim](https://nominatim.org) | `search.ts` | place search | for search only |
| [Photon](https://github.com/komoot/photon) public demo | `search.ts` | remote autocomplete when local suggestions are sparse | no |
| `public/cities.json` (Natural Earth) | `search.ts` | instant offline town suggestions | bundled |
| `@rapideditor/country-coder` | `styles.ts` | country, regional style, drive side; offline | bundled, lazy |
| OpenFreeMap Positron style | `locator.ts` | the little locator map (MapLibre) | for the UI only |

## Vector tiles (`tiles.ts`)

1. `loadTown(frame, box)` works out which z14 tiles cover `box` (from `cam.region(reachHeight)`). More than 36 → `TooBigError`.
2. Only a tile missing from both caches needs the URL template from OpenFreeMap TileJSON, cached a day. Cached tiles remain usable without the index.
3. Each tile is fetched through `netcache` (keyed by `z/x/y`, not the full URL, so a new planet build keeps cached tiles), decoded into a per-tile `Town` in absolute Mercator metres, and kept in an in-memory LRU (64 tiles).
4. `assemble()` merges tiles, converts to local metres, drops features outside the box, and marks **seams** where polygons were clipped at tile edges. The last assembled map is cached by frame and exact bounds; each render receives a fresh clone so inferred building data cannot leak between settings.

Downloads run at most four at a time per worker, including power context tiles. Tile requests and the TileJSON index have a 20 s timeout covering the response body too. Queue time does not count towards the timeout; cache hits bypass the queue. Failed downloads still fall back to stale cached tiles.

Layer toggles, seed, style, lighting, detail and pen settings do not invalidate map data. Centre, bearing, tilt, scale, sheet size/orientation, margin, marginalia and height scale can change the geographic bounds: these reassemble the map but reuse overlapping cached tiles. OSM tag toggles only affect the separate Overpass cache. Download progress is reported only when a tile actually needs the network.

Decoding is where OpenMapTiles classes become app concepts: `ROAD_WIDTH` per road class, path classes, green land uses, key POIs (`KEY_POIS`, `SHOP_POIS`), runway widths by airfield class, glider/helicopter detection from airfield names, stream widths. Water keeps its class (`waterCls`, in step with `water`) so ships can suit the sea, a lake or a river. Buildings without a real height carry `guess: true` (OpenMapTiles' 5 m default), which tells `classify()` to infer storeys.

To use a new OpenMapTiles layer or attribute, decode it in `decode()`, add a field to `Town` (and `empty()`), and carry it through `assemble()`.

## Overpass (`osm.ts`)

- Queried per z15 cell (max 24 cells), with an in-memory cache and a persistent one, and de-duplicated in-flight requests.
- Tries available mirrors in turn, 9 s timeout each. Each failed mirror is skipped for 2 minutes even when a fallback succeeds. Consecutive failures double its pause up to 30 minutes; success resets it. A readable `Retry-After` header can extend the pause. Cooldowns are persisted in Cache Storage and read before each attempt, so reloads retain them when storage is available. Without storage they remain in memory. Queries are serialised within each worker; separate tabs can still have requests in flight together.
- Responses carrying an Overpass runtime error are treated as failures, never cached as empty results.
- When all mirrors are cooling down, no requests are sent; cached tags and inference keep the drawing working.
- The worker waits at most `TAG_GRACE_MS` (2.5 s) after the tiles are in. Late tags are simply missed this time and are cached for the next drawing.
- `set.osmTags` turns it off.

## `netcache.ts`

A tiny wrapper around Cache Storage, shared by all tabs and the worker:

- `cached(store, key, ttl, as, load)`: fresh hit → no network; otherwise fetch and store; on failure use a stale copy if there is one.
- Three stores: `TILES` (1500 entries, month TTL), `META` (5000 entries: TileJSON, Overpass cells, provider cooldowns), and `SEARCH` (300 entries, day TTL). Pruned oldest-first.
- Keys that aren't real URLs use the synthetic `LOCAL` origin.
- Empty results are stored as empty (`x-empty`) so "nothing here" is cached too.
- If Cache Storage is missing or disabled, persistence is skipped; in-memory caches and cooldowns still work.

Bump the store name (`-v1` → `-v2`) if the cached format changes.

## Place search (`search.ts`)

The bundled city list supplies suggestions first; three local matches avoid a Photon request. Otherwise Photon supplies remote suggestions after the input debounce. Changing the query or selecting a place cancels old suggestions. Nominatim is called only on explicit submission.

Each provider has a serial queue with at least one second between request starts per tab, a 9 s timeout, and a persistent cooldown using the same backoff as Overpass. Cancelling autocomplete does not trigger a cooldown. Identical concurrent Nominatim submissions share one request.

Results, including empty answers, are cached by provider URL, normalised query and browser language for one day (100 entries in memory, 300 in Cache Storage). Stale answers remain available when the provider fails or is cooling down. Search results are stored only in that browser; no shared service is added.

These client limits do not enforce an application-wide quota: [Nominatim's public policy](https://operations.osmfoundation.org/policies/nominatim/) caps the combined traffic from all visitors at one request per second. A shared limiter or another provider is still needed for higher traffic. Photon is a [public demo with limited capacity](https://github.com/komoot/photon#demo-server).

Regenerate the bundled cities with `node scripts/cities.mjs <ne_10m_populated_places_simple.geojson>`.

## Attribution

Map data © OpenStreetMap contributors must stay in the SVG `<desc>`, the about dialog and the README credits.
