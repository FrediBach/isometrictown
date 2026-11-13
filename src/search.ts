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

const cache = new Map<string, Place[]>();
let lastRequest = 0;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const key = query.trim().toLowerCase();
  if (!key) return [];
  const cached = cache.get(key);
  if (cached) return cached;

  const gap = Date.now() - lastRequest;
  if (gap < MIN_GAP_MS) await wait(MIN_GAP_MS - gap);
  lastRequest = Date.now();

  const params = new URLSearchParams({ q: query.trim(), format: 'jsonv2', limit: '5' });
  const response = await fetch(`${ENDPOINT}?${params}`, { headers: { 'Accept-Language': navigator.language } });
  if (!response.ok) throw new Error(`Search failed (${response.status})`);

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
  cache.set(key, places);
  return places;
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
const suggestCache = new Map<string, Place[]>();

export async function suggestPlaces(query: string, signal: AbortSignal): Promise<Place[]> {
  const key = query.trim().toLowerCase();
  if (key.length < 3) return [];
  const cached = suggestCache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({ q: query.trim(), limit: '8' });
  const language = navigator.language.slice(0, 2);
  if (PHOTON_LANGUAGES.includes(language)) params.set('lang', language);
  const response = await fetch(`${PHOTON}?${params}`, { signal });
  if (!response.ok) throw new Error(`Suggestions failed (${response.status})`);

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
  const top = places.slice(0, 5);
  suggestCache.set(key, top);
  return top;
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
