/**
 * Junctions in image mode: which are roundabouts, which have traffic signals, and where people
 * cross, as real towns do it (`image-junction-data.ts`, learnt by `npm run junctions`). A
 * roundabout is built into the street graph as a ring of short edges round an island; signals and
 * crossings go to `Town.controls` for the renderer to draw.
 */
import { JUNCTIONS, type JunctionStyle } from './image-junction-data';
import type { Graph, GraphEdge } from './image-streets';
import { ROAD_WIDTH, type Controls, type Way } from './tiles';
import type { Label } from './image-tone';

/** A roundabout laid into the street graph: its middle, centre-line radius, class and ring, closed. */
export type Roundabout = { x: number; y: number; r: number; cls: string; pts: number[] };
/** Street classes from quietest to busiest, as the learnt tables index them. */
const RANKS = ['minor', 'tertiary', 'secondary', 'primary'];
const rankOf = (cls: string) => Math.max(0, RANKS.indexOf(cls === 'service' ? 'minor' : cls));
/** A roundabout's island keeps at least this much beyond the carriageway, m. */
const ISLAND = 4;
/** Arms meet the ring at least this far apart along it, m, and at least this square to it, degrees: square enough that the ring's chords still meet them at more than the streets' 35°. */
const ARM_GAP = 9;
const ARM_ANGLE = 60;
/** Crossings stand at least this far in from the junction they serve, and 2.5 m beyond the kerb of the widest street there, m; those between junctions this far from any other. */
const IN_FROM = 6;
const APART = 45;

const reverse = (p: number[]) => {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
};
const lengthOf = (p: number[]) => {
  let l = 0;
  for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return l;
};

/** The learnt habits of a regional style, or the pooled ones where the corpus says too little about it. */
function habits(style: string): JunctionStyle {
  return JUNCTIONS.styles[style] ?? JUNCTIONS.styles.all;
}
/** The learnt table's zone, from a zone label. */
const zoneOf = (label: Label | undefined): string => (label && label in JUNCTIONS.styles.all.signals ? label : 'other');

/**
 * How a junction is controlled, from the classes of its arms, the zone round it and the regional
 * style: the chance of each from the learnt tables, and `pick` (a hash in [0, 1)) choosing.
 */
export function controlOf(arms: string[], label: Label | undefined, style: string, pick: number): 'roundabout' | 'signals' | 'none' {
  const h = habits(style);
  const r = arms.map(rankOf).sort((a, b) => b - a);
  const key = `${r[0]}${r[1]}${Math.min(arms.length, 4)}`;
  const zone = zoneOf(label);
  const round = h.roundabout[zone]?.[key] ?? h.roundabout.other?.[key] ?? 0;
  const lit = (h.signals[zone]?.[key] ?? h.signals.other?.[key] ?? 0) * (1 - round);
  return pick < round ? 'roundabout' : pick < round + lit ? 'signals' : 'none';
}

/** A roundabout's centre-line radius for its busiest arm, m: the learnt spread of real ones, `pick` choosing. */
export function radiusOf(cls: string, width: number, style: string, pick: number): number {
  const [lo, hi] = habits(style).radius[rankOf(cls)];
  return Math.max(width / 2 + ISLAND, lo + (hi - lo) * pick);
}

/**
 * Lay a roundabout of radius `r` in place of junction `v`: each arm cut where it meets the ring,
 * the ring added as one edge per stretch between arms. Null, leaving the graph as it was, where
 * an arm is too short, two arms meet the ring too close together or too obliquely, another
 * junction stands too near, or the ring would cross water.
 */
export function makeRoundabout(g: Graph, v: number, r: number, cls: string, water: (x: number, y: number) => boolean): Roundabout | null {
  const [x, y] = [g.nodes[v * 2], g.nodes[v * 2 + 1]];
  const arms = g.edges.filter((e) => (e.a === v) !== (e.b === v));
  if (arms.length < 3 || g.edges.some((e) => e.a === v && e.b === v)) return null;
  for (let k = 0; k < 24; k++) {
    const t = (k / 24) * 2 * Math.PI;
    if (water(x + (r + 6) * Math.cos(t), y + (r + 6) * Math.sin(t))) return null;
  }
  for (let u = 0; u < g.nodes.length / 2; u++) if (u !== v && Math.hypot(g.nodes[u * 2] - x, g.nodes[u * 2 + 1] - y) < r + 12) return null;
  type Cut = { e: GraphEdge; from: boolean; at: [number, number]; rest: number[]; t: number };
  const cuts: Cut[] = [];
  for (const e of arms) {
    const from = e.a === v;
    const p = from ? e.pts : reverse(e.pts);
    let at: [number, number] | null = null;
    let k = 2;
    for (; k < p.length; k += 2) {
      const [ax, ay, bx, by] = [p[k - 2], p[k - 1], p[k], p[k + 1]];
      if (Math.hypot(bx - x, by - y) < r) continue;
      // Where the segment leaves the circle.
      const dx = bx - ax;
      const dy = by - ay;
      const fx = ax - x;
      const fy = ay - y;
      const A = dx * dx + dy * dy;
      const B = 2 * (fx * dx + fy * dy);
      const C = fx * fx + fy * fy - r * r;
      const s = (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A || 1);
      at = [ax + dx * s, ay + dy * s];
      break;
    }
    if (!at) return null;
    const rest = [at[0], at[1], ...p.slice(k)];
    // Long enough that the streets' rules still hold (§10.5): junctions 20 m apart, dead ends 25 m long.
    if (lengthOf(rest) < 25) return null;
    // The arm must leave the ring roughly square, not graze it.
    let q = 2;
    while (q + 2 < rest.length && Math.hypot(rest[q] - rest[0], rest[q + 1] - rest[1]) < 8) q += 2;
    const ox = rest[q] - at[0];
    const oy = rest[q + 1] - at[1];
    const radial = ((at[0] - x) * ox + (at[1] - y) * oy) / (r * (Math.hypot(ox, oy) || 1));
    if (radial < Math.cos(((90 - ARM_ANGLE) * Math.PI) / 180)) return null;
    cuts.push({ e, from, at, rest, t: Math.atan2(at[1] - y, at[0] - x) });
  }
  cuts.sort((a, b) => a.t - b.t);
  for (let i = 0; i < cuts.length; i++) {
    const gap = (cuts[(i + 1) % cuts.length].t - cuts[i].t + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    if (gap * r < ARM_GAP) return null;
  }
  // Cut the arms, then run the ring counter-clockwise from arm to arm.
  const ids = cuts.map((c) => {
    const id = g.nodes.length / 2;
    g.nodes.push(c.at[0], c.at[1]);
    if (c.from) {
      c.e.a = id;
      c.e.pts = c.rest;
    } else {
      c.e.b = id;
      c.e.pts = reverse(c.rest);
    }
    return id;
  });
  const ring: number[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const j = (i + 1) % cuts.length;
    const t0 = cuts[i].t;
    const span = (cuts[j].t - t0 + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    const n = Math.max(2, Math.ceil((span * r) / 4));
    const pts = [...cuts[i].at];
    for (let s = 1; s < n; s++) pts.push(x + r * Math.cos(t0 + (span * s) / n), y + r * Math.sin(t0 + (span * s) / n));
    pts.push(...cuts[j].at);
    g.edges.push({ a: ids[i], b: ids[j], pts, cls, main: false, ring: true });
    ring.push(...pts.slice(0, -2));
  }
  ring.push(ring[0], ring[1]);
  return { x, y, r, cls, pts: ring };
}

/**
 * Where people cross the streets, and which crossings have signals: at each arm of a junction a
 * little way in, as often as real towns of the style mark one there, and between junctions at the
 * rate they do per kilometre of each class, `vary` choosing. Junctions with signals light their
 * crossings; a crossing between junctions has its own signals as often as real ones do.
 */
export function crossingsOf(ways: Way[], signals: number[], roundabouts: Roundabout[], zoneAt: (x: number, y: number) => Label | undefined, style: string, vary: (x: number, y: number, salt: number) => number): Controls['crossings'] {
  const h = habits(style);
  const lit = (x: number, y: number) => {
    for (let k = 0; k < signals.length; k += 2) if (Math.hypot(signals[k] - x, signals[k + 1] - y) < 1) return true;
    return false;
  };
  // Way ends meeting at a point, so a street's end is known to be a junction.
  const key = (x: number, y: number) => `${Math.round(x * 2)},${Math.round(y * 2)}`;
  const meet = new Map<string, number>();
  // And how far the widest of them reaches from the junction's middle, so crossings start beyond it.
  const reach = new Map<string, number>();
  for (const w of ways) {
    if (w.kind !== 'road' || w.bridge) continue;
    for (const k of [key(w.pts[0], w.pts[1]), key(w.pts[w.pts.length - 2], w.pts[w.pts.length - 1])]) {
      meet.set(k, (meet.get(k) ?? 0) + 1);
      reach.set(k, Math.max(reach.get(k) ?? 0, w.width / 2));
    }
  }
  const onRing = (x: number, y: number) => roundabouts.some((o) => Math.abs(Math.hypot(o.x - x, o.y - y) - o.r) < 1);
  const out: Controls['crossings'] = [];
  const near = (x: number, y: number, d: number) => out.some((c) => Math.hypot(c.x - x, c.y - y) < d);
  for (const w of ways) {
    if (w.kind !== 'road' || w.bridge || w.pts.length < 4 || onRing(w.pts[2], w.pts[3])) continue;
    const p = w.pts;
    const cum = [0];
    for (let k = 2; k < p.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(p[k] - p[k - 2], p[k + 1] - p[k - 1]));
    const L = cum[cum.length - 1];
    const at = (d: number): [number, number] => {
      let k = 1;
      while (k < cum.length - 1 && cum[k] < d) k++;
      const t = (d - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
      return [p[k * 2 - 2] + (p[k * 2] - p[k * 2 - 2]) * t, p[k * 2 - 1] + (p[k * 2 + 1] - p[k * 2 - 1]) * t];
    };
    const rank = rankOf(w.cls);
    for (const [ex, ey, from] of [
      [p[0], p[1], 1],
      [p[p.length - 2], p[p.length - 1], -1],
    ] as const) {
      const ring = onRing(ex, ey);
      const junction = (meet.get(key(ex, ey)) ?? 0) >= 2 || ring;
      if (!junction) continue;
      // Beyond the kerb of the widest street there, or of a roundabout's ring.
      const width = ring ? Math.max(...roundabouts.filter((o) => Math.abs(Math.hypot(o.x - ex, o.y - ey) - o.r) < 1).map((o) => ROAD_WIDTH[o.cls] ?? ROAD_WIDTH.minor)) / 2 : (reach.get(key(ex, ey)) ?? 0);
      const inFrom = Math.max(IN_FROM, width + 2.5);
      if (L < 2 * inFrom + 4) continue;
      const d = from > 0 ? inFrom : L - inFrom;
      const signalled = lit(ex, ey);
      const [x, y] = at(d);
      const zone = zoneOf(zoneAt(x, y));
      const chance = signalled ? h.crossAtSignals[rank] : (h.crossAtJunction[zone]?.[rank] ?? 0);
      if (vary(x, y, 14952) >= chance || near(x, y, 8)) continue;
      out.push({ x, y, kind: signalled ? 'signals' : 'zebra' });
    }
    // Between junctions, at the learnt rate per kilometre, spaced along the street.
    const zone = zoneOf(zoneAt(...at(L / 2)));
    const perKm = h.crossPerKm[zone]?.[rank] ?? 0;
    for (let d = APART; d < L - APART; d += APART) {
      const [x, y] = at(d);
      if (vary(x, y, 14953) >= (perKm * APART) / 1000 || near(x, y, APART)) continue;
      out.push({ x, y, kind: vary(x, y, 14954) < h.signalsBetween[rank] ? 'signals' : 'zebra' });
    }
  }
  return out;
}
