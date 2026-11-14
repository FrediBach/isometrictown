import type { LngLat } from '../geo';
import { PALETTES } from '../palettes';
import { DEFAULT_SETTINGS, LAYERS, PEN_COUNT, SHEETS, type Settings } from '../settings';
import { STYLES } from '../styles';

const STORE = 'isometrictown:settings';

export type Preset = { name: string; center: LngLat; bearing: number; scale: number };
/**
 * Places to try. Small, low towns with a clear plan (ring walls, star forts,
 * canals, a lake shore) draw best; there is no terrain, so steep hill towns and
 * tall downtowns lose what makes them interesting. One per regional style where
 * it can be helped.
 */
export const PRESETS: Preset[] = [
  { name: 'Mollis', center: [9.0744, 47.0934], bearing: 35, scale: 1000 },
  { name: 'Bauma', center: [8.8858, 47.3653], bearing: 35, scale: 1000 },
  { name: 'Lenzburg', center: [8.1745, 47.3876], bearing: 35, scale: 1000 },
  { name: 'Wädenswil', center: [8.6738, 47.2302], bearing: 35, scale: 1000 },
  { name: 'Amsterdam', center: [4.8862, 52.3727], bearing: 35, scale: 1000 },
  { name: 'Nördlingen', center: [10.4878, 48.8518], bearing: 30, scale: 2500 },
  { name: 'Bourtange', center: [7.1918, 53.0068], bearing: 20, scale: 1800 },
  { name: 'Palmanova', center: [13.3099, 45.9054], bearing: 0, scale: 3200 },
  { name: 'Neuf-Brisach', center: [7.5278, 48.0174], bearing: 45, scale: 2400 },
  { name: 'Hallstatt', center: [13.6493, 47.5617], bearing: 300, scale: 800 },
  { name: 'Dubrovnik', center: [18.1095, 42.6405], bearing: 30, scale: 900 },
  { name: 'Venice', center: [12.3358, 45.4375], bearing: 40, scale: 1000 },
  { name: 'Rye', center: [0.7335, 50.9503], bearing: 25, scale: 900 },
  { name: 'Ærøskøbing', center: [10.4115, 54.8893], bearing: 40, scale: 900 },
  { name: 'Shirakawa-go', center: [136.906, 36.2565], bearing: 20, scale: 1500 },
  { name: 'Nantucket', center: [-70.099, 41.2838], bearing: 35, scale: 1000 },
];

export const MONO_INK = '#1b1e23';

export function loadSettings(): Settings {
  let s: Settings = { ...DEFAULT_SETTINGS, pens: [...DEFAULT_SETTINGS.pens] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (saved && typeof saved === 'object') s = { ...s, ...saved };
  } catch {
    /* storage can be unavailable */
  }
  const parts = location.hash.slice(1).split('/');
  const h = parts.slice(0, 5).map(Number);
  if (h.length >= 2 && h.every((v) => Number.isFinite(v))) {
    s.center = [h[1], h[0]];
    if (h.length >= 3) s.bearing = ((h[2] % 360) + 360) % 360;
    if (h.length >= 4 && h[3] >= 300) s.scale = h[3];
    if (h.length >= 5 && h[4] > 0) s.seed = Math.round(h[4]);
    s.place = decodeURIComponent(parts[5] ?? '') || 'Somewhere';
  }
  if (!Number.isFinite(s.detail) || s.detail <= 0) s.detail = DEFAULT_SETTINGS.detail;
  s.pens = migratePens(s.pens);
  s.layerPens = Object.fromEntries(Object.entries(s.layerPens ?? {}).filter(([key, value]) =>
    Object.hasOwn(LAYERS, key) && Number.isInteger(value) && value >= 0 && value < PEN_COUNT));
  s.customLayerPens = s.customLayerPens === true;
  s.customBackground = s.customBackground === true;
  if (typeof s.background !== 'string' || !/^#[0-9a-f]{6}$/i.test(s.background)) s.background = DEFAULT_SETTINGS.background;
  s.seedLocks = Object.fromEntries(Object.entries(s.seedLocks ?? {}).filter(([key, value]) =>
    /^-?\d+,-?\d+$/.test(key) && Number.isInteger(value) && value > 0));
  if (!SHEETS[s.sheet]) s.sheet = 'a3';
  if (s.style !== 'auto' && !STYLES[s.style]) s.style = 'auto';
  return s;
}

/**
 * Saved sets from before water had its own pen hold four colours, the first one
 * drawing both shadows and water. A set that was a preset becomes that preset;
 * any other keeps its look, with the old pen drawing both again.
 */
function migratePens(pens: unknown): Settings['pens'] {
  if (!Array.isArray(pens) || !pens.every((c) => typeof c === 'string')) return [...DEFAULT_SETTINGS.pens];
  if (pens.length === PEN_COUNT) return pens as Settings['pens'];
  if (pens.length !== 4) return [...DEFAULT_SETTINGS.pens];
  const [shared, ...rest] = pens.map((c) => c.toLowerCase());
  const same = (a: string[], b: string[]) => a.every((c, i) => c === b[i]);
  const preset = PALETTES.find(({ pens: p }) => same(rest, p.slice(2)) && (p[0] === shared || p[1] === shared));
  return preset ? [...preset.pens] : [shared, shared, ...rest] as Settings['pens'];
}

export function persist(set: Settings): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(set));
  } catch {
    /* ignore */
  }
  const [lng, lat] = set.center;
  const hash = `#${lat.toFixed(5)}/${lng.toFixed(5)}/${Math.round(set.bearing)}/${Math.round(set.scale)}/${set.seed}/${encodeURIComponent(set.place)}`;
  history.replaceState(null, '', hash);
}

// Scale slider is logarithmic between 1:400 and 1:12000.
const SCALE_MIN = 400;
const SCALE_MAX = 12000;
export const toSlider = (scale: number) => Math.round((Math.log(scale / SCALE_MIN) / Math.log(SCALE_MAX / SCALE_MIN)) * 1000);
export const fromSlider = (v: number) => {
  const raw = SCALE_MIN * (SCALE_MAX / SCALE_MIN) ** (v / 1000);
  const step = raw < 1000 ? 25 : raw < 5000 ? 50 : 250;
  return Math.round(raw / step) * step;
};

export type NumberKey = 'bearing' | 'tilt' | 'scale' | 'heightScale' | 'detail' | 'pitched' | 'trees' | 'cars' | 'sunAngle' | 'sunHeight' | 'margin' | 'penWidth' | 'speed';
export type BoolKey = 'windows' | 'roofHatch' | 'rooftops' | 'details' | 'osmTags' | 'lamps' | 'paths' | 'rails' | 'water' | 'parks' | 'ground' | 'markings' | 'power' | 'life' | 'shadows' | 'shadeWalls' | 'frame' | 'marginalia' | 'mono' | 'customLayerPens' | 'customBackground';

export const FORMAT: Record<NumberKey, (v: number) => string> = {
  bearing: (v) => `${Math.round(v)}°`,
  tilt: (v) => `${Math.round(v)}°`,
  scale: (v) => `1:${Math.round(v).toLocaleString('en')}`,
  heightScale: (v) => `${v.toFixed(2)}×`,
  detail: (v) => `${v.toFixed(2)}×`,
  pitched: (v) => v.toFixed(2),
  trees: (v) => v.toFixed(2),
  cars: (v) => v.toFixed(2),
  sunAngle: (v) => `${Math.round(v)}°`,
  sunHeight: (v) => `${Math.round(v)}°`,
  margin: (v) => `${Math.round(v)} mm`,
  penWidth: (v) => `${v.toFixed(2)} mm`,
  speed: (v) => `${Math.round(v)} mm/s`,
};

/** Keys that move the red footprint on the locator map. */
export const VIEW_KEYS = new Set<keyof Settings>(['bearing', 'tilt', 'scale', 'sheet', 'landscape', 'margin', 'marginalia']);
/** Keys that change the footprint's size, so the map refits to it. */
export const REFIT_KEYS = new Set<keyof Settings>(['scale', 'sheet', 'landscape', 'tilt', 'marginalia']);

export function minutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const metres = (mm: number) => `${(mm / 1000).toFixed(1)} m`;
export const num = (n: number) => n.toLocaleString('en');

export function slug(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'town'
  );
}
