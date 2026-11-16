/**
 * The LOD lab: draws test places at a run of scales, headless, and scores every feature for
 * what a plotter wastes on it. `npm run lod` drives it through `lab/run.mjs`.
 */
import { Camera } from '../src/camera';
import { Frame } from '../src/geo';
import { loadTags } from '../src/osm';
import { plan, toSvg } from '../src/plot';
import { reachHeight, render } from '../src/render';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { detectRegion, STYLES } from '../src/styles';
import { loadTown } from '../src/tiles';
import { futureShare } from '../src/catalogue';
import { measure, type SheetStats } from './metrics';
import { thumb, type Thumb } from './thumbs';
import { PLACES, SCALES, type LabPlace } from './places';
import type { ProductionStats } from '../src/production';

export { PLACES, SCALES };
export { difference, png } from './thumbs';
export { LOD, coarsest } from '../src/lod';

export type CaseOptions = { detail?: number; penWidth?: number; sheet?: Settings['sheet']; tags?: boolean; layerDetail?: Settings['layerDetail']; solarpunk?: boolean; climate?: Settings['climate']; depth?: Settings['depth'] };
/** `future` is the share of ink filed under solarpunk features; `thumb` the sheet at preview size. */
export type CaseResult = { place: LabPlace; scale: number; set: Settings; svg: string; stats: SheetStats; ms: number; rect: [number, number, number, number]; future: number; thumb: Thumb; production?: ProductionStats; error?: string };

/** The settings a case is drawn with: the app's defaults at the place, without the flaky OSM tag lookup unless asked. */
export function caseSettings(place: LabPlace, scale: number, o: CaseOptions = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    center: place.center,
    place: place.name,
    bearing: place.bearing,
    scale,
    osmTags: !!o.tags,
    detail: o.detail ?? DEFAULT_SETTINGS.detail,
    penWidth: o.penWidth ?? DEFAULT_SETTINGS.penWidth,
    sheet: o.sheet ?? DEFAULT_SETTINGS.sheet,
    customLayerDetail: !!o.layerDetail,
    layerDetail: o.layerDetail ?? {},
    solarpunk: !!o.solarpunk || !!o.climate || !!o.depth,
    climate: o.climate ?? 'auto',
    depth: o.depth ?? DEFAULT_SETTINGS.depth,
  };
}

/** Draw one place at one scale and score it. */
export async function runCase(place: LabPlace, scale: number, o: CaseOptions = {}): Promise<CaseResult> {
  const set = caseSettings(place, scale, o);
  const cam = new Camera(set);
  const frame = new Frame(set.center);
  const box = cam.region(reachHeight(set));
  const [region, town] = await Promise.all([detectRegion(set.center), loadTown(frame, box, undefined, undefined, set.power)]);
  town.tagged = set.osmTags ? await loadTags(frame, box).catch(() => []) : [];
  const style = STYLES[region.style] ?? STYLES.generic;
  const t0 = performance.now();
  const tally = new Map<string, number[][]>();
  const drawing = render(town, set, frame, style, undefined, region.left, tally);
  const ms = performance.now() - t0;
  const planned = plan(drawing.pens, set);
  const svg = toSvg(planned.pens, set, cam.sheet);
  const stats = measure(tally, cam.rect, set.penWidth, set.speed);
  return { place, scale, set, svg, stats, ms, rect: cam.rect, future: futureShare(tally), thumb: thumb(drawing.pens, set.pens, set.background, cam.sheet, set.penWidth), production: drawing.production };
}
