import type { Way } from './tiles';
import { at, measure } from './infra';

const ROADS = new Set(['primary', 'secondary', 'tertiary', 'minor', 'service']);
const PRIVATE = new Set(['driveway', 'parking_aisle', 'drive-through']);

/** Join compatible road ends into unbranched, consistently oriented power routes. */
export function powerRoads(roads: Way[], key: (x: number, y: number) => [number, number]): Way[] {
  const ways = roads.filter(w => w.kind === 'road' && ROADS.has(w.cls) && !PRIVATE.has(w.service ?? '') && !w.bridge && w.pts.length >= 4);
  const ends = new Map<string, number[]>();
  const point = (e: number) => { const p = ways[e >> 1].pts, i = e % 2 ? p.length - 2 : 0; return [p[i], p[i + 1]]; };
  const direction = (e: number) => {
    const p = ways[e >> 1].pts, i = e % 2 ? p.length - 2 : 0, j = e % 2 ? i - 2 : 2;
    const x = p[j] - p[i], y = p[j + 1] - p[i + 1], l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  for (let e = 0; e < ways.length * 2; e++) {
    const [x,y] = point(e), k = `${Math.floor(x)},${Math.floor(y)}`, list = ends.get(k);
    if (list) list.push(e); else ends.set(k,[e]);
  }
  const links = new Map<number, number>();
  for (let e = 0; e < ways.length * 2; e++) {
    const [x,y] = point(e), list: number[] = [];
    // Search neighbouring metre cells, then measure the gap: rounded keys can split the same junction.
    for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) {
      list.push(...(ends.get(`${Math.floor(x)+dx},${Math.floor(y)+dy}`) ?? []));
    }
    const w = ways[e >> 1], [ux,uy] = direction(e);
    const matches = list.filter(f => {
      const v = ways[f >> 1], [px,py] = point(f), distance = Math.hypot(px-x,py-y);
      const [vx,vy] = direction(f);
      // Small tile seams may join only in the same direction; nearby parallel roads must stay separate.
      return (f >> 1) !== (e >> 1) && v.cls === w.cls && Math.abs(v.width - w.width) < 0.5 &&
        distance <= 0.75 && (distance < 0.05 || -(ux*vx+uy*vy) > 0.85);
    }).map(f => { const [vx,vy] = direction(f); return { f, dot: -(ux * vx + uy * vy) }; }).sort((a,b) => b.dot - a.dot);
    // A simple bend can turn ninety degrees. At a fork only an unambiguous straight continuation wins.
    if ((matches.length === 1 && matches[0].dot > -0.1) || (matches.length > 1 && matches[0].dot > 0.85 && matches[0].dot - matches[1].dot > 0.2)) links.set(e,matches[0].f);
  }
  for (const [e,f] of links) if (links.get(f) !== e) links.delete(e);
  const compare = (a:number,b:number) => { const [ax,ay]=point(a),[bx,by]=point(b), A=key(ax,ay),B=key(bx,by); return A[0]-B[0] || A[1]-B[1]; };
  const ordered = Array.from({length:ways.length*2},(_,i)=>i).sort((a,b) => Number(links.has(a))-Number(links.has(b)) || compare(a,b) || direction(a)[0]-direction(b)[0] || direction(a)[1]-direction(b)[1]);
  const used = new Set<number>(), out: Way[] = [];
  for (const start of ordered) {
    if (used.has(start >> 1)) continue;
    const pts: number[] = [];
    let e = start;
    while (!used.has(e >> 1)) {
      const w = ways[e >> 1], p = w.pts;
      used.add(e >> 1);
      for (let k=0; k<p.length; k+=2) {
        const i = e % 2 ? p.length - 2 - k : k;
        if (k === 0 && pts.length) continue;
        pts.push(p[i],p[i+1]);
      }
      const next = links.get(e ^ 1);
      if (next === undefined) break;
      e = next;
    }
    out.push({...ways[start >> 1],pts});
  }
  return out;
}

/** Evenly spaced roadside supports, with dedicated poles at bends and no close pairs beside them. */
export function roadsideSupports(w: Way, side: number, spacing: number): number[][] {
  const p = w.pts, offset = w.width / 2 + 1, q: number[] = [], corners: number[] = [];
  for (let i=0; i<p.length; i+=2) {
    const a=Math.max(0,i-2),b=Math.min(p.length-2,i+2);
    let ux=p[i]-p[a],uy=p[i+1]-p[a+1],vx=p[b]-p[i],vy=p[b+1]-p[i+1];
    let l=Math.hypot(ux,uy),m=Math.hypot(vx,vy);
    if (!l) { ux=vx;uy=vy;l=m; } if (!m) { vx=ux;vy=uy;m=l; }
    if (!l || !m) continue;
    ux/=l;uy/=l;vx/=m;vy/=m;
    const dot=ux*vx+uy*vy, den=Math.max(0.5,1+dot);
    q.push(p[i]-(uy+vy)*side*offset/den,p[i+1]+(ux+vx)*side*offset/den);
    if (i>0 && i<p.length-2 && dot<0.94) corners.push(q.length/2-1);
  }
  if (q.length<4) return [];
  const cum=measure(q), L=cum[cum.length-1], bends=corners.map(i=>cum[i]);
  const distances=[...bends];
  for (let d=6;d<=L-4;d+=spacing) if (bends.every(b=>Math.abs(b-d)>spacing*.35)) distances.push(d);
  distances.sort((a,b)=>a-b);
  return distances.map(d=> {
    const [x,y,ux,uy]=at(q,cum,d);
    return [x,y,-uy*side,ux*side];
  });
}


/** A route's westernmost vertex anchors its choices to geometry rather than a feature boundary. */
export function roadAnchor(w: Way): [number, number] {
  const p = w.pts;
  let at = 0;
  for (let i=2; i<p.length; i+=2) if (p[i]<p[at] || (p[i]===p[at] && p[i+1]<p[at+1])) at=i;
  return [p[at],p[at+1]];
}

/** Suppress short rural pockets beside a settlement, independently of route traversal direction. */
export function ruralSupports(poles: number[][], urban: (x: number, y: number) => number): boolean[] {
  const allowed = poles.map(([x,y]) => urban(x,y) <= 0.15);
  for (let start=0; start<allowed.length;) {
    if (!allowed[start]) { start++; continue; }
    let end=start+1, length=0;
    while (end<allowed.length && allowed[end]) {
      length+=Math.hypot(poles[end][0]-poles[end-1][0],poles[end][1]-poles[end-1][1]);
      end++;
    }
    // A few low-density samples among houses do not justify restarting an overhead route.
    if ((start>0 || end<allowed.length) && length<150) for(let i=start;i<end;i++) allowed[i]=false;
    start=end;
  }
  return allowed;
}
