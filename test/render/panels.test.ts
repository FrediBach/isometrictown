import { expect, test } from 'vitest';
import { layersOf } from '@/gcode';
import { layout, panelCount, panelOrigin, panelSvg, planDrawing } from '@/panels';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';
import { drawImage } from '../support/draw';
import { PICTURES } from '../support/pictures';

test('a set of sheets draws one town across them, with nothing in the gaps and each sheet a file of its own', () => {
  const pic = PICTURES.disc();
  const set: Settings = { ...structuredClone(DEFAULT_SETTINGS), source: 'image', image: pic.id, imageName: pic.name, scale: 4000, power: false, sheet: 'a4', panelCols: 2, panelRows: 1, panelGap: 40 };
  const drawn = drawImage(set, pic);
  const cam = drawn.cam;
  const l = layout(set);
  expect(cam.sheet).toEqual(l.wall);

  // Scene strokes stay inside the drawing areas; frames and notes stay on the sheets.
  const [m] = cam.margins;
  const g = 2.5 + 0.01;
  for (const pen of drawn.raw) for (const line of pen) {
    for (let i = 0; i < line.length; i += 2) {
      const x = line[i];
      const onSheet = (x >= -0.01 && x <= l.sheet[0] + 0.01) || (x >= l.sheet[0] + l.gap - 0.01 && x <= l.wall[0] + 0.01);
      expect(onSheet).toBe(true);
    }
  }
  const scene = [...drawn.tally].filter(([name]) => !name.startsWith('margin')).flatMap(([, lines]) => lines);
  expect(scene.length).toBeGreaterThan(100);
  for (const line of scene) {
    const x = line[0];
    expect(cam.panels.some(([x0, y0, x1, y1]) => x >= x0 - 1e-6 && x <= x1 + 1e-6 && line[1] >= y0 - 1e-6 && line[1] <= y1 + 1e-6)).toBe(true);
  }
  // Streets run on across the gap: both sheets are drawn up to the edges that face each other.
  const facing = (edge: number) => scene.some((line) => line.some((v, i) => i % 2 === 0 && Math.abs(v - edge) < 1e-6));
  expect(facing(cam.panels[0][2])).toBe(true);
  expect(facing(cam.panels[1][0])).toBe(true);
  expect(cam.panels[1][0] - cam.panels[0][2]).toBeCloseTo(2 * m + l.gap, 6);

  // Each sheet has its own frame round its drawing area.
  for (const [x0, y0, x1, y1] of cam.panels) {
    expect(drawn.raw.flat().some((s) => s.length === 10 && s[0] === x0 && s[1] === y0 && s[4] === x1 && s[5] === y1)).toBe(true);
  }

  const { svg, stats } = planDrawing(drawn.raw, drawn.set, cam.layout);
  const files = Array.from({ length: panelCount(l) }, (_, i) => layersOf(panelSvg(svg, l, i)));
  const strokes = files.flat().reduce((s, layer) => s + layer.lines.length, 0);
  expect(strokes).toBe(stats.lifts);
  for (const [i, layers] of files.entries()) {
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) for (const line of layer.lines) for (let k = 0; k < line.length; k += 2) {
      expect(line[k]).toBeGreaterThanOrEqual(-g);
      expect(line[k]).toBeLessThanOrEqual(l.sheet[0] + g);
      expect(line[k + 1]).toBeLessThanOrEqual(l.sheet[1] + g);
    }
    expect(panelOrigin(l, i)[1]).toBe(0);
  }
});
