#!/usr/bin/env node
/**
 * Junction lab runner. Reads the junctions and crossings of the real places in
 * lab/adjacency-places.ts and the town edges in lab/junction-places.ts, prints how each kind is controlled, and writes the tables for
 * `src/image-junction-data.ts`. See lab/junctions.ts.
 *
 *   npm run junctions                          every place, printing what it learns
 *   npm run junctions -- --places bruges,plano some places only, without writing the tables
 *   npm run junctions -- --write               write src/image-junction-data.ts
 *
 * Tiles and Overpass answers are cached on disk in lab/.cache, so only a first run asks the
 * servers, one place at a time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
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
const outDir = path.join(here, 'out', 'junctions');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, resolve: { alias: { '@': path.join(root, 'src') } } });
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
const lab = await runner.import(path.join(here, 'junctions.ts'));
const { labelPlace } = await runner.import(path.join(here, 'adjacency.ts'));

const places = lab.CORPUS.filter((p) => !only || only.includes(p.id));
const results = [];
for (const place of places) {
  const t0 = performance.now();
  try {
    const r = await lab.junctionsOf(place, await labelPlace(place));
    results.push({ place, r });
    const n = (c) => r.junctions.filter((j) => j.control === c).length;
    const km = Object.values(r.roadKm).reduce((a, b) => a + b, 0);
    console.log(`${place.id.padEnd(16)} ${r.style.padEnd(13)} ${String(Math.round(performance.now() - t0)).padStart(6)} ms  ${r.junctions.length} junctions: ${n('roundabout')} roundabouts, ${n('signals')} signals; ${r.crossings.length} crossings; ${km.toFixed(0)} km of road`);
  } catch (e) {
    console.log(`${place.id.padEnd(16)} failed: ${e instanceof Error ? e.message : e}`);
  }
}
writeFileSync(path.join(outDir, 'junctions.json'), JSON.stringify(results.map(({ place, r }) => ({ id: place.id, kind: place.kind, ...r }))));
console.log(`\nSaved lab/out/junctions/junctions.json`);

// ---- Learning: per regional style, each cell smoothed towards the one above it.
const RANKS = lab.RANKS;
const ZONES = ['suburb', 'rows', 'old', 'blocks', 'towers', 'works', 'other'];
/** A style gets tables of its own from this many places and junctions; others use the pooled tables. */
const OWN_PLACES = 3;
const OWN_JUNCTIONS = 300;
/** Prior weight, in junctions or arms, of the cell above. */
const PRIOR = 12;
const keyOf = (arms) => `${RANKS.indexOf(arms[0])}${RANKS.indexOf(arms[1])}${Math.min(arms.length, 4)}`;
const KEYS = [];
for (let a = 0; a < 4; a++) for (let b = 0; b <= a; b++) for (const n of [3, 4]) KEYS.push(`${a}${b}${n}`);
const smooth = (yes, n, prior) => (yes + PRIOR * prior) / (n + PRIOR);
/** A chance with its odds multiplied by `f`. */
const scaleOdds = (p, f) => (p >= 1 ? 1 : (p * f) / (1 - p + p * f));
/** How much the odds of `p` exceed those of `q`. */
const oddsRatio = (p, q) => (p / (1 - p)) / Math.max(1e-6, q / (1 - q));
const r3 = (v) => Number(v.toFixed(3));
const count = () => ({ yes: 0, n: 0 });

function learn(list, parent) {
  const J = list.flatMap((r) => r.junctions);
  const C = list.flatMap((r) => r.crossings);
  // Roundabouts by key, backing off to the busiest arm's rate.
  const byTop = RANKS.map(() => count());
  const byKey = Object.fromEntries(KEYS.map((k) => [k, count()]));
  for (const j of J) {
    const k = keyOf(j.arms);
    const yes = j.control === 'roundabout' ? 1 : 0;
    byTop[RANKS.indexOf(j.arms[0])].yes += yes;
    byTop[RANKS.indexOf(j.arms[0])].n++;
    byKey[k].yes += yes;
    byKey[k].n++;
  }
  const all = J.filter((j) => j.control === 'roundabout').length / Math.max(1, J.length);
  // A style leans on the pooled cell, scaled by how much more or less given to roundabouts it is overall.
  const lean = parent ? oddsRatio(smooth(J.filter((j) => j.control === 'roundabout').length, J.length, parent.rates.roundabout), parent.rates.roundabout) : 1;
  // Over all zones first, then by zone leaning on that (pooled) or on the pooled zone cell (a style).
  const roundKey = {};
  for (const k of KEYS) {
    const top = byTop[Number(k[0])];
    const prior = parent ? scaleOdds(parent.roundKey[k], lean) : smooth(top.yes, top.n, all);
    roundKey[k] = smooth(byKey[k].yes, byKey[k].n, prior);
  }
  const roundabout = {};
  for (const z of ZONES) {
    const c = Object.fromEntries(KEYS.map((k) => [k, count()]));
    for (const j of J) if (j.label === z) {
      c[keyOf(j.arms)].yes += j.control === 'roundabout' ? 1 : 0;
      c[keyOf(j.arms)].n++;
    }
    roundabout[z] = Object.fromEntries(KEYS.map((k) => [k, r3(smooth(c[k].yes, c[k].n, parent ? scaleOdds(parent.roundabout[z][k], lean) : roundKey[k]))]));
  }
  // Signals, given no roundabout, by zone and key, backing off to the key over all zones.
  const sig = (filter) => {
    const out = Object.fromEntries(KEYS.map((k) => [k, count()]));
    for (const j of J) if (j.control !== 'roundabout' && filter(j)) {
      out[keyOf(j.arms)].yes += j.control === 'signals' ? 1 : 0;
      out[keyOf(j.arms)].n++;
    }
    return out;
  };
  const anyZone = sig(() => true);
  const unround = J.filter((j) => j.control !== 'roundabout').length;
  const sAll = J.filter((j) => j.control === 'signals').length / Math.max(1, unround);
  // Pooled, zone cells lean on the key over all zones. A style's lean on the pooled zone cell,
  // its odds scaled by how much more or less given to signals the style is overall.
  const sLean = parent ? oddsRatio(smooth(sAll * unround, unround, parent.rates.signals), parent.rates.signals) : 1;
  const keyRate = Object.fromEntries(KEYS.map((k) => [k, smooth(anyZone[k].yes, anyZone[k].n, parent ? scaleOdds(parent.signalsKey[k], sLean) : sAll)]));
  const signals = {};
  for (const z of ZONES) {
    const c = sig((j) => j.label === z);
    signals[z] = Object.fromEntries(KEYS.map((k) => [k, r3(smooth(c[k].yes, c[k].n, parent ? scaleOdds(parent.signals[z][k], sLean) : keyRate[k]))]));
  }
  // Roundabout radii by the busiest arm: the middle half of real ones.
  const radius = RANKS.map((rank, i) => {
    const rs = J.filter((j) => j.control === 'roundabout' && j.arms[0] === rank).map((j) => j.radius).sort((a, b) => a - b);
    if (rs.length < 5) return parent ? parent.radius[i] : [14, 20];
    return [rs[Math.floor(rs.length * 0.25)], rs[Math.floor(rs.length * 0.75)]].map((v) => Number(v.toFixed(1)));
  });
  // Crossings: per arm at junctions, per kilometre between them, and how many have signals.
  const marked = C.filter((c) => c.kind !== 'unmarked');
  const arms = (control, zone, rank) => J.filter((j) => (control === 'signals' ? j.control === 'signals' : j.control !== 'signals') && (!zone || j.label === zone)).reduce((s, j) => s + j.arms.filter((a) => a === rank).length, 0);
  const crossAtSignals = RANKS.map((rank, i) => {
    const yes = marked.filter((c) => c.atJunction && c.control === 'signals' && c.rank === rank).length;
    return r3(Math.min(1, smooth(yes, arms('signals', null, rank), parent ? parent.crossAtSignals[i] : 0.5)));
  });
  const crossAtJunction = {};
  const anyArm = RANKS.map((rank) => Math.min(1, marked.filter((c) => c.atJunction && c.control !== 'signals' && c.rank === rank).length / Math.max(1, arms('none', null, rank))));
  for (const z of ZONES)
    crossAtJunction[z] = RANKS.map((rank, i) => {
      const yes = marked.filter((c) => c.atJunction && c.control !== 'signals' && c.rank === rank && c.label === z).length;
      return r3(Math.min(1, smooth(yes, arms('none', z, rank), parent?.crossAtJunction[z]?.[i] ?? anyArm[i])));
    });
  const km = (zone, rank) => list.reduce((s, r) => s + (zone ? (r.roadKmByLabel[zone]?.[rank] ?? 0) : r.roadKm[rank]), 0);
  const between = marked.filter((c) => !c.atJunction);
  const anyKm = RANKS.map((rank) => between.filter((c) => c.rank === rank).length / Math.max(0.1, km(null, rank)));
  const crossPerKm = {};
  for (const z of ZONES)
    crossPerKm[z] = RANKS.map((rank, i) => {
      // Smoothed as if the prior were seen over two kilometres.
      const n = between.filter((c) => c.rank === rank && c.label === z).length;
      const prior = parent?.crossPerKm[z]?.[i] ?? anyKm[i];
      return Number(((n + 2 * prior) / (km(z, rank) + 2)).toFixed(2));
    });
  const signalsBetween = RANKS.map((rank, i) => {
    const b = between.filter((c) => c.rank === rank);
    return r3(smooth(b.filter((c) => c.kind === 'signals').length, b.length, parent ? parent.signalsBetween[i] : 0.2));
  });
  return { roundabout, roundKey, signals, signalsKey: keyRate, rates: { roundabout: all, signals: sAll }, radius, crossAtJunction, crossAtSignals, crossPerKm, signalsBetween, junctions: J.length, places: list.length };
}

const pooled = learn(results.map((x) => x.r), null);
const styles = { all: pooled };
const byStyle = new Map();
for (const { r } of results) (byStyle.get(r.style) ?? byStyle.set(r.style, []).get(r.style)).push(r);
for (const [style, list] of [...byStyle].sort()) {
  const J = list.reduce((s, r) => s + r.junctions.length, 0);
  if (list.length >= OWN_PLACES && J >= OWN_JUNCTIONS) styles[style] = learn(list, pooled);
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;
for (const [style, t] of Object.entries(styles)) {
  console.log(`\n${style}: ${t.places} places, ${t.junctions} junctions; ${pct(t.rates.roundabout)} roundabouts, ${pct(t.rates.signals)} of the rest with signals`);
  console.log(`  roundabout  in suburbs primary×primary 4-way ${pct(t.roundabout.suburb['334'])}, secondary×tertiary ${pct(t.roundabout.suburb['214'])}, tertiary×minor 3-way ${pct(t.roundabout.suburb['103'])}, minor×minor ${pct(t.roundabout.suburb['004'])}; in works secondary×tertiary ${pct(t.roundabout.works['214'])}; in the old town ${pct(t.roundabout.old['214'])}`);
  console.log(`  signals     primary×secondary in blocks ${pct(t.signals.blocks['324'])}, in suburbs ${pct(t.signals.suburb['324'])}; tertiary×minor in old town ${pct(t.signals.old['104'])}`);
  console.log(`  radius m    ${t.radius.map((r, i) => `${RANKS[i]} ${r[0]}–${r[1]}`).join(', ')}`);
  console.log(`  crossings   per arm at signals ${t.crossAtSignals.map(pct).join('/')}; per arm elsewhere in blocks ${t.crossAtJunction.blocks.map(pct).join('/')}; per km between in blocks ${t.crossPerKm.blocks.join('/')}; with signals ${t.signalsBetween.map(pct).join('/')}`);
}

if (write && !only) {
  const body = Object.entries(styles).map(([style, t]) => `  ${JSON.stringify(style)}: ${JSON.stringify({ roundabout: t.roundabout, signals: t.signals, radius: t.radius, crossAtJunction: t.crossAtJunction, crossAtSignals: t.crossAtSignals, crossPerKm: t.crossPerKm, signalsBetween: t.signalsBetween })},`).join('\n');
  const file = `/**
 * How real towns control their junctions and where people cross, learnt by \`npm run junctions -- --write\`
 * from ${results.length} places (lab/adjacency-places.ts, lab/junction-places.ts) and their OpenStreetMap tags, ${new Date().toISOString().slice(0, 10)}. Generated: don't edit by hand.
 *
 * Street classes run minor, tertiary, secondary, primary (0–3). A junction's key is its busiest
 * arm's class, its next busiest, and its arms (3, or 4 for four and more). \`roundabout\` is the
 * chance, by zone, that such a junction is a roundabout; \`signals\` the chance, by zone, that one that isn't has
 * traffic signals; \`radius\` the middle half of roundabouts' centre-line radii, m, by their busiest
 * arm. \`crossAtSignals\` and \`crossAtJunction\` (by zone) are the chance an arm of each class has a
 * marked crossing near a junction with and without signals, \`crossPerKm\` (by zone) marked
 * crossings per kilometre between junctions, and \`signalsBetween\` the share of those with signals.
 * \`all\` pools every place; a style with too few places of its own uses it. Each cell is smoothed
 * towards the cell above it, so rare kinds of junction lean on the common ones.
 */

/** One style's learnt junction habits. */
export type JunctionStyle = {
  roundabout: Record<string, Record<string, number>>;
  signals: Record<string, Record<string, number>>;
  radius: [number, number][];
  crossAtJunction: Record<string, number[]>;
  crossAtSignals: number[];
  crossPerKm: Record<string, number[]>;
  signalsBetween: number[];
};
export const JUNCTIONS: { places: number; styles: Record<string, JunctionStyle> } = {
  places: ${results.length},
  styles: {
${body.replace(/^/gm, '  ')}
  },
};
`;
  writeFileSync(path.join(root, 'src', 'image-junction-data.ts'), file);
  console.log('\nWrote src/image-junction-data.ts');
}
await runner.close();
await server.close();
