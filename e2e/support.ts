// What every spec shares: the page cut off from the internet, and a record of console errors and uncaught exceptions.
import { test as base, expect, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { BASE_URL } from './env.ts';

export { expect };

/** Stands in for the OpenFreeMap style: a plain background, no sources, so MapLibre asks for no tiles. */
const MAP_STYLE = {
  version: 8,
  name: 'e2e',
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#E9EBE5' } }]
};

const isLocal = (url: URL) => url.hostname === 'localhost' || url.hostname === '127.0.0.1';

/**
 * Answer every request that leaves the test server: the map style with MAP_STYLE, anything else with an empty 204.
 * Fulfilling rather than aborting keeps network errors out of the console. The Worker's own calls (place matching
 * against Photon, Nominatim or AMap) do not pass through the browser; the specs do not depend on what they return.
 */
export async function cutOff(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => !isLocal(url),
    (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'tiles.openfreemap.org' && url.pathname.startsWith('/styles/')) return route.fulfill({ json: MAP_STYLE });
      return route.fulfill({ status: 204 });
    }
  );
}

/** How long the upload page may wait for place matching before the specs answer it themselves. */
const MATCH_BUDGET_MS = 4_000;

/**
 * Place matching is the Worker asking Photon and Nominatim (or AMap), which the browser cannot intercept. Offline those
 * requests fail at once and the Worker answers with the site's own places, so the upload goes on. A network that drops
 * packets instead makes each lookup wait out the Worker's 8 s timeout, one photo after another; past MATCH_BUDGET_MS
 * the page gets the answer it would get offline (no site places exist at that point), and the specs move on.
 */
export async function boundMatching(context: BrowserContext): Promise<void> {
  await context.route('**/api/pois/match', async (route) => {
    let response;
    try {
      response = await route.fetch({ timeout: MATCH_BUDGET_MS });
    } catch {
      return route.fulfill({ json: { candidates: [], province: null, city: null, district: null, provider: 'local', privacyZone: null } });
    }
    return route.fulfill({ response });
  });
}

/** Console errors and uncaught exceptions of a page since the last `take()`. */
export function watch(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()} (${m.location().url})`);
  });
  page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
  return { take: () => errors.splice(0) };
}

/**
 * Follow an in-app link the way a person with a mouse does: point at it, then click. Pointing fetches the page's chunk
 * and data (src/routes.ts), so the click finds them in the cache. The bare press, with that data still on its way, has
 * its own test in regressions.spec.ts (it used to leave the next page on its loading state).
 */
export async function follow(link: Locator) {
  await link.hover();
  await link.page().waitForTimeout(300);
  await link.click();
}

/** The page has rendered something: `#root` is not empty. */
export async function rendered(page: Page) {
  await expect(page.locator('#root > *').first()).toBeVisible();
}

/** No horizontal scrolling: the document is no wider than the viewport. */
export async function noOverflow(page: Page) {
  const { scroll, view } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(scroll, `page is ${scroll}px wide in a ${view}px viewport`).toBeLessThanOrEqual(view);
}

/** JSON API calls with the page's session. Writes carry the site's Origin, which the Worker checks. */
export function apiOf(request: APIRequestContext) {
  const headers = { origin: BASE_URL };
  const ok = async <T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> => {
    expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  };
  return {
    get: async <T>(path: string) => ok<T>(await request.get(path)),
    post: async <T>(path: string, data: unknown) => ok<T>(await request.post(path, { data, headers })),
    patch: async <T>(path: string, data: unknown) => ok<T>(await request.patch(path, { data, headers }))
  };
}

/**
 * `test` with the page cut off from the internet and checked for console errors and uncaught exceptions at the end.
 * A test that provokes errors on purpose sets `allowErrors`.
 */
export const test = base.extend<{ allowErrors: boolean; errors: { take: () => string[] } }>({
  allowErrors: [false, { option: true }],
  context: async ({ context }, use) => {
    await cutOff(context);
    await boundMatching(context);
    await use(context);
  },
  errors: [
    async ({ page, allowErrors }, use) => {
      const w = watch(page);
      await use(w);
      if (!allowErrors) expect(w.take(), 'console errors and uncaught exceptions').toEqual([]);
    },
    { auto: true }
  ]
});
