#!/usr/bin/env node
/**
 * Floorplan lab runner. Reads the footprints of the real places in lab/adjacency-places.ts,
 * learns the plans each image-mode zone builds and writes them for `src/image-floorplan-data.ts`.
 * A contact sheet of each zone's plans goes to lab/out/floorplans/plans.svg to check by eye.
 * See lab/floorplans.ts.
 *
 *   npm run floorplans                          every place, printing what each zone builds
 *   npm run floorplans -- --places bruges,plano some places only, without writing the table
 *   npm run floorplans -- --write               write src/image-floorplan-data.ts
 *
 * Downloads are cached on disk in lab/.cache, shared with the LOD and adjacency labs.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, createServerModuleRunner } from 'vite';
import './cached-fetch.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const only = opt('places', null)?.split(',');
const write = argv.includes('--write');
const outDir = path.join(here, 'out', 'floorplans');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, resolve: { alias: { '@': path.join(root, 'src') } } });
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
const lab = await runner.import(path.join(here, 'floorplans.ts'));
const { labelPlace } = await runner.import(path.join(here, 'adjacency.ts'));
const { BUILT, GRID } = lab;
/** Zones whose buildings stand in rows: their plans are learnt from houses with party walls both sides. */
const ROWS = new Set(['rows', 'old', 'blocks']);
/** Plans kept per zone, at most, and the share of the zone's weight they must cover. */
const KEEP = 40;
const COVER = 0.9;
/** A plan must be seen in this many places to be kept, so one town's habit isn't taken for a zone's. */
const PLACES = 3;

const places = lab.CORPUS.filter((p) => !only || only.includes(p.id));
/** Per zone: plan key → { ring, weight, places, sums for its size }. */
const tally = Object.fromEntries(BUILT.map((l) => [l, new Map()]));
const totals = Object.fromEntries(BUILT.map((l) => [l, { weight: 0, samples: 0, row: 0, all: 0, folded: 0 }]));
for (const place of places) {
  const t0 = performance.now();
  try {
    const { samples, seen } = lab.samplesOf(await labelPlace(place));
    // Each place counts the same within each zone, however many buildings it has.
    const byLabel = Object.fromEntries(BUILT.map((l) => [l, []]));
    for (const s of samples) {
      totals[s.label].all++;
      if (s.row) totals[s.label].row++;
      if (ROWS.has(s.label) !== s.row) continue;
      byLabel[s.label].push(s);
    }
    for (const l of BUILT) {
      const list = byLabel[l];
      if (!list.length) continue;
      const w = 1 / list.length;
      totals[l].weight += 1;
      for (const s of list) {
        const c = lab.canonical(s.ring);
        totals[l].samples++;
        if (!c) {
          totals[l].folded++;
          continue;
        }
        const map = tally[l];
        let e = map.get(c.key);
        if (!e) map.set(c.key, (e = { ring: c.ring, weight: 0, places: new Set(), n: 0, logAspect: 0, logAspect2: 0, logArea: 0, fill: 0 }));
        e.weight += w;
        e.places.add(place.id);
        e.n++;
        const la = Math.log(s.D / s.W);
        e.logAspect += la;
        e.logAspect2 += la * la;
        e.logArea += Math.log(s.W * s.D);
      }
    }
    console.log(`${place.id.padEnd(16)} ${String(Math.round(performance.now() - t0)).padStart(6)} ms  ${samples.length}/${seen} footprints made plans`);
  } catch (e) {
    console.log(`${place.id.padEnd(16)} failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** Each zone's kept plans, commonest first, with their share of the zone. */
const kept = {};
for (const l of BUILT) {
  const all = [...tally[l].values()].sort((a, b) => b.weight - a.weight);
  const W = all.reduce((s, e) => s + e.weight, 0) || 1;
  const list = [];
  let covered = 0;
  for (const e of all) {
    if (list.length >= KEEP || covered >= COVER) break;
    if (e.places.size < Math.min(PLACES, places.length)) continue;
    covered += e.weight / W;
    const mean = e.logAspect / e.n;
    list.push({
      ring: e.ring,
      share: e.weight / W,
      places: e.places.size,
      n: e.n,
      aspect: Math.exp(mean),
      spread: Math.sqrt(Math.max(0, e.logAspect2 / e.n - mean * mean)),
      area: Math.exp(e.logArea / e.n),
    });
  }
  // The plain box keeps its true share; the other plans kept stand in for the whole tail.
  const box = list.find((e) => e.ring.length === 8);
  const others = list.filter((e) => e !== box).reduce((s, e) => s + e.share, 0);
  for (const e of list) e.weight = e === box ? e.share : others ? (e.share * (1 - (box?.share ?? 0))) / others : 0;
  kept[l] = list;
  const t = totals[l];
  console.log(`\n${l}: ${t.all} plans from ${t.weight} places, ${Math.round((100 * t.row) / Math.max(1, t.all))}% with party walls both sides; ${t.samples} used, ${t.folded} folded by the grid; ${list.length} kept cover ${Math.round(covered * 100)}%`);
  for (const e of list.slice(0, 12))
    console.log(`  ${(e.share * 100).toFixed(1).padStart(5)}%  ${String(e.ring.length / 2).padStart(2)} corners  aspect ${e.aspect.toFixed(2)} ±${e.spread.toFixed(2)}  ${Math.round(e.area)} m²  in ${e.places} places`);
}

// A contact sheet: a row per zone, each plan in its typical proportions, street side down.
{
  const S = 46;
  const pad = 14;
  let svg = '';
  let y = 10;
  for (const l of BUILT) {
    svg += `<text x="4" y="${y + 10}" font-size="11" font-family="sans-serif">${l}</text>`;
    y += 16;
    kept[l].forEach((e, k) => {
      const col = k % 20;
      const row = Math.floor(k / 20);
      const ox = 4 + col * (S + pad);
      const oy = y + row * (S + pad + 10);
      const w = e.aspect > 1 ? S / e.aspect : S;
      const h = e.aspect > 1 ? S : S * e.aspect;
      const pts = [];
      for (let i = 0; i < e.ring.length; i += 2) pts.push(`${(ox + (e.ring[i] / GRID) * w).toFixed(1)},${(oy + S - (e.ring[i + 1] / GRID) * h).toFixed(1)}`);
      svg += `<polygon points="${pts.join(' ')}" fill="#ddd" stroke="#222" stroke-width="0.8"/>`;
      svg += `<line x1="${ox}" y1="${oy + S + 2}" x2="${ox + w}" y2="${oy + S + 2}" stroke="#c33"/>`;
      svg += `<text x="${ox}" y="${oy + S + 11}" font-size="8" font-family="sans-serif">${(e.share * 100).toFixed(1)}%</text>`;
    });
    y += Math.ceil(kept[l].length / 20) * (S + pad + 10) + 6;
  }
  const file = path.join(outDir, 'plans.svg');
  const width = 4 + 20 * (S + pad);
  writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" style="background:#fff">${svg}</svg>`);
  console.log(`\nContact sheet: ${file}`);
  try {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
    const page = await browser.newPage({ viewport: { width, height: Math.ceil(y) }, deviceScaleFactor: 1.5 });
    await page.setContent(`<html><body style="margin:0">${readFileSync(file, 'utf8')}</body></html>`);
    await page.screenshot({ path: file.replace(/\.svg$/, '.png') });
    await browser.close();
  } catch (e) {
    console.log(`PNG skipped: no browser (${e instanceof Error ? e.message.split('\n')[0] : e})`);
  }
}

if (write && !only) {
  const r2 = (v) => Number(v.toFixed(2));
  const r3 = (v) => Number(v.toFixed(3));
  const zones = BUILT.map((l) => `  ${l}: [\n${kept[l].map((e) => `    { share: ${r3(e.weight)}, aspect: ${r2(e.aspect)}, spread: ${r2(e.spread)}, area: ${Math.round(e.area)}, ring: [${e.ring.join(', ')}] },`).join('\n')}\n  ],`).join('\n');
  const file = `/**
 * The plans each built zone builds, learnt by \`npm run floorplans -- --write\` from the footprints
 * of ${places.length} real places (lab/adjacency-places.ts), ${new Date().toISOString().slice(0, 10)}. Generated: don't edit by hand.
 *
 * Each plan is a counter-clockwise ring on a ${GRID} × ${GRID} grid over its bounding box, the street
 * side at y = 0, the mirror image counted with it. \`share\` is its part of the zone's footprints,
 * each place counting the same, with the plain box at its own share and the others scaled up to
 * stand for the rarer plans left out; \`aspect\` its typical depth over width and \`spread\` the standard
 * deviation of that in natural log; \`area\` its typical bounding box, m². Row zones (rows, old,
 * blocks) are learnt from houses with party walls on both sides, the rest from all footprints.
 */
import type { Label } from './image-tone';

/** One learnt plan. */
export type LearntPlan = { share: number; aspect: number; spread: number; area: number; ring: number[] };
export const PLAN_GRID = ${GRID};
export const PLANS: Partial<Record<Label, LearntPlan[]>> = {
${zones}
};
`;
  writeFileSync(path.join(root, 'src', 'image-floorplan-data.ts'), file);
  console.log('\nWrote src/image-floorplan-data.ts');
}

await runner.close();
await server.close();
