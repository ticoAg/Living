import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` serves the SPA; API and media requests go to `npm run dev:api` (wrangler dev).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/media': 'http://127.0.0.1:8787'
    }
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1400 }
});
