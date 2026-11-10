// One continuous story on a fresh site: the owner registers with the owner invite, uploads and publishes the three
// sample photos, gives them a place, then opens every page. Each step checks the page's key elements and that
// nothing reached the console as an error. The session it ends with is saved for regressions.spec.ts.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER, OWNER_STATE } from './env.ts';
import { apiOf, expect, follow, rendered, test } from './support.ts';

const FIXTURES = ['1-west-lake-1.jpg', '2-west-lake-2.jpg', '3-west-lake-3.jpg'].map((f) =>
  fileURLToPath(new URL(`fixtures/${f}`, import.meta.url))
);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface ApiPhoto {
  id: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  takenAt: string | null;
}

test('owner story: register, upload, publish and visit every page', async ({ page, errors }) => {
  test.setTimeout(120_000);
  const api = apiOf(page.request);
  const clean = (where: string) => expect(errors.take(), `console errors on ${where}`).toEqual([]);
  const nav = page.getByRole('navigation', { name: '主导航' });

  await test.step('register with the owner invite', async () => {
    await page.goto('/register');
    await page.locator('#au-invite').fill(OWNER.invite);
    await page.locator('#au-handle').fill(OWNER.handle);
    await page.locator('#au-name').fill(OWNER.name);
    await page.locator('#au-password').fill(OWNER.password);
    await page.locator('form button[type=submit]').click();
    await expect(page).toHaveURL(new RegExp(`/@${OWNER.handle}$`));
    await expect(page.getByRole('heading', { level: 1, name: OWNER.name })).toBeVisible();
    clean('register');
  });

  await test.step('upload three photos and publish them', async () => {
    await follow(page.getByRole('link', { name: '上传', exact: true }));
    await expect(page).toHaveURL(/\/upload$/);
    await page.locator('input[type=file]').setInputFiles(FIXTURES);
    await expect(page.getByRole('heading', { name: /队列\s*3/ })).toBeVisible();
    // processed and matched (or matching failed): all three are ready to go
    const publishAll = page.getByRole('button', { name: '全部发布（3）' });
    await expect(publishAll).toBeEnabled({ timeout: 45_000 });
    await publishAll.click();
    await expect(page.getByLabel('状态统计')).toContainText(/已发布\s*3/, { timeout: 45_000 });
    clean('upload');
  });

  const { photos } = await api.get<{ photos: ApiPhoto[] }>('/api/photos?mine=1');
  await test.step('the EXIF made it through', async () => {
    expect(photos).toHaveLength(3);
    for (const p of photos) {
      expect(p.lat).toBeCloseTo(30.259, 2);
      expect(p.lng).toBeCloseTo(120.148, 2);
      expect(p.heading).not.toBeNull();
      expect(p.takenAt).toMatch(/^2026-05-0[23]T/);
    }
  });

  // Place matching depends on map services the Worker calls; the story does not. It makes its own place.
  const { poi } = await api.post<{ poi: { id: string } }>('/api/pois', {
    name: '断桥',
    category: '桥',
    lat: 30.25905,
    lng: 120.14806,
    city: '杭州市',
    district: '西湖区'
  });
  for (const p of photos) await api.patch(`/api/photos/${p.id}`, { poiId: poi.id, poiMethod: 'confirmed' });

  await test.step('gallery', async () => {
    await follow(nav.getByRole('link', { name: '图库' }));
    await expect(page.getByRole('heading', { level: 1, name: '图库' })).toBeAttached();
    await expect(page.locator('a.gal-tile')).toHaveCount(3);
    clean('gallery');
  });

  await test.step('photo page', async () => {
    await follow(page.locator('a.gal-tile').first());
    await expect(page).toHaveURL(/\/p\/[^/]+$/);
    await expect(page.locator('h1.pho-title')).toBeVisible();
    await expect(page.getByRole('region', { name: '拍摄位置', exact: true })).toContainText('断桥');
    clean('photo page');
  });

  await test.step('place page', async () => {
    await follow(page.getByRole('region', { name: '拍摄位置', exact: true }).getByRole('link', { name: /断桥/ }).first());
    await expect(page).toHaveURL(new RegExp(`/place/${poi.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: '断桥' })).toBeVisible();
    clean('place page');
  });

  await test.step('map', async () => {
    await follow(nav.getByRole('link', { name: '地图' }));
    await expect(page.getByRole('heading', { level: 1, name: '地图' })).toBeVisible();
    await expect(page.locator('.maplibregl-map').first()).toBeVisible();
    clean('map');
  });

  await test.step('index', async () => {
    await follow(nav.getByRole('link', { name: '索引' }));
    await expect(page.getByRole('heading', { level: 1, name: '索引' })).toBeVisible();
    await expect(page.locator('main')).toContainText('断桥');
    clean('index');
  });

  await test.step('themes: create a trip', async () => {
    await follow(nav.getByRole('link', { name: '主题' }));
    await expect(page.getByRole('heading', { level: 1, name: '主题' })).toBeVisible();
    await follow(page.getByRole('link', { name: '新建主题' }).first());
    await expect(page.getByRole('heading', { level: 1, name: '新建主题' })).toBeVisible();
    await page.getByRole('group', { name: '类型' }).getByRole('button', { name: '旅程' }).click();
    await page.getByLabel('标题', { exact: true }).fill('西湖两日');
    await page.getByRole('group', { name: '公开范围' }).getByRole('button', { name: '公开', exact: true }).click();
    await page.locator('#th-add-photo').click();
    await page.getByRole('button', { name: '全选' }).click();
    await page.getByRole('button', { name: '添加 3 张' }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    // a new theme stays in the editor, now under its own address
    await expect(page).toHaveURL(/\/t\/[^/]+\/edit$/);
    await expect(page.getByRole('heading', { level: 1, name: '编辑主题' })).toBeVisible();
    clean('theme editor');
  });

  await test.step('trip reader', async () => {
    await follow(page.getByRole('link', { name: '返回' }));
    await expect(page).toHaveURL(/\/t\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: '西湖两日' })).toBeVisible();
    await expect(page.getByRole('region', { name: '路线图' })).toBeVisible();
    await follow(nav.getByRole('link', { name: '主题' }));
    await expect(page.getByRole('link', { name: /西湖两日/ }).first()).toBeVisible();
    clean('trip reader');
  });

  await test.step('Living', async () => {
    await page.goto('/living');
    await expect(page.getByLabel('Living 全屏轮播')).toBeVisible();
    await rendered(page);
    clean('Living');
  });

  await test.step('settings', async () => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: '设置' })).toBeVisible();
    await expect(page.getByLabel('简介')).toBeVisible();
    clean('settings');
  });

  await test.step('tag manager', async () => {
    await page.locator('summary[aria-label$="的菜单"]').click();
    await follow(page.getByRole('link', { name: '标签' }));
    await expect(page.getByRole('heading', { level: 1, name: '标签' })).toBeVisible();
    clean('tag manager');
  });

  await test.step('edit a photo', async () => {
    await page.goto(`/studio/photo/${photos[0].id}`);
    await expect(page.getByRole('heading', { level: 1, name: '编辑照片' })).toBeVisible();
    await page.getByLabel('标题', { exact: true }).fill('断桥的早晨');
    await page.getByRole('button', { name: '保存修改' }).click();
    await expect(page.getByText('已保存')).toBeVisible();
    await page.goto(`/p/${photos[0].id}`);
    await expect(page.locator('h1.pho-title')).toHaveText('断桥的早晨');
    clean('photo editor');
  });

  mkdirSync(dirname(`${ROOT}${OWNER_STATE}`), { recursive: true });
  await page.context().storageState({ path: `${ROOT}${OWNER_STATE}` });
});
