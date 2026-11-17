import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Renderer, scoreLook, type RenderResult } from '@/app/renderer';
import { Stats } from '@/components/stage';
import type { Picture } from '@/image';
import type { Likeness } from '@/image-tone';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import type { Job, Reply } from '@/worker';

vi.mock('@/app/plot-activity', () => ({ usePlotActivity: () => null }));

/** Hold replies until the test has switched the source or chosen another image. */
class WorkerStub {
  static latest: WorkerStub;
  jobs: Job[] = [];
  onmessage: ((event: { data: Reply }) => void) | null = null;
  terminate = vi.fn();

  constructor() { WorkerStub.latest = this; }
  postMessage(job: Job) { this.jobs.push(job); }
  reply(data: Reply) { this.onmessage?.({ data }); }
}

const complete = (id: number, likeness?: Likeness): Reply => ({
  id, kind: 'done', svg: '<svg><g id="pen-1" fill="none" stroke="#000000"></g></svg>', likeness, ms: 10, counts: { buildings: 1, houses: 1, trees: 0, cars: 0, lamps: 0 },
  census: {}, features: {}, region: { country: 'Image', code: '', style: 'central', left: false },
  stats: { pens: [], rawLifts: 0, rawTravel: 0, lifts: 0, travel: 0, ink: 0, seconds: 0 },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout });
  vi.stubGlobal('Worker', WorkerStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('a late map result cannot fill an empty image sheet', () => {
  let set = structuredClone(DEFAULT_SETTINGS);
  const status = vi.fn();
  const result = vi.fn();
  const r = new Renderer(() => set, () => null, status, result);
  r.schedule(0);
  vi.runAllTimers();
  const w = WorkerStub.latest;
  const map = w.jobs[0].id;

  set = { ...set, source: 'image', image: '' };
  r.schedule(0);
  vi.runAllTimers();
  status.mockClear();
  w.reply({ id: map, kind: 'progress', stage: 'map' });
  expect(status).not.toHaveBeenCalled();
  w.reply(complete(map));
  expect(result).not.toHaveBeenCalled();
  expect(status).toHaveBeenLastCalledWith({ text: 'Choose an image to draw from', state: 'idle' });
  expect(w.jobs).toHaveLength(1);
  r.dispose();
});

test('replacing an image ignores its pending draw, score and errors', async () => {
  let pic: Picture = { id: 'first', name: 'First', w: 1, h: 1, rgba: new Uint8ClampedArray(4) };
  let set: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id };
  const status = vi.fn();
  const result = vi.fn();
  const r = new Renderer(() => set, () => pic, status, result);
  r.schedule(0);
  vi.runAllTimers();
  const w = WorkerStub.latest;
  const first = w.jobs[0].id;
  const score = r.score(set);
  const scoreId = w.jobs[1].id;

  pic = { ...pic, id: 'second', name: 'Second' };
  set = { ...set, image: pic.id };
  r.schedule(0);
  vi.runAllTimers();
  w.reply({ id: first, kind: 'error', tooBig: false, text: 'Previous image failed' });
  expect(status).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'error' }));
  expect(w.jobs[2]).toMatchObject({ kind: 'draw', set: { image: 'second' }, picture: { id: 'second' } });
  w.reply({ id: scoreId, kind: 'scored', likeness: { score: 1, ssim: 1, dE: [0, 0] } });
  await expect(score).resolves.toBeNull();
  w.reply(complete(first));
  expect(result).not.toHaveBeenCalled();
  w.reply(complete(w.jobs[2].id));
  expect(result).toHaveBeenCalledOnce();
  r.dispose();
});

test('a draw finishing during a palette change shows only the score for the current pens and paper', async () => {
  const pic: Picture = { id: 'bands', name: 'Bands', w: 1, h: 1, rgba: new Uint8ClampedArray(4) };
  let set: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id };
  const result = vi.fn<(r: RenderResult) => void>();
  const r = new Renderer(() => set, () => pic, vi.fn(), result);
  const stats = (sheet: RenderResult) => renderToStaticMarkup(createElement(Stats, { result: sheet, look: scoreLook(set), onPlot: vi.fn() }));
  r.schedule(0);
  vi.runAllTimers();
  const w = WorkerStub.latest;
  set = { ...set, pens: ['#ffaabb', '#112233', '#445566', '#778899', '#000011'] };
  const first = r.score(set);
  set = { ...set, customBackground: true, background: '#ddeeff' };
  const latest = r.score(set);

  const measured: Likeness = { score: 0.6, dE: [0.1, 0.2], ssim: 0.5 };
  w.reply(complete(w.jobs[0].id, measured));
  const sheet = result.mock.lastCall![0];
  expect(sheet.svg).toContain('stroke="#ffaabb"');
  expect(sheet.svg).toContain('background-color:#ddeeff');
  expect(stats(sheet)).not.toContain('Likeness');

  w.reply({ id: w.jobs[1].id, kind: 'scored', likeness: measured });
  await expect(first).resolves.toBeNull();
  w.reply({ id: w.jobs[2].id, kind: 'scored', likeness: measured });
  const likeness = await latest;
  expect(likeness?.look).toBe(scoreLook(set));
  expect(stats({ ...sheet, likeness: likeness! })).toContain('Likeness');
  r.dispose();
});
