/**
 * The junction lab: reads the street networks of real places, finds their junctions, and learns
 * how each kind of junction is controlled (a roundabout, traffic signals or neither) and where
 * pedestrian crossings are, by the classes of road that meet, the image-mode zone around them and
 * the regional style. `npm run junctions` drives it through `lab/junctions.mjs`, which writes the
 * tables in `src/image-junction-data.ts`.
 *
 * Junctions come from the map tiles: vertices where three or more road arms meet, with the vertices
 * of one junction (dual carriageways, slip lanes) clustered into one. Tiles carry no junction tags,
 * so what controls each one comes from OpenStreetMap through Overpass, one query per place, cached
 * on disk with the tiles: `junction=roundabout` and `circular` ways, `highway=traffic_signals` and
 * `highway=crossing` nodes.
 */
import { Frame, mercX, mercY } from '../src/geo';
import { LABELS, type Label } from '../src/image-tone';
import { detectRegion } from '../src/styles';
import type { Way } from '../src/tiles';
// Types only: at run time `./adjacency` would resolve to the runner, lab/adjacency.mjs.
import type { PlaceResult } from './adjacency';
import type { CorpusPlace } from './adjacency-places';

export { JUNCTION_CORPUS as CORPUS } from './junction-places';

/** Road classes as image mode ranks them, from the tiles' classes. */
export const RANKS = ['minor', 'tertiary', 'secondary', 'primary'] as const;
export type Rank = (typeof RANKS)[number];
const RANK_OF: Record<string, Rank> = { motorway: 'primary', trunk: 'primary', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', minor: 'minor' };
/** Junction vertices this close are one junction, m. */
const CLUSTER = 14;
/** Signals this close to a junction's middle control it, m. */
const SIGNALS_NEAR = 22;
/** A crossing this close to a junction's middle is at the junction, m. */
const AT_JUNCTION = 30;

/** One junction of a real place: the classes of its arms (highest first), its zone, how it is controlled, and a roundabout's radius. */
export type Junction = { arms: Rank[]; label: Label | 'other'; control: 'roundabout' | 'signals' | 'none'; radius?: number };
/** One pedestrian crossing: the class of road it crosses, whether at a junction and how that is controlled, and how the crossing is marked. */
export type Crossing = { rank: Rank; label: Label | 'other'; atJunction: boolean; control?: Junction['control']; kind: 'signals' | 'marked' | 'unmarked' };
export type PlaceJunctions = { style: string; junctions: Junction[]; crossings: Crossing[]; roadKm: Record<Rank, number>; roadKmByLabel: Record<string, Record<Rank, number>> };

type Element = { type: 'node' | 'way'; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] };

/** What controls the junctions of a square `half` m round a place, from Overpass. Retries politely when the server is busy. */
async function overpass(place: CorpusPlace, half: number): Promise<Element[]> {
  const frame = new Frame(place.center);
  const [w, s] = frame.toLngLat(-half, -half);
  const [e, n] = frame.toLngLat(half, half);
  const bbox = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
  const q = `[out:json][timeout:90];(way["junction"~"^(roundabout|circular)$"](${bbox});node["highway"~"^(traffic_signals|crossing|mini_roundabout)$"](${bbox}););out tags geom;`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (r.ok) return ((await r.json()) as { elements: Element[] }).elements;
    await new Promise((done) => setTimeout(done, 15000 * (attempt + 1)));
  }
  throw new Error('Overpass would not answer');
}

const rankOf = (w: Way): Rank | null => (w.kind === 'road' && !w.service ? (RANK_OF[w.cls] ?? null) : null);

/** Read one labelled place's junctions and crossings. */
export async function junctionsOf(place: CorpusPlace, r: PlaceResult): Promise<PlaceJunctions> {
  const half = (r.W * 8) / 2;
  const frame = new Frame(place.center);
  const style = (await detectRegion(place.center)).style;
  const elements = await overpass(place, half);
  const local = (lat: number, lon: number): [number, number] => [frame.x(mercX(lon)), frame.y(mercY(lat))];
  const labelAt = (x: number, y: number): Label | 'other' => {
    const i = Math.floor((x - r.x0) / 8);
    const j = Math.floor((y - r.y0) / 8);
    if (i < 0 || j < 0 || i >= r.W || j >= r.H) return 'other';
    const l = LABELS[r.label[j * r.W + i]] as Label | undefined;
    return l && ['suburb', 'rows', 'old', 'blocks', 'towers', 'works'].includes(l) ? l : 'other';
  };
  const inside = (x: number, y: number, pad: number) => Math.abs(x) < half - pad && Math.abs(y) < half - pad;

  // Road vertices, joined where ways share them, and the segments between them.
  const ways = r.town.ways.filter((w) => rankOf(w) && !w.bridge);
  const ids = new Map<string, number>();
  const xy: number[] = [];
  const id = (x: number, y: number) => {
    const k = `${Math.round(x * 2)},${Math.round(y * 2)}`;
    let v = ids.get(k);
    if (v === undefined) {
      ids.set(k, (v = xy.length / 2));
      xy.push(x, y);
    }
    return v;
  };
  const segs: [number, number, Rank][] = [];
  const roadKm = Object.fromEntries(RANKS.map((k) => [k, 0])) as Record<Rank, number>;
  const roadKmByLabel: Record<string, Record<Rank, number>> = {};
  for (const w of ways) {
    const rank = rankOf(w)!;
    for (let k = 2; k < w.pts.length; k += 2) {
      const a = id(w.pts[k - 2], w.pts[k - 1]);
      const b = id(w.pts[k], w.pts[k + 1]);
      if (a === b) continue;
      segs.push([a, b, rank]);
      const len = Math.hypot(w.pts[k] - w.pts[k - 2], w.pts[k + 1] - w.pts[k - 1]) / 1000;
      const [mx, my] = [(w.pts[k] + w.pts[k - 2]) / 2, (w.pts[k + 1] + w.pts[k - 1]) / 2];
      if (!inside(mx, my, 0)) continue;
      roadKm[rank] += len;
      const l = labelAt(mx, my);
      (roadKmByLabel[l] ??= Object.fromEntries(RANKS.map((q) => [q, 0])) as Record<Rank, number>)[rank] += len;
    }
  }
  const N = xy.length / 2;
  const deg = new Int32Array(N);
  for (const [a, b] of segs) {
    deg[a]++;
    deg[b]++;
  }
  // Junction vertices, clustered: one union-find over vertices of degree three or more within CLUSTER of each other.
  const jv = [...Array(N).keys()].filter((v) => deg[v] >= 3);
  const parent = new Map(jv.map((v) => [v, v]));
  const find = (v: number): number => {
    while (parent.get(v) !== v) v = parent.get(v)!;
    return v;
  };
  const grid = new Map<string, number[]>();
  for (const v of jv) {
    const k = `${Math.floor(xy[v * 2] / CLUSTER)},${Math.floor(xy[v * 2 + 1] / CLUSTER)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(v);
  }
  for (const v of jv) {
    const [i, j] = [Math.floor(xy[v * 2] / CLUSTER), Math.floor(xy[v * 2 + 1] / CLUSTER)];
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const u of grid.get(`${i + di},${j + dj}`) ?? [])
          if (u < v && Math.hypot(xy[u * 2] - xy[v * 2], xy[u * 2 + 1] - xy[v * 2 + 1]) < CLUSTER) parent.set(find(u), find(v));
  }
  const members = new Map<number, number[]>();
  for (const v of jv) (members.get(find(v)) ?? members.set(find(v), []).get(find(v))!).push(v);

  // Roundabouts: ring ways joined where they touch, each with its middle and radius.
  const rings: { pts: number[] }[] = [];
  for (const e of elements) if (e.type === 'way' && e.geometry) rings.push({ pts: e.geometry.flatMap((g) => local(g.lat, g.lon)) });
  const ringOf = rings.map((_, i) => i);
  const rf = (i: number): number => (ringOf[i] === i ? i : (ringOf[i] = rf(ringOf[i])));
  for (let a = 0; a < rings.length; a++)
    for (let b = a + 1; b < rings.length; b++) {
      const p = rings[a].pts;
      const q = rings[b].pts;
      const ends = [[p[0], p[1]], [p[p.length - 2], p[p.length - 1]]];
      if (ends.some(([x, y]) => Math.hypot(x - q[0], y - q[1]) < 1 || Math.hypot(x - q[q.length - 2], y - q[q.length - 1]) < 1)) ringOf[rf(a)] = rf(b);
    }
  const groups = new Map<number, number[]>();
  rings.forEach((g, i) => (groups.get(rf(i)) ?? groups.set(rf(i), []).get(rf(i))!).push(...g.pts));
  const roundabouts: { x: number; y: number; r: number }[] = [];
  for (const pts of groups.values()) {
    let [x, y] = [0, 0];
    for (let k = 0; k < pts.length; k += 2) [x, y] = [x + pts[k], y + pts[k + 1]];
    [x, y] = [x / (pts.length / 2), y / (pts.length / 2)];
    let rad = 0;
    for (let k = 0; k < pts.length; k += 2) rad += Math.hypot(pts[k] - x, pts[k + 1] - y);
    rad /= pts.length / 2;
    // A long `circular` road round a whole district is no roundabout.
    if (rad > 80) continue;
    roundabouts.push({ x, y, r: rad });
  }

  const junctions: Junction[] = [];
  // Each junction's middle, how it is controlled, and how far out its crossings are measured from (a roundabout's ring).
  const centres: [number, number, Junction['control'], number][] = [];
  // A roundabout is one junction: its arms are the roads crossing a circle a little outside it.
  for (const rb of roundabouts) {
    if (!inside(rb.x, rb.y, 60)) continue;
    const R = rb.r + 8;
    const arms: Rank[] = [];
    for (const [a, b, rank] of segs) {
      const da = Math.hypot(xy[a * 2] - rb.x, xy[a * 2 + 1] - rb.y);
      const db = Math.hypot(xy[b * 2] - rb.x, xy[b * 2 + 1] - rb.y);
      if ((da < R) !== (db < R)) arms.push(rank);
    }
    if (arms.length < 3) continue;
    arms.sort((p, q) => RANKS.indexOf(q) - RANKS.indexOf(p));
    junctions.push({ arms, label: labelAt(rb.x, rb.y), control: 'roundabout', radius: rb.r });
    centres.push([rb.x, rb.y, 'roundabout', rb.r]);
  }
  const signals = elements.filter((e) => e.type === 'node' && e.tags?.highway === 'traffic_signals').map((e) => local(e.lat!, e.lon!));
  for (const vs of members.values()) {
    let [x, y] = [0, 0];
    for (const v of vs) [x, y] = [x + xy[v * 2], y + xy[v * 2 + 1]];
    [x, y] = [x / vs.length, y / vs.length];
    if (!inside(x, y, 60)) continue;
    // Junctions on or by a roundabout are part of it.
    if (roundabouts.some((rb) => Math.hypot(rb.x - x, rb.y - y) < rb.r + 12)) continue;
    const set = new Set(vs);
    const arms: Rank[] = [];
    for (const [a, b, rank] of segs) if (set.has(a) !== set.has(b)) arms.push(rank);
    if (arms.length < 3) continue;
    arms.sort((p, q) => RANKS.indexOf(q) - RANKS.indexOf(p));
    const lit = signals.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < SIGNALS_NEAR);
    junctions.push({ arms, label: labelAt(x, y), control: lit ? 'signals' : 'none' });
    centres.push([x, y, lit ? 'signals' : 'none', 0]);
  }

  // Crossings: the road each is on, whether at a junction, and how it is marked.
  const crossings: Crossing[] = [];
  for (const e of elements) {
    if (e.type !== 'node' || e.tags?.highway !== 'crossing') continue;
    const [x, y] = local(e.lat!, e.lon!);
    if (!inside(x, y, 60)) continue;
    let best = 4;
    let rank: Rank | null = null;
    for (const w of ways)
      for (let k = 2; k < w.pts.length; k += 2) {
        const [ax, ay, bx, by] = [w.pts[k - 2], w.pts[k - 1], w.pts[k], w.pts[k + 1]];
        if (Math.min(ax, bx) > x + best || Math.max(ax, bx) < x - best || Math.min(ay, by) > y + best || Math.max(ay, by) < y - best) continue;
        const dx = bx - ax;
        const dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
        if (d < best) [best, rank] = [d, rankOf(w)];
      }
    if (!rank) continue;
    const t = e.tags;
    const how = t.crossing ?? '';
    const kind: Crossing['kind'] =
      how === 'traffic_signals' || t['crossing:signals'] === 'yes' ? 'signals' : how === 'unmarked' || how === 'no' || t['crossing:markings'] === 'no' ? 'unmarked' : how === 'marked' || how === 'zebra' || how === 'uncontrolled' || t.crossing_ref || (t['crossing:markings'] && t['crossing:markings'] !== 'no') ? 'marked' : 'unmarked';
    let control: Junction['control'] | undefined;
    let nearest = AT_JUNCTION;
    for (const [cx, cy, c, out] of centres) {
      const d = Math.hypot(cx - x, cy - y) - out;
      if (d < nearest) [nearest, control] = [d, c];
    }
    crossings.push({ rank, label: labelAt(x, y), atJunction: !!control, control, kind });
  }
  return { style, junctions, crossings, roadKm, roadKmByLabel };
}
