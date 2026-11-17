/** Local likeness checks for the features the cross and colour-band fixtures are meant to preserve. */
import type { Scene } from '../src/image';
import { fitImage, type Placed } from '../src/image-fit';
import { oklab, type Views } from '../src/image-tone';

/** Fraction of each cross arm followed by an aligned road or path within 3 mm of the centreline. */
function crossArms({ cam, town }: Scene, p: Placed): number[] {
  const [x0, y0, x1, y1] = cam.rect;
  const centre = [p.x + p.w / 2, p.y + p.h * 0.45];
  const start = [Math.max(x0, p.x), Math.max(y0, p.y)];
  const end = [Math.min(x1, p.x + p.w), Math.min(y1, p.y + p.h)];
  const along = end.map((v, i) => new Uint8Array(Math.ceil(v - start[i])));
  for (const way of town.ways) {
    for (let i = 2; i < way.pts.length; i += 2) {
      const [x, y, u, v] = [way.pts[i - 2], way.pts[i - 1], way.pts[i], way.pts[i + 1]];
      const a = [cam.sx(x, y), cam.sy(x, y, 0)];
      const delta = [cam.sx(u, v) - a[0], cam.sy(u, v, 0) - a[1]];
      const axis = Math.abs(delta[0]) >= Math.abs(delta[1]) ? 0 : 1;
      const other = 1 - axis;
      if (!delta[axis] || Math.abs(delta[other] / delta[axis]) > Math.tan(Math.PI / 6)) continue;
      const lo = Math.max(0, Math.ceil(Math.min(a[axis], a[axis] + delta[axis]) - start[axis] - 0.5));
      const hi = Math.min(along[axis].length - 1, Math.floor(Math.max(a[axis], a[axis] + delta[axis]) - start[axis] - 0.5));
      for (let k = lo; k <= hi; k++) {
        const t = (start[axis] + k + 0.5 - a[axis]) / delta[axis];
        if (Math.abs(a[other] + t * delta[other] - centre[other]) <= 3) along[axis][k] = 1;
      }
    }
  }
  return along.map((v) => v.reduce((a, b) => a + b, 0) / Math.max(1, v.length));
}

/** The drawing's mean chroma in each band's target hue direction, as a fraction of the target's. */
function bandHues({ target: t }: Scene, p: Placed, views: Views): Record<string, number> {
  const out: Record<string, number> = {};
  const names = ['Red', 'Green', 'Blue'];
  for (let band = 0; band < 3; band++) {
    const d: [number, number, number] = [0, 0, 0];
    const l: [number, number, number] = [0, 0, 0];
    let n = 0;
    for (let y = 0; y < t.H; y++) {
      const v = (t.y0 + (y + 0.5) * t.cell - p.y) / p.h;
      if (Math.abs(v * 3 - band - 0.5) > 0.3) continue;
      for (let x = 0; x < t.W; x++) {
        const i = y * t.W + x;
        if (!t.weight[i]) continue;
        for (let c = 0; c < 3; c++) {
          d[c] += views.drawing[c][i];
          l[c] += views.look[c][i];
        }
        n++;
      }
    }
    if (!n) continue;
    for (let c = 0; c < 3; c++) { d[c] /= n; l[c] /= n; }
    oklab(...d, d);
    oklab(...l, l);
    const chroma2 = l[1] ** 2 + l[2] ** 2;
    if (chroma2 > 1e-8) out[`${names[band]} chroma retained`] = (d[1] * l[1] + d[2] * l[2]) / chroma2;
  }
  return out;
}

/** The fixture's local checks, as named shares so the report and tests use the same measures. */
export function imageFeatures(name: string, scene: Scene, size: { w: number; h: number }, views: Views): Record<string, number> {
  const p = fitImage(scene.cam.rect, size.w, size.h, scene.set.imageFit, scene.set.imageFocus);
  if (name === 'cross') {
    const [horizontal, vertical] = crossArms(scene, p);
    return { 'Horizontal arm followed': horizontal, 'Vertical arm followed': vertical };
  }
  if (name === 'bands') return bandHues(scene, p, views);
  return {};
}
