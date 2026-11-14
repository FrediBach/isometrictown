import { EARTH, latOf, lngOf, mercX, mercY, type Frame } from './geo';
import { json, LOCAL, META, read, TTL, write } from './netcache';
import type { Tagged } from './tiles';

/**
 * Real building tags from OpenStreetMap via Overpass: roof shapes, roof orientation and
 * building types. Only a few percent of buildings carry them, so this is a bonus on top
 * of the guesses, never something a drawing waits long for.
 */

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
/** Cache cells: z15 tiles, about 1.2 km across at the equator. */
const ZOOM = 15;
const MAX_CELLS = 24;
const MAX_CACHED = 400;
const TIMEOUT_MS = 9000;
/** After a failure, leave Overpass alone for a while. */
const BACKOFF_MS = 120000;

const TYPES = 'house|detached|semidetached_house|bungalow|cabin|farm|terrace|apartments|residential|hotel|office|commercial|retail|garage|garages|shed|hut|carport|industrial|warehouse|barn|farm_auxiliary|school|university|college|hospital|public|civic|government|train_station|church|cathedral|chapel|mosque|temple|shrine|synagogue';

type Abs = { X: number; Y: number; building?: string; roof?: string; across?: boolean };

const cache = new Map<string, Abs[]>();
/** Cells with a request on the way, so quick re-renders don't ask twice. */
const pending = new Map<string, Promise<void>>();
let pausedUntil = 0;

type Element = { center?: { lat: number; lon: number }; tags?: Record<string, string> };

async function query(s: number, w: number, n: number, e: number): Promise<Element[]> {
  const bbox = `${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)}`;
  const q = `[out:json][timeout:15];(way["building"]["roof:shape"](${bbox});way["building"]["roof:orientation"](${bbox});way["building"~"^(${TYPES})$"](${bbox}););out tags center;`;
  let last: unknown;
  for (const url of ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: ctrl.signal });
      if (!r.ok) throw new Error(`Overpass ${r.status}`);
      const j = (await r.json()) as { elements?: Element[] };
      return j.elements ?? [];
    } catch (err) {
      last = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

const cellKey = (key: string) => `${LOCAL}overpass/${ZOOM}/${key}`;

function remember(key: string, v: Abs[]) {
  cache.set(key, v);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
}

/** Tagged buildings inside a local-metre box. Resolves to an empty list if Overpass can't be reached. */
export async function loadTags(frame: Frame, box: [number, number, number, number]): Promise<Tagged[]> {
  const n = 2 ** ZOOM;
  const cell = (mx: number) => Math.floor((mx / EARTH + 0.5) * n);
  const cellY = (my: number) => Math.floor((0.5 - my / EARTH) * n);
  const X0 = frame.mx0 + box[0] / frame.k;
  const X1 = frame.mx0 + box[2] / frame.k;
  const Y0 = frame.my0 + box[1] / frame.k;
  const Y1 = frame.my0 + box[3] / frame.k;
  const cx0 = cell(X0);
  const cx1 = cell(X1);
  const cy0 = cellY(Y1);
  const cy1 = cellY(Y0);
  if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_CELLS) return [];

  const unknown: [number, number][] = [];
  const waits = new Set<Promise<void>>();
  for (let x = cx0; x <= cx1; x++)
    for (let y = cy0; y <= cy1; y++) {
      const key = `${x}/${y}`;
      const job = pending.get(key);
      if (job) waits.add(job);
      else if (!cache.has(key)) unknown.push([x, y]);
    }

  // Cells we fetched in an earlier session come from the browser's cache, not Overpass.
  const missing: [number, number][] = [];
  const stale = new Map<string, Abs[]>();
  await Promise.all(
    unknown.map(async ([x, y]) => {
      const key = `${x}/${y}`;
      const hit = await read(META, cellKey(key), json<Abs[]>, TTL.month);
      if (hit?.fresh) remember(key, hit.value);
      else {
        if (hit) stale.set(key, hit.value);
        missing.push([x, y]);
      }
    }),
  );

  if (missing.length && Date.now() > pausedUntil) waits.add(fetchCells(missing, n, cell, cellY));
  await Promise.all(waits);
  // Overpass couldn't be reached: an old answer beats none.
  for (const [k, v] of stale) if (!cache.has(k)) remember(k, v);

  const out: Tagged[] = [];
  for (let x = cx0; x <= cx1; x++)
    for (let y = cy0; y <= cy1; y++) {
      for (const t of cache.get(`${x}/${y}`) ?? []) {
        const lx = frame.x(t.X);
        const ly = frame.y(t.Y);
        if (lx < box[0] || lx > box[2] || ly < box[1] || ly > box[3]) continue;
        out.push({ x: lx, y: ly, building: t.building, roof: t.roof, across: t.across });
      }
    }
  return out;
}

/** Fetch a set of missing cells in one request and file the results by cell. */
function fetchCells(missing: [number, number][], n: number, cell: (mx: number) => number, cellY: (my: number) => number): Promise<void> {
  const job = (async () => {
    const mx0 = Math.min(...missing.map((c) => c[0]));
    const mx1 = Math.max(...missing.map((c) => c[0]));
    const my0 = Math.min(...missing.map((c) => c[1]));
    const my1 = Math.max(...missing.map((c) => c[1]));
    const toX = (cx: number) => (cx / n - 0.5) * EARTH;
    const toY = (cy: number) => (0.5 - cy / n) * EARTH;
    try {
      const els = await query(latOf(toY(my1 + 1)), lngOf(toX(mx0)), latOf(toY(my0)), lngOf(toX(mx1 + 1)));
      const fresh = new Map<string, Abs[]>();
      for (const [x, y] of missing) fresh.set(`${x}/${y}`, []);
      for (const el of els) {
        if (!el.center || !el.tags) continue;
        const X = mercX(el.center.lon);
        const Y = mercY(el.center.lat);
        const list = fresh.get(`${cell(X)}/${cellY(Y)}`);
        if (!list) continue;
        const t = el.tags;
        list.push({
          X,
          Y,
          building: t.building !== 'yes' ? t.building : undefined,
          roof: t['roof:shape'],
          across: t['roof:orientation'] === 'across' || undefined,
        });
      }
      for (const [k, v] of fresh) {
        remember(k, v);
        void write(META, cellKey(k), JSON.stringify(v), 'application/json');
      }
    } catch {
      pausedUntil = Date.now() + BACKOFF_MS;
    }
  })().finally(() => {
    for (const [x, y] of missing) pending.delete(`${x}/${y}`);
  });
  for (const [x, y] of missing) pending.set(`${x}/${y}`, job);
  return job;
}
