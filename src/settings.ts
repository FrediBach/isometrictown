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
  /** Furrowed fields, vineyards, orchards, meadows, marsh, sand, cemeteries and pitch markings. */
  ground: boolean;

  shadows: boolean;
  /** Where the light comes from, relative to the view, in degrees clockwise from straight up the sheet. */
  sunAngle: number;
  sunHeight: number;
  shadeWalls: boolean;

  pens: [string, string, string, string];
  penWidth: number;
  mono: boolean;
  speed: number;

  seed: number;
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
export const PEN_NAMES = ['Shadows', 'Greenery', 'Roofs', 'Linework'] as const;
export const PEN_ROLES = ['Shadows and water', 'Parks and trees', 'Pitched roofs', 'Buildings and streets'] as const;
export const SHADOWS = 0;
export const GREENERY = 1;
export const ROOFS = 2;
export const LINEWORK = 3;

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

  shadows: true,
  sunAngle: 55,
  sunHeight: 38,
  shadeWalls: false,

  pens: ['#2149b8', '#21894a', '#d42f3a', '#1b1e23'],
  penWidth: 0.35,
  mono: false,
  speed: 40,

  seed: 1,
};

/** Millimetres on paper per metre on the ground. */
export function mmPerMetre(s: Pick<Settings, 'scale'>): number {
  return 1000 / s.scale;
}
