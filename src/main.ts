import { Camera } from './camera';
import { Frame, type LngLat } from './geo';
import { createLocator } from './locator';
import type { PlotStats } from './plot';
import type { Counts } from './render';
import { matchCities, searchPlaces, suggestPlaces, type Place } from './search';
import { DEFAULT_SETTINGS, PEN_NAMES, PEN_ROLES, SHEETS, sheetSize, type Settings, type SheetId } from './settings';
import type { Job, Reply } from './worker';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const STORE = 'isometrictown:settings';

type Preset = { name: string; center: LngLat; bearing: number; scale: number };
const PRESETS: Preset[] = [
  { name: 'Amsterdam', center: [4.8862, 52.3727], bearing: 35, scale: 1000 },
  { name: 'Bern', center: [7.4513, 46.948], bearing: 20, scale: 1000 },
  { name: 'Dubrovnik', center: [18.1095, 42.6405], bearing: 30, scale: 900 },
  { name: 'Lower Manhattan', center: [-74.0105, 40.7075], bearing: 29, scale: 2000 },
  { name: 'Venice', center: [12.3358, 45.4375], bearing: 40, scale: 1000 },
  { name: 'Hallstatt', center: [13.6493, 47.5617], bearing: 300, scale: 800 },
  { name: 'Lisbon', center: [-9.1385, 38.711], bearing: 15, scale: 1100 },
  { name: 'Kyoto', center: [135.7795, 34.9985], bearing: 45, scale: 1000 },
];

// ---------- settings ----------

function loadSettings(): Settings {
  let s: Settings = { ...DEFAULT_SETTINGS, pens: [...DEFAULT_SETTINGS.pens] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (saved && typeof saved === 'object') s = { ...s, ...saved };
  } catch {
    /* storage can be unavailable */
  }
  const parts = location.hash.slice(1).split('/');
  const h = parts.slice(0, 5).map(Number);
  if (h.length >= 2 && h.every((v) => Number.isFinite(v))) {
    s.center = [h[1], h[0]];
    if (h.length >= 3) s.bearing = ((h[2] % 360) + 360) % 360;
    if (h.length >= 4 && h[3] >= 300) s.scale = h[3];
    if (h.length >= 5 && h[4] > 0) s.seed = Math.round(h[4]);
    s.place = decodeURIComponent(parts[5] ?? '') || 'Somewhere';
  }
  if (!SHEETS[s.sheet]) s.sheet = 'a3';
  return s;
}

const set = loadSettings();

function persist(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(set));
  } catch {
    /* ignore */
  }
  const [lng, lat] = set.center;
  const hash = `#${lat.toFixed(5)}/${lng.toFixed(5)}/${Math.round(set.bearing)}/${Math.round(set.scale)}/${set.seed}/${encodeURIComponent(set.place)}`;
  history.replaceState(null, '', hash);
}

// Scale slider is logarithmic between 1:400 and 1:12000.
const SCALE_MIN = 400;
const SCALE_MAX = 12000;
const toSlider = (scale: number) => Math.round((Math.log(scale / SCALE_MIN) / Math.log(SCALE_MAX / SCALE_MIN)) * 1000);
const fromSlider = (v: number) => {
  const raw = SCALE_MIN * (SCALE_MAX / SCALE_MIN) ** (v / 1000);
  const step = raw < 1000 ? 25 : raw < 5000 ? 50 : 250;
  return Math.round(raw / step) * step;
};

const FORMAT: Partial<Record<keyof Settings, (v: number) => string>> = {
  bearing: (v) => `${Math.round(v)}°`,
  tilt: (v) => `${Math.round(v)}°`,
  scale: (v) => `1:${Math.round(v).toLocaleString('en')}`,
  heightScale: (v) => `${v.toFixed(2)}×`,
  pitched: (v) => v.toFixed(2),
  trees: (v) => v.toFixed(2),
  cars: (v) => v.toFixed(2),
  sunAngle: (v) => `${Math.round(v)}°`,
  sunHeight: (v) => `${Math.round(v)}°`,
  margin: (v) => `${Math.round(v)} mm`,
  penWidth: (v) => `${v.toFixed(2)} mm`,
  speed: (v) => `${Math.round(v)} mm/s`,
};

const sheetSelect = $<HTMLSelectElement>('#sheet-select');
for (const [id, s] of Object.entries(SHEETS)) sheetSelect.add(new Option(`${s.label} (${s.size[0]} × ${s.size[1]})`, id));

const controls = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')];

function showControls(): void {
  for (const el of controls) {
    const key = el.dataset.key as keyof Settings;
    const value = set[key];
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!value;
    else if (key === 'scale') el.value = String(toSlider(set.scale));
    else el.value = String(value);
    const out = document.querySelector<HTMLOutputElement>(`[data-out="${key}"]`);
    if (out) out.textContent = FORMAT[key]?.(Number(value)) ?? String(value);
  }
  $<HTMLInputElement>('#seed').value = String(set.seed);
  showFacts();
}

function readControl(el: HTMLInputElement | HTMLSelectElement): void {
  const key = el.dataset.key as keyof Settings;
  const s = set as Record<string, unknown>;
  if (el instanceof HTMLInputElement && el.type === 'checkbox') s[key] = el.checked;
  else if (key === 'scale') set.scale = fromSlider(Number(el.value));
  else if (key === 'landscape') set.landscape = el.value === 'true';
  else if (key === 'sheet') set.sheet = el.value as SheetId;
  else s[key] = Number(el.value);
}

const viewKeys = new Set(['bearing', 'tilt', 'scale', 'sheet', 'landscape', 'margin']);
for (const el of controls) {
  const live = el instanceof HTMLInputElement && el.type === 'range';
  el.addEventListener(live ? 'input' : 'change', () => {
    readControl(el);
    showControls();
    const key = el.dataset.key!;
    if (key === 'bearing') locator.setView(set.center, set.bearing);
    if (viewKeys.has(key)) updateFootprint(key === 'scale' || key === 'sheet' || key === 'landscape' || key === 'tilt');
    schedule(live ? 220 : 0);
  });
}

function showFacts(): void {
  $('#fact-place').textContent = set.place;
  const [w, h] = sheetSize(set);
  $('#fact-sheet').textContent = `${SHEETS[set.sheet].label} ${set.landscape ? 'landscape' : 'portrait'}`;
  $('#fact-sheet').title = `${w} × ${h} mm`;
  $('#fact-scale').textContent = `1:${Math.round(set.scale).toLocaleString('en')}`;
  const dots = $('#fact-pens');
  dots.replaceChildren(
    ...(set.mono ? ['#1b1e23'] : set.pens).map((c) => {
      const d = document.createElement('span');
      d.className = 'dot';
      d.style.background = c;
      return d;
    }),
  );
}

// ---------- pens ----------

const penList = $('#pen-list');
set.pens.forEach((color, i) => {
  const row = document.createElement('label');
  row.className = 'pen';
  row.innerHTML = `<input type="color" value="${color}" aria-label="${PEN_NAMES[i]} pen colour"><span><b>${i + 1} ${PEN_NAMES[i]}</b><small>${PEN_ROLES[i]}</small></span>`;
  const input = row.querySelector('input')!;
  input.addEventListener('input', () => {
    set.pens[i] = input.value;
    showFacts();
    recolor();
  });
  input.addEventListener('change', () => schedule(0));
  penList.append(row);
});

/** Pen colours change without redrawing: just restyle the preview layers. */
function recolor(): void {
  const svg = $('#sheet').querySelector('svg');
  if (!svg || set.mono) return;
  set.pens.forEach((c, i) => svg.querySelector<SVGGElement>(`#pen-${i + 1}`)?.setAttribute('stroke', c));
}

// ---------- seed ----------

$<HTMLInputElement>('#seed').addEventListener('change', (e) => {
  const v = Math.round(Number((e.target as HTMLInputElement).value));
  set.seed = Number.isFinite(v) && v > 0 ? v : 1;
  showControls();
  schedule(0);
});
$('#shuffle').addEventListener('click', () => {
  set.seed = 1 + Math.floor(Math.random() * 99999);
  showControls();
  schedule(0);
});

// ---------- locator ----------

const locator = createLocator($('#locator'), set.center, set.bearing, (center, bearing) => {
  const b = ((Math.round(bearing) % 360) + 360) % 360;
  const moved = Math.abs(center[0] - set.center[0]) + Math.abs(center[1] - set.center[1]) > 1e-6;
  if (!moved && b === Math.round(set.bearing)) return;
  set.center = center;
  set.bearing = ((Math.round(bearing) % 360) + 360) % 360;
  showControls();
  updateFootprint(false);
  schedule(0);
});

function footprintLngLat(): LngLat[] {
  const cam = new Camera(set);
  const frame = new Frame(set.center);
  return cam.footprint().map(([x, y]) => frame.toLngLat(x, y));
}

function updateFootprint(refit: boolean): void {
  const corners = footprintLngLat();
  locator.setFootprint(corners);
  if (refit) locator.fit(corners, set.bearing);
}

locator.map.on('load', () => updateFootprint(true));

function goTo(center: LngLat, name: string, extra: Partial<Settings> = {}): void {
  set.center = center;
  set.place = name;
  Object.assign(set, extra);
  locator.setView(set.center, set.bearing);
  showControls();
  updateFootprint(true);
  schedule(0);
}

const tryBox = $('#try');
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = p.name;
  b.addEventListener('click', () => goTo(p.center, p.name, { bearing: p.bearing, scale: p.scale }));
  tryBox.append(b);
}

// ---------- search ----------

const form = $<HTMLFormElement>('#search-form');
const input = $<HTMLInputElement>('#search');
const list = $<HTMLUListElement>('#suggestions');
const searchStatus = $('#search-status');
let suggestTimer = 0;
let suggestAbort: AbortController | null = null;
let shown: Place[] = [];
let active = -1;

function shortName(p: Place): string {
  return p.name || p.label.split(',')[0];
}

function pick(p: Place): void {
  list.hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.value = '';
  searchStatus.textContent = '';
  goTo(p.center, shortName(p));
}

function showSuggestions(places: Place[]): void {
  shown = places;
  active = -1;
  list.replaceChildren(
    ...places.map((p, i) => {
      const li = document.createElement('li');
      li.role = 'option';
      li.id = `sugg-${i}`;
      li.innerHTML = `<b></b><small></small>`;
      li.querySelector('b')!.textContent = shortName(p);
      li.querySelector('small')!.textContent = p.label;
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(p);
      });
      return li;
    }),
  );
  list.hidden = !places.length;
  input.setAttribute('aria-expanded', String(!list.hidden));
}

input.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  const q = input.value.trim();
  if (q.length < 2) {
    showSuggestions([]);
    return;
  }
  suggestTimer = window.setTimeout(async () => {
    suggestAbort?.abort();
    suggestAbort = new AbortController();
    const local = await matchCities(q, 3);
    showSuggestions(local);
    try {
      const remote = await suggestPlaces(q, suggestAbort.signal);
      showSuggestions([...local, ...remote].slice(0, 7));
    } catch {
      /* keep the local matches */
    }
  }, 180);
});

input.addEventListener('keydown', (e) => {
  if (list.hidden || !shown.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
    [...list.children].forEach((li, i) => li.classList.toggle('active', i === active));
    input.setAttribute('aria-activedescendant', `sugg-${active}`);
  } else if (e.key === 'Escape') {
    list.hidden = true;
  }
});
input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 120));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (active >= 0 && shown[active]) return pick(shown[active]);
  const q = input.value.trim();
  if (!q) return;
  searchStatus.textContent = 'Searching...';
  try {
    const found = await searchPlaces(q);
    if (found.length) pick(found[0]);
    else searchStatus.textContent = `Nothing found for "${q}".`;
  } catch {
    searchStatus.textContent = 'Search is not reachable right now.';
  }
});

// ---------- rendering ----------

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const status = $('#status');
const sheetBox = $('#sheet');
const viewport = $('#viewport');
const downloadButton = $<HTMLButtonElement>('#download');
let jobId = 0;
let busy = false;
let queued = false;
let timer = 0;
let lastSvg = '';
let lastSheet: [number, number] = sheetSize(set);
const started = new Map<number, number>();

function schedule(delay: number): void {
  persist();
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    queued = true;
    dispatch();
  }, delay);
}

function dispatch(): void {
  if (busy || !queued) return;
  queued = false;
  busy = true;
  const id = ++jobId;
  started.set(id, performance.now());
  status.textContent = 'Drawing';
  status.classList.add('working');
  const job: Job = { id, set: JSON.parse(JSON.stringify(set)) };
  worker.postMessage(job);
}

worker.onmessage = (e: MessageEvent<Reply>) => {
  const r = e.data;
  if (r.kind === 'progress') {
    status.textContent = r.text;
    return;
  }
  busy = false;
  if (r.kind === 'error') {
    status.classList.remove('working');
    status.textContent = r.text;
    status.classList.add('error');
  } else {
    status.classList.remove('working', 'error');
    status.textContent = '';
    lastSvg = r.svg;
    lastSheet = sheetSize(set);
    sheetBox.innerHTML = r.svg.replace(/^<\?xml[^>]*>\s*/, '');
    downloadButton.disabled = false;
    layoutSheet();
    showStats(r.stats, r.counts, r.ms);
  }
  dispatch();
};

worker.onerror = () => {
  busy = false;
  status.textContent = 'The drawing failed. Try another place or setting.';
  status.classList.add('error');
};

function layoutSheet(): void {
  const [w, h] = lastSheet;
  const zoom = $<HTMLSelectElement>('#zoom').value;
  const pxPerMm = 96 / 25.4;
  let scale: number;
  if (zoom === 'fit') {
    const pad = 48;
    scale = Math.min((viewport.clientWidth - pad) / w, (viewport.clientHeight - pad) / h);
  } else scale = Number(zoom) * pxPerMm;
  sheetBox.style.width = `${w * scale}px`;
  sheetBox.style.height = `${h * scale}px`;
  viewport.classList.toggle('scrolls', zoom !== 'fit');
}

$('#zoom').addEventListener('change', layoutSheet);
new ResizeObserver(layoutSheet).observe(viewport);

function minutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const metres = (mm: number) => `${(mm / 1000).toFixed(1)} m`;
const num = (n: number) => n.toLocaleString('en');

function showStats(stats: PlotStats, counts: Counts, ms: number): void {
  const rows = stats.pens
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.lifts > 0)
    .map(
      ({ p, i }) =>
        `<tr><td><span class="dot" style="background:${set.mono ? '#1b1e23' : p.color}"></span>${set.mono ? 'Black' : `${i + 1} ${p.name}`}</td><td>${metres(p.ink)}</td><td>${num(p.lifts)}</td><td>${minutes(p.seconds)}</td></tr>`,
    );
  $('#pen-rows').innerHTML = rows.join('');
  $('#pen-total').innerHTML = `<tr><td>All pens</td><td>${metres(stats.ink)}</td><td>${num(stats.lifts)}</td><td>${minutes(stats.seconds)}</td></tr>`;
  const scene = [`${num(counts.buildings)} buildings`, counts.houses ? `${num(counts.houses)} with pitched roofs` : '', `${num(counts.trees)} trees`, counts.cars ? `${num(counts.cars)} cars` : '', counts.lamps ? `${num(counts.lamps)} lamps` : '']
    .filter(Boolean)
    .join(', ');
  $('#summary').innerHTML = `
    <div><dt>Pen travel</dt><dd>${metres(stats.rawTravel)} → ${metres(stats.travel)} after sorting</dd></div>
    <div><dt>Pen lifts</dt><dd>${num(stats.rawLifts)} → ${num(stats.lifts)} after joining</dd></div>
    <div><dt>Scene</dt><dd>${scene}</dd></div>
    <div><dt>Drawn in</dt><dd>${(ms / 1000).toFixed(1)} s</dd></div>`;
  $('#footnote').textContent = `Times are estimates at ${set.speed} mm/s drawing, twice that for pen-up moves, plus 0.3 s per pen lift. Plot the pens top to bottom.`;
}

function slug(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'town'
  );
}

downloadButton.addEventListener('click', () => {
  if (!lastSvg) return;
  const url = URL.createObjectURL(new Blob([lastSvg], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `isometric-town-${slug(set.place)}-${set.seed}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ---------- about ----------

const about = $<HTMLDialogElement>('#about');
$('#about-open').addEventListener('click', () => about.showModal());
about.addEventListener('click', (e) => {
  if (e.target === about) about.close();
});

showControls();
updateFootprint(false);
schedule(0);
