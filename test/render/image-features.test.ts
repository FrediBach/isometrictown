/** Feature-level regressions that the mean likeness of a whole sheet can hide. */
import { expect, test } from 'vitest';
import { PICTURES, runCase } from '../../lab/likeness.js';

test.each(['a4', 'a3'] as const)('the street control turns following both bright arms on and off on %s', (sheet) => {
  const { features } = runCase('cross', 2500, { sheet, contours: 1 });
  const off = runCase('cross', 2500, { sheet, contours: 0 }).features;
  expect(off['Horizontal arm followed']).toBeLessThan(0.3);
  expect(off['Vertical arm followed']).toBeLessThan(0.3);
  expect(features['Horizontal arm followed']).toBeGreaterThan(0.6);
  expect(features['Vertical arm followed']).toBeGreaterThan(0.6);
});

test('the colour check measures each band against its own hue', () => {
  const { features } = runCase('bands', 2500);
  expect(features['Red chroma retained']).toBeGreaterThan(0.04);
  expect(features['Green chroma retained']).toBeGreaterThan(0.06);
  // Blue is currently the hardest band for the five materials to reproduce.
  expect(features['Blue chroma retained']).toBeGreaterThan(0);
});

test('the lab fixtures include opaque photo pixels and a transparent logo', () => {
  const alpha = (name: string) => PICTURES[name]().rgba.filter((_, i) => i % 4 === 3);
  expect(alpha('astronaut').every((a) => a === 255)).toBe(true);
  const logo = alpha('logo');
  expect(logo.includes(0) && logo.includes(255)).toBe(true);
});
