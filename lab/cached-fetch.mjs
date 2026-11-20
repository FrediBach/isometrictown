/**
 * Swaps `fetch` for one that caches every response on disk in lab/.cache and runs a few
 * downloads at a time, as the LOD lab does. The adjacency and floorplan labs share it.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache');
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
