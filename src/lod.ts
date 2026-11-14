import { REF_NIB, type Camera } from './camera';
import { hash } from './rng';

/**
 * Level of detail, one rule per kind of thing.
 *
 * A pen plotter can't draw anything smaller than a few pen widths: below that, lines close up
 * into a blot, cost a pen lift each and spoil what is around them. So every drawn thing asks
 * how big it will be on paper. A rule says how many millimetres (`mm`) a thing must span
 * before it is worth drawing; `m` is how big a typical one is in metres, so a typical thing
 * shows from 1:(1000·m/mm) and finer. Callers pass the size of the actual thing where they
 * know it, so a big chimney outlasts a small one.
 *
 * Sizes are measured by `cam.size()`: zoom first, then the Detail setting on top (Detail 2
 * keeps things half as big), and a pen broader than 0.35 mm drops things sooner.
 */
export type Rule = {
  /** Typical size in metres, used when the caller doesn't know the actual size. */
  m: number;
  /** Smallest size on paper worth drawing, mm at Detail 1 with a 0.35 mm pen. */
  mm: number;
  /** What the rule governs, for the LOD lab's table. */
  what: string;
};

export const LOD = {
  // Buildings
  building: { m: 5, mm: 0.7, what: 'Small sheds, garages and houses: square root of the footprint. Terraces and landmarks always stay' },
  crease: { m: 2, mm: 0.9, what: 'Corners between two walls that both face the viewer: the shorter wall' },
  window: { m: 1.2, mm: 0.85, what: 'Window frames: width' },
  windowTick: { m: 1.5, mm: 0.8, what: 'Windows as single strokes: height' },
  glazingBars: { m: 1.2, mm: 1.7, what: 'Glazing bars in windows: width' },
  shopfront: { m: 2.3, mm: 1.15, what: 'Shop windows: height' },
  awning: { m: 1.3, mm: 0.6, what: 'Striped awnings: depth' },
  gable: { m: 0.8, mm: 0.7, what: 'Stepped and shaped gables on street fronts: step width' },
  roofHatch: { m: 4, mm: 1.2, what: 'Roof hatching: slope from eave to ridge' },
  chimney: { m: 0.65, mm: 0.45, what: 'Chimney stacks: width' },
  dormer: { m: 2, mm: 1, what: 'Dormers: width' },
  parapet: { m: 1.5, mm: 0.6, what: 'Parapet lines on flat roofs' },
  battlements: { m: 1, mm: 0.6, what: 'Battlements: merlon width' },
  rooftop: { m: 2.5, mm: 1, what: 'Plant rooms, tanks and boxes on flat roofs: width' },
  solar: { m: 1.7, mm: 1, what: 'Solar panel rows' },
  flag: { m: 1.5, mm: 0.75, what: 'Flags on landmarks: cloth' },
  helipad: { m: 10, mm: 3, what: 'Helipads on hospital roofs' },

  // Shadows and trees
  shadow: { m: 5, mm: 0.9, what: 'Cast shadows: length on the ground' },
  tree: { m: 5, mm: 1.1, what: 'Tree crowns: diameter. Smaller ones are drawn bigger, then thinned out' },
  treeSpacing: { m: 6.5, mm: 2, what: 'Trees scattered in woods and parks: spacing. Closer ones are thinned out' },
  hedgerow: { m: 4, mm: 1, what: 'Hedgerow trees along field edges' },
  orchard: { m: 4, mm: 0.8, what: 'Orchards as rows of little trees' },

  // Streets and railways
  road: { m: 6, mm: 0.8, what: 'Roads: width between kerbs. Narrower ones are drawn wider, up to twice their width' },
  stream: { m: 2.5, mm: 0.9, what: 'Streams with two banks: width. Narrower ones are a single line' },
  footpath: { m: 25, mm: 3, what: 'Footpaths: length. Short stubs go first' },
  lamp: { m: 5, mm: 1.5, what: 'Street lamps: height' },
  car: { m: 4.5, mm: 1.8, what: 'Vehicles: length' },
  centreLine: { m: 3, mm: 0.9, what: 'Road centre dashes' },
  zebra: { m: 1.5, mm: 0.9, what: 'Zebra crossings and traffic lights' },
  parkingBay: { m: 2.5, mm: 1.25, what: 'Parking bay lines' },
  runwayMarks: { m: 8, mm: 0.96, what: 'Runway and taxiway markings' },
  steps: { m: 1.8, mm: 1, what: 'Steps: width' },
  ruts: { m: 1.6, mm: 0.7, what: 'Farm tracks as twin ruts: their spacing' },
  twinRails: { m: 1.5, mm: 0.7, what: 'Both rails of a track: gauge' },
  sleepers: { m: 2.6, mm: 1, what: 'Railway sleepers: spacing' },
  catenary: { m: 7, mm: 2.1, what: 'Overhead line masts: height' },
  crossing: { m: 3.5, mm: 1.2, what: 'Level crossing barriers' },
  barrier: { m: 4, mm: 1, what: 'Motorway crash barriers and gantries' },
  bridge: { m: 6, mm: 1.5, what: 'Bridge arches and piers' },
  platform: { m: 5, mm: 1, what: 'Station platform canopies' },
  train: { m: 3, mm: 0.75, what: 'Trains: car width' },
  bogies: { m: 2.6, mm: 1.3, what: 'Train bogies' },
  trainFine: { m: 1, mm: 0.9, what: 'Train windows and doors' },
  pantograph: { m: 1.8, mm: 0.54, what: 'Pantographs' },
  pylon: { m: 30, mm: 3, what: 'Transmission pylons' },
  pole: { m: 9, mm: 2.7, what: 'Wooden poles along roads' },
  lattice: { m: 2, mm: 1.8, what: 'Pylon lattice bracing' },
  pylonLegs: { m: 2.2, mm: 0.9, what: 'Pylons with four legs and full arms: width at the waist. Narrower, a flat A-frame' },
  insulator: { m: 2.2, mm: 0.7, what: 'Insulators hanging from pylon arms' },

  // Life
  person: { m: 1.7, mm: 2.4, what: 'People: height' },
  livestock: { m: 2.3, mm: 1.4, what: 'Cows and sheep: length' },
  mooredBoat: { m: 6, mm: 1.5, what: 'Moored boats: length' },
  sailingBoat: { m: 8, mm: 1.2, what: 'Boats under way: length' },
  aircraft: { m: 30, mm: 3.6, what: 'Aircraft: wingspan' },
  machine: { m: 6, mm: 1.8, what: 'Tractors, combines and other working vehicles: length' },
  ship: { m: 60, mm: 3, what: 'Ships and barges under way: length' },
  wake: { m: 30, mm: 3, what: 'Wakes behind ships: length' },

  // Sites and ground
  beach: { m: 2, mm: 0.8, what: 'Parasols and towels' },
  tent: { m: 3, mm: 0.9, what: 'Tents and caravans' },
  playground: { m: 3, mm: 1.35, what: 'Swings and slides' },
  farmyard: { m: 5, mm: 1, what: 'Silos and stacks in farmyards' },
  port: { m: 12, mm: 1.44, what: 'Quayside cranes and containers' },
  fountain: { m: 4, mm: 1.2, what: 'Fountains and statues on squares' },
  busStop: { m: 3, mm: 1.2, what: 'Bus shelters' },
  fuel: { m: 12, mm: 3, what: 'Petrol station canopies' },
  stack: { m: 30, mm: 3.6, what: 'Industrial chimney stacks: height' },
  summit: { m: 10, mm: 0.8, what: 'Summit crosses' },
  garden: { m: 2, mm: 1, what: 'Garden fences, sheds and beds' },
  cemetery: { m: 2, mm: 1.2, what: 'Graves in cemeteries' },
  pitch: { m: 100, mm: 10, what: 'Pitch markings: length of the pitch' },
  vines: { m: 2, mm: 0.7, what: 'Vineyard rows drawn standing' },
  bale: { m: 1.2, mm: 0.6, what: 'Bales on stubble' },
} satisfies Record<string, Rule>;

export type RuleId = keyof typeof LOD;

/** Fades a kind of thing out over one doubling of scale: thresholds run from ×0.71 to ×1.41. */
const FADE = 1;

/**
 * Whether a thing `m` metres across is big enough on paper to draw. Pass a stable hash in
 * [0, 1) as `h` and the things of one kind drop out one by one over a band of scales, not all
 * at once; leave it out for a single yes or no at the rule's size.
 */
export function shows(cam: Camera, rule: Rule, m = rule.m, h = 0.5): boolean {
  return cam.size(m) >= rule.mm * 2 ** ((h - 0.5) * FADE);
}

/** Like `shows()`, with the fade keyed on a place: `key` from `B.key()` and a salt for this decision. */
export function showsAt(cam: Camera, rule: Rule, m: number, key: readonly [number, number], seed: number, salt: number): boolean {
  return shows(cam, rule, m, hash(key[0], key[1], seed, salt));
}

/**
 * For things that crowd (trees): the share to keep so that, drawn no smaller than the rule's
 * size, they lay down about as much ink as they would at full size. 1 when they're big enough.
 */
export function thin(cam: Camera, rule: Rule, m: number): number {
  const r = cam.size(m) / rule.mm;
  return r >= 1 ? 1 : r * r;
}

/** A size in metres widened, up to `grow` times, until it is at least the rule's size on paper. */
export function atLeast(cam: Camera, rule: Rule, m: number, grow = 2): number {
  return Math.max(m, Math.min(m * grow, rule.mm / cam.lod));
}

/** Metres between repeated things that keep at least `mm` apart on paper; never closer than `m`. */
export function spaced(cam: Camera, m: number, mm: number): number {
  return Math.max(m, cam.gap(mm) / cam.s);
}

/** The coarsest scale (1:N) a typical thing shows at, with a given Detail and pen. */
export function coarsest(rule: Rule, detail = 1, nib = REF_NIB): number {
  return (1000 * rule.m * detail * REF_NIB) / (rule.mm * nib);
}
