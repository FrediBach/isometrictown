import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defaultsAt, fromSlider, IMAGE_DEFAULTS, isDefault, loadSettings, minutes, persist, selectPicture, slug, toImageMode, toSlider } from '@/app/model';
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
  test('humanize round-trips and clamps invalid saved values', () => {
    expect(share({ ...base(), humanize: 0.73 }).humanize).toBe(0.73);
    loc.hash = '#47/9/35/1000/1/Mollis/humanize=4';
    expect(loadSettings().humanize).toBe(1);
    loc.hash = '#47/9/35/1000/1/Mollis/humanize=-1';
    expect(loadSettings().humanize).toBe(0);
  });

  test('automatic and manual sun settings round-trip, including a retained manual angle', () => {
    for (const autoSun of [false, true]) {
      const set = { ...base(), autoSun, sunAngle: 123 };
      expect(share(set)).toEqual(set);
    }
  });

  test('older custom sun directions keep manual lighting', () => {
    loc.hash = '#47/9/35/1000/1/Mollis/sunAngle=123';
    expect(loadSettings()).toMatchObject({ autoSun: false, sunAngle: 123 });
    loc.hash = '';
    store.set('isometrictown:settings', JSON.stringify({ sunAngle: 123 }));
    expect(loadSettings()).toMatchObject({ autoSun: false, sunAngle: 123 });
    store.set('isometrictown:settings', JSON.stringify({ sunAngle: 55 }));
    expect(loadSettings().autoSun).toBe(true);
  });

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

  test('a broken percent escape in the place name does not throw', () => {
    loc.hash = '#47/9/0/1000/1/%E0%A4%A/';
    expect(loadSettings().place).toBe('%E0%A4%A');
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

describe('image mode', () => {
  const image = (): Settings => ({ ...base(), source: 'image', image: '0123456789abcdef', imageName: 'Harbour at dusk', imageFit: 'fit', imageFocus: [0.25, 0.8], imageLight: -0.3, imageContrast: 1.4, imageColour: 0.2, imageRelief: 0.65, imageDensity: 0.4, imageHatching: 0.25, imageContours: 0.8, imagePreserveSpace: true, imageHighlight: 0.87, likeness: 0.9, fabric: 'grid' });

  test('every image setting survives a share link, and the map place stays', () => {
    const set = { ...image(), center: [4.89, 52.37] as [number, number], place: 'Amsterdam' };
    expect(share(set)).toEqual(set);
  });

  test('supplying the file for a shared image keeps its title and crop', () => {
    const set = share({ ...image(), imageFit: 'fill' });
    expect(selectPicture(set, { id: set.image, name: 'Original filename' })).toEqual(set);
    expect(selectPicture(set, { id: 'fedcba9876543210', name: 'Another picture' })).toEqual({
      ...set, image: 'fedcba9876543210', imageName: 'Another picture', imageFocus: [0.5, 0.5],
    });
  });

  test('bad image settings in a link are dropped or mended', () => {
    loc.hash = '#47/9/35/1000/1/Mollis/source=photo&image=../../etc&imageFit=stretch&fabric=maze&imageFocus=2,-1&imageLight=9&imageContrast=0&imageColour=x&imageRelief=1.8&imageDensity=-1&imageHatching=none&imageContours=2&imageHighlight=-3&likeness=-3';
    const s = loadSettings();
    expect(s).toMatchObject({ source: 'map', image: '', imageFit: 'fill', fabric: 'auto', imageFocus: [1, 0], imageLight: 1, imageContrast: 0.5, imageColour: 0.7, imageRelief: 1, imageDensity: 0, imageHatching: 0, imageContours: 1, imageHighlight: 0, likeness: 0 });
  });

  test('opening an older image link restores the original image controls', () => {
    persist(image());
    loc.hash = '#47/9/35/2500/1/Mollis/source=image&image=0123456789abcdef';
    expect(loadSettings()).toMatchObject({ imageRelief: 0, imageDensity: 0, imageHatching: 0, imageContours: 0, imagePreserveSpace: false, imageHighlight: 1 });
  });

  test('switching to image mode sets its defaults only where nothing was changed', () => {
    expect(toImageMode(base())).toMatchObject({ source: 'image', ...IMAGE_DEFAULTS });
    const mine = toImageMode({ ...base(), scale: 1600, power: true });
    expect(mine).toMatchObject({ source: 'image', scale: 1600, tilt: IMAGE_DEFAULTS.tilt });
    // power was already on by default, so the user's "on" can't be told from it: image mode turns it off.
    expect(mine.power).toBe(false);
  });

  test('resetting in image mode keeps the image and image mode', () => {
    const set = { ...image(), trees: 0.1, scale: 4000 };
    const d = defaultsAt(set);
    expect(d).toMatchObject({ source: 'image', image: set.image, imageName: set.imageName, trees: DEFAULT_SETTINGS.trees, ...IMAGE_DEFAULTS });
    expect(isDefault(d)).toBe(true);
    expect(isDefault(set)).toBe(false);
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
