import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Frame } from '@/geo';

vi.mock('@/netcache', () => ({
  LOCAL: 'https://cache.isometrictown.local/',
  META: {},
  TTL: { month: 1 },
  json: vi.fn(),
  read: vi.fn(async () => null),
  write: vi.fn(async () => {}),
}));

const primary = 'https://overpass-api.de/api/interpreter';
const fallback = 'https://overpass.private.coffee/api/interpreter';
const third = 'https://overpass.kumi.systems/api/interpreter';
const pause = 120000;
const ok = () => Response.json({ elements: [] });
let loadTags: typeof import('@/osm').loadTags;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  ({ loadTags } = await import('@/osm'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Separate places require fresh cells, so successful empty answers cannot hide retries.
const load = (longitude: number) => loadTags(new Frame([longitude, 47]), [0, 0, 10, 10]);
const urls = () => fetchMock.mock.calls.map(([url]) => url);

test('skips a failed primary after fallback success, then probes it after the cooldown', async () => {
  fetchMock.mockResolvedValueOnce(new Response('', { status: 502 })).mockImplementation(async () => ok());
  await load(8);
  await load(9);
  expect(urls()).toEqual([primary, fallback, fallback]);
  vi.advanceTimersByTime(pause);
  await load(10);
  expect(urls()).toEqual([primary, fallback, fallback, primary]);
  await load(10);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

test('backs off all failed mirrors without caching failure as an empty answer', async () => {
  fetchMock.mockResolvedValue(new Response('', { status: 502 }));
  expect(await load(8)).toEqual([]);
  await load(8);
  expect(urls()).toEqual([primary, fallback, third]);
  vi.advanceTimersByTime(pause);
  fetchMock.mockImplementation(async () => ok());
  await load(8);
  expect(urls()).toEqual([primary, fallback, third, primary]);
});

test('doubles repeated failure pauses and resets them after recovery', async () => {
  let failing = true;
  fetchMock.mockImplementation(async (url) => url === primary && failing ? new Response('', { status: 502 }) : ok());
  await load(8);
  vi.advanceTimersByTime(pause);
  await load(9);
  vi.advanceTimersByTime(pause);
  await load(10);
  expect(urls().filter((url) => url === primary)).toHaveLength(2);
  vi.advanceTimersByTime(pause);
  failing = false;
  await load(11);
  failing = true;
  await load(12);
  vi.advanceTimersByTime(pause);
  await load(13);
  expect(urls().filter((url) => url === primary)).toHaveLength(5);
});

test.each(['600', 'Thu, 01 Jan 2026 00:10:00 GMT'])('honours Retry-After %s when it exceeds the normal pause', async (retry) => {
  fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': retry } })).mockImplementation(async () => ok());
  await load(8);
  vi.advanceTimersByTime(pause);
  await load(9);
  expect(urls()).toEqual([primary, fallback, fallback]);
  vi.advanceTimersByTime(600000 - pause);
  await load(10);
  expect(urls()).toEqual([primary, fallback, fallback, primary]);
});

test('times out a stalled mirror and skips it on the next request', async () => {
  fetchMock.mockImplementation(async (url, init) => {
    if (url !== primary) return ok();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    });
  });
  const pending = load(8);
  await vi.advanceTimersByTimeAsync(9000);
  await pending;
  await load(9);
  expect(urls()).toEqual([primary, fallback, fallback]);
});
