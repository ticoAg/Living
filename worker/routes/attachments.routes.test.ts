// Attachments against real D1 and R2: docs/api/attachments.md, the attachments of docs/api/entries.md and the
// `/media/a/` paragraphs of docs/api/media.md. A file goes up in parts, is its author's alone until an entry holds it,
// and is then played or downloaded by whoever may open that entry; loose ones are deleted by the hourly job.
// Expectations follow the documented rules, never the implementation.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { ATTACHMENT_LIMITS, ATTACHMENT_PART_BYTES } from '../../shared/limits';
import type { EntryDetail, EntryStatus, EntrySummary, OwnAttachment, ShareLink, Visibility } from '../../shared/types';
import { purgeLooseAttachments } from '../lib/attachments';
import {
  beginAttachment,
  Browser,
  bytesOf,
  Client,
  expectStatus,
  JPEG,
  newUser,
  putPart,
  putParts,
  uploadAttachment,
  usePlatform,
  WEBP,
  type Json
} from '../test-platform';

const platform = usePlatform();

let alice: Client;
let bob: Client;
let visitor: Client;
beforeEach(async () => {
  alice = await newUser(platform, 'alice', 'owner');
  bob = await newUser(platform, 'bob');
  visitor = new Client(platform);
});

const AT = '2026-11-16T08:30:00';
const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PART = ATTACHMENT_PART_BYTES;
const NO_STORE = 'private, no-store';
const EMPTY = '记录不能是空的：写点文字，或者加一张照片、一个附件';
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

const row = (id: string) => platform.env.DB.prepare('SELECT * FROM attachments WHERE id = ?1').bind(id).first<Json>();
const run = (sql: string, ...params: unknown[]) =>
  platform.env.DB.prepare(sql)
    .bind(...params)
    .run();
const stored = async (key: string) => (await platform.env.MEDIA.head(key)) !== null;

const entry = async (client: Client, body: Json = {}): Promise<EntryDetail> =>
  expectStatus(await client.post('/api/entries', { occurredAt: AT, ...body }), 201).entry;
const holding = (...list: OwnAttachment[]) => list.map((a) => ({ attachmentId: a.id }));
/** An attachment as an entry's detail shows it. */
const shown = (a: OwnAttachment, caption: string | null = null) => {
  const { state: _state, entryId: _entry, ...rest } = a;
  return { ...rest, caption };
};
const statusOf = async (viewer: Client, path: string, init: RequestInit = {}) => (await viewer.fetch(path, init)).status;
const bytesAt = async (res: Response) => new Uint8Array(await res.arrayBuffer());
const share = async (client: Client, kind: string, id: string): Promise<ShareLink> =>
  expectStatus(await client.post('/api/shares', { kind, id }), 201).share;
/** A video of alice's with its frame, in no entry yet. */
async function video(client: Client = alice, bytes = bytesOf(2000)): Promise<OwnAttachment> {
  const a = await uploadAttachment(client, bytes, {
    kind: 'video',
    name: '湖边.mp4',
    mime: 'video/mp4',
    duration: 12.5,
    width: 1920,
    height: 1080
  });
  return expectStatus(await poster(client, a.id, WEBP, 'image/webp'), 200).attachment;
}
const poster = async (client: Client, id: string, bytes: Uint8Array, type: string, headers: Record<string, string> = {}) => {
  const res = await client.fetch(`/api/attachments/${id}/poster`, {
    method: 'PUT',
    body: bytes,
    headers: { 'content-type': type, ...headers }
  });
  return { status: res.status, body: (await res.json()) as Json, headers: res.headers };
};

describe('POST /api/attachments', () => {
  it('needs a session', async () => {
    const res = await visitor.post('/api/attachments', { kind: 'audio', name: 'a.m4a', mime: 'audio/mp4', size: 10 });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthenticated');
  });

  it('begins an upload: the attachment, still uploading, and the parts it goes up in', async () => {
    const size = 2 * PART + 5;
    const res = await alice.post('/api/attachments', {
      kind: 'video',
      name: '湖边.MOV',
      mime: 'video/quicktime',
      size,
      duration: 12.5,
      width: 1920,
      height: 1080
    });
    const body = expectStatus(res, 201);
    expect(body).toEqual({
      attachment: {
        id: expect.stringMatching(new RegExp(`^at_${ULID}$`)),
        kind: 'video',
        name: '湖边.MOV',
        mime: 'video/quicktime',
        size,
        duration: 12.5,
        width: 1920,
        height: 1080,
        poster: false,
        createdAt: expect.stringMatching(UTC),
        state: 'uploading',
        entryId: null
      },
      partBytes: PART,
      parts: 3
    });
    const r = await row(body.attachment.id);
    expect(r).toMatchObject({ owner_id: alice.me.id, entry_id: null, uploaded_at: null, loose_since: body.attachment.createdAt });
    expect(r?.file_key).toBe(`a/${alice.me.id}/${body.attachment.id}.mov`);
    expect(r?.upload_id).toEqual(expect.any(String));
    // a file of one part, or exactly two
    expect((await beginAttachment(alice, { size: 1 })).parts).toBe(1);
    expect((await beginAttachment(alice, { size: PART })).parts).toBe(1);
    expect((await beginAttachment(alice, { size: 2 * PART })).parts).toBe(2);
  });

  it('takes the file’s name as given, less what could pass it off as another', async () => {
    const named = async (name: unknown) => alice.post('/api/attachments', { kind: 'file', name, mime: 'text/plain', size: 10 });
    const cases: [string, string][] = [
      [' 收据‮gpj.exe ', '收据gpj.exe'],
      ['a/b\\c.txt', 'a_b_c.txt'],
      ['tab\there\u0000.txt', 'tabhere.txt'],
      ['‏⁦右.txt', '右.txt'],
      ['字'.repeat(ATTACHMENT_LIMITS.nameMax), '字'.repeat(ATTACHMENT_LIMITS.nameMax)]
    ];
    for (const [given, kept] of cases) expect(expectStatus(await named(given), 201).attachment.name, given).toBe(kept);
    for (const bad of ['', '  ', '‮', 7, null]) {
      expect(expectStatus(await named(bad), 400).message, String(bad)).toBe('请填写文件名');
    }
    expect(expectStatus(await named('字'.repeat(ATTACHMENT_LIMITS.nameMax + 1)), 400).message).toBe(
      `文件名最多 ${ATTACHMENT_LIMITS.nameMax} 个字符`
    );
  });

  it('keeps the file’s type without its parameters; a video must be a video, a recording a recording', async () => {
    const typed = async (kind: string, mime: unknown) => alice.post('/api/attachments', { kind, name: 'x', mime, size: 10 });
    expect(expectStatus(await typed('audio', 'Audio/WebM; codecs=opus'), 201).attachment.mime).toBe('audio/webm');
    expect(expectStatus(await typed('file', ''), 201).attachment.mime).toBe('application/octet-stream');
    expect(expectStatus(await typed('file', 'application/vnd.ms-excel'), 201).attachment.mime).toBe('application/vnd.ms-excel');
    expect(expectStatus(await typed('video', 'audio/mp4'), 400).message).toBe('视频的类型需要是 video/…');
    expect(expectStatus(await typed('video', ''), 400).message).toBe('视频的类型需要是 video/…');
    expect(expectStatus(await typed('audio', 'video/mp4'), 400).message).toBe('录音的类型需要是 audio/…');
    for (const bad of ['mp4', 'video/', '/mp4', 'video/mp4 x', 'vídeo/mp4']) {
      expect(expectStatus(await typed('file', bad), 400).message, bad).toBe('文件类型的格式不对');
    }
    expect(expectStatus(await typed('file', undefined), 400).message).toBe('请填写文件类型');
    expect(expectStatus(await typed('image', 'image/png'), 400).error).toBe('invalid_input');
    expect(expectStatus(await alice.post('/api/attachments', { name: 'x', mime: 'audio/mp4', size: 10 }), 400).message).toBe(
      '请填写附件类型'
    );
  });

  it('takes files of a byte to 2 GB, a length for videos and recordings, and a size for videos alone', async () => {
    const sized = async (meta: Json) =>
      alice.post('/api/attachments', { kind: 'audio', name: 'x.m4a', mime: 'audio/mp4', size: 10, ...meta });
    expect(expectStatus(await sized({ size: 0 }), 400).message).toBe('文件是空的');
    for (const size of [-1, 1.5, '10']) expect((await sized({ size })).status, String(size)).toBe(400);
    expect(expectStatus(await sized({ size: undefined }), 400).message).toBe('请填写文件大小');
    expect(expectStatus(await sized({ size: ATTACHMENT_LIMITS.maxBytes }), 201).parts).toBe(ATTACHMENT_LIMITS.maxBytes / PART);
    const big = await sized({ size: ATTACHMENT_LIMITS.maxBytes + 1 });
    expect(big.status).toBe(413);
    expect(big.body).toEqual({ error: 'too_large', message: '一个附件最多 2 GB' });
    for (const duration of [-1, 7 * 86400 + 1, '3']) expect((await sized({ duration })).status, String(duration)).toBe(400);
    expect(expectStatus(await sized({ duration: 7 * 86400, width: 100, height: 100 }), 201).attachment).toMatchObject({
      duration: 7 * 86400,
      width: null,
      height: null
    });
    const file = await alice.post('/api/attachments', {
      kind: 'file',
      name: 'x.pdf',
      mime: 'application/pdf',
      size: 10,
      duration: 3,
      width: 9
    });
    expect(expectStatus(file, 201).attachment).toMatchObject({ duration: null, width: null, height: null });
    const clip = async (meta: Json) =>
      alice.post('/api/attachments', { kind: 'video', name: 'x.mp4', mime: 'video/mp4', size: 10, ...meta });
    for (const side of [0, 1.5, 100_001]) expect((await clip({ width: side })).status, String(side)).toBe(400);
  });

  it('lets one person have ten uploads under way at a time', async () => {
    const begun = [];
    for (let i = 0; i < ATTACHMENT_LIMITS.uploadingMax; i++) begun.push(await beginAttachment(alice));
    const res = await alice.post('/api/attachments', { kind: 'audio', name: 'x.m4a', mime: 'audio/mp4', size: 10 });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited', message: '同时在传的附件太多了，等前面的传完再试' });
    // someone else's uploads are theirs
    await beginAttachment(bob);
    // one that completes no longer counts
    const parts = await putParts(alice, begun[0], bytesOf(1000));
    expectStatus(await alice.post(`/api/attachments/${begun[0].attachment.id}/complete`, { parts }), 200);
    await beginAttachment(alice);
    expect((await alice.post('/api/attachments', { kind: 'audio', name: 'x.m4a', mime: 'audio/mp4', size: 10 })).status).toBe(429);
    // nor does one begun more than an hour ago
    await run('UPDATE attachments SET loose_since = ?1 WHERE id = ?2', iso(Date.now() - HOUR - 60_000), begun[1].attachment.id);
    await beginAttachment(alice);
    // nor one that was deleted
    expectStatus(await alice.del(`/api/attachments/${begun[2].attachment.id}`), 200);
    await beginAttachment(alice);
  });
});

describe('PUT /api/attachments/:id/parts/:n', () => {
  it('takes each part of one’s own upload, as long as it must be, in any order', async () => {
    const begun = await beginAttachment(alice, { size: PART + 10 });
    const id = begun.attachment.id;
    const last = expectStatus(await putPart(alice, id, 2, bytesOf(10)), 200);
    expect(last).toEqual({ partNumber: 2, etag: expect.any(String) });
    expect(expectStatus(await putPart(alice, id, 2, bytesOf(9)), 400).message).toBe('第 2 片应该是 10 字节');
    expect(expectStatus(await putPart(alice, id, 1, bytesOf(10)), 400).message).toBe(`第 1 片应该是 ${PART} 字节`);
    for (const n of [0, 3, -1])
      expect(expectStatus(await putPart(alice, id, n, bytesOf(10)), 400).message, String(n)).toBe('分片的序号需要是 1 到 2');
    expect((await putPart(alice, id, 1.5 as number, bytesOf(10))).status).toBe(400);
    const said = await putPart(alice, id, 2, bytesOf(10), { 'content-length': String(PART + 1) });
    expect(said.status).toBe(413);
    expect(said.body).toEqual({ error: 'too_large', message: '分片太大' });
    expect(expectStatus(await putPart(alice, id, 2, bytesOf(10), { 'content-length': '11' }), 400).message).toBe('第 2 片应该是 10 字节');
    // nobody else's
    expect(expectStatus(await putPart(bob, id, 2, bytesOf(10)), 404).message).toBe('附件不存在');
    expect((await putPart(visitor, id, 2, bytesOf(10))).status).toBe(401);
    expect((await putPart(alice, 'at_nope', 1, bytesOf(10))).status).toBe(404);
  });

  it('takes no part once the file is complete', async () => {
    const a = await uploadAttachment(alice, bytesOf(10));
    const res = await putPart(alice, a.id, 1, bytesOf(10));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'conflict', message: '附件已经传完了' });
  });
});

describe('POST /api/attachments/:id/complete', () => {
  it('puts the parts together: the file as it was, its attachment loose', async () => {
    const file = bytesOf(PART + 10);
    const begun = await beginAttachment(alice, { kind: 'file', name: '日志.txt', mime: 'text/plain', size: file.byteLength });
    const parts = await putParts(alice, begun, file);
    const res = await alice.post(`/api/attachments/${begun.attachment.id}/complete`, { parts: [...parts].reverse() });
    const done = expectStatus(res, 200).attachment as OwnAttachment;
    expect(done).toEqual({ ...begun.attachment, state: 'loose' });
    const r = await row(done.id);
    expect(r).toMatchObject({ upload_id: null, uploaded_at: expect.stringMatching(UTC), entry_id: null });
    expect(r?.loose_since).toBe(r?.uploaded_at);
    expect((await platform.env.MEDIA.head(r?.file_key as string))?.size).toBe(file.byteLength);
    const back = await alice.fetch(`/media/a/${done.id}`);
    expect(back.status).toBe(200);
    expect(Buffer.compare(await bytesAt(back), file)).toBe(0);
    // a range across two parts
    const across = await alice.fetch(`/media/a/${done.id}`, { headers: { range: `bytes=${PART - 2}-${PART + 1}` } });
    expect(across.status).toBe(206);
    expect([...(await bytesAt(across))]).toEqual([...file.subarray(PART - 2, PART + 2)]);
  });

  it('needs every part, once each, as the uploads answered', async () => {
    const begun = await beginAttachment(alice, { size: PART + 10 });
    const id = begun.attachment.id;
    const complete = (parts: unknown) => alice.post(`/api/attachments/${id}/complete`, { parts });
    const [one] = await putParts(alice, { ...begun, parts: 1 }, bytesOf(PART));
    // one never sent
    expect(expectStatus(await complete([one, { partNumber: 2, etag: one.etag }]), 400).message).toBe('分片不全，或者有的分片没有传上来');
    const two = expectStatus(await putPart(alice, id, 2, bytesOf(10)), 200);
    expect(expectStatus(await complete([one]), 400).message).toBe('需要全部 2 片');
    expect(expectStatus(await complete('x'), 400).message).toBe('需要全部 2 片');
    expect(expectStatus(await complete([one, one]), 400).message).toBe('需要第 1 到第 2 片，每片一次');
    expect(expectStatus(await complete([one, { ...two, partNumber: 3 }]), 400).message).toBe('需要第 1 到第 2 片，每片一次');
    for (const bad of [null, 'p', { ...two, etag: '' }, { ...two, etag: 'e'.repeat(201) }, { ...two, partNumber: '2' }]) {
      expect(expectStatus(await complete([one, bad]), 400).message, JSON.stringify(bad)).toBe('分片的格式不对');
    }
    expect(expectStatus(await complete([one, { ...two, etag: 'not-the-etag' }]), 400).message).toBe('分片不全，或者有的分片没有传上来');
    expect((await row(id))?.uploaded_at).toBeNull();
    expect(expectStatus(await complete([one, two]), 200).attachment.state).toBe('loose');
  });

  it('answers again as it did, when its answer was lost', async () => {
    const begun = await beginAttachment(alice, { size: 10 });
    const parts = await putParts(alice, begun, bytesOf(10));
    const first = expectStatus(await alice.post(`/api/attachments/${begun.attachment.id}/complete`, { parts }), 200);
    expect(expectStatus(await alice.post(`/api/attachments/${begun.attachment.id}/complete`, { parts }), 200)).toEqual(first);
    expect(expectStatus(await alice.post(`/api/attachments/${begun.attachment.id}/complete`, {}), 200)).toEqual(first);
    // the file put together, its row not written: the next try finds the file
    const again = await beginAttachment(alice, { size: 10 });
    const r = await row(again.attachment.id);
    const sent = await putParts(alice, again, bytesOf(10));
    await platform.env.MEDIA.resumeMultipartUpload(r?.file_key as string, r?.upload_id as string).complete(sent as R2UploadedPart[]);
    expect(expectStatus(await alice.post(`/api/attachments/${again.attachment.id}/complete`, { parts: sent }), 200).attachment.state).toBe(
      'loose'
    );
  });

  it('drops a file that came out another size than it said, row and all', async () => {
    const begun = await beginAttachment(alice, { size: 10 });
    const r = await row(begun.attachment.id);
    // a part that reached the store some other way than through the parts, which are checked for their length
    const part = await platform.env.MEDIA.resumeMultipartUpload(r?.file_key as string, r?.upload_id as string).uploadPart(1, bytesOf(9));
    const res = await alice.post(`/api/attachments/${begun.attachment.id}/complete`, {
      parts: [{ partNumber: part.partNumber, etag: part.etag }]
    });
    expect(expectStatus(res, 400).message).toBe('传上来的文件和说好的大小不一样，请重新上传');
    expect(await row(begun.attachment.id)).toBeNull();
    expect(await stored(r?.file_key as string)).toBe(false);
  });

  it('is nobody else’s to complete', async () => {
    const begun = await beginAttachment(alice, { size: 10 });
    const parts = await putParts(alice, begun, bytesOf(10));
    expect((await bob.post(`/api/attachments/${begun.attachment.id}/complete`, { parts })).status).toBe(404);
    expect((await visitor.post(`/api/attachments/${begun.attachment.id}/complete`, { parts })).status).toBe(401);
    expect((await row(begun.attachment.id))?.uploaded_at).toBeNull();
  });
});

describe('PUT /api/attachments/:id/poster', () => {
  it('takes a frame of one’s own video, as WebP or JPEG, in place of the one before', async () => {
    const a = await uploadAttachment(alice, bytesOf(100), { kind: 'video', name: 'v.mp4', mime: 'video/mp4' });
    const webp = expectStatus(await poster(alice, a.id, WEBP, 'image/webp'), 200).attachment;
    expect(webp).toEqual({ ...a, poster: true });
    const first = (await row(a.id))?.poster_key as string;
    expect(first).toBe(`a/${alice.me.id}/${a.id}.poster.webp`);
    const frame = await alice.fetch(`/media/a/${a.id}/poster`);
    expect(frame.status).toBe(200);
    expect(frame.headers.get('content-type')).toBe('image/webp');
    expect(Buffer.compare(await bytesAt(frame), WEBP)).toBe(0);

    expectStatus(await poster(alice, a.id, JPEG, 'image/jpeg; q=1'), 200);
    const second = (await row(a.id))?.poster_key as string;
    expect(second).toBe(`a/${alice.me.id}/${a.id}.poster.jpg`);
    expect(await stored(first)).toBe(false);
    expect((await alice.fetch(`/media/a/${a.id}/poster`)).headers.get('content-type')).toBe('image/jpeg');
    // the same kind again replaces it in place
    expectStatus(await poster(alice, a.id, JPEG, 'image/jpeg'), 200);
    expect(await stored(second)).toBe(true);
    // in an entry, and saying so
    const e = await entry(alice, { attachments: holding(a) });
    expect(expectStatus(await poster(alice, a.id, WEBP, 'image/webp'), 200).attachment).toEqual({
      ...a,
      poster: true,
      state: 'attached',
      entryId: e.id
    });
  });

  it('takes a frame while the video is still uploading', async () => {
    const begun = await beginAttachment(alice, { kind: 'video', name: 'v.mp4', mime: 'video/mp4', size: 10 });
    expect(expectStatus(await poster(alice, begun.attachment.id, WEBP, 'image/webp'), 200).attachment.poster).toBe(true);
  });

  it('takes nothing else', async () => {
    const v = await uploadAttachment(alice, bytesOf(100), { kind: 'video', name: 'v.mp4', mime: 'video/mp4' });
    const a = await uploadAttachment(alice);
    expect(expectStatus(await poster(alice, a.id, WEBP, 'image/webp'), 400).message).toBe('只有视频有画面');
    expect(expectStatus(await poster(alice, v.id, WEBP, 'image/png'), 400).message).toBe('画面需要是 WebP 或 JPEG');
    expect(expectStatus(await poster(alice, v.id, WEBP, ''), 400).message).toBe('画面需要是 WebP 或 JPEG');
    expect(expectStatus(await poster(alice, v.id, JPEG, 'image/webp'), 400).message).toBe('画面不是有效的图片');
    expect(expectStatus(await poster(alice, v.id, WEBP, 'image/jpeg'), 400).message).toBe('画面不是有效的图片');
    const max = ATTACHMENT_LIMITS.posterMaxBytes;
    const huge = new Uint8Array(max + 1);
    huge.set(WEBP);
    expect(await poster(alice, v.id, huge, 'image/webp')).toMatchObject({ status: 413, body: { message: '画面最多 2 MB' } });
    expect(await poster(alice, v.id, WEBP, 'image/webp', { 'content-length': String(max + 1) })).toMatchObject({ status: 413 });
    const most = new Uint8Array(max);
    most.set(WEBP);
    expect((await poster(alice, v.id, most, 'image/webp')).status).toBe(200);
    expect((await poster(bob, v.id, WEBP, 'image/webp')).status).toBe(404);
  });
});

describe('DELETE /api/attachments/:id', () => {
  it('deletes a loose one, file, frame and all', async () => {
    const v = await video();
    const r = await row(v.id);
    expect(expectStatus(await alice.del(`/api/attachments/${v.id}`), 200)).toEqual({ ok: true });
    expect(await row(v.id)).toBeNull();
    expect(await stored(r?.file_key as string)).toBe(false);
    expect(await stored(r?.poster_key as string)).toBe(false);
    expect((await alice.fetch(`/media/a/${v.id}`)).status).toBe(404);
    expect((await alice.del(`/api/attachments/${v.id}`)).status).toBe(404);
  });

  it('cancels one still uploading', async () => {
    const begun = await beginAttachment(alice, { size: 10 });
    const r = await row(begun.attachment.id);
    const parts = await putParts(alice, begun, bytesOf(10));
    expectStatus(await alice.del(`/api/attachments/${begun.attachment.id}`), 200);
    expect(await row(begun.attachment.id)).toBeNull();
    const upload = platform.env.MEDIA.resumeMultipartUpload(r?.file_key as string, r?.upload_id as string);
    await expect(upload.complete(parts as R2UploadedPart[])).rejects.toThrow();
    expect(await stored(r?.file_key as string)).toBe(false);
  });

  it('keeps one an entry holds, and anyone else’s', async () => {
    const a = await uploadAttachment(alice);
    await entry(alice, { attachments: holding(a) });
    const res = await alice.del(`/api/attachments/${a.id}`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'conflict', message: '附件在记录里：先在记录里去掉它' });
    const loose = await uploadAttachment(alice);
    expect((await bob.del(`/api/attachments/${loose.id}`)).status).toBe(404);
    expect((await visitor.del(`/api/attachments/${loose.id}`)).status).toBe(401);
    expect(await row(a.id)).not.toBeNull();
    expect(await row(loose.id)).not.toBeNull();
  });
});

describe('entries with attachments', () => {
  it('hold them in order, with their captions, in the detail and in lists', async () => {
    const v = await video();
    const rec = await uploadAttachment(alice);
    const file = await uploadAttachment(alice, bytesOf(50), { kind: 'file', name: '票.pdf', mime: 'application/pdf' });
    const e = await entry(alice, {
      body: '三样',
      attachments: [{ attachmentId: file.id, caption: ' 车票 ' }, { attachmentId: v.id }, { attachmentId: rec.id, caption: '  ' }]
    });
    expect(e.attachments).toEqual([shown(file, '车票'), shown(v), shown(rec)]);
    expect(expectStatus(await alice.get<EntryDetail>(`/api/entries/${e.id}`), 200).attachments).toEqual(e.attachments);
    const list = expectStatus(await alice.get<{ entries: EntrySummary[] }>('/api/entries?mine=1'), 200).entries;
    expect(list.find((x) => x.id === e.id)?.attachments).toEqual([
      { id: file.id, kind: 'file', duration: null, poster: false },
      { id: v.id, kind: 'video', duration: 12.5, poster: true },
      { id: rec.id, kind: 'audio', duration: 3.5, poster: false }
    ]);
    expect((await row(v.id))?.loose_since).toBeNull();
    expect([await row(file.id), await row(v.id), await row(rec.id)].map((r) => [r?.entry_id, r?.position])).toEqual([
      [e.id, 0],
      [e.id, 1],
      [e.id, 2]
    ]);
    // an entry without any lists none
    expect((await entry(alice, { body: '无' })).attachments).toEqual([]);
  });

  it('may be attachments alone, and never nothing at all', async () => {
    const a = await uploadAttachment(alice);
    const e = await entry(alice, { attachments: holding(a) });
    expect(e).toMatchObject({ title: null, body: null, media: [] });
    expect(expectStatus(await alice.post('/api/entries', { occurredAt: AT, attachments: [] }), 400).message).toBe(EMPTY);
    expect(expectStatus(await alice.patch(`/api/entries/${e.id}`, { attachments: [] }), 400).message).toBe(EMPTY);
    // with words, it may let them all go
    expect(expectStatus(await alice.patch(`/api/entries/${e.id}`, { body: '字', attachments: [] }), 200).entry.attachments).toEqual([]);
    // and an entry of words may lose its words once it holds an attachment
    const b = await uploadAttachment(alice);
    const words = await entry(alice, { body: '只有字' });
    expectStatus(await alice.patch(`/api/entries/${words.id}`, { body: null, attachments: holding(b) }), 200);
    expect(expectStatus(await alice.patch(`/api/entries/${words.id}`, { title: null }), 200).entry.attachments).toHaveLength(1);
  });

  it('take only their author’s attachments, uploaded in full and in no other entry', async () => {
    const theirs = await uploadAttachment(bob);
    const begun = await beginAttachment(alice);
    const held = await uploadAttachment(alice);
    const other = await entry(alice, { attachments: holding(held) });
    const mine = await uploadAttachment(alice);
    const post = (attachments: unknown) => alice.post('/api/entries', { occurredAt: AT, body: 'x', attachments });
    expect(expectStatus(await post([{ attachmentId: theirs.id }]), 400).message).toBe('只能添加你自己上传的附件');
    expect(expectStatus(await post([{ attachmentId: 'at_nobody' }]), 400).message).toBe('只能添加你自己上传的附件');
    expect(expectStatus(await post([{ attachmentId: begun.attachment.id }]), 400).message).toBe('附件还没有传完');
    expect(expectStatus(await post([{ attachmentId: mine.id }, { attachmentId: held.id }]), 400).message).toBe('这个附件在另一条记录里');
    const e = await entry(alice, { body: 'x', attachments: holding(mine) });
    expect(expectStatus(await alice.patch(`/api/entries/${e.id}`, { attachments: holding(mine, held) }), 400).message).toBe(
      '这个附件在另一条记录里'
    );
    expect(expectStatus(await bob.post('/api/entries', { occurredAt: AT, body: 'x', attachments: holding(mine) }), 400).message).toBe(
      '只能添加你自己上传的附件'
    );
    // nothing changed
    expect((await row(mine.id))?.entry_id).toBe(e.id);
    expect((await row(held.id))?.entry_id).toBe(other.id);
    expect((await row(theirs.id))?.entry_id).toBeNull();
  });

  it('take a list of at most 20, each once, captions of at most 2000 characters', async () => {
    const post = (attachments: unknown) => alice.post('/api/entries', { occurredAt: AT, body: 'x', attachments });
    expect(expectStatus(await post('at_1'), 400).message).toBe('附件需要是数组');
    expect(expectStatus(await post([{}]), 400).message).toBe('第 1 个附件格式不对');
    expect(expectStatus(await post([{ attachmentId: 'at a' }]), 400).message).toBe('第 1 个附件格式不对');
    const many = Array.from({ length: ATTACHMENT_LIMITS.perEntry + 1 }, (_, i) => ({ attachmentId: `at_${i}` }));
    expect(expectStatus(await post(many), 400).message).toBe(`一条记录最多 ${ATTACHMENT_LIMITS.perEntry} 个附件`);
    const a = await uploadAttachment(alice);
    const long = '字'.repeat(ATTACHMENT_LIMITS.captionMax);
    expect((await post([{ attachmentId: a.id, caption: `${long}字` }])).status).toBe(400);
    const e = expectStatus(
      await post([
        { attachmentId: a.id, caption: long },
        { attachmentId: a.id, caption: '又一次' }
      ]),
      201
    ).entry;
    expect(e.attachments.map((x: Json) => [x.id, x.caption])).toEqual([[a.id, long]]);
  });

  it('change with PATCH: in another order, other captions, some added and some taken out, which come loose', async () => {
    const [a, b, c] = [await uploadAttachment(alice), await uploadAttachment(alice), await uploadAttachment(alice)];
    const e = await entry(alice, { body: 'x', attachments: holding(a, b) });
    // put up a month ago: its week starts when it is taken out, not from then
    await run('UPDATE attachments SET uploaded_at = ?1 WHERE id = ?2', iso(Date.now() - 30 * DAY), a.id);
    const before = Date.now() - 1000;
    const res = await alice.patch(`/api/entries/${e.id}`, {
      attachments: [{ attachmentId: b.id, caption: '后来' }, { attachmentId: c.id }]
    });
    const changed = expectStatus(res, 200).entry as EntryDetail;
    expect(changed.attachments).toEqual([shown(b, '后来'), shown(c)]);
    expect(changed.revision).toBe(e.revision + 1);
    const out = await row(a.id);
    expect(out?.entry_id).toBeNull();
    expect(Date.parse(out?.loose_since as string)).toBeGreaterThanOrEqual(before);
    // other fields leave them as they are
    const titled = expectStatus(await alice.patch(`/api/entries/${e.id}`, { title: '题' }), 200).entry as EntryDetail;
    expect(titled.attachments).toEqual(changed.attachments);
    // one taken out can go back, or into another entry
    expectStatus(await alice.patch(`/api/entries/${e.id}`, { attachments: holding(c, a, b) }), 200);
    expect((await row(a.id))?.loose_since).toBeNull();
    expectStatus(await alice.patch(`/api/entries/${e.id}`, { attachments: holding(c) }), 200);
    const next = await entry(alice, { attachments: holding(a, b) });
    expect(next.attachments.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(expectStatus(await alice.get<EntryDetail>(`/api/entries/${e.id}`), 200).attachments.map((x) => x.id)).toEqual([c.id]);
  });

  it('go with the entry when it is deleted, files and frames and all', async () => {
    const v = await video();
    const file = await uploadAttachment(alice, bytesOf(50), { kind: 'file', name: 'a.txt', mime: 'text/plain' });
    const loose = await uploadAttachment(alice);
    const e = await entry(alice, { attachments: holding(v, file) });
    const keys = [await row(v.id), await row(file.id)].flatMap((r) => [r?.file_key, r?.poster_key]).filter(Boolean) as string[];
    expect(keys).toHaveLength(3);
    expectStatus(await alice.del(`/api/entries/${e.id}`), 200);
    expect(await row(v.id)).toBeNull();
    expect(await row(file.id)).toBeNull();
    for (const key of keys) expect(await stored(key), key).toBe(false);
    expect(await row(loose.id)).not.toBeNull();
    expect((await alice.fetch(`/media/a/${loose.id}`)).status).toBe(200);
  });
});

describe('/media/a/:id: who may play or download it', () => {
  const combos: [Visibility, EntryStatus][] = [
    ['public', 'published'],
    ['unlisted', 'published'],
    ['private', 'published'],
    ['public', 'draft'],
    ['unlisted', 'archived'],
    ['public', 'archived'],
    ['private', 'draft']
  ];

  it('whoever may open its entry, and nobody else', async () => {
    for (const [visibility, status] of combos) {
      const v = await video();
      const e = await entry(alice, { visibility, status, attachments: holding(v) });
      for (const [name, viewer] of [
        ['alice', alice],
        ['bob', bob],
        ['visitor', visitor]
      ] as const) {
        const opens = await statusOf(viewer, `/api/entries/${e.id}`);
        const at = `${visibility} ${status} ${name}`;
        expect(opens, at).toBe(name === 'alice' || (visibility !== 'private' && status === 'published') ? 200 : 404);
        expect(await statusOf(viewer, `/media/a/${v.id}`), at).toBe(opens);
        expect(await statusOf(viewer, `/media/a/${v.id}/poster`), at).toBe(opens);
      }
    }
  });

  it('a loose one is its author’s alone, and one still uploading nobody’s', async () => {
    const loose = await video();
    expect(await statusOf(alice, `/media/a/${loose.id}`)).toBe(200);
    expect(await statusOf(alice, `/media/a/${loose.id}/poster`)).toBe(200);
    for (const viewer of [bob, visitor]) {
      expect(await statusOf(viewer, `/media/a/${loose.id}`)).toBe(404);
      expect(await statusOf(viewer, `/media/a/${loose.id}/poster`)).toBe(404);
    }
    const begun = await beginAttachment(alice, { kind: 'video', name: 'v.mp4', mime: 'video/mp4', size: 10 });
    await putParts(alice, begun, bytesOf(10));
    // its frame may come before the parts are put together, and is no more to be seen than its file
    expectStatus(await poster(alice, begun.attachment.id, WEBP, 'image/webp'), 200);
    expect(await statusOf(alice, `/media/a/${begun.attachment.id}`)).toBe(404);
    expect(await statusOf(alice, `/media/a/${begun.attachment.id}/poster`)).toBe(404);
  });

  it('follows its entry as it changes, and leaves it when taken out', async () => {
    const a = await uploadAttachment(alice);
    const e = await entry(alice, { visibility: 'public', attachments: holding(a) });
    expect(await statusOf(bob, `/media/a/${a.id}`)).toBe(200);
    expectStatus(await alice.patch(`/api/entries/${e.id}`, { visibility: 'private' }), 200);
    expect(await statusOf(bob, `/media/a/${a.id}`)).toBe(404);
    expectStatus(await alice.patch(`/api/entries/${e.id}`, { visibility: 'public', body: 'x', attachments: [] }), 200);
    expect(await statusOf(bob, `/media/a/${a.id}`)).toBe(404);
    expect(await statusOf(alice, `/media/a/${a.id}`)).toBe(200);
  });

  it('a share link of its entry, or of a collection or project that shows it, opens it while it works', async () => {
    const [x, y, z] = [await video(), await uploadAttachment(alice), await uploadAttachment(alice)];
    const pid = expectStatus(await alice.post('/api/projects', { title: '学书法', startDate: '2026-03-01' }), 201).project.id;
    const one = await entry(alice, { attachments: holding(x) });
    const two = await entry(alice, { attachments: holding(y) });
    await entry(alice, { attachments: holding(z), projectIds: [pid] });
    const tid = expectStatus(await alice.post('/api/themes', { kind: 'topic', title: '合集' }), 201).theme.id;
    expectStatus(await alice.put(`/api/themes/${tid}/items`, { items: [{ kind: 'entry', entryId: two.id }] }), 200);
    const links = [await share(alice, 'entry', one.id), await share(alice, 'theme', tid), await share(alice, 'project', pid)];
    const reached = [x, y, z];
    for (const b of [Browser.of(platform), Browser.of(platform, bob)]) {
      for (const a of reached) expect(await statusOf(b, `/media/a/${a.id}`)).toBe(404);
      for (const link of links) expectStatus(await b.post('/api/shares/open', { token: link.token }), 200);
      for (const a of reached) {
        const res = await b.fetch(`/media/a/${a.id}`);
        expect(res.status, a.id).toBe(200);
        expect(res.headers.get('cache-control')).toBe(NO_STORE);
        expect(res.headers.get('vary')).toBe('Cookie');
      }
      const frame = await b.fetch(`/media/a/${x.id}/poster`);
      expect(frame.status).toBe(200);
      expect(frame.headers.get('cache-control')).toBe(NO_STORE);
      expect(frame.headers.get('vary')).toBe('Cookie');
      // a link opens one owner's finished entries only
      expect(await statusOf(b, `/media/a/${(await uploadAttachment(alice)).id}`)).toBe(404);
    }
    // a draft stays its author's, link or not
    const holder = Browser.of(platform);
    for (const link of links) expectStatus(await holder.post('/api/shares/open', { token: link.token }), 200);
    expectStatus(await alice.patch(`/api/entries/${one.id}`, { status: 'draft' }), 200);
    expect(await statusOf(holder, `/media/a/${x.id}`)).toBe(404);
    // a link that stops working opens nothing more
    expectStatus(await alice.del(`/api/shares/${links[1].id}`), 200);
    expect(await statusOf(holder, `/media/a/${y.id}`)).toBe(404);
    expect(await statusOf(holder, `/media/a/${z.id}`)).toBe(200);
  });

  it('answers 404 for anything that is not an attachment’s file', async () => {
    const rec = await uploadAttachment(alice);
    const clip = await uploadAttachment(alice, bytesOf(10), { kind: 'video', name: 'v.mp4', mime: 'video/mp4' });
    for (const path of ['/media/a/at_nope', '/media/a/a%20b', `/media/a/${rec.id}/poster`, `/media/a/${clip.id}/poster`]) {
      expect(await statusOf(alice, path), path).toBe(404);
    }
  });
});

describe('/media/a/:id: what it sends', () => {
  const headersOf = async (a: OwnAttachment, query = '') => {
    const res = await alice.fetch(`/media/a/${a.id}${query}`);
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    return res.headers;
  };

  it('plays videos and recordings in place, opens PDFs in the browser, and offers anything else only to save', async () => {
    const clip = await uploadAttachment(alice, bytesOf(10), { kind: 'video', name: 'clip.mp4', mime: 'video/mp4' });
    const h = await headersOf(clip);
    expect(Object.fromEntries(h)).toMatchObject({
      'content-type': 'video/mp4',
      'content-disposition': `inline; filename="clip.mp4"; filename*=UTF-8''clip.mp4`,
      'content-length': '10',
      'accept-ranges': 'bytes',
      'cache-control': NO_STORE,
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff'
    });
    expect(h.get('etag')).toBeTruthy();
    expect(h.get('vary')).toBeNull();
    expect((await headersOf(clip, '?download')).get('content-disposition')).toBe(
      `attachment; filename="clip.mp4"; filename*=UTF-8''clip.mp4`
    );

    const voice = await uploadAttachment(alice, bytesOf(10), { name: 'v.webm', mime: 'audio/webm' });
    expect((await headersOf(voice)).get('content-type')).toBe('audio/webm');
    expect((await headersOf(voice)).get('content-disposition')).toMatch(/^inline;/);

    const pdf = await uploadAttachment(alice, bytesOf(10), { kind: 'file', name: 'a.pdf', mime: 'application/pdf' });
    const ph = await headersOf(pdf);
    expect(ph.get('content-type')).toBe('application/pdf');
    expect(ph.get('content-disposition')).toMatch(/^inline;/);
    expect(ph.get('content-security-policy')).toBeNull();

    const odd = [
      ['page.html', 'text/html', 'file'],
      ['pic.svg', 'image/svg+xml', 'file'],
      ['clip.avi', 'video/x-msvideo', 'video'],
      ['song.mid', 'audio/midi', 'audio'],
      ['a.mp4', 'video/mp4', 'file']
    ];
    for (const [name, mime, kind] of odd) {
      const a = await uploadAttachment(alice, bytesOf(10), { kind, name, mime });
      const oh = await headersOf(a);
      expect(oh.get('content-type'), name).toBe('application/octet-stream');
      expect(oh.get('content-disposition'), name).toMatch(/^attachment;/);
      expect(oh.get('content-security-policy'), name).toBe("default-src 'none'; sandbox");
    }
  });

  it('names a download as it was uploaded, in ASCII for old browsers', async () => {
    const name = `西湖 "夜" (1)'s.mp4`;
    const a = await uploadAttachment(alice, bytesOf(10), { kind: 'video', name, mime: 'video/mp4' });
    expect((await headersOf(a, '?download')).get('content-disposition')).toBe(
      `attachment; filename="__ ___ (1)'s.mp4"; filename*=UTF-8''%E8%A5%BF%E6%B9%96%20%22%E5%A4%9C%22%20%281%29%27s.mp4`
    );
  });

  it('sends the one range asked for, and all of it when it cannot', async () => {
    const file = bytesOf(1000);
    const a = await uploadAttachment(alice, file);
    const ranged = async (range: string) => alice.fetch(`/media/a/${a.id}`, { headers: { range } });
    const cases: [string, number, number][] = [
      ['bytes=0-3', 0, 3],
      ['bytes=990-', 990, 999],
      ['bytes=-5', 995, 999],
      ['bytes=995-2000', 995, 999],
      ['bytes=-2000', 0, 999],
      [' bytes=7-7 ', 7, 7]
    ];
    for (const [range, from, to] of cases) {
      const res = await ranged(range);
      expect(res.status, range).toBe(206);
      expect(res.headers.get('content-range'), range).toBe(`bytes ${from}-${to}/1000`);
      expect(res.headers.get('content-length'), range).toBe(String(to - from + 1));
      expect(Buffer.compare(await bytesAt(res), file.subarray(from, to + 1)), range).toBe(0);
    }
    for (const range of ['bytes=1000-', 'bytes=-0', 'bytes=5000-6000']) {
      const res = await ranged(range);
      expect(res.status, range).toBe(416);
      expect(res.headers.get('content-range'), range).toBe('bytes */1000');
    }
    for (const range of ['bytes=0-1,5-6', 'items=0-3', 'bytes=5-2', 'bytes=-', 'bytes=a-b']) {
      const res = await ranged(range);
      expect(res.status, range).toBe(200);
      expect(res.headers.get('content-range'), range).toBeNull();
      expect((await bytesAt(res)).byteLength, range).toBe(1000);
    }
  });

  it('answers HEAD as GET, without the file', async () => {
    const a = await uploadAttachment(alice, bytesOf(1000));
    const res = await alice.fetch(`/media/a/${a.id}`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('1000');
    expect((await bytesAt(res)).byteLength).toBe(0);
  });

  it('lets a frame of a finished public entry stay in the browser for an hour, and keeps any other nowhere', async () => {
    const pub = await video();
    await entry(alice, { visibility: 'public', attachments: holding(pub) });
    const shared = await video();
    await entry(alice, { visibility: 'unlisted', attachments: holding(shared) });
    const own = await video();
    await entry(alice, { attachments: holding(own) });
    // public, but a draft or archived: its author's alone for now
    const draft = await video();
    await entry(alice, { visibility: 'public', status: 'draft', attachments: holding(draft) });
    const archived = await video();
    await entry(alice, { visibility: 'public', status: 'archived', attachments: holding(archived) });
    const loose = await video();
    for (const viewer of [alice, bob, visitor]) {
      const res = await viewer.fetch(`/media/a/${pub.id}/poster`);
      expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      // the file itself, never
      expect((await viewer.fetch(`/media/a/${pub.id}`)).headers.get('cache-control')).toBe(NO_STORE);
    }
    expect((await bob.fetch(`/media/a/${shared.id}/poster`)).headers.get('cache-control')).toBe(NO_STORE);
    for (const a of [own, draft, archived, loose]) {
      const res = await alice.fetch(`/media/a/${a.id}/poster`);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(NO_STORE);
    }
  });
});

describe('the hourly job', () => {
  it('deletes uploads a day after they began unfinished, and attachments a week after they came loose', async () => {
    const now = Date.now();
    const ago = (ms: number) => iso(now - ms);
    const unfinished = await beginAttachment(alice, { size: 10 });
    const sent = await putParts(alice, unfinished, bytesOf(10));
    const fresh = await beginAttachment(alice, { size: 10 });
    const [old, recent, kept, out] = [
      await video(),
      await uploadAttachment(alice),
      await uploadAttachment(alice),
      await uploadAttachment(alice)
    ];
    const e = await entry(alice, { attachments: holding(kept, out) });
    expectStatus(await alice.patch(`/api/entries/${e.id}`, { attachments: holding(kept) }), 200);
    await run('UPDATE attachments SET loose_since = ?1, created_at = ?1 WHERE id = ?2', ago(DAY + 60_000), unfinished.attachment.id);
    await run('UPDATE attachments SET loose_since = ?1, created_at = ?1 WHERE id = ?2', ago(DAY - 60_000), fresh.attachment.id);
    await run('UPDATE attachments SET loose_since = ?1 WHERE id = ?2', ago(7 * DAY + 60_000), old.id);
    await run('UPDATE attachments SET loose_since = ?1 WHERE id = ?2', ago(7 * DAY - 60_000), recent.id);
    await run('UPDATE attachments SET loose_since = ?1 WHERE id = ?2', ago(7 * DAY + 60_000), out.id);
    // in an entry for a month: kept, whenever it was uploaded
    await run('UPDATE attachments SET created_at = ?1, uploaded_at = ?1 WHERE id = ?2', ago(30 * DAY), kept.id);
    const theirs = await uploadAttachment(bob);
    await run('UPDATE attachments SET loose_since = ?1 WHERE id = ?2', ago(8 * DAY), theirs.id);
    const files = await Promise.all([old, out, theirs].map(async (a) => (await row(a.id)) as Json));
    const pending = (await row(unfinished.attachment.id)) as Json;

    expect(await purgeLooseAttachments(platform.env.DB, platform.env.MEDIA, now)).toEqual({ purged: 4 });
    for (const a of [unfinished.attachment, old, out, theirs]) expect(await row(a.id), a.id).toBeNull();
    for (const a of [fresh.attachment, recent, kept]) expect(await row(a.id), a.id).not.toBeNull();
    for (const f of files) {
      expect(await stored(f.file_key as string), f.id).toBe(false);
      if (f.poster_key) expect(await stored(f.poster_key as string)).toBe(false);
    }
    // its upload is aborted
    await expect(
      platform.env.MEDIA.resumeMultipartUpload(pending.file_key, pending.upload_id).complete(sent as R2UploadedPart[])
    ).rejects.toThrow();
    expect(await purgeLooseAttachments(platform.env.DB, platform.env.MEDIA, now)).toEqual({ purged: 0 });
    // a week on, the ones left are due as well, but not the one in an entry
    expect(await purgeLooseAttachments(platform.env.DB, platform.env.MEDIA, now + 7 * DAY)).toEqual({ purged: 2 });
    expect(await row(kept.id)).not.toBeNull();
  });
});
