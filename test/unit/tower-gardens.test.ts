import { describe, expect, test } from 'vitest';
import { newSolid, type Build } from '@/buildings';
import { Camera } from '@/camera';
import { pointInRing } from '@/geo';
import { Paper } from '@/raster';
import { DEFAULT_SETTINGS, LINEWORK } from '@/settings';
import { corners } from '@/shape';
import { towerDeck, towerGardens } from '@/tower-gardens';
import type { Building } from '@/tiles';

function host(dx = 0): Building {
  return { shape: [{ pts: corners({ cx: -dx, cy: 0, ux: 1, uy: 0, L: 40, w: 30 }), seam: new Uint8Array(4) }], h: 120, min: 0 };
}

describe('tower garden bands', () => {
  test('two to four broad openings leave substantial tower floors above and between them', () => {
    for (const [height, count] of [[60, 2], [100, 2], [165, 3], [240, 4]]) {
      const p = towerGardens(host(), 0, height)!;
      expect(p.bands).toHaveLength(count);
      expect(p.depth).toBe(5);
      let end = 0;
      for (const [za, zb] of p.bands) {
        expect(za - end).toBeGreaterThanOrEqual(10);
        expect(zb - za).toBe(9);
        end = zb;
      }
      expect(height - end).toBeGreaterThan(10);
    }
  });
  test('declines courtyards, tile cuts, narrow and indented hosts', () => {
    for (const kind of ['hole', 'seam', 'narrow', 'indent']) {
      const b = host();
      if (kind === 'hole') b.shape.push({ pts: [-1, -1, 1, -1, 1, 1, -1, 1], seam: new Uint8Array(4) });
      if (kind === 'seam') b.shape[0].seam[0] = 1;
      if (kind === 'narrow') b.shape[0].pts = [-20, -8, 20, -8, 20, 8, -20, 8];
      if (kind === 'indent') b.shape[0] = { pts: [-20, -15, 20, -15, 20, 15, 1, 15, 1, 0, -1, 0, -1, 15, -20, 15], seam: new Uint8Array(8) };
      expect(towerGardens(b, 0, 120)).toBeNull();
    }
    expect(towerGardens(host(), 80, 120)).toBeNull();
  });
  test('bands and footprints stay fixed under panning and raised bases', () => {
    const a = towerGardens(host(), 8, 128)!;
    for (const dx of [30, 47, 310]) {
      const b = towerGardens(host(dx), 8, 128)!;
      expect(b.bands).toEqual(a.bands);
      for (const key of ['core', 'supports'] as const) b[key].forEach((v, i) => expect(v + (i % 2 ? 0 : dx)).toBeCloseTo(a[key][i], 8));
    }
    expect(a.bands[0][0]).toBeGreaterThan(8);
  });
  test('columns stay inside the host and remain visible against their own depth faces', () => {
    const b = host(), plan = towerGardens(b, 0, 120)!;
    for (const scale of [1000, 4000, 8000]) for (const bearing of [0, 90, 180]) {
      const set = { ...structuredClone(DEFAULT_SETTINGS), scale, bearing };
      const B = { set, cam: new Camera(set) } as Build;
      const s = newSolid(); towerDeck(B, plan, 30, 39, s);
      expect(s.faces).toHaveLength(32);
      for (const f of s.faces) for (const p of f) for (let i = 0; i < p.length; i += 3) {
        expect(pointInRing(p[i], p[i + 1], b.shape[0].pts)).toBe(true);
        expect(p[i + 2]).toBeGreaterThanOrEqual(30);
        expect(p[i + 2]).toBeLessThanOrEqual(39);
      }
      expect(s.lines.every(l => l.pts.every(Number.isFinite))).toBe(true);
      const paper = new Paper(B.cam);
      for (const f of s.faces) paper.fillFace(f);
      paper.finishDepth();
      for (const l of s.lines.filter(l => l.pen === LINEWORK)) paper.line3(l.pen, l.pts);
      paper.end();
      expect(paper.pens[LINEWORK].length).toBeGreaterThan(0);
    }
  });
});
