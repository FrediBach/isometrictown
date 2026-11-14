import type { LngLat } from '../src/geo';

/** A place the LOD lab draws, chosen to cover one kind of town or country. */
export type LabPlace = { id: string; name: string; center: LngLat; bearing: number; kind: string };

/**
 * The test places: villages and farmland, dense old towns, a canal city, towers, a lake under
 * mountains, marsh and an airport. Between them they reach almost every drawn feature.
 */
export const PLACES: LabPlace[] = [
  { id: 'mollis', name: 'Mollis', center: [9.0744, 47.0934], bearing: 35, kind: 'Alpine village, fields, power lines' },
  { id: 'amsterdam', name: 'Amsterdam', center: [4.8862, 52.3727], bearing: 35, kind: 'Dense canal city, boats, trams' },
  { id: 'nordlingen', name: 'Nördlingen', center: [10.4878, 48.8518], bearing: 30, kind: 'Walled old town, packed roofs' },
  { id: 'hallstatt', name: 'Hallstatt', center: [13.6493, 47.5617], bearing: 300, kind: 'Lake village under steep woods' },
  { id: 'rye', name: 'Rye', center: [0.7335, 50.9503], bearing: 25, kind: 'English market town, marsh, left traffic' },
  { id: 'zurich-airport', name: 'Zürich Airport', center: [8.5618, 47.4502], bearing: 0, kind: 'Runways, aprons, aircraft, rail' },
  { id: 'midtown', name: 'Midtown Manhattan', center: [-73.984, 40.7549], bearing: 29, kind: 'Towers, grid streets, traffic' },
  { id: 'emmental', name: 'Trubschachen', center: [7.8454, 46.922], bearing: 20, kind: 'Farmland, scattered farms, forest' },
];

/** Scales the lab draws each place at, as 1:N, from close up to the coarsest the app offers. */
export const SCALES = [500, 1000, 2000, 4000, 8000];
