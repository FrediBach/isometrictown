/**
 * Pins in image mode on whole drawings: a hidden pin changes nothing, and a pin puts its kind
 * where it stands, as firmly as the town has room for, and says whether it could.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { imageScene, plausibility } from '@/image';
import { newPin, pinReach, type ImagePin, type PinKindId } from '@/image-pins';
import { labelAt } from '@/image-zones';
import { LABELS } from '@/image-tone';
import { toSheet, fitImage } from '@/image-fit';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { drawImage } from '../support/draw';
import { PICTURES } from '../support/pictures';

const pic = PICTURES.gradient();
const base: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id, imageName: pic.name, scale: 2500, tilt: 40, power: false, sheet: 'a4' };
const pin = (kind: PinKindId, x: number, y: number, more: Partial<ImagePin> = {}): ImagePin => ({ ...newPin(kind, [], x, y), ...more });
/** The ground under a pin, local metres. */
const groundOf = (s: ReturnType<typeof imageScene>, p: ImagePin) => s.cam.ground(...toSheet(fitImage(s.cam.rect, pic.w, pic.h, s.set.imageFit, s.set.imageFocus), p.x * pic.w, p.y * pic.h));

beforeAll(() => {
  vi.stubGlobal('fetch', (input: unknown) => {
    throw new Error(`Image mode fetched ${String(input)}`);
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('pins', () => {
  test('a hidden pin leaves the drawing as it was', () => {
    const plain = drawImage(base, pic).svg;
    expect(drawImage({ ...base, imagePins: [pin('worship', 0.5, 0.7, { off: true }), pin('park', 0.3, 0.5, { id: 'p2', off: true })] }, pic).svg).toBe(plain);
  });

  test('ground pins give the ground under them their label', () => {
    for (const [kind, label] of [['park', 'park'], ['water', 'water'], ['wood', 'wood']] as const) {
      // In the built-up dark side, where the image alone would put houses.
      const p = pin(kind, 0.75, 0.5);
      const s = imageScene(pic, { ...base, imagePins: [p] });
      expect(s.pins).toEqual({ [p.id]: true });
      expect(labelAt(s.zones, ...groundOf(s, p))).toBe(label);
      expect(plausibility(s.town)).toEqual([]);
    }
  });

  test('a feathered ground pin holds less than its circle and leans the rest of the way', () => {
    const p = pin('wood', 0.75, 0.5, { r: 0.12 });
    const woods = (s: ReturnType<typeof imageScene>) => s.zones.label.filter((k) => LABELS[k] === 'wood').length;
    const plain = woods(imageScene(pic, base));
    const hard = imageScene(pic, { ...base, imagePins: [p] });
    const soft = imageScene(pic, { ...base, imagePins: [{ ...p, feather: 0.16 }] });
    expect(soft.pins).toEqual({ [p.id]: true });
    expect(labelAt(soft.zones, ...groundOf(soft, p))).toBe('wood');
    expect(woods(soft)).toBeLessThan(woods(hard));
    expect(woods(soft)).toBeGreaterThan(plain);
  });

  test('a landmark pin builds its kind near the pin, and the town makes no second town hall', () => {
    const church = pin('worship', 0.5, 0.7);
    const hall = pin('townhall', 0.8, 0.5, { id: 'p2' });
    const s = imageScene(pic, { ...base, imagePins: [church, hall] });
    expect(s.pins).toEqual({ [church.id]: true, [hall.id]: true });
    const reach = pinReach(base.scale);
    const [cx, cy] = groundOf(s, church);
    expect(s.town.tagged.some((t) => t.building === 'church' && Math.hypot(t.x - cx, t.y - cy) < reach)).toBe(true);
    const halls = s.town.pois.filter((p) => p.cls === 'town_hall');
    const [hx, hy] = groundOf(s, hall);
    expect(halls).toHaveLength(1);
    expect(Math.hypot(halls[0].x - hx, halls[0].y - hy)).toBeLessThan(reach);
    expect(plausibility(s.town)).toEqual([]);
  });

  test('a roundabout pin makes the junction nearest it a roundabout', () => {
    const p = pin('roundabout', 0.8, 0.5);
    const plain = imageScene(pic, base);
    const s = imageScene(pic, { ...base, imagePins: [p] });
    expect(s.pins).toEqual({ [p.id]: true });
    // A roundabout's ring is laid into the street graph as short edges round its island.
    expect(s.streets.edges.length).toBeGreaterThan(plain.streets.edges.length);
  });

  test('a landmark pin with no lot near it gets a site of its own, fronting a street', () => {
    // Open country and terraced rows have no lots; each kind is built beside the nearest street.
    for (const [kind, x] of [['worship', 0.1], ['hospital', 0.3], ['school', 0.55], ['townhall', 0.2]] as const) {
      const p = pin(kind, x, 0.5);
      const s = imageScene(pic, { ...base, imagePins: [p] });
      expect(s.pins).toEqual({ [p.id]: true });
      expect(plausibility(s.town)).toEqual([]);
    }
  });

  test('a pin with no room near it says so', () => {
    // A church in the middle of a pond has nowhere to stand.
    const p = pin('worship', 0.75, 0.5);
    const pond = pin('water', 0.75, 0.5, { id: 'p2', r: 0.25 });
    expect(imageScene(pic, { ...base, imagePins: [pond, p] }).pins).toEqual({ [pond.id]: true, [p.id]: false });
  });

  test('a building pin reuses the land plan, and a ground pin redoes it', () => {
    const plain = imageScene(pic, base);
    const fire = imageScene(pic, { ...base, imagePins: [pin('fire', 0.7, 0.5)] });
    expect(fire.zones).toBe(plain.zones);
    expect(fire.streets).toBe(plain.streets);
    const park = imageScene(pic, { ...base, imagePins: [pin('park', 0.7, 0.5)] });
    expect(park.zones).not.toBe(plain.zones);
  });
});
