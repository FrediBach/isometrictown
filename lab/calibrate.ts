/**
 * Measures what each zone label lays down: a town of one label, level and warmth everywhere,
 * drawn with the real renderer, and each pen's coverage over the middle of the sheet. The
 * numbers go into `MATERIALS` in `src/image-tone.ts`. `npm run calibrate` drives it through
 * `lab/calibrate.mjs`. This is the first step of the calibration in docs/plans/image-mode.md §7.3:
 * one scale and tilt for now.
 */
import { Camera } from '../src/camera';
import { Frame } from '../src/geo';
import { drawnAs, imageRegion, imageTown } from '../src/image';
import { coverage, LABELS, type Label } from '../src/image-tone';
import type { Zones } from '../src/image-zones';
import { reachHeight, render } from '../src/render';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { STYLES } from '../src/styles';

export { LABELS };

/** The settings swatches are drawn with: image mode as it starts, on A4 with no margin notes. */
export function swatchSettings(scale: number, tilt: number): Settings {
  return drawnAs({ ...structuredClone(DEFAULT_SETTINGS), source: 'image', scale, tilt, sheet: 'a4', power: false, marginalia: false, frame: false });
}

/** Mean coverage of each pen over the middle of a sheet of one label. */
export function swatch(label: Label, level: number, warmth: number, scale = 2500, tilt = 40): number[] {
  const set = swatchSettings(scale, tilt);
  const cam = new Camera(set);
  const frame = new Frame(set.center);
  const box = cam.region(reachHeight(set));
  const pad = 400;
  const cell = 8;
  const W = Math.ceil((box[2] - box[0] + 2 * pad) / cell);
  const H = Math.ceil((box[3] - box[1] + 2 * pad) / cell);
  const zones: Zones = { x0: box[0] - pad, y0: box[1] - pad, cell, W, H, label: new Uint8Array(W * H).fill(LABELS.indexOf(label)), level: new Float32Array(W * H).fill(level), warmth: new Float32Array(W * H).fill(warmth), sp: new Int32Array(W * H) };
  const region = imageRegion(set);
  const town = imageTown(zones, set, frame, box, STYLES[region.style]);
  const drawing = render(town, set, frame, STYLES[region.style], undefined, region.left);
  // The middle of the drawing area, clear of anything odd at its edges.
  const [x0, y0, x1, y1] = cam.rect;
  const g = { x0: x0 + (x1 - x0) * 0.2, y0: y0 + (y1 - y0) * 0.2, cell: 0.5, W: Math.floor(((x1 - x0) * 0.6) / 0.5), H: Math.floor(((y1 - y0) * 0.6) / 0.5) };
  return coverage(drawing.pens, g, set.penWidth).map((c) => c.reduce((a, v) => a + v, 0) / c.length);
}
