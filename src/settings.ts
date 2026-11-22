import type { LngLat } from './geo';
import type { ImageMask } from './image-masks';
import type { ImagePin } from './image-pins';
import { PALETTES } from './palettes';
import type { StyleId } from './styles';

export type Settings = {
  /** Where the town comes from: the map at `center`, or an image the town is laid out to look like. */
  source: 'map' | 'image';
  center: LngLat;
  place: string;
  /** Content id of the stored image (see `src/app/image-store.ts`); empty for none. */
  image: string;
  /** Name of the image for the title and margin, from its file name. */
  imageName: string;
  imageCreator: string;
  imageCoordinates: boolean;
  imageLatitude: number;
  imageLongitude: number;
  /** Fill crops the image to the drawing area; Fit shows all of it, with free ground beside it. */
  imageFit: 'fill' | 'fit';
  /** Middle of the crop in Fill, as fractions of the image's width and height. */
  imageFocus: [number, number];
  /** Brightness, -1 to 1, as a shift of the tone curve. */
  imageLight: number;
  /** Contrast round the middle tone, 0.5 to 2. */
  imageContrast: number;
  /** How much colour counts against tone, 0 to 1. At 0 only lightness is matched. */
  imageColour: number;
  /** How much image tone sets building heights, from the usual town (0) to towers in its darkest areas (1). */
  imageRelief: number;
  /** Overall change in building coverage on ordinary plots, from sparse (−1) to dense (1). */
  buildingDensity: number;
  /** How much tone sets the ground occupied by buildings. */
  imageDensity: number;
  /** How much tone changes the spacing of roof, wall and ground hatching. */
  imageHatching: number;
  /** How strongly sustained image lines steer streets and paths. */
  imageContours: number;
  /** How strongly sustained image lines turn houses and shape the backs of rows. */
  imageFloorplans: number;
  /** How far zoning follows which districts border which in real towns, rather than the hand-made rules. */
  imageNeighbours: number;
  /** Prefer open land or built neighbourhoods where either could match the image. */
  imageTownBias: number;
  /** Smaller districts keep a patchwork of land uses. Larger ones merge small patches into their neighbours. */
  imageDistrictSize: number;
  /** Lower it to favour dry land. Raise it to give ponds and channels a better chance. */
  imageWater: number;
  /** Space local streets closer together or farther apart within each type of neighbourhood. */
  imageStreetSpacing: number;
  /** Winding of organic lanes across open ground, from straight to broad meanders. */
  imageRoadWinding: number;
  /** More roundabouts than real towns build, 0 to 2: 0 keeps the learnt rates, 1 makes their odds 100 times higher, 2 makes nearly every junction with room one. */
  imageRoundabouts: number;
  /** Keep transparent areas and any selected highlights free of scene ink. */
  imagePreserveSpace: boolean;
  /** Adjusted tone at which paper is reserved. One selects transparency alone. */
  imageHighlight: number;
  /** How far the image may bend the rules that keep the town ordinary, 0 to 1. */
  likeness: number;
  /** Shapes on the picture that set some of the settings differently there, in order; see `src/image-masks.ts`. */
  imageMasks: ImageMask[];
  /** Things from the catalogue placed by hand on the picture, which the town is laid out round; see `src/image-pins.ts`. */
  imagePins: ImagePin[];
  /** Street pattern in image mode; auto picks grid for the North American and Australian styles. */
  fabric: 'auto' | number;
  /** Compass direction that points up the sheet, in degrees. */
  bearing: number;
  /** Camera elevation above the ground, in degrees. */
  tilt: number;
  /** Map scale as 1:N. */
  scale: number;
  heightScale: number;
  /** How finely things are drawn: hatch and texture spacing, and how small a thing can be before it is left out. 1 is normal. */
  detail: number;
  /** Hand-drawn stroke irregularity, from precise (0) to loose (1). */
  humanize: number;

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
  /** How far the town has been left to decay, from lived in (0) to overgrown ruins (1). See docs/plans/abandonment.md. */
  abandon: number;
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
  /** Made-up life: people about town, herds on the meadows, machines in the fields, sport on pitches and raceways, boats and ships, trains and aircraft. */
  life: boolean;

  /** The place name in giant 3D block letters standing on a long street, as in a film's opening shot. */
  title: boolean;
  /** Text for the title; empty letters the place name. */
  titleText: string;
  /** Width of the word as a share of the drawing area's width. */
  titleSize: number;
  /** Stroke thickness of the letters, in grid units of a cap height of 6. */
  titleWeight: number;
  /** Thickness of the letters front to back, as a share of their cap height. */
  titleDepth: number;
  /** Gap between letters, in grid units of a cap height of 6. */
  titleTrack: number;
  /** Height the letters float above the street, as a share of their cap height. */
  titleLift: number;
  /** Which street the title stands on: 1 is the best fit, 2 the next best and so on. */
  titleStreet: number;
  /** Slides the title along its street, from -1 to 1 of half the street's length in view. */
  titleSlide: number;
  /** Turns the title away from its street, degrees clockwise. */
  titleTurn: number;
  /** Brings the letters forward along the line of sight, from 0 (true depth) to 1 (in front of everything), so buildings before them stop hiding them. */
  titleReveal: number;
  /** Stand the title square to the viewer in the middle of the sheet instead of on a street. */
  titleFront: boolean;
  /** Leave out buildings the letters would stand in. */
  titleClear: boolean;
  /** Hatch the faces of the letters that have their backs to the sun. */
  titleShade: boolean;
  /** Round stroke ends and joints instead of square ones. */
  titleRound: boolean;

  shadows: boolean;
  /** Keep the sun towards the equator and east, independent of the view. */
  autoSun: boolean;
  /** Where the light comes from, relative to the view, in degrees clockwise from straight up the sheet. */
  sunAngle: number;
  sunHeight: number;
  shadeWalls: boolean;

  pens: [string, string, string, string, string];
  /** Use the optional feature-to-pen overrides. */
  customLayerPens: boolean;
  layerPens: Partial<Record<LayerId, number>>;
  /** Use the optional per-feature Detail overrides. */
  customLayerDetail: boolean;
  /** Detail per feature, in place of the drawing's Detail; missing features follow it. */
  layerDetail: Partial<Record<LayerId, number>>;
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

/** Grid influence from 0 (organic) to 1 (grid), using the regional default in auto. */
export function gridFabric(fabric: Settings['fabric'], style: string): number {
  return fabric === 'auto' ? Number(style === 'american' || style === 'antipodean') : fabric;
}

export const DEFAULT_SETTINGS: Settings = {
  source: 'map',
  center: [9.0744, 47.0934],
  place: 'Mollis',
  image: '',
  imageName: '',
  imageCreator: '',
  imageCoordinates: false,
  imageLatitude: 0,
  imageLongitude: 0,
  imageFit: 'fill',
  imageFocus: [0.5, 0.5],
  imageLight: 0,
  imageContrast: 1,
  imageColour: 0.7,
  imageRelief: 0,
  buildingDensity: 0,
  imageDensity: 0,
  imageHatching: 0,
  imageContours: 0,
  imageFloorplans: 0,
  imageNeighbours: 0,
  imageTownBias: 0,
  imageDistrictSize: 1,
  imageWater: 0,
  imageStreetSpacing: 1,
  imageRoadWinding: 0.5,
  imageRoundabouts: 0,
  imagePreserveSpace: false,
  imageHighlight: 1,
  likeness: 0.6,
  imageMasks: [],
  imagePins: [],
  fabric: 'auto',
  bearing: 35,
  tilt: 32,
  scale: 1000,
  heightScale: 1,
  detail: 1,
  humanize: 0,

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
  abandon: 0,
  lamps: true,
  paths: true,
  rails: true,
  water: true,
  parks: true,
  ground: true,
  markings: true,
  power: true,
  life: true,

  title: false,
  titleText: '',
  titleSize: 0.6,
  titleWeight: 1.5,
  titleDepth: 0.3,
  titleTrack: 1.2,
  titleLift: 0,
  titleStreet: 1,
  titleSlide: 0,
  titleTurn: 0,
  titleReveal: 0,
  titleFront: false,
  titleClear: true,
  titleShade: true,
  titleRound: false,

  shadows: true,
  autoSun: true,
  sunAngle: 55,
  sunHeight: 38,
  shadeWalls: true,

  pens: [...PALETTES[0].pens],
  customLayerPens: false,
  layerPens: {},
  customLayerDetail: false,
  layerDetail: {},
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
  shadows: 'Shadows', shadeWalls: 'Wall shading', title: 'Cinematic title', margin: 'Frame and map notes',
} as const;
export type LayerId = keyof typeof LAYERS;

/** Features whose drawing depends on Detail, so they can be given their own. Wall shading and the margin don't. */
export const DETAIL_LAYERS: readonly LayerId[] = (Object.keys(LAYERS) as LayerId[]).filter((l) => l !== 'shadeWalls' && l !== 'margin');

/** Detail settings a feature can be given, the same range as the Detail slider. */
export const DETAIL_MIN = 0.25;
export const DETAIL_MAX = 2;

/** The Detail a feature is drawn at: its own when overrides are on and it has one, else the drawing's. */
export function layerDetail(set: Pick<Settings, 'detail'> & Partial<Pick<Settings, 'customLayerDetail' | 'layerDetail'>>, layer: LayerId | undefined): number {
  return (set.customLayerDetail && layer && set.layerDetail?.[layer]) || set.detail;
}

/** Resolve an optional feature override, preserving its original pen by default. */
export function layerPen(set: Settings, layer: LayerId, pen: number): number {
  return set.customLayerPens ? (set.layerPens[layer] ?? pen) : pen;
}

/** Compass bearing towards the sun; automatic light stays east and towards the equator. */
export function sunBearing(set: Pick<Settings, 'autoSun' | 'center' | 'bearing' | 'sunAngle'>): number {
  return set.autoSun ? (set.center[1] >= 0 ? 135 : 45) : ((set.bearing + set.sunAngle) % 360 + 360) % 360;
}
