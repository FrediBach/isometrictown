import { afterAll, beforeAll, vi } from 'vitest';

/** The date the imprint in the margin says each sheet was drawn. */
export const DRAWN_ON = new Date('2026-06-15T12:00:00Z');

/** Pin `Date` (only) for a file of drawings, so the dated imprint doesn't change the goldens every month. */
export function pinClock(): void {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DRAWN_ON);
  });
  afterAll(() => vi.useRealTimers());
}
