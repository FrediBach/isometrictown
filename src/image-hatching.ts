import type { Target } from './image-read';

/** Local hatch density relative to the drawing's usual spacing, sampled in sheet millimetres. */
export class ImageHatching {
  private readonly density: Float32Array;
  readonly minGap: number;

  /** `strength` is the setting's, or one per cell of the grid where masks set it for parts of the picture. */
  constructor(private readonly grid: Pick<Target, 'x0' | 'y0' | 'W' | 'H' | 'cell' | 'tone' | 'weight'>, strength: number | Float32Array, nib: number) {
    this.minGap = 1.3 * nib;
    // Mid-grey keeps the usual spacing. At full strength black can double the lines,
    // and white leaves only one in eight. Transparent pixels keep the town's own tone.
    this.density = Float32Array.from(grid.tone, (light, i) => {
      const contrast = 1 - 2 * light;
      return 1 + (typeof strength === 'number' ? strength : strength[i]) * grid.weight[i] * contrast * (contrast > 0 ? 1 : 0.875);
    });
  }

  /** The usual hatch density is one, including outside the picture. */
  at(sx: number, sy: number): number {
    const { x0, y0, cell, W, H } = this.grid;
    const x = Math.floor((sx - x0) / cell), y = Math.floor((sy - y0) / cell);
    return x >= 0 && x < W && y >= 0 && y < H ? this.density[y * W + x] : 1;
  }

  /** Leave visible paper between neighbouring strokes when placing extra ink. */
  gap(spacing: number, sx: number, sy: number): number {
    const density = this.at(sx, sy);
    if (density <= 1) return spacing / density;
    return Math.max(Math.min(spacing, this.minGap), spacing / density);
  }
}
