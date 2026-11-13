import type { Settings } from './settings';

export type Palette = {
  name: string;
  /** In pen order: shadows and water, parks and trees, pitched roofs, buildings and streets. */
  pens: Settings['pens'];
};

/**
 * Pen sets for the four layers. Most start from palettes on ColorKit
 * (colorkit.co/palettes/4-colors), reordered so each colour suits its job:
 * the darkest takes the linework, and the shadows get a light or distinct hue.
 * Each set is then tuned in OKLCH, keeping its hues but spreading lightness and
 * chroma, so any two pens in a set are at least 0.19 apart in OKLab. The linework pen is the darkest in every set.
 */
export const PALETTES: Palette[] = [
  { name: 'Classic', pens: ['#2149b8', '#21894a', '#d42f3a', '#1b1e23'] },
  { name: 'Studio', pens: ['#ababa4', '#505448', '#c74726', '#1e201b'] },
  { name: 'Archive', pens: ['#bfb17e', '#317061', '#822b2e', '#04263f'] },
  { name: 'Marigold', pens: ['#32669a', '#e2a520', '#ba365e', '#241933'] },
  { name: 'Heritage', pens: ['#05585f', '#6b961e', '#ecaa0b', '#5e1924'] },
  { name: 'Woodland', pens: ['#3860ac', '#459173', '#7f4d20', '#211346'] },
  { name: 'Newsprint', pens: ['#a4a4a4', '#5d5d5d', '#d40f0c', '#0b0b0b'] },
  { name: 'Twilight', pens: ['#b59be6', '#4378ad', '#913378', '#1d162a'] },
  { name: 'Rosewood', pens: ['#d299a5', '#65836b', '#833b43', '#2a1e21'] },
  { name: 'Autumn', pens: ['#eab532', '#5d6b2b', '#dd5c00', '#472215'] },
  { name: 'Slate', pens: ['#aebabf', '#b97515', '#962d39', '#2b3f51'] },
  { name: 'Driftwood', pens: ['#2495aa', '#c5a16e', '#8d4635', '#191a24'] },
];

/** The palette the pens match exactly, if any. */
export function currentPalette(pens: readonly string[]): Palette | undefined {
  return PALETTES.find((p) => p.pens.every((c, i) => c.toLowerCase() === pens[i]?.toLowerCase()));
}
