import { expect, test } from 'vitest';
import { powerRoads, roadsideSupports, ruralSupports, roadAnchor } from '@/power-roads';
import type { Way } from '@/tiles';

const key = (x:number,y:number):[number,number] => [Math.round(x),Math.round(y)];
const road = (pts:number[], more:Partial<Way>={}):Way => ({kind:'road',cls:'minor',width:4,pts,...more});
const rounded = (ps:number[][]) => ps.map(p=>p.map(x=>Math.round(x*1e6)/1e6));

test('splitting, reversing and reordering road features preserves the route and pole placement', () => {
  const whole = powerRoads([road([0,0,100,0,200,0,300,0])],key);
  const split = powerRoads([road([300,0,200,0]),road([100,0,0,0]),road([100,0,200,0])],key);
  expect(split).toEqual(whole);
  expect(rounded(roadsideSupports(split[0],1,38))).toEqual(rounded(roadsideSupports(whole[0],1,38)));
  const shifted = split.map(w=>({...w,pts:w.pts.map((v,i)=>i%2?v:v-47)}));
  const panned=powerRoads(shifted,(x,y)=>key(x+47,y));
  expect(rounded(roadsideSupports(panned[0],1,38).map(([x,y,nx,ny])=>[x+47,y,nx,ny]))).toEqual(rounded(roadsideSupports(whole[0],1,38)));
});

test('a straight main road continues past a side road, while an ambiguous fork remains separate', () => {
  const straight=powerRoads([road([-100,0,0,0]),road([0,0,100,0]),road([0,0,0,100])],key);
  expect(straight).toHaveLength(2);
  expect(straight.some(w=>w.pts.join(',')==='-100,0,0,0,100,0')).toBe(true);
  expect(powerRoads([road([-100,0,0,0]),road([0,0,100,60]),road([0,0,100,-60])],key)).toHaveLength(3);
});

test('road bridges, private accesses and incompatible classes do not extend a route', () => {
  const routes=powerRoads([road([0,0,100,0]),road([100,0,200,0],{bridge:true}),road([100,0,100,100],{service:'driveway'}),road([0,0,-100,0],{cls:'primary'})],key);
  expect(routes).toHaveLength(2);
  expect(routes.every(w=>w.pts.length===4)).toBe(true);
});

test('a right angle gets a corner support with clear, short spans on either side', () => {
  const route=powerRoads([road([100,0,100,100]),road([0,0,100,0])],key)[0];
  const poles=roadsideSupports(route,1,38), corner=poles.findIndex(p=>Math.abs(p[0]-97)<1e-6&&Math.abs(p[1]-3)<1e-6);
  expect(corner).toBeGreaterThan(0);
  expect(corner).toBeLessThan(poles.length-1);
  for(let i=1;i<poles.length;i++) {
    expect(Math.hypot(poles[i][0]-poles[i-1][0],poles[i][1]-poles[i-1][1])).toBeLessThan(38*1.5);
    expect(poles[i-1][1]===3 || poles[i-1][0]===97).toBe(true);
  }
});

test('closed routes are traversed once and do not loop indefinitely', () => {
  const routes=powerRoads([road([0,0,100,0]),road([100,0,100,100]),road([100,100,0,100]),road([0,100,0,0])],key);
  expect(routes).toHaveLength(1);
  expect(routes[0].pts).toHaveLength(10);
});


test('submetre endpoint gaps join across rounded keys and spatial cell boundaries', () => {
  const ways=[road([-100,0,0.4,0]),road([0.61,0,100,0])];
  const route=powerRoads(ways,key);
  expect(key(.4,0)).not.toEqual(key(.61,0));
  expect(route).toHaveLength(1);
  expect(powerRoads([...ways].reverse(),key)).toEqual(route);
  const shifted=ways.map(w=>({...w,pts:w.pts.map((v,i)=>i%2?v:v-.53)}));
  const moved=powerRoads(shifted,(x,y)=>key(x+.53,y));
  expect(rounded(moved.map(w=>w.pts.map((v,i)=>i%2?v:v+.53)))).toEqual(rounded(route.map(w=>w.pts)));
});

test('nearby endpoints still need matching direction and distance', () => {
  expect(powerRoads([road([-100,0,0,0]),road([.21,0,-100,.21])],key)).toHaveLength(2);
  expect(powerRoads([road([-100,0,0,0]),road([.8,0,100,0])],key)).toHaveLength(2);
  expect(powerRoads([road([-100,0,0,0]),road([.21,0,0,100])],key)).toHaveLength(2);
});

test('route choices use a geometric anchor regardless of which end is first', () => {
  const w=road([100,0,0,100,200,200]);
  expect(roadAnchor(w)).toEqual([0,100]);
  expect(roadAnchor(road([200,200,0,100,100,0]))).toEqual([0,100]);
});

test('village transitions suppress short rural restarts in either direction', () => {
  const poles=Array.from({length:20},(_,i)=>[i*38,0]);
  const density=[0,0,0,0,0,0,.3,.3,0,0,.3,.3,0,0,0,0,0,.3,0,0];
  const urban=(x:number)=>density[Math.round(x/38)];
  const accepted=ruralSupports(poles,urban);
  expect(accepted.slice(0,6)).toEqual(Array(6).fill(true));
  expect(accepted.slice(8,10)).toEqual([false,false]);
  expect(accepted.slice(12,17)).toEqual(Array(5).fill(true));
  expect(accepted.slice(18)).toEqual([false,false]);
  expect(ruralSupports([...poles].reverse(),urban).reverse()).toEqual(accepted);
  expect(ruralSupports(poles,()=>0)).toEqual(Array(20).fill(true));
});
