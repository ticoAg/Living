// The library, the gallery's entry layer and Living over entries, on the story's session and data, after the
// attachments spec (whose entry, made public, holds a video, a PDF and a recording). In order, each test on the one
// before: the library writes an entry of its own.
import { fileURLToPath } from 'node:url';
import type { APIRequestContext } from '@playwright/test';
import type {
  AttachmentPart,
  AttachmentResponse,
  AttachmentUpload,
  EntryDetail,
  EntryListResponse,
  LibraryResponse,
  OwnAttachment,
  PhotoListResponse
} from '../shared/types.ts';
import { BASE_URL, OWNER_STATE } from './env.ts';
import { apiOf, expect, follow, noOverflow, test } from './support.ts';

test.use({ storageState: fileURLToPath(new URL(`../${OWNER_STATE}`, import.meta.url)) });
test.describe.configure({ mode: 'serial' });

/** A text file uploaded whole and put in no entry. */
async function looseFile(request: APIRequestContext, name: string, text: string): Promise<OwnAttachment> {
  const headers = { origin: BASE_URL };
  const bytes = Buffer.from(text);
  const ok = async <T>(res: Awaited<ReturnType<APIRequestContext['post']>>): Promise<T> => {
    expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBe(true);
    return (await res.json()) as T;
  };
  const begun = await ok<AttachmentUpload>(
    await request.post('/api/attachments', { data: { kind: 'file', name, mime: 'text/plain', size: bytes.length }, headers })
  );
  const id = begun.attachment.id;
  const part = await ok<AttachmentPart>(
    await request.put(`/api/attachments/${id}/parts/1`, {
      data: bytes,
      headers: { ...headers, 'content-type': 'application/octet-stream' }
    })
  );
  return (await ok<AttachmentResponse>(await request.post(`/api/attachments/${id}/complete`, { data: { parts: [part] }, headers })))
    .attachment;
}

test('the library: what one keeps, what is in no entry, and a new entry from what is picked', async ({ page }) => {
  const api = apiOf(page.request);
  const list = await looseFile(page.request, '清单.txt', '买菜\n洗衣服\n');
  const memo = await looseFile(page.request, '备忘.txt', '电话\n');
  const lib = await api.get<LibraryResponse>('/api/library');
  const mine = (await api.get<PhotoListResponse>('/api/photos?mine=1')).photos;
  const inEntries = new Set(lib.entryPhotoIds);

  await page.goto('/');
  await follow(page.getByRole('navigation', { name: '图库' }).getByRole('link', { name: '媒体库' }));
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.getByRole('heading', { level: 1, name: '媒体库' })).toBeVisible();
  const kinds = page.getByRole('group', { name: '类型' });
  const photosTab = kinds.getByRole('button', { name: /^照片/ });
  await expect(photosTab).toHaveAttribute('aria-pressed', 'true');
  await expect(photosTab.locator('.lib-kind-n')).toHaveText(String(lib.usage.photos.count));
  await expect(kinds.getByRole('button', { name: /^视频/ }).locator('.lib-kind-n')).toHaveText(String(lib.usage.video.count));
  const cells = page.locator('.lib-grid > li');
  await expect(cells).toHaveCount(mine.length);

  // the photos no entry holds
  const shows = page.getByRole('group', { name: '筛选' });
  await shows.getByRole('button', { name: /^不在记录里/ }).click();
  await expect(page).toHaveURL(/\/library\?show=loose$/);
  await expect(cells).toHaveCount(mine.filter((p) => !inEntries.has(p.id)).length);
  await noOverflow(page);

  // the files: the PDF in its entry, to open there; the loose ones, with when they go
  await kinds.getByRole('button', { name: /^文件/ }).click();
  await expect(page).toHaveURL(/\/library\?kind=file$/);
  const pdf = page.locator('.lib-file').filter({ hasText: '路线.pdf' });
  await expect(pdf.getByRole('link', { name: '湖边的声音' })).toHaveAttribute('href', /^\/e\/en_/);
  await expect(pdf.getByRole('button', { name: /^删除/ })).toHaveCount(0);
  const row = page.locator('.lib-file').filter({ hasText: '清单.txt' });
  await expect(row).toContainText('不在记录里 · 7 天后删去');
  await expect(row.getByRole('link', { name: '下载 清单.txt' })).toHaveAttribute('href', `/media/a/${list.id}?download`);
  // deleted on a second word
  await row.getByRole('button', { name: '删除 清单.txt' }).click();
  await row.getByRole('button', { name: '确认删除' }).click();
  await expect(row).toHaveCount(0);
  expect((await api.get<LibraryResponse>('/api/library')).attachments.map((a) => a.id)).not.toContain(list.id);
  await noOverflow(page);

  // picked across the tabs: a loose file and two photos make a new entry, on the day of the earlier photo
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.getByRole('button', { name: '选择 备忘.txt' }).click();
  // a file in an entry cannot be picked
  await expect(pdf.getByRole('button', { name: '选择 路线.pdf' })).toHaveCount(0);
  await kinds.getByRole('button', { name: /^照片/ }).click();
  const picks = page.locator('.lib-grid button.lib-cell');
  await picks.nth(0).click();
  await picks.nth(1).click();
  await expect(picks.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.lib-bar')).toContainText('已选 3');
  // the grid's first two: the newest captures, the undated last (a stable sort, as the page's)
  const shown = [...mine].sort((a, b) => (b.takenAt ?? '').localeCompare(a.takenAt ?? '')).slice(0, 2);
  const day = shown
    .map((p) => p.takenAt)
    .filter((t): t is string => !!t)
    .sort()[0]
    ?.slice(0, 10);
  await page.getByRole('button', { name: '写一条记录' }).click();
  await expect(page).toHaveURL(day ? `/entries/new?date=${day}` : '/entries/new');
  await expect(page.getByLabel('第 2 张照片的说明')).toBeVisible();
  await expect(page.getByLabel('第 3 张照片的说明')).toHaveCount(0);
  await expect(page.getByLabel('备忘.txt 的说明')).toBeVisible();
  if (day) await expect(page.getByLabel('日期', { exact: true })).toHaveValue(day);
  await page.getByLabel('标题', { exact: true }).fill('从媒体库来的');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page).toHaveURL(/\/e\/en_[\w-]+$/);
  const made = await api.get<EntryDetail>(`/api/entries/${page.url().split('/e/')[1]}`);
  expect(made.media.map((m) => m.photoId).sort()).toEqual(shown.map((p) => p.id).sort());
  expect(made.attachments.map((a) => a.id)).toEqual([memo.id]);
  expect(made.visibility).toBe('private');

  // the file is in the entry now, and says so
  await page.goto('/library?kind=file');
  await expect(page.locator('.lib-file').filter({ hasText: '备忘.txt' }).getByRole('link', { name: '从媒体库来的' })).toBeVisible();
});

test('the gallery’s entry layer: everyone’s public entries, a type, and Living over their photos', async ({ page }) => {
  const api = apiOf(page.request);
  const { entries } = await api.get<EntryListResponse>('/api/entries');
  expect(entries.length).toBeGreaterThan(1);

  await page.goto('/');
  await page.getByRole('group', { name: '图层' }).getByRole('button', { name: '记录' }).click();
  await expect(page).toHaveURL(/\/\?layer=entries$/);
  const tiles = page.locator('.sc-works a.sc-work');
  await expect(tiles).toHaveCount(entries.length);
  await expect(tiles.first()).toHaveAttribute('href', `/e/${entries[0].id}`);
  // the entry of files alone shows its video's frame
  const files = entries.find((e) => e.title === '湖边的声音');
  await expect(page.locator(`a.sc-work[href="/e/${files?.id}"] img`)).toHaveAttribute('src', /\/media\/a\/at_[\w-]+\/poster$/);
  await noOverflow(page);

  // one type
  const types = page.getByRole('group', { name: '类型' });
  await types.getByRole('button', { name: '创作' }).click();
  await expect(page).toHaveURL(/\/\?layer=entries&type=creation$/);
  await expect(tiles).toHaveCount(entries.filter((e) => e.type === 'creation').length);
  await expect(page.getByRole('link', { name: /^Living，/ })).toHaveAttribute('href', '/living?src=entries&type=creation');
  await types.getByRole('button', { name: '创作' }).click();
  await expect(page).toHaveURL(/\/\?layer=entries$/);

  await follow(page.getByRole('link', { name: /^Living，/ }));
  await expect(page).toHaveURL(/\/living\?src=entries$/);
  await expect(page.locator('.lv-summary')).toHaveText(/^记录 · 随机 · \d+ 张$/);
  await expect(page.locator('.lv-cap-entry')).not.toBeEmpty();

  // back on the photos, the entry filter goes
  await page.goto('/?layer=entries&type=creation');
  await page.getByRole('group', { name: '图层' }).getByRole('button', { name: '照片' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.gal-masonry')).toBeVisible();
});

test('an entry plays its photos in Living, in its order, under its name', async ({ page }) => {
  const api = apiOf(page.request);
  const listed = (await api.get<EntryListResponse>('/api/entries?mine=1')).entries.find((e) => e.title === '西湖边的一个下午');
  const entry = await api.get<EntryDetail>(`/api/entries/${listed?.id}`);
  expect(entry.media).toHaveLength(2);

  await page.goto(`/e/${entry.id}`);
  await follow(page.getByRole('link', { name: 'Living，播放这条记录的 2 张照片' }));
  await expect(page).toHaveURL(`/living?src=entry&entry=${entry.id}`);
  await expect(page.locator('.lv-summary')).toHaveText('西湖边的一个下午 · 按顺序 · 2 张');
  await expect(page.locator('.lv-cap-entry')).toHaveText('西湖边的一个下午');

  // an entry with no photos has nothing to play
  const files = (await api.get<EntryListResponse>('/api/entries?mine=1')).entries.find((e) => e.title === '湖边的声音');
  await page.goto(`/e/${files?.id}`);
  await expect(page.getByRole('heading', { level: 1, name: '湖边的声音' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Living，/ })).toHaveCount(0);
});
