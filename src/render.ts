import { building, type Build, type Solid } from './buildings';
import { classify } from './classify';
import { drawGround, gardenTrees, keepTree, lightly, orchardTrees, planGround, textured } from './ground';
import { Camera } from './camera';
import type { Frame } from './geo';
import { placeTrees, treeSprite, type Masks } from './nature';
import { Paper } from './raster';
import { sequence } from './rng';
import { LINEWORK, SHADOWS, GREENERY, ROOFS, type Settings } from './settings';
import { curbs, fillRoads, footpaths, lamps, outline, parkCars, railways } from './streets';
import type { Style } from './styles';
import type { Shape, Stream, Town } from './tiles';

export type Counts = { buildings: number; houses: number; trees: number; cars: number; lamps: number };
export type Drawing = { pens: number[][][]; counts: Counts };

/** Tallest building we expect to poke into view from below the sheet, in metres. */
export function reachHeight(set: Settings): number {
  return Math.min(400, 160 * set.heightScale);
}

export function render(town: Town, set: Settings, frame: Frame, style: Style): Drawing {
  const cam = new Camera(set);
  const paper = new Paper(cam);
  const A = ((set.bearing + set.sunAngle) * Math.PI) / 180;
  const sun: [number, number] = [Math.sin(A), Math.cos(A)];
  const toAbs = (x: number, y: number): [number, number] => [frame.mx0 + x / frame.k, frame.my0 + y / frame.k];
  const fromAbs = (X: number, Y: number): [number, number] => [frame.x(X), frame.y(Y)];
  const B: Build = {
    cam,
    set,
    style,
    sun,
    key: (x, y) => {
      const [X, Y] = toAbs(x, y);
      return [Math.round(X), Math.round(Y)];
    },
  };
  const M: Masks = { road: paper.mask(), water: paper.mask(), green: paper.mask(), wood: paper.mask(), foot: paper.mask(), shadow: paper.mask() };
  const counts: Counts = { buildings: 0, houses: 0, trees: 0, cars: 0, lamps: 0 };

  classify(town, style, set, B.key);
  const water = [...town.water, ...streamShapes(town.streams)];

  // Ground
  for (const s of water) paper.fillMask(M.water, s.map((r) => r.pts));
  for (const s of town.green) paper.fillMask(M.green, s.map((r) => r.pts));
  for (const s of town.wood) paper.fillMask(M.wood, s.map((r) => r.pts));
  fillRoads(paper, town.ways, town.plazas, M.road);
  const G = set.ground ? planGround(B, paper, town) : null;

  // Buildings, only those that can show inside the drawing area
  const [rx0, ry0, rx1, ry1] = cam.rect;
  const solids: Solid[] = [];
  for (const b of town.buildings) {
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
    counts.buildings++;
    if (made[0].lines.some((l) => l.pen === ROOFS)) counts.houses++;
    solids.push(...made);
  }

  // Life on the ground
  const box = cam.region(0);
  let trees = placeTrees(B, paper, M, box, toAbs, fromAbs);
  if (G) trees = [...trees.filter((t) => keepTree(B, G, paper, t)), ...orchardTrees(B, paper, G, M), ...gardenTrees(B, paper, G, M, box, toAbs, fromAbs)];
  counts.trees = trees.length;
  const cars = parkCars(B, paper, town.ways, M);
  counts.cars = cars.length;
  solids.push(...cars);

  // Depth
  for (const s of solids) for (const f of s.faces) paper.fillFace(f);
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
        const n = r.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
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
  if (set.water) {
    waves(paper, M, set.seed);
    outline(paper, LINEWORK, water, M.water, (x, y) => !paper.on(M.road, x, y));
  }
  if (set.parks) {
    const grass = (x: number, y: number) => paper.on(M.green, x, y) && !paper.on(M.wood, x, y) && !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && !paper.on(M.shadow, x, y);
    paper.hatchGround(GREENERY, -27, 1.1, (x, y) => grass(x, y) && !(G && textured(G, paper, x, y)));
    // Every other line of the same hatch, so it runs on unbroken from the plain grass around.
    if (G) paper.hatchGround(GREENERY, -27, 2.2, (x, y) => grass(x, y) && lightly(G, paper, x, y));
    outline(paper, GREENERY, town.green, M.green, (x, y) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && !paper.on(M.wood, x, y));
    outline(paper, GREENERY, town.wood, M.wood, (x, y) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y));
  }
  if (set.shadows) paper.hatchGround(SHADOWS, 62, 0.85, (x, y) => paper.on(M.shadow, x, y) && !paper.on(M.water, x, y));
  if (G) drawGround(B, paper, M, G, toAbs, fromAbs);
  curbs(paper, town.ways, M);
  outline(paper, LINEWORK, town.plazas, M.road);
  if (set.rails) railways(B, paper, town.ways);
  if (set.paths) footpaths(B, paper, town.ways, M);
  if (set.lamps) counts.lamps = lamps(B, paper, town.ways, M);
  railings(paper, town.ways);

  // Solids and trees
  for (const s of solids) for (const l of s.lines) paper.line3(l.pen, l.pts, paper.seen, l.closed);
  for (const sp of sprites) sp.draw();

  if (set.frame) paper.pens[LINEWORK].push([rx0, ry0, rx1, ry0, rx1, ry1, rx0, ry1, rx0, ry0]);
  return { pens: paper.pens, counts };
}

/** Short wavy strokes over open water. */
function waves(paper: Paper, M: Masks, seed: number): void {
  const rnd = sequence(seed * 7919 + 13);
  const cam = paper.cam;
  const keep = (x: number, y: number, d: number) => paper.on(M.water, x, y) && !paper.on(M.road, x, y) && paper.seen(x, y, d);
  for (let y = paper.y0 + 0.8; y < paper.y1; y += 1.7 + rnd() * 0.5) {
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
      if (paper.on(M.water, x + len / 2, y) || paper.on(M.water, x, y) || paper.on(M.water, x + len, y)) paper.sheet(SHADOWS, pts, keep);
      x += len + 1 + rnd() * 5.5;
    }
  }
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
    const hw = Math.max(1.2, w.width / 2);
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
