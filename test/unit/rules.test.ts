/**
 * Checks on the source for the rules in AGENTS.md that are easy to break and easy to spot.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const src = path.resolve(import.meta.dirname, '../../src');
/** Modules that draw: everything but the UI, the worker shell and the network helpers. */
const UI = /^(App\.tsx|main\.tsx|components\/|app\/|lib\/|locator\.ts|search\.ts|harmony\.ts|netcache\.ts|osm\.ts|worker\.ts)/;
const files = readdirSync(src, { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.tsx?$/.test(f) && !UI.test(f.split(path.sep).join('/')))
  .map((f) => [f, readFileSync(path.join(src, f), 'utf8')] as const);

const offending = (re: RegExp) =>
  files.flatMap(([f, text]) => text.split('\n').flatMap((line, i) => (re.test(line.replace(/\/\/.*$/, '')) ? [`${f}:${i + 1}: ${line.trim()}`] : [])));

test('there are drawing modules to check', () => {
  expect(files.length).toBeGreaterThan(25);
});

test('drawing is deterministic: no Math.random, clocks or Date in drawing code', () => {
  // The imprint dates the sheet on purpose (the render tests pin the clock); nothing else may.
  const imprint = (l: string) => l.startsWith('marginalia.ts:') && l.includes('now = new Date()');
  expect(offending(/Math\.random\(|Date\.now\(|new Date\(/).filter((l) => !imprint(l))).toEqual([]);
});

test('level of detail goes through src/lod.ts, not bare comparisons with cam.lod', () => {
  expect(offending(/cam\.lod\s*[<>]=?\s*[\d.]|[\d.]\s*[<>]=?\s*\w*\.?cam\.lod\b/)).toEqual([]);
});

test('drawing code never fetches', () => {
  expect(offending(/\bfetch\(/).filter((l) => !l.startsWith('tiles.ts'))).toEqual([]);
});
