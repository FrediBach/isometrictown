import { json, LOCAL, read, SEARCH, TTL, write } from './netcache';
import { Cooldown, queue, timed } from './lib/network';

export type Place = {
  name: string;
  label: string;
  center: [number, number];
  bounds: [[number, number], [number, number]];
  country?: string;
};

type NominatimResult = {
  name: string;
  display_name: string;
  addresstype?: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string];
};

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MIN_GAP_MS = 1000;

const cache = new Map<string, { places: Place[]; at: number }>();
const pending = new Map<string, Promise<Place[]>>();
const providers = new Map<string, { cooldown: Cooldown; run: ReturnType<typeof queue>; last: number }>();

async function remotePlaces(url: string, language: string, decode: (response: Response) => Promise<Place[]>, signal?: AbortSignal): Promise<Place[]> {
  const origin = new URL(url).origin;
  let provider = providers.get(origin);
  if (!provider) {
    provider = { cooldown: new Cooldown(origin), run: queue(1), last: 0 };
    providers.set(origin, provider);
  }
  const key = `${LOCAL}search/${encodeURIComponent(language)}/${encodeURIComponent(url)}`;
  const fetchPlaces = async () => {
    signal?.throwIfAborted();
    const memory = cache.get(key);
    if (memory && Date.now() - memory.at < TTL.day) return memory.places;
    const hit = await read(SEARCH, key, json<Place[]>, TTL.day);
    signal?.throwIfAborted();
    if (hit?.fresh) return hit.value;
    try {
      return await provider.run(async () => {
        signal?.throwIfAborted();
        if (!(await provider.cooldown.ready())) throw new Error('Search is cooling down');
        const gap = MIN_GAP_MS - (Date.now() - provider.last);
        if (gap > 0) await new Promise<void>((resolve) => setTimeout(resolve, gap));
        signal?.throwIfAborted();
        provider.last = Date.now();
        let response: Response | undefined;
        try {
          const places = await timed(9000, async (requestSignal) => {
            response = await fetch(url, { signal: requestSignal, headers: { 'Accept-Language': language } });
            if (!response.ok) throw new Error(`Search failed (${response.status})`);
            return decode(response);
          }, signal);
          signal?.throwIfAborted();
          await provider.cooldown.success();
          cache.delete(key);
          cache.set(key, { places, at: Date.now() });
          while (cache.size > 100) cache.delete(cache.keys().next().value!);
          await write(SEARCH, key, JSON.stringify(places), 'application/json');
          return places;
        } catch (err) {
          // Typing a new query cancels the old one without penalising the provider.
          if (!signal?.aborted) await provider.cooldown.failure(response);
          throw err;
        }
      });
    } catch (err) {
      signal?.throwIfAborted();
      if (hit) return hit.value;
      if (memory) return memory.places;
      throw err;
    }
  };
  // Submitted searches share work; autocomplete keeps its caller's cancellation signal.
  if (signal) return fetchPlaces();
  const existing = pending.get(key);
  if (existing) return existing;
  const job = fetchPlaces().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

/** Search on explicit submission, caching answers by query and browser language. */
export async function searchPlaces(query: string): Promise<Place[]> {
  const key = query.trim().toLowerCase();
  if (!key) return [];
  const params = new URLSearchParams({ q: key, format: 'jsonv2', limit: '5' });
  return remotePlaces(`${ENDPOINT}?${params}`, navigator.language, async (response) => {
    const results = (await response.json()) as NominatimResult[];
    const places = results.map((r) => {
      const [south, north, west, east] = r.boundingbox.map(Number);
      return {
        name: r.name || r.display_name.split(',')[0],
        label: r.display_name,
        center: [Number(r.lon), Number(r.lat)] as [number, number],
        bounds: [
          [west, south],
          [east, north],
        ] as Place['bounds'],
        ...(r.addresstype === 'country' ? { country: r.name || r.display_name } : {}),
      };
    });
    return places;
  });
}

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    type?: string;
    osm_value?: string;
    extent?: [number, number, number, number];
  };
};

const PHOTON = 'https://photon.komoot.io/api/';
const PHOTON_LANGUAGES = ['en', 'de', 'fr'];
const SPAN = 0.004;

/** Fetch cancellable suggestions; failed providers fall back to cached answers. */
export async function suggestPlaces(query: string, signal: AbortSignal): Promise<Place[]> {
  const key = query.trim().toLowerCase();
  if (key.length < 3) return [];

  const params = new URLSearchParams({ q: key, limit: '8' });
  const language = navigator.language.slice(0, 2);
  if (PHOTON_LANGUAGES.includes(language)) params.set('lang', language);
  return remotePlaces(`${PHOTON}?${params}`, navigator.language, async (response) => {
    const { features } = (await response.json()) as { features: PhotonFeature[] };
    const seen = new Set<string>();
    const places = features.flatMap((f): Place[] => {
      const p = f.properties;
      const name = p.name ?? p.street;
      if (!name || p.type === 'country' || p.osm_value === 'country') return [];
      const parts = [name, p.city, p.state, p.country].filter((v, i, all): v is string => !!v && all.indexOf(v) === i);
      const label = parts.join(', ');
      if (seen.has(label)) return [];
      seen.add(label);
      const [lng, lat] = f.geometry.coordinates;
      const [west, north, east, south] = p.extent ?? [lng - SPAN, lat + SPAN, lng + SPAN, lat - SPAN];
      return [{ name, label, center: [lng, lat], bounds: [[west, south], [east, north]] }];
    });
    return places.slice(0, 5);
  }, signal);
}

export type City = [string, string, string, string, number, number, number];

let cityList: Promise<City[]> | null = null;

export function loadCities(): Promise<City[]> {
  cityList ??= fetch('/cities.json')
    .then((r) => (r.ok ? (r.json() as Promise<City[]>) : []))
    .catch(() => []);
  return cityList;
}

function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function cityPlace([name, , region, country, lng, lat, pop]: City): Place {
  const km = 3 + Math.sqrt(pop) / 150;
  const dLat = km / 111;
  const dLng = km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const label = [name, region, country].filter((v, i, all) => v && all.indexOf(v) === i).join(', ');
  return {
    name,
    label,
    center: [lng, lat],
    bounds: [
      [lng - dLng, lat - dLat],
      [lng + dLng, lat + dLat],
    ],
  };
}

export async function matchCities(query: string, limit = 5): Promise<Place[]> {
  const q = fold(query.trim());
  if (q.length < 2) return [];
  const cities = await loadCities();
  const starts: City[] = [];
  const words: City[] = [];
  for (const city of cities) {
    const names = [fold(city[0]), city[1] ? fold(city[1]) : ''];
    if (names.some((n) => n.startsWith(q))) starts.push(city);
    else if (names.some((n) => n.includes(` ${q}`) || n.includes(`-${q}`))) words.push(city);
    if (starts.length >= limit) break;
  }
  return [...starts, ...words].slice(0, limit).map(cityPlace);
}

export function samePlace(a: Place, b: Place): boolean {
  const near = Math.abs(a.center[0] - b.center[0]) < 1.5 && Math.abs(a.center[1] - b.center[1]) < 1.5;
  return fold(a.label) === fold(b.label) || (near && fold(a.name) === fold(b.name));
}
