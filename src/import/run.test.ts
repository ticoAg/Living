import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { IMPORT_LIMITS } from '../../shared/limits';
import type { ExportPhoto, PhotoDetail } from '../../shared/types';
import { FORMAT, FORMAT_VERSION, mediaPath, textFiles, type ExportData, type PhotoFile } from '../export/archive';
import { ApiError } from '../lib/api';
import type { PublishResult } from '../studio/publish';
import { exportData, exportEntry, exportPhoto, exportPlace, exportProject, exportTheme, EXPORT_PROFILE } from '../test-utils';
import { ImportStopped, planImport, RETRY_WAIT, runImport, typeOf, type ImportOptions, type ImportProgress } from './run';
import type { ImportSource, SourceFile } from './source';

afterEach(() => vi.unstubAllGlobals());

const SITE = { name: 'Living', url: 'https://old.example' };
const HERE = 'https://new.example';
const NOW = new Date(2026, 10, 17, 9, 5);

/** An id as the site makes them: a prefix and 26 characters of Crockford base 32. */
const id = (prefix: string, n: number) => `${prefix}_${String(n).padStart(26, '0')}`;
/** The id the fake Worker gives what it brings in: the same, but for an H after the prefix. */
const hereId = (x: string) => x.replace(/_./, '_H');
const sha = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const DAY = '2026-01-01T00:00:00Z';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refuse = (status: number, error: string, message: string) => json({ error, message }, status);

type Queued = Response | Error | ((signal?: AbortSignal | null) => Promise<Response>);

/**
 * The Worker's import endpoints, in memory: an item brought gets `hereId` of its id, one in `existing` keeps its own,
 * a photo in `photos` (by hash) is here already. `next` answers the next requests to a path before that.
 */
function server() {
  const s = {
    calls: [] as { path: string; body: Record<string, unknown[]> }[],
    photos: new Map<string, string>(),
    existing: new Set<string>(),
    failed: new Map<string, string>(),
    /** rows answered with another id than `resolve` gave them */
    renamed: new Map<string, string>(),
    next: new Map<string, Queued[]>()
  };
  const target = (x: string) => ({ id: s.existing.has(x) ? x : hereId(x), exists: s.existing.has(x) });
  const each = <T>(list: unknown[] | undefined, fn: (x: string) => [string, T] | null) =>
    Object.fromEntries((list ?? []).map((x) => fn(x as string)).filter((x) => x !== null));
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as Record<string, unknown[]>;
    s.calls.push({ path, body });
    const queued = s.next.get(path)?.shift();
    if (queued instanceof Error) throw queued;
    if (typeof queued === 'function') return queued(init?.signal);
    if (queued) return queued;
    const rows = (key: string) => body[key] as { id: string }[];
    switch (path) {
      case '/api/import/resolve':
        return json({
          photos: each(body.photos, (h) => (s.photos.has(h) ? [h, s.photos.get(h)] : null)),
          entries: each(body.entries, (x) => [x, target(x)]),
          projects: each(body.projects, (x) => [x, target(x)]),
          collections: each(body.collections, (x) => [x, target(x)])
        });
      case '/api/import/tags':
      case '/api/import/places': {
        const list = rows(path.slice('/api/import/'.length));
        return json({ ids: Object.fromEntries(list.map((r) => [r.id, hereId(r.id)])), created: list.length });
      }
      case '/api/import/zones':
        return json({ created: body.zones.length, existing: 0, full: 0 });
      case '/api/import/projects':
      case '/api/import/entries':
      case '/api/import/collections': {
        const list = rows(path.slice('/api/import/'.length));
        const ok = list.filter((r) => !s.failed.has(r.id));
        return json({
          ids: Object.fromEntries(ok.map((r) => [r.id, s.renamed.get(r.id) ?? target(r.id).id])),
          created: ok.filter((r) => !s.existing.has(r.id)).length,
          existing: ok.filter((r) => s.existing.has(r.id)).length,
          failed: list.filter((r) => s.failed.has(r.id)).map((r) => ({ id: r.id, message: s.failed.get(r.id) }))
        });
      }
    }
    return refuse(404, 'not_found', '不存在');
  });
  return s;
}

/** A request that waits until it is cancelled. */
const hang = (signal?: AbortSignal | null) =>
  new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));

/** living.json and the photos' files, each of `size` bytes. */
function source(text: string, files: Record<string, number> = {}): ImportSource {
  const map = new Map<string, SourceFile>([['living.json', { size: text.length, read: async () => new Blob([text]) }]]);
  for (const [path, size] of Object.entries(files)) map.set(path, { size, read: async () => new Blob([new Uint8Array(size)]) });
  return { files: map, root: 'living-ada' };
}

const living = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, site: SITE, profile: { id: EXPORT_PROFILE.id }, ...over });

/** living.json as an export writes it, and the photos' files: the originals, but for those in `without`. */
function exported(data: ExportData, without: string[] = [], picked = (_path: string) => true) {
  const files = new Map<string, PhotoFile>(
    data.photos.filter((p) => !without.includes(p.id)).map((p) => [p.id, { path: mediaPath(p, p.fileKey) }])
  );
  const text = textFiles(data, files, SITE, NOW).find((f) => f.path === 'living.json')?.text as string;
  const sizes = Object.fromEntries([...files.values()].filter((f) => picked(f.path)).map((f, i) => [f.path, 1000 * (i + 1)]));
  return source(text, sizes);
}

const variant = (w: number, h: number) => ({
  blob: new Blob(['RIFF....WEBP'], { type: 'image/webp' }),
  w,
  h,
  mime: 'image/webp' as const,
  ext: 'webp' as const
});
/** A file as processed here: its EXIF says other things than living.json, which is what is to be sent. */
const PROCESSED = {
  exif: { takenAt: '2001-01-01T00:00:00', tz: null, lat: 1, lng: 2, camera: 'EXIF' },
  width: 4032,
  height: 3024,
  variants: { s: variant(480, 360), m: variant(1600, 1200), l: variant(2560, 1920) },
  thumbhash: 'TH',
  palette: ['#112233'],
  sha256: 'ee'.repeat(32)
};

/** Uploads that answer as `answers` says for a photo (by its id in the export), else take it. */
function uploads(answers: Record<string, (PublishResult | (() => PublishResult))[]> = {}) {
  const forms: FormData[] = [];
  const send: ImportOptions['send'] = async (form, onProgress) => {
    forms.push(form);
    const exportId = /ph_[0-9A-Z]{26}/.exec((form.get('original') as File).name)?.[0] as string;
    onProgress(0.5);
    onProgress(1);
    const a = answers[exportId]?.shift();
    if (a) return typeof a === 'function' ? a() : a;
    return { ok: true, photo: { id: hereId(exportId) } as PhotoDetail };
  };
  return { forms, send, ids: () => forms.map((f) => /ph_[0-9A-Z]{26}/.exec((f.get('original') as File).name)?.[0]) };
}

const metaOf = (f: FormData) => JSON.parse(f.get('meta') as string) as Record<string, unknown>;
const bodies = (s: ReturnType<typeof server>, path: string) => s.calls.filter((c) => c.path === path).map((c) => c.body);

async function go(src: ImportSource, over: Partial<ImportOptions> = {}) {
  const slept: number[] = [];
  const sleep = async (ms: number) => void slept.push(ms);
  const ctl = new AbortController();
  const plan = await planImport(src, ctl.signal, sleep);
  const progress: ImportProgress[] = [];
  const up = uploads();
  const opts: ImportOptions = {
    plan,
    source: src,
    privateAll: false,
    origin: HERE,
    signal: ctl.signal,
    onProgress: (p) => progress.push(p),
    resize: async () => PROCESSED,
    send: up.send,
    parallel: 1,
    sleep,
    ...over
  };
  const result = await runImport(opts).then(
    (outcome) => ({ outcome, stopped: null }),
    (e: unknown) => {
      if (!(e instanceof ImportStopped)) throw e;
      return { outcome: e.outcome, stopped: e.message };
    }
  );
  return { plan, progress, slept, up, ctl, ...result };
}

// ---- an export with a bit of everything ------------------------------------------------------------------------------

const PH = { a: id('ph', 1), b: id('ph', 2), c: id('ph', 3), d: id('ph', 4), e: id('ph', 5) };
const T = { parent: id('t', 1), child: id('t', 2) };
const EN = { one: id('en', 1), two: id('en', 2) };
const PJ = id('pj', 1);
const TH = id('th', 1);
const POI = id('poi', 1);
const PH_HERE = id('ph', 99);

function everything(over: { photos?: ExportPhoto[] } = {}): ExportData {
  return exportData({
    photos: over.photos ?? [
      exportPhoto(PH.a, {
        title: '断桥',
        uploadedAt: '2026-11-16T09:00:00Z',
        sha256: sha(1),
        poiId: POI,
        poiDistance: 12,
        poiMethod: 'auto',
        visibility: 'public'
      }),
      // here already
      exportPhoto(PH.b, { uploadedAt: '2026-11-16T08:00:00Z', sha256: sha(2) }),
      // uploaded there before the others
      exportPhoto(PH.c, { uploadedAt: '2026-11-15T08:00:00Z', fileKey: `o/${EXPORT_PROFILE.id}/${PH.c}.heic`, fileType: 'image/heic' }),
      // no file in the export
      exportPhoto(PH.d),
      // its file in a part not picked
      exportPhoto(PH.e, { takenAt: '2026-11-17T10:00:00', sha256: sha(5) })
    ],
    photoTags: [{ photoId: PH.a, tagId: T.child, source: 'manual' }],
    entries: [
      exportEntry(EN.two, { title: null, body: '第二天', occurredAt: '2026-11-17T09:00:00', createdAt: '2026-11-17T10:00:00Z' }),
      exportEntry(EN.one, {
        title: '西湖',
        body: `接着看[下一篇](${SITE.url}/entries/${EN.two})`,
        visibility: 'public',
        createdAt: '2026-11-16T10:00:00Z'
      })
    ],
    entryMedia: [
      { entryId: EN.one, photoId: PH.a, position: 0, caption: '湖边' },
      { entryId: EN.one, photoId: PH.b, position: 1, caption: null },
      { entryId: EN.one, photoId: PH.d, position: 2, caption: null }
    ],
    entryTags: [{ entryId: EN.one, tagId: T.child }],
    entryProjects: [{ entryId: EN.one, projectId: PJ }],
    projects: [exportProject(PJ)],
    milestones: [{ id: 'ms_1', projectId: PJ, title: '第一首', body: null, date: '2026-10-01', createdAt: DAY, updatedAt: DAY }],
    themes: [exportTheme(TH, { coverPhotoId: PH.a })],
    themeItems: [
      { id: 'it_1', themeId: TH, position: 0, kind: 'photo', photoId: PH.a, entryId: null, text: null, day: null },
      { id: 'it_2', themeId: TH, position: 1, kind: 'entry', photoId: null, entryId: EN.one, text: null, day: null },
      { id: 'it_3', themeId: TH, position: 2, kind: 'photo', photoId: PH.d, entryId: null, text: null, day: null }
    ],
    // the child before its parent
    tags: [
      { id: T.child, ownerId: EXPORT_PROFILE.id, parentId: T.parent, name: '西湖', color: null, sort: 0, createdAt: DAY },
      { id: T.parent, ownerId: EXPORT_PROFILE.id, parentId: null, name: '旅行', color: null, sort: 0, createdAt: DAY }
    ],
    places: [exportPlace(POI)],
    privacyZones: [{ id: 'pz_1', name: '家', lat: 30.2, lng: 120.1, radius: 300, createdAt: DAY }],
    shareLinks: [{ id: 'sl_1', kind: 'entry', itemId: EN.one, createdAt: DAY, expiresAt: null }]
  });
}

const notPicked = (path: string) => !path.includes(PH.e);

describe('planImport', () => {
  it('reads the export and asks what of it is here; the photos to bring are those not here whose file was picked, oldest first', async () => {
    const s = server();
    s.photos.set(sha(2), PH_HERE);
    s.existing.add(PJ);
    const src = exported(everything(), [PH.d], notPicked);
    const plan = await planImport(src, new AbortController().signal);

    expect(bodies(s, '/api/import/resolve')).toEqual([
      { photos: [sha(1), sha(2), sha(5)], entries: [EN.one, EN.two], projects: [PJ], collections: [TH] }
    ]);
    expect(plan.archive.photos).toHaveLength(5);
    expect([...plan.photosHere]).toEqual([[PH.b, PH_HERE]]);
    expect(plan.upload.map((p) => p.id)).toEqual([PH.c, PH.a]);
    expect(plan.bytes).toBe(plan.upload.reduce((n, p) => n + (src.files.get(p.file as string)?.size ?? 0), 0));
    expect(plan.bytes).toBeGreaterThan(0);
    expect([plan.noFile, plan.notPicked]).toEqual([1, 1]);
    expect(plan.projects.get(PJ)).toEqual({ id: PJ, exists: true });
    expect(plan.entries.get(EN.one)).toEqual({ id: hereId(EN.one), exists: false });
    expect(plan.collections.get(TH)).toEqual({ id: hereId(TH), exists: false });
  });

  it('tells the photos the export has no file for from those whose file was not picked', async () => {
    server();
    const plan = await planImport(exported(everything(), [PH.c, PH.d], notPicked), new AbortController().signal);
    expect([plan.noFile, plan.notPicked]).toEqual([2, 1]);
    expect(plan.upload.map((p) => p.id)).toEqual([PH.b, PH.a]);
  });

  it('does not look for a large size standing in for an original by the original’s hash', async () => {
    const s = server();
    const data = exportData({ photos: [exportPhoto(PH.a, { sha256: sha(1) }), exportPhoto(PH.b, { sha256: sha(2) })] });
    const files = new Map<string, PhotoFile>([
      [PH.a, { path: mediaPath(data.photos[0], 'x.jpg') }],
      [PH.b, { path: mediaPath(data.photos[1], 'l.webp'), large: true }]
    ]);
    const text = textFiles(data, files, SITE, NOW).find((f) => f.path === 'living.json')?.text as string;
    const plan = await planImport(
      source(text, Object.fromEntries([...files.values()].map((f) => [f.path, 10]))),
      new AbortController().signal
    );
    expect(bodies(s, '/api/import/resolve')[0].photos).toEqual([sha(1)]);
    expect(plan.upload.map((p) => p.id)).toEqual([PH.a, PH.b]);
  });

  it('asks a thousand of each at a time', async () => {
    const s = server();
    const n = IMPORT_LIMITS.resolve + 1;
    const photos = Array.from({ length: n }, (_, i) => ({
      id: id('ph', i + 1),
      sha256: sha(i % 256).slice(0, 60) + String(i).padStart(4, '0')
    }));
    const entries = Array.from({ length: n }, (_, i) => ({ id: id('en', i + 1) }));
    await planImport(source(living({ photos, entries, projects: [{ id: PJ }] })), new AbortController().signal);
    const asked = bodies(s, '/api/import/resolve');
    expect(asked.map((b) => [b.photos.length, b.entries.length, b.projects.length, b.collections.length])).toEqual([
      [1000, 1000, 1, 0],
      [1, 1, 0, 0]
    ]);
    expect(asked[1].entries).toEqual([id('en', n)]);
  });

  it('asks again when the request fails on the way, and not when the Worker refuses it', async () => {
    const s = server();
    s.next.set('/api/import/resolve', [new TypeError('Failed to fetch'), refuse(503, 'upstream', '暂时不可用')]);
    const slept: number[] = [];
    const sleep = async (ms: number) => void slept.push(ms);
    await planImport(source(living({ entries: [{ id: EN.one }] })), new AbortController().signal, sleep);
    expect(slept).toEqual([RETRY_WAIT[0], RETRY_WAIT[1]]);
    expect(s.calls).toHaveLength(3);

    s.next.set('/api/import/resolve', [refuse(400, 'invalid_input', '编号不对')]);
    const err = await planImport(source(living({ entries: [{ id: EN.one }] })), new AbortController().signal, sleep).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('编号不对');
    expect(slept).toHaveLength(2);
  });

  it('has nothing to ask about an empty export', async () => {
    const s = server();
    const plan = await planImport(source(living()), new AbortController().signal);
    expect(s.calls).toHaveLength(0);
    expect([plan.upload, plan.bytes, plan.noFile, plan.notPicked]).toEqual([[], 0, 0, 0]);
  });
});

describe('runImport', () => {
  it('brings everything over in order, each step with the ids the steps before it got', async () => {
    const s = server();
    s.photos.set(sha(2), PH_HERE);
    const { outcome, stopped, progress, up } = await go(exported(everything(), [PH.d], notPicked));
    expect(stopped).toBeNull();

    expect(s.calls.map((c) => c.path)).toEqual([
      '/api/import/resolve',
      '/api/import/tags',
      '/api/import/places',
      '/api/import/zones',
      '/api/import/projects',
      '/api/import/entries',
      '/api/import/collections'
    ]);
    expect(progress.map((p) => p.phase).filter((p, i, all) => p !== all[i - 1])).toEqual([
      'tags',
      'places',
      'zones',
      'photos',
      'projects',
      'entries',
      'collections'
    ]);
    const last = progress.at(-1) as ImportProgress;
    expect([last.photos, last.totalPhotos, last.bytes]).toEqual([2, 2, last.totalBytes]);

    // tags: the parent first; one in the same batch keeps the export's id for its parent, for the Worker to map
    const [tags] = bodies(s, '/api/import/tags');
    expect((tags.tags as { id: string; parentId: string | null }[]).map((t) => [t.id, t.parentId])).toEqual([
      [T.parent, null],
      [T.child, T.parent]
    ]);
    expect(bodies(s, '/api/import/zones')).toEqual([{ zones: [{ name: '家', lat: 30.2, lng: 120.1, radius: 300 }] }]);

    // photos: the oldest upload first, each with living.json's word on it and the sizes of the file as resized here
    expect(up.ids()).toEqual([PH.c, PH.a]);
    const [heic, jpg] = up.forms;
    expect([(heic.get('original') as File).name, (heic.get('original') as File).type]).toEqual([`2026-11-16_${PH.c}.heic`, 'image/heic']);
    expect([(jpg.get('original') as File).name, (jpg.get('original') as File).type]).toEqual([`2026-11-16_${PH.a}.jpg`, 'image/jpeg']);
    expect((jpg.get('original') as File).size).toBe(1000);
    expect(['s', 'm', 'l'].map((k) => (jpg.get(k) as File).name)).toEqual(['s.webp', 'm.webp', 'l.webp']);
    expect(metaOf(jpg)).toMatchObject({
      title: '断桥',
      takenAt: '2026-11-16T15:30:00',
      lat: null,
      lng: null,
      camera: null,
      poiId: hereId(POI),
      poiDistance: 12,
      poiMethod: 'auto',
      width: 4032,
      height: 3024,
      variantSizes: { s: [480, 360], m: [1600, 1200], l: [2560, 1920] },
      thumbhash: 'TH',
      sha256: 'ee'.repeat(32),
      visibility: 'public',
      tagIds: [hereId(T.child)],
      suggestedTagIds: []
    });

    const [projects] = bodies(s, '/api/import/projects');
    expect(projects.projects).toMatchObject([{ id: PJ, title: '学吉他', milestones: [{ title: '第一首', date: '2026-10-01' }] }]);

    // entries, oldest first: the photos that came over (found here or uploaded), the tag, the project, the link
    const [entries] = bodies(s, '/api/import/entries');
    expect((entries.entries as { id: string }[]).map((e) => e.id)).toEqual([EN.one, EN.two]);
    expect(entries.entries[0]).toMatchObject({
      title: '西湖',
      body: `接着看[下一篇](${HERE}/entries/${hereId(EN.two)})`,
      visibility: 'public',
      media: [
        { photoId: hereId(PH.a), caption: '湖边' },
        { photoId: PH_HERE, caption: null }
      ],
      tagIds: [hereId(T.child)],
      projectIds: [hereId(PJ)]
    });

    const [collections] = bodies(s, '/api/import/collections');
    expect(collections.collections[0]).toMatchObject({
      id: TH,
      coverPhotoId: hereId(PH.a),
      items: [
        { kind: 'photo', photoId: hereId(PH.a) },
        { kind: 'entry', entryId: hereId(EN.one) }
      ]
    });

    expect(outcome).toEqual({
      created: { photos: 2, entries: 2, projects: 1, collections: 1, tags: 2, places: 1, zones: 1 },
      existing: { photos: 1, entries: 0, projects: 0, collections: 0, zones: 0 },
      failed: [],
      noFile: 1,
      notPicked: 1,
      zonesFull: 0,
      shareLinks: 1
    });
  });

  it('makes everything private when asked to', async () => {
    const s = server();
    const { up } = await go(exported(everything(), [PH.d], notPicked), { privateAll: true });
    expect(up.forms).toHaveLength(3);
    expect(up.forms.map((f) => metaOf(f).visibility)).toEqual(['private', 'private', 'private']);
    for (const path of ['/api/import/projects', '/api/import/entries', '/api/import/collections']) {
      const [body] = bodies(s, path);
      expect(Object.values(body)[0].map((r) => (r as { visibility: string }).visibility)).toEqual(
        Object.values(body)[0].map(() => 'private')
      );
    }
  });

  it('counts what is here already as such, the second time', async () => {
    const s = server();
    s.photos.set(sha(1), id('ph', 91));
    s.photos.set(sha(2), PH_HERE);
    for (const x of [EN.one, EN.two, PJ, TH]) s.existing.add(x);
    const { outcome, up } = await go(
      exported(everything({ photos: [exportPhoto(PH.a, { sha256: sha(1) }), exportPhoto(PH.b, { sha256: sha(2) })] }))
    );
    expect(up.forms).toHaveLength(0);
    expect(outcome.created).toMatchObject({ photos: 0, entries: 0, projects: 0, collections: 0 });
    expect(outcome.existing).toMatchObject({ photos: 2, entries: 2, projects: 1, collections: 1 });
    const [entries] = bodies(s, '/api/import/entries');
    expect(entries.entries[0]).toMatchObject({ id: EN.one, media: [{ photoId: id('ph', 91) }, { photoId: PH_HERE }], projectIds: [PJ] });
  });

  it('takes the ids the Worker answers with, over those it said beforehand', async () => {
    const s = server();
    // the entry was brought meanwhile under another id
    s.renamed.set(EN.one, id('en', 77));
    await go(exported(everything(), [PH.d], notPicked));
    const [collections] = bodies(s, '/api/import/collections');
    expect(collections.collections[0]).toMatchObject({ items: [{ kind: 'photo' }, { kind: 'entry', entryId: id('en', 77) }] });
  });

  it('sends tags over several batches parents first, a child in a later batch with its parent’s id here', async () => {
    const s = server();
    const roots = Array.from({ length: IMPORT_LIMITS.tags - 1 }, (_, i) => ({ id: id('t', i + 10), name: `根 ${i}`, parentId: null }));
    const child = { id: id('t', 2), name: '子', parentId: roots[0].id };
    const grandchild = { id: id('t', 3), name: '孙', parentId: child.id };
    const { outcome } = await go(source(living({ tags: [grandchild, child, ...roots] })));
    const sent = bodies(s, '/api/import/tags').map((b) => b.tags as { id: string; parentId: string | null }[]);
    expect(sent.map((b) => b.length)).toEqual([IMPORT_LIMITS.tags, 1]);
    expect(sent[0].slice(0, -1).every((t) => t.parentId === null)).toBe(true);
    expect(sent[0].at(-1)).toMatchObject({ id: child.id, parentId: roots[0].id });
    expect(sent[1]).toEqual([{ ...grandchild, parentId: hereId(child.id) }]);
    expect(outcome.created.tags).toBe(IMPORT_LIMITS.tags + 1);
  });

  it('takes a photo the Worker has already as that one, tries a failed upload again, and lists the ones it could not bring', async () => {
    const s = server();
    const ids = [id('ph', 11), id('ph', 12), id('ph', 13), id('ph', 14), id('ph', 15)];
    const [dup, flaky, refused, broken, unreadable] = ids;
    const photos = ids.map((x, i) => exportPhoto(x, { uploadedAt: `2026-11-16T0${i}:00:00Z` }));
    const data = exportData({
      photos,
      entries: [exportEntry(EN.one)],
      entryMedia: ids.map((photoId, position) => ({ entryId: EN.one, photoId, position, caption: null }))
    });
    const src = exported(data);
    const path = (x: string) => mediaPath(photos[ids.indexOf(x)], 'x.jpg');
    src.files.set(path(unreadable), {
      size: 10,
      read: async () => {
        throw new Error('NotReadableError');
      }
    });
    const up = uploads({
      [dup]: [{ ok: false, status: 409, code: 'duplicate', message: '这张照片已经上传过了', photoId: id('ph', 90) }],
      [flaky]: [{ ok: false, status: 0, code: 'network', message: '网络中断，请检查网络后重试' }],
      [refused]: [{ ok: false, status: 400, code: 'invalid_input', message: '原图需要是图片文件' }]
    });
    const { outcome, stopped, slept } = await go(src, {
      send: up.send,
      resize: async (file) => {
        if (file.name.includes(broken)) throw new Error('无法解码这张图片（文件可能已损坏或格式不受支持）');
        return PROCESSED;
      }
    });
    expect(stopped).toBeNull();
    expect(up.ids()).toEqual([dup, flaky, flaky, refused]);
    expect(slept).toEqual([RETRY_WAIT[0]]);
    expect(outcome.created.photos).toBe(1);
    expect(outcome.existing.photos).toBe(1);
    expect(outcome.failed).toEqual([
      { kind: 'photo', label: `2026-11-16_${refused}.jpg`, message: '原图需要是图片文件' },
      { kind: 'photo', label: `2026-11-16_${broken}.jpg`, message: '无法解码这张图片（文件可能已损坏或格式不受支持）' },
      { kind: 'photo', label: `2026-11-16_${unreadable}.jpg`, message: '读不出这张照片的文件' }
    ]);
    const [entries] = bodies(s, '/api/import/entries');
    expect(entries.entries[0]).toMatchObject({ media: [{ photoId: id('ph', 90) }, { photoId: hereId(flaky) }] });
  });

  it('gives up on an upload that keeps failing on the way, and goes on with the rest', async () => {
    server();
    const data = exportData({ photos: [exportPhoto(PH.a), exportPhoto(PH.b, { uploadedAt: '2026-11-17T00:00:00Z' })] });
    const down: PublishResult = { ok: false, status: 502, code: 'upstream', message: '存储服务暂时不可用，请稍后重试' };
    const up = uploads({ [PH.a]: [down, down, down, down] });
    const { outcome, slept } = await go(exported(data), { send: up.send });
    expect(up.ids()).toEqual([PH.a, PH.a, PH.a, PH.a, PH.b]);
    expect(slept).toEqual(RETRY_WAIT);
    expect(outcome.failed).toEqual([{ kind: 'photo', label: `2026-11-16_${PH.a}.jpg`, message: '存储服务暂时不可用，请稍后重试' }]);
    expect(outcome.created.photos).toBe(1);
  });

  it('lists the rows the Worker would not take by their titles, an untitled entry by its day', async () => {
    const s = server();
    s.failed.set(PJ, '项目的开始日期不对');
    s.failed.set(EN.one, '正文太长');
    s.failed.set(EN.two, '缺少照片');
    s.failed.set(TH, '合集的结束日期早于开始日期');
    const { outcome, stopped } = await go(exported(everything(), [PH.d], notPicked));
    expect(stopped).toBeNull();
    expect(outcome.failed).toEqual([
      { kind: 'project', label: '学吉他', message: '项目的开始日期不对' },
      { kind: 'entry', label: '西湖', message: '正文太长' },
      { kind: 'entry', label: '2026-11-17', message: '缺少照片' },
      { kind: 'collection', label: '杭州', message: '合集的结束日期早于开始日期' }
    ]);
    expect(outcome.created).toMatchObject({ projects: 0, entries: 0, collections: 0 });
  });

  it('tries a batch again when it fails on the way, and stops on one the Worker refuses', async () => {
    const s = server();
    s.next.set('/api/import/places', [new TypeError('Failed to fetch'), refuse(503, 'upstream', '暂时不可用')]);
    s.next.set('/api/import/zones', [refuse(400, 'invalid_input', '隐私区域的半径不对')]);
    const { stopped, slept, outcome } = await go(exported(everything(), [PH.d], notPicked));
    expect(slept).toEqual([RETRY_WAIT[0], RETRY_WAIT[1]]);
    expect(stopped).toBe('隐私区域的半径不对。再导入一次，已经导入的会跳过。');
    expect(s.calls.map((c) => c.path).filter((p) => p === '/api/import/places')).toHaveLength(3);
    expect(s.calls.at(-1)?.path).toBe('/api/import/zones');
    expect(outcome.created).toMatchObject({ tags: 2, places: 1, zones: 0, photos: 0 });
  });

  it('stops when the network stays down', async () => {
    const s = server();
    s.next.set(
      '/api/import/tags',
      Array.from({ length: 4 }, () => new TypeError('Failed to fetch'))
    );
    const { stopped, slept } = await go(exported(everything(), [PH.d], notPicked));
    expect(stopped).toBe('网络中断了。再导入一次，已经导入的会跳过。');
    expect(slept).toEqual(RETRY_WAIT);
    expect(s.calls.filter((c) => c.path === '/api/import/tags')).toHaveLength(4);
  });

  it('stops at a lost session, saying what it brought by then', async () => {
    const s = server();
    s.next.set('/api/import/entries', [refuse(401, 'unauthenticated', '请先登录')]);
    const { stopped, outcome, slept } = await go(exported(everything(), [PH.d], notPicked));
    expect(stopped).toBe('登录已经失效。重新登录后再导入一次，已经导入的会跳过。');
    expect(slept).toEqual([]);
    expect(outcome.created).toMatchObject({ photos: 3, projects: 1, entries: 0, collections: 0 });
    expect(s.calls.some((c) => c.path === '/api/import/collections')).toBe(false);
  });

  it('stops at a lost session while uploading, sending no more photos and no rows', async () => {
    const s = server();
    const up = uploads({ [PH.c]: [{ ok: false, status: 401, code: 'unauthenticated', message: '登录已过期，请重新登录后再发布' }] });
    const { stopped, outcome } = await go(exported(everything(), [PH.d], notPicked), { send: up.send });
    expect(stopped).toBe('登录已经失效。重新登录后再导入一次，已经导入的会跳过。');
    expect(up.ids()).toEqual([PH.c]);
    expect(outcome.created.photos).toBe(0);
    expect(s.calls.some((c) => c.path === '/api/import/projects')).toBe(false);
  });

  it('stops when the day’s database allowance is used up, without trying again', async () => {
    const quota = '今天的数据库额度已经用完，要到协调世界时 0 点（北京时间 8 点）以后才能继续';
    const s = server();
    s.next.set('/api/import/projects', [refuse(503, 'quota_exceeded', quota)]);
    const first = await go(exported(everything(), [PH.d], notPicked));
    expect(first.stopped).toBe(`${quota}。到时候再导入一次，已经导入的会跳过。`);
    expect(first.slept).toEqual([]);
    expect(s.calls.some((c) => c.path === '/api/import/entries')).toBe(false);

    server();
    const up = uploads({ [PH.c]: [{ ok: false, status: 503, code: 'quota_exceeded', message: quota }] });
    const second = await go(exported(everything(), [PH.d], notPicked), { send: up.send });
    expect(second.stopped).toBe(`${quota}。到时候再导入一次，已经导入的会跳过。`);
    expect(up.ids()).toEqual([PH.c]);
    expect(second.slept).toEqual([]);
  });

  it('stops where it is when cancelled, while a photo is processed', async () => {
    const s = server();
    const ctl = new AbortController();
    const src = exported(everything(), [PH.d], notPicked);
    const plan = await planImport(src, ctl.signal);
    const up = uploads();
    const err = await runImport({
      plan,
      source: src,
      privateAll: false,
      origin: HERE,
      signal: ctl.signal,
      resize: async () => {
        ctl.abort();
        return PROCESSED;
      },
      send: up.send,
      parallel: 1
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportStopped);
    expect((err as ImportStopped).message).toBe('已取消');
    expect(up.forms).toHaveLength(0);
    expect(s.calls.some((c) => c.path === '/api/import/projects')).toBe(false);
  });

  it('stops where it is when cancelled, while a batch is on its way', async () => {
    const s = server();
    s.next.set('/api/import/places', [hang]);
    const ctl = new AbortController();
    const src = exported(everything(), [PH.d], notPicked);
    const plan = await planImport(src, ctl.signal);
    const running = runImport({
      plan,
      source: src,
      privateAll: false,
      origin: HERE,
      signal: ctl.signal,
      resize: async () => PROCESSED,
      send: uploads().send,
      sleep: async () => {}
    });
    await vi.waitFor(() => expect(s.calls.at(-1)?.path).toBe('/api/import/places'));
    ctl.abort();
    const err = await running.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportStopped);
    expect((err as ImportStopped).message).toBe('已取消');
    expect((err as ImportStopped).outcome.created.tags).toBe(2);
    expect(s.calls.at(-1)?.path).toBe('/api/import/places');
  });

  it('keeps several photos in flight when asked to', async () => {
    server();
    const ids = Array.from({ length: 6 }, (_, i) => id('ph', 20 + i));
    const data = exportData({ photos: ids.map((x) => exportPhoto(x)) });
    let inFlight = 0;
    let most = 0;
    const { outcome } = await go(exported(data), {
      parallel: 3,
      resize: async () => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return PROCESSED;
      }
    });
    expect(most).toBe(3);
    expect(outcome.created.photos).toBe(6);
  });
});

describe('typeOf', () => {
  it('types a file read out of a ZIP by its name', () => {
    expect(typeOf('IMG_0001.HEIC')).toBe('image/heic');
    expect(typeOf('2026-11-16_ph_1.jpeg')).toBe('image/jpeg');
    expect(typeOf('a.tif')).toBe('image/tiff');
    expect(typeOf('a.dng')).toBe('');
    expect(typeOf('noext')).toBe('');
  });
});
