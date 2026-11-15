/**
 * Network fixtures. Tests never touch the network: `fetch` is replaced with one that answers
 * from recorded responses in `test/fixtures/net`, and fails loudly for anything not recorded.
 *
 * `npm run test:record` runs the render tests with `RECORD=1`, which lets requests that have
 * no fixture yet through (from the LOD lab's disk cache where it has them, so the lab and the
 * tests share downloads) and files each answer as `<key>.json` (URL, status, type) next to
 * `<key>.gz`. To record everything afresh, delete `test/fixtures/net` first.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '../..');
export const FIXTURES = path.join(root, 'test/fixtures/net');
const LAB_CACHE = path.join(root, 'lab/.cache');
export const RECORDING = process.env.RECORD === '1';

type Meta = { url: string; method: string; status: number; type: string };

/** The same key the LOD lab files its cache under, so recordings can be seeded from it. */
function keyOf(method: string, url: string, body: string): string {
  return createHash('sha1').update(`${method} ${url} ${body}`).digest('hex');
}

function answer(meta: Meta, bytes: Buffer | null): Response {
  const empty = meta.status === 204 || !bytes;
  return new Response(empty ? null : new Uint8Array(bytes), { status: meta.status, headers: { 'content-type': meta.type } });
}

const realFetch = globalThis.fetch;

async function record(key: string, method: string, url: string, input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  let meta: Meta;
  let bytes: Buffer;
  const lab = path.join(LAB_CACHE, key);
  if (existsSync(`${lab}.json`)) {
    const m = JSON.parse(readFileSync(`${lab}.json`, 'utf8')) as { status: number; headers: { 'content-type'?: string } };
    meta = { url, method, status: m.status, type: m.headers['content-type'] ?? '' };
    bytes = readFileSync(lab);
  } else {
    // The app gives up on slow servers after seconds; a recording waits longer for the answer.
    const r = await realFetch(input, { ...init, signal: AbortSignal.timeout(90_000), headers: { ...((init.headers as Record<string, string>) ?? {}), 'User-Agent': 'isometrictown-tests' } });
    bytes = Buffer.from(await r.arrayBuffer());
    meta = { url, method, status: r.status, type: r.headers.get('content-type') ?? '' };
    // Don't keep a busy server's refusal: replaying it would freeze a failure into the goldens.
    if (!(r.ok || r.status === 204 || r.status === 404)) return answer(meta, bytes);
  }
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(path.join(FIXTURES, `${key}.json`), `${JSON.stringify(meta, null, 1)}\n`);
  writeFileSync(path.join(FIXTURES, `${key}.gz`), gzipSync(bytes, { level: 9 }));
  return answer(meta, bytes);
}

/** Replace `fetch` with the fixture player (or recorder, under `RECORD=1`). */
export function installFetch(): void {
  globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? init.body : init.body ? String(init.body) : '';
    const key = keyOf(method, url, body);
    const file = path.join(FIXTURES, key);
    // Recording keeps what it has, so a flaky server can't take away an answer already recorded.
    if (RECORDING && !existsSync(`${file}.json`)) return record(key, method, url, input, init);
    if (!existsSync(`${file}.json`)) throw new TypeError(`No network in tests, and no fixture for ${method} ${url}. Run \`npm run test:record\` if a case now needs new data.`);
    const meta = JSON.parse(readFileSync(`${file}.json`, 'utf8')) as Meta;
    return answer(meta, existsSync(`${file}.gz`) ? gunzipSync(readFileSync(`${file}.gz`)) : null);
  };
}
