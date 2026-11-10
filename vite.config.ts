import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import monoRanges from '@fontsource/dm-mono/unicode.json';
import serifRanges from '@fontsource/noto-serif-sc/unicode.json';
import latinRanges from '@fontsource/spectral/unicode.json';
import { defaultExclude, defineConfig, lazyPlugins, type Plugin } from 'vite-plus';

// Route tests run the API against local D1, R2 and KV in workerd (worker/test-platform.ts). They have their own command,
// `npm run test:routes` (mode 'routes'), and stay out of `vp test` and `npm run build`: the deploy build must not
// depend on starting workerd.
const ROUTE_TESTS = 'worker/**/*.routes.test.ts';

// Self-hosted web fonts, only the faces the styles use (see "设计令牌" in docs/architecture/frontend.md).
// Interface text uses system fonts. Noto Serif SC keeps Google's ~100 unicode-range slices, so a page
// downloads only the slices holding characters it shows. Latin families ship their latin subset only.
const FONTS: { pkg: string; family: string; ranges: Record<string, string>; weights: number[]; subsets?: string[] }[] = [
  { pkg: '@fontsource/noto-serif-sc', family: 'Noto Serif SC', ranges: serifRanges, weights: [500, 600, 700] },
  { pkg: '@fontsource/dm-mono', family: 'DM Mono', ranges: monoRanges, weights: [400, 500], subsets: ['latin'] },
  { pkg: '@fontsource/spectral', family: 'Spectral', ranges: latinRanges, weights: [300, 500], subsets: ['latin'] }
];

// `virtual:fonts.css`: the @font-face rules, woff2 only (fontsource's own CSS also pulls in a woff copy of
// every slice). Rules are grouped by slice rather than by weight so the three copies of each long
// unicode-range sit next to each other and compress away. src/main.tsx loads it without blocking render.
function fonts(): Plugin {
  const id = 'virtual:fonts.css';
  let base = '/';
  return {
    name: 'living:fonts',
    configResolved: (config) => void (base = config.base),
    resolveId: (source) => (source === id ? '\0fonts.css' : undefined),
    async load(resolved) {
      if (resolved !== '\0fonts.css') return;
      const rules: string[] = [];
      for (const { pkg, family, ranges, weights, subsets } of FONTS) {
        const slug = pkg.split('/')[1];
        for (const [subset, range] of Object.entries(ranges)) {
          if (subsets && !subsets.includes(subset)) continue;
          for (const weight of weights) {
            const file = `${pkg}/files/${slug}-${subset.replace(/^\[(\d+)\]$/, '$1')}-${weight}-normal.woff2`;
            if (!(await this.resolve(file))) throw new Error(`missing font file ${file}`);
            rules.push(
              `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('${file}') format('woff2');unicode-range:${range}}`
            );
          }
        }
      }
      return rules.join('\n');
    },
    // In the build, also link the font stylesheet from index.html so it downloads alongside the entry script
    // instead of after it runs, and its faces are declared before React's first paint. media="print" keeps
    // the link from blocking render; onload switches it on. The import in main.tsx then finds the link and
    // adds nothing (in dev it is what loads the rules). The wordmark face is preloaded: every page shows
    // LIVING in the header, so it is needed anyway, and this way it does not flash in Georgia first.
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return;
        const assets = Object.values(ctx.bundle).filter((f) => f.type === 'asset');
        const href = (name: string) => {
          const hit = assets.find((f) => f.originalFileNames.some((n) => n.endsWith(name)));
          if (!hit) throw new Error(`${name} missing from the bundle`);
          return base + hit.fileName;
        };
        return [
          {
            tag: 'link',
            attrs: { rel: 'preload', href: href('/spectral-latin-500-normal.woff2'), as: 'font', type: 'font/woff2', crossorigin: '' },
            injectTo: 'head'
          },
          {
            tag: 'link',
            attrs: { rel: 'stylesheet', href: href('fonts.css'), media: 'print', onload: "this.media='all'" },
            injectTo: 'head'
          }
        ];
      }
    }
  };
}

// Where `vp dev` and `vp preview` keep the local D1, R2 and KV. LIVING_STATE_DIR moves them out of .wrangler/state,
// so the smoke tests (e2e/) run on a throwaway copy and never touch the developer's local data.
const persistState = process.env.LIVING_STATE_DIR ? { path: process.env.LIVING_STATE_DIR } : true;

export default defineConfig(({ mode }) => ({
  // The Cloudflare plugin runs worker/index.ts in workerd next to the SPA, with the bindings from wrangler.jsonc.
  // `vp build` writes dist/client and dist/living; `wrangler deploy` picks them up through .wrangler/deploy.
  // Vitest (modes 'test' and 'routes') runs in Node; the Cloudflare plugin's dev server would clash with Vitest's.
  plugins: lazyPlugins(() => (mode === 'test' || mode === 'routes' ? [react()] : [react(), fonts(), cloudflare({ persistState })])),
  build: {
    chunkSizeWarningLimit: 1400,
    // A font slice inlined as base64 would weigh on the font stylesheet of every page, used or not.
    assetsInlineLimit: (file: string) => (file.endsWith('.woff2') ? false : undefined)
  },
  fmt: {
    singleQuote: true,
    printWidth: 140,
    trailingComma: 'none',
    // CSS keeps its one-rule-per-line layout; docs are hand-written OKF Markdown.
    ignorePatterns: ['**/*.css', 'docs/**', 'dist/**', 'package-lock.json']
  },
  lint: {
    ignorePatterns: ['dist/**', '.wrangler/**'],
    // `plugins` replaces Oxlint's default set, so the defaults (unicorn, typescript, oxc) are listed too.
    plugins: ['unicorn', 'typescript', 'oxc', 'react', 'jsx-a11y'],
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      'react/rules-of-hooks': 'error',
      'react/exhaustive-deps': 'error',
      // Components keep the last loaded value, or the latest props for callbacks, in a ref read during render.
      'react/refs': 'off',
      // Effects reset state when a key changes, load fetched data into an editable draft, or create object URLs.
      'react/set-state-in-effect': 'off',
      // It flags locals that an effect or async callback reassigns (in-flight flags, timer ids); they never leave the closure.
      'react/immutability': 'off',
      // Only matters to the React Compiler, which the app does not use; it also misreads stable state setters.
      'react/preserve-manual-memoization': 'off',
      // `role="status"` on a div or p, `role="group"` on a div: <output> and <fieldset> carry form semantics and styling.
      'jsx-a11y/prefer-tag-over-role': 'off',
      // Focus goes to the field the visitor just opened: the login form, an inline rename, a new theme's title.
      'jsx-a11y/no-autofocus': 'off',
      // `nickname` is a valid autofill token (HTML spec) that the rule does not know.
      'jsx-a11y/autocomplete-valid': 'off',
      // A native checkbox with role="switch" exposes its checked state; aria-checked would duplicate it.
      'jsx-a11y/role-has-required-aria-props': 'off',
      // Forms, list rows, labels and <main> take key, drag and hover handlers for delegation, drop zones and highlights;
      // the actions themselves are real buttons and inputs.
      'jsx-a11y/no-noninteractive-element-interactions': 'off',
      // The photo editor's focus picker is a focusable group moved with the arrow keys; ARIA has no 2-D slider role.
      'jsx-a11y/no-noninteractive-tabindex': 'off',
      // Length limits count Unicode code points on both client and server, which is what spreading a string gives.
      'typescript/no-misused-spread': 'off'
    },
    overrides: [
      // The Worker has no React; `usePlatform()` in the route tests is a test fixture, not a hook.
      { files: ['worker/**'], rules: { 'react/rules-of-hooks': 'off' } },
      // Pointer-only conveniences with a keyboard path elsewhere: the user menu closes after a pick (a link's own click
      // bubbles up), a click on Living's stage shows the bar (keys and focus do too), the picker's backdrop closes it (Esc).
      {
        files: ['src/components/Header.tsx', 'src/pages/Living.tsx', 'src/themes/PhotoPicker.tsx'],
        rules: { 'jsx-a11y/click-events-have-key-events': 'off', 'jsx-a11y/no-static-element-interactions': 'off' }
      }
    ],
    options: { typeAware: true, typeCheck: true }
  },
  test:
    mode === 'routes'
      ? { include: [ROUTE_TESTS], environment: 'node', hookTimeout: 60_000, testTimeout: 20_000 }
      : { include: ['{src,worker,shared}/**/*.test.ts'], exclude: [...defaultExclude, ROUTE_TESTS], environment: 'node' },
  // The pre-commit hook (.vite-hooks/pre-commit runs `vp staged`): format and lint the staged files, fixing what can be
  // fixed and staging the fixes. Type errors are reported for those files only; the full check and the tests stay in CI.
  staged: {
    '*': 'vp check --fix --no-error-on-unmatched-pattern'
  }
}));
