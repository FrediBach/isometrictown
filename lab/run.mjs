#!/usr/bin/env node
/**
 * LOD lab runner. Draws the test places at a run of scales with the real renderer, scores what
 * a plotter wastes on each feature, and writes SVGs, PNG close-ups at true pen width and an
 * HTML report to lab/out/<name>/.
 *
 *   npm run lod                                   all places, all scales
 *   npm run lod -- --places mollis,amsterdam --scales 1000,4000
 *   npm run lod -- --name before                  keep a run under a name
 *   npm run lod -- --name after --compare before  print what changed
 *   npm run lod -- --detail 1.5 --pen 0.5         other Detail or pen width
 *   npm run lod -- --no-png                       numbers only, faster
 *
 * Downloads are cached on disk in lab/.cache, so reruns don't touch the network.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, createServerModuleRunner } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Arguments
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const name = opt('name', 'latest');
const outDir = path.join(here, 'out', name);
const png = !flag('no-png');
const detail = Number(opt('detail', '1'));
const penWidth = Number(opt('pen', '0.35'));
const tags = flag('tags');
const compare = opt('compare', null);

// Downloads, cached on disk and a few at a time.
const cacheDir = path.join(here, '.cache');
mkdirSync(cacheDir, { recursive: true });
const realFetch = globalThis.fetch;
let active = 0;
const waiting = [];
const slot = () => (active < 4 ? (active++, Promise.resolve()) : new Promise((r) => waiting.push(r)).then(() => active++));
const free = () => {
  active--;
  waiting.shift()?.();
};
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : '';
  const key = createHash('sha1').update(`${init.method ?? 'GET'} ${url} ${body}`).digest('hex');
  const file = path.join(cacheDir, key);
  if (existsSync(`${file}.json`)) {
    const meta = JSON.parse(readFileSync(`${file}.json`, 'utf8'));
    return new Response(meta.status === 204 ? null : readFileSync(file), { status: meta.status, headers: meta.headers });
  }
  await slot();
  try {
    const r = await realFetch(input, { ...init, headers: { ...(init.headers ?? {}), 'User-Agent': 'isometrictown-lod-lab' } });
    const buf = Buffer.from(await r.arrayBuffer());
    const headers = { 'content-type': r.headers.get('content-type') ?? '' };
    if (r.ok || r.status === 204 || r.status === 404) {
      writeFileSync(file, buf);
      writeFileSync(`${file}.json`, JSON.stringify({ status: r.status, headers }));
    }
    return new Response(r.status === 204 ? null : buf, { status: r.status, headers });
  } finally {
    free();
  }
};

// A module runner that stays open, since the renderer loads the country lookup on demand.
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, resolve: { alias: { '@': path.join(root, 'src') } } });
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
const lab = await runner.import(path.join(here, 'lab.ts'));

const pick = opt('places', null);
const places = pick ? pick.split(',').map((id) => lab.PLACES.find((p) => p.id === id) ?? die(`No place "${id}". Try: ${lab.PLACES.map((p) => p.id).join(', ')}`)) : lab.PLACES;
const scales = opt('scales', null)?.split(',').map(Number) ?? lab.SCALES;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const report = { name, detail, penWidth, tags, at: new Date().toISOString(), cases: [] };
const fmt = (v, d = 0) => v.toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (v) => `${fmt(v * 100, 1)}%`;

console.log(`LOD lab "${name}": ${places.length} places × ${scales.length} scales, Detail ${detail}, pen ${penWidth} mm\n`);
for (const place of places) {
  for (const scale of scales) {
    const label = `${place.id} 1:${scale}`.padEnd(24);
    try {
      const r = await lab.runCase(place, scale, { detail, penWidth, tags });
      const file = `${place.id}-${scale}`;
      writeFileSync(path.join(outDir, `${file}.svg`), r.svg);
      const t = r.stats.total;
      const worst = Object.entries(r.stats.layers)
        .filter(([, s]) => s.seconds > t.seconds * 0.01)
        .sort((a, b) => b[1].waste * b[1].seconds - a[1].waste * a[1].seconds)
        .slice(0, 3)
        .map(([k, s]) => `${k} ${pct(s.waste)}`)
        .join(', ');
      console.log(`${label} ${fmt(t.strokes).padStart(8)} strokes ${fmt(t.ink / 1000, 1).padStart(7)} m ${fmt(t.seconds / 60, 1).padStart(6)} min  waste ${pct(t.waste).padStart(6)}  solid ${pct(r.stats.solid).padStart(6)}  ${fmt(r.ms)} ms  worst: ${worst}`);
      const { marks, ...stats } = r.stats;
      if (png) writeFileSync(path.join(outDir, `${file}-waste.svg`), wasteSvg(r.svg, marks, penWidth));
      report.cases.push({ place: place.id, name: place.name, kind: place.kind, scale, file, ms: r.ms, rect: r.rect, stats });
    } catch (e) {
      console.log(`${label} failed: ${e instanceof Error ? e.message : e}`);
      report.cases.push({ place: place.id, name: place.name, kind: place.kind, scale, error: String(e) });
    }
  }
}
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));

// Close-ups: the whole sheet small, then the busiest window and the centre at true size and pen width.
if (png) {
  let browser = null;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  } catch (e) {
    console.log(`\nPNGs skipped: no browser (${e instanceof Error ? e.message.split('\n')[0] : e})`);
  }
  if (browser) {
    const page = await browser.newPage();
    const shot = async (svg, vb, pxPerMm, out) => {
      const [x, y, w, h] = vb;
      const cut = svg.replace(/width="[^"]*mm" height="[^"]*mm" viewBox="[^"]*"/, `width="${w * pxPerMm}" height="${h * pxPerMm}" viewBox="${x} ${y} ${w} ${h}"`);
      await page.setViewportSize({ width: Math.round(w * pxPerMm), height: Math.round(h * pxPerMm) });
      await page.setContent(`<html><body style="margin:0;background:#f2f1eb">${cut.replace(/^<\?xml[^>]*>/, '')}</body></html>`);
      await page.screenshot({ path: out });
    };
    for (const c of report.cases) {
      if (c.error) continue;
      const svg = readFileSync(path.join(outDir, `${c.file}.svg`), 'utf8');
      const [w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
      await shot(svg, [0, 0, w, h], 4, path.join(outDir, `${c.file}.png`));
      const [hx, hy] = c.stats.hot;
      await shot(svg, [hx - 15, hy - 10, 30, 20], 24, path.join(outDir, `${c.file}-hot.png`));
      const cx = (c.rect[0] + c.rect[2]) / 2;
      const cy = (c.rect[1] + c.rect[3]) / 2;
      await shot(svg, [cx - 15, cy - 10, 30, 20], 24, path.join(outDir, `${c.file}-mid.png`));
      const waste = readFileSync(path.join(outDir, `${c.file}-waste.svg`), 'utf8');
      await shot(waste, [hx - 15, hy - 10, 30, 20], 24, path.join(outDir, `${c.file}-waste.png`));
    }
    await browser.close();
  }
}

const rules = Object.entries(lab.LOD).map(([id, r]) => ({ id, ...r, from: lab.coarsest(r, detail, penWidth) }));
writeFileSync(path.join(outDir, 'index.html'), html(report, png, rules));
console.log(`\nReport: ${path.join(outDir, 'index.html')}`);

await runner.close();
await server.close();

if (compare) {
  const file = path.join(here, 'out', compare, 'report.json');
  if (!existsSync(file)) die(`No run named "${compare}" in lab/out.`);
  const base = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`\nAgainst "${compare}":`);
  const delta = (a, b) => (b ? `${a >= b ? '+' : ''}${fmt(((a - b) / b) * 100, 0)}%` : 'new');
  for (const c of report.cases) {
    const b = base.cases.find((x) => x.place === c.place && x.scale === c.scale);
    if (!b?.stats || !c.stats) continue;
    const t = c.stats.total;
    const u = b.stats.total;
    const moved = Object.keys({ ...c.stats.layers, ...b.stats.layers })
      .map((k) => [k, (c.stats.layers[k]?.seconds ?? 0) - (b.stats.layers[k]?.seconds ?? 0)])
      .filter(([, d]) => Math.abs(d) > 5)
      .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
      .slice(0, 4)
      .map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${fmt(d / 60, 1)}m`)
      .join(', ');
    console.log(`${`${c.place} 1:${c.scale}`.padEnd(24)} time ${delta(t.seconds, u.seconds).padStart(5)}  strokes ${delta(t.strokes, u.strokes).padStart(5)}  waste ${pct(u.waste)} → ${pct(t.waste)}  ${moved}`);
  }
}

/** The drawing greyed out, with specks in magenta and solid 1 mm cells shaded red: where the waste is. */
function wasteSvg(svg, marks, nib) {
  const grey = svg.replace(/stroke="[^"]*"/g, 'stroke="#b9b7b0"');
  const f = (v) => Math.round(v * 100) / 100;
  let cells = '';
  for (let i = 0; i < marks.solid.length; i += 2) cells += `M${f(marks.solid[i])} ${f(marks.solid[i + 1])}h1v1h-1z`;
  const dots = marks.specks.map((l) => `M${l.map(f).reduce((d, v, i) => d + (i % 2 ? `${v}` : `${i ? 'L' : ''}${v} `), '')}`).join('');
  return grey.replace('</svg>', `<path d="${cells}" fill="#e0483e" fill-opacity="0.28"/><path d="${dots}" fill="none" stroke="#d01aa8" stroke-width="${nib}" stroke-linecap="round"/></svg>`);
}

/** The report page: per place, each feature's cost across the scales, then the pictures. */
function html(r, withPng, rules) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const byPlace = new Map();
  for (const c of r.cases) (byPlace.get(c.place) ?? byPlace.set(c.place, []).get(c.place)).push(c);
  const shade = (w) => (w >= 0.25 ? 'bad' : w >= 0.1 ? 'warn' : '');
  let body = '';
  for (const cases of byPlace.values()) {
    const ok = cases.filter((c) => c.stats);
    const layers = [...new Set(ok.flatMap((c) => Object.keys(c.stats.layers)))].sort((a, b) => Math.max(...ok.map((c) => c.stats.layers[b]?.seconds ?? 0)) - Math.max(...ok.map((c) => c.stats.layers[a]?.seconds ?? 0)));
    body += `<section><h2>${esc(cases[0].name)} <small>${esc(cases[0].kind)}</small></h2><div class="scroll"><table><thead><tr><th>Feature</th>${cases.map((c) => `<th>1:${c.scale}</th>`).join('')}</tr></thead><tbody>`;
    body += `<tr class="total"><td>All</td>${cases.map((c) => (c.stats ? `<td class="${shade(c.stats.total.waste)}">${fmt(c.stats.total.seconds / 60, 1)} min · ${fmt(c.stats.total.strokes)}<br><span>waste ${pct(c.stats.total.waste)} · solid ${pct(c.stats.solid)}</span></td>` : `<td class="bad">${esc(c.error)}</td>`)).join('')}</tr>`;
    for (const k of layers) {
      body += `<tr><td>${esc(k)}</td>${cases
        .map((c) => {
          const s = c.stats?.layers[k];
          if (!s) return '<td class="none">–</td>';
          return `<td class="${shade(s.waste)}">${fmt(s.seconds / 60, 1)} min · ${fmt(s.strokes)}<br><span>${fmt(s.ink / 1000, 1)} m · specks ${fmt(s.specks)} · waste ${pct(s.waste)}</span></td>`;
        })
        .join('')}</tr>`;
    }
    body += '</tbody></table></div>';
    if (withPng) {
      body += '<div class="shots">';
      for (const c of ok) body += `<figure><a href="${c.file}.svg"><img src="${c.file}.png" alt="${esc(c.name)} at 1:${c.scale}" loading="lazy"></a><div class="close"><img src="${c.file}-hot.png" alt="Busiest window" loading="lazy"><img src="${c.file}-mid.png" alt="Centre" loading="lazy"><img src="${c.file}-waste.png" alt="Waste in the busiest window" loading="lazy"></div><figcaption>1:${c.scale}: whole sheet; the busiest and the middle 30 × 20 mm at true pen width; the busiest again with specks in magenta and solid cells in red</figcaption></figure>`;
      body += '</div>';
    }
    body += '</section>';
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOD lab: ${esc(r.name)}</title><style>
:root{--bg:#f2f1eb;--fg:#1b1e23;--mute:#6b6e73;--line:#d9d7cf;--warn:#f4e3b5;--bad:#f2c4c0}
@media (prefers-color-scheme:dark){:root{--bg:#1b1e23;--fg:#ecebe6;--mute:#9a9da2;--line:#33363b;--warn:#5a4a1f;--bad:#5e2a27}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:13px/1.4 ui-monospace,Menlo,monospace}
h1{font-size:18px}h2{font-size:15px;margin:32px 0 8px}small,span,figcaption{color:var(--mute)}
.scroll{overflow-x:auto}table{border-collapse:collapse}td,th{border:1px solid var(--line);padding:4px 8px;text-align:right;white-space:nowrap;vertical-align:top}
td:first-child,th:first-child{text-align:left}.warn{background:var(--warn)}.bad{background:var(--bad)}.none{color:var(--mute)}.total td{font-weight:600}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;margin-top:12px}figure{margin:0}img{width:100%;display:block;border:1px solid var(--line);background:#f2f1eb}
.close{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-top:4px}
</style></head><body><h1>LOD lab: ${esc(r.name)}</h1><p>Detail ${r.detail}, pen ${r.penWidth} mm, OSM tags ${r.tags ? 'on' : 'off'}, ${esc(r.at)}. Each cell: plotting minutes · strokes, then ink, specks (strokes under two pen widths across) and waste (time on specks and on ink laid where the paper is already solid). Amber from 10% waste, red from 25%.</p>${body}${ruleTable(rules)}</body></html>`;
}

/** Every level-of-detail rule, with the coarsest scale a typical thing of its kind shows at in this run. */
function ruleTable(rules) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const round = (n) => (n >= 10000 ? Math.round(n / 1000) * 1000 : n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n / 10) * 10);
  const rows = rules
    .sort((a, b) => b.from - a.from)
    .map((x) => `<tr><td>${esc(x.id)}</td><td>${x.m} m</td><td>${x.mm} mm</td><td>1:${round(x.from).toLocaleString('en')}</td><td style="text-align:left;white-space:normal">${esc(x.what)}</td></tr>`)
    .join('');
  return `<section><h2>Level-of-detail rules <small>src/lod.ts</small></h2><p>A typical thing of each kind shows from the scale given and finer (it fades out over a band about twice as wide). Callers pass the actual size where they know it, so bigger ones last longer.</p><div class="scroll"><table><thead><tr><th>Rule</th><th>Typical</th><th>Min on paper</th><th>Drawn to</th><th>What</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
