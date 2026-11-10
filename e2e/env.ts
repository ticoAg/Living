// Settings shared by the Playwright config, the state reset and the specs.

/** The port the smoke tests serve the built app on: fixed, so a stray server shows up as a failure, not a reuse. */
export const PORT = Number(process.env.E2E_PORT ?? 4281);
export const BASE_URL = `http://localhost:${PORT}`;

/** Local D1, R2 and KV of the smoke tests, rebuilt before every run (see vite.config.ts, LIVING_STATE_DIR). */
export const STATE_DIR = '.wrangler/e2e-state';
/** Reports, traces and the signed-in browser state the specs hand on. */
export const OUT_DIR = '.wrangler/e2e';
export const OWNER_STATE = `${OUT_DIR}/owner.json`;

/** The owner invite written into the fresh database, and the account the story registers with it. */
export const OWNER = { invite: 'E2EOWNER01', handle: 'linzhi', name: '站长', password: 'smoke-test-pass-1' };
