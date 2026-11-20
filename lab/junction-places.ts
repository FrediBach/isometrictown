import { CORPUS, type CorpusPlace } from './adjacency-places';

/**
 * Town edges, new towns and suburbs for the junction lab, on top of the adjacency lab's places,
 * which are mostly town centres: real roundabouts cluster on the outskirts, round industrial
 * estates and in newer suburbs, and centres alone would teach image mode to leave them out.
 * Labelled like the rest, so what they teach goes to the zones they are.
 */
export const OUTSKIRTS: CorpusPlace[] = [
  { id: 'milton-keynes', center: [-0.759, 52.04], kind: 'suburb' },
  { id: 'swindon', center: [-1.7716, 51.5626], kind: 'suburb' },
  { id: 'bracknell', center: [-0.75, 51.413], kind: 'suburb' },
  { id: 'cergy', center: [2.064, 49.036], kind: 'suburb' },
  { id: 'evry', center: [2.43, 48.627], kind: 'suburb' },
  { id: 'montpellier-est', center: [3.9213, 43.6036], kind: 'works' },
  { id: 'cesson-sevigne', center: [-1.603, 48.121], kind: 'suburb' },
  { id: 'houten', center: [5.17, 52.03], kind: 'suburb' },
  { id: 'zoetermeer', center: [4.49, 52.06], kind: 'suburb' },
  { id: 'almere-stad', center: [5.22, 52.37], kind: 'suburb' },
  { id: 'las-rozas', center: [-3.87, 40.49], kind: 'suburb' },
  { id: 'sant-cugat', center: [2.08, 41.47], kind: 'suburb' },
  { id: 'reggio-emilia', center: [10.6, 44.71], kind: 'suburb' },
  { id: 'ingolstadt', center: [11.4, 48.78], kind: 'works' },
  { id: 'uppsala', center: [17.67, 59.85], kind: 'suburb' },
  { id: 'carmel-indiana', center: [-86.12, 39.97], kind: 'suburb' },
  { id: 'irvine', center: [-117.79, 33.68], kind: 'suburb' },
  { id: 'canberra', center: [149.13, -35.28], kind: 'suburb' },
  { id: 'joondalup', center: [115.766, -31.745], kind: 'suburb' },
  { id: 'wels', center: [14.03, 48.16], kind: 'works' },
];

/** Every place the junction lab reads. */
export const JUNCTION_CORPUS: CorpusPlace[] = [...CORPUS, ...OUTSKIRTS];
