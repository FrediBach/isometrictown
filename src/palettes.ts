import type { Settings } from './settings';

export type Palette = {
  name: string;
  /** In pen order: shadows, water, parks and trees, pitched roofs, buildings and streets. */
  pens: Settings['pens'];
};

/**
 * Pen sets for the five layers. Most start from palettes on ColorKit
 * (colorkit.co/palettes/4-colors), reordered so each colour suits its job:
 * the darkest takes the linework, and the shadows get a dark hue, the second
 * darkest pen in the set, so hatching reads as shade.
 * Each set is then tuned in OKLCH, keeping its hues but spreading lightness and
 * chroma. The fifth pen (water or shadows, whichever the original set lacked)
 * was found with the harmoniser, holding the other four. Any two pens in a set are
 * at least 0.19 apart in OKLab, except in Newsprint (0.14), whose
 * greys leave less room; dark shadows sit closer, at least 0.12 from any other pen.
 * The linework pen is the darkest in every set.
 */
export const PALETTES: Palette[] = [
  { name: 'Classic', pens: ['#3e4657', '#2149b8', '#21894a', '#d42f3a', '#1b1e23'] },
  { name: 'Archive', pens: ['#464500', '#7292d0', '#317061', '#822b2e', '#04263f'] },
  { name: 'Heritage', pens: ['#6a3b8f', '#05585f', '#6b961e', '#ecaa0b', '#5e1924'] },
  { name: 'Newsprint', pens: ['#333333', '#439081', '#5d5d5d', '#d40f0c', '#0b0b0b'] },
  { name: 'Twilight', pens: ['#40287e', '#19bb9d', '#4378ad', '#913378', '#1d162a'] },
  { name: 'Autumn', pens: ['#005476', '#76a9af', '#5d6b2b', '#dd5c00', '#472215'] },
  { name: 'Slate', pens: ['#5d5a7e', '#04869c', '#b97515', '#962d39', '#2b3f51'] },
  { name: 'Driftwood', pens: ['#00327d', '#2495aa', '#c5a16e', '#8d4635', '#191a24'] },
];

/** The palette the pens match exactly, if any. */
export function currentPalette(pens: readonly string[]): Palette | undefined {
  return PALETTES.find((p) => p.pens.every((c, i) => c.toLowerCase() === pens[i]?.toLowerCase()));
}
