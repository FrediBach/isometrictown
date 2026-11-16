import { describe, expect, test } from 'vitest';
import { ENTRIES, filed, GATE_LABEL, GROUPS, matcher } from '@/catalogue';
import { LOD } from '@/lod';
import { DEFAULT_SETTINGS } from '@/settings';

describe('catalogue', () => {
  test('ids are unique', () => {
    const ids = ENTRIES.map((e) => e.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  test.each(ENTRIES.map((e) => [e.id, e] as const))('%s is complete and points at things that exist', (_id, e) => {
    expect(GROUPS.some((g) => g.id === e.group)).toBe(true);
    expect(e.name.trim()).not.toBe('');
    expect(e.what.trim()).not.toBe('');
    expect(e.source.length).toBeGreaterThan(0);
    for (const g of e.needs ?? []) {
      expect(GATE_LABEL[g], `gate ${g}`).toBeDefined();
      expect(g.split(':')[0] in DEFAULT_SETTINGS, `gate ${g} is a setting`).toBe(true);
    }
    for (const r of e.lod ?? []) expect(LOD[r], `rule ${r}`).toBeDefined();
    for (const p of e.strokes ?? []) expect(p).toMatch(/^(=?[a-zA-Z*][\w:-]*)(\/[\w-]+)*$/);
  });

  test('stroke patterns match tally names as documented', () => {
    expect(matcher('streets:bridges')(filed('streets:bridges'))).toBe(true);
    expect(matcher('trees')(filed('trees:palms/x'))).toBe(true);
    expect(matcher('trees')(filed('treesX'))).toBe(false);
    expect(matcher('=cars')(filed('cars'))).toBe(true);
    expect(matcher('=cars')(filed('cars:parked'))).toBe(false);
    expect(matcher('details/chimney')(filed('details/chimney/house'))).toBe(true);
    expect(matcher('details/chimney')(filed('details/dormer'))).toBe(false);
    expect(matcher('*/house')(filed('roofs/house/gabled-roof'))).toBe(true);
  });
});
