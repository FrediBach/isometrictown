import type { LngLat } from './geo';
import type { StyleId } from './styles';

export type Settings = {
  center: LngLat;
  place: string;
  /** Compass direction that points up the sheet, in degrees. */
  bearing: number;
  /** Camera elevation above the ground, in degrees. */
  tilt: number;
  /** Map scale as 1:N. */
  scale: number;
  heightScale: number;

  sheet: SheetId;
  landscape: boolean;
  margin: number;
  frame: boolean;
  /** Title, graticule ticks, scale bar, north arrow and imprint in the margin. */
  marginalia: boolean;

  pitched: number;
  /** Regional building style, or 'auto' to pick one from the country. */
  style: 'auto' | StyleId;
  /** Fetch real roof shapes and building types from OpenStreetMap where they're tagged. */
  osmTags: boolean;
  windows: boolean;
  /** Chimneys, dormers and parapets. */
  details: boolean;
  roofHatch: boolean;
  rooftops: boolean;
  trees: number;
  cars: number;
  lamps: boolean;
  paths: boolean;
  rails: boolean;
  water: boolean;
  parks: boolean;
  /** Furrowed fields, vineyards, orchards, meadows, marsh, sand, rock, ice, allotments, pools, cemeteries and pitch markings. */
  ground: boolean;
  /** Road markings, zebra crossings, parking bays and runway markings. */
  markings: boolean;
  /** Overhead power lines: pylons across the country, poles along roads. Made up; the map carries none. */
  power: boolean;
  /** Made-up life: people about town, herds on the meadows, sailing and moored boats, trains and aircraft. */
  life: boolean;

  shadows: boolean;
  /** Where the light comes from, relative to the view, in degrees clockwise from straight up the sheet. */
  sunAngle: number;
  sunHeight: number;
  shadeWalls: boolean;

  pens: [string, string, string, string, string];
  /** Use the optional feature-to-pen overrides. */
  customLayerPens: boolean;
  layerPens: Partial<Record<LayerId, number>>;
  /** Paper colour for preview and SVG presentation, without a plotted fill. */
  customBackground: boolean;
  background: string;
  penWidth: number;
  mono: boolean;
  speed: number;

  seed: number;
  /** Buildings given their own seed by clicking them, by lock key (see `lockKey`). */
  seedLocks: Record<string, number>;
};

export type SheetId = 'a4' | 'a3' | 'a2' | 'letter' | 'tabloid' | 'square' | 'axidraw';

/** Landscape dimensions in millimetres. */
export const SHEETS: Record<SheetId, { label: string; size: [number, number] }> = {
  a4: { label: 'A4', size: [297, 210] },
  a3: { label: 'A3', size: [420, 297] },
  a2: { label: 'A2', size: [594, 420] },
  letter: { label: 'US Letter', size: [279.4, 215.9] },
  tabloid: { label: 'Tabloid', size: [431.8, 279.4] },
  square: { label: 'Square 30 cm', size: [300, 300] },
  axidraw: { label: 'AxiDraw V3 area', size: [300, 218] },
};

export function sheetSize(s: Pick<Settings, 'sheet' | 'landscape'>): [number, number] {
  const [w, h] = SHEETS[s.sheet].size;
  return s.landscape ? [w, h] : [h, w];
}

/** Short names for the pens, by what each one draws. */
export const PEN_NAMES = ['Shadows', 'Water', 'Greenery', 'Roofs', 'Linework'] as const;
export const PEN_ROLES = ['Cast shadows', 'Rivers, lakes and sea', 'Parks and trees', 'Pitched roofs', 'Buildings and streets'] as const;
export const SHADOWS = 0;
export const WATER = 1;
export const GREENERY = 2;
export const ROOFS = 3;
export const LINEWORK = 4;
export const PEN_COUNT = PEN_NAMES.length;

export const DEFAULT_SETTINGS: Settings = {
  center: [4.8862, 52.3727],
  place: 'Amsterdam',
  bearing: 35,
  tilt: 32,
  scale: 1000,
  heightScale: 1,

  sheet: 'a3',
  landscape: true,
  margin: 20,
  frame: true,
  marginalia: true,

  pitched: 0.7,
  style: 'auto',
  osmTags: true,
  windows: true,
  details: true,
  roofHatch: true,
  rooftops: true,
  trees: 0.7,
  cars: 0.35,
  lamps: true,
  paths: true,
  rails: true,
  water: true,
  parks: true,
  ground: true,
  markings: true,
  power: true,
  life: true,

  shadows: true,
  sunAngle: 55,
  sunHeight: 38,
  shadeWalls: false,

  pens: ['#a6b9dd', '#2149b8', '#21894a', '#d42f3a', '#1b1e23'],
  customLayerPens: false,
  layerPens: {},
  customBackground: false,
  background: '#f2f1eb',
  penWidth: 0.35,
  mono: false,
  speed: 40,

  seed: 1,
  seedLocks: {},
};

/** The key a building's seed lock is stored under: its terrace's or its own position key. */
export function lockKey(k: readonly [number, number]): string {
  return `${k[0]},${k[1]}`;
}

/** The seed a building is made with: its locked seed, or the drawing's. */
export function seedFor(set: Settings, k: readonly [number, number] | undefined): number {
  return (k && set.seedLocks[lockKey(k)]) || set.seed;
}

/** Millimetres on paper per metre on the ground. */
export function mmPerMetre(s: Pick<Settings, 'scale'>): number {
  return 1000 / s.scale;
}

/** Drawable features that can override their usual mix of pens. */
export const LAYERS = {
  buildings: 'Buildings', roofs: 'Roofs', windows: 'Windows', roofHatch: 'Roof hatching',
  rooftops: 'Rooftop boxes', details: 'Roof details', trees: 'Trees', cars: 'Traffic',
  streets: 'Streets and infrastructure', lamps: 'Street lamps', paths: 'Footpaths',
  rails: 'Railways and lifts', water: 'Water', parks: 'Parks', ground: 'Fields and gardens',
  markings: 'Road markings', power: 'Power lines', life: 'People, animals, boats, trains and aircraft',
  shadows: 'Shadows', shadeWalls: 'Wall shading', margin: 'Frame and map notes',
} as const;
export type LayerId = keyof typeof LAYERS;

/** Resolve an optional feature override, preserving its original pen by default. */
export function layerPen(set: Settings, layer: LayerId, pen: number): number {
  return set.customLayerPens ? (set.layerPens[layer] ?? pen) : pen;
}
