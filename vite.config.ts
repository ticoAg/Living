import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig, lazyPlugins } from 'vite-plus';

export default defineConfig(({ mode }) => ({
  // The Cloudflare plugin runs worker/index.ts in workerd next to the SPA, with the bindings from wrangler.jsonc.
  // `vp build` writes dist/client and dist/living; `wrangler deploy` picks them up through .wrangler/deploy.
  // Vitest (mode 'test') runs plain Node tests; the Cloudflare plugin's dev server would clash with Vitest's.
  plugins: lazyPlugins(() => (mode === 'test' ? [react()] : [react(), cloudflare()])),
  build: { chunkSizeWarningLimit: 1400 },
  fmt: {
    singleQuote: true,
    printWidth: 140,
    trailingComma: 'none',
    // CSS keeps its one-rule-per-line layout; docs are hand-written OKF Markdown.
    ignorePatterns: ['**/*.css', 'docs/**', 'dist/**', 'package-lock.json']
  },
  lint: {
    ignorePatterns: ['dist/**', '.wrangler/**'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      // Length limits count Unicode code points on both client and server, which is what spreading a string gives.
      'typescript/no-misused-spread': 'off'
    },
    options: { typeAware: true, typeCheck: true }
  },
  test: {
    include: ['{src,worker,shared}/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true
  }
}));
