// Fixes worth keeping fixed, on the photos and the session the story left behind (story.spec.ts runs first).
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { OWNER, OWNER_STATE } from './env.ts';
import { apiOf, expect, follow, noOverflow, test } from './support.ts';

test.use({ storageState: fileURLToPath(new URL(`../${OWNER_STATE}`, import.meta.url)) });

/** The tag manager's chunk: not among the pages fetched in the background (src/routes.ts, IDLE), so still unloaded. */
const TAGS_CHUNK = /\/assets\/TagsManager-[\w-]+\.js$/;

/**
 * Answer the chunk the way a static host answers for a file a deploy removed: the SPA's index.html, as HTML, with a
 * 200. Returns how many requests were answered so.
 */
async function htmlFor(page: Page, times?: number) {
  const html = await (await page.request.get('/')).text();
  const hits = { n: 0 };
  await page.route(
    TAGS_CHUNK,
    (route) => {
      hits.n++;
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    },
    { times }
  );
  return hits;
}

async function openTagsFromMenu(page: Page) {
  await page.locator('summary[aria-label$="的菜单"]').click();
  await follow(page.getByRole('link', { name: '标签' }));
  await expect(page).toHaveURL(/\/studio\/tags$/);
}

test.describe('a page chunk answered with HTML', () => {
  // the failed import is logged by the browser; that is the point here
  test.use({ allowErrors: true });

  test('loads the page again and recovers', async ({ page }) => {
    await page.goto('/');
    const hits = await htmlFor(page, 1);
    // a marker only this document has: gone after the full page load that fetches the new build
    await page.evaluate(() => ((window as unknown as { e2eMarker: boolean }).e2eMarker = true));
    await openTagsFromMenu(page);
    await expect(page.getByRole('heading', { level: 1, name: '标签' })).toBeVisible();
    await expect(page.locator('#root > *').first()).toBeVisible();
    expect(hits.n).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { e2eMarker?: boolean }).e2eMarker)).toBeUndefined();
  });

  test('ends on "页面没能加载" with a refresh button when it keeps failing', async ({ page }) => {
    await page.goto('/');
    const hits = await htmlFor(page);
    await openTagsFromMenu(page);
    await expect(page.getByRole('heading', { level: 1, name: '页面没能加载' })).toBeVisible();
    await expect(page.getByRole('button', { name: '刷新' })).toBeVisible();
    // the header stays, so there is a way out
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    expect(hits.n).toBeGreaterThanOrEqual(2);
    await page.unroute(TAGS_CHUNK);
    await page.getByRole('button', { name: '刷新' }).click();
    await expect(page.getByRole('heading', { level: 1, name: '标签' })).toBeVisible();
  });
});

test.describe('saving after the session has expired', () => {
  // the refused save is a 401, which the browser logs; anything else still fails the test
  test.use({ allowErrors: true });

  test('asks to sign in again, keeps the form and saves after', async ({ page, context, errors }) => {
    const bio = `会话过期后保存 ${Date.now()}`;
    await page.goto('/settings');
    await expect(page.getByLabel('简介')).toBeVisible();
    // the other sections load their own data; any of it refused for lack of a session would open the dialog early
    await page.waitForLoadState('networkidle');
    await context.clearCookies();

    await page.getByLabel('简介').fill(bio);
    const save = page.locator('#profile').getByRole('button', { name: '保存', exact: true });
    await save.click();

    const dialog = page.locator('dialog.relogin');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: '重新登录' })).toBeVisible();
    await dialog.getByLabel('密码').fill(OWNER.password);
    const handle = dialog.getByLabel('用户名');
    if (!(await handle.inputValue())) await handle.fill(OWNER.handle);
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toBeHidden();

    // what was typed is still there; sending it again now works
    await expect(page.getByLabel('简介')).toHaveValue(bio);
    await save.click();
    await expect(page.locator('#profile').getByText('已保存')).toBeVisible();
    const { user } = await apiOf(page.request).get<{ user: { bio: string | null } }>('/api/auth/me');
    expect(user.bio).toBe(bio);

    expect(errors.take().filter((e) => !/status of 401/.test(e))).toEqual([]);
  });
});

/** Photo ids of the gallery's first row, left to right. */
async function firstRow(page: Page): Promise<string[]> {
  const tiles = page.locator('a.gal-tile');
  await expect(tiles).toHaveCount(3);
  const boxes = await tiles.evaluateAll((els) =>
    els.map(
      (el) =>
        ({ id: el.getAttribute('href')!.replace('/p/', ''), ...el.getBoundingClientRect().toJSON() }) as {
          id: string;
          x: number;
          y: number;
        }
    )
  );
  const top = Math.min(...boxes.map((b) => b.y));
  return boxes
    .filter((b) => Math.abs(b.y - top) < 1)
    .sort((a, b) => a.x - b.x)
    .map((b) => b.id);
}

test.describe('the gallery shows the newest photos first', () => {
  for (const [label, viewport, full] of [
    ['desktop', { width: 1440, height: 900 }, true],
    ['phone', { width: 390, height: 844 }, false]
  ] as const) {
    test(`first row on ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { photos } = await apiOf(page.request).get<{ photos: { id: string }[] }>('/api/photos');
      await page.goto('/');
      const row = await firstRow(page);
      // on a phone the row is shorter than the list, which is what makes the order matter
      if (full) expect(row).toHaveLength(photos.length);
      else expect(row.length).toBeLessThan(photos.length);
      expect(row).toEqual(photos.slice(0, row.length).map((p) => p.id));
    });
  }
});

test.describe('a link pressed the moment the page is up', () => {
  // No hover first, as on a touch screen, and before the idle prefetch has fetched the next page's chunk: the link's
  // prefetched data then arrives while the lazy page waits in Suspense. The page used to miss it and stay on its
  // skeleton (src/lib/useApi.ts). Several rounds, because the outcome depended on timing.
  test('the gallery still shows its photos', async ({ page }) => {
    for (let round = 0; round < 5; round++) {
      await page.goto('/themes', { waitUntil: 'domcontentloaded' });
      await page.locator('main').first().waitFor();
      await page.locator('header.site-header').getByRole('link', { name: '图库' }).click();
      await expect(page.locator('a.gal-tile').first(), `round ${round + 1}`).toBeVisible();
    }
  });
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const [name, path, heading] of [
    ['gallery', '/', '图库'],
    ['map', '/map', '地图'],
    ['tag manager', '/studio/tags', '标签']
  ] as const) {
    test(`${name} does not scroll sideways`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached();
      await page.waitForLoadState('networkidle');
      await noOverflow(page);
    });
  }
});
