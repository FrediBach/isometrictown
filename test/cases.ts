/**
 * The golden cases: places and settings that between them reach almost every drawn feature,
 * every regional style family and the settings most likely to break. Each case's map data is
 * recorded in `test/fixtures/net`, so adding one means `npm run test:record`.
 */
import { DEFAULT_SETTINGS, type Settings } from '@/settings';

export type Case = { id: string; what: string; set: Settings };

const at = (place: string, center: [number, number], bearing: number, scale: number, more: Partial<Settings> = {}): Settings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  place,
  center,
  bearing,
  scale,
  // Overpass answers change from week to week; only cases that say so use the recorded tags.
  osmTags: false,
  ...more,
});

const MOLLIS: [number, number] = [9.0744, 47.0934];

export const CASES: Case[] = [
  { id: 'mollis-default', what: 'The app as it opens: every default, OSM roof tags on', set: { ...structuredClone(DEFAULT_SETTINGS) } },
  { id: 'amsterdam', what: 'Dense canal city: boats, trams, Dutch gables', set: at('Amsterdam', [4.8862, 52.3727], 35, 1000) },
  { id: 'rye', what: 'English market town: marsh, left-hand traffic', set: at('Rye', [0.7335, 50.9503], 25, 900) },
  { id: 'hallstatt', what: 'Lake village under steep woods, looking west', set: at('Hallstatt', [13.6493, 47.5617], 300, 800) },
  { id: 'zurich-airport', what: 'Runways, aprons, aircraft and rail at a coarse scale', set: at('Zürich Airport', [8.5618, 47.4502], 0, 4000) },
  { id: 'midtown', what: 'Towers, a street grid and traffic', set: at('Midtown Manhattan', [-73.984, 40.7549], 29, 2000) },
  { id: 'nordlingen', what: 'Walled old town of packed roofs', set: at('Nördlingen', [10.4878, 48.8518], 30, 2500) },
  { id: 'betschwanden', what: 'Glarus valley village: railway, main road, stream, church and cemetery', set: at('Betschwanden', [9.0267, 46.9462], 35, 1000) },
  { id: 'emmental', what: 'Farmland, scattered farms and forest, coarse', set: at('Trubschachen', [7.8454, 46.922], 20, 4000) },
  {
    id: 'mollis-title',
    what: 'Cinematic title standing on a street, with shading and round ends',
    set: at('Mollis', MOLLIS, 35, 1000, { title: true, titleText: 'Mollis', titleRound: true, titleReveal: 0.4 }),
  },
  {
    id: 'mollis-broad-pen',
    what: 'Low Detail, a broad pen and one-pen output',
    set: at('Mollis', MOLLIS, 35, 1500, { detail: 0.5, penWidth: 0.7, mono: true, sheet: 'a4' }),
  },
  {
    id: 'mollis-layers',
    what: 'Detail and pens set per feature',
    set: at('Mollis', MOLLIS, 35, 1000, { sheet: 'a4', customLayerDetail: true, layerDetail: { trees: 0.5, windows: 2, roofHatch: 1.5 }, customLayerPens: true, layerPens: { trees: 4, roofs: 1 } }),
  },
  {
    id: 'mollis-portrait',
    what: 'Portrait sheet, steep tilt, shaded walls, forced Nordic style, another seed',
    set: at('Mollis', MOLLIS, 0, 1200, { sheet: 'a4', landscape: false, tilt: 50, shadeWalls: true, autoSun: false, sunAngle: 140, sunHeight: 25, heightScale: 1.5, style: 'nordic', seed: 7 }),
  },
  // Solarpunk mode on places already recorded: the same map data, drawn as a possible future.
  { id: 'mollis-solarpunk', what: 'Solarpunk village: panels on pitched roofs, rain tanks, a mountain climate', set: at('Mollis', MOLLIS, 35, 1000, { solarpunk: true }) },
  { id: 'amsterdam-solarpunk', what: 'Solarpunk canal city: gabled fronts kept, panels on the rows behind them', set: at('Amsterdam', [4.8862, 52.3727], 35, 1000, { solarpunk: true }) },
  { id: 'midtown-solarpunk', what: 'Solarpunk towers: rows of panels and green roofs on flat tops', set: at('Midtown Manhattan', [-73.984, 40.7549], 29, 2000, { solarpunk: true }) },
  { id: 'hallstatt-solarpunk', what: 'Solarpunk lake village: solar canopies, racks and beds in the car parks', set: at('Hallstatt', [13.6493, 47.5617], 300, 800, { solarpunk: true }) },
  { id: 'emmental-solarpunk', what: 'Solarpunk farmland at a coarse scale: barn roofs must not blot', set: at('Trubschachen', [7.8454, 46.922], 20, 4000, { solarpunk: true }) },
];

/** The base for switching solarpunk mode off: the village with it on. */
export const SOLARPUNK_BASE: Settings = at('Mollis', MOLLIS, 35, 1000, { solarpunk: true });

/**
 * The bases for switching settings off one at a time: the village with its title on has
 * something for nearly every switch; the farmland has the railway and power lines it lacks.
 */
export const GATE_BASE: Settings = at('Mollis', MOLLIS, 35, 1000, { title: true });
export const RURAL_BASE: Settings = at('Trubschachen', [7.8454, 46.922], 20, 4000);
