import { building, type Build, type Solid } from './buildings';
import { classify } from './classify';
import { cycleRacks, kerbGardens, kerbTrees, lotCommons, medians, medianTrees, rainTanks } from './commons';
import { planFuture, type ClimateId } from './future';
import { canopyTrees } from './canopy';
import { bankTrees, cycleTracks, lotTrees, reshapeTown, stripGrass, stripTrees } from './reshape';
import { forecourtCanopies, lotCanopies } from './solar';
import { yardPergolas } from './additions';
import { gardenBeds, meadowPatches, parkCommons, parkMeadow, reeds, worksHedges } from './landscape';
import { fieldTrees, allotmentSheds, bales, castShadows, drawGround, farmWork, livestock, wildTrees, gardenTrees, keepTree, orchardTrees, parkGrass, planGround, scrubBushes } from './ground';
import { hedgerows, plots, streetTrees } from './gardens';
import { beaches, busStops, campsites, chimneys, farmyards, fuel, peaks, people, playgrounds, ports, quarries, squares, stations } from './sites';
import { players, racing } from './sport';
import { ships } from './ships';
import { airfields, crossings, motorways, platforms, bridges, pierOutline, ferries, sailing, lifts, markings, moorings, parking, portals, roundabouts } from './infra';
import { Camera } from './camera';
import { pointInRing, ringArea, type Frame } from './geo';
import type { StageProgress } from './app/stages';
import { atLeast, LOD, shows, showsAt } from './lod';
import { legibleTrees, placeTrees, regionalTrees, treeSprite, type Masks, type Tree } from './nature';
import { marginalia } from './marginalia';
import { Paper } from './raster';
import { finishRoofEdges } from './roofs';
import { waves } from './water';
import { LINEWORK, GREENERY, ROOFS, WATER, deeper, layerPen, lockKey, sunBearing, type LayerId, type Settings } from './settings';
import { curbs, fillRoads, footpaths, pathClearance, lamps, outline, railways } from './streets';
import { freedKerbs, traffic } from './traffic';
import { title } from './title';
import { trains } from './trains';
import { aviation } from './aircraft';
import { powerLines } from './power';
import type { Style } from './styles';
import type { Shape, Stream, Town } from './tiles';

export type Counts = { buildings: number; houses: number; trees: number; cars: number; lamps: number };
/** How many buildings and trees in the drawing carry each catalogue facet (`house`, `gabled-roof`, `palm`). */
export type Census = Record<string, number>;
/** Which building shows at each pixel of the drawing area, for clicking in the preview. */
export type Picks = { x0: number; y0: number; ppm: number; W: number; H: number; ids: Int32Array; keys: string[] };
/** `climate` is the solarpunk climate profile drawn for, while that mode is on. */
export type Drawing = { pens: number[][][]; counts: Counts; census: Census; picks: Picks; climate?: ClimateId };

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

/** `tally`, when given, collects every stroke by the feature that drew it (see `Paper.tally`). */
export function render(town: Town, set: Settings, frame: Frame, style: Style, onStage: OnStage = () => {}, left = false, tally: Map<string, number[][]> | null = null): Drawing {
  const cam = new Camera(set);
  const paper = new Paper(cam);
  paper.tally = tally;
  /** File solids under a layer, and optionally a facet the catalogue can single them out by. */
  const tag = <T extends Solid[]>(layer: LayerId, solids: T, facet?: string): T => {
    for (const solid of solids) {
      solid.layer = layer;
      if (facet) solid.facet = facet;
    }
    return solids;
  };
  const census: Census = {};
  const tick = (facet: string) => {
    census[facet] = (census[facet] ?? 0) + 1;
  };
  /** Make a layer's things at its own Detail, if it has one. */
  const at = <T>(layer: LayerId, make: () => T): T => cam.within(layer, make);
  /** Wire up an extra: it is made and drawn at its layer's Detail, its solids and its ground lines go to `layer`; `part` names it within the layer for the LOD lab. */
  const extra = <T extends { solids: Solid[]; draw: (paper: Paper) => void }>(layer: LayerId, part: string, make: () => T): T => {
    const e = at(layer, make);
    for (const s of tag(layer, e.solids)) s.part = part;
    const draw = e.draw;
    return { ...e, draw: (p: Paper) => withPen(layer, () => draw(p), part) };
  };
  const withPen = (layer: LayerId, draw: () => void, part?: string): void => {
    paper.penOverride = set.customLayerPens ? set.layerPens[layer] : undefined;
    paper.layer = part ? `${layer}:${part}` : layer;
    try { at(layer, draw); } finally { paper.penOverride = undefined; paper.layer = ''; }
  };
  const A = (sunBearing(set) * Math.PI) / 180;
  const sun: [number, number] = [Math.sin(A), Math.cos(A)];
  // Builders put more windows on the side facing the equator, the more so away from the tropics.
  const lat = set.center[1];
  const equator: [number, number] = [0, (lat >= 0 ? -1 : 1) * Math.max(0, Math.min(1, (Math.abs(lat) - 12) / 25))];
  const toAbs = (x: number, y: number): [number, number] => [frame.mx0 + x / frame.k, frame.my0 + y / frame.k];
  const fromAbs = (X: number, Y: number): [number, number] => [frame.x(X), frame.y(Y)];
  const B: Build = {
    cam,
    set,
    style,
    sun,
    equator,
    left,
    seed: set.seed,
    toAbs,
    cell: (x, y, size) => {
      const [X, Y] = toAbs(x, y);
      return [Math.round(X / size), Math.round(Y / size)];
    },
    key: (x, y) => {
      const [X, Y] = toAbs(x, y);
      return [Math.round(X), Math.round(Y)];
    },
  };
  const M: Masks = { road: paper.mask(), water: paper.mask(), green: paper.mask(), wood: paper.mask(), foot: paper.mask(), shadow: paper.mask(), pool: paper.mask(), under: paper.mask(), calm: paper.mask(), title: paper.mask(), strip: paper.mask() };
  const counts: Counts = { buildings: 0, houses: 0, trees: 0, cars: 0, lamps: 0 };

  onStage({ stage: 'ground' });
  classify(town, style, set, B.key);
  // The solarpunk plan takes in the context buildings too, so district decisions agree from every view.
  B.future = set.solarpunk ? planFuture(town, set, style.id, B.key, B.cell) : null;
  // Buildings loaded only so their neighbours are classified the same from any view go now.
  town = { ...town, buildings: town.buildings.filter((b) => !b.context) };
  // From depth Transform, streets are reshaped before any mask is filled, so everything downstream follows.
  const R = B.future && deeper(set, 'transform') ? reshapeTown(town, B) : null;
  if (R) town = R.town;
  // Roads narrower than the pen can keep apart are drawn a little wider, so their kerbs don't run together.
  at('streets', () => { for (const w of town.ways) if (w.kind === 'road') w.width = atLeast(cam, LOD.road, w.width); });
  // Streams too narrow for two banks are a single line.
  const banked = at('water', () => town.streams.map((s) => shows(cam, LOD.stream, s.width)));
  const brooks = town.streams.filter((_, i) => !banked[i]);
  const streams = streamShapes(town.streams.filter((_, i) => banked[i]));
  const water = [...town.water, ...streams];
  const rounds = roundabouts(town);
  town.green.push(...rounds.islands);

  // Ground
  for (const s of water) paper.fillMask(M.water, s.map((r) => r.pts));
  for (const s of town.pools) {
    paper.fillMask(M.water, s.map((r) => r.pts));
    paper.fillMask(M.pool, s.map((r) => r.pts));
  }
  for (const s of town.green) paper.fillMask(M.green, s.map((r) => r.pts));
  // Car parks turned into parks, apart from the strips: they keep their own hatch and grove.
  const lots = paper.mask();
  for (const s of [...(R?.strips ?? []), ...(R?.lots ?? [])]) {
    paper.fillMask(M.green, s.map((r) => r.pts));
    paper.fillMask(M.strip, s.map((r) => r.pts));
  }
  for (const s of R?.lots ?? []) paper.fillMask(lots, s.map((r) => r.pts));
  // Planted bank margins: soft ground of their own, not parks, so fields and gardens under them keep theirs.
  const banks = paper.mask();
  for (const s of R?.banks ?? []) {
    paper.fillMask(M.strip, s.map((r) => r.pts));
    paper.fillMask(banks, s.map((r) => r.pts));
  }
  for (const s of town.wood) paper.fillMask(M.wood, s.map((r) => r.pts));
  fillRoads(paper, town.ways, town.plazas, M.road);
  fillRoads(paper, town.runways, town.aprons, M.road);
  const G = set.ground ? at('ground', () => planGround(B, paper, town)) : null;
  // The title is placed before the buildings, so the ones it stands in can make way.
  const T = at('title', () => title(B, town));

  // Buildings, only those that can show inside the drawing area
  const [rx0, ry0, rx1, ry1] = cam.rect;
  const solids: Solid[] = [];
  const pickKeys: string[] = [];
  const candidates = town.buildings.length;
  const cleared: Town['buildings'] = [];
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
    if (T?.clears(b)) {
      cleared.push(b);
      continue;
    }
    paper.fillMask(M.foot, b.shape.map((r) => r.pts));
    const made = at('buildings', () => (legible(B, b) ? building(B, b) : null));
    if (!made) continue;
    // Frames and porches stand on the ground in front of the walls: keep trees and cars off it.
    if (B.future && b.future?.strip) paper.fillMask(M.foot, [b.future.strip]);
    if (B.future && b.future?.strip2) paper.fillMask(M.foot, [b.future.strip2]);
    if (b.info) {
      const id = pickKeys.push(lockKey(b.info.seed)) - 1;
      const facets = buildingFacets(b, !!B.future);
      const facet = facets.join('/');
      for (const s of made) {
        s.pick = id;
        s.facet = facet;
      }
      for (const f of facets) tick(f);
    }
    counts.buildings++;
    if (made[0].lines.some((l) => l.pen === ROOFS)) counts.houses++;
    solids.push(...made);
  }

  // Buildings that made way for the title are gone for everything drawn after them, and so are
  // helipads mapped on their roofs, which would otherwise hang in the air where the roof was.
  if (cleared.length) {
    const gone = new Set(cleared);
    const onGone = (s: Shape) => {
      const p = s[0].pts;
      let cx = 0;
      let cy = 0;
      for (let i = 0; i < p.length; i += 2) {
        cx += p[i];
        cy += p[i + 1];
      }
      cx /= p.length / 2;
      cy /= p.length / 2;
      return cleared.some((b) => pointInRing(cx, cy, b.shape[0].pts));
    };
    town = { ...town, buildings: town.buildings.filter((b) => !gone.has(b)), helipads: town.helipads.filter((h) => !onGone(h)) };
  }
  // Trees, cars and people keep out from under the title too.
  if (T) {
    paper.fillMask(M.foot, [T.footprint]);
    paper.fillMask(M.title, [T.clearance]);
    solids.push(...tag('title', T.solids));
  }

  // Life on the ground
  onStage({ stage: 'life', note: `${counts.buildings.toLocaleString('en')} buildings standing` });
  const box = cam.region(0);
  const from = (name: string, list: Tree[]) => {
    for (const t of list) t.from = name;
    return list;
  };
  // Kerb parking a solarpunk street gives up, planted with trees or rain gardens.
  const kerbs = B.future ? at('streets', () => freedKerbs(B, paper, town, M)) : [];
  const trees = at('trees', () => {
    let list = from('park-trees', placeTrees(B, paper, M, box, toAbs, fromAbs));
    if (G) list = [...list.filter((t) => keepTree(B, G, paper, t)), ...from('orchard-trees', orchardTrees(B, paper, G, M)), ...from('garden-trees', gardenTrees(B, paper, G, M, box, toAbs, fromAbs)), ...from('scrub-bushes', scrubBushes(B, paper, G, M, box, toAbs, fromAbs)), ...from('hedgerows', hedgerows(B, paper, G, M)), ...from('wild-trees', wildTrees(B, paper, G, M, box, toAbs, fromAbs))];
    list.push(...from('street-trees', streetTrees(B, paper, town.ways, M)));
    if (B.future) list.push(...from('kerb-trees', kerbTrees(B, kerbs)), ...worksHedges(B, paper, town, M), ...medianTrees(B, town));
    if (R && G) list.push(...fieldTrees(B, paper, G, M));
    if (R) list.push(...bankTrees(B, paper, R, M, banks), ...from('strip-trees', stripTrees(B, paper, R, M)), ...from('lot-trees', lotTrees(B, paper, R, M)), ...canopyTrees(B, paper, town, G, M, box, toAbs, fromAbs));
    if (set.trees > 0) for (const [x, y] of rounds.centres) list.push({ x, y, r: 2.4, h: 6.5, conifer: false, from: 'roundabout-trees' });
    // Palms are planted in town; out in the woods and the open country they don't belong.
    list = regionalTrees(B, list, (t) => {
      const sx = cam.sx(t.x, t.y);
      const sy = cam.sy(t.x, t.y, 0);
      return paper.on(M.wood, sx, sy) || (!!G && !G.inTown(t.x, t.y, sx, sy));
    });
    return legibleTrees(B, list);
  });
  counts.trees = trees.length;
  const treeFacets = trees.map((t) => {
    const kind = t.form ?? (t.bush ? 'bush' : t.conifer ? 'conifer' : 'broadleaf');
    tick(kind);
    if (t.from) tick(t.from);
    return t.from ? `${t.from}/${kind}` : kind;
  });
  const cars = tag('cars', at('cars', () => traffic(B, paper, town, M)));
  const bays = extra('markings', 'parking', () => parking(B, paper, town.ways, M));
  tag('cars', bays.solids);
  counts.cars = cars.length + bays.solids.length;
  solids.push(...cars, ...tag('life', at('life', () => trains(B, paper, town, M)), 'trains'));
  const extras = [bays, extra('rails', 'lifts', () => lifts(B, town)), extra('life', 'ferries', () => ferries(B, paper, town, M)), extra('life', 'moorings', () => moorings(B, paper, town, M)), extra('streets', 'bridges', () => bridges(B, paper, town, M)), extra('streets', 'platforms', () => platforms(B, town)), extra('streets', 'portals', () => portals(B, town)), extra('streets', 'airfields', () => airfields(B, paper, town, M)), extra('life', 'aviation', () => aviation(B, paper, town, M)), extra('power', 'powerLines', () => powerLines(B, paper, town, M, box, toAbs, fromAbs))];
  if (set.ground) extras.push(extra('ground', 'beaches', () => beaches(B, paper, town, M)), extra('ground', 'campsites', () => campsites(B, paper, town, M)), extra('ground', 'playgrounds', () => playgrounds(B, paper, town, M)), extra('ground', 'farmyards', () => farmyards(B, paper, town, M)), extra('ground', 'quarries', () => quarries(B, paper, town, M)));
  if (set.water) extras.push(extra('water', 'ports', () => ports(B, paper, town, M)));
  if (R) extras.push(extra('streets', 'cycle-tracks', () => cycleTracks(B, paper, R, M)));
  if (B.future) extras.push(extra('planting', 'tanks', () => rainTanks(B, paper, town, M)), extra('planting', 'kerbs', () => kerbGardens(B, paper, kerbs)), extra('planting', 'medians', () => medians(B, paper, town)), extra('solar', 'canopies', () => lotCanopies(B, paper, town, M)), extra('solar', 'forecourts', () => forecourtCanopies(B, paper, town, M, trees)), extra('planting', 'lots', () => lotCommons(B, paper, town, M)), extra('additions', 'pergolas', () => yardPergolas(B, paper, town, M)), extra('planting', 'beds', () => gardenBeds(B, paper, town, G, M)), extra('parks', 'commons', () => parkCommons(B, paper, town, M)), extra('streets', 'racks', () => cycleRacks(B, paper, town, M)));
  extras.push(extra('streets', 'squares', () => squares(B, paper, town, M)), extra('streets', 'busStops', () => busStops(B, paper, town, M)), extra('streets', 'fuel', () => fuel(B, paper, town, M)), extra('streets', 'chimneys', () => chimneys(B, paper, town, M)), extra('streets', 'peaks', () => peaks(B, town)));
  // Ships first: sailing boats keep off the water they and their wakes take up.
  extras.push(extra('life', 'ships', () => ships(B, paper, town, M, toAbs, fromAbs)), extra('life', 'racing', () => racing(B, paper, town, M)), extra('cars', 'stations', () => stations(B, paper, town, M)));
  extras.push(extra('life', 'sailing', () => sailing(B, paper, town, M)), extra('markings', 'crossings', () => crossings(B, paper, town, M)), extra('life', 'people', () => people(B, paper, town, M)), extra('streets', 'motorways', () => motorways(B, paper, town, M)));
  if (G) extras.push(extra('life', 'farmWork', () => farmWork(B, paper, G, M, toAbs)), extra('life', 'players', () => players(B, paper, G, M)));
  for (const e of extras) solids.push(...e.solids);
  if (G) solids.push(...tag('ground', at('ground', () => allotmentSheds(B, paper, G, M)), 'allotment-sheds'), ...tag('ground', at('ground', () => bales(B, paper, G, M)), 'bales'), ...tag('life', at('life', () => livestock(B, paper, G, M, box, toAbs, fromAbs)), 'livestock'));
  const fences = G ? at('ground', () => plots(B, paper, town, G, M)) : null;
  if (fences) solids.push(...tag('ground', fences.solids, 'plots'));

  // Depth
  onStage({ stage: 'light', note: `${counts.trees.toLocaleString('en')} trees, ${counts.cars.toLocaleString('en')} cars` });
  finishRoofEdges(solids);
  // Faces are numbered as they go in, so lines drawn on one can show only where it does.
  const faceNo = new Map<number[][], number>();
  for (const s of solids) {
    for (const f of s.faces) {
      const n = faceNo.size;
      faceNo.set(f, n);
      paper.fillFace(f, s.pick, n);
    }
  }
  const sprites = at('trees', () => trees.map((t) => treeSprite(B, paper, t)));
  for (const sp of sprites) paper.fillSprite(sp.ring, sp.depth);
  paper.finishDepth();

  // Shadows on the ground
  if (set.shadows) {
    const len = 1 / Math.tan((Math.max(5, set.sunHeight) * Math.PI) / 180);
    const ox = -sun[0] * len;
    const oy = -sun[1] * len;
    for (const s of solids) {
      for (const c of s.casts) {
        // A shadow too short to hatch would only be a scrap of tone.
        if (!at('shadows', () => shows(cam, LOD.shadow, c.h * len))) continue;
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
    // Faces that float or stand on their edge: their shadow is their outline projected along the sun.
    for (const s of solids) {
      for (const f of s.shade ?? []) paper.fillMask(M.shadow, f.map((r) => {
        const out = new Array<number>((r.length / 3) * 2);
        for (let i = 0, j = 0; i < r.length; i += 3, j += 2) {
          out[j] = r[i] + ox * r[i + 2];
          out[j + 1] = r[i + 1] + oy * r[i + 2];
        }
        return out;
      }));
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
    paper.facet('waves', () => waves(B, paper, M, town, streams));
    paper.facet('shores', () => outline(paper, LINEWORK, water, M.water, (x, y) => !paper.on(M.road, x, y) && !paper.on(M.under, x, y)));
    paper.facet('brooks', () => {
      for (const s of brooks) paper.line3(WATER, s.pts.flatMap((v, i) => (i % 2 ? [v, 0] : [v])), (x, y, d) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && paper.seen(x, y, d));
    });
    paper.facet('pools', () => pools(paper, M, town.pools));
  });
  const paths = (set.parks || G || set.shadows) && set.paths ? at('paths', () => pathClearance(B, paper, town.ways)) : undefined;
  if (set.parks) withPen('parks', () => {
    const meadow = B.future ? meadowPatches(B) : undefined;
    paper.facet('grass', () => parkGrass(paper, M, G, paths, meadow));
    if (meadow) paper.facet('park-meadow', () => parkMeadow(B, paper, M, G, meadow, paths));
    paper.facet('park-edges', () => outline(paper, GREENERY, town.green, M.green, (x, y) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y) && !paper.on(M.wood, x, y)));
    paper.facet('wood-edges', () => outline(paper, GREENERY, town.wood, M.wood, (x, y) => !paper.on(M.road, x, y) && !paper.on(M.water, x, y)));
  });
  if (R) withPen('planting', () => { stripGrass(paper, M, R, lots, banks, paths, (x, y) => !G || paper.at(G.land, x, y) === 0); }, 'strips');
  if (set.shadows) withPen('shadows', () => { castShadows(paper, M, paths); });
  if (G) withPen('ground', () => { drawGround(B, paper, M, G, toAbs, fromAbs, paths); });
  if (B.future && set.water) withPen('planting', () => { reeds(B, paper, M, G, paths); }, 'reeds');
  withPen('streets', () => { curbs(paper, town.ways, M); }, 'kerbs');
  withPen('streets', () => { outline(paper, LINEWORK, town.plazas, M.road); }, 'plazas');
  if (set.rails) withPen('rails', () => { railways(B, paper, town.ways); });
  if (set.paths) withPen('paths', () => { footpaths(B, paper, town.ways, M); });
  if (set.lamps && at('lamps', () => shows(cam, LOD.lamp))) withPen('lamps', () => { counts.lamps = lamps(B, paper, town.ways, M); });
  withPen('streets', () => { railings(paper, town.ways); }, 'railings');
  withPen('markings', () => { markings(B, paper, town.ways, M); });
  for (const e of extras) e.draw(paper);
  withPen('ground', () => { paper.facet('plots', () => fences?.draw()); });

  // Solids and trees
  onStage({ stage: 'lines', note: 'Buildings and trees' });
  for (const s of solids) {
    const tail = s.facet ? `/${s.facet}` : '';
    for (const l of s.lines) {
      const layer = s.layer ?? l.layer ?? (l.pen === ROOFS ? 'roofs' : 'buildings');
      paper.layer = (s.part ? `${layer}:${s.part}` : layer) + tail + (l.facet ? `/${l.facet}` : '');
      const on = l.on && faceNo.get(l.on);
      const edge = l.edge?.flatMap((f) => { const n = faceNo.get(f); return n === undefined ? [] : [n]; });
      paper.line3(layerPen(set, layer, l.pen), l.pts, edge ? paper.onEdge(edge) : on === undefined ? paper.seen : paper.onFace(on), l.closed);
    }
  }
  paper.layer = '';
  withPen('trees', () => { sprites.forEach((sp, i) => paper.facet(treeFacets[i], sp.draw)); });

  if (set.frame) paper.pens[layerPen(set, 'margin', LINEWORK)].push([rx0, ry0, rx1, ry0, rx1, ry1, rx0, ry1, rx0, ry0]);
  if (set.marginalia) paper.pens[layerPen(set, 'margin', LINEWORK)].push(...marginalia(set, cam, frame));
  const picks: Picks = { x0: paper.x0, y0: paper.y0, ppm: paper.ppm, W: paper.W, H: paper.H, ids: paper.ids, keys: pickKeys };
  return { pens: paper.pens, counts, census, picks, climate: B.future?.climate };
}

/** What the catalogue can single a building out as: what it is, its roof and windows, and the details it was given. */
function buildingFacets(b: Town['buildings'][number], future: boolean): string[] {
  const i = b.info!;
  const f = [i.kind, `${i.roof}-roof`, `${i.facade.pattern}-windows`, b.guess ? 'guessed-height' : 'mapped-height'];
  if (i.tagged) f.push('tagged-roof');
  if (i.across) f.push('ridge-across');
  if (i.party.some((v) => v > 0)) f.push('party-walls');
  if (i.shop) f.push('shop-front');
  if (i.balconies) f.push(i.balconies === 2 ? 'railed-balconies' : 'deep-balconies');
  if (i.shutters >= 0) f.push('shutters');
  if (i.chimney) f.push('chimneys');
  if (i.dormers) f.push('dormers');
  if (i.gableFront) f.push(i.gableFront === 1 ? 'stepped-gable' : 'neck-gable');
  if (i.parapet && i.roof === 'flat') f.push('has-parapet');
  if (i.facade.bars) f.push('glazing-bars');
  if (i.castle) f.push('castle');
  if (i.hospital) f.push('hospital');
  if (i.townHall) f.push('town-hall');
  const p = future && b.future;
  if (p) {
    f.push(`future-${p.recipe}`);
    if (p.roofPv) f.push('pv-planned');
    if (p.greenRoof) f.push('green-roof-planned');
    if (p.tank) f.push('tank-planned');
  }
  return f;
}

/** Kinds of building that stay however small they are on paper: a terrace would show a gap, a landmark is wanted. */
const KEEP = new Set(['terrace', 'worship', 'civic', 'tall']);

/** Whether a building is big enough on paper to draw; small huts and houses drop out one by one as the scale coarsens. */
function legible(B: Build, b: Town['buildings'][number]): boolean {
  const i = b.info;
  if (!i || KEEP.has(i.kind) || i.castle || i.townHall) return true;
  return showsAt(B.cam, LOD.building, Math.sqrt(Math.abs(ringArea(b.shape[0].pts))), i.seed, B.set.seed, 9106);
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
    if (!w.bridge || w.kind === 'rail' || pierOutline(w)) continue;
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
