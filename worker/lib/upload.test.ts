import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { fakeD1, type DbCall } from '../test-utils';
import { HttpError } from './http';
import { MAX_REQUEST_BYTES, parseCreateMeta } from './photoInput';
import type { PoiRow } from './poi';
import {
  parseUploadForm,
  photoRecord,
  photoStatements,
  readUploadForm,
  resolveUpload,
  savePhoto,
  storeFiles,
  uploadFiles,
  type Upload,
  type UploadForm,
  type UploadRefs
} from './upload';

// The steps of POST /api/photos. The whole request against real D1 and R2 is in routes/photos.routes.test.ts.

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const SHA = 'ab'.repeat(32);

const metaJson = (extra: Record<string, unknown> = {}) => ({
  width: 3000,
  height: 2000,
  variantSizes: { s: [480, 320], m: [1600, 1067], l: [2560, 1707] },
  ...extra
});

/** A valid upload form; `parts` override files (`null` leaves one out), a `null` meta leaves the meta out. */
function form(meta: unknown = metaJson(), parts: Partial<Record<'original' | 's' | 'm' | 'l', Blob | null>> = {}): FormData {
  const f = new FormData();
  if (meta !== null) f.set('meta', typeof meta === 'string' ? meta : JSON.stringify(meta));
  const all = {
    original: new File([JPEG], 'IMG_0001.jpg', { type: 'image/jpeg' }),
    s: new File([WEBP], 's.webp', { type: 'image/webp' }),
    m: new File([WEBP], 'm.webp', { type: 'image/webp' }),
    l: new File([JPEG], 'l.jpg', { type: 'image/jpeg' }),
    ...parts
  };
  for (const [name, blob] of Object.entries(all)) if (blob) f.set(name, blob);
  return f;
}

/** The status, message and extra fields of the HttpError `promise` rejects with. */
async function failure(promise: Promise<unknown>): Promise<[number, string, Record<string, unknown>?]> {
  try {
    await promise;
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return Object.keys(e.extra).length ? [e.status, e.message, e.extra] : [e.status, e.message];
  }
  throw new Error('expected the promise to reject');
}

const poiRow = (over: Partial<PoiRow> = {}): PoiRow => ({
  id: 'poi_1',
  name: '断桥',
  aliases: null,
  category: '桥',
  city: '杭州市',
  district: '西湖区',
  lat: 30.2593,
  lng: 120.1516,
  radius: 60,
  source: 'custom',
  source_id: null,
  created_by: 'u_1',
  created_at: '2026-01-01T00:00:00Z',
  ...over
});

const refs = (over: Partial<UploadRefs> = {}): UploadRefs => ({
  poi: null,
  geoPrivacy: 'exact',
  manualTags: [],
  suggestedTags: [],
  themeIds: [],
  ...over
});

async function makeUpload(meta: Record<string, unknown> = {}, r: Partial<UploadRefs> = {}): Promise<Upload> {
  const parsed = await parseUploadForm(form(metaJson(meta)));
  return { photoId: 'ph_1', ownerId: 'u_1', form: parsed, refs: refs(r), files: uploadFiles('u_1', 'ph_1', parsed) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- form -----------------------------------------------------------------------------------------------------

describe('parseUploadForm', () => {
  it('returns the parsed meta and each file with the type and extension it is stored under', async () => {
    const f = form(metaJson({ title: '断桥' }));
    const parsed = await parseUploadForm(f);
    expect(parsed.meta).toEqual(parseCreateMeta(metaJson({ title: '断桥' })));
    expect(parsed.original).toEqual({ file: f.get('original'), ext: 'jpg', type: 'image/jpeg' });
    expect(parsed.variants.s).toEqual({ file: f.get('s'), ext: 'webp', type: 'image/webp' });
    expect(parsed.variants.m).toMatchObject({ ext: 'webp', type: 'image/webp' });
    expect(parsed.variants.l).toMatchObject({ ext: 'jpg', type: 'image/jpeg' });
  });

  it('accepts the meta as a file part too', async () => {
    const f = form(null);
    f.set('meta', new File([JSON.stringify(metaJson({ title: 'x' }))], 'meta.json', { type: 'application/json' }));
    expect((await parseUploadForm(f)).meta.title).toBe('x');
  });

  it('checks the meta first', async () => {
    expect(await failure(parseUploadForm(form(null, { original: null })))).toEqual([400, '缺少 meta（JSON）']);
    expect(await failure(parseUploadForm(form('{nope')))).toEqual([400, 'meta 不是有效的 JSON']);
    expect(await failure(parseUploadForm(form(`"${'x'.repeat(200_001)}"`)))).toEqual([413, 'meta 太大']);
    expect(await failure(parseUploadForm(form([])))).toEqual([400, 'meta 需要是一个 JSON 对象']);
  });

  it('then the original', async () => {
    expect(await failure(parseUploadForm(form(metaJson(), { original: null, s: null })))).toEqual([400, '缺少原图（original）']);
    expect(await failure(parseUploadForm(form(metaJson(), { original: new File([], 'a.jpg', { type: 'image/jpeg' }) })))).toEqual([
      400,
      '缺少原图（original）'
    ]);
    const [status] = await failure(parseUploadForm(form(metaJson(), { original: new File([JPEG], 'notes.txt', { type: 'text/plain' }) })));
    expect(status).toBe(400);
  });

  it('then the sizes, in the order s, m, l', async () => {
    expect(await failure(parseUploadForm(form(metaJson(), { m: null, l: null })))).toEqual([400, '缺少尺寸图「m」']);
    expect(await failure(parseUploadForm(form(metaJson(), { s: new File([JPEG], 's.webp', { type: 'image/webp' }), l: null })))).toEqual([
      400,
      '尺寸图「s」的内容和它声明的格式不一致'
    ]);
    expect(await failure(parseUploadForm(form(metaJson(), { l: new File([JPEG], 'l.png', { type: 'image/png' }) })))).toEqual([
      400,
      '尺寸图「l」需要是 image/webp 或 image/jpeg'
    ]);
  });
});

describe('readUploadForm', () => {
  const request = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request('https://living.test/api/photos', { method: 'POST', body, headers });

  it('reads a multipart request', async () => {
    const parsed = await readUploadForm(request(form(metaJson({ title: '孤山' }))));
    expect(parsed.meta.title).toBe('孤山');
  });

  it('refuses a request that says it is too large before reading it', async () => {
    const req = request(form(), { 'content-length': String(MAX_REQUEST_BYTES + 1) });
    const read = vi.spyOn(req, 'formData');
    expect(await failure(readUploadForm(req))).toEqual([413, '上传内容太大：原图不能超过 50 MB']);
    expect(read).not.toHaveBeenCalled();
  });

  it('needs multipart/form-data that can be parsed', async () => {
    expect(await failure(readUploadForm(request('{}', { 'content-type': 'application/json' })))).toEqual([
      400,
      '上传需要使用 multipart/form-data'
    ]);
    expect(await failure(readUploadForm(request('garbage', { 'content-type': 'multipart/form-data; boundary=x' })))).toEqual([
      400,
      '无法解析上传内容，请重试'
    ]);
  });
});

// ---- lookups --------------------------------------------------------------------------------------------------

describe('resolveUpload', () => {
  const meta = (extra: Record<string, unknown> = {}) => parseCreateMeta(metaJson(extra));

  /** A D1 with one duplicate, one place, a privacy zone around (31, 121), presets bridge/lake and the theme th_mine. */
  const db = () =>
    fakeD1((call: DbCall) => {
      if (call.sql.startsWith('SELECT id FROM photos')) return call.params[1] === SHA ? { id: 'ph_old' } : null;
      if (call.sql.includes('FROM pois')) return call.params[0] === 'poi_1' ? poiRow() : null;
      if (call.sql.includes('FROM privacy_zones')) return [{ id: 'pz_1', name: '家', lat: 31, lng: 121, radius: 500 }];
      if (call.sql.includes('FROM tags'))
        return (JSON.parse(call.params[0] as string) as string[]).filter((id) => ['bridge', 'lake'].includes(id)).map((id) => ({ id }));
      if (call.sql.includes('FROM themes'))
        return (JSON.parse(call.params[1] as string) as string[]).filter((id) => id === 'th_mine').map((id) => ({ id }));
      return null;
    });

  it('answers 409 with the existing photo for the same bytes, before anything else', async () => {
    const d = db();
    expect(await failure(resolveUpload(d.db, 'u_1', meta({ sha256: SHA, poiId: 'poi_none' })))).toEqual([
      409,
      '这张照片已经上传过了',
      { photoId: 'ph_old' }
    ]);
    expect(d.calls).toHaveLength(1);
  });

  it('refuses a poiId that does not exist', async () => {
    expect(await failure(resolveUpload(db().db, 'u_1', meta({ poiId: 'poi_none' })))).toEqual([400, '所选地点不存在']);
  });

  it('finds the place, keeps usable tags (manual ones win) and the uploader’s own themes', async () => {
    const r = await resolveUpload(
      db().db,
      'u_1',
      meta({
        sha256: 'cd'.repeat(32),
        poiId: 'poi_1',
        tagIds: ['bridge', 'other'],
        suggestedTagIds: ['lake', 'bridge'],
        themeIds: ['th_mine', 'th_bobs']
      })
    );
    expect(r).toEqual({ poi: poiRow(), geoPrivacy: 'exact', manualTags: ['bridge'], suggestedTags: ['lake'], themeIds: ['th_mine'] });
  });

  it('hides the position of a photo taken inside a privacy zone, and keeps the requested precision elsewhere', async () => {
    expect((await resolveUpload(db().db, 'u_1', meta({ lat: 31.0001, lng: 121.0001, geoPrivacy: 'exact' }))).geoPrivacy).toBe('hidden');
    expect((await resolveUpload(db().db, 'u_1', meta({ lat: 30, lng: 120, geoPrivacy: 'fuzzy' }))).geoPrivacy).toBe('fuzzy');
  });

  it('asks D1 nothing it does not need: no duplicate check without a hash, no zone check without a point, no empty lists', async () => {
    const d = db();
    expect(await resolveUpload(d.db, 'u_1', meta())).toEqual(refs());
    expect(d.calls).toEqual([]);
  });
});

// ---- storage --------------------------------------------------------------------------------------------------

describe('uploadFiles', () => {
  it('keeps the original under its owner and the public sizes under the photo, with their pixel sizes', async () => {
    const parsed: UploadForm = await parseUploadForm(form());
    const files = uploadFiles('u_1', 'ph_1', parsed);
    expect(files.originalKey).toBe('o/u_1/ph_1.jpg');
    expect(files.variants).toEqual({
      s: { key: 'v/ph_1/s.webp', w: 480, h: 320 },
      m: { key: 'v/ph_1/m.webp', w: 1600, h: 1067 },
      l: { key: 'v/ph_1/l.jpg', w: 2560, h: 1707 }
    });
    expect(files.objects).toEqual([
      { key: 'o/u_1/ph_1.jpg', body: parsed.original.file, contentType: 'image/jpeg' },
      { key: 'v/ph_1/s.webp', body: parsed.variants.s.file, contentType: 'image/webp' },
      { key: 'v/ph_1/m.webp', body: parsed.variants.m.file, contentType: 'image/webp' },
      { key: 'v/ph_1/l.jpg', body: parsed.variants.l.file, contentType: 'image/jpeg' }
    ]);
  });
});

describe('storeFiles', () => {
  const bucket = (failKey?: string) => {
    const put = vi.fn(async (key: string, _body: Blob, _options: R2PutOptions) => {
      if (key === failKey) throw new Error('R2 is down');
      return null;
    });
    const del = vi.fn(async (_keys: string | string[]) => {});
    return { bucket: { put, delete: del } as unknown as R2Bucket, put, del };
  };

  it('puts all four files with their content type and owner', async () => {
    const b = bucket();
    await storeFiles(b.bucket, await makeUpload());
    expect(b.put.mock.calls.map(([key, , options]) => [key, options])).toEqual(
      ['o/u_1/ph_1.jpg', 'v/ph_1/s.webp', 'v/ph_1/m.webp', 'v/ph_1/l.jpg'].map((key) => [
        key,
        {
          httpMetadata: { contentType: key.endsWith('webp') ? 'image/webp' : 'image/jpeg' },
          customMetadata: { ownerId: 'u_1', photoId: 'ph_1' }
        }
      ])
    );
    expect(b.del).not.toHaveBeenCalled();
  });

  it('deletes every key again and answers 502 when one put fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = bucket('v/ph_1/m.webp');
    expect(await failure(storeFiles(b.bucket, await makeUpload()))).toEqual([502, '图片存储暂时不可用，请稍后重试']);
    expect(b.del).toHaveBeenCalledWith(['o/u_1/ph_1.jpg', 'v/ph_1/s.webp', 'v/ph_1/m.webp', 'v/ph_1/l.jpg']);
  });
});

// ---- rows -----------------------------------------------------------------------------------------------------

describe('photoRecord', () => {
  const NOW = '2026-11-10T08:00:00Z';

  it('maps every field of the upload to its column', async () => {
    const u = await makeUpload(
      {
        title: '断桥',
        note: '早上',
        takenAt: '2026-04-03T07:15:00',
        tz: '+08:00',
        lat: 30.2588,
        lng: 120.1512,
        alt: 8,
        heading: 270,
        province: '浙江省',
        city: '杭州市',
        district: '西湖区',
        camera: 'X100V',
        lens: '23mm',
        focal: 23,
        focal35: 35,
        aperture: 2,
        shutter: '1/250',
        iso: 160,
        thumbhash: 'abc',
        palette: ['#112233'],
        focus: [0.3, 0.6],
        visibility: 'unlisted',
        inLiving: false,
        favorite: true,
        sha256: SHA
      },
      { geoPrivacy: 'hidden' }
    );
    expect(photoRecord(u, null, NOW)).toEqual({
      id: 'ph_1',
      owner_id: 'u_1',
      title: '断桥',
      note: '早上',
      taken_at: '2026-04-03T07:15:00',
      tz: '+08:00',
      lat: 30.2588,
      lng: 120.1512,
      alt: 8,
      heading: 270,
      geo_privacy: 'hidden',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      poi_id: null,
      poi_distance: null,
      poi_method: null,
      camera: 'X100V',
      lens: '23mm',
      focal: 23,
      focal35: 35,
      aperture: 2,
      shutter: '1/250',
      iso: 160,
      width: 3000,
      height: 2000,
      file_key: 'o/u_1/ph_1.jpg',
      file_type: 'image/jpeg',
      file_size: JPEG.length,
      variants: JSON.stringify(u.files.variants),
      thumbhash: 'abc',
      palette: '["#112233"]',
      focus_x: 0.3,
      focus_y: 0.6,
      visibility: 'unlisted',
      in_living: false,
      favorite: true,
      sha256: SHA,
      uploaded_at: NOW
    });
  });

  it('computes the distance to the place itself when the photo has a point, and defaults the method to manual', async () => {
    const u = await makeUpload({ lat: 30.2588, lng: 120.1512, poiDistance: 999 });
    expect(photoRecord(u, poiRow(), NOW)).toMatchObject({ poi_id: 'poi_1', poi_distance: 67.6, poi_method: 'manual' });
  });

  it('keeps the client’s distance and method when the photo has no point', async () => {
    const u = await makeUpload({ poiDistance: 42, poiMethod: 'confirmed' });
    expect(photoRecord(u, poiRow(), NOW)).toMatchObject({ poi_id: 'poi_1', poi_distance: 42, poi_method: 'confirmed' });
  });

  it('drops distance and method without a place', async () => {
    const u = await makeUpload({ poiDistance: 42, poiMethod: 'confirmed' });
    expect(photoRecord(u, null, NOW)).toMatchObject({ poi_id: null, poi_distance: null, poi_method: null, palette: null, focus_x: null });
  });
});

/** A D1 that records `prepare(sql).bind(...params)`; `batch` and `run` are given per test. */
function recordingDb(over: { batch?: (s: unknown[]) => Promise<unknown>; run?: () => Promise<unknown>; dup?: string | null } = {}) {
  const batch = vi.fn(over.batch ?? (async () => []));
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        sql,
        params,
        first: async () => (sql.startsWith('SELECT id FROM photos') && over.dup ? { id: over.dup } : null),
        run: over.run ?? (async () => ({ success: true }))
      })
    }),
    batch
  } as unknown as D1Database;
  return { db, batch };
}

describe('photoStatements', () => {
  it('inserts the photo by column name, then its tags, then an item at the end of each theme', async () => {
    const u = await makeUpload({}, { manualTags: ['bridge'], suggestedTags: ['lake'], themeIds: ['th_a', 'th_b'] });
    const list = photoStatements(recordingDb().db, u, null, 'NOW') as unknown as { sql: string; params: unknown[] }[];
    const record = photoRecord(u, null, 'NOW');
    expect(list[0].sql).toBe(
      `INSERT INTO photos (${Object.keys(record).join(', ')}) VALUES (${Object.keys(record)
        .map((_, i) => `?${i + 1}`)
        .join(', ')})`
    );
    expect(list[0].params[Object.keys(record).indexOf('in_living')]).toBe(1);
    expect(list.slice(1, 3)).toEqual([
      {
        sql: expect.stringContaining(`'manual' FROM json_each(?2)`),
        params: ['ph_1', '["bridge"]'],
        first: expect.any(Function),
        run: expect.any(Function)
      },
      {
        sql: expect.stringContaining(`'suggested' FROM json_each(?2)`),
        params: ['ph_1', '["lake"]'],
        first: expect.any(Function),
        run: expect.any(Function)
      }
    ]);
    const themes = list.slice(3);
    expect(themes.map((s) => [s.sql.trim().split(/\s+/).slice(0, 3).join(' '), s.params.slice(1)])).toEqual([
      ['INSERT INTO theme_items', ['th_a', 'ph_1']],
      ['UPDATE themes SET', ['th_a']],
      ['INSERT INTO theme_items', ['th_b', 'ph_1']],
      ['UPDATE themes SET', ['th_b']]
    ]);
  });

  it('is just the photo row when there are no tags or themes', async () => {
    expect(photoStatements(recordingDb().db, await makeUpload(), null, 'NOW')).toHaveLength(1);
  });
});

describe('savePhoto', () => {
  const media = () => {
    const del = vi.fn(async (_keys: string[]) => {});
    return { bucket: { delete: del } as unknown as R2Bucket, del };
  };
  const KEYS = ['o/u_1/ph_1.jpg', 'v/ph_1/s.webp', 'v/ph_1/m.webp', 'v/ph_1/l.jpg'];

  it('writes everything in one batch and leaves the files alone', async () => {
    const d = recordingDb();
    const m = media();
    await savePhoto(d.db, m.bucket, await makeUpload({}, { manualTags: ['bridge'] }));
    expect(d.batch).toHaveBeenCalledTimes(1);
    expect(d.batch.mock.calls[0][0]).toHaveLength(2);
    expect(m.del).not.toHaveBeenCalled();
  });

  it('deletes the files and passes the error on when the batch fails', async () => {
    const d = recordingDb({ batch: () => Promise.reject(new Error('D1 is down')) });
    const m = media();
    await expect(savePhoto(d.db, m.bucket, await makeUpload({ sha256: SHA }))).rejects.toThrow('D1 is down');
    expect(m.del).toHaveBeenCalledWith(KEYS);
  });

  it('answers 409 with the winner when an identical upload got in first', async () => {
    const d = recordingDb({
      batch: () => Promise.reject(new Error('UNIQUE constraint failed: photos.owner_id, photos.sha256')),
      dup: 'ph_won'
    });
    const m = media();
    expect(await failure(savePhoto(d.db, m.bucket, await makeUpload({ sha256: SHA })))).toEqual([
      409,
      '这张照片已经上传过了',
      { photoId: 'ph_won' }
    ]);
    expect(m.del).toHaveBeenCalledWith(KEYS);
  });

  it('passes a unique-constraint error on when no photo with the same bytes turns up', async () => {
    const d = recordingDb({ batch: () => Promise.reject(new Error('UNIQUE constraint failed: photos.id')) });
    await expect(savePhoto(d.db, media().bucket, await makeUpload({ sha256: SHA }))).rejects.toThrow('photos.id');
    const noHash = recordingDb({ batch: () => Promise.reject(new Error('UNIQUE constraint failed: photos.id')), dup: 'ph_won' });
    await expect(savePhoto(noHash.db, media().bucket, await makeUpload())).rejects.toThrow('photos.id');
  });

  it('deletes the files when the new place cannot be created, before any batch', async () => {
    const d = recordingDb({ run: () => Promise.reject(new Error('D1 is down')) });
    const m = media();
    const u = await makeUpload({ newPoi: { name: '新亭', category: '亭', lat: 30, lng: 120 } });
    await expect(savePhoto(d.db, m.bucket, u)).rejects.toThrow('D1 is down');
    expect(d.batch).not.toHaveBeenCalled();
    expect(m.del).toHaveBeenCalledWith(KEYS);
  });
});
