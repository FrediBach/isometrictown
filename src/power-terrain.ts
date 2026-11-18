import { pointInRing } from './geo';
import type { PowerContext, Shape, Town } from './tiles';

type Check = { box: number[]; contains: (x: number, y: number) => boolean };

/** World-space evidence for inferred power routes; absence of a screen mask is never evidence of land. */
export function powerTerrain(town: Town, image = false) {
  const context: PowerContext = town.powerContext ?? {
    land: [...town.green, ...town.wood, ...town.landuse.map((a) => a.shape), ...town.cover.map((a) => a.shape)],
    water: [...town.water, ...town.pools], buildings: town.buildings.map((b) => b.shape),
    roads: town.ways.filter((w) => w.kind === 'road'), streams: town.streams, airfields: town.aprons,
  };
  const bounds = (p: number[], pad = 0) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  };
  const polygons = (shapes: Shape[]): Check[] => shapes.map((s) => ({ box: bounds(s[0].pts), contains: (x, y) => pointInRing(x, y, s[0].pts) && !s.some((r, i) => i > 0 && pointInRing(x, y, r.pts)) }));
  const strips = (ways: { pts: number[]; width: number }[]): Check[] => ways.flatMap((w) => {
    const out: Check[] = [], p = w.pts, half = w.width / 2;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], ay = p[i + 1], dx = p[i + 2] - ax, dy = p[i + 3] - ay, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      out.push({ box: bounds([ax, ay, ax + dx, ay + dy], half), contains: (x, y) => {
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
        return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= half * half;
      } });
    }
    return out;
  });
  const index = (checks: Check[]) => {
    const cells = new Map<string, Check[]>(), size = 100;
    for (const c of checks) for (let i = Math.floor(c.box[0] / size); i <= Math.floor(c.box[2] / size); i++) for (let j = Math.floor(c.box[1] / size); j <= Math.floor(c.box[3] / size); j++) {
      const key = `${i},${j}`, list = cells.get(key);
      if (list) list.push(c); else cells.set(key, [c]);
    }
    return (x: number, y: number) => (cells.get(`${Math.floor(x / size)},${Math.floor(y / size)}`) ?? []).some((c) => x >= c.box[0] && y >= c.box[1] && x <= c.box[2] && y <= c.box[3] && c.contains(x, y));
  };
  const land = index(polygons(context.land));
  const wet = index([...polygons(context.water), ...strips(context.streams)]);
  const reserved = image ? [...town.plazas, ...town.helipads, ...town.landuse.filter(a => ['pitch', 'stadium', 'playground', 'railway', 'cemetery', 'quarry'].includes(a.cls)).map(a => a.shape)] : [];
  const built = index([...polygons([...context.buildings, ...reserved]), ...(image ? strips(town.ways.filter(w => w.kind === 'rail')) : [])]);
  const road = index(strips(context.roads));
  const field = index(context.airfields.map((s) => ({ box: bounds(s[0].pts, 500), contains: () => true })));
  const clear = (x: number, y: number) => !wet(x, y) && !built(x, y) && !field(x, y);
  const support = (x: number, y: number, transmission: boolean) => clear(x, y) && !road(x, y) && (!transmission || land(x, y));
  const span = (ax: number, ay: number, bx: number, by: number, transmission: boolean, width: number) => {
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len < 1e-6) return false;
    const n = Math.ceil(len); // One metre sampling also catches narrow mapped streams.
    for (let i = 0; i <= n; i++) for (let side = -1; side <= 1; side++) {
      const x = ax + dx * i / n - dy / len * width * side, y = ay + dy * i / n + dx / len * width * side;
      if (!clear(x, y) || (transmission && !land(x, y))) return false;
    }
    return true;
  };
  return { support, span, roads: context.roads };
}
