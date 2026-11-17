#!/usr/bin/env node
/**
 * Draws a sheet of each zone label at its lowest and highest level (and for built labels with
 * pitched and with flat roofs), measures each pen's coverage, and prints the `MATERIALS` table
 * for `src/image-tone.ts`. See lab/calibrate.ts.
 *
 *   npm run calibrate                      at 1:1000, 1:2500, 1:5000 and 1:8000
 *   npm run calibrate -- --scales 2500 --tilt 30
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, createServerModuleRunner } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const scales = opt('scales', '1000,2500,5000,8000').split(',').map(Number);
const tilt = Number(opt('tilt', 40));

globalThis.fetch = async () => {
  throw new Error('Calibration fetches nothing');
};
const server = await createServer({ root, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, resolve: { alias: { '@': path.join(root, 'src') } } });
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
const lab = await runner.import(path.join(here, 'calibrate.ts'));
const BUILT = new Set(['works', 'suburb', 'rows', 'old', 'blocks', 'towers']);
const r3 = (v) => Number(v.toFixed(3));
const row = (c) => `[${c.map(r3).join(', ')}]`;

console.log(`// Measured by npm run calibrate at tilt ${tilt}°, ${new Date().toISOString().slice(0, 10)}.`);
for (const scale of scales) {
  console.log(`  ${scale}: {`);
  for (const label of lab.LABELS) {
    const t0 = performance.now();
    const lo = lab.swatch(label, 0, 1, scale, tilt);
    const hi = lab.swatch(label, 1, 1, scale, tilt);
    let line = `    ${label}: { lo: ${row(lo)}, hi: ${row(hi)}`;
    if (BUILT.has(label)) line += `, flatLo: ${row(lab.swatch(label, 0, 0, scale, tilt))}, flatHi: ${row(lab.swatch(label, 1, 0, scale, tilt))}`;
    console.log(`${line} },`);
    process.stderr.write(`1:${scale} ${label} ${Math.round(performance.now() - t0)} ms\n`);
  }
  console.log('  },');
}
await runner.close();
await server.close();
