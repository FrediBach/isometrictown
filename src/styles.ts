import type { LngLat } from './geo';

/** Roof shapes a house can get. Special buildings (churches, halls) pick their own. */
export type HouseRoof = 'gabled' | 'hipped' | 'halfHipped' | 'mansard' | 'flat';
/** How a roof ridge lines up: along the street, gable end to the street, or along the long side. */
export type RidgeRule = 'street' | 'gableToStreet' | 'long';
/** Roof for big blocks that are too large or too irregular for a pitched house roof. */
export type BlockRoof = 'flat' | 'mansard' | 'skirt';

export type StyleId = 'alpine' | 'dutch' | 'central' | 'nordic' | 'british' | 'french' | 'mediterranean' | 'eastern' | 'arid' | 'eastAsian' | 'tropical' | 'american' | 'antipodean' | 'generic';

export type Style = {
  id: StyleId;
  label: string;
  /** Weights for small and medium houses. */
  roofs: Partial<Record<HouseRoof, number>>;
  /** Roof pitch range in degrees. */
  pitch: [number, number];
  /** Eave overhang in metres. */
  overhang: number;
  ridge: RidgeRule;
  /** Share of houses that get a pitched roof at the default "pitched roofs" setting. */
  pitchedShare: number;
  /** Tallest building (m) that still gets a pitched roof. */
  pitchedMaxH: number;
  /** Largest footprint (m²) that still gets a pitched roof. */
  pitchedMaxArea: number;
  blocks: BlockRoof;
  /** Chance of chimneys, dormers, decorated street gables (stepped or neck) and parapets on flat roofs. */
  chimney: number;
  dormer: number;
  gableFront: number;
  parapet: number;
  /** Storey height in metres, for window rows. */
  floor: number;
  /** Terraced rows share one roof shape, as in British or American row houses; otherwise each house picks its own. */
  rows: boolean;
};

const base: Omit<Style, 'id' | 'label'> = {
  roofs: { gabled: 0.55, hipped: 0.45 },
  pitch: [32, 44],
  overhang: 0.35,
  ridge: 'long',
  pitchedShare: 0.7,
  pitchedMaxH: 22,
  pitchedMaxArea: 650,
  blocks: 'flat',
  chimney: 0.2,
  dormer: 0.1,
  gableFront: 0,
  parapet: 0.2,
  floor: 3.2,
  rows: true,
};

const make = (id: StyleId, label: string, o: Partial<Style>): Style => ({ ...base, ...o, id, label });

export const STYLES: Record<StyleId, Style> = {
  alpine: make('alpine', 'Alpine', { rows: false, roofs: { gabled: 0.8, halfHipped: 0.12, hipped: 0.08 }, pitch: [22, 32], overhang: 1.1, ridge: 'long', pitchedShare: 0.92, pitchedMaxH: 26, pitchedMaxArea: 1400, blocks: 'skirt', chimney: 0.3, dormer: 0.25, parapet: 0.05, floor: 2.9 }),
  dutch: make('dutch', 'Dutch and Flemish', { rows: false, roofs: { gabled: 0.85, hipped: 0.1, mansard: 0.05 }, pitch: [48, 60], overhang: 0.15, ridge: 'gableToStreet', pitchedShare: 0.85, pitchedMaxH: 24, pitchedMaxArea: 700, blocks: 'flat', chimney: 0.1, dormer: 0.25, gableFront: 0.55, parapet: 0.15 }),
  central: make('central', 'Central European', { rows: false, roofs: { gabled: 0.55, hipped: 0.2, halfHipped: 0.15, mansard: 0.1 }, pitch: [38, 50], overhang: 0.45, ridge: 'street', pitchedShare: 0.88, pitchedMaxH: 24, pitchedMaxArea: 1200, blocks: 'skirt', chimney: 0.4, dormer: 0.4, parapet: 0.1 }),
  nordic: make('nordic', 'Nordic', { roofs: { gabled: 0.8, hipped: 0.15, halfHipped: 0.05 }, pitch: [35, 45], overhang: 0.4, ridge: 'long', pitchedShare: 0.85, pitchedMaxH: 22, pitchedMaxArea: 1000, blocks: 'skirt', chimney: 0.35, dormer: 0.15, parapet: 0.1 }),
  british: make('british', 'British and Irish', { roofs: { gabled: 0.55, hipped: 0.45 }, pitch: [35, 45], overhang: 0.2, ridge: 'street', pitchedShare: 0.85, pitchedMaxH: 20, pitchedMaxArea: 700, blocks: 'flat', chimney: 0.8, dormer: 0.15, parapet: 0.3 }),
  french: make('french', 'French', { rows: false, roofs: { gabled: 0.4, hipped: 0.45, mansard: 0.15 }, pitch: [30, 45], overhang: 0.3, ridge: 'street', pitchedShare: 0.8, pitchedMaxH: 18, pitchedMaxArea: 700, blocks: 'mansard', chimney: 0.5, dormer: 0.5, parapet: 0.1 }),
  mediterranean: make('mediterranean', 'Mediterranean', { rows: false, roofs: { hipped: 0.45, gabled: 0.3, flat: 0.25 }, pitch: [17, 25], overhang: 0.3, ridge: 'street', pitchedShare: 0.75, pitchedMaxH: 24, pitchedMaxArea: 1100, blocks: 'skirt', chimney: 0.12, dormer: 0.02, parapet: 0.35 }),
  eastern: make('eastern', 'Eastern European', { roofs: { hipped: 0.5, gabled: 0.4, halfHipped: 0.1 }, pitch: [25, 35], overhang: 0.4, ridge: 'street', pitchedShare: 0.8, pitchedMaxH: 18, pitchedMaxArea: 800, blocks: 'flat', chimney: 0.25, dormer: 0.08, parapet: 0.15 }),
  arid: make('arid', 'North African and Middle Eastern', { rows: false, roofs: { flat: 1 }, pitch: [15, 20], overhang: 0, ridge: 'long', pitchedShare: 0.04, blocks: 'flat', chimney: 0, dormer: 0, parapet: 0.75 }),
  eastAsian: make('eastAsian', 'East Asian', { rows: false, roofs: { hipped: 0.45, gabled: 0.4, halfHipped: 0.15 }, pitch: [22, 32], overhang: 0.7, ridge: 'long', pitchedShare: 0.7, pitchedMaxH: 13, pitchedMaxArea: 500, blocks: 'flat', chimney: 0, dormer: 0, parapet: 0.25 }),
  tropical: make('tropical', 'Tropical', { rows: false, roofs: { flat: 0.45, hipped: 0.35, gabled: 0.2 }, pitch: [18, 28], overhang: 0.6, ridge: 'long', pitchedShare: 0.6, pitchedMaxH: 12, pitchedMaxArea: 500, blocks: 'flat', chimney: 0, dormer: 0, parapet: 0.4 }),
  american: make('american', 'North American', { roofs: { gabled: 0.5, hipped: 0.4, halfHipped: 0.05, mansard: 0.05 }, pitch: [25, 38], overhang: 0.45, ridge: 'street', pitchedShare: 0.85, pitchedMaxH: 14, pitchedMaxArea: 600, blocks: 'flat', chimney: 0.35, dormer: 0.15, parapet: 0.35 }),
  antipodean: make('antipodean', 'Australian and New Zealand', { roofs: { hipped: 0.65, gabled: 0.35 }, pitch: [20, 27], overhang: 0.55, ridge: 'street', pitchedShare: 0.85, pitchedMaxH: 12, pitchedMaxArea: 600, blocks: 'flat', chimney: 0.12, dormer: 0, parapet: 0.3 }),
  generic: make('generic', 'Generic', {}),
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];

const BY_COUNTRY: Record<string, StyleId> = {
  CH: 'alpine', AT: 'alpine', LI: 'alpine',
  NL: 'dutch', BE: 'dutch',
  DE: 'central', CZ: 'central', PL: 'central', LU: 'central', SK: 'central', SI: 'central', HU: 'central', DK: 'central',
  NO: 'nordic', SE: 'nordic', FI: 'nordic', IS: 'nordic', EE: 'nordic', LV: 'nordic', LT: 'nordic', FO: 'nordic', GL: 'nordic',
  GB: 'british', IE: 'british', IM: 'british', JE: 'british', GG: 'british',
  FR: 'french', MC: 'french',
  ES: 'mediterranean', PT: 'mediterranean', IT: 'mediterranean', GR: 'mediterranean', HR: 'mediterranean', MT: 'mediterranean', CY: 'mediterranean', SM: 'mediterranean', VA: 'mediterranean', AD: 'mediterranean', ME: 'mediterranean', AL: 'mediterranean', TR: 'mediterranean', IL: 'mediterranean',
  RU: 'eastern', UA: 'eastern', BY: 'eastern', RO: 'eastern', BG: 'eastern', RS: 'eastern', MD: 'eastern', BA: 'eastern', MK: 'eastern', XK: 'eastern', GE: 'eastern', AM: 'eastern', KZ: 'eastern',
  JP: 'eastAsian', CN: 'eastAsian', KR: 'eastAsian', KP: 'eastAsian', TW: 'eastAsian', MN: 'eastAsian', HK: 'eastAsian', MO: 'eastAsian',
  US: 'american', CA: 'american',
  AU: 'antipodean', NZ: 'antipodean',
};

/** UN M49 region codes to fall back on when a country isn't listed. */
const BY_REGION: Record<string, StyleId> = {
  '015': 'arid', // Northern Africa
  '145': 'arid', // Western Asia
  '143': 'arid', // Central Asia
  '034': 'tropical', // Southern Asia
  '035': 'tropical', // South-eastern Asia
  '202': 'tropical', // Sub-Saharan Africa
  '419': 'tropical', // Latin America and the Caribbean
  '009': 'tropical', // Oceania
  '150': 'central', // Europe
};

/** Alpine valleys outside the core Alpine countries. */
function alpineEdge(cc: string, [lng, lat]: LngLat): boolean {
  if (cc === 'DE') return lat < 47.75 && lng > 9.6 && lng < 13.1;
  if (cc === 'IT') return lat > 45.9 && lng > 6.8 && lng < 13.9;
  if (cc === 'FR') return lat > 44.9 && lat < 46.45 && lng > 5.8;
  if (cc === 'SI') return lat > 46.2;
  return false;
}

export type Region = { country: string; code: string; style: StyleId };

type CountryCoder = typeof import('@rapideditor/country-coder');
let coder: Promise<CountryCoder> | null = null;

/** Work out the country and the house style for a place, offline. */
export async function detectRegion(at: LngLat): Promise<Region> {
  coder ??= import('@rapideditor/country-coder');
  const cc = await coder;
  const features = cc.featuresContaining(at);
  const code = cc.iso1A2Code(at) ?? '';
  // The smallest named territory reads best (England, Netherlands), unless it's a technical one.
  const territory = features.find((f) => f.properties.level === 'territory' && !/contiguous|metropolitan/i.test(f.properties.nameEn));
  const name = territory?.properties.nameEn ?? ((code && cc.feature(code)?.properties.nameEn) || 'Unknown');
  let style: StyleId | undefined = alpineEdge(code, at) ? 'alpine' : BY_COUNTRY[code];
  if (code === 'FR' && at[1] < 44.2) style = 'mediterranean';
  if (!style) {
    for (const f of features) {
      const m49 = f.properties.m49;
      if (m49 && BY_REGION[m49]) {
        style = BY_REGION[m49];
        break;
      }
    }
  }
  return { country: name, code, style: style ?? 'generic' };
}
