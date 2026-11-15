import { expect, test, vi } from 'vitest';
import { powerTerrain } from '@/power-terrain';
import { powerLines, powerRunContinues } from '@/power';
import type { Build } from '@/buildings';
import { Camera } from '@/camera';
import { Paper } from '@/raster';
import type { Masks } from '@/nature';
import { DEFAULT_SETTINGS } from '@/settings';
import { STYLES } from '@/styles';
import { powerContextTiles, type PowerContext, type Shape, type Town } from '@/tiles';
import { EARTH, Frame } from '@/geo';

const rectangle = (x0: number, y0: number, x1: number, y1: number): Shape => [{ pts: [x0,y0,x1,y0,x1,y1,x0,y1], seam: new Uint8Array(4) }];
function context(): PowerContext { return { land: [rectangle(-5000,-5000,5000,5000)], water: [], buildings: [], roads: [], streams: [], airfields: [] }; }
function town(powerContext: PowerContext): Town { return { powerContext, ways: [], density: { built: [], shops: [] } } as unknown as Town; }

test('transmission needs positive land evidence and rejects water even outside the sheet', () => {
  const c = context(); c.land = [];
  expect(powerTerrain(town(c)).support(0, 0, true)).toBe(false);
  c.land = [rectangle(-5000,-5000,5000,5000)]; c.water = [rectangle(1200,-100,1800,100)];
  const terrain = powerTerrain(town(c));
  expect(terrain.support(1000, 0, true)).toBe(true);
  expect(terrain.support(1500, 0, true)).toBe(false);
  expect(terrain.span(1000, 0, 2000, 0, true, 11)).toBe(false);
});

test('both ends on land cannot justify a span across a lake, stream or building', () => {
  for (const obstruction of ['lake', 'stream', 'building'] as const) {
    const c = context();
    if (obstruction === 'lake') c.water = [rectangle(40,-50,60,50)];
    if (obstruction === 'stream') c.streams = [{ pts: [50,-100,50,100], width: 1.4 }];
    if (obstruction === 'building') c.buildings = [rectangle(40,-50,60,50)];
    const terrain = powerTerrain(town(c));
    expect(terrain.support(0,0,true)).toBe(true);
    expect(terrain.support(100,0,true)).toBe(true);
    expect(terrain.span(0,0,100,0,true,11)).toBe(false);
    expect(terrain.span(0,0,100,0,false,1.1)).toBe(false);
  }
});

function drawn(c: PowerContext, offset = 0, view = 0) {
  const set = { ...DEFAULT_SETTINGS, scale: 1000 }, cam = new Camera(set), paper = new Paper(cam);
  const B: Build = { set, cam, style: STYLES.alpine, seed: set.seed, sun: [1,0], equator: [0,-1], left: false,
    toAbs: (x,y) => [x+offset,y], key: (x,y) => [Math.round(x+offset),Math.round(y)], cell: (x,y,size) => [Math.floor((x+offset)/size),Math.floor(y/size)] };
  const M = Object.fromEntries(['water','pool','road','under','calm','green','wood','foot','shadow','title'].map(k => [k,paper.mask()])) as Masks;
  const lines: number[][] = [];
  vi.spyOn(paper, 'line3').mockImplementation((_pen, p) => { lines.push(p.map((v,i) => i%3===0 ? v+offset : v)); });
  powerLines(B,paper,town(c),M,[-2000+view-offset,-2000,2000+view-offset,2000],B.toAbs,(x,y)=>[x-offset,y]).draw(paper);
  return lines;
}

test('unknown ground and a lake emit no invented pylons or unsupported wires', () => {
  const dry = context();
  expect(drawn(dry).length).toBeGreaterThan(0);
  const unknown = context(); unknown.land = [];
  expect(drawn(unknown)).toHaveLength(0);
  const lake = context(); lake.water = lake.land;
  expect(drawn(lake)).toHaveLength(0);
});

test('power geometry in the shared interior survives a small pan and local-coordinate shift', () => {
  const a = context(), b = context();
  b.land = b.land.map(s => s.map(r => ({...r,pts:r.pts.map((v,i)=>i%2===0?v-40:v)})));
  const inner = (lines: number[][]) => lines.filter(p => p.every((v,i)=>i%3===2 || Math.abs(v)<1000)).map(p=>p.map(v=>Math.round(v*1e5)/1e5));
  const before = inner(drawn(a));
  expect(before.length).toBeGreaterThan(0);
  expect(inner(drawn(b,40,40))).toEqual(before);
});

test('roadside wires cannot jump a rejected pole across water and stay fixed when panned', () => {
  const c = context(); c.land = [];
  c.roads = Array.from({length: 10}, (_, i) => ({kind:'road' as const,cls:'minor',width:4,pts:[-200,i*20,200,i*20]}));
  c.water = [rectangle(40,-50,60,250)];
  const lines = drawn(c), wires = lines.filter(p => p.length === 39);
  expect(wires.length).toBeGreaterThan(0);
  for (const p of wires) expect(Math.min(p[0],p[p.length-3]) < 40 && Math.max(p[0],p[p.length-3]) > 60).toBe(false);
  const shifted = structuredClone(c);
  shifted.roads.forEach(w => { w.pts = w.pts.map((v,i)=>i%2===0?v-40:v); });
  shifted.water.forEach(s => s.forEach(r => { r.pts = r.pts.map((v,i)=>i%2===0?v-40:v); }));
  const rounded = (ls: number[][]) => ls.map(p=>p.map(v=>Math.round(v*1e5)/1e5));
  expect(rounded(drawn(shifted,40,40))).toEqual(rounded(lines));
});


test('transmission omits a run whose mapped land ends inside the drawing', () => {
  const c = context();
  c.land = [rectangle(-5000,-5000,0,5000)];
  const lines = drawn(c);
  // No accepted run can finish on the internal boundary x = 0.
  const wires = lines.filter(p => p.length === 39);
  for (const p of wires) {
    expect(Math.max(p[0], p[p.length-3])).toBeLessThan(0);
  }
  expect(lines.length).toBeLessThan(drawn(context()).length);
});

test('transmission endpoints must be wholly beyond the print, including their elevated tops', () => {
  const cam = new Camera({ ...DEFAULT_SETTINGS, scale: 1000, bearing: 0 });
  const far = { x: -5000, y: 0, H: 56 };
  expect(powerRunContinues(cam, far, {x:5000,y:0,H:56})).toBe(true);
  expect(powerRunContinues(cam, far, {x:0,y:0,H:56})).toBe(false);
  const y = -(cam.rect[3] + 12 - cam.cy) / (cam.sa * cam.s);
  expect(cam.sy(0,y,0)).toBeGreaterThan(cam.rect[3]);
  expect(cam.sy(0,y,56)).toBeLessThan(cam.rect[3]);
  expect(powerRunContinues(cam, far, {x:0,y,H:56})).toBe(false);
});

test('power context adds only outer tiles, with a deterministic bounded budget', () => {
  const frame = new Frame([9.0507,47.1190]);
  const box: [number,number,number,number] = [-300,-300,300,300];
  const tiles = powerContextTiles(frame,box);
  const n = 2 ** 14;
  const tx = (x:number) => Math.floor(((frame.mx0+x/frame.k)/EARTH+.5)*n);
  const ty = (y:number) => Math.floor((.5-(frame.my0+y/frame.k)/EARTH)*n);
  expect(tiles.length).toBeGreaterThan(0);
  expect(tiles.length).toBeLessThanOrEqual(16);
  expect(new Set(tiles.map(t=>t.join('/'))).size).toBe(tiles.length);
  for (const [x,y] of tiles) expect(x<tx(box[0]) || x>tx(box[2]) || y<ty(box[3]) || y>ty(box[1])).toBe(true);
  expect(powerContextTiles(frame,box)).toEqual(tiles);
  expect(powerContextTiles(frame,[-20000,-20000,20000,20000])).toHaveLength(16);
});

test('emitted roadside wires ignore feature splits and omit unsupported standalone poles', () => {
  const c=context(); c.land=[];
  c.roads=Array.from({length:10},(_,i)=>({kind:'road' as const,cls:'minor',width:4,pts:[-200,i*20,200,i*20]}));
  const before=drawn(c);
  expect(before.length).toBeGreaterThan(0);
  const split=structuredClone(c);
  split.roads=split.roads.flatMap(w=>[{...w,pts:[0,w.pts[1],w.pts[0],w.pts[1]]},{...w,pts:[w.pts[2],w.pts[3],0,w.pts[3]]}]).reverse();
  const rounded=(ls:number[][])=>ls.map(p=>p.map(v=>Math.round(v*1e5)/1e5));
  expect(rounded(drawn(split))).toEqual(rounded(before));
  // A strip across the middle leaves isolated foundations, but no complete span.
  c.water=[rectangle(-190,-100,190,300)];
  expect(drawn(c)).toHaveLength(0);
});
