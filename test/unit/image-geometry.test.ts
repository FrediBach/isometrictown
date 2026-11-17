import { expect, test } from 'vitest';
import { Ground, plausibility, simpleFootprint } from '@/image-check';
import { empty } from '@/tiles';

test('footprints may turn inwards but no edges cross, touch or double back', () => {
  expect(simpleFootprint([0, 0, 8, 0, 8, 3, 3, 3, 3, 7, 0, 7])).toBe(true);
  const folded = [0, 0, 10, 0, 4, 9, 7, 8];
  expect(simpleFootprint(folded)).toBe(false);
  expect(simpleFootprint([0, 0, 8, 0, 8, 8, 4, 0, 0, 8])).toBe(false);
  expect(simpleFootprint([0, 0, 8, 0, 4, 0, 8, 8, 0, 8])).toBe(false);
  const town = empty();
  town.buildings.push({ shape: [{ pts: folded, seam: new Uint8Array(4) }], min: 0, h: 7 });
  expect(plausibility(town).join(' ')).toContain('not a simple ring');
});

test('the full stream width excludes a crossing wall or tree crown, and gives no street frontage', () => {
  const town = empty();
  town.streams.push({ pts: [4, -5, 4, 20], width: 2 });
  const ground = new Ground(town);
  expect(ground.under(4.9, 0)).toBe('a stream');
  expect(ground.under(5.1, 0)).toBe(null);
  expect(ground.under(7.1, 0, 2.2)).toBe('a stream');
  expect(ground.front(4, 1)).toBe(Infinity);
  const wall = [0, 0, 20, 0, 20, 7, 0, 7];
  expect(ground.clear(wall)).toBe(false);
  expect(ground.clear([6, 0, 20, 0, 20, 7, 6, 7])).toBe(true);
  town.buildings.push({ shape: [{ pts: wall, seam: new Uint8Array(4) }], min: 0, h: 7 });
  town.trees.push({ x: 7.1, y: 10, r: 2.2, h: 8, conifer: false });
  const issues = plausibility(town).join(' ');
  expect(issues).toContain('a building stands on a stream');
  expect(issues).toContain('a tree stands on a stream');
});
