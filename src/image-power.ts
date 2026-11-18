import { at, measure } from './infra';
import type { Way } from './tiles';

/** Occupied neighbourhoods of an image settlement, in local metres. */
type District = { i: number; j: number; x: number; y: number; count: number; load: number; settlement?: Settlement };
/** An image settlement and the neighbourhoods its electricity supply serves. */
export type Settlement = { tier: 'village' | 'town' | 'city'; districts: District[] };
const size = 64;
const key = (i: number, j: number) => i + ',' + j;

/** Group neighbouring building footprints and estimate the demand each connected settlement serves. */
export function imagePower(built: number[]) {
  const cells = new Map<string, District>();
  for (let k = 0; k < built.length; k += 3) {
    const x = built[k], y = built[k + 1], area = built[k + 2];
    if (area < 24) continue;
    const i = Math.floor(x / size), j = Math.floor(y / size), id = key(i, j);
    const d = cells.get(id) ?? { i, j, x: 0, y: 0, count: 0, load: 0 };
    d.x += x; d.y += y; d.count++;
    d.load += Math.min(8, Math.max(0.5, area / 120));
    cells.set(id, d);
  }
  const settlements: Settlement[] = [];
  for (const first of cells.values()) {
    if (first.settlement) continue;
    const settlement: Settlement = { tier: 'village', districts: [first] };
    first.settlement = settlement;
    let load = 0, count = 0;
    for (const d of settlement.districts) {
      d.x /= d.count; d.y /= d.count;
      count += d.count; load += d.load;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const other = cells.get(key(d.i + di, d.j + dj));
        if (!other || other.settlement) continue;
        other.settlement = settlement;
        settlement.districts.push(other);
      }
    }
    if (count >= 220 && load >= 320) settlement.tier = 'city';
    else if (count >= 30 && load >= 38) settlement.tier = 'town';
    if (count >= 3) settlements.push(settlement);
    else for (const d of settlement.districts) cells.delete(key(d.i, d.j));
  }
  function near(x: number, y: number) {
    let distance = 95, result: Settlement | undefined;
    const i = Math.floor(x / size), j = Math.floor(y / size);
    for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
      const d = cells.get(key(i + di, j + dj));
      if (!d) continue;
      const r = Math.hypot(d.x - x, d.y - y);
      if (r < distance) { distance = r; result = d.settlement; }
    }
    return result;
  }
  return { settlements, near };
}

/** Plan whole roadside feeders between street ends or junctions. Only commit a route once every span fits. */
export function imageFeeders(ways: Way[], grid: ReturnType<typeof imagePower>, visible: (x: number, y: number) => boolean,
  support: (x: number, y: number) => boolean, span: (a: number[], b: number[], width: number) => boolean,
  preferredSide: (w: Way) => number, readable: (height: number) => boolean) {
  const candidates = [];
  for (const w of ways) {
    const cum = measure(w.pts), length = cum[cum.length - 1];
    if (length < 72 || (w.pts[0] === w.pts.at(-2) && w.pts[1] === w.pts.at(-1))) continue;
    const demand = new Map<Settlement, number>();
    let onSheet = 0;
    for (let d = 0; d < length; d += 25) {
      const [x, y] = at(w.pts, cum, d);
      if (!visible(x, y)) continue;
      onSheet++;
      const local = grid.near(x, y);
      if (local) demand.set(local, (demand.get(local) ?? 0) + 1);
    }
    const [customer, served] = [...demand].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!customer || served < 2) continue;
    const village = customer.tier === 'village', H = village ? 7.5 : 13;
    if (!readable(H)) continue;
    // Each visible terminal serves a built-up street. An incoming feeder may also enter from the sheet edge.
    const ends = [0, w.pts.length - 2];
    if (ends.some(i => visible(w.pts[i], w.pts[i+1]) && !grid.near(w.pts[i], w.pts[i+1]))) continue;
    candidates.push({ w, cum, length, customer, H, rank: served + Math.min(8, onSheet) * 0.25 });
  }

  const routes = [], counts = new Map<Settlement, number>();
  for (const c of candidates.sort((a, b) => b.rank - a.rank)) {
    const { customer, w, cum, length, H } = c, used = counts.get(customer) ?? 0;
    const village = customer.tier === 'village', spacing = village ? 30 : 48;
    if (used >= (village ? 1 : customer.tier === 'town' ? 2 : 3)) continue;
    const reach = village ? 0.65 : 1.8, side = preferredSide(w);
    const inset = Math.max(8, w.width), anchors = [inset];
    // Keep an angle pole at pronounced bends. Divide each reach evenly up to the next bend or terminal.
    for (let i = 1; i < cum.length - 1; i++) {
      const d = cum[i];
      if (d - anchors[anchors.length - 1] < 7 || length - inset - d < 7) continue;
      const [, , ux, uy] = at(w.pts, cum, d - 0.1), [, , vx, vy] = at(w.pts, cum, d + 0.1);
      if (ux * vx + uy * vy < 0.94) anchors.push(d);
    }
    anchors.push(length - inset);
    const slots = [inset];
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i-1], delta = anchors[i] - a, n = Math.ceil(delta / spacing);
      for (let j = 1; j <= n; j++) slots.push(a + delta * j / n);
    }
    type Step = { pole: number[]; bank: number; cost: number; prev?: Step };
    let states: Step[] = [];
    for (let i = 0; i < slots.length; i++) {
      const next: Step[] = [];
      const shift = Math.min(6, (slots[i] - (slots[i-1] ?? 0)) / 3, ((slots[i+1] ?? length) - slots[i]) / 3);
      for (const bank of [side, -side]) for (const slide of [0, shift, -shift]) {
        const [x, y, ux, uy] = at(w.pts, cum, slots[i] + slide);
        const offset = bank * (w.width / 2 + 1.2), px = x - uy * offset, py = y + ux * offset;
        if (!support(px, py)) continue;
        // Orient all crossarms consistently, even where a line crosses to the opposite verge.
        const pole = [px, py, -uy, ux], penalty = Math.abs(slide) * 0.1 + (bank === side ? 0 : 0.01);
        if (!i) { next.push({ pole, bank, cost: penalty }); continue; }
        const options = states.map(prev => ({ prev, cost: prev.cost + penalty + (bank === prev.bank ? 0 : 10) })).sort((a,b) => a.cost - b.cost);
        const best = options.find(({ prev }) => Math.hypot(px - prev.pole[0], py - prev.pole[1]) <= spacing * 1.5 && span(prev.pole, pole, reach));
        if (best) next.push({ pole, bank, ...best });
      }
      states = next;
      if (!states.length) break;
    }
    if (!states.length) continue;
    const poles = [];
    for (let s: Step | undefined = states.sort((a,b) => a.cost-b.cost)[0]; s; s = s.prev) poles.push(s.pole);
    if (poles.length < 3) continue;
    routes.push({ poles: poles.reverse(), H, village, reach, spacing, side: 1 });
    counts.set(customer, used + 1);
  }
  return routes;
}
