import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The worker loads the country lookup on demand, which needs ES module workers.
  worker: { format: 'es' },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
});
