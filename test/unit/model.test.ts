import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defaultsAt, fromSlider, isDefault, loadSettings, minutes, persist, slug, toSlider } from '@/app/model';
import { PALETTES } from '@/palettes';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';

// The browser bits model.ts reads and writes: storage, the address bar and history.
let store: Map<string, string>;
const loc = { hash: '' };

beforeEach(() => {
  store = new Map();
  loc.hash = '';
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal('location', loc);
  vi.stubGlobal('history', { replaceState: (_s: unknown, _t: string, url: string) => void (loc.hash = url) });
});

const base = (): Settings => structuredClone(DEFAULT_SETTINGS);

/** Persist in one browser, then open the link in another with nothing saved. */
function share(set: Settings): Settings {
  persist(set);
  const link = loc.hash;
  store.clear();
  loc.hash = link;
  return loadSettings();
}

describe('share links', () => {
  test('defaults travel as a short link', () => {
    persist(base());
    expect(loc.hash).toBe('#47.09340/9.07440/35/1000/1/Mollis/');
    expect(share(base())).toEqual(base());
  });

  test('every kind of setting survives a round trip', () => {
    const set: Settings = {
      ...base(),
      center: [4.8862, 52.3727],
      place: 'Amsterdam / Centrum & Jordaan',
      bearing: 300,
      scale: 2500,
      seed: 42,
      tilt: 41,
      detail: 1.25,
      sheet: 'a2',
      landscape: false,
      style: 'dutch',
      osmTags: false,
      trees: 0.3,
      title: true,
      titleText: 'Ünïcode, commas; colons: & = signs',
      pens: [...PALETTES[3].pens],
      customLayerPens: true,
      layerPens: { trees: 4, water: 0 },
      customLayerDetail: true,
      layerDetail: { windows: 2, trees: 0.5 },
      customBackground: true,
      background: '#123abc',
      seedLocks: { '12,-34': 7, '-5,6': 99 },
      penWidth: 0.5,
    };
    expect(share(set)).toEqual(set);
  });

  test('a full link resets settings it leaves out, rather than keeping this browser’s', () => {
    persist({ ...base(), trees: 0.1, shadows: false });
    const mine = loc.hash;
    const theirs = { ...base(), cars: 0.9 };
    persist(theirs);
    const link = loc.hash;
    store.set('isometrictown:settings', JSON.stringify({ ...base(), trees: 0.1, shadows: false }));
    loc.hash = link;
    expect(mine).not.toBe(link);
    expect(loadSettings()).toEqual(theirs);
  });

  test('an old short link (no query part) keeps this browser’s settings', () => {
    store.set('isometrictown:settings', JSON.stringify({ ...base(), trees: 0.1 }));
    loc.hash = '#52.37270/4.88620/90/2000/3/Amsterdam';
    const s = loadSettings();
    expect(s.trees).toBe(0.1);
    expect(s.center).toEqual([4.8862, 52.3727]);
    expect([s.bearing, s.scale, s.seed, s.place]).toEqual([90, 2000, 3, 'Amsterdam']);
  });

  test('bad values in a link are dropped or mended', () => {
    loc.hash = '#47/9/-90/100/0/X/sheet=b9&style=martian&detail=-1&pens=zz,yy&background=nothex&layerPens=trees:9,nope:1&layerDetail=trees:50&seedLocks=a,b:1;1,2:-3;3,4:5&windows=maybe&tilt=abc&bogus=1';
    const s = loadSettings();
    expect(s.bearing).toBe(270);
    expect(s.scale).toBe(DEFAULT_SETTINGS.scale);
    expect(s.seed).toBe(DEFAULT_SETTINGS.seed);
    expect(s.sheet).toBe('a3');
    expect(s.style).toBe('auto');
    expect(s.detail).toBe(DEFAULT_SETTINGS.detail);
    expect(s.pens).toEqual(DEFAULT_SETTINGS.pens);
    expect(s.background).toBe(DEFAULT_SETTINGS.background);
    expect(s.layerPens).toEqual({});
    expect(s.layerDetail).toEqual({});
    expect(s.seedLocks).toEqual({ '3,4': 5 });
    expect(s.windows).toBe(DEFAULT_SETTINGS.windows);
    expect(s.tilt).toBe(DEFAULT_SETTINGS.tilt);
    expect('bogus' in s).toBe(false);
  });

  // Known bug: the place name is decoded without a guard, so a truncated link stops the app
  // loading. Flip to `test` once loadSettings() catches it.
  test.fails('a broken percent escape in the place name does not throw', () => {
    loc.hash = '#47/9/0/1000/1/%E0%A4%A/';
    expect(() => loadSettings()).not.toThrow();
  });

  test('a broken percent escape in a setting is ignored', () => {
    loc.hash = '#47/9/0/1000/1/X/titleText=%E0%A4%A';
    expect(loadSettings().titleText).toBe('');
  });

  test('garbage in storage falls back to defaults', () => {
    store.set('isometrictown:settings', '{not json');
    expect(loadSettings()).toEqual(base());
  });
});

describe('pen migration', () => {
  test('a saved four-pen preset becomes that preset', () => {
    const p = PALETTES[1].pens;
    store.set('isometrictown:settings', JSON.stringify({ pens: [p[0], p[2], p[3], p[4]] }));
    expect(loadSettings().pens).toEqual(p);
  });

  test('any other four-pen set keeps its look, the first pen drawing shadows and water', () => {
    store.set('isometrictown:settings', JSON.stringify({ pens: ['#111111', '#222222', '#333333', '#444444'] }));
    expect(loadSettings().pens).toEqual(['#111111', '#111111', '#222222', '#333333', '#444444']);
  });
});

describe('helpers', () => {
  test('isDefault and defaultsAt', () => {
    expect(isDefault(base())).toBe(true);
    expect(isDefault({ ...base(), center: [0, 0], place: 'Elsewhere' })).toBe(true);
    expect(isDefault({ ...base(), seed: 2 })).toBe(false);
    expect(isDefault({ ...base(), trees: 0 })).toBe(false);
    const d = defaultsAt({ ...base(), center: [1, 2], place: 'P', trees: 0 });
    expect(d).toEqual({ ...base(), center: [1, 2], place: 'P' });
  });

  test('the scale slider round trips to tidy scales', () => {
    expect(fromSlider(0)).toBe(400);
    expect(fromSlider(1000)).toBe(12000);
    let last = 0;
    for (let v = 0; v <= 1000; v += 25) {
      const s = fromSlider(v);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
      // Scales round to 25, 50 or 250, which near 1:12000 is about 15 slider units a step.
      expect(Math.abs(toSlider(s) - v)).toBeLessThanOrEqual(8);
    }
  });

  test('minutes and slug', () => {
    expect(minutes(59)).toBe('1 min');
    expect(minutes(3 * 3600 + 5 * 60)).toBe('3 h 5 min');
    expect(slug('Nördlingen am Ries!')).toBe('nordlingen-am-ries');
    expect(slug('東京')).toBe('town');
  });
});
