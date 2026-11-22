/** Colour adjustments to the source picture, before it is cropped and read into a town. */
import type { Picture } from './image';
import { maskOutline, maskWeights, type ImageMask, type SourceTint } from './image-masks';

/** The active source tints in stack order, including the shape and strength of each mask. */
export function tintKey(masks: readonly ImageMask[]): string {
  const layers = masks.filter(m => !m.off && m.amount > 0 && m.tint && m.tint.amount > 0);
  return layers.length ? JSON.stringify(layers.map(m => [m.shape, m.pts, m.angle, m.round, m.feather, m.invert, m.amount, m.tint])) : '';
}

/** Blend results for every source byte, or every source luminosity for Colour mode. */
function blendTable(tint: SourceTint): Float32Array {
  const rgb = [1, 3, 5].map(start => parseInt(tint.colour.slice(start, start + 2), 16) / 255);
  const lum = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2];
  const below = lum - Math.min(...rgb), above = Math.max(...rgb) - lum;
  const table = new Float32Array(3 * 256);
  for (let ch = 0; ch < 3; ch++) {
    const c = rgb[ch];
    for (let i = 0; i < 256; i++) {
      const b = i / 255;
      let value: number;
      switch (tint.mode) {
        case 'Normal': value = c; break;
        case 'Multiply': value = b * c; break;
        case 'Screen': value = b + c - b * c; break;
        case 'Overlay': value = b < 0.5 ? 2 * b * c : 1 - 2 * (1 - b) * (1 - c); break;
        case 'Colour':
          // Keep source luminosity, reducing saturation only as far as the RGB gamut requires.
          value = b + (c - lum) * Math.min(1, below > 0 ? b / below : 1, above > 0 ? (1 - b) / above : 1);
          break;
      }
      table[ch * 256 + i] = value * 255;
    }
  }
  return table;
}

/** Tint a copy of the original sRGB pixels. Transparent pixels and source alpha are preserved. */
export function tintPicture(pic: Picture, masks: readonly ImageMask[]): Picture {
  const { w, h } = pic;
  let rgba: Uint8ClampedArray | undefined;
  for (const m of masks) {
    const tint = m.tint;
    if (!tint || m.off || !m.amount || !tint.amount) continue;
    rgba ??= pic.rgba.slice();
    const weights = maskWeights(m, maskOutline(m, w, h), m.feather * Math.min(w, h), { x0: 0, y0: 0, cell: 1, W: w, H: h });
    const table = blendTable(tint);
    for (let i = 0; i < weights.length; i++) {
      const k = i * 4, amount = weights[i] * tint.amount;
      if (!amount || !rgba[k + 3]) continue;
      const lum = tint.mode === 'Colour' ? Math.round(0.3 * rgba[k] + 0.59 * rgba[k + 1] + 0.11 * rgba[k + 2]) : undefined;
      for (let ch = 0; ch < 3; ch++) {
        const old = rgba[k + ch];
        rgba[k + ch] = old + amount * (table[ch * 256 + (lum ?? old)] - old);
      }
    }
  }
  return rgba ? { ...pic, rgba } : pic;
}
