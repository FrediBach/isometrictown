import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { browserCache } from '../support/cache';
import { Frame } from '@/geo';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01'));
  browserCache();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('Overpass skips a failed mirror after a worker reload', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 502 })).mockImplementation(async () => Response.json({ elements: [] }));
  vi.stubGlobal('fetch', fetchMock);
  let osm = await import('@/osm');
  await osm.loadTags(new Frame([8, 47]), [0, 0, 10, 10]);
  vi.resetModules();
  osm = await import('@/osm');
  await osm.loadTags(new Frame([9, 47]), [0, 0, 10, 10]);
  expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual(['overpass-api.de', 'overpass.private.coffee', 'overpass.private.coffee']);
});

test('limits tile downloads to four, including context, and reuses cached answers', async () => {
  let active = 0;
  let peak = 0;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).endsWith('/planet')) return Response.json({ tiles: ['https://tiles.test/{z}/{x}/{y}'] });
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    active--;
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const { loadTown } = await import('@/tiles');
  const frame = new Frame([8, 47]);
  const box: [number, number, number, number] = [-2000, -2000, 2000, 2000];
  const job = loadTown(frame, box, undefined, undefined, true);
  await vi.runAllTimersAsync();
  await job;
  expect(peak).toBe(4);
  expect(fetchMock.mock.calls.length).toBeGreaterThan(5);
  const count = fetchMock.mock.calls.length;
  await loadTown(frame, box, undefined, undefined, true);
  expect(fetchMock).toHaveBeenCalledTimes(count);
});

test('a stalled tile body times out and releases its slot for a later attempt', async () => {
  let stall = true;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith('/planet')) return Response.json({ tiles: ['https://tiles.test/{z}/{x}/{y}'] });
    if (!stall) return new Response(null, { status: 204 });
    return {
      ok: true, status: 200,
      arrayBuffer: () => new Promise<ArrayBuffer>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }),
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  const { loadTown } = await import('@/tiles');
  const frame = new Frame([8, 47]);
  const box: [number, number, number, number] = [0, 0, 10, 10];
  const failed = expect(loadTown(frame, box)).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(20000);
  await failed;
  stall = false;
  expect((await loadTown(frame, box)).buildings).toEqual([]);
});
