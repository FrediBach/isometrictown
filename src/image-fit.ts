/**
 * Where an image sits on the sheet in image mode. It is pinned to the drawing area: Fill covers
 * the area and crops the image round its focus, Fit shows all of it with free ground beside it.
 * This module draws nothing, so the interface uses it too, for the image well and the overlay.
 */

/** An image placed on the sheet: its top-left corner and size in sheet mm, and image pixels per mm. */
export type Placed = { x: number; y: number; w: number; h: number; ppm: number };

/**
 * Place a `w` × `h` pixel image on the drawing area `rect` ([x0, y0, x1, y1] in sheet mm).
 * In Fill, `focus` is the point of the image (as fractions of its width and height) that comes to
 * the middle of the area, as far as the image reaches; Fit centres the image and ignores it.
 */
export function fitImage(rect: readonly number[], w: number, h: number, fit: 'fill' | 'fit', focus: readonly [number, number] = [0.5, 0.5]): Placed {
  const [x0, y0, x1, y1] = rect;
  const rw = x1 - x0;
  const rh = y1 - y0;
  const mm = fit === 'fill' ? Math.max(rw / w, rh / h) : Math.min(rw / w, rh / h);
  const W = w * mm;
  const H = h * mm;
  const along = (lo: number, size: number, span: number, f: number) =>
    fit === 'fit' ? lo + (span - size) / 2 : Math.min(lo, Math.max(lo + span - size, lo + span / 2 - f * size));
  return { x: along(x0, W, rw, focus[0]), y: along(y0, H, rh, focus[1]), w: W, h: H, ppm: 1 / mm };
}

/** Image pixel coordinates (continuous, 0 at the left and top edges) of a sheet position in mm. */
export function toImage(p: Placed, sx: number, sy: number): [number, number] {
  return [(sx - p.x) * p.ppm, (sy - p.y) * p.ppm];
}

/** Sheet position in mm of image pixel coordinates. */
export function toSheet(p: Placed, px: number, py: number): [number, number] {
  return [p.x + px / p.ppm, p.y + py / p.ppm];
}

/**
 * The focus after dragging the image by `dx`, `dy` (in the units of `p` and `rect`), so the image
 * follows the pointer. It starts from the point that shows in the middle now, so a focus the
 * crop couldn't reach has no dead zone, and it ends where the crop stops.
 */
export function dragFocus(p: Placed, rect: readonly number[], dx: number, dy: number): [number, number] {
  const [x0, y0, x1, y1] = rect;
  const at = (lo: number, size: number, span: number, start: number, d: number) => {
    if (size <= span + 1e-9) return 0.5;
    const half = span / 2 / size;
    return Math.max(half, Math.min(1 - half, ((lo + span / 2 - start) - d) / size));
  };
  return [at(x0, p.w, x1 - x0, p.x, dx), at(y0, p.h, y1 - y0, p.y, dy)];
}
