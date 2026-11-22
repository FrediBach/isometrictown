import { describe, expect, test } from 'vitest';
import { activePins, newPin, PIN_KIND_IDS, PIN_KINDS, PIN_RADIUS, pinsKey, placePins, validPins } from '@/image-pins';
import { ENTRIES } from '@/catalogue';

describe('pins', () => {
  test('every kind places a catalogue entry, and a ground kind names its zone', () => {
    const ids = new Set(ENTRIES.map((e) => e.id));
    for (const k of PIN_KIND_IDS) {
      expect(ids.has(PIN_KINDS[k].entry)).toBe(true);
      expect(PIN_KINDS[k].stage === 'zone').toBe(!!PIN_KINDS[k].zone);
    }
  });

  test('broken pins from a link are dropped or mended', () => {
    const pins = validPins([
      { id: 'p1', kind: 'worship', x: 0.5, y: 0.5, r: 9, feather: -1, off: false },
      { id: 'p1', kind: 'park', x: 0.2, y: 0.3 },
      { kind: 'castle', x: 0.5, y: 0.5 },
      { kind: 'wood', x: 'left', y: 0.5 },
      null,
    ]);
    expect(pins).toEqual([
      { id: 'p1', kind: 'worship', x: 0.5, y: 0.5, r: PIN_RADIUS[1], feather: 0, off: false },
      { id: 'p2', kind: 'park', x: 0.2, y: 0.3, r: 0.06, feather: 0, off: false },
    ]);
    expect(validPins('nonsense')).toEqual([]);
  });

  test('each stage is keyed only on its own pins, and hidden pins key nothing', () => {
    const church = newPin('worship', []);
    const park = { ...newPin('park', [church]), x: 0.3 };
    expect(pinsKey([church, park], 'zone')).toBe(pinsKey([park], 'zone'));
    expect(pinsKey([church, park], 'build')).toBe('');
    expect(pinsKey([{ ...park, off: true }], 'zone')).toBe('');
    expect(activePins([{ ...park, off: true }])).toEqual([]);
  });

  test('a pin lands where its picture point shows on the sheet, with its circle on the picture’s shorter side', () => {
    const placed = { x: 10, y: 20, w: 200, h: 100, ppm: 2 };
    const cam = { ground: (sx: number, sy: number): [number, number] => [sx * 10, -sy * 10] };
    const [p] = placePins([{ ...newPin('park', []), x: 0.25, y: 0.5, r: 0.1, feather: 0.05 }], cam, placed, 400, 200);
    expect(p).toMatchObject({ sx: 60, sy: 70, sr: 10, sf: 5, x: 600, y: -700 });
    expect(placePins([newPin('worship', [])], cam, placed, 400, 200)[0].sr).toBe(0);
  });
});
