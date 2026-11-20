#!/usr/bin/env node
/**
 * Adjacency lab runner. Labels the ground of real places with image mode's zone labels, counts
 * which labels border which, and writes the counts for `src/image-adjacency-data.ts`. Label
 * maps go to lab/out/adjacency/ as PNGs to check by eye. See lab/adjacency.ts.
 *
 *   npm run adjacency                         every place in lab/adjacency-places.ts
 *   npm run adjacency -- --places siena,plano label some places only, without writing the table
 *   npm run adjacency -- --write              write src/image-adjacency-data.ts
 *   npm run adjacency -- --eval               cross-validate the learnt table against the hand-made one
 *   npm run adjacency -- --eval --grid        the same over a range of LEARN options
 *   npm run adjacency -- --table              print the learnt costs beside the hand-made ones
 *   npm run adjacency -- --stats              print what the buildings round each place's cells look like
 *
 * Downloads are cached on disk in lab/.cache, shared with the LOD lab.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
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
const outDir = path.join(here, 'out', 'adjacency');
mkdirSync(outDir, { recursive: true });

const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, resolve: { alias: { '@': path.join(root, 'src') } } });
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
const lab = await runner.import(path.join(here, 'adjacency.ts'));
const { LABELS } = lab;
const K = LABELS.length;

/** One colour per label for the label maps, unknown ground in white. */
const COLOURS = {
  water: [70, 130, 220], plaza: [250, 240, 160], sand: [240, 220, 170], meadow: [200, 235, 160], field: [230, 220, 120], park: [110, 200, 110],
  allot: [170, 140, 80], wood: [30, 110, 50], works: [150, 150, 170], suburb: [250, 180, 150], rows: [230, 120, 90], old: [170, 50, 40], blocks: [120, 60, 140], towers: [20, 20, 30],
};

if (argv.includes('--table')) {
  // The learnt costs beside the hand-made ones, from the table in src/image-adjacency-data.ts.
  const { PAIRS } = await runner.import(path.join(root, 'src', 'image-adjacency-data.ts'));
  const T = lab.learnCompat(PAIRS, lab.compat);
  let s = 'learnt/hand\n' + ''.padEnd(8) + LABELS.map((l) => l.slice(0, 6).padStart(11)).join('') + '\n';
  for (let a = 0; a < K; a++) s += LABELS[a].padEnd(8) + LABELS.map((_, b) => (a === b ? '-' : `${T[a][b].toFixed(2)}/${lab.compat(LABELS[a], LABELS[b]).toFixed(2)}`).padStart(11)).join('') + '\n';
  console.log(s);
  await runner.close();
  await server.close();
  process.exit(0);
}

if (argv.includes('--eval')) {
  // Cross-validate the learnt table against the hand-made one, on the counts from the last full run.
  const saved = JSON.parse(readFileSync(path.join(outDir, 'counts.json'), 'utf8'));
  const show = (title, r) => {
    console.log(`\n${title}`);
    const kinds = Object.keys(r.chance);
    console.log(''.padEnd(10) + kinds.map((k) => k.padStart(9)).join(''));
    for (const [table, byKind] of Object.entries(r)) console.log(table.padEnd(10) + kinds.map((k) => byKind[k].toFixed(3).padStart(9)).join(''));
  };
  const grid = argv.includes('--grid');
  if (grid) {
    for (const prior of [1, 4, 8, 16, 32])
      for (const trust of [0, 10, 25, 50, 100, 200]) {
        const r = lab.crossValidate(saved.places, lab.compat, (pairs) => lab.learnCompat(pairs, lab.compat, { prior, trust }));
        console.log(`prior ${String(prior).padStart(3)} trust ${String(trust).padStart(4)}: learnt ${r.learnt.all.toFixed(4)}  hand ${r.hand.all.toFixed(4)}  chance ${r.chance.all.toFixed(4)}`);
      }
  } else show('Held-out log-likelihood, nats per boundary side (higher is better), leaving out one place at a time', lab.crossValidate(saved.places, lab.compat, (pairs) => lab.learnCompat(pairs, lab.compat)));
  await runner.close();
  await server.close();
  process.exit(0);
}

const places = lab.CORPUS.filter((p) => !only || only.includes(p.id));
const results = [];
for (const place of places) {
  const t0 = performance.now();
  try {
    const r = await lab.labelPlace(place);
    results.push({ place, r });
    const png = new PNG({ width: r.W, height: r.H });
    for (let j = 0; j < r.H; j++)
      for (let i = 0; i < r.W; i++) {
        // North up: row j counts up from the south.
        const v = r.label[(r.H - 1 - j) * r.W + i];
        const c = v === 255 ? [255, 255, 255] : COLOURS[LABELS[v]];
        const o = (j * r.W + i) * 4;
        png.data.set([...c, 255], o);
      }
    writeFileSync(path.join(outDir, `${place.id}.png`), PNG.sync.write(png));
    const total = r.cells.reduce((a, b) => a + b, 0);
    const mix = LABELS.map((l, k) => [l, r.cells[k] / total]).filter(([, v]) => v >= 0.02).sort((a, b) => b[1] - a[1]).map(([l, v]) => `${l} ${Math.round(v * 100)}%`).join(', ');
    console.log(`${place.id.padEnd(16)} ${String(Math.round(performance.now() - t0)).padStart(6)} ms  ${mix}`);
    if (argv.includes('--stats')) {
      const q = (key, f) => {
        const v = r.chars.map((c) => c[key]).sort((a, b) => a - b);
        return v.length ? [0.25, 0.5, 0.75].map((p) => f(v[Math.floor(p * (v.length - 1))])).join('/') : '-';
      };
      const pc = (v) => Math.round(v * 100);
      console.log(`    grid ${q('grid', pc)}  streets ${q('streets', Math.round)}  cov ${q('cov', pc)}  foot ${q('foot', Math.round)}  h ${q('h', Math.round)}  party ${q('party', pc)}  apt ${q('apt', pc)}  house ${q('house', pc)}  work ${q('work', pc)}`);
    }
  } catch (e) {
    console.log(`${place.id.padEnd(16)} failed: ${e instanceof Error ? e.message : e}`);
  }
}

// Each place counts the same, however much boundary it has, so big cities don't drown villages.
const pairs = new Float64Array(K * K);
const cells = new Float64Array(K);
for (const { r } of results) {
  const sum = r.pairs.reduce((a, b) => a + b, 0) / 2;
  const area = r.cells.reduce((a, b) => a + b, 0);
  if (!sum || !area) continue;
  for (let k = 0; k < K * K; k++) pairs[k] += (r.pairs[k] / sum) * 1000;
  for (let k = 0; k < K; k++) cells[k] += (r.cells[k] / area) * 1000;
}
const perPlace = Object.fromEntries(results.map(({ place, r }) => [place.id, { kind: place.kind, pairs: Array.from(r.pairs), cells: Array.from(r.cells) }]));
writeFileSync(path.join(outDir, 'counts.json'), JSON.stringify({ labels: LABELS, pairs: Array.from(pairs), cells: Array.from(cells), places: perPlace }));

if (write && !only) {
  const r1 = (v) => Number(v.toFixed(1));
  const rows = LABELS.map((_, a) => `  [${LABELS.map((_, b) => r1(pairs[a * K + b])).join(', ')}],`).join('\n');
  const file = `/**
 * Which zone labels border which in real towns, measured by \`npm run adjacency -- --write\` on
 * ${results.length} places (lab/adjacency-places.ts), ${new Date().toISOString().slice(0, 10)}. Generated: don't edit by hand.
 *
 * \`PAIRS[a][b]\` is the boundary between labels a and b, per 1,000 cell sides of boundary in
 * each place, summed over the places, so every place counts the same. Labels run as in \`LABELS\`.
 */
export const PLACES = ${results.length};
export const PAIRS: number[][] = [
${rows}
];
`;
  writeFileSync(path.join(root, 'src', 'image-adjacency-data.ts'), file);
  console.log('\nWrote src/image-adjacency-data.ts');
}

await runner.close();
await server.close();
