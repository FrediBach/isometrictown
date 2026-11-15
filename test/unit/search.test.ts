import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { browserCache } from '../support/cache';

let search: typeof import('@/search');
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const answer = () => Response.json([{ name: 'Paris', display_name: 'Paris, France', lat: '48', lon: '2', boundingbox: ['47', '49', '1', '3'] }]);

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01'));
  browserCache();
  vi.stubGlobal('navigator', { language: 'en' });
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => answer());
  vi.stubGlobal('fetch', fetchMock);
  search = await import('@/search');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('deduplicates submissions and persists answers across reloads, with separate languages', async () => {
  const [first, second] = await Promise.all([search.searchPlaces(' Paris '), search.searchPlaces('paris')]);
  expect(first).toEqual(second);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  vi.resetModules();
  search = await import('@/search');
  expect(await search.searchPlaces('PARIS')).toEqual(first);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  vi.stubGlobal('navigator', { language: 'de' });
  await search.searchPlaces('paris');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('spaces concurrent different submissions by at least one second', async () => {
  const starts: number[] = [];
  fetchMock.mockImplementation(async () => { starts.push(Date.now()); return answer(); });
  const jobs = Promise.all(['Paris', 'Bern', 'London'].map(search.searchPlaces));
  await vi.runAllTimersAsync();
  await jobs;
  expect(starts).toHaveLength(3);
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
  expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(1000);
});

test('serves stale search answers during failure and preserves cooldown across reloads', async () => {
  const first = await search.searchPlaces('paris');
  vi.advanceTimersByTime(86400001);
  fetchMock.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '600' } }));
  expect(await search.searchPlaces('paris')).toEqual(first);
  vi.resetModules();
  search = await import('@/search');
  await expect(search.searchPlaces('bern')).rejects.toThrow('cooling down');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(600000);
  fetchMock.mockImplementation(async () => answer());
  await search.searchPlaces('bern');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('autocomplete cancellation does not put the provider into cooldown', async () => {
  fetchMock.mockImplementationOnce(async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  })).mockImplementation(async () => Response.json({ features: [] }));
  const ctrl = new AbortController();
  const cancelled = expect(search.suggestPlaces('paris', ctrl.signal)).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(0);
  ctrl.abort();
  await cancelled;
  const next = search.suggestPlaces('bern', new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await next).toEqual([]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('still searches when browser persistence is unavailable', async () => {
  vi.stubGlobal('caches', { open: async () => { throw new Error('Disabled'); } });
  expect(await search.searchPlaces('paris')).toHaveLength(1);
  await search.searchPlaces('paris');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
