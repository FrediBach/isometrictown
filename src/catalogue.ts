import type { BoolKey } from './app/model';
import { SOLAR, TANKS, TURRETS } from './buildings';
import { BALCONIES, SHUTTERS } from './classify';
import { BARS, HOME } from './facades';
import { AVENUES, BOUNDS, DRIVES, HEDGEROWS, TRAMPOLINES } from './gardens';
import { COWS, SHEEP, WILD, WILD_DEFAULT } from './ground';
import { coarsest, LOD, type RuleId } from './lod';
import { CYPRESSES, PALMS } from './nature';
import { OVERHEAD_TOWN } from './power';
import { LAYERS, layerDetail, PEN_NAMES, type LayerId, type Settings } from './settings';
import { ELECTRIC } from './streets';
import { BY_COUNTRY, BY_REGION, STYLE_IDS, STYLES, type Region, type Style, type StyleId } from './styles';

/*
 * The catalogue: everything the drawing detects in the map, works out from it, or makes up,
 * with how it is found, what switches it, the level-of-detail rules it obeys, and where its
 * strokes are filed in the tally (`Paper.tally`), so the catalogue dialog can show it in the
 * drawing on show. Keep an entry next to every new drawn thing.
 */

/** Where something comes from. */
export type Source = 'map' | 'tags' | 'inferred' | 'invented';

export const SOURCES: Record<Source, { label: string; note: string }> = {
  map: { label: 'Map', note: 'Drawn from OpenStreetMap, as the vector tiles have it.' },
  tags: { label: 'OSM tags', note: 'Read from OpenStreetMap tags fetched from Overpass, where they are mapped and arrive in time.' },
  inferred: { label: 'Inferred', note: 'Worked out from what the map does say: footprints, neighbours, points of interest, land use and the region.' },
  invented: { label: 'Made up', note: 'Not in the map. Placed by the seed and fixed to map position, so it stays put when the view pans.' },
};

export type GroupId = 'region' | 'buildings' | 'roofs' | 'walls' | 'details' | 'streets' | 'rail' | 'water' | 'land' | 'trees' | 'life' | 'air' | 'power' | 'sheet' | 'styles';

export const GROUPS: { id: GroupId; title: string }[] = [
  { id: 'region', title: 'Region' },
  { id: 'buildings', title: 'Buildings' },
  { id: 'roofs', title: 'Roofs' },
  { id: 'walls', title: 'Walls and windows' },
  { id: 'details', title: 'Roof details and landmarks' },
  { id: 'streets', title: 'Streets' },
  { id: 'rail', title: 'Railways and lifts' },
  { id: 'water', title: 'Water and boats' },
  { id: 'land', title: 'Land' },
  { id: 'trees', title: 'Trees and gardens' },
  { id: 'life', title: 'Life' },
  { id: 'air', title: 'Airfields' },
  { id: 'power', title: 'Power lines' },
  { id: 'sheet', title: 'Light and sheet' },
  { id: 'styles', title: 'Regional styles' },
];

/** Settings that switch things on: keys, or sliders that switch off at 0. */
export type Gate = BoolKey | 'trees' | 'cars';

export const GATE_LABEL: Partial<Record<Gate, string>> = {
  windows: 'Windows',
  roofHatch: 'Roof hatching',
  rooftops: 'Rooftop boxes',
  details: 'Roof details',
  osmTags: 'OSM roof tags',
  lamps: 'Street lamps',
  paths: 'Footpaths',
  rails: 'Railways and lifts',
  water: 'Water',
  parks: 'Parks',
  ground: 'Fields and gardens',
  markings: 'Road markings',
  power: 'Power lines',
  life: 'People, animals, boats, trains and aircraft',
  shadows: 'Shadows',
  shadeWalls: 'Shade walls',
  frame: 'Frame line',
  marginalia: 'Map notes',
  title: 'Cinematic title',
  trees: 'Trees',
  cars: 'Traffic',
};

export type Entry = {
  id: string;
  group: GroupId;
  name: string;
  /** Where it comes from; several when the map is used where it says and a guess fills in elsewhere. */
  source: Source[];
  /** What is drawn. */
  what: string;
  /** How it is found or worked out. */
  how: string;
  /** How it changes from region to region. */
  regions?: string;
  /** Settings that must all be on for it to be drawn. */
  needs?: Gate[];
  /** Level-of-detail rules that decide whether it shows at the scale drawn. */
  lod?: RuleId[];
  /**
   * Which tally names its strokes are filed under. `streets:bridges` takes that feature,
   * `trees` takes `trees` and all its parts, `=cars` only `cars` itself, and facets after a
   * slash must all be present: `details/chimney`. A feature of `*` takes any, so `*` then
   * `/house` takes every stroke of every house.
   */
  strokes?: string[];
  /** Census facets that count it in the drawing, summed. */
  count?: string[];
  /** What the count counts. */
  unit?: 'building' | 'tree';
  /** Reference values, as label and value. */
  facts?: [string, string][];
  /** The regional style this entry describes. */
  style?: StyleId;
  /** What it comes to in the drawing on show, where that isn't a count. */
  now?: (c: { set: Settings; region?: Region }) => string | undefined;
};

const styleName = (id: string) => STYLES[id as StyleId]?.label ?? id;
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Styles in a set, by name. */
const listed = (ids: Iterable<string>) => [...ids].map(styleName).join(', ');
/** Styles by a chance, highest first, leaving out the ones that never have it. */
const ranked = (table: Partial<Record<string, number>>, pick: (v: number) => number = (v) => v) =>
  Object.entries(table)
    .filter(([, v]) => v !== undefined && pick(v) > 0)
    .sort((a, b) => pick(b[1]!) - pick(a[1]!))
    .map(([id, v]) => `${styleName(id)} ${pct(pick(v!))}`)
    .join(', ');
/** Styles whose home window mix includes a pattern, highest share first. */
const homes = (pattern: string) => {
  const rows = STYLE_IDS.map((id) => {
    const w = HOME[id] as Record<string, number>;
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    return [id, (w[pattern] ?? 0) / total] as const;
  }).filter(([, v]) => v > 0);
  rows.sort((a, b) => b[1] - a[1]);
  return rows.map(([id, v]) => `${styleName(id)} ${pct(v)}`).join(', ');
};

const KINDS_HOW = 'The OSM building tag decides where Overpass has it. Otherwise a point of interest inside the footprint, the land use under it, then its size, height, neighbours and house numbers.';
const ALL_KINDS = ['house', 'terrace', 'apartment', 'shed', 'industrial', 'civic', 'worship', 'tall'];

const windowsEntry = (pattern: string, name: string, what: string, how: string, regions?: string): Entry => ({
  id: `windows-${pattern}`,
  group: 'walls',
  name,
  source: ['inferred'],
  what,
  how,
  regions,
  needs: ['windows'],
  lod: ['window'],
  strokes: [`windows/${pattern}-windows`],
  count: [`${pattern}-windows`],
});

const roofEntry = (roof: string, name: string, what: string, how: string, regions?: string, lod: RuleId[] = []): Entry => ({
  id: `roof-${roof}`,
  group: 'roofs',
  name,
  source: ['tags', 'inferred'],
  what,
  how,
  regions,
  lod,
  strokes: [`*/${roof}-roof`],
  count: [`${roof}-roof`],
});

const ENTRIES_BY_HAND: Entry[] = [
  // Region
  {
    id: 'region-style',
    group: 'region',
    name: 'Building style',
    source: ['inferred'],
    what: 'One of fourteen regional styles sets the roof mix and pitches, overhangs, which way ridges run, how many storeys a house has, chimneys, dormers and window habits, and much of what stands round the houses.',
    how: 'The country is looked up offline from the centre of the view. Listed countries map to a style; the rest fall back on their UN region. Alpine valleys in Germany, Italy, France and Slovenia count as Alpine, and France south of 44.2°N as Mediterranean. The Town section can override it.',
    now: ({ set, region }) => {
      if (set.style !== 'auto') return `${STYLES[set.style].label}, chosen in the Town section`;
      return region && `${STYLES[region.style].label}, for ${region.country}`;
    },
  },
  {
    id: 'drive-side',
    group: 'region',
    name: 'Side of the road',
    source: ['inferred'],
    what: 'Traffic keeps to the left or the right, and so do queues at lights and the traffic lights themselves.',
    how: 'From the country’s driving side, looked up offline.',
    needs: ['cars'],
    now: ({ region }) => region && `Keeps to the ${region.left ? 'left' : 'right'} in ${region.country}`,
  },
  {
    id: 'sunny-side',
    group: 'region',
    name: 'Sunny side',
    source: ['inferred'],
    what: 'Walls facing the equator get more and wider windows, the shady side fewer. Houses put one wide window on the sunny side of the ground floor.',
    how: 'From the latitude: nothing in the tropics, growing to full strength from 12° to 37° north or south.',
    needs: ['windows'],
    now: ({ set }) => {
      const lat = set.center[1];
      const k = Math.max(0, Math.min(1, (Math.abs(lat) - 12) / 25));
      return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}: ${k >= 1 ? 'full strength' : k <= 0 ? 'none' : `${pct(k)} strength`}, windows favour the ${lat >= 0 ? 'south' : 'north'}`;
    },
  },

  // Buildings
  {
    id: 'footprints',
    group: 'buildings',
    name: 'Footprints',
    source: ['map'],
    what: 'Every building’s outline and courtyards, as walls rising from the ground. Parts that start above the ground are drawn floating where they are mapped.',
    how: 'From the building layer of the vector tiles. Buildings cut at tile edges are joined up again. Small huts and houses drop out one by one as the scale coarsens; terraces, civic buildings, places of worship, towers, castles and town halls always stay.',
    lod: ['building', 'crease'],
    strokes: ['buildings', 'roofs'],
    count: ALL_KINDS,
    unit: 'building',
  },
  {
    id: 'mapped-height',
    group: 'buildings',
    name: 'Mapped heights',
    source: ['map'],
    what: 'Buildings stand as tall as the map says, times the Building height setting.',
    how: 'From height or building:levels in OpenStreetMap, as the vector tiles carry them.',
    strokes: ['*/mapped-height'],
    count: ['mapped-height'],
    unit: 'building',
  },
  {
    id: 'guessed-height',
    group: 'buildings',
    name: 'Guessed storeys',
    source: ['inferred'],
    what: 'Buildings the map gives no height get a number of storeys, and their roof goes on top.',
    how: 'Untagged buildings come with a 5 m default, which marks them. Houses take the style’s storey range; rows and blocks gain storeys the more densely built the ground within 45 m is, so town centres stand taller than suburbs, and blocks grow with their footprint. Sheds, halls and places of worship get a height from their size instead.',
    strokes: ['*/guessed-height'],
    count: ['guessed-height'],
    unit: 'building',
  },
  {
    id: 'party-walls',
    group: 'buildings',
    name: 'Party walls',
    source: ['inferred'],
    what: 'Where two buildings stand back to back, only the part of the wall above the lower neighbour is drawn, and pitched roofs end in fire walls or share chimney stacks on the line.',
    how: 'An edge that runs back to back with a neighbour’s edge, within 0.9 m, for at least 60% of its length. Buildings joined this way form a row that shares one seed.',
    strokes: ['*/party-walls'],
    count: ['party-walls'],
    unit: 'building',
  },
  {
    id: 'kind-house',
    group: 'buildings',
    name: 'Houses',
    source: ['tags', 'inferred'],
    what: 'Small homes with a roof from the style’s mix, chimneys and dormers, a front door to the street and a wide window on the sunny side.',
    how: `${KINDS_HOW} Tagged house, detached, semi-detached, bungalow, cabin or farm; otherwise anything left over that shares no walls and is within the style’s limits for a pitched roof.`,
    strokes: ['*/house'],
    count: ['house'],
    unit: 'building',
  },
  {
    id: 'kind-terrace',
    group: 'buildings',
    name: 'Terraced rows',
    source: ['tags', 'inferred'],
    what: 'Houses in a row behind party walls. Where rows are built as one, they share one roof shape, pitch and details; elsewhere each house picks its own.',
    how: `${KINDS_HOW} Tagged terrace, or a building with a party wall, under 500 m² and no taller than the style’s pitched roofs go.`,
    regions: `Rows built as one: ${listed(STYLE_IDS.filter((id) => STYLES[id].rows))}.`,
    strokes: ['*/terrace'],
    count: ['terrace'],
    unit: 'building',
  },
  {
    id: 'kind-apartment',
    group: 'buildings',
    name: 'Flats and offices',
    source: ['tags', 'inferred'],
    what: 'Blocks with regular windows, often flat roofs with boxes, stair windows up the back and, where it is the habit, balconies. Offices get ribbon windows or curtain walls.',
    how: `${KINDS_HOW} Tagged apartments, residential, hotel, office, commercial or retail; otherwise bigger or taller than the style lets a house be, or holding four or more house numbers.`,
    strokes: ['*/apartment'],
    count: ['apartment'],
    unit: 'building',
  },
  {
    id: 'kind-shed',
    group: 'buildings',
    name: 'Sheds and garages',
    source: ['tags', 'inferred'],
    what: 'Low and mostly blank, with flat, mono-pitch or small gabled roofs. Garages get an up-and-over door, a row of garages one each.',
    how: `${KINDS_HOW} Tagged garage, garages, shed, hut or carport; otherwise under 30 m², low or of unknown height, with no house number and no party wall.`,
    strokes: ['*/shed'],
    count: ['shed'],
    unit: 'building',
  },
  {
    id: 'kind-industrial',
    group: 'buildings',
    name: 'Halls and works',
    source: ['tags', 'inferred'],
    what: 'Sawtooth, mono-pitch, low gabled or flat roofs; blank walls, a band of windows under the eaves or a corner of offices nearest the street, and loading doors.',
    how: `${KINDS_HOW} Tagged industrial, warehouse, barn or farm_auxiliary; on industrial, railway, garage or military land; or over 1,500 m², no taller than 15 m, with no house number and not on residential land.`,
    strokes: ['*/industrial'],
    count: ['industrial'],
    unit: 'building',
  },
  {
    id: 'kind-civic',
    group: 'buildings',
    name: 'Civic buildings',
    source: ['tags', 'inferred'],
    what: 'Schools, town halls, hospitals and stations: mostly hipped roofs, tall or ribbon windows, round-headed ones on stations, taller ground floors. They always stay at coarse scales.',
    how: `${KINDS_HOW} Tagged school, university, hospital, public, civic, government or train_station; a school, town hall, hospital, library, museum, theatre, police, fire station, post office, station or castle point inside; or on school, university, college or hospital land.`,
    strokes: ['*/civic'],
    count: ['civic'],
    unit: 'building',
  },
  {
    id: 'kind-worship',
    group: 'buildings',
    name: 'Places of worship',
    source: ['tags', 'inferred'],
    what: 'Tall, round-headed windows with glazing bars, and a roof for the faith: a church tower and spire, a dome and minaret, a tiered temple roof.',
    how: `${KINDS_HOW} Tagged church, cathedral, chapel, mosque, temple, shrine or synagogue, or a place_of_worship point inside, whose religion picks the roof. Under 30 m² it is taken for a shrine or shed.`,
    strokes: ['*/worship'],
    count: ['worship'],
    unit: 'building',
  },
  {
    id: 'kind-tall',
    group: 'buildings',
    name: 'Towers',
    source: ['map', 'inferred'],
    what: 'Flat roofs and curtain walls, ribbon windows or plain grids. They always stay at coarse scales.',
    how: 'Anything over 40 m that isn’t tagged as something else.',
    strokes: ['*/tall'],
    count: ['tall'],
    unit: 'building',
  },

  // Roofs
  {
    id: 'osm-roofs',
    group: 'roofs',
    name: 'OSM roof shapes',
    source: ['tags'],
    what: 'Where a building has a roof:shape tag it wins over the guess: gabled, hipped, half-hipped, mansard, gambrel, skillion, sawtooth, dome, onion, pyramidal. roof:orientation=across turns the ridge.',
    how: 'Fetched from Overpass per z15 cell, best effort: three mirrors, 9 s each, and the drawing waits at most 2.5 s for them once the tiles are in. Tags that arrive late are kept for the next drawing.',
    needs: ['osmTags'],
    strokes: ['*/tagged-roof'],
    count: ['tagged-roof'],
    unit: 'building',
  },
  roofEntry('gabled', 'Gabled roofs', 'Two slopes meeting at a ridge, with gable ends and overhangs. L- and T-shaped houses get cross gables.', 'Houses and rows pick from the style’s roof mix; the Pitched roofs setting scales how many get a pitched roof at all. Blocks get one less often. The footprint must be simple enough to fit rectangles to, or the building falls back on the style’s block roof or a flat one.', `Share of the house mix: ${ranked(Object.fromEntries(STYLE_IDS.map((id) => [id, STYLES[id].roofs.gabled ?? 0])))}.`),
  roofEntry('hipped', 'Hipped roofs', 'Slopes on all four sides. Civic buildings mostly get these.', 'From the style’s roof mix, like gabled roofs. Pyramidal and side-hipped tags become hipped.', `Share of the house mix: ${ranked(Object.fromEntries(STYLE_IDS.map((id) => [id, STYLES[id].roofs.hipped ?? 0])))}.`),
  roofEntry('halfHipped', 'Half-hipped roofs', 'A gable with its top clipped back into a short hip.', 'From the style’s roof mix.', `Share of the house mix: ${ranked(Object.fromEntries(STYLE_IDS.map((id) => [id, STYLES[id].roofs.halfHipped ?? 0])))}.`),
  roofEntry('mansard', 'Mansard roofs', 'A steep lower slope with dormers and a flat or low top, round the whole block.', 'From the style’s roof mix for houses, and for big blocks where the style roofs them so. Gambrel tags become mansards.', `French blocks get them; in house mixes: ${ranked(Object.fromEntries(STYLE_IDS.map((id) => [id, STYLES[id].roofs.mansard ?? 0])))}.`, ['dormer']),
  roofEntry('skirt', 'Block roofs', 'A pitched skirt round a big or irregular block, flat on top, with fire walls rising where neighbours meet.', 'Blocks too big or too tall for a house roof, where the style roofs its blocks this way.', `Styles with skirted blocks: ${listed(STYLE_IDS.filter((id) => STYLES[id].blocks === 'skirt'))}.`),
  roofEntry('flat', 'Flat roofs', 'A plain top, with a parapet line, boxes, water tanks or solar panels on it.', 'Whatever doesn’t get a pitched roof: the share the style and the Pitched roofs setting leave flat, towers, most blocks, castles (for their battlements), buildings with a helipad, and parts that start above the ground.', `Pitched share of houses at the default setting: ${ranked(Object.fromEntries(STYLE_IDS.map((id) => [id, STYLES[id].pitchedShare])))}.`),
  roofEntry('shed', 'Mono-pitch roofs', 'One low slope, 8° to 16°.', 'About a third of small halls and of sheds; skillion and lean-to tags.', 'Never in the arid style, where sheds and halls are flat.'),
  roofEntry('sawtooth', 'Sawtooth roofs', 'Rows of north-light teeth along a factory hall.', 'About 30% of halls over 800 m², and sawtooth tags.', 'Never in the arid style.'),
  roofEntry('church', 'Church towers', 'A long roof with a tower at one end: belfry openings and a spire, or an onion dome.', 'Places of worship whose religion is Christian, from the tag or the point inside.', 'Onion domes in eastern Europe and round the Alps.'),
  roofEntry('mosque', 'Domes and minarets', 'A dome on a drum, outlined by its true silhouette, and a slim minaret with a balcony and a pointed cap.', 'Places of worship whose religion is Muslim. Dome and onion tags on other buildings become hipped roofs.'),
  roofEntry('temple', 'Temple roofs', 'Tiered roofs with wide eaves.', 'Places of worship whose religion is Buddhist, Shinto or Hindu.'),
  {
    id: 'ridge',
    group: 'roofs',
    name: 'Ridge direction',
    source: ['inferred', 'tags'],
    what: 'Which way a pitched roof’s ridge runs.',
    how: 'Along the street, gable end to the street, or along the long side, as the style has it; between party walls in a row. roof:orientation=across from OSM turns it.',
    regions: `Gable end to the street: ${listed(STYLE_IDS.filter((id) => STYLES[id].ridge === 'gableToStreet'))}. Along the street: ${listed(STYLE_IDS.filter((id) => STYLES[id].ridge === 'street'))}.`,
    strokes: ['*/ridge-across'],
    count: ['ridge-across'],
    unit: 'building',
  },
  {
    id: 'roof-hatch',
    group: 'roofs',
    name: 'Roof hatching',
    source: ['inferred'],
    what: 'Pitched slopes are hatched in the roof pen, down the slope, with a pen-sized clearance at each end so the outlines stay distinct.',
    how: 'Every pitched slope long enough on paper.',
    needs: ['roofHatch'],
    lod: ['roofHatch'],
    strokes: ['roofHatch'],
  },

  // Walls and windows
  windowsEntry('grid', 'Window grid', 'Rows of windows, one row per storey, evenly spaced.', 'The commonest pattern for homes, civic buildings and offices.', `Share of homes: ${homes('grid')}.`),
  windowsEntry('paired', 'Paired windows', 'Windows set in twos.', 'Homes, from the regional mix.', `Share of homes: ${homes('paired')}.`),
  windowsEntry('tall', 'Tall windows', 'French windows, taller than wide. Stations and some civic buildings have them round-headed.', 'Homes from the regional mix, 30% of hotels, many civic buildings and every station.', `Share of homes: ${homes('tall')}.`),
  windowsEntry('small', 'Small windows', 'Small, deep-set windows in thick walls.', 'Homes, from the regional mix.', `Share of homes: ${homes('small')}.`),
  windowsEntry('irregular', 'Piecemeal windows', 'Windows of a few sizes, not quite in line, as on houses added to over time.', 'Detached houses only, from the regional mix.', `Share of homes: ${homes('irregular')}.`),
  windowsEntry('ribbon', 'Ribbon windows', 'Continuous bands of glass along each floor, with mullions.', 'Offices, 30% of tall flat-roofed blocks, some civic buildings and towers.', `Also on East Asian homes: ${homes('ribbon')}.`),
  windowsEntry('curtain', 'Curtain walls', 'Whole walls of glass, divided by mullions and floors.', 'Most towers, and offices 20 m or taller.'),
  windowsEntry('blank', 'Blank walls', 'No windows at all.', 'Many halls and barns, most sheds and every garage.'),
  windowsEntry('clerestory', 'Clerestory bands', 'A band of windows high up under the eaves.', 'About 30% of halls.'),
  windowsEntry('officeEnd', 'Office corner', 'A cluster of office windows in one corner of a hall, the one nearest the street.', 'About 25% of halls.'),
  windowsEntry('sparse', 'Few windows', 'A few small windows far apart.', 'Some halls, barns and sheds.'),
  {
    id: 'glazing-bars',
    group: 'walls',
    name: 'Glazing bars',
    source: ['inferred'],
    what: 'Windows divided into panes.',
    how: 'Half of homes and civic buildings, except ribbon windows and curtain walls, where it is the local habit; drawn only when the panes are big enough on paper.',
    regions: `Where windows have glazing bars: ${listed(BARS)}.`,
    needs: ['windows'],
    lod: ['glazingBars'],
    strokes: ['windows/glazing-bars'],
    count: ['glazing-bars'],
    unit: 'building',
  },
  {
    id: 'doors',
    group: 'walls',
    name: 'Doors',
    source: ['inferred'],
    what: 'A front door with a little hood over it on the wall facing the street; garage doors on garages; loading doors on halls.',
    how: 'The street side is the wall facing the nearest street. 70% of halls get loading doors on it.',
    needs: ['windows'],
    lod: ['window'],
    strokes: ['windows'],
  },
  {
    id: 'shop-fronts',
    group: 'walls',
    name: 'Shop fronts',
    source: ['map', 'inferred'],
    what: 'Wide ground-floor windows, with striped awnings over most of them; the upper floors’ windows start above.',
    how: 'On terraces, flats and civic buildings that front a street, within 7 m: where the map has a shop, café, bank or similar inside, or, for 55% of them, along a primary, secondary, tertiary or pedestrian street in a solidly built centre or on retail or commercial land.',
    needs: ['windows'],
    lod: ['shopfront', 'awning'],
    strokes: ['*/shopfront'],
    count: ['shop-front'],
    unit: 'building',
  },
  {
    id: 'shutters',
    group: 'walls',
    name: 'Shutters',
    source: ['inferred'],
    what: 'Window shutters drawn in a pen colour, some of them closed.',
    how: 'On houses and terraces where it is the local habit, and on flats in Mediterranean and French towns.',
    regions: `Share of homes with shutters, and their pen: ${Object.entries(SHUTTERS)
      .sort((a, b) => b[1]![0] - a[1]![0])
      .map(([k, v]) => `${styleName(k)} ${pct(v![0])} (${PEN_NAMES[v![1]].toLowerCase()})`)
      .join(', ')}.`,
    needs: ['windows'],
    strokes: ['windows/shutters'],
    count: ['shutters'],
    unit: 'building',
  },
  {
    id: 'balconies',
    group: 'walls',
    name: 'Balconies',
    source: ['inferred'],
    what: 'Deep balconies on alternate bays of the upper floors, or in France shallow railed ones at every window.',
    how: 'On flats at least 8 m tall where it is the habit, and on French and Mediterranean terraces.',
    regions: `Share of flats with balconies: ${ranked(Object.fromEntries(Object.entries(BALCONIES).map(([k, v]) => [k, v![0]])))}.`,
    needs: ['windows'],
    strokes: ['windows/deep-balconies', 'windows/railed-balconies'],
    count: ['deep-balconies', 'railed-balconies'],
    unit: 'building',
  },
  {
    id: 'shade-walls',
    group: 'walls',
    name: 'Shaded walls',
    source: ['inferred'],
    what: 'Walls turned from the sun are hatched with upright strokes in the shadow pen.',
    how: 'From the sun direction setting, wall by wall.',
    needs: ['shadeWalls'],
    strokes: ['shadeWalls'],
  },

  // Roof details and landmarks
  {
    id: 'chimneys',
    group: 'details',
    name: 'Chimneys',
    source: ['invented'],
    what: 'Chimney stacks on the roof; rows share stacks on their party walls.',
    how: 'A share of homes, which the style sets, have one; it shows on pitched roofs. A whole row decides together.',
    regions: `Share of homes: ${ranked(Object.fromEntries(STYLE_IDS.map((id) => [id, STYLES[id].chimney])))}.`,
    needs: ['details'],
    lod: ['chimney'],
    strokes: ['details/chimney'],
    count: ['chimneys'],
    unit: 'building',
  },
  {
    id: 'dormers',
    group: 'details',
    name: 'Dormers',
    source: ['invented'],
    what: 'Little gabled windows standing out of the roof slope.',
    how: 'On a share of homes and civic buildings with pitched or mansard roofs, which the style sets.',
    regions: `Share of homes: ${ranked(Object.fromEntries(STYLE_IDS.map((id) => [id, STYLES[id].dormer])))}.`,
    needs: ['details'],
    lod: ['dormer'],
    strokes: ['details/dormer'],
    count: ['dormers'],
    unit: 'building',
  },
  {
    id: 'street-gables',
    group: 'details',
    name: 'Stepped and neck gables',
    source: ['invented'],
    what: 'Decorated gables rising above the roof on the end facing the street: stepped, or a tall neck.',
    how: 'Homes with gabled roofs whose gable end faces the street, where the style has the habit.',
    regions: `Share of gabled homes: ${ranked(Object.fromEntries(STYLE_IDS.map((id) => [id, STYLES[id].gableFront])))}.`,
    needs: ['details'],
    lod: ['gable'],
    strokes: ['*/stepped-gable', '*/neck-gable'],
    count: ['stepped-gable', 'neck-gable'],
    unit: 'building',
  },
  {
    id: 'parapets',
    group: 'details',
    name: 'Parapets',
    source: ['invented'],
    what: 'A second outline just inside the edge of a flat roof.',
    how: 'On a share of flat roofs, which the style sets.',
    regions: `Share of flat roofs: ${ranked(Object.fromEntries(STYLE_IDS.map((id) => [id, STYLES[id].parapet])))}.`,
    needs: ['details'],
    lod: ['parapet'],
    strokes: ['details/parapet'],
    count: ['has-parapet'],
    unit: 'building',
  },
  {
    id: 'rooftops',
    group: 'details',
    name: 'Rooftop boxes',
    source: ['invented'],
    what: 'Stair housings and plant rooms on flat roofs, round water tanks (on legs in North America) or rows of solar panels.',
    how: 'One to three boxes on most flat roofs, where they fit inside the footprint. Instead, 40% of flat roofs get tanks where that’s the habit, or 35% of those over 150 m² get solar panels.',
    regions: `Tanks: ${listed(TANKS)}. Solar panels: ${listed(SOLAR)}.`,
    needs: ['rooftops'],
    lod: ['rooftop', 'solar'],
    strokes: ['rooftops'],
  },
  {
    id: 'castles',
    group: 'details',
    name: 'Battlements and turrets',
    source: ['map', 'inferred'],
    what: 'Battlements along the outer walls and, in much of Europe, pointed turrets at the corners. Too small to read, the battlements become a parapet.',
    how: 'Buildings over 150 m² with a castle point inside get a flat roof for them.',
    regions: `Turrets: ${listed(TURRETS)}.`,
    needs: ['details'],
    lod: ['battlements'],
    strokes: ['*/castle'],
    count: ['castle'],
    unit: 'building',
  },
  {
    id: 'hospital-helipads',
    group: 'details',
    name: 'Hospital helipads',
    source: ['map', 'inferred'],
    what: 'A circle and an H on the roof of the main hospital building, sometimes with the air ambulance in.',
    how: 'A hospital point inside (not a clinic), or half of the buildings over 4,000 m² on hospital land. A helipad mapped on any building puts it on that building’s flat roof.',
    needs: ['details'],
    lod: ['helipad'],
    strokes: ['details/helipad'],
    count: ['hospital'],
    unit: 'building',
  },
  {
    id: 'town-hall-flags',
    group: 'details',
    name: 'Town hall flags',
    source: ['map'],
    what: 'A flagpole on the roof with the flag out.',
    how: 'Buildings with a town hall point inside.',
    needs: ['details'],
    lod: ['flag'],
    strokes: ['details/flag'],
    count: ['town-hall'],
    unit: 'building',
  },
  {
    id: 'stacks',
    group: 'details',
    name: 'Factory chimneys',
    source: ['invented'],
    what: 'A tall chimney stack with bands near the top, beside the hall.',
    how: 'About one in five halls over 1,500 m², at one end.',
    needs: ['details'],
    lod: ['stack'],
    strokes: ['streets:chimneys'],
  },

  // Streets
  {
    id: 'roads',
    group: 'streets',
    name: 'Roads and kerbs',
    source: ['map'],
    what: 'Kerb lines along both sides of every road, joined round junctions. Roads too narrow for the pen to keep their kerbs apart are drawn a little wider.',
    how: 'Road centre lines from the map, widened by class: motorway 18 m, trunk 15, primary 13, secondary 12, tertiary 10, minor 8, service 5.',
    lod: ['road'],
    strokes: ['streets:kerbs'],
  },
  {
    id: 'plazas',
    group: 'streets',
    name: 'Squares and plazas',
    source: ['map'],
    what: 'Pedestrian areas outlined like roads.',
    how: 'Mapped pedestrian areas.',
    strokes: ['streets:plazas'],
  },
  {
    id: 'fountains',
    group: 'streets',
    name: 'Fountains and statues',
    source: ['invented'],
    what: 'A round basin with a column and falling water, or a statue on a plinth, in the middle of a square.',
    how: 'Squares between 400 and 40,000 m² wide enough to hold one: a fountain in six of ten, a statue in the rest.',
    lod: ['fountain'],
    strokes: ['streets:squares'],
  },
  {
    id: 'lamps',
    group: 'streets',
    name: 'Street lamps',
    source: ['invented'],
    what: 'Lamp posts at regular spacing on the pavement.',
    how: 'Along minor, tertiary, secondary, primary and trunk roads, off other roads and buildings.',
    needs: ['lamps'],
    lod: ['lamp'],
    strokes: ['lamps'],
  },
  {
    id: 'street-markings',
    group: 'streets',
    name: 'Road markings and lights',
    source: ['inferred'],
    what: 'Centre dashes on main roads, zebra crossings a little way in from junctions, and traffic lights on the kerb to the right of traffic heading in.',
    how: 'Motorways to tertiary roads at least 10 m wide get centre dashes. Zebras go near junctions of three or more ways, six in ten of them; busier classes get lights at their junctions.',
    needs: ['markings'],
    lod: ['centreLine', 'zebra'],
    strokes: ['=markings'],
  },
  {
    id: 'parking',
    group: 'streets',
    name: 'Parking bays',
    source: ['map', 'invented'],
    what: 'Painted bays either side of parking aisles, with cars in most of them.',
    how: 'Service roads mapped as parking aisles. How full they are follows the Traffic setting.',
    needs: ['markings'],
    lod: ['parkingBay', 'car'],
    strokes: ['markings:parking', 'cars:parking'],
  },
  {
    id: 'roundabouts',
    group: 'streets',
    name: 'Roundabouts',
    source: ['inferred'],
    what: 'A planted island in the middle, and a tree on it when there’s room.',
    how: 'Roads that close on themselves in a loop of 30 to 3,000 m².',
    strokes: ['*/roundabout-trees'],
    count: ['roundabout-trees'],
    unit: 'tree',
  },
  {
    id: 'footpaths',
    group: 'streets',
    name: 'Footpaths, tracks and steps',
    source: ['map'],
    what: 'Footpaths are dashed, farm tracks two wheel ruts, steps have treads.',
    how: 'Path, footway, cycleway, bridleway, track and steps from the map, kept off roads and water. Short stubs go first as the scale coarsens.',
    needs: ['paths'],
    lod: ['footpath', 'ruts', 'steps'],
    strokes: ['paths'],
  },
  {
    id: 'bridges',
    group: 'streets',
    name: 'Bridges',
    source: ['map', 'inferred'],
    what: 'Over water, bridges show their side: masonry arches for most, beams on piers for railways and big roads; piers stand on rows of posts. Road bridges get railings with posts.',
    how: 'Roads, railways and piers the map marks as bridges. Short ones span on arches, long ones on piers; motorways, trunk and primary roads and railways get beams.',
    lod: ['bridge'],
    strokes: ['streets:bridges', 'streets:railings'],
  },
  {
    id: 'portals',
    group: 'streets',
    name: 'Tunnel portals',
    source: ['map'],
    what: 'A portal wall with an arch where a road or railway goes underground, the mouth hatched dark.',
    how: 'The ends of road and rail tunnels in the map.',
    strokes: ['streets:portals'],
  },
  {
    id: 'motorways',
    group: 'streets',
    name: 'Crash barriers and gantries',
    source: ['invented'],
    what: 'Barriers along motorways, and now and then a gantry of signs across the carriageway.',
    how: 'Along motorways, off water; gantries at a share of spots along the way.',
    lod: ['barrier'],
    strokes: ['streets:motorways'],
  },
  {
    id: 'bus-stops',
    group: 'streets',
    name: 'Bus shelters',
    source: ['map', 'invented'],
    what: 'A back panel and a roof on posts, facing the road, with the stop sign at the kerb.',
    how: 'Three in four of the bus stops the map has.',
    lod: ['busStop'],
    strokes: ['streets:busStops'],
  },
  {
    id: 'fuel',
    group: 'streets',
    name: 'Petrol stations',
    source: ['map', 'invented'],
    what: 'A canopy on columns over two pump islands.',
    how: 'At the fuel points the map has.',
    lod: ['fuel'],
    strokes: ['streets:fuel'],
  },
  {
    id: 'traffic',
    group: 'streets',
    name: 'Traffic',
    source: ['invented'],
    what: 'Cars driving in their lanes in platoons, queues at red lights, buses in town and trucks on main roads, and cars parked at the kerb in town, in stretches. Small cars reduce to a roof outline and a windscreen stroke.',
    how: 'How busy a road is comes from its class and how built up the land within 100 m is: a country lane carries the odd car, a town street a steady stream, a motorway is busy anywhere. Drives and car park aisles carry no through traffic.',
    needs: ['cars'],
    lod: ['car', 'carCabin'],
    strokes: ['=cars'],
  },
  {
    id: 'emergency',
    group: 'streets',
    name: 'Fire engines and ambulances',
    source: ['map', 'invented'],
    what: 'A fire engine or two in front of a fire station, an ambulance outside a hospital, on open ground facing the nearest road.',
    how: 'Fire stations and, seven times in ten, hospitals the map has as points.',
    needs: ['cars'],
    lod: ['car'],
    strokes: ['cars:stations'],
  },

  // Railways and lifts
  {
    id: 'railways',
    group: 'rail',
    name: 'Railways',
    source: ['map'],
    what: 'Two rails and sleepers when there’s room, else one line. Narrow gauge sits closer.',
    how: 'Rail and transit lines from the map.',
    needs: ['rails'],
    lod: ['twinRails', 'sleepers'],
    strokes: ['=rails'],
  },
  {
    id: 'catenary',
    group: 'rail',
    name: 'Overhead wires',
    source: ['inferred'],
    what: 'Masts carrying the contact wire over main lines; trams run under a wire hung from poles.',
    how: 'Main lines in regions where most railways are electric, and every tramway.',
    regions: `Electric main lines: ${listed(ELECTRIC)}.`,
    needs: ['rails'],
    lod: ['catenary'],
    strokes: ['=rails'],
  },
  {
    id: 'platforms',
    group: 'rail',
    name: 'Station platforms',
    source: ['map', 'invented'],
    what: 'A raised slab along the track, with a canopy on columns over the middle.',
    how: 'Platforms the map has.',
    needs: ['rails'],
    lod: ['platform'],
    strokes: ['streets:platforms'],
  },
  {
    id: 'level-crossings',
    group: 'rail',
    name: 'Level crossings',
    source: ['inferred'],
    what: 'Barriers on both sides of the track and a crossbuck sign.',
    how: 'Where a road crosses a railway on the level.',
    needs: ['rails'],
    lod: ['crossing'],
    strokes: ['markings:crossings'],
  },
  {
    id: 'trains',
    group: 'rail',
    name: 'Trains',
    source: ['invented'],
    what: 'Regional units, intercity trains or freight with box, tank, container and open wagons on main lines (long double-stacked freight in North America); standing wagons in yards; trams, metros, narrow-gauge trains and funiculars with their own stock. One passenger train stands at a platform when there is one.',
    how: 'Rail pieces are joined into tracks and each kind of track gets a small budget, so only a few carry trains, spread out and keeping their distance.',
    needs: ['rails', 'life'],
    lod: ['train', 'bogies', 'trainFine', 'pantograph'],
    strokes: ['life/trains'],
  },
  {
    id: 'lifts',
    group: 'rail',
    name: 'Cable cars and ski lifts',
    source: ['map'],
    what: 'Pylons and sagging cables with cabins, chairs or bars along them, and stations where they end.',
    how: 'Aerialways from the map: cable cars, gondolas, chair lifts, drag lifts, T-bars, platters and rope tows, each with its own pylon spacing and height.',
    needs: ['rails'],
    strokes: ['rails:lifts'],
  },

  // Water and boats
  {
    id: 'waves',
    group: 'water',
    name: 'Open water',
    source: ['map'],
    what: 'Short wavy strokes over seas, lakes and rivers, left clear round ships and under bridges.',
    how: 'Water areas from the map, and rivers and canals wide enough on paper for two banks.',
    needs: ['water'],
    strokes: ['water/waves'],
  },
  {
    id: 'shores',
    group: 'water',
    name: 'Shorelines',
    source: ['map'],
    what: 'The edge of the water, in linework.',
    how: 'The outline of all the water together, broken where roads and bridges cross.',
    needs: ['water'],
    strokes: ['water/shores'],
  },
  {
    id: 'brooks',
    group: 'water',
    name: 'Streams',
    source: ['map'],
    what: 'Streams too narrow for two banks on paper are a single wavy line.',
    how: 'Waterway lines from the map, by class: river 9 m, canal 7, stream 2.5, drain 1.6, ditch 1.4.',
    needs: ['water'],
    lod: ['stream'],
    strokes: ['water/brooks'],
  },
  {
    id: 'pools',
    group: 'water',
    name: 'Swimming pools',
    source: ['map'],
    what: 'A hard edge and close, level ripples instead of waves.',
    how: 'Swimming pools from the map, kept apart from open water.',
    needs: ['water'],
    strokes: ['water/pools'],
  },
  {
    id: 'moorings',
    group: 'water',
    name: 'Moored boats',
    source: ['invented'],
    what: 'Small boats tied up along the quay.',
    how: 'Where open water meets a street or a building, and all along the water’s edge within 250 m of a harbour.',
    needs: ['water', 'life'],
    lod: ['mooredBoat'],
    strokes: ['life:moorings'],
  },
  {
    id: 'sailing',
    group: 'water',
    name: 'Sailing boats',
    source: ['invented'],
    what: 'Boats under sail, all leaning to the same wind, heading across it.',
    how: 'A few spots on open water, well clear of the shore. The wind comes from the seed.',
    needs: ['water', 'life'],
    lod: ['sailingBoat'],
    strokes: ['life:sailing'],
  },
  {
    id: 'ships',
    group: 'water',
    name: 'Ships',
    source: ['inferred', 'invented'],
    what: 'At sea container ships, tankers, bulk carriers, cruise ships, coasters, trawlers and tugs; on big lakes paddle steamers and motor boats; barges on wide rivers; tour boats on narrow rivers and canals.',
    how: 'The water’s class says which kinds belong (ocean, lake, river, canal); more tugs and trawlers near a harbour. Placed on a grid fixed to the map.',
    needs: ['water', 'life'],
    lod: ['ship'],
    strokes: ['life:ships'],
  },
  {
    id: 'wakes',
    group: 'water',
    name: 'Wakes',
    source: ['invented'],
    what: 'A calm V behind the stern, edged with broken strokes, and churned water straight behind.',
    how: 'Behind ships under way.',
    needs: ['water', 'life'],
    lod: ['wake'],
    strokes: ['life:ships'],
  },
  {
    id: 'ferries',
    group: 'water',
    name: 'Ferries',
    source: ['map', 'invented'],
    what: 'A dotted line across the water, with the ferry somewhere along it.',
    how: 'Ferry routes from the map.',
    needs: ['water'],
    strokes: ['life:ferries'],
  },
  {
    id: 'ports',
    group: 'water',
    name: 'Cranes and containers',
    source: ['inferred', 'invented'],
    what: 'Quayside cranes over the water, with stacks of containers behind them.',
    how: 'Where industrial land meets open water along at least 40 m of edge.',
    needs: ['water'],
    lod: ['port'],
    strokes: ['water:ports'],
  },

  // Land
  {
    id: 'parks',
    group: 'land',
    name: 'Parks and grass',
    source: ['map'],
    what: 'Hatched in the greenery pen, half as dense under headstones and pitch markings; outlined round the edge.',
    how: 'Parks, gardens, grass, recreation grounds, village greens, cemeteries, pitches and playgrounds from the land use and land cover.',
    needs: ['parks'],
    strokes: ['parks/grass', 'parks/park-edges'],
  },
  {
    id: 'woods',
    group: 'land',
    name: 'Woods',
    source: ['map'],
    what: 'Outlined, and filled with trees (see Park and wood trees, which follow the Trees setting rather than Parks).',
    how: 'Wood and forest land cover.',
    needs: ['parks'],
    strokes: ['parks/wood-edges'],
  },
  {
    id: 'fields',
    group: 'land',
    name: 'Fields',
    source: ['map', 'invented'],
    what: 'Furrows along the field’s length, solid when ploughed, dashed when it’s stubble.',
    how: 'Farmland from the map. Furrow spacing varies per field; three in ten are stubble.',
    needs: ['ground'],
    strokes: ['ground/fields', 'ground/farm-edges'],
  },
  {
    id: 'vineyards',
    group: 'land',
    name: 'Vineyards',
    source: ['map'],
    what: 'Trellis rows on stakes, drawn standing when the rows are far enough apart on paper, flat otherwise.',
    how: 'Vineyards from the land cover.',
    needs: ['ground'],
    lod: ['vines'],
    strokes: ['ground/vineyards'],
  },
  {
    id: 'orchards',
    group: 'land',
    name: 'Orchards',
    source: ['map'],
    what: 'Rows of little fruit trees, or rows of dots when they’d be too small.',
    how: 'Orchards from the land cover.',
    needs: ['ground'],
    lod: ['orchard'],
    strokes: ['ground/orchards', '*/orchard-trees'],
    count: ['orchard-trees'],
    unit: 'tree',
  },
  {
    id: 'meadows',
    group: 'land',
    name: 'Meadows',
    source: ['map'],
    what: 'Grass tufts scattered on a grid fixed to the map.',
    how: 'Meadow, grassland, heath and fell from the land cover.',
    needs: ['ground'],
    strokes: ['ground/meadows'],
  },
  {
    id: 'marsh',
    group: 'land',
    name: 'Marsh',
    source: ['map'],
    what: 'Short blue dashes with small tufts above them.',
    how: 'Wetland from the land cover.',
    needs: ['ground'],
    strokes: ['ground/marsh'],
  },
  {
    id: 'sand',
    group: 'land',
    name: 'Sand and beaches',
    source: ['map'],
    what: 'Stippled dots, lighter on beaches so the parasols read.',
    how: 'Sand and beach land cover.',
    needs: ['ground'],
    strokes: ['ground/sand', 'ground/beach-sand'],
  },
  {
    id: 'beaches',
    group: 'land',
    name: 'Parasols and towels',
    source: ['invented'],
    what: 'Parasols over the beach, each with a towel spread beside it.',
    how: 'Scattered over beaches from the land cover.',
    needs: ['ground'],
    lod: ['beach'],
    strokes: ['ground:beaches'],
  },
  {
    id: 'rock',
    group: 'land',
    name: 'Rock and scree',
    source: ['map'],
    what: 'Boulders and dots.',
    how: 'Bare rock from the land cover.',
    needs: ['ground'],
    strokes: ['ground/rock'],
  },
  {
    id: 'ice',
    group: 'land',
    name: 'Glaciers',
    source: ['map'],
    what: 'Crevasses in the water pen.',
    how: 'Ice from the land cover.',
    needs: ['ground'],
    strokes: ['ground/ice'],
  },
  {
    id: 'scrub',
    group: 'land',
    name: 'Scrub',
    source: ['map', 'invented'],
    what: 'Bushes scattered over the grass.',
    how: 'Scrub and shrubbery from the land cover; bushes on a grid fixed to the map.',
    needs: ['ground', 'trees'],
    strokes: ['*/scrub-bushes'],
    count: ['scrub-bushes'],
    unit: 'tree',
  },
  {
    id: 'allotments',
    group: 'land',
    name: 'Allotments',
    source: ['map', 'invented'],
    what: 'A grid of little plots, with a garden shed in some.',
    how: 'Allotments from the land cover, cut into 9 × 16 m plots.',
    needs: ['ground'],
    lod: ['garden'],
    strokes: ['ground/allotments', 'ground/allotment-sheds'],
  },
  {
    id: 'cemeteries',
    group: 'land',
    name: 'Cemeteries',
    source: ['map', 'invented'],
    what: 'Rows of headstones, and crosses, turned to whichever way reads broader on paper.',
    how: 'Cemeteries from the land use.',
    regions: 'No crosses in arid, East Asian and tropical regions.',
    needs: ['ground'],
    lod: ['cemetery'],
    strokes: ['ground/cemeteries'],
  },
  {
    id: 'pitches',
    group: 'land',
    name: 'Sports pitches',
    source: ['map', 'inferred'],
    what: 'Markings for football, tennis, basketball or a running track, with goals, nets and hoops.',
    how: 'Pitches from the land use. The sport tag picks the markings; without one the size does: at least 70 × 40 m is football, a long narrow court tennis, a 24–34 m court basketball, anything else a multi-use court.',
    needs: ['ground'],
    lod: ['pitch'],
    strokes: ['ground/pitches'],
  },
  {
    id: 'playgrounds',
    group: 'land',
    name: 'Playgrounds',
    source: ['map', 'invented'],
    what: 'A swing frame and a slide.',
    how: 'Playgrounds from the land use.',
    needs: ['ground'],
    lod: ['playground'],
    strokes: ['ground:playgrounds'],
  },
  {
    id: 'campsites',
    group: 'land',
    name: 'Campsites',
    source: ['map', 'invented'],
    what: 'Tents and caravans.',
    how: 'Within 45 m of the campsite points the map has.',
    needs: ['ground'],
    lod: ['tent'],
    strokes: ['ground:campsites'],
  },
  {
    id: 'quarries',
    group: 'land',
    name: 'Quarries',
    source: ['map'],
    what: 'Benches cut down into the ground, as nested outlines.',
    how: 'Quarries from the land use.',
    needs: ['ground'],
    strokes: ['ground:quarries'],
  },
  {
    id: 'farmyards',
    group: 'land',
    name: 'Farms',
    source: ['inferred', 'invented'],
    what: 'A silo or two at the end of a barn, and often a tractor parked by it.',
    how: 'The map rarely marks farmyards, so a farm is a building of 220 to 4,000 m² outside residential, industrial and commercial land, with fields in view and few other buildings within 70 m; four in ten get a silo.',
    needs: ['ground'],
    lod: ['farmyard'],
    strokes: ['ground:farmyards'],
  },
  {
    id: 'bales',
    group: 'land',
    name: 'Bales',
    source: ['invented'],
    what: 'Square bales lying in rows.',
    how: 'On the fields drawn as stubble.',
    needs: ['ground'],
    lod: ['bale'],
    strokes: ['ground/bales'],
  },
  {
    id: 'open-country',
    group: 'land',
    name: 'Open country',
    source: ['inferred', 'invented'],
    what: 'A light texture of tufts and dots, and a scattering of trees and bushes, in the region’s character.',
    how: 'Ground away from the town (more than 30 m from buildings and off built-up land) that the map says nothing about.',
    regions: `Trees per spot: ${ranked(Object.fromEntries(Object.entries(WILD).map(([k, v]) => [k, v.trees])))}; elsewhere ${pct(WILD_DEFAULT.trees)}. Dry dots: ${ranked(Object.fromEntries(Object.entries(WILD).map(([k, v]) => [k, v.dot])))}.`,
    needs: ['ground'],
    strokes: ['ground/open-country', '*/wild-trees'],
    count: ['wild-trees'],
    unit: 'tree',
  },
  {
    id: 'summits',
    group: 'land',
    name: 'Summit crosses',
    source: ['map'],
    what: 'A cross on the mountain top, with its height lettered beside it.',
    how: 'Peaks from the map, with their elevation where it is mapped.',
    lod: ['summit'],
    strokes: ['streets:peaks'],
  },

  // Trees and gardens
  {
    id: 'park-trees',
    group: 'trees',
    name: 'Park and wood trees',
    source: ['invented'],
    what: 'Broadleaf and conifer crowns. Trees too small to read are drawn bigger and thinned out, so a wood keeps its tone.',
    how: 'Scattered over parks and woods on a grid fixed to the map. They stay off marked pitches and thin out to a few over meadows and marsh.',
    needs: ['trees'],
    lod: ['tree', 'treeSpacing'],
    strokes: ['*/park-trees'],
    count: ['park-trees'],
    unit: 'tree',
  },
  {
    id: 'gardens',
    group: 'trees',
    name: 'Gardens',
    source: ['inferred', 'invented'],
    what: 'Lawn tufts and a few garden trees round the houses.',
    how: 'Villages and suburbs often map only “residential” round their houses. Where buildings cover less than 30% of such an area, its open ground is taken for gardens.',
    needs: ['ground'],
    strokes: ['ground/lawns', '*/garden-trees'],
    count: ['garden-trees'],
    unit: 'tree',
  },
  {
    id: 'plots',
    group: 'trees',
    name: 'Garden plots',
    source: ['inferred', 'invented'],
    what: 'Each house gets a plot fenced the local way, along the street and between neighbours. Front gardens may have a driveway with a car on it, back gardens a shed or a trampoline.',
    how: 'A plot is the ground nearer to that house than to any other, within 20 m, cut off at the street. Only in the inferred gardens.',
    regions: `Street side and between neighbours: ${STYLE_IDS.map((id) => `${STYLES[id].label} ${BOUNDS[id].join(' / ')}`).join(', ')}. Driveways: ${listed(DRIVES)}. Trampolines: ${listed(TRAMPOLINES)}.`,
    needs: ['ground'],
    lod: ['garden'],
    strokes: ['ground/plots'],
  },
  {
    id: 'street-trees',
    group: 'trees',
    name: 'Street trees',
    source: ['invented'],
    what: 'Trees along main roads, on the pavement.',
    how: 'Some primary, secondary, tertiary and minor roads are lined with trees where there’s room before the houses.',
    regions: `Chance a road is lined: ${ranked(AVENUES)}.`,
    needs: ['trees'],
    lod: ['tree'],
    strokes: ['*/street-trees'],
    count: ['street-trees'],
    unit: 'tree',
  },
  {
    id: 'hedgerows',
    group: 'trees',
    name: 'Hedgerows',
    source: ['invented'],
    what: 'Bushes along field edges, with now and then a tree grown out of the hedge.',
    how: 'Along the edges of farmland.',
    regions: `Chance a field edge has one: ${ranked(HEDGEROWS)}.`,
    needs: ['ground', 'trees'],
    lod: ['hedgerow'],
    strokes: ['*/hedgerows'],
    count: ['hedgerows'],
    unit: 'tree',
  },
  {
    id: 'palms',
    group: 'trees',
    name: 'Palms',
    source: ['inferred'],
    what: 'Palm trees in place of some broadleaf trees.',
    how: 'Planted in town only, never in the woods or out in the country. In the tropics anywhere, and in the warm south of the US and Australia.',
    regions: `Share of town trees: ${ranked(PALMS)}.`,
    needs: ['trees'],
    strokes: ['trees/palm'],
    count: ['palm'],
    unit: 'tree',
  },
  {
    id: 'cypresses',
    group: 'trees',
    name: 'Cypresses',
    source: ['inferred'],
    what: 'Tall slim cypresses in place of some conifers.',
    how: 'Any conifer may be one where it is the habit.',
    regions: `Share of conifers: ${ranked(CYPRESSES)}.`,
    needs: ['trees'],
    strokes: ['trees/cypress'],
    count: ['cypress'],
    unit: 'tree',
  },
  {
    id: 'conifers',
    group: 'trees',
    name: 'Conifers',
    source: ['invented'],
    what: 'Pointed crowns.',
    how: 'A share of the trees in woods and open country, more in the north and the mountains.',
    regions: `Share of open-country trees: ${ranked(Object.fromEntries(Object.entries(WILD).map(([k, v]) => [k, v.conifer])))}.`,
    needs: ['trees'],
    strokes: ['trees/conifer'],
    count: ['conifer'],
    unit: 'tree',
  },

  // Life
  {
    id: 'people',
    group: 'life',
    name: 'People',
    source: ['invented'],
    what: 'Figures standing about: legs, body and a round head.',
    how: 'On squares, pedestrian streets and beaches, when the scale is large enough to show them.',
    needs: ['life'],
    lod: ['person'],
    strokes: ['life:people'],
  },
  {
    id: 'livestock',
    group: 'life',
    name: 'Herds',
    source: ['invented'],
    what: 'Small herds out on the meadows.',
    how: 'On meadows, keyed to map position.',
    regions: `Cows: ${listed(COWS)}. Sheep: ${listed(SHEEP)}.`,
    needs: ['life', 'ground'],
    lod: ['livestock'],
    strokes: ['life/livestock'],
  },
  {
    id: 'farm-work',
    group: 'life',
    name: 'Work in the fields',
    source: ['invented'],
    what: 'A tractor ploughing or spreading on ploughed land; a combine with a tractor and trailer under its auger, or a baler, on stubble; a tractor mowing a meadow, the cut grass in swaths behind it.',
    how: 'Now and then a field is being worked; meadows only where there is no herd.',
    needs: ['life', 'ground'],
    lod: ['machine'],
    strokes: ['life:farmWork'],
  },
  {
    id: 'players',
    group: 'life',
    name: 'Sport',
    source: ['invented'],
    what: 'A football match in formation with keepers and a referee, or a training session with the coach on the touchline; singles or doubles on tennis courts; a game at one end of a basketball court; a race or a few runners on the track.',
    how: 'On the pitches, courts and tracks the ground plan marked.',
    needs: ['life', 'ground'],
    lod: ['person'],
    strokes: ['life:players'],
  },
  {
    id: 'racing',
    group: 'life',
    name: 'Racing',
    source: ['invented'],
    what: 'A strung-out field of single-seaters or GT cars, or karts where the track winds tightly.',
    how: 'On raceways from the map.',
    needs: ['life'],
    lod: ['car'],
    strokes: ['life:racing'],
  },

  // Airfields
  {
    id: 'airfields',
    group: 'air',
    name: 'Runways and aprons',
    source: ['map', 'inferred'],
    what: 'Runway edges and markings, taxiway centre lines and aprons.',
    how: 'Runways, taxiways and aprons from the map. Runway width follows the airfield’s class: 45 m international and military, 40 regional, 30 public, 22 private.',
    lod: ['runwayMarks'],
    strokes: ['streets:airfields'],
  },
  {
    id: 'aircraft',
    group: 'air',
    name: 'Aircraft',
    source: ['inferred', 'invented'],
    what: 'Airliners at the stands of big airports, light singles and twins in rows on small fields, one aircraft lined up on each runway, and at gliding clubs a glider on tow behind its tug with more waiting beside the strip, one wingtip down.',
    how: 'The kind of airfield is read from its label: its class, and whether its name says gliders or helicopters.',
    needs: ['life'],
    lod: ['aircraft'],
    strokes: ['life:aviation'],
  },
  {
    id: 'helipads',
    group: 'air',
    name: 'Helipads',
    source: ['map', 'invented'],
    what: 'A circle and an H, often with a helicopter on its skids.',
    how: 'Helipads from the map; ones mapped on a building go on its roof.',
    lod: ['helipad'],
    strokes: ['life:aviation', 'details/helipad'],
  },

  // Power
  {
    id: 'pylons',
    group: 'power',
    name: 'Transmission lines',
    source: ['invented'],
    what: 'Lattice pylons with four legs and arms, insulators and sagging wires; too small on paper, a flat A-frame.',
    how: 'The map carries no power lines, so they are laid out on a 3 km grid in absolute map coordinates and carry on from one view into the next. They go underground in dense towns and keep clear of airfields.',
    needs: ['power'],
    lod: ['pylon', 'lattice', 'pylonLegs', 'insulator'],
    strokes: ['power:powerLines'],
  },
  {
    id: 'poles',
    group: 'power',
    name: 'Poles along roads',
    source: ['invented'],
    what: 'Wooden poles with sagging wires and transformer cans here and there.',
    how: 'Along primary to service roads: in town where that is the custom, only on country roads elsewhere.',
    regions: `In town too: ${listed(OVERHEAD_TOWN)}.`,
    needs: ['power'],
    lod: ['pole', 'poleWires', 'transformer'],
    strokes: ['power:powerLines'],
  },

  // Light and sheet
  {
    id: 'shadows',
    group: 'sheet',
    name: 'Cast shadows',
    source: ['inferred'],
    what: 'Shadows of buildings, trees and everything standing, hatched on the ground in the shadow pen.',
    how: 'Each outline is swept away from the sun by its height; the Sun direction and height settings set the light. Shadows too short to hatch are left out.',
    needs: ['shadows'],
    lod: ['shadow'],
    strokes: ['shadows'],
  },
  {
    id: 'map-notes',
    group: 'sheet',
    name: 'Map notes',
    source: ['map'],
    what: 'A second border with latitude and longitude ticks; below the drawing the place name, coordinates and view, a scale bar, a north arrow and the imprint, in single-stroke capitals.',
    how: 'From the settings and the place.',
    needs: ['marginalia'],
  },
  {
    id: 'title',
    group: 'sheet',
    name: 'Cinematic title',
    source: ['invented'],
    what: 'The place name, or a text of your own, in giant 3D block capitals standing on a street between the buildings, like the opening shot of a film. The sides turned from the sun can be hatched, and the letters cast shadows.',
    how: 'The margin\'s single-stroke capitals, thickened, merged into outlines and extruded. Road centre lines are joined across tile cuts and searched for long straight runs; the best run crosses the sheet, lies near the middle, is a main street and has buildings along it. The letters stand on its centre line, sized to a share of the drawing\'s width and kept inside it. Buildings they would stand in can make way, and Reveal brings them forward along the line of sight so buildings in front stop hiding them.',
    needs: ['title'],
    lod: ['title'],
    strokes: ['title'],
  },
];

const RIDGE: Record<Style['ridge'], string> = { street: 'Along the street', gableToStreet: 'Gable end to the street', long: 'Along the long side' };
const BLOCKS: Record<Style['blocks'], string> = { flat: 'Flat', mansard: 'Mansard', skirt: 'Pitched skirt' };
const ROOF_NAME: Record<string, string> = { gabled: 'gabled', hipped: 'hipped', halfHipped: 'half-hipped', mansard: 'mansard', flat: 'flat' };

let regionNames: Intl.DisplayNames | null = null;
const place = (code: string) => {
  try {
    regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

/** A reference card for one regional style, from the tables that drive the drawing. */
function styleEntry(id: StyleId): Entry {
  const s = STYLES[id];
  const countries = Object.entries(BY_COUNTRY).filter(([, v]) => v === id).map(([c]) => place(c));
  const regions = Object.entries(BY_REGION).filter(([, v]) => v === id).map(([c]) => place(c));
  const total = Object.values(s.roofs).reduce((a, b) => a + (b ?? 0), 0) || 1;
  const homeMix = HOME[id] as Record<string, number>;
  const homeTotal = Object.values(homeMix).reduce((a, b) => a + b, 0);
  const wild = WILD[id] ?? WILD_DEFAULT;
  const facts: [string, string][] = [
    ['House roofs', Object.entries(s.roofs).map(([k, v]) => `${ROOF_NAME[k] ?? k} ${pct((v ?? 0) / total)}`).join(', ')],
    ['Pitched share', `${pct(s.pitchedShare)} of houses at the default setting`],
    ['Pitch', `${s.pitch[0]}–${s.pitch[1]}°`],
    ['Pitched up to', `${s.pitchedMaxH} m tall, ${s.pitchedMaxArea.toLocaleString('en')} m²`],
    ['Big blocks', BLOCKS[s.blocks]],
    ['Ridges', RIDGE[s.ridge]],
    ['Overhang', `${s.overhang} m`],
    // As `guessStoreys()` lifts them in a solidly built centre: rows by 0.8 of the style's lift, blocks by all of it, at most 1.4 times.
    ['Storeys', `${s.storeys[0] === s.storeys[1] ? s.storeys[0] : `${s.storeys[0]}–${s.storeys[1]}`} for a house; a town centre adds up to ${Math.round(s.urban * 0.8 * 1.4)} to rows and ${Math.round(s.urban * 1.4)} to blocks; ${s.floor} m each`],
    ['Rows', s.rows ? 'Built as one: a row shares its roof and details' : 'Each house picks its own'],
    ['Chimneys', pct(s.chimney)],
    ['Dormers', pct(s.dormer)],
    ['Street gables', pct(s.gableFront)],
    ['Parapets', `${pct(s.parapet)} of flat roofs`],
    ['Home windows', Object.entries(homeMix).map(([k, v]) => `${k} ${pct(v / homeTotal)}`).join(', ')],
    ['Glazing bars', BARS.has(id) ? 'Yes' : 'No'],
    ['Shutters', SHUTTERS[id] ? `${pct(SHUTTERS[id]![0])} of homes` : 'None'],
    ['Balconies', BALCONIES[id] ? `${pct(BALCONIES[id]![0])} of flats, ${BALCONIES[id]![1] === 2 ? 'railed at every window' : 'deep, on alternate bays'}` : 'None'],
    ['Flat roofs carry', TANKS.has(id) ? 'Water tanks' : SOLAR.has(id) ? 'Solar panels' : 'Boxes only'],
    ['Castle turrets', TURRETS.has(id) ? 'Yes' : 'No'],
    ['Garden bounds', `${BOUNDS[id][0]} on the street, ${BOUNDS[id][1]} between neighbours`],
    ['Hedgerows', pct(HEDGEROWS[id])],
    ['Avenues', pct(AVENUES[id])],
    ['Main lines', ELECTRIC.has(id) ? 'Electric, under wires' : 'Mostly unwired'],
    ['Wires in town', OVERHEAD_TOWN.has(id) ? 'Overhead on poles' : 'Underground'],
    ['Herds', COWS.has(id) ? 'Cows' : SHEEP.has(id) ? 'Sheep' : 'None'],
    ['Palms', PALMS[id] ? pct(PALMS[id]!) : 'Only where it is warm'],
    ['Open country', `trees ${pct(wild.trees)}, bushes ${pct(wild.bush)}, conifers ${pct(wild.conifer)}`],
  ];
  return {
    id: `style-${id}`,
    group: 'styles',
    name: s.label,
    source: ['inferred'],
    what: 'The habits of one region, as a reference card: they set the guesses for every building and much that stands round them.',
    how: countries.length || regions.length ? `Picked for ${[...countries, ...regions.map((r) => `the rest of ${r}`)].join(', ')}.` : 'Anywhere no other style fits.',
    facts,
    style: id,
  };
}

/** Everything in the catalogue, in reading order. */
export const ENTRIES: Entry[] = [...ENTRIES_BY_HAND, ...STYLE_IDS.map(styleEntry)];

/** A tally name split into its feature and its facets. */
export type Filed = { name: string; head: string; facets: Set<string> };

export function filed(name: string): Filed {
  const [head, ...facets] = name.split('/');
  return { name, head, facets: new Set(facets) };
}

/** A test for the tally names an entry's stroke pattern takes (see `Entry.strokes`). */
export function matcher(pattern: string): (f: Filed) => boolean {
  const [head, ...want] = pattern.split('/');
  const exact = head.startsWith('=') ? head.slice(1) : null;
  const within = `${head}:`;
  return (f) => {
    if (exact !== null ? f.head !== exact : head !== '*' && f.head !== head && !f.head.startsWith(within)) return false;
    return want.every((w) => f.facets.has(w));
  };
}

/** Whether a gate is on in these settings. */
export function gateOn(set: Settings, g: Gate): boolean {
  const v = set[g];
  return typeof v === 'number' ? v > 0 : !!v;
}

/** The coarsest scale (1:N) a rule's typical thing shows at, with these settings and the Detail of `layer`. */
export function showsFrom(set: Settings, rule: RuleId, layer?: LayerId): number {
  return coarsest(LOD[rule], layerDetail(set, layer), set.penWidth);
}

const isLayer = (k: string): k is LayerId => Object.hasOwn(LAYERS, k);

/** The layer an entry is drawn in, for its Detail: where its strokes are filed, else its switch, else its group. */
export function entryLayer(e: Entry): LayerId | undefined {
  for (const pattern of e.strokes ?? []) {
    const head = pattern.split('/')[0].replace(/^=/, '').split(':')[0];
    if (isLayer(head)) return head;
  }
  const gate = e.needs?.find((g) => isLayer(g));
  if (gate) return gate as LayerId;
  return isLayer(e.group) ? e.group : undefined;
}
