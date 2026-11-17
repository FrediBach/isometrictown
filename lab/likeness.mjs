#!/usr/bin/env node
/**
 * Likeness lab runner. Draws towns from pictures at a run of scales with the real planner and
 * renderer, scores how like each picture the drawing is, and writes SVGs, PNGs and an HTML
 * report to lab/out/<name>/: per case the picture, what the drawing should look like, what it
 * does look like seen from arm's length, and the drawing itself.
 *
 *   npm run likeness                                   every picture at 1:1000–1:8000
 *   npm run likeness -- --images gradient,disc --scales 2500
 *   npm run likeness -- --name before                  keep a run under a name
 *   npm run likeness -- --name after --compare before  what changed, per picture and scale
 *   npm run likeness -- --likeness 0.2                 another Likeness
 *   npm run likeness -- --pens archive                 another palette
 *   npm run likeness -- --sheet a4                     another sheet (A3 by default)
 *   npm run likeness -- --no-png                       numbers only, faster
 *
 * Nothing is fetched: image mode uses no map data.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { createServer, createServerModuleRunner } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const name = opt('name', 'likeness');
const outDir = path.join(here, 'out', name);
const png = !flag('no-png');
const compare = opt('compare', null);
const options = {
  likeness: opt('likeness', null) === null ? undefined : Number(opt('likeness')),
  pens: opt('pens', undefined),
  sheet: opt('sheet', undefined),
  detail: opt('detail', null) === null ? undefined : Number(opt('detail')),
  penWidth: opt('pen', null) === null ? undefined : Number(opt('pen')),
};

// Image mode must never touch the network.
globalThis.fetch = async (input) => {
  throw new Error(`Image mode fetched ${typeof input === 'string' ? input : input.url}`);
};

const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, resolve: { alias: { '@': path.join(root, 'src') } } });
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
const lab = await runner.import(path.join(here, 'likeness.ts'));

const pick = opt('images', null);
const pictures = pick ? pick.split(',') : Object.keys(lab.PICTURES);
for (const p of pictures) if (!lab.PICTURES[p]) die(`No picture "${p}". Try: ${Object.keys(lab.PICTURES).join(', ')}`);
const scales = opt('scales', null)?.split(',').map(Number) ?? lab.SCALES;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

/** A minimal 8-bit RGB PNG. */
function encodePng({ w, h, data }) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(data.buffer, data.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(outDir, { recursive: true });
const report = { name, options, at: new Date().toISOString(), cases: [] };
const fmt = (v, d = 0) => v.toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (v) => `${fmt(v * 100, 1)}%`;

console.log(`Likeness lab "${name}": ${pictures.length} pictures × ${scales.length} scales\n`);
for (const picture of pictures) {
  for (const scale of scales) {
    const label = `${picture} 1:${scale}`.padEnd(22);
    try {
      const r = lab.runCase(picture, scale, options);
      const file = `${picture}-${scale}`;
      writeFileSync(path.join(outDir, `${file}.svg`), r.svg);
      if (png) {
        writeFileSync(path.join(outDir, `${file}-look.png`), encodePng(r.look));
        writeFileSync(path.join(outDir, `${file}-squint.png`), encodePng(r.squint));
        writeFileSync(path.join(outDir, `${picture}-source.png`), encodePng(r.source));
        writeFileSync(path.join(outDir, `${file}-edges.png`), encodePng(r.edges));
        writeFileSync(path.join(outDir, `${file}-zones.png`), encodePng(r.zones));
      }
      const l = r.likeness;
      const ms = Object.fromEntries(Object.entries(r.ms).map(([k, v]) => [k, Math.round(v)]));
      console.log(`${label} likeness ${fmt(l.score * 100, 1).padStart(6)}  ΔE ${fmt(l.dE[0], 3)} / ${fmt(l.dE[1], 3)}  SSIM ${fmt(l.ssim, 3)}  tone ${pct(r.stats.tone).padStart(6)}  waste ${pct(r.stats.total.waste).padStart(6)}  ${fmt(r.counts.buildings)} buildings  ${ms.total} ms (read ${ms.read}, zone ${ms.zone}, layout ${ms.layout}, render ${ms.render}, score ${ms.score})`);
      console.log(`${''.padEnd(22)} ${r.streets} streets, ${r.violations.length ? `rules broken: ${r.violations.slice(0, 3).join('; ')}` : 'rules kept'}`);
      console.log(`${''.padEnd(22)} zones ${Object.entries(r.shares).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 0.01).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')}`);
      const { marks, ...stats } = r.stats;
      report.cases.push({ picture, scale, file, rect: r.rect, likeness: l, ms, shares: r.shares, streets: r.streets, violations: r.violations, counts: r.counts, tone: stats.tone, solid: stats.solid, waste: stats.total.waste, minutes: stats.total.seconds / 60 });
    } catch (e) {
      console.log(`${label} failed: ${e instanceof Error ? e.stack : e}`);
      report.cases.push({ picture, scale, error: String(e) });
    }
  }
}
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));

// The drawings themselves, small, if there is a browser to draw them with.
if (png) {
  let browser = null;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  } catch (e) {
    console.log(`\nDrawing PNGs skipped: no browser (${e instanceof Error ? e.message.split('\n')[0] : e})`);
  }
  if (browser) {
    for (const c of report.cases) {
      if (c.error) continue;
      const svg = readFileSync(path.join(outDir, `${c.file}.svg`), 'utf8');
      const [x, y, x1, y1] = c.rect;
      const [w, h] = [x1 - x, y1 - y];
      const px = 3;
      const page = await browser.newPage();
      const cut = svg.replace(/width="[^"]*mm" height="[^"]*mm" viewBox="[^"]*"/, `width="${w * px}" height="${h * px}" viewBox="${x} ${y} ${w} ${h}"`);
      await page.setViewportSize({ width: Math.round(w * px), height: Math.round(h * px) });
      await page.setContent(`<html><body style="margin:0;background:#fff">${cut.replace(/^<\?xml[^>]*>/, '')}</body></html>`);
      await page.screenshot({ path: path.join(outDir, `${c.file}.png`) });
      await page.close();
    }
    await browser.close();
  }
}

writeFileSync(path.join(outDir, 'index.html'), html(report, png));
console.log(`\nReport: ${path.join(outDir, 'index.html')}`);

await runner.close();
await server.close();

if (compare) {
  const file = path.join(here, 'out', compare, 'report.json');
  if (!existsSync(file)) die(`No run named "${compare}" in lab/out.`);
  const base = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`\nAgainst "${compare}":`);
  for (const c of report.cases) {
    const b = base.cases.find((x) => x.picture === c.picture && x.scale === c.scale);
    if (!b?.likeness || !c.likeness) continue;
    const d = (c.likeness.score - b.likeness.score) * 100;
    console.log(`${`${c.picture} 1:${c.scale}`.padEnd(22)} likeness ${fmt(b.likeness.score * 100, 1)} → ${fmt(c.likeness.score * 100, 1)} (${d >= 0 ? '+' : ''}${fmt(d, 1)})  SSIM ${fmt(b.likeness.ssim, 3)} → ${fmt(c.likeness.ssim, 3)}  time ${b.ms.total} → ${c.ms.total} ms`);
  }
}

/** The report page: per picture, each scale's numbers and the picture, the look, the squint and the drawing side by side. */
function html(r, withPng) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const byPicture = new Map();
  for (const c of r.cases) (byPicture.get(c.picture) ?? byPicture.set(c.picture, []).get(c.picture)).push(c);
  let body = '';
  for (const [picture, cases] of byPicture) {
    body += `<section><h2>${esc(picture)}</h2>`;
    for (const c of cases) {
      if (c.error) {
        body += `<p class="bad">1:${c.scale}: ${esc(c.error)}</p>`;
        continue;
      }
      const l = c.likeness;
      body += `<h3>1:${c.scale} <small>likeness ${fmt(l.score * 100, 1)} · ΔE ${fmt(l.dE[0], 3)} / ${fmt(l.dE[1], 3)} · SSIM ${fmt(l.ssim, 3)} · tone ${pct(c.tone)} · waste ${pct(c.waste)} · ${fmt(c.counts.buildings)} buildings · ${c.streets} streets${c.violations.length ? ` · <span class="bad">${c.violations.length} street rules broken</span>` : ''} · ${fmt(c.minutes, 0)} min to plot · ${c.ms.total} ms</small></h3>`;
      if (withPng) body += `<div class="row"><figure><img src="${picture}-source.png" alt=""><figcaption>Picture</figcaption></figure><figure><img src="${c.file}-look.png" alt=""><figcaption>What it should look like</figcaption></figure><figure><img src="${c.file}-squint.png" alt=""><figcaption>What it looks like</figcaption></figure><figure><a href="${c.file}.svg"><img src="${c.file}.png" alt=""></a><figcaption>Drawing</figcaption></figure><figure><img src="${c.file}-edges.png" alt=""><figcaption>Edges (red), bright (yellow) and dark (blue) lines</figcaption></figure><figure><img src="${c.file}-zones.png" alt=""><figcaption>Zones: ${esc(Object.entries(c.shares).sort((a, b) => b[1] - a[1]).filter(([, v]) => v >= 0.02).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', '))}</figcaption></figure></div>`;
    }
    body += '</section>';
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Likeness lab: ${esc(r.name)}</title><style>
:root{--bg:#f2f1eb;--fg:#1b1e23;--mute:#6b6e73;--line:#d9d7cf;--bad:#c74728}
@media (prefers-color-scheme:dark){:root{--bg:#1b1e23;--fg:#ecebe6;--mute:#9a9da2;--line:#33363b}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:13px/1.4 ui-monospace,Menlo,monospace}
h1{font-size:18px}h2{font-size:15px;margin:32px 0 4px}h3{font-size:13px;margin:16px 0 6px}small,figcaption{color:var(--mute)}.bad{color:var(--bad)}
.row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}@media (max-width:700px){.row{grid-template-columns:repeat(2,minmax(0,1fr))}}
figure{margin:0}img{width:100%;display:block;border:1px solid var(--line);background:#fff;image-rendering:auto}
</style></head><body><h1>Likeness lab: ${esc(r.name)}</h1><p>${esc(JSON.stringify(r.options))}, ${esc(r.at)}. Likeness is 1 − mean ΔE (arm's length and across the room) over that of blank paper, as 0–100. "What it should look like" is the picture after the tone curve, in the range pens on paper can reach.</p>${body}</body></html>`;
}
