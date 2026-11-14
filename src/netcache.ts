/**
 * A persistent cache for downloads that rarely change (map tiles, Overpass results), kept in
 * the browser's Cache Storage so it survives reloads and is shared by every tab and worker.
 * When the network fails we fall back to a stale copy, so a busy server doesn't stop a drawing.
 * If Cache Storage isn't there (private windows, insecure origins) everything just goes to the network.
 */

const STORED_AT = 'x-stored-at';
/** Synthetic origin for keys that aren't real URLs. */
export const LOCAL = 'https://cache.isometrictown.local/';

type Store = { name: string; maxEntries: number };

const opened = new Map<string, Promise<Cache | null>>();
const writes = new Map<string, number>();
/** Prune a store after this many writes, and once when it's first opened. */
const PRUNE_EVERY = 25;

function open(store: Store): Promise<Cache | null> {
  let c = opened.get(store.name);
  if (!c) {
    c = (async () => {
      try {
        if (typeof caches === 'undefined') return null;
        const cache = await caches.open(store.name);
        void prune(cache, store.maxEntries);
        return cache;
      } catch {
        return null;
      }
    })();
    opened.set(store.name, c);
  }
  return c;
}

/** Drop the oldest entries beyond the cap. Cache Storage lists keys in insertion order, and a re-put moves a key to the end. */
async function prune(cache: Cache, max: number): Promise<void> {
  try {
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
  } catch {
    /* best effort */
  }
}

export type Hit<T> = { value: T; fresh: boolean };

/** Read a cached value. `fresh` says whether it's younger than `ttlMs`. */
export async function read<T>(store: Store, key: string, as: (r: Response) => Promise<T>, ttlMs: number): Promise<Hit<T> | null> {
  const cache = await open(store);
  if (!cache) return null;
  try {
    const r = await cache.match(key);
    if (!r) return null;
    const at = Number(r.headers.get(STORED_AT) ?? 0);
    return { value: await as(r), fresh: Date.now() - at < ttlMs };
  } catch {
    return null;
  }
}

/** Store a body (or null for "nothing here") under a key. */
export async function write(store: Store, key: string, body: BodyInit | null, type = 'application/octet-stream'): Promise<void> {
  const cache = await open(store);
  if (!cache) return;
  try {
    await cache.put(key, new Response(body, { headers: { [STORED_AT]: String(Date.now()), 'content-type': type, 'x-empty': body === null ? '1' : '0' } }));
    const n = (writes.get(store.name) ?? 0) + 1;
    writes.set(store.name, n);
    if (n % PRUNE_EVERY === 0) void prune(cache, store.maxEntries);
  } catch {
    /* quota exceeded or similar: just don't cache */
  }
}

/** Body bytes, or null for an entry stored as empty. */
export const bytes = async (r: Response): Promise<ArrayBuffer | null> => (r.headers.get('x-empty') === '1' ? null : r.arrayBuffer());
export const json = <T>(r: Response): Promise<T> => r.json() as Promise<T>;

/**
 * Cache-first fetch: a fresh cached copy is used without touching the network; otherwise we
 * download, store, and on failure settle for a stale copy if we have one.
 */
export async function cached<T>(store: Store, key: string, ttlMs: number, as: (r: Response) => Promise<T>, load: () => Promise<{ body: BodyInit | null; value: T }>): Promise<T> {
  const hit = await read(store, key, as, ttlMs);
  if (hit?.fresh) return hit.value;
  try {
    const { body, value } = await load();
    void write(store, key, body);
    return value;
  } catch (err) {
    if (hit) return hit.value;
    throw err;
  }
}

const DAY = 86400000;
export const TTL = { day: DAY, month: 30 * DAY };

/** Vector tiles: z14 tiles are typically 20–300 kB, so this is up to a few hundred MB at worst. */
export const TILES: Store = { name: 'isometrictown-tiles-v1', maxEntries: 1500 };
/** Small things: the tile index and Overpass cells. */
export const META: Store = { name: 'isometrictown-meta-v1', maxEntries: 5000 };
