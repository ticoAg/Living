// The library against real D1 and R2: docs/api/library.md. One's attachments, each with the entry it is in or when
// the hourly cleanup deletes it, what one keeps here by kind, and which of one's photos are in one's entries.
// Expectations follow the documented rules, never the implementation.

import { beforeEach, describe, expect, it } from 'vite-plus/test';
import type { EntryDetail, LibraryResponse, OwnAttachment } from '../../shared/types';
import { LIBRARY_ATTACHMENTS_LIMIT } from '../../shared/types';
import {
  beginAttachment,
  bytesOf,
  Client,
  expectStatus,
  newUser,
  upload,
  uploadAttachment,
  usePlatform,
  type Json
} from '../test-platform';

const platform = usePlatform();

let alice: Client;
let bob: Client;
beforeEach(async () => {
  alice = await newUser(platform, 'alice', 'owner');
  bob = await newUser(platform, 'bob');
});

const AT = '2026-11-16T08:30:00';
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const run = (sql: string, ...params: unknown[]) =>
  platform.env.DB.prepare(sql)
    .bind(...params)
    .run();

const entry = async (client: Client, body: Json = {}): Promise<EntryDetail> =>
  expectStatus(await client.post('/api/entries', { occurredAt: AT, ...body }), 201).entry;
const holding = (...list: OwnAttachment[]) => list.map((a) => ({ attachmentId: a.id }));
const libraryOf = async (client: Client): Promise<LibraryResponse> => expectStatus(await client.get<LibraryResponse>('/api/library'), 200);
const uploadedAt = async (id: string) =>
  (await platform.env.DB.prepare('SELECT uploaded_at FROM attachments WHERE id = ?1').bind(id).first<{ uploaded_at: string | null }>())
    ?.uploaded_at;
const listed = async (client: Client, id: string) => (await libraryOf(client)).attachments.find((a) => a.id === id);

describe('GET /api/library', () => {
  it('needs a session', async () => {
    const res = await new Client(platform).get('/api/library');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthenticated');
  });

  it('starts empty', async () => {
    const res = await alice.get<LibraryResponse>('/api/library');
    expect(expectStatus(res, 200)).toEqual({
      attachments: [],
      truncated: false,
      usage: {
        photos: { count: 0, bytes: 0 },
        video: { count: 0, bytes: 0 },
        audio: { count: 0, bytes: 0 },
        file: { count: 0, bytes: 0 }
      },
      entryPhotoIds: []
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('lists one’s own attachments, newest first, each in its entry or in none', async () => {
    const old = await uploadAttachment(alice, bytesOf(300), { kind: 'file', name: '收据.pdf', mime: 'application/pdf' });
    await run('UPDATE attachments SET created_at = ?1 WHERE id = ?2', '2026-11-01T00:00:00Z', old.id);
    const kept = await uploadAttachment(alice, bytesOf(500));
    const e = await entry(alice, {
      title: '湖边',
      visibility: 'unlisted',
      attachments: [{ attachmentId: kept.id, caption: '风声' }]
    });
    const begun = await beginAttachment(alice, { kind: 'video', name: '湖.mp4', mime: 'video/mp4', size: 2000 });
    await uploadAttachment(bob);

    const { attachments } = await libraryOf(alice);
    expect(attachments.map((a) => a.id)).toEqual([begun.attachment.id, kept.id, old.id]);
    const [uploading, inEntry, loose] = attachments;
    expect(inEntry).toEqual({
      ...kept,
      state: 'attached',
      entryId: e.id,
      caption: '风声',
      uploadedAt: (await uploadedAt(kept.id)) as string,
      purgeAt: null,
      entry: { id: e.id, label: '湖边', occurredAt: AT, visibility: 'unlisted', status: 'published' }
    });
    expect(loose).toMatchObject({ id: old.id, state: 'loose', entryId: null, caption: null, entry: null });
    expect(loose.uploadedAt).toBe(await uploadedAt(old.id));
    expect(loose.uploadedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/));
    expect(uploading).toMatchObject({ id: begun.attachment.id, state: 'uploading', uploadedAt: null, entry: null });
  });

  it('names an entry by its title, else its text, else its type; draft and archived as they are', async () => {
    const [a, b, c] = [await uploadAttachment(alice), await uploadAttachment(alice), await uploadAttachment(alice)];
    await entry(alice, { body: '## 第一行\n\n其余', attachments: holding(a), status: 'draft' });
    await entry(alice, { type: 'practice', attachments: holding(b), status: 'archived' });
    await entry(alice, { title: '  有标题  ', body: '正文', attachments: holding(c) });
    expect((await listed(alice, a.id))?.entry).toMatchObject({ label: '第一行', status: 'draft', visibility: 'private' });
    expect((await listed(alice, b.id))?.entry).toMatchObject({ label: '练习', status: 'archived' });
    expect((await listed(alice, c.id))?.entry).toMatchObject({ label: '有标题', status: 'published' });
  });

  it('says when the cleanup deletes one in no entry: a day after an upload began, a week after it came loose', async () => {
    const begun = await beginAttachment(alice);
    const began = '2026-11-10T09:00:00Z';
    await run('UPDATE attachments SET created_at = ?1, loose_since = ?1 WHERE id = ?2', began, begun.attachment.id);
    expect((await listed(alice, begun.attachment.id))?.purgeAt).toBe('2026-11-11T09:00:00Z');

    // uploaded, never in an entry: a week from when it came in whole
    const a = await uploadAttachment(alice);
    await run('UPDATE attachments SET uploaded_at = ?1, loose_since = ?1 WHERE id = ?2', '2026-11-12T10:00:00Z', a.id);
    expect((await listed(alice, a.id))?.purgeAt).toBe('2026-11-19T10:00:00Z');

    // taken out of its entry: a week from then, not from its upload; what the entry said of it goes with the entry
    const e = await entry(alice, { attachments: [{ attachmentId: a.id, caption: '说明' }] });
    expect(await listed(alice, a.id)).toMatchObject({ purgeAt: null, caption: '说明' });
    const before = Date.now();
    expectStatus(await alice.patch(`/api/entries/${e.id}`, { body: '文字', attachments: [] }), 200);
    const out = await listed(alice, a.id);
    expect(out).toMatchObject({ state: 'loose', entryId: null, entry: null, caption: null });
    const purge = Date.parse(out?.purgeAt as string);
    expect(purge).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 + 7 * DAY);
    expect(purge).toBeLessThanOrEqual(Date.now() + 7 * DAY);

    // an entry deleted some other way: a week after its upload
    await run('UPDATE attachments SET loose_since = NULL WHERE id = ?1', a.id);
    expect((await listed(alice, a.id))?.purgeAt).toBe('2026-11-19T10:00:00Z');
  });

  it('counts what one keeps by kind and bytes: photos’ originals, attachments uploaded whole', async () => {
    await upload(alice);
    await upload(alice);
    await upload(bob);
    await uploadAttachment(alice, bytesOf(300), { kind: 'video', name: 'v.mp4', mime: 'video/mp4' });
    await uploadAttachment(alice, bytesOf(400), { kind: 'video', name: 'w.mp4', mime: 'video/mp4' });
    await entry(alice, { attachments: holding(await uploadAttachment(alice, bytesOf(50))) });
    await uploadAttachment(alice, bytesOf(70), { kind: 'file', name: 'a.txt', mime: 'text/plain' });
    await beginAttachment(alice, { kind: 'file', name: 'b.txt', mime: 'text/plain', size: 9000 });
    await uploadAttachment(bob, bytesOf(800));
    const original = await platform.env.DB.prepare('SELECT file_size FROM photos WHERE owner_id = ?1 LIMIT 1')
      .bind(alice.me.id)
      .first<{ file_size: number }>();
    expect((await libraryOf(alice)).usage).toEqual({
      photos: { count: 2, bytes: 2 * (original?.file_size as number) },
      video: { count: 2, bytes: 700 },
      audio: { count: 1, bytes: 50 },
      file: { count: 1, bytes: 70 }
    });
  });

  it('names one’s photos that are in one’s entries, each once', async () => {
    const [p1, p2, p3] = [await upload(alice), await upload(alice), await upload(alice)];
    await entry(alice, { media: [{ photoId: p1.id }, { photoId: p2.id }] });
    await entry(alice, { media: [{ photoId: p1.id }], status: 'draft' });
    const gone = await entry(alice, { media: [{ photoId: p3.id }] });
    expectStatus(await alice.del(`/api/entries/${gone.id}`), 200);
    await entry(bob, { media: [{ photoId: (await upload(bob)).id }] });
    expect((await libraryOf(alice)).entryPhotoIds.sort()).toEqual([p1.id, p2.id].sort());
    expect((await libraryOf(bob)).entryPhotoIds).toHaveLength(1);
  });

  it('lists at most LIBRARY_ATTACHMENTS_LIMIT, the newest, and says it left some out', async () => {
    const a = await uploadAttachment(alice);
    const b = await uploadAttachment(alice);
    // the rest straight into the table: older than both
    const stmt = platform.env.DB.prepare(
      `INSERT INTO attachments (id, owner_id, kind, name, mime, size, file_key, created_at, uploaded_at, loose_since)
       VALUES (?1, ?2, 'file', 'f.txt', 'text/plain', 1, ?3, ?4, ?4, ?4)`
    );
    const rows = Array.from({ length: LIBRARY_ATTACHMENTS_LIMIT - 1 }, (_, i) => {
      const id = `at_${String(i).padStart(26, '0')}`;
      return stmt.bind(id, alice.me.id, `a/${alice.me.id}/${id}.txt`, iso(Date.parse('2026-01-01T00:00:00Z') + i * 1000));
    });
    for (let i = 0; i < rows.length; i += 500) await platform.env.DB.batch(rows.slice(i, i + 500));

    const full = await libraryOf(alice);
    expect(full.attachments).toHaveLength(LIBRARY_ATTACHMENTS_LIMIT);
    expect(full.truncated).toBe(true);
    expect(full.attachments.slice(0, 2).map((x) => x.id)).toEqual([b.id, a.id]);
    expect(full.usage.file.count).toBe(LIBRARY_ATTACHMENTS_LIMIT - 1);
    // one fewer: all of them
    await run('DELETE FROM attachments WHERE id = ?1', a.id);
    const all = await libraryOf(alice);
    expect(all.attachments).toHaveLength(LIBRARY_ATTACHMENTS_LIMIT);
    expect(all.truncated).toBe(false);
  });
});
