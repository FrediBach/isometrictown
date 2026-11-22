/**
 * Pins in image mode: things from the catalogue placed by hand on the picture, which the town is
 * then laid out round. A pinned church takes the lot nearest its pin, a pinned park the ground
 * under its circle, a pinned roundabout the junction nearest it. Each is firm where the town can
 * give it room and is left out where it can't, and the drawing reports which.
 *
 * Pins are kept in fractions of the picture's width and height, as masks are, so they stay on the
 * same part of the picture when the crop moves. This module draws nothing: the interface uses it
 * too, to show and drag the pins over the preview.
 */
import type { Camera } from './camera';
import { toSheet, type Placed } from './image-fit';
import type { Label } from './image-tone';

/** The stage of laying out a pin steers, which decides what is redone when it moves. */
export type PinStage = 'zone' | 'layout' | 'build';

/** What a kind of pin makes, the catalogue entry it stands for, and the stage that makes it. */
export type PinKind = {
  label: string;
  /** The catalogue entry this kind places, so the catalogue can offer it and count it. */
  entry: string;
  stage: PinStage;
  /** Ground kinds: the zone label the ground under the circle takes. */
  zone?: Label;
  /** What the panel says it does. */
  note: string;
};

/** The kinds of pin. */
export type PinKindId = 'worship' | 'townhall' | 'school' | 'hospital' | 'fire' | 'roundabout' | 'park' | 'wood' | 'water' | 'square' | 'field' | 'allotments';

/** Every kind of pin, in the order the panel lists them. */
export const PIN_KINDS: Record<PinKindId, PinKind> = {
  worship: { label: 'Place of worship', entry: 'kind-worship', stage: 'layout', note: 'A church, mosque or temple, as the style has it, on the lot nearest the pin, or on a site of its own beside the nearest street, with a churchyard where there is room.' },
  townhall: { label: 'Town hall', entry: 'town-hall-flags', stage: 'layout', note: 'The town hall, flag and all, on a site of its own beside the street nearest the pin. It takes the place of the one the town would put on its largest square.' },
  school: { label: 'School', entry: 'kind-civic', stage: 'layout', note: 'A school hall on the lot nearest the pin, or on a site of its own beside the nearest street, with a pitch in the park beside it if there is one.' },
  hospital: { label: 'Hospital', entry: 'hospital-helipads', stage: 'layout', note: 'A broad, flat-roofed hospital block on the lot nearest the pin, or on a site of its own beside the nearest street, with a helipad on the roof and an ambulance outside.' },
  fire: { label: 'Fire station', entry: 'emergency', stage: 'build', note: 'The nearest building of the right size becomes a fire station, with engines out in front.' },
  roundabout: { label: 'Roundabout', entry: 'roundabouts', stage: 'layout', note: 'The junction nearest the pin becomes a roundabout, if it has the room.' },
  park: { label: 'Park', entry: 'parks', stage: 'zone', zone: 'park', note: 'The ground under the circle becomes park, following the picture’s edges.' },
  wood: { label: 'Wood', entry: 'woods', stage: 'zone', zone: 'wood', note: 'The ground under the circle becomes woodland.' },
  water: { label: 'Pond or lake', entry: 'waves', stage: 'zone', zone: 'water', note: 'The ground under the circle becomes open water, with a shore round it.' },
  square: { label: 'Square', entry: 'plazas', stage: 'zone', zone: 'plaza', note: 'The ground under the circle becomes a paved square, which can then draw a church and the town hall beside it.' },
  field: { label: 'Fields', entry: 'fields', stage: 'zone', zone: 'field', note: 'The ground under the circle becomes farmland, cut into a patchwork of fields.' },
  allotments: { label: 'Allotments', entry: 'allotments', stage: 'zone', zone: 'allot', note: 'The ground under the circle becomes allotment gardens.' },
};
export const PIN_KIND_IDS = Object.keys(PIN_KINDS) as PinKindId[];

/** The groups the panel lists the kinds in. */
export const PIN_GROUPS: { caption: string; kinds: PinKindId[] }[] = [
  { caption: 'Landmarks', kinds: ['worship', 'townhall', 'school', 'hospital', 'fire'] },
  { caption: 'Streets', kinds: ['roundabout'] },
  { caption: 'Ground', kinds: ['park', 'wood', 'water', 'square', 'field', 'allotments'] },
];

/** A pin on the picture. */
export type ImagePin = {
  /** Stable name for the interface; the drawing never reads it. */
  id: string;
  kind: PinKindId;
  /** Where it stands, in fractions of the picture's width (x) and height (y). */
  x: number;
  y: number;
  /** Ground kinds: the circle's radius, as a share of the picture's shorter side. */
  r: number;
  /** Ground kinds: the width of the circle's soft edge, as a share of the picture's shorter side, centred on the circle. Inside it the ground is held; across it the hold fades and the picture shapes the edge. */
  feather: number;
  /** Left out of the drawing, but kept. */
  off: boolean;
};

/** Most pins a drawing keeps. */
export const PINS_MAX = 48;
/** The smallest and largest circle a ground pin takes, as a share of the picture's shorter side. */
export const PIN_RADIUS: [number, number] = [0.01, 0.3];
/** A new ground pin's circle. */
const PIN_RADIUS_NEW = 0.06;
/** The widest soft edge a ground pin takes, as a share of the picture's shorter side. */
export const PIN_FEATHER_MAX = 0.3;

/** Whether a kind takes ground under a circle rather than a spot. */
export const isGround = (kind: PinKindId) => PIN_KINDS[kind].stage === 'zone';

/** Pins that take part in the drawing. */
export const activePins = (pins: readonly ImagePin[] | undefined) => (pins ?? []).filter((p) => !p.off && PIN_KINDS[p.kind]);

/** A pin placed on the drawing: where it shows on the sheet (mm) and the ground under that (local metres), and its circle and soft edge on the sheet (mm). */
export type PlacedPin = { id: string; kind: PinKindId; sx: number; sy: number; sr: number; sf: number; x: number; y: number };

/** The pins on the sheet and the ground, for a picture `w` × `h` pixels placed at `placed`. */
export function placePins(pins: readonly ImagePin[] | undefined, cam: Pick<Camera, 'ground'>, placed: Placed, w: number, h: number): PlacedPin[] {
  const short = Math.min(placed.w, placed.h);
  return activePins(pins).map((p) => {
    const [sx, sy] = toSheet(placed, p.x * w, p.y * h);
    const [x, y] = cam.ground(sx, sy);
    return { id: p.id, kind: p.kind, sx, sy, sr: isGround(p.kind) ? p.r * short : 0, sf: isGround(p.kind) ? p.feather * short : 0, x, y };
  });
}

/** The placed pins a stage reads. */
export const pinsAt = (pins: readonly PlacedPin[] | undefined, stage: PinStage) => (pins ?? []).filter((p) => PIN_KINDS[p.kind].stage === stage);

/** A key for caching a stage: the pins it reads and where they stand, and nothing else. */
export function pinsKey(pins: readonly ImagePin[] | undefined, stage: PinStage): string {
  const out = activePins(pins).filter((p) => PIN_KINDS[p.kind].stage === stage).map((p) => [p.kind, p.x, p.y, ...(isGround(p.kind) ? [p.r, p.feather] : [])]);
  return out.length ? JSON.stringify(out) : '';
}

/**
 * How far from its pin a landmark or roundabout may stand, m: a few lots in town, more at coarse
 * scales, where a lot is a smaller target to point at.
 */
export const pinReach = (scale: number) => Math.max(80, (15 * scale) / 1000);

/** What became of each pin in the drawing: true where the town made it, false where nothing near it had room. */
export type PinOutcomes = Record<string, boolean>;

/** A pin's name in the interface: its kind, numbered among the pins of that kind. */
export function pinName(pin: ImagePin, pins: readonly ImagePin[]): string {
  const same = pins.filter((p) => p.kind === pin.kind);
  return same.length > 1 ? `${PIN_KINDS[pin.kind].label} ${same.indexOf(pin) + 1}` : PIN_KINDS[pin.kind].label;
}

/** A new pin's id, unique among `pins`. */
export function newPinId(pins: readonly ImagePin[]): string {
  let n = pins.length + 1;
  while (pins.some((p) => p.id === `p${n}`)) n++;
  return `p${n}`;
}

/** A new pin of a kind at a point of the picture, by default its middle. */
export function newPin(kind: PinKindId, pins: readonly ImagePin[], x = 0.5, y = 0.5): ImagePin {
  return { id: newPinId(pins), kind, x, y, r: PIN_RADIUS_NEW, feather: 0, off: false };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Pins from storage or a link: known kinds, numbers in range. Anything broken is dropped. */
export function validPins(raw: unknown): ImagePin[] {
  if (!Array.isArray(raw)) return [];
  const out: ImagePin[] = [];
  for (const p of raw.slice(0, PINS_MAX)) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const kind = PIN_KIND_IDS.find((k) => k === r.kind);
    if (!kind || !finite(r.x) || !finite(r.y)) continue;
    const id = typeof r.id === 'string' && /^[a-z0-9]{1,12}$/.test(r.id) && !out.some((o) => o.id === r.id) ? r.id : newPinId(out);
    out.push({
      id,
      kind,
      x: Math.max(-1, Math.min(2, r.x)),
      y: Math.max(-1, Math.min(2, r.y)),
      r: finite(r.r) ? Math.max(PIN_RADIUS[0], Math.min(PIN_RADIUS[1], r.r)) : PIN_RADIUS_NEW,
      feather: finite(r.feather) ? Math.max(0, Math.min(PIN_FEATHER_MAX, r.feather)) : 0,
      off: r.off === true,
    });
  }
  return out;
}
