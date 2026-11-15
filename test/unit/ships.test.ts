import { expect, test } from 'vitest';
import { pickShipKind, shipRoom } from '@/ships';

const h = () => 0.1;

test('small rivers never receive barges or oversized tour boats', () => {
  for (const width of [10, 15, 23]) expect(pickShipKind('river', 700, width, false, h)).toBe('motor');
  for (const width of [24, 33, 60, 89]) expect(pickShipKind('river', 700, width, false, h)).toBe('tour');
  expect(pickShipKind('river', 500, 100, false, h)).toBe('barge');
  expect(pickShipKind('river', 250, 100, false, h)).toBe('tour');
  expect(pickShipKind('river', 700, 8, false, h)).toBeNull();
});

test('large vessels need sustained width beyond their hull', () => {
  const narrow = (_x: number, y: number) => Math.abs(y) < 20;
  const broad = (_x: number, y: number) => Math.abs(y) < 60;
  const widening = (x: number, y: number) => Math.abs(y) < (Math.abs(x) < 60 ? 60 : 20);
  expect(shipRoom(narrow, 0, 0, 0, 100, 11)).toBe(false);
  expect(shipRoom(broad, 0, 0, 0, 100, 11)).toBe(true);
  expect(shipRoom(widening, 0, 0, 0, 100, 11)).toBe(false);
  expect(shipRoom(narrow, 0, 0, 0, 10, 3)).toBe(true);
});

test('approach checks catch islands and work for rotated channels', () => {
  const island = (x: number, y: number) => !(x > 90 && x < 105 && Math.abs(y) < 8);
  expect(shipRoom(island, 0, 0, 0, 100, 11)).toBe(false);
  const vertical = (x: number, _y: number) => Math.abs(x - 30) < 60;
  expect(shipRoom(vertical, 30, -20, Math.PI / 2, 100, 11)).toBe(true);
  expect(shipRoom(vertical, 30, -20, 0, 100, 11)).toBe(false);
});
