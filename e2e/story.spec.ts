// One continuous story on a fresh site: the owner registers with the owner invite, uploads and publishes the three
// sample photos, gives them a place, keeps a few entries, shares one with a guest, then opens every page. Each step
// checks the page's key elements and that nothing reached the console as an error. The session it ends with is saved
// for regressions.spec.ts.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNER, OWNER_STATE } from './env.ts';
import { apiOf, cutOff, expect, follow, rendered, test, watch } from './support.ts';

const FIXTURES = ['1-west-lake-1.jpg', '2-west-lake-2.jpg', '3-west-lake-3.jpg'].map((f) =>
  fileURLToPath(new URL(`fixtures/${f}`, import.meta.url))
);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** The files of a ZIP of stored entries (what the export writes), by name, in the archive's order. */
function zipFiles(zip: Buffer): Map<string, Buffer> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const out = new Map<string, Buffer>();
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50);
    expect(zip.readUInt16LE(at + 10)).toBe(0);
    const size = zip.readUInt32LE(at + 24);
    const nameLen = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    out.set(name, zip.subarray(start, start + size));
    at += 46 + nameLen;
  }
  return out;
}

interface ApiPhoto {
  id: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  takenAt: string | null;
}

test('owner story: register, upload, publish and visit every page', async ({ page, errors, browser }) => {
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

  await test.step('a new account keeps new photos to itself until told otherwise', async () => {
    await follow(page.getByRole('link', { name: '上传', exact: true }));
    await expect(page.getByText('新照片默认仅自己可见')).toBeVisible();
    await follow(page.getByRole('link', { name: '更改', exact: true }));
    await expect(page).toHaveURL(/\/settings#photos$/);
    const section = page.getByRole('region', { name: '新照片' });
    await expect(section).toBeInViewport();
    const choice = section.getByRole('group', { name: '默认公开范围' });
    await expect(choice.getByRole('button', { name: '仅自己' })).toHaveAttribute('aria-pressed', 'true');
    // the story shares its photos with visitors
    await choice.getByRole('button', { name: '公开', exact: true }).click();
    await expect(section.getByRole('status')).toHaveText('已保存');
    await expect(choice.getByRole('button', { name: '公开', exact: true })).toHaveAttribute('aria-pressed', 'true');
    clean('new photo default');
  });

  await test.step('upload three photos and publish them', async () => {
    await follow(page.getByRole('link', { name: '上传', exact: true }));
    await expect(page).toHaveURL(/\/upload$/);
    await expect(page.getByText('新照片默认公开')).toBeVisible();
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

  let tripPath = '';
  await test.step('collections: create a trip', async () => {
    await follow(nav.getByRole('link', { name: '合集' }));
    await expect(page.getByRole('heading', { level: 1, name: '合集' })).toBeVisible();
    await follow(page.getByRole('link', { name: '新建合集' }).first());
    await expect(page.getByRole('heading', { level: 1, name: '新建合集' })).toBeVisible();
    await page.getByRole('group', { name: '类型' }).getByRole('button', { name: '旅程' }).click();
    await page.getByLabel('标题', { exact: true }).fill('西湖两日');
    await page.getByRole('group', { name: '公开范围' }).getByRole('button', { name: '公开', exact: true }).click();
    await page.locator('#th-add-photo').click();
    await page.getByRole('button', { name: '全选' }).click();
    await page.getByRole('button', { name: '添加 3 张' }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    // a new collection stays in the editor, now under its own address
    await expect(page).toHaveURL(/\/t\/[^/]+\/edit$/);
    tripPath = new URL(page.url()).pathname.replace(/\/edit$/, '');
    await expect(page.getByRole('heading', { level: 1, name: '编辑合集' })).toBeVisible();
    clean('collection editor');
  });

  await test.step('trip reader', async () => {
    await follow(page.getByRole('link', { name: '返回' }));
    await expect(page).toHaveURL(/\/t\/[^/]+$/);
    await expect(page.getByRole('heading', { level: 1, name: '西湖两日' })).toBeVisible();
    await expect(page.getByRole('region', { name: '路线图' })).toBeVisible();
    await follow(nav.getByRole('link', { name: '合集' }));
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

  await test.step('collections hold entries: the trip takes in the afternoon and the quick note', async () => {
    await page.goto(`${tripPath}/edit`);
    await expect(page.getByRole('heading', { level: 1, name: '编辑合集' })).toBeVisible();
    await page.getByRole('button', { name: '添加记录', exact: true }).click();
    const picker = page.getByRole('dialog', { name: '添加记录' });
    await picker.getByRole('button', { name: /^西湖边的一个下午/ }).click();
    await picker.getByRole('button', { name: /^湖边的风很大/ }).click();
    await picker.getByRole('button', { name: '添加 2 条' }).click();
    await expect(picker).toBeHidden();
    // the trip is public and the quick note is not: the editor says so before it is saved
    await expect(page.getByRole('note')).toHaveText('有 1 条记录读者看不到。');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
    await follow(page.getByRole('link', { name: '返回' }));
    await expect(page.getByRole('heading', { level: 1, name: '西湖两日' })).toBeVisible();
    await expect(page.locator('.rd-by')).toContainText('2 条记录');
    const afternoon = page.getByRole('region', { name: '西湖边的一个下午' });
    await expect(afternoon.locator('.rd-entry-photos li')).toHaveCount(2);
    await follow(afternoon.getByRole('link', { name: '西湖边的一个下午' }));
    await expect(page).toHaveURL(new RegExp(`/e/${entryId}$`));
    // and the entry names the collections it is in
    await follow(page.getByRole('list', { name: '所属合集' }).getByRole('link', { name: '西湖两日' }));
    await expect(page).toHaveURL(new RegExp(`${tripPath}$`));
    clean('collections with entries');
  });

  await test.step('an entry takes its place from its photos, and the place lists it', async () => {
    await page.goto(`/e/${entryId}/edit`);
    const place = page.getByRole('region', { name: '地点', exact: true });
    await place.getByRole('group', { name: '照片里的地点' }).getByRole('button', { name: '断桥' }).click();
    await expect(place.getByRole('button', { name: '去掉地点「断桥」' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible({ timeout: 15_000 });
    await follow(page.getByRole('link', { name: '查看', exact: true }));
    await expect(page).toHaveURL(new RegExp(`/e/${entryId}$`));
    await follow(page.locator('.er-meta').getByRole('link', { name: '断桥' }));
    await expect(page).toHaveURL(new RegExp(`/place/${poi.id}$`));
    await expect(page.getByRole('region', { name: '记录', exact: true }).locator('a.en-card')).toContainText(['西湖边的一个下午']);
    clean('entry place');
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
    // two days running: its rhythm
    await expect(page.getByRole('region', { name: '节奏' })).toContainText('最长连续 2 天');

    // Today offers the next practice
    await follow(nav.getByRole('link', { name: '今天' }));
    await expect(page.getByRole('region', { name: '进行中' }).getByRole('link', { name: /记一笔\s*：从零开始学书法/ })).toBeVisible();
    clean('projects');
  });

  await test.step('calendar: this month opens on today, another on its latest day; the arrows walk the days', async () => {
    await follow(nav.getByRole('link', { name: '档案' }));
    await follow(page.getByRole('navigation', { name: '档案' }).getByRole('link', { name: '日历' }));
    await expect(page.getByRole('heading', { level: 1, name: '日历' })).toBeVisible();
    await expect(page.getByRole('region', { name: /今天/ }).locator('a.en-card').filter({ hasText: '湖边的风很大' })).toBeVisible();

    await page.goto('/archive/calendar?month=2026-05');
    const grid = page.getByRole('group', { name: '2026年5月' });
    const cell = (d: number) => grid.getByRole('button', { name: new RegExp(`^5月${d}日 `) });
    await expect(cell(3)).toHaveAttribute('aria-pressed', 'true');
    await expect(cell(3)).toHaveAccessibleName(/1 条记录 · 1 张照片/);
    await expect(page.getByRole('region', { name: /^5月3日 / })).toContainText('横画练了一页');
    await cell(2).click();
    await expect(page).toHaveURL(/month=2026-05&day=2026-05-02$/);
    const day = page.getByRole('region', { name: /^5月2日 / });
    await expect(day.locator('a.en-card').filter({ hasText: '第一次临帖' })).toBeVisible();
    await expect(day.locator('a.en-card').filter({ hasText: '西湖边的一个下午' })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(cell(3)).toBeFocused();
    await expect(page).toHaveURL(/day=2026-05-03$/);
    await page.keyboard.press('ArrowDown');
    await expect(cell(10)).toBeFocused();
    // an empty day is filled in afterwards, on that day and for the whole of it
    await expect(page.getByText('这一天没有内容')).toBeVisible();
    await follow(page.getByRole('link', { name: '补记' }));
    await expect(page).toHaveURL(/\/entries\/new\?date=2026-05-10$/);
    await expect(page.getByLabel('日期', { exact: true })).toHaveValue('2026-05-10');
    await expect(page.getByLabel('时间', { exact: true })).toHaveValue('');
    clean('calendar');
  });

  await test.step('the year in review: its days month by month, its projects and places', async () => {
    await page.goto('/archive/calendar?month=2026-05');
    await follow(page.getByRole('link', { name: '2026年' }));
    await expect(page).toHaveURL(/\/archive\/2026$/);
    await expect(page.getByRole('heading', { level: 1, name: '2026' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '档案' }).getByRole('link', { name: '日历' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    const may = page.getByRole('region', { name: '5月', exact: true });
    await expect(may.getByRole('heading', { level: 3 })).toContainText('3 条 · 3 张');
    const project = page.getByRole('region', { name: '项目' }).getByRole('listitem').filter({ hasText: '从零开始学书法' });
    await expect(project).toContainText('2 条记录 · 2 天');
    await expect(project).toContainText('临完第一页');
    await expect(page.getByRole('region', { name: '地点' }).getByRole('link', { name: '断桥' })).toBeVisible();
    // a day of it opens on the calendar
    await follow(may.getByRole('link', { name: '5月2日：2 条记录 · 2 张照片' }));
    await expect(page).toHaveURL(/\/archive\/calendar\?month=2026-05&day=2026-05-02$/);
    await expect(page.getByRole('region', { name: /^5月2日 / }).locator('a.en-card')).toHaveCount(2);
    clean('year in review');
  });

  await test.step('share links: a private entry opens for a guest, its private photo too, until the link is deleted', async () => {
    // the quick note is private; it gets a photo nobody else may see
    const { entries } = await api.get<{ entries: { id: string; excerpt: string | null }[] }>('/api/entries?mine=1');
    const note = entries.find((e) => e.excerpt?.startsWith('湖边的风很大'));
    const hidden = photos.find((p) => p.takenAt?.startsWith('2026-05-03'));
    expect(note && hidden).toBeTruthy();
    await api.patch(`/api/photos/${hidden?.id}`, { visibility: 'private' });
    await api.patch(`/api/entries/${note?.id}`, { media: [{ photoId: hidden?.id, caption: null }] });

    await page.goto(`/e/${note?.id}`);
    await page.getByRole('button', { name: '分享', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '分享链接' });
    await expect(dialog).toContainText('包括仅自己可见的');
    await dialog.getByLabel('有效期').selectOption({ label: '30 天内有效' });
    await dialog.getByRole('button', { name: '新建链接' }).click();
    const address = dialog.getByRole('textbox', { name: /^链接/ });
    await expect(address).toHaveValue(/\/s\/[A-Za-z0-9_-]{24}$/);
    await expect(dialog).toContainText('前有效');
    const link = new URL(await address.inputValue()).pathname;
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    const context = await browser.newContext({ storageState: undefined });
    await cutOff(context);
    const guest = await context.newPage();
    const guestErrors = watch(guest);
    // without the link the entry is not there, as for anyone
    await guest.goto(`/e/${note?.id}`);
    await expect(guest.getByText('记录不存在，或你没有权限查看')).toBeVisible();
    guestErrors.take();
    await guest.goto(link);
    await expect(guest).toHaveURL(new RegExp(`/e/${note?.id}$`));
    await expect(guest.locator('.er-body')).toContainText('湖边的风很大');
    await expect(guest.locator('.er-figure')).toHaveCount(1);
    await expect
      .poll(() => guest.locator('.er-photo img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    await follow(guest.locator('.er-photo').first());
    await expect(guest).toHaveURL(new RegExp(`/p/${hidden?.id}$`));
    await expect(guest.locator('h1.pho-title')).toBeVisible();
    expect(guestErrors.take(), 'console errors of the guest').toEqual([]);

    // deleting the link takes it all back at once
    await page.goto('/settings#shares');
    const shares = page.getByRole('region', { name: '分享链接' });
    await expect(shares.getByRole('link', { name: /湖边的风很大/ })).toBeVisible();
    await shares.getByRole('button', { name: '删除', exact: true }).click();
    await shares.getByRole('button', { name: '确认删除' }).click();
    await expect(shares.getByText('还没有分享链接。')).toBeVisible();
    await guest.goto(`/e/${note?.id}`);
    await expect(guest.getByText('记录不存在，或你没有权限查看')).toBeVisible();
    await guest.goto(link);
    await expect(guest.getByText('链接不存在或已失效')).toBeVisible();
    await context.close();

    await api.patch(`/api/photos/${hidden?.id}`, { visibility: 'public' });
    clean('share links');
  });

  await test.step('search: the owner finds her own words from any page with /', async () => {
    await page.goto('/today');
    // the text handed to the editor earlier with 写长文 is not left in the box
    await expect(page.getByLabel('记一笔')).toHaveValue('');
    // the key works once the page knows who is signed in, as the header's search button shows
    await expect(page.getByRole('link', { name: '搜索', exact: true })).toBeVisible();
    await page.keyboard.press('/');
    await expect(page).toHaveURL(/\/search$/);
    const box = page.getByRole('searchbox', { name: '搜索' });
    await expect(box).toBeFocused();
    await box.fill('断桥');
    await expect(page).toHaveURL(/\/search\?q=%E6%96%AD%E6%A1%A5$/);
    const entries = page.getByRole('region', { name: /^记录/ });
    const afternoon = entries.getByRole('link', { name: /西湖边的一个下午/ });
    await expect(afternoon).toBeVisible();
    await expect(afternoon.locator('mark').first()).toHaveText('断桥');
    // a milestone's summary, as plain text
    await box.fill('抖');
    const projects = page.getByRole('region', { name: /^项目/ });
    await expect(projects.getByRole('link', { name: /从零开始学书法/ })).toContainText('笔画还在抖');
    await expect(entries).toBeHidden();
    await box.fill('没有这几个字');
    await expect(page.getByText('没有找到「没有这几个字」')).toBeVisible();
    clean('search');
  });

  await test.step('export: a zip with the Markdown, living.json and the originals as uploaded', async () => {
    await page.goto('/settings#export');
    const section = page.getByRole('region', { name: '导出' });
    await expect(section).toContainText('4 条记录 · 3 张照片 · 1 个项目 · 1 个合集');
    const [download] = await Promise.all([page.waitForEvent('download'), section.getByRole('button', { name: '下载 zip' }).click()]);
    await expect(section.getByRole('status')).toContainText('导出完成');
    expect(download.suggestedFilename()).toMatch(new RegExp(`^living-${OWNER.handle}-\\d{4}-\\d{2}-\\d{2}\\.zip$`));
    const files = zipFiles(readFileSync(await download.path()));
    const root = `living-${OWNER.handle}/`;
    const names = [...files.keys()];
    expect(names.every((n) => n.startsWith(root))).toBe(true);
    expect(names.filter((n) => n.startsWith(`${root}entries/2026/`))).toHaveLength(4);
    expect(names).toContain(`${root}projects/从零开始学书法.md`);
    expect(names).toContain(`${root}collections/西湖两日.md`);
    // living.json comes last, with everything
    expect(names.at(-1)).toBe(`${root}living.json`);
    const json = JSON.parse((files.get(`${root}living.json`) as Buffer).toString('utf8'));
    expect(json).toMatchObject({ format: 'living-export', version: 1, profile: { handle: OWNER.handle } });
    expect(json.photos).toHaveLength(3);
    // each original is the very file that was uploaded
    const uploaded = new Set(FIXTURES.map((f) => sha256(readFileSync(f))));
    for (const p of json.photos as { file: string; sha256: string }[]) {
      const bytes = files.get(`${root}${p.file}`) as Buffer;
      expect(sha256(bytes)).toBe(p.sha256);
      expect(uploaded.has(p.sha256)).toBe(true);
    }
    const afternoon = (files.get(names.find((n) => n.endsWith('西湖边的一个下午.md')) as string) as Buffer).toString('utf8');
    expect(afternoon).toContain('title: "西湖边的一个下午"');
    expect(afternoon).toMatch(/!\[桥上的人\]\(<\.\.\/\.\.\/media\/2026\/2026-\d{2}-\d{2}_ph_[0-9A-Z]+\.jpg>\)/);
    clean('export to a zip');
  });

  await test.step('export into a folder: the second time downloads nothing again', async () => {
    // the folder picker cannot be clicked through: the page gets a folder of its own origin's file system instead
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showDirectoryPicker', {
        value: async () => (await navigator.storage.getDirectory()).getDirectoryHandle('picked', { create: true })
      });
    });
    // already at /settings#export: a reload, so that the new page runs the script
    await page.reload();
    const section = page.getByRole('region', { name: '导出' });
    await section.getByRole('button', { name: '导出到文件夹' }).click();
    await expect(section.getByRole('status')).toContainText(`已导出到「living-${OWNER.handle}」`);
    const listed = await page.evaluate(async (name) => {
      const out: Record<string, number> = {};
      const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
        for await (const h of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
          if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, `${prefix}${h.name}/`);
          else out[`${prefix}${h.name}`] = (await (h as FileSystemFileHandle).getFile()).size;
        }
      };
      const picked = await (await navigator.storage.getDirectory()).getDirectoryHandle('picked');
      await walk(await picked.getDirectoryHandle(name), '');
      return out;
    }, `living-${OWNER.handle}`);
    const paths = Object.keys(listed);
    expect(paths).toEqual(expect.arrayContaining(['README.md', 'living.json', 'projects/从零开始学书法.md', 'collections/西湖两日.md']));
    expect(paths.filter((p) => /^media\/2026\/2026-\d{2}-\d{2}_ph_[0-9A-Z]+\.jpg$/.test(p))).toHaveLength(3);

    await section.getByRole('button', { name: '导出到文件夹' }).click();
    await expect(section.getByRole('status')).toContainText('3 张照片上次已经导出，这次没有再下载。');
    clean('export to a folder');
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
