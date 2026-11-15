import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests run in Node with no network: `test/setup.ts` swaps `fetch` for recorded fixtures.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: {
    setupFiles: ['test/setup.ts'],
    projects: [
      { extends: true, test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
      // Whole drawings take seconds each; they get room, and record mode gets more.
      { extends: true, test: { name: 'render', include: ['test/render/**/*.test.ts'], testTimeout: process.env.RECORD === '1' ? 300_000 : 120_000, hookTimeout: 300_000 } },
    ],
  },
});
