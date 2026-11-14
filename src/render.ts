import { building, type Build, type Solid } from './buildings';
import { classify } from './classify';
import { allotmentSheds, bales, drawGround, livestock, wildTrees, gardenTrees, keepTree, lightly, orchardTrees, planGround, scrubBushes, textured } from './ground';
import { hedgerows, plots, streetTrees } from './gardens';
import { beaches, busStops, campsites, chimneys, farmyards, fuel, peaks, people, playgrounds, ports, quarries, squares } from './sites';
import { airfields, crossings, motorways, platforms, bridges, ferries, sailing, lifts, markings, moorings, parking, portals, roundabouts } from './infra';
import { Camera } from './camera';
import { ringArea, type Frame } from './geo';
import type { StageProgress } from './app/stages';
import { placeTrees, regionalTrees, treeSprite, type Masks } from './nature';
import { marginalia } from './marginalia';
import { Paper } from './raster';
import { sequence } from './rng';
import { LINEWORK, SHADOWS, GREENERY, ROOFS, WATER, layerPen, lockKey, type LayerId, type Settings } from './settings';
import { curbs, fillRoads, footpaths, lamps, outline, railways } from './streets';
import { traffic } from './traffic';
import { trains } from './trains';
import { aviation } from './aircraft';
import { powerLines } from './power';
import type { Style } from './styles';
import type { Shape, Stream, Town } from './tiles';

export type Counts = { buildings: number; houses: number; trees: number; cars: number; lamps: number };
/** Which building shows at each pixel of the drawing area, for clicking in the preview. */
export type Picks = { x0: number; y0: number; ppm: number; W: number; H: number; ids: Int32Array; keys: string[] };
export type Drawing = { pens: number[][][]; counts: Counts; picks: Picks };

/** The lock key of the building at a sheet position (mm), looking a little around it for a near miss. */
export function pickAt(p: Picks, x: number, y: number): string | null {
  const px = Math.floor((x - p.x0) * p.ppm);
  const py = Math.floor((y - p.y0) * p.ppm);
  const reach = Math.ceil(p.ppm * 0.6);
  for (let r = 0; r <= reach; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= p.W || qy >= p.H) continue;
        const id = p.ids[qy * p.W + qx];
        if (id >= 0) return p.keys[id];
      }
    }
  }
  return null;
}

/** Tallest building we expect to poke into view from below the sheet, in metres. */
export function reachHeight(set: Settings): number {
  return Math.min(400, 160 * set.heightScale);
}

/** Reports where the drawing has got to; called often, so keep it cheap. */
export type OnStage = (p: StageProgress) => void;

export function render(town: Town, set: Settings, frame: Frame, style: Style, onStage: OnStage = () => {}, left = false): Drawing {
  const cam = new Camera(set);
  const paper = new Paper(cam);
  const tag = <T extends Solid[]>(layer: LayerId, solids: T): T => {
    for (const solid of solids) solid.layer = layer;
    return solids;
  };
  const extra = <T extends { solids: Solid[]; draw: (paper: Paper) => void }>(layer: LayerId, e: T): T => {
    tag(layer, e.solids);
    const draw = e.draw;
    return { ...e, draw: (p: Paper) => withPen(layer, () => draw(p)) };
  };
  const withPen = (layer: LayerId, draw: () => void): void => {
    paper.penOverride = set.customLayerPens ? set.layerPens[layer] : undefined;
    try { draw(); } finally { paper.penOverride = undefined; }
  };
  const A = ((set.bearing + set.sunAngle) * Math.PI) / 180;
  const sun: [number, number] = [Math.sin(A), Math.cos(A)];
  const toAbs = (x: number, y: number): [number, number] => [frame.mx0 + x / frame.k, frame.my0 + y / frame.k];
  const fromAbs = (X: number, Y: number): [number, number] => [frame.x(X), frame.y(Y)];
  const B: Build = {
    cam,
    set,
    style,
    sun,
    left,
    seed: set.seed,
    key: (x, y) => {
      const [X, Y] = toAbs(x, y);
      return [Math.round(X), Math.round(Y)];
    },
  };
  const M: Masks = { road: paper.mask(), water: paper.mask(), green: paper.mask(), wood: paper.mask(), foot: paper.mask(), shadow: paper.mask(), pool: paper.mask(), under: paper.mask() };
  const counts: Counts = { buildings: 0, houses: 0, trees: 0, cars: 0, lamps: 0 };

  onStage({ stage: 'ground' });
  classify(town, style, set, B.key);
  const water = [...town.water, ...streamShapes(town.streams)];
  const rounds = roundabouts(town);
  town.green.push(...rounds.islands);

  // Ground
  for (const s of water) paper.fillMask(M.water, s.map((r) => r.pts));
  for (const s of town.pools) {
    paper.fillMask(M.water, s.map((r) => r.pts));
    paper.fillMask(M.pool, s.map((r) => r.pts));
  }
  for (const s of town.green) paper.fillMask(M.green, s.map((r) => r.pts));
  for (const s of town.wood) paper.fillMask(M.wood, s.map((r) => r.pts));
  fillRoads(paper, town.ways, town.plazas, M.road);
  fillRoads(paper, town.runways, town.aprons, M.road);
  const G = set.ground ? planGround(B, paper, town) : null;

  // Buildings, only those that can show inside the drawing area
  const [rx0, ry0, rx1, ry1] = cam.rect;
  const solids: Solid[] = [];
  const pickKeys: string[] = [];
  const candidates = town.buildings.length;
  for (let i = 0; i < candidates; i++) {
    const b = town.buildings[i];
    onStage({ stage: 'buildings', done: i, total: candidates, note: `${counts.buildings.toLocaleString('en')} in view` });
    const p = b.shape[0].pts;
    let sx0 = Infinity;
    let sx1 = -Infinity;
    let syTop = Infinity;
    let syBot = -Infinity;
    const H = b.h * set.heightScale + 8;
    for (let i = 0; i < p.length; i += 2) {
      const sx = cam.sx(p[i], p[i + 1]);
      sx0 = Math.min(sx0, sx);
      sx1 = Math.max(sx1, sx);
      syTop = Math.min(syTop, cam.sy(p[i], p[i + 1], H));
      syBot = Math.max(syBot, cam.sy(p[i], p[i + 1], 0));
    }
    if (sx1 < rx0 || sx0 > rx1 || syBot < ry0 || syTop > ry1) continue;
    paper.fillMask(M.foot, b.shape.map((r) => r.pts));
    const made = building(B, b);
    if (b.info) {
      const id = pickKeys.push(lockKey(b.info.seed)) - 1;
      for (const s of made) s.pick = id;
    }
    counts.buildings++;
    if (made[0].lines.some((l) => l.pen === ROOFS)) counts.houses++;
    solids.push(...made);
  }

  // Life on the ground
  onStage({ stage: 'life', note: `${counts.buildings.toLocaleString('en')} buildings standing` });
  const box = cam.region(0);
  let trees = placeTrees(B, paper, M, box, toAbs, fromAbs);
  if (G) trees = [...trees.filter((t) => keepTree(B, G, paper, t)), ...orchardTrees(B, paper, G, M), ...gardenTrees(B, paper, G, M, box, toAbs, fromAbs), ...scrubBushes(B, paper, G, M, box, toAbs, fromAbs), ...hedgerows(B, paper, G, M), ...wildTrees(B, paper, G, M, box, toAbs, fromAbs)];
  trees.push(...streetTrees(B, paper, town.ways, M));
  if (set.trees > 0) for (const [x, y] of rounds.centres) trees.push({ x, y, r: 2.4, h: 6.5, conifer: false });
  // Palms are planted in town; out in the woods and the open country they don't belong.
  trees = regionalTrees(B, trees, (t) => {
    const sx = cam.sx(t.x, t.y);
    const sy = cam.sy(t.x, t.y, 0);
    return paper.on(M.wood, sx, sy) || (!!G && !G.inTown(t.x, t.y, sx, sy));
  });
  counts.trees = trees.length;
  const cars = tag('cars', traffic(B, paper, town, M));
  const bays = extra('markings', parking(B, paper, town.ways, M));
  tag('cars', bays.solids);
  counts.cars = cars.length + bays.solids.length;
  solids.push(...cars, ...tag('life', trains(B, paper, town, M)));
  const extras = [bays, extra('rails', lifts(B, town)), extra('life', ferries(B, paper, town, M)), extra('life', moorings(B, paper, town, M)), extra('streets', bridges(B, paper, town, M)), extra('streets', platforms(B, town)), extra('streets', portals(B, town)), extra('streets', airfields(B, paper, town, M)), extra('life', aviation(B, paper, town, M)), extra('power', powerLines(B, paper, town, M, box, toAbs, fromAbs))];
  if (set.ground) extras.push(extra('ground', beaches(B, paper, town, M)), extra('ground', campsites(B, paper, town, M)), extra('ground', playgrounds(B, paper, town, M)), extra('ground', farmyards(B, paper, town, M)), extra('ground', quarries(B, paper, town, M)));
  if (set.water) extras.push(extra('water', ports(B, paper, town, M)));
  extras.push(extra('streets', squares(B, paper, town, M)), extra('streets', busStops(B, paper, town, M)), extra('streets', fuel(B, paper, town, M)), extra('streets', chimneys(B, paper, town, M)), extra('streets', peaks(B, town)));
  extras.push(extra('life', sailing(B, paper, town, M)), extra('markings', crossings(B, paper, town, M)), extra('life', people(B, paper, town, M)), extra('streets', motorways(B, paper, town, M)));
  for (const e of extras) solids.push(...e.solids);
  if (G) solids.push(...tag('ground', allotmentSheds(B, paper, G, M)), ...tag('ground', bales(B, paper, G, M)), ...tag('life', livestock(B, paper, G, M, box, toAbs, fromAbs)));
  const fences = G ? plots(B, paper, town, G, M) : null;
  if (fences) solids.push(...tag('ground', fences.solids));

  // Depth
  onStage({ stage: 'light', note: `${counts.trees.toLocaleString('en')} trees, ${counts.cars.toLocaleString('en')} cars` });
  for (const s of solids) for (const f of s.faces) paper.fillFace(f, s.pick);
  const sprites = trees.map((t) => treeSprite(B, paper, t));
  for (const sp of sprites) paper.fillSprite(sp.ring, sp.depth);
  paper.finishDepth();

  // Shadows on the ground
  if (set.shadows) {
    const len = 1 / Math.tan((Math.max(5, set.sunHeight) * Math.PI) / 180);
    const ox = -sun[0] * len;
    const oy = -sun[1] * len;
    for (const s of solids) {
      for (const c of s.casts) {
        const r = c.ring;
        const dx = ox * c.h;
        const dy = oy * c.h;
        const moved = r.map((v, i) => v + (i % 2 ? dy : dx));
        paper.fillMask(M.shadow, [r]);
        paper.fillMask(M.shadow, [moved]);
        // The swept shadow is the footprint, the moved footprint and the sides that face the
        // way the shadow falls; the other sides' quads lie inside those already.
        const n = r.length / 2;
        const sgn = ringArea(r) >= 0 ? 1 : -1;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          if (((r[j * 2 + 1] - r[i * 2 + 1]) * dx - (r[j * 2] - r[i * 2]) * dy) * sgn <= 0) continue;
          paper.fillMask(M.shadow, [[r[i * 2], r[i * 2 + 1], r[j * 2], r[j * 2 + 1], moved[j * 2], moved[j * 2 + 1], moved[i * 2], moved[i * 2 + 1]]]);
        }
      }
    }
    for (const t of trees) {
      const cx = t.x + ox * t.h * 0.9;
      const cy = t.y + oy * t.h * 0.9;
      const ring: number[] = [];
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        ring.push(cx + Math.cos(a) * t.r * 0.95, cy + Math.sin(a) * t.r * 0.95);
      }
      paper.fillMask(M.shadow, [ring]);
    }
  }

  // Lines, ground first
  onStage({ stage: 'lines', note: 'Ground and streets' });
  if (set.water) withPen('water', () => {
    waves(paper, M, set.seed);
    outline(paper, LINEWORK, water, M.water, (x, y) => !paper.on(M.road, x, y) && !paper.on(M.under, x, y));
    pools(paper, M, town.pools);
  });
  if (set.parks) withPen('parks', () => {
    const grass = (x: number, y: number) => paper.on(M.green, x, y) && !paper.on(M.wood, x, y) && !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && !paper.on(M.shadow, x, y);
    paper.hatchGround(GREENERY, -27, cam.gap(1.1), (x, y) => grass(x, y) && !(G && textured(G, paper, x, y)));
    // Every other line of the same hatch, so it runs on unbroken from the plain grass around.
    if (G) paper.hatchGround(GREENERY, -27, cam.gap(2.2), (x, y) => grass(x, y) && lightly(G, paper, x, y));
    outline(paper, GREENERY, town.green, M.green, (x, y) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && !paper.on(M.wood, x, y));
    outline(paper, GREENERY, town.wood, M.wood, (x, y) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y));
  });
  if (set.shadows) withPen('shadows', () => { paper.hatchGround(SHADOWS, 62, 0.85, (x, y) => paper.on(M.shadow, x, y) && !paper.on(M.water, x, y)); });
  if (G) withPen('ground', () => { drawGround(B, paper, M, G, toAbs, fromAbs); });
  withPen('streets', () => { curbs(paper, town.ways, M); });
  withPen('streets', () => { outline(paper, LINEWORK, town.plazas, M.road); });
  if (set.rails) withPen('rails', () => { railways(B, paper, town.ways); });
  if (set.paths) withPen('paths', () => { footpaths(B, paper, town.ways, M); });
  if (set.lamps) withPen('lamps', () => { counts.lamps = lamps(B, paper, town.ways, M); });
  withPen('streets', () => { railings(paper, town.ways); });
  withPen('markings', () => { markings(B, paper, town.ways, M); });
  for (const e of extras) e.draw(paper);
  withPen('ground', () => { fences?.draw(); });

  // Solids and trees
  onStage({ stage: 'lines', note: 'Buildings and trees' });
  for (const s of solids) for (const l of s.lines) paper.line3(layerPen(set, s.layer ?? l.layer ?? (l.pen === ROOFS ? 'roofs' : 'buildings'), l.pen), l.pts, paper.seen, l.closed);
  withPen('trees', () => { for (const sp of sprites) sp.draw(); });

  if (set.frame) paper.pens[layerPen(set, 'margin', LINEWORK)].push([rx0, ry0, rx1, ry0, rx1, ry1, rx0, ry1, rx0, ry0]);
  if (set.marginalia) paper.pens[layerPen(set, 'margin', LINEWORK)].push(...marginalia(set, cam, frame));
  const picks: Picks = { x0: paper.x0, y0: paper.y0, ppm: paper.ppm, W: paper.W, H: paper.H, ids: paper.ids, keys: pickKeys };
  return { pens: paper.pens, counts, picks };
}

/** Short wavy strokes over open water. */
function waves(paper: Paper, M: Masks, seed: number): void {
  const rnd = sequence(seed * 7919 + 13);
  const cam = paper.cam;
  const keep = (x: number, y: number, d: number) => paper.on(M.water, x, y) && !paper.on(M.pool, x, y) && !paper.on(M.road, x, y) && !paper.on(M.under, x, y) && paper.seen(x, y, d);
  for (let y = paper.y0 + 0.8; y < paper.y1; y += cam.gap(1.7 + rnd() * 0.5)) {
    let x = paper.x0 - rnd() * 8;
    while (x < paper.x1) {
      const len = 2.5 + rnd() * 7;
      const amp = 0.18 + rnd() * 0.16;
      const waves = Math.max(1, Math.round(len / 3.2));
      const tilt = (rnd() - 0.5) * 0.08;
      const pts: number[] = [];
      for (let t = 0; t <= len + 1e-9; t += 0.4) {
        const yy = y + Math.sin((t / len) * waves * Math.PI * 2) * amp + t * tilt;
        pts.push(x + t, yy, cam.groundDepth(yy));
      }
      if (paper.on(M.water, x + len / 2, y) || paper.on(M.water, x, y) || paper.on(M.water, x + len, y)) paper.sheet(WATER, pts, keep);
      x += len + cam.gap(1 + rnd() * 5.5);
    }
  }
}

/** Swimming pools: a hard edge and close, level ripples instead of open-water waves. */
function pools(paper: Paper, M: Masks, shapes: Shape[]): void {
  if (!shapes.length) return;
  outline(paper, LINEWORK, shapes, M.pool);
  paper.hatchGround(WATER, 0, paper.cam.gap(0.75), (x, y) => paper.on(M.pool, x, y) && !paper.on(M.road, x, y) && !paper.on(M.shadow, x, y));
}

/** Waterway centre lines as water shapes: a strip per segment and a disc per joint. */
function streamShapes(streams: Stream[]): Shape[] {
  const out: Shape[] = [];
  const ring = (pts: number[]) => [{ pts, seam: new Uint8Array(pts.length / 2) }];
  for (const s of streams) {
    const hw = s.width / 2;
    const p = s.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const [ax, ay, bx, by] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
      const l = Math.hypot(bx - ax, by - ay);
      if (l < 1e-6) continue;
      const nx = (-(by - ay) / l) * hw;
      const ny = ((bx - ax) / l) * hw;
      out.push(ring([ax - nx, ay - ny, bx - nx, by - ny, bx + nx, by + ny, ax + nx, ay + ny]));
    }
    for (let i = 2; i + 2 < p.length; i += 2) {
      const pts: number[] = [];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        pts.push(p[i] + Math.cos(a) * hw, p[i + 1] + Math.sin(a) * hw);
      }
      out.push(ring(pts));
    }
  }
  return out;
}

/** Railings along both edges of road bridges, with posts. */
function railings(paper: Paper, ways: Town['ways']): void {
  const z = 1.1;
  for (const w of ways) {
    if (!w.bridge || w.kind === 'rail') continue;
    const hw = w.kind === 'path' ? 2 : Math.max(1.2, w.width / 2);
    const p = w.pts;
    for (const side of [-1, 1]) {
      const pts: number[] = [];
      for (let i = 0; i < p.length; i += 2) {
        const a = Math.max(0, i - 2);
        const b = Math.min(p.length - 2, i + 2);
        const dx = p[b] - p[a];
        const dy = p[b + 1] - p[a + 1];
        const l = Math.hypot(dx, dy) || 1;
        pts.push(p[i] - (dy / l) * hw * side, p[i + 1] + (dx / l) * hw * side, z);
      }
      paper.line3(LINEWORK, pts);
      for (let i = 0; i + 5 < pts.length; i += 3) {
        const l = Math.hypot(pts[i + 3] - pts[i], pts[i + 4] - pts[i + 1]);
        const n = Math.floor(l / 2.5);
        for (let k = 0; k <= n; k++) {
          const t = n ? k / n : 0;
          const x = pts[i] + (pts[i + 3] - pts[i]) * t;
          const y = pts[i + 1] + (pts[i + 4] - pts[i + 1]) * t;
          paper.line3(LINEWORK, [x, y, 0, x, y, z]);
        }
      }
    }
  }
}
