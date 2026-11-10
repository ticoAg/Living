import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defaultExclude, defineConfig, lazyPlugins } from 'vite-plus';

// Route tests run the API against local D1, R2 and KV in workerd (worker/test-platform.ts). They have their own command,
// `npm run test:routes` (mode 'routes'), and stay out of `vp test` and `npm run build`: the deploy build must not
// depend on starting workerd.
const ROUTE_TESTS = 'worker/**/*.routes.test.ts';

export default defineConfig(({ mode }) => ({
  // The Cloudflare plugin runs worker/index.ts in workerd next to the SPA, with the bindings from wrangler.jsonc.
  // `vp build` writes dist/client and dist/living; `wrangler deploy` picks them up through .wrangler/deploy.
  // Vitest (modes 'test' and 'routes') runs in Node; the Cloudflare plugin's dev server would clash with Vitest's.
  plugins: lazyPlugins(() => (mode === 'test' || mode === 'routes' ? [react()] : [react(), cloudflare()])),
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
  test:
    mode === 'routes'
      ? { include: [ROUTE_TESTS], environment: 'node', hookTimeout: 60_000, testTimeout: 20_000 }
      : { include: ['{src,worker,shared}/**/*.test.ts'], exclude: [...defaultExclude, ROUTE_TESTS], environment: 'node' }
}));
