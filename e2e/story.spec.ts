// One continuous story on a fresh site: the owner registers with the owner invite, uploads and publishes the three
// sample photos, gives them a place, keeps a few entries, then opens every page. Each step checks the page's key
// elements and that nothing reached the console as an error. The session it ends with is saved for
// regressions.spec.ts.
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
    // a new account starts on its own day
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole('heading', { level: 1, name: '今天' })).toBeVisible();
    clean('register');
  });

  await test.step('upload three photos and publish them', async () => {
    await follow(page.getByRole('link', { name: '上传', exact: true }));
    await expect(page).toHaveURL(/\/upload$/);
    await page.locator('.up-drop input[type=file]').setInputFiles(FIXTURES);
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

  // signed in, the photos, the map and the index are one section with tabs of its own
  const library = page.getByRole('navigation', { name: '图库' });
  await test.step('map', async () => {
    await follow(nav.getByRole('link', { name: '图库' }));
    await follow(library.getByRole('link', { name: '地图' }));
    await expect(page.getByRole('heading', { level: 1, name: '地图' })).toBeVisible();
    await expect(page.locator('.maplibregl-map').first()).toBeVisible();
    clean('map');
  });

  await test.step('index', async () => {
    await follow(library.getByRole('link', { name: '索引' }));
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

  await test.step('today: a quick note', async () => {
    await follow(nav.getByRole('link', { name: '今天' }));
    await expect(page.getByRole('heading', { level: 1, name: '今天' })).toBeVisible();
    await page.getByLabel('记一笔').fill('湖边的风很大，*柳树*都在往东倒。');
    await page.getByRole('button', { name: '记下', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '记下了' })).toBeVisible();
    await expect(page.getByLabel('记一笔')).toHaveValue('');
    const card = page.locator('a.en-card').filter({ hasText: '湖边的风很大' });
    await expect(card).toBeVisible();
    // Markdown, rendered, and private by default
    await expect(card.locator('em')).toHaveText('柳树');
    await expect(card).toContainText('仅自己可见');
    clean('today');
  });

  let entryId = '';
  await test.step('entry: write, add photos, finish', async () => {
    await page.getByLabel('记一笔').fill('断桥残雪，其实是断桥残阳。');
    await page.getByRole('button', { name: '写长文' }).click();
    await expect(page).toHaveURL(/\/entries\/new$/);
    // the quick note came along
    await expect(page.getByLabel('正文', { exact: true })).toHaveValue('断桥残雪，其实是断桥残阳。');
    await page.getByLabel('标题', { exact: true }).fill('西湖边的一个下午');
    // the first save makes it a draft under its own address, without leaving the editor
    await expect(page).toHaveURL(/\/e\/en_[^/]+\/edit$/, { timeout: 15_000 });
    entryId = page.url().split('/e/')[1].split('/')[0];
    await page.getByLabel('正文', { exact: true }).fill('# 午后\n\n断桥残雪，其实是断桥残阳。\n\n- [x] 看荷花\n- [ ] 坐船');
    await page.getByLabel('日期', { exact: true }).fill('2026-05-02');
    // the picker starts at the entry's day: the two photos of that afternoon, not the next day's
    await page.getByRole('button', { name: '添加', exact: true }).click();
    await page.getByRole('button', { name: '全选' }).click();
    await page.getByRole('button', { name: '添加 2 张' }).click();
    await page.getByLabel('第 1 张照片的说明').fill('桥上的人');
    await page.getByRole('group', { name: '公开范围' }).getByRole('button', { name: '公开', exact: true }).click();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/e/${entryId}$`));
    await expect(page.getByRole('heading', { level: 1, name: '西湖边的一个下午' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: '午后' })).toBeVisible();
    await expect(page.locator('.er-figure')).toHaveCount(2);
    await expect(page.locator('figcaption').first()).toHaveText('桥上的人');
    clean('entry editor and reader');
  });

  await test.step('archive: entries and photos on one timeline', async () => {
    await follow(nav.getByRole('link', { name: '档案' }));
    await expect(page.getByRole('heading', { level: 1, name: '档案' })).toBeVisible();
    const day = page.getByRole('region', { name: /5月2日/ });
    await expect(day.locator('a.en-card').filter({ hasText: '西湖边的一个下午' })).toBeVisible();
    // the entry's photos are not shown again beside it; the next day's photo has a day of its own
    await expect(day.locator('.en-run')).toHaveCount(0);
    await expect(page.getByRole('region', { name: /5月3日/ }).locator('.en-run a')).toHaveCount(1);
    await expect(page.locator('a.en-card').filter({ hasText: '湖边的风很大' })).toBeVisible();
    await page.getByRole('group', { name: '类型' }).getByRole('button', { name: '照片' }).click();
    await expect(page).toHaveURL(/type=photos/);
    await expect(page.locator('a.en-card')).toHaveCount(0);
    await expect(page.locator('.en-run a')).toHaveCount(3);
    clean('archive');
  });

  await test.step('a photo lists its entries, a profile its public ones', async () => {
    const inEntry = photos.find((p) => p.takenAt?.startsWith('2026-05-02'));
    await page.goto(`/p/${inEntry?.id}`);
    await follow(page.getByRole('list', { name: '所属记录' }).getByRole('link', { name: /西湖边的一个下午/ }));
    await expect(page).toHaveURL(new RegExp(`/e/${entryId}$`));
    await page.goto(`/@${OWNER.handle}`);
    const entries = page.getByRole('region', { name: '记录' });
    await expect(entries.locator('a.en-card')).toHaveCount(2);
    clean('photo page and profile with entries');
  });

  await test.step('projects: start one, keep each practice in it, mark a milestone', async () => {
    await follow(nav.getByRole('link', { name: '档案' }));
    await follow(page.getByRole('navigation', { name: '档案' }).getByRole('link', { name: '项目' }));
    await expect(page.getByRole('heading', { level: 1, name: '项目' })).toBeVisible();
    await follow(page.getByRole('link', { name: '新建项目' }).first());
    await page.getByLabel('项目名称').fill('从零开始学书法');
    await page.getByLabel('开始').fill('2026-05-01');
    await page.getByRole('group', { name: '公开范围' }).getByRole('button', { name: '公开', exact: true }).click();
    await page.getByRole('button', { name: '创建' }).click();
    await expect(page).toHaveURL(/\/projects\/pj_[^/]+$/);
    const projectUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1, name: '从零开始学书法' })).toBeVisible();

    // each practice is an entry written from the project: in it from the start, and a practice; shared by link only,
    // so the profile does not list them while the public project shows them
    for (const [day, title, count] of [
      ['2026-05-02', '第一次临帖', 2],
      ['2026-05-03', '横画练了一页', 1]
    ] as const) {
      await follow(page.getByRole('link', { name: '记一笔' }));
      await expect(page).toHaveURL(/\/entries\/new\?project=pj_/);
      await expect(page.getByRole('group', { name: '项目' }).getByRole('button', { name: '从零开始学书法' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      await expect(page.getByLabel('类型')).toHaveValue('practice');
      await page.getByLabel('标题', { exact: true }).fill(title);
      await expect(page).toHaveURL(/\/e\/en_[^/]+\/edit$/, { timeout: 15_000 });
      await page.getByLabel('日期', { exact: true }).fill(day);
      await page.getByRole('button', { name: '添加', exact: true }).click();
      await page.getByRole('button', { name: '全选' }).click();
      await page.getByRole('button', { name: `添加 ${count} 张` }).click();
      await page.getByRole('group', { name: '公开范围' }).getByRole('button', { name: '仅链接', exact: true }).click();
      await page.getByRole('button', { name: '完成', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      // the entry leads back to its project
      await follow(page.getByRole('link', { name: '从零开始学书法' }));
      await expect(page).toHaveURL(new RegExp(`${projectUrl}$`));
    }

    await page.getByRole('button', { name: '里程碑', exact: true }).click();
    await page.getByLabel('里程碑名称').fill('临完第一页');
    await page.getByLabel('日期').fill('2026-05-02');
    await page.getByLabel('阶段总结').fill('笔画还在**抖**。');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    const stages = page.getByRole('region', { name: '阶段' });
    await expect(stages.getByRole('heading', { level: 3, name: '临完第一页' })).toBeVisible();
    await expect(stages.locator('strong')).toHaveText('抖');
    // the stage going on holds the later practice and its photo
    await expect(stages.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: '现在' }) })).toContainText(
      '1 条记录'
    );
    await expect(page.getByRole('region', { name: '最初与最近' }).getByRole('figure')).toHaveCount(2);
    await expect(page.getByText('2 条记录 · 2 天 · 3 张照片')).toBeVisible();
    await expect(page.getByRole('region', { name: '记录' }).locator('a.en-card')).toHaveCount(2);

    // Today offers the next practice
    await follow(nav.getByRole('link', { name: '今天' }));
    await expect(page.getByRole('region', { name: '进行中' }).getByRole('link', { name: /记一笔\s*：从零开始学书法/ })).toBeVisible();
    clean('projects');
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
