import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { EXPORT_PARTS } from '../../shared/types';
import { exportAttachment, exportData, exportEntry, exportPhoto, EXPORT_PROFILE, FakeDir } from '../test-utils';
import type { ExportData } from './archive';
import { runExport, RETRY_WAIT, type ExportOptions, type ExportProgress } from './run';
import { FolderSink, type ExportSink, type Previous } from './sinks';

const SITE = { name: 'Living', url: 'https://living.example' };
const NOW = new Date(2026, 10, 17, 9, 5);

type Media = string | number | ((n: number) => Response | Promise<Response>);

/** The API and /media, answered from `data`, `rows` rows a page. */
function server(data: ExportData, rows = 1) {
  const s = {
    calls: [] as string[],
    media: new Map<string, Media>(),
    asked: new Map<string, number>(),
    me: { id: EXPORT_PROFILE.id } as { id: string } | null,
    /** throws a network error for the next requests to these paths */
    down: new Map<string, number>()
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    s.calls.push(input);
    const down = s.down.get(input) ?? 0;
    if (down > 0) {
      s.down.set(input, down - 1);
      throw new TypeError('Failed to fetch');
    }
    const url = new URL(input, SITE.url);
    if (url.pathname === '/api/export') return json(data.summary);
    if (url.pathname === '/api/auth/me') return json({ user: s.me });
    const part = /^\/api\/export\/(\w+)$/.exec(url.pathname)?.[1];
    if (part && part in data) {
      const all = data[part as keyof ExportData] as unknown[];
      const from = Number(url.searchParams.get('after') ?? 0);
      return json({ rows: all.slice(from, from + rows), next: from + rows < all.length ? String(from + rows) : null });
    }
    if (url.pathname.startsWith('/media/')) {
      const key = url.pathname.slice('/media/'.length);
      const n = (s.asked.get(key) ?? 0) + 1;
      s.asked.set(key, n);
      const m = s.media.get(key);
      if (m === undefined) return json({ error: 'not_found', message: '文件不存在' }, 404);
      if (typeof m === 'number') return new Response('', { status: m });
      if (typeof m === 'function') return m(n);
      return new Response(m);
    }
    return json({ error: 'not_found', message: '不存在' }, 404);
  });
  return s;
}

/** Writes into memory, in order; an earlier export's files and sizes are given. */
class MemorySink implements ExportSink {
  written: string[] = [];
  files = new Map<string, Blob>();
  removed: string[] = [];
  closed = false;
  constructor(
    private readonly prev: Previous = { ownerId: null, files: [] },
    private readonly sizes = new Map<string, number>()
  ) {}
  async existing(path: string) {
    return this.sizes.get(path) ?? null;
  }
  async write(path: string, data: Blob) {
    this.written.push(path);
    this.files.set(path, data);
  }
  async previous() {
    return this.prev;
  }
  async remove(path: string) {
    this.removed.push(path);
  }
  async close() {
    this.closed = true;
  }
}

function run(sink: ExportSink, over: Partial<ExportOptions> = {}) {
  const waits: number[] = [];
  const progress: ExportProgress[] = [];
  const done = runExport({
    sink,
    originals: true,
    site: SITE,
    signal: new AbortController().signal,
    now: () => NOW,
    sleep: async (ms) => void waits.push(ms),
    onProgress: (p) => progress.push(p),
    ...over
  });
  return { done, waits, progress };
}

const text = async (b: Blob | undefined) => (b ? b.text() : undefined);
const living = async (files: Map<string, Blob>) => JSON.parse((await text(files.get('living.json'))) as string);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runExport', () => {
  const photos = [
    exportPhoto('ph_B', { fileSize: 4 }),
    exportPhoto('ph_A', { takenAt: '2025-05-01T09:00:00', fileSize: 3 }),
    exportPhoto('ph_C', { takenAt: null, fileSize: 2 })
  ];
  const data = exportData({
    photos,
    entries: [exportEntry('en_1', { title: '西湖' })],
    entryMedia: [{ entryId: 'en_1', photoId: 'ph_A', position: 0, caption: null }]
  });
  const original = (id: string) => `o/${EXPORT_PROFILE.id}/${id}.jpg`;

  it('reads every part page by page, writes the photos in order, the text after them and living.json last', async () => {
    const s = server(data);
    s.media.set(original('ph_A'), 'aaa');
    s.media.set(original('ph_B'), 'bbbb');
    s.media.set(original('ph_C'), 'cc');
    const sink = new MemorySink();
    const { done, progress } = run(sink);
    const outcome = await done;

    expect(s.calls.filter((c) => c.startsWith('/api/export'))).toEqual([
      '/api/export',
      ...EXPORT_PARTS.flatMap((p) =>
        p === 'photos' ? ['/api/export/photos', '/api/export/photos?after=1', '/api/export/photos?after=2'] : [`/api/export/${p}`]
      )
    ]);
    expect(sink.written).toEqual([
      'media/2025/2025-05-01_ph_A.jpg',
      'media/2026/2026-11-16_ph_B.jpg',
      'media/undated/ph_C.jpg',
      'README.md',
      'entries/2026/2026-11-16 西湖.md',
      'living.json'
    ]);
    expect(await text(sink.files.get('media/2026/2026-11-16_ph_B.jpg'))).toBe('bbbb');
    expect(await text(sink.files.get('entries/2026/2026-11-16 西湖.md'))).toContain('![](<../../media/2025/2025-05-01_ph_A.jpg>)');
    expect(sink.closed).toBe(true);
    expect(outcome).toEqual({
      photos: 3,
      files: 3,
      kept: 0,
      large: [],
      missing: [],
      attachments: 0,
      attachmentFiles: 0,
      attachmentsKept: 0,
      attachmentsMissing: [],
      removed: 0,
      downloaded: 9
    });
    expect((await living(sink.files)).photos.map((p: { file: string }) => p.file)).toEqual([
      'media/2026/2026-11-16_ph_B.jpg',
      'media/2025/2025-05-01_ph_A.jpg',
      'media/undated/ph_C.jpg'
    ]);

    // the rows, then the photos by bytes, then the text
    expect(progress[0]).toMatchObject({ phase: 'reading', rows: 0, totalRows: 5, totalPhotos: 3, totalBytes: 9 });
    expect(progress.filter((p) => p.phase === 'reading').at(-1)).toMatchObject({ rows: 5 });
    expect(progress.filter((p) => p.phase === 'media').at(-1)).toMatchObject({ photos: 3, bytes: 9 });
    expect(progress.at(-1)?.phase).toBe('writing');
  });

  it('stands the large size in for a missing original, once the session is known to be there', async () => {
    const s = server(data);
    s.media.set(original('ph_A'), 'aaa');
    s.media.set('v/ph_B/l.webp', 'large');
    const sink = new MemorySink();
    const outcome = await run(sink).done;
    expect(outcome).toMatchObject({ files: 2, large: ['ph_B'], missing: ['ph_C'], downloaded: 8 });
    expect(sink.written.slice(0, 2)).toEqual(['media/2025/2025-05-01_ph_A.jpg', 'media/2026/2026-11-16_ph_B.webp']);
    // once on the way (shared by the photos that missed together), once at the end
    expect(s.calls.filter((c) => c === '/api/auth/me')).toHaveLength(2);
    const j = await living(sink.files);
    expect(j.photos[0]).toMatchObject({ id: 'ph_B', file: 'media/2026/2026-11-16_ph_B.webp', fileIsLarge: true });
    expect(j.photos[2]).toMatchObject({ id: 'ph_C', file: null });
  });

  it('stops when the session has ended: a signed-out browser is refused originals with 404 as well', async () => {
    const s = server(data);
    s.me = null;
    const sink = new MemorySink();
    await expect(run(sink).done).rejects.toThrow('登录已失效，重新登录后再导出');
    expect(sink.written).not.toContain('living.json');
    expect(sink.closed).toBe(false);
    // signed in again, as someone else
    server(data).me = { id: 'u_OTHER' };
    await expect(run(new MemorySink()).done).rejects.toThrow('登录已失效，重新登录后再导出');
  });

  it('tries again a request that failed on the way, waiting longer each time', async () => {
    const s = server(data);
    s.down.set('/api/export/photos?after=1', 1);
    s.media.set(original('ph_A'), 'aaa');
    s.media.set(original('ph_B'), (n) => (n < 3 ? new Response('', { status: 503 }) : new Response('bbbb')));
    s.media.set(original('ph_C'), (n) => (n < 2 ? new Response('', { status: 429 }) : new Response('cc')));
    const sink = new MemorySink();
    const { done, waits } = run(sink);
    expect(await done).toMatchObject({ files: 3, missing: [] });
    expect(waits.sort((a, b) => a - b)).toEqual([RETRY_WAIT[0], RETRY_WAIT[0], RETRY_WAIT[0], RETRY_WAIT[1]]);
  });

  it('gives up after the last try, and says why', async () => {
    const one = exportData({ photos: [exportPhoto('ph_A')] });
    const s = server(one);
    s.down.set(`/media/${original('ph_A')}`, 99);
    const { done, waits } = run(new MemorySink());
    await expect(done).rejects.toThrow('网络断了，导出没能完成');
    expect(waits).toEqual(RETRY_WAIT);

    server(one).media.set(original('ph_A'), 403);
    await expect(run(new MemorySink()).done).rejects.toThrow('下载照片没有成功（403），稍后再试');
  });

  it('without the originals downloads no photo, and keeps the ones an earlier export left', async () => {
    const s = server(data);
    const sink = new MemorySink(
      {
        ownerId: EXPORT_PROFILE.id,
        // a file system that ignores case calls the entry's file by the name an earlier export gave it
        files: ['README.md', 'media/2025/2025-05-01_ph_A.jpg', 'media/2026/2026-11-16_ph_B.jpg', 'Entries/2026/2026-11-16 西湖.MD']
      },
      new Map([
        ['media/2025/2025-05-01_ph_A.jpg', 3],
        // not the original's size: a file cut short, or not ours
        ['media/2026/2026-11-16_ph_B.jpg', 1]
      ])
    );
    const outcome = await run(sink, { originals: false }).done;
    expect(s.calls.filter((c) => c.startsWith('/media/'))).toEqual([]);
    expect(outcome).toEqual({
      photos: 3,
      files: 1,
      kept: 1,
      large: [],
      missing: [],
      attachments: 0,
      attachmentFiles: 0,
      attachmentsKept: 0,
      attachmentsMissing: [],
      removed: 1,
      downloaded: 0
    });
    expect(sink.removed).toEqual(['media/2026/2026-11-16_ph_B.jpg']);
    expect(await text(sink.files.get('entries/2026/2026-11-16 西湖.md'))).toContain('![](<../../media/2025/2025-05-01_ph_A.jpg>)');
  });

  describe('attachments', () => {
    const withFiles = exportData({
      photos: [exportPhoto('ph_A', { takenAt: '2025-05-01T09:00:00', fileSize: 3 })],
      entries: [exportEntry('en_1', { title: '西湖', occurredAt: '2026-05-02T18:00:00' })],
      attachments: [
        exportAttachment('at_v', { name: 'clip.MOV', mime: 'video/quicktime', size: 5, caption: '湖边' }),
        exportAttachment('at_f', { kind: 'file', name: '路线[1].pdf', mime: 'application/pdf', size: 3, position: 1, poster: false })
      ]
    });
    const jpeg = () => new Response('jpg', { headers: { 'content-type': 'image/jpeg' } });

    it('come after the photos, by their entry’s day, a video’s frame beside it', async () => {
      const s = server(withFiles);
      s.media.set(original('ph_A'), 'aaa');
      s.media.set('a/at_v', 'vvvvv');
      s.media.set('a/at_v/poster', jpeg);
      s.media.set('a/at_f', 'fff');
      const sink = new MemorySink();
      const { done, progress } = run(sink);
      const outcome = await done;
      expect(sink.written).toEqual([
        'media/2025/2025-05-01_ph_A.jpg',
        'media/2026/2026-05-02_at_f.pdf',
        'media/2026/2026-05-02_at_v.mov',
        'media/2026/2026-05-02_at_v.poster.jpg',
        'README.md',
        'entries/2026/2026-05-02 西湖.md',
        'living.json'
      ]);
      expect(await text(sink.files.get('media/2026/2026-05-02_at_v.mov'))).toBe('vvvvv');
      expect(outcome).toMatchObject({ attachments: 2, attachmentFiles: 2, attachmentsKept: 0, attachmentsMissing: [], downloaded: 14 });

      const md = await text(sink.files.get('entries/2026/2026-05-02 西湖.md'));
      expect(md).toContain(
        '[clip.MOV](<../../media/2026/2026-05-02_at_v.mov>)\n\n湖边\n\n[路线\\[1\\].pdf](<../../media/2026/2026-05-02_at_f.pdf>)'
      );
      const j = await living(sink.files);
      expect(j.version).toBe(2);
      expect(j.entries[0].attachments).toEqual([
        {
          ...exportAttachment('at_v', { name: 'clip.MOV', mime: 'video/quicktime', size: 5, caption: '湖边' }),
          entryId: undefined,
          position: undefined,
          file: 'media/2026/2026-05-02_at_v.mov',
          posterFile: 'media/2026/2026-05-02_at_v.poster.jpg'
        },
        expect.objectContaining({ id: 'at_f', file: 'media/2026/2026-05-02_at_f.pdf', posterFile: null })
      ]);
      expect(j.files).toContain('media/2026/2026-05-02_at_v.poster.jpg');
      const readme = await text(sink.files.get('README.md'));
      expect(readme).toContain('`media/` 里还有 2 个附件（视频、录音和其他文件），上传时的原文件');
      expect(readme).toContain('视频的封面是旁边同名的 .poster 图片。');

      expect(progress[0]).toMatchObject({ totalAttachments: 2, totalBytes: 11 });
      expect(progress.filter((p) => p.phase === 'attachments').at(-1)).toMatchObject({ attachments: 2, bytes: 11 });
    });

    it('in a folder: ones an earlier export left are kept, ones the Worker no longer has are missing', async () => {
      const s = server(withFiles);
      s.media.set(original('ph_A'), 'aaa');
      const sink = new MemorySink(
        { ownerId: EXPORT_PROFILE.id, files: [] },
        new Map([
          ['media/2026/2026-05-02_at_v.mov', 5],
          ['media/2026/2026-05-02_at_v.poster.webp', 9]
        ])
      );
      const outcome = await run(sink).done;
      expect(s.calls.filter((c) => c.startsWith('/media/a/'))).toEqual(['/media/a/at_f']);
      expect(outcome).toMatchObject({ attachmentFiles: 1, attachmentsKept: 1, attachmentsMissing: ['at_f'] });
      const j = await living(sink.files);
      expect(j.entries[0].attachments.map((a: { file: string | null; posterFile: string | null }) => [a.file, a.posterFile])).toEqual([
        ['media/2026/2026-05-02_at_v.mov', 'media/2026/2026-05-02_at_v.poster.webp'],
        [null, null]
      ]);
      expect(await text(sink.files.get('README.md'))).toContain('另有 1 个找不到文件，只有信息在 living.json 里。');
      expect(await text(sink.files.get('entries/2026/2026-05-02 西湖.md'))).toContain('（附件 路线\\[1\\].pdf）');
    });

    it('without the originals are named, not downloaded', async () => {
      const s = server(withFiles);
      const sink = new MemorySink();
      const outcome = await run(sink, { originals: false }).done;
      expect(s.calls.filter((c) => c.startsWith('/media/'))).toEqual([]);
      expect(outcome).toMatchObject({ attachments: 2, attachmentFiles: 0, attachmentsMissing: [] });
      expect(await text(sink.files.get('README.md'))).toContain('- 这次导出没有下载附件：2 个附件只有信息在 living.json 里');
      expect(await text(sink.files.get('entries/2026/2026-05-02 西湖.md'))).toContain('（附件 clip.MOV）\n\n湖边');
    });

    it('stop on a refused download, and say it was an attachment', async () => {
      const s = server(withFiles);
      s.media.set(original('ph_A'), 'aaa');
      s.media.set('a/at_f', 403);
      await expect(run(new MemorySink()).done).rejects.toThrow('下载附件没有成功（403），稍后再试');
    });
  });

  it('refuses a folder that holds another account’s export before writing anything', async () => {
    server(data);
    const sink = new MemorySink({ ownerId: 'u_OTHER', files: ['README.md'] });
    await expect(run(sink).done).rejects.toThrow('这个文件夹里是另一个账号的导出');
    expect(sink.written).toEqual([]);
  });

  it('stops when cancelled', async () => {
    const s = server(data);
    for (const p of photos) s.media.set(original(p.id), 'x');
    const ctl = new AbortController();
    const sink = new MemorySink();
    const done = run(sink, {
      signal: ctl.signal,
      onProgress: (p) => {
        if (p.phase === 'media' && p.photos === 1) ctl.abort();
      }
    }).done;
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(sink.written).toEqual(['media/2025/2025-05-01_ph_A.jpg']);
    expect(sink.closed).toBe(false);
  });

  it('updates an earlier export in a folder: downloads only what is new and tidies away what is gone', async () => {
    const dir = new FakeDir('living-ada');
    await dir.put('mine.txt', 'not the export’s');
    const first = server(
      exportData({ photos: [exportPhoto('ph_1'), exportPhoto('ph_2')], entries: [exportEntry('en_1', { title: '西湖' })] })
    );
    first.media.set(original('ph_1'), 'one11111');
    first.media.set(original('ph_2'), 'two22222');
    await run(new FolderSink(dir.handle)).done;
    expect([...dir.files().keys()].sort()).toEqual([
      'README.md',
      'entries/2026/2026-11-16 西湖.md',
      'living.json',
      'media/2026/2026-11-16_ph_1.jpg',
      'media/2026/2026-11-16_ph_2.jpg',
      'mine.txt'
    ]);

    // ph_2 deleted, ph_3 new, the entry renamed
    const second = server(
      exportData({ photos: [exportPhoto('ph_1'), exportPhoto('ph_3')], entries: [exportEntry('en_1', { title: '西湖边' })] })
    );
    second.media.set(original('ph_1'), 'one11111');
    second.media.set(original('ph_3'), 'three333');
    const outcome = await run(new FolderSink(dir.handle)).done;
    expect(second.calls.filter((c) => c.startsWith('/media/'))).toEqual([`/media/${original('ph_3')}`]);
    expect(outcome).toMatchObject({ files: 2, kept: 1, removed: 2, downloaded: 8 });
    expect([...dir.files().keys()].sort()).toEqual([
      'README.md',
      'entries/2026/2026-11-16 西湖边.md',
      'living.json',
      'media/2026/2026-11-16_ph_1.jpg',
      'media/2026/2026-11-16_ph_3.jpg',
      'mine.txt'
    ]);
    expect((await living(dir.files())).files).toEqual([
      'README.md',
      'entries/2026/2026-11-16 西湖边.md',
      'media/2026/2026-11-16_ph_1.jpg',
      'media/2026/2026-11-16_ph_3.jpg'
    ]);
  });
});
