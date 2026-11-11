import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, OUT_DIR, PORT, STATE_DIR } from './env.ts';

// Smoke tests against the built app: `npm run test:e2e` builds, then Playwright resets the test database, starts
// `vp preview` (the built Worker in workerd) and runs the specs. See docs/runbooks/local-dev.md#冒烟测试.
//
// The browser is Playwright's own Chromium (`npx playwright install chromium`). E2E_CHROMIUM points at another
// Chromium binary instead, for machines that come with one and should not download a second.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: `${ROOT}${OUT_DIR}/results`,
  // the story builds on its own steps; the other specs are independent of each other and of the order they run in
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: `${ROOT}${OUT_DIR}/report`, open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // A camera that is not there, for the site's own camera: getUserMedia gets a generated picture, and the
      // question whether the page may use it is answered yes (the headless shell refuses the camera without this).
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
      ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {})
    }
  },
  projects: [
    // registers the owner, uploads and publishes the sample photos, walks every page and saves the session
    { name: 'story', testMatch: 'story.spec.ts', use: desktop },
    // fixes worth guarding, run on the story's data and session
    { name: 'regressions', testMatch: 'regressions.spec.ts', dependencies: ['story'], use: desktop }
  ],
  webServer: {
    // a fresh database on every run, then the build `npm run test:e2e` has just made
    command: `node e2e/state.ts && vp preview --port ${PORT} --strictPort`,
    cwd: ROOT,
    url: `${BASE_URL}/api/site`,
    // a server already on the port would bring its own data: fail rather than test against it
    reuseExistingServer: false,
    timeout: 120_000,
    env: { LIVING_STATE_DIR: STATE_DIR, WRANGLER_SEND_METRICS: 'false' },
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    stdout: 'ignore',
    stderr: 'pipe'
  }
});
