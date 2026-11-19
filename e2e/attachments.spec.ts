// Attachments on the story's session: a video, a file and a recording going up with an entry and playing on its page,
// the video's position gone from what went up, the files kept from a visitor; a recording kept from the quick note;
// and all of them taken along by an export, into the account the story imported into. Runs after the regressions,
// since it adds entries of its own, and in order, each test on the one before.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EntryDetail, EntrySummary } from '../shared/types.ts';
import { BASE_URL, OWNER, OWNER_STATE } from './env.ts';
import { apiOf, cutOff, expect, follow, noOverflow, test, watch, zipFiles } from './support.ts';

test.use({ storageState: fileURLToPath(new URL(`../${OWNER_STATE}`, import.meta.url)) });
test.describe.configure({ mode: 'serial' });

/** 2 s of VP9 and Opus in MP4, with where it was made in a 3GPP `loci` box of its user data. */
const CLIP = fileURLToPath(new URL('fixtures/lake-clip.mp4', import.meta.url));
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
);

test('a video, a file and a recording go up with an entry, play on its page and stay the author’s', async ({ page, browser }) => {
  const api = apiOf(page.request);
  await page.goto('/entries/new');
  await page.getByLabel('标题', { exact: true }).fill('湖边的声音');
  const section = page.getByRole('region', { name: '附件' });
  const files = page.locator('input[type=file][aria-label="附件文件"]');

  // a picture goes with the photos
  await files.setInputFiles({ name: '湖.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
  await expect(section.getByRole('alert')).toContainText('湖.jpg：图片请在「照片」里添加');

  await files.setInputFiles([
    { name: 'lake-clip.mp4', mimeType: 'video/mp4', buffer: readFileSync(CLIP) },
    { name: '路线.pdf', mimeType: 'application/pdf', buffer: PDF }
  ]);
  await section.getByRole('button', { name: '录音', exact: true }).click();
  await expect(section.getByRole('status')).toContainText('录音中');
  // nothing is finished while files go up or a recording is on
  await expect(page.getByRole('button', { name: '完成', exact: true })).toBeDisabled();
  await page.waitForTimeout(1600);
  await section.getByRole('button', { name: '停止' }).click();

  const saved = section.locator('.att-row:not([data-state])');
  await expect(saved).toHaveCount(3, { timeout: 30_000 });
  await expect(saved.nth(0)).toContainText('lake-clip.mp4');
  await expect(saved.nth(0)).toContainText('0:02');
  await expect(saved.nth(0).locator('img')).toHaveAttribute('src', /\/media\/a\/at_[\w-]+\/poster$/);
  await expect(saved.nth(1)).toContainText('路线.pdf');
  await expect(saved.nth(2)).toContainText(/录音 \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.webm/);
  await page.getByLabel('lake-clip.mp4 的说明').fill('湖边，傍晚');
  await page.getByRole('button', { name: '下移 lake-clip.mp4' }).click();
  await expect(saved.nth(1)).toContainText('lake-clip.mp4');
  await noOverflow(page);

  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page).toHaveURL(/\/e\/en_[\w-]+$/);
  const id = page.url().split('/e/')[1];
  await expect(page.getByRole('heading', { level: 1, name: '湖边的声音' })).toBeVisible();

  // the page: the file to open or save, the video with its frame, the recording to play
  const video = page.locator('.att-video video');
  await expect(video).toHaveAttribute('poster', /\/poster$/);
  await expect(page.locator('figcaption').filter({ hasText: '湖边，傍晚' })).toBeVisible();
  await expect(page.getByRole('link', { name: '路线.pdf', exact: true })).toHaveAttribute('target', '_blank');
  await expect(page.locator('.att-sound audio')).toHaveCount(1);
  await expect(page.locator('a[download]')).toHaveCount(3);
  const played = await video.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<{ duration: number; width: number }>((resolve, reject) => {
        v.addEventListener('loadedmetadata', () => resolve({ duration: v.duration, width: v.videoWidth }), { once: true });
        v.addEventListener('error', () => reject(new Error('the video does not play')), { once: true });
        v.preload = 'metadata';
        v.load();
      })
  );
  expect(played.width).toBe(256);
  expect(played.duration).toBeCloseTo(2, 0);
  await noOverflow(page);

  const entry = await api.get<EntryDetail>(`/api/entries/${id}`);
  expect(entry.attachments.map((a) => [a.kind, a.mime])).toEqual([
    ['file', 'application/pdf'],
    ['video', 'video/mp4'],
    ['audio', 'audio/webm']
  ]);
  const clip = entry.attachments[1];
  expect(clip).toMatchObject({ name: 'lake-clip.mp4', width: 256, height: 144, poster: true, caption: '湖边，傍晚' });
  expect(clip.duration).toBeCloseTo(2, 0);
  expect(entry.attachments[2].duration).toBeGreaterThan(1);

  // what went up is the file as it was, its position blanked where it was: same length, nothing else moved
  const original = readFileSync(CLIP);
  const res = await page.request.get(`/media/a/${clip.id}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('video/mp4');
  const up = await res.body();
  expect(up.length).toBe(original.length);
  const loci = original.indexOf('loci');
  expect(loci).toBeGreaterThan(0);
  expect(up.indexOf('loci')).toBe(-1);
  expect(up.subarray(loci, loci + 4).toString()).toBe('free');
  const size = original.readUInt32BE(loci - 4);
  expect(up.subarray(loci + 4, loci - 4 + size).every((b) => b === 0)).toBe(true);
  expect(Buffer.compare(up.subarray(0, loci), original.subarray(0, loci))).toBe(0);
  expect(Buffer.compare(up.subarray(loci - 4 + size), original.subarray(loci - 4 + size))).toBe(0);
  const part = await page.request.get(`/media/a/${clip.id}`, { headers: { range: 'bytes=0-99' } });
  expect(part.status()).toBe(206);
  expect((await part.body()).length).toBe(100);
  const poster = await page.request.get(`/media/a/${clip.id}/poster`);
  expect(poster.headers()['content-type']).toBe('image/webp');
  const pdf = await page.request.get(`/media/a/${entry.attachments[0].id}`);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect(pdf.headers()['content-disposition']).toMatch(/^inline;/);
  const saving = await page.request.get(`/media/a/${entry.attachments[0].id}?download`);
  expect(saving.headers()['content-disposition']).toMatch(/^attachment;.*filename\*=UTF-8''%E8%B7%AF%E7%BA%BF\.pdf$/);

  // the entry is the author's alone, and so are its files
  const visitor = await browser.newContext({ storageState: undefined });
  for (const a of entry.attachments) expect((await visitor.request.get(`/media/a/${a.id}`)).status()).toBe(404);
  expect((await visitor.request.get(`/media/a/${clip.id}/poster`)).status()).toBe(404);
  // published for everyone, they open for anyone
  await api.patch(`/api/entries/${id}`, { visibility: 'public' });
  for (const a of entry.attachments) expect((await visitor.request.get(`/media/a/${a.id}`)).status()).toBe(200);
  await visitor.close();

  // a card says what it holds
  await follow(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '今天' }));
  const card = page.locator('a.en-card').filter({ hasText: '湖边的声音' });
  await expect(card).toHaveAttribute('aria-label', /1 个视频，1 段音频，1 个文件/);
  await expect(card.locator('.en-card-file')).toHaveCount(3);
});

test('a recording kept from the quick note, there still after a reload', async ({ page }) => {
  await page.goto('/today');
  const note = page.locator('form.qc');
  await note.getByRole('button', { name: '录音', exact: true }).click();
  await expect(note.getByRole('status').filter({ hasText: '录音中' })).toBeVisible();
  await page.waitForTimeout(1200);
  await note.getByRole('button', { name: '停止' }).click();
  const chip = note.getByRole('list', { name: '录音' }).getByRole('button', { name: /^移除 录音 / });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await expect(chip).toBeVisible();

  const made = page.waitForResponse((r) => r.url().endsWith('/api/entries') && r.request().method() === 'POST');
  await note.getByRole('button', { name: '记下', exact: true }).click();
  const { entry } = (await (await made).json()) as { entry: EntryDetail };
  await expect(note.getByRole('status').filter({ hasText: '记下了' })).toBeVisible();
  await expect(chip).toHaveCount(0);
  expect(entry).toMatchObject({ body: null, visibility: 'private', status: 'published' });
  expect(entry.attachments).toHaveLength(1);
  expect(entry.attachments[0]).toMatchObject({ kind: 'audio', mime: 'audio/webm' });
  await expect(page.locator(`a.en-card[href="/e/${entry.id}"] .en-card-file`)).toHaveCount(1);
});

test('an export takes the attachments along, and an import brings them back', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const api = apiOf(page.request);
  const listed = (await api.get<{ entries: EntrySummary[] }>('/api/entries?mine=1')).entries.find((e) => e.title === '湖边的声音');
  const entry = await api.get<EntryDetail>(`/api/entries/${listed?.id}`);
  const clip = entry.attachments.find((a) => a.kind === 'video') as EntryDetail['attachments'][number];
  const served = await (await page.request.get(`/media/a/${clip.id}`)).body();

  await page.goto('/settings#export');
  const section = page.getByRole('region', { name: '导出' });
  await expect(section).toContainText(/\d+ 个附件/);
  await expect(section.getByRole('switch', { name: '包含照片原文件和附件' })).toBeChecked();
  const [download] = await Promise.all([page.waitForEvent('download'), section.getByRole('button', { name: '下载 zip' }).click()]);
  await expect(section.getByRole('status')).toContainText('导出完成', { timeout: 60_000 });
  const zip = test.info().outputPath('export.zip');
  await download.saveAs(zip);
  const files = zipFiles(readFileSync(zip));
  const root = `living-${OWNER.handle}/`;
  const json = JSON.parse((files.get(`${root}living.json`) as Buffer).toString('utf8'));
  expect(json.version).toBe(2);
  const out = (json.entries as { id: string; file: string; attachments: { id: string; file: string; posterFile: string | null }[] }[]).find(
    (e) => e.id === entry.id
  );
  const a = out?.attachments.find((x) => x.id === clip.id);
  expect(a).toMatchObject({
    name: 'lake-clip.mp4',
    caption: '湖边，傍晚',
    file: expect.stringMatching(/^media\/\d{4}\/\d{4}-\d{2}-\d{2}_at_[\w-]+\.mp4$/),
    posterFile: expect.stringMatching(/\.poster\.webp$/)
  });
  // the file as it went up, its frame beside it, the Markdown linking to it
  expect(Buffer.compare(files.get(`${root}${a?.file}`) as Buffer, served)).toBe(0);
  expect((files.get(`${root}${a?.posterFile}`) as Buffer).subarray(8, 12).toString()).toBe('WEBP');
  expect((files.get(`${root}${out?.file}`) as Buffer).toString('utf8')).toContain('[lake-clip.mp4](<../../media/');

  // into the account the story imported into: what is new comes, the attachments with it
  const context = await browser.newContext({ storageState: undefined });
  await cutOff(context);
  const signedIn = await context.request.post('/api/auth/login', {
    data: { handle: 'mori', password: 'smoke-test-pass-2' },
    headers: { origin: BASE_URL }
  });
  expect(signedIn.ok()).toBe(true);
  const other = await context.newPage();
  const otherErrors = watch(other);
  await other.goto('/settings#import');
  const imports = other.getByRole('region', { name: '导入' });
  await imports.locator('input[accept*=".zip"]').setInputFiles(zip);
  await expect(imports).toContainText(/\d+ 个附件/);
  await imports.getByRole('switch', { name: '全部设为私密' }).check();
  await imports.getByRole('button', { name: '开始导入' }).click();
  await expect(imports.getByRole('status')).toContainText('导入完成', { timeout: 90_000 });
  await expect(imports).toContainText(/新加了 [^。]*\d+ 个附件/);

  const mine = apiOf(other.request);
  const theirs = (await mine.get<{ entries: EntrySummary[] }>('/api/entries?mine=1')).entries.find((e) => e.title === '湖边的声音');
  const got = await mine.get<EntryDetail>(`/api/entries/${theirs?.id}`);
  expect(got.attachments.map((x) => [x.kind, x.name, x.caption])).toEqual(entry.attachments.map((x) => [x.kind, x.name, x.caption]));
  const video = got.attachments.find((x) => x.kind === 'video') as EntryDetail['attachments'][number];
  expect(video.id).not.toBe(clip.id);
  expect(video).toMatchObject({ poster: true, width: 256, height: 144 });
  expect(Buffer.compare(await (await other.request.get(`/media/a/${video.id}`)).body(), served)).toBe(0);
  await other.goto(`/e/${got.id}`);
  await expect(other.locator('.att-video video')).toHaveAttribute('poster', new RegExp(`/media/a/${video.id}/poster$`));
  expect(otherErrors.take(), 'console errors of the importer').toEqual([]);
  await context.close();
});
