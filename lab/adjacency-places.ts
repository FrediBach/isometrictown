import type { LngLat } from '../src/geo';

/** A real place whose land plan teaches image-mode zoning which zones border which. */
export type CorpusPlace = { id: string; center: LngLat; kind: 'old' | 'city' | 'towers' | 'suburb' | 'rows' | 'village' | 'works' | 'shore' };

/**
 * Real places spread over the kinds of town image mode makes: old towns, perimeter-block
 * cities, tower cores, suburbs, terraced districts, villages in farmland, ports and works, and
 * towns on a shore. Every region's styles have some. Airports are left out: runways read as plazas.
 */
export const CORPUS: CorpusPlace[] = [
  // Old towns and their edges
  { id: 'nordlingen', center: [10.4878, 48.8518], kind: 'old' },
  { id: 'rothenburg', center: [10.18, 49.3769], kind: 'old' },
  { id: 'bamberg', center: [10.8869, 49.8917], kind: 'old' },
  { id: 'regensburg', center: [12.096, 49.0195], kind: 'old' },
  { id: 'bruges', center: [3.2247, 51.2093], kind: 'old' },
  { id: 'delft', center: [4.3571, 52.0116], kind: 'old' },
  { id: 'siena', center: [11.3308, 43.3188], kind: 'old' },
  { id: 'lucca', center: [10.505, 43.843], kind: 'old' },
  { id: 'tallinn', center: [24.7453, 59.437], kind: 'old' },
  { id: 'york', center: [-1.0815, 53.96], kind: 'old' },
  { id: 'rye', center: [0.7335, 50.9503], kind: 'old' },
  { id: 'freiburg', center: [7.8494, 47.9959], kind: 'old' },
  { id: 'seville', center: [-5.993, 37.389], kind: 'old' },
  // Perimeter-block cities
  { id: 'amsterdam', center: [4.8862, 52.3727], kind: 'city' },
  { id: 'prenzlauer-berg', center: [13.418, 52.539], kind: 'city' },
  { id: 'eixample', center: [2.162, 41.39], kind: 'city' },
  { id: 'vienna', center: [16.34, 48.21], kind: 'city' },
  { id: 'paris-11', center: [2.38, 48.859], kind: 'city' },
  { id: 'budapest', center: [19.07, 47.5], kind: 'city' },
  { id: 'schwabing', center: [11.58, 48.16], kind: 'city' },
  { id: 'wiedikon', center: [8.52, 47.37], kind: 'city' },
  { id: 'norrebro', center: [12.55, 55.693], kind: 'city' },
  { id: 'valencia', center: [-0.3763, 39.4699], kind: 'city' },
  // Tower cores
  { id: 'midtown', center: [-73.984, 40.7549], kind: 'towers' },
  { id: 'frankfurt', center: [8.672, 50.113], kind: 'towers' },
  { id: 'la-defense', center: [2.238, 48.892], kind: 'towers' },
  { id: 'sapporo', center: [141.3512, 43.0603], kind: 'towers' },
  { id: 'rotterdam', center: [4.48, 51.92], kind: 'towers' },
  { id: 'chicago', center: [-87.63, 41.88], kind: 'towers' },
  { id: 'toronto', center: [-79.3832, 43.6532], kind: 'towers' },
  // Suburbs
  { id: 'levittown', center: [-73.5146, 40.7259], kind: 'suburb' },
  { id: 'naperville', center: [-88.1535, 41.7508], kind: 'suburb' },
  { id: 'plano', center: [-96.73, 33.03], kind: 'suburb' },
  { id: 'grobenzell', center: [11.37, 48.195], kind: 'suburb' },
  { id: 'almere-haven', center: [5.22, 52.335], kind: 'suburb' },
  { id: 'adelaide', center: [138.63, -34.94], kind: 'suburb' },
  // Terraced districts
  { id: 'harehills', center: [-1.515, 53.81], kind: 'rows' },
  { id: 'roath', center: [-3.165, 51.495], kind: 'rows' },
  { id: 'levenshulme', center: [-2.19, 53.445], kind: 'rows' },
  { id: 'brunswick', center: [144.96, -37.77], kind: 'rows' },
  // Villages, farmland and woods
  { id: 'mollis', center: [9.0744, 47.0934], kind: 'village' },
  { id: 'betschwanden', center: [9.0267, 46.9462], kind: 'village' },
  { id: 'emmental', center: [7.8454, 46.922], kind: 'village' },
  { id: 'bauma', center: [8.8858, 47.3653], kind: 'village' },
  { id: 'andechs', center: [11.183, 47.974], kind: 'village' },
  { id: 'riquewihr', center: [7.2978, 48.1667], kind: 'village' },
  { id: 'bibury', center: [-1.834, 51.759], kind: 'village' },
  { id: 'ames', center: [-93.62, 42.03], kind: 'village' },
  // Ports and works
  { id: 'waalhaven', center: [4.43, 51.89], kind: 'works' },
  { id: 'hamburg-hafen', center: [9.97, 53.54], kind: 'works' },
  { id: 'ruhrort', center: [6.74, 51.455], kind: 'works' },
  { id: 'antwerp', center: [4.39, 51.26], kind: 'works' },
  // Towns on a shore
  { id: 'hallstatt', center: [13.6493, 47.5617], kind: 'shore' },
  { id: 'interlaken', center: [7.861, 46.6895], kind: 'shore' },
  { id: 'brighton', center: [-0.14, 50.82], kind: 'shore' },
  { id: 'sanremo', center: [7.775, 43.817], kind: 'shore' },
  { id: 'venice', center: [12.338, 45.437], kind: 'shore' },
  { id: 'lisbon', center: [-9.13, 38.712], kind: 'shore' },
  { id: 'kyoto', center: [135.7681, 35.0116], kind: 'city' },
  { id: 'lucerne', center: [8.3093, 47.0502], kind: 'shore' },
];
