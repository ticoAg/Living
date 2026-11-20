// Attachments (附件): a video, recording or other file goes up in parts, then gets a frame (a video's poster) if it
// has one; an upload that was not kept can be deleted. Saving one in an entry is the entry's (`attachments` of
// POST /api/entries and PATCH /api/entries/:id); its file is served at /media/a/:id (routes/media.ts).
// Contract: /docs/api/attachments.md

import { Hono } from 'hono';
import { ATTACHMENT_LIMITS, ATTACHMENT_PART_BYTES } from '../../shared/limits';
import type { AttachmentPart, AttachmentResponse, AttachmentUpload, SessionUser } from '../../shared/types';
import type { AppEnv } from '../env';
import {
  ATTACHMENT_COLS,
  assertCanBegin,
  beginUpload,
  deleteAttachmentFiles,
  parseAttachmentMeta,
  partLength,
  partsOf,
  posterKeyOf,
  toOwnAttachment,
  type AttachmentRow
} from '../lib/attachments';
import { conflict, invalid, notFound, paramId, readJson, tooLarge, upstream, type Ctx } from '../lib/http';
import { newId } from '../lib/ids';
import { requireUser } from '../lib/session';
import { nowIso } from '../lib/sql';
import { isPlainObject } from '../lib/validate';

export const attachments = new Hono<AppEnv>({ strict: false });

/** One's own attachment; anyone else's is not found. */
async function ownAttachment(c: Ctx, user: SessionUser, id: string): Promise<AttachmentRow> {
  const row = await c.env.DB.prepare(`SELECT ${ATTACHMENT_COLS} FROM attachments WHERE id = ?1`).bind(id).first<AttachmentRow>();
  if (!row || row.owner_id !== user.id) throw notFound('附件不存在');
  return row;
}

attachments.post('/', async (c) => {
  const user = await requireUser(c);
  const meta = parseAttachmentMeta(await readJson(c));
  const db = c.env.DB;
  await assertCanBegin(db, user.id);
  const now = nowIso();
  const row = await beginUpload(db, c.env.MEDIA, user.id, newId.attachment(), meta, now, now);
  return c.json(
    { attachment: toOwnAttachment(row), partBytes: ATTACHMENT_PART_BYTES, parts: partsOf(meta.size) } satisfies AttachmentUpload,
    201
  );
});

attachments.put('/:id/parts/:n', async (c) => {
  const user = await requireUser(c);
  const row = await ownAttachment(c, user, paramId(c));
  if (row.uploaded_at !== null || !row.upload_id) throw conflict('附件已经传完了');
  const parts = partsOf(row.size);
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1 || n > parts) throw invalid(`分片的序号需要是 1 到 ${parts}`);
  const want = partLength(row.size, n);
  // said up front by every browser; a body that is longer is not read at all
  const declared = c.req.header('content-length');
  if (declared !== undefined && Number(declared) > ATTACHMENT_PART_BYTES) throw tooLarge('分片太大');
  if (declared !== undefined && Number(declared) !== want) throw invalid(`第 ${n} 片应该是 ${want} 字节`);
  let body: ArrayBuffer;
  try {
    body = await c.req.arrayBuffer();
  } catch {
    throw invalid('无法读取请求内容');
  }
  if (body.byteLength !== want) throw invalid(`第 ${n} 片应该是 ${want} 字节`);
  let part: R2UploadedPart;
  try {
    part = await c.env.MEDIA.resumeMultipartUpload(row.file_key, row.upload_id).uploadPart(n, body);
  } catch (e) {
    console.error('attachments: part failed', row.id, n, e instanceof Error ? e.message : e);
    throw upstream('存储服务暂时不可用，请稍后再试');
  }
  return c.json({ partNumber: part.partNumber, etag: part.etag } satisfies AttachmentPart);
});

/** The parts as the uploads answered: each of 1 … `count` once, in order. */
function parseParts(v: unknown, count: number): R2UploadedPart[] {
  if (!Array.isArray(v) || v.length !== count) throw invalid(`需要全部 ${count} 片`);
  const parts = v.map((p: unknown) => {
    if (!isPlainObject(p) || !Number.isInteger(p.partNumber) || typeof p.etag !== 'string' || !p.etag || p.etag.length > 200) {
      throw invalid('分片的格式不对');
    }
    return { partNumber: p.partNumber as number, etag: p.etag };
  });
  parts.sort((a, b) => a.partNumber - b.partNumber);
  if (parts.some((p, i) => p.partNumber !== i + 1)) throw invalid(`需要第 1 到第 ${count} 片，每片一次`);
  return parts;
}

attachments.post('/:id/complete', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const row = await ownAttachment(c, user, paramId(c));
  // asked again after an answer that got lost: it is done
  if (row.uploaded_at !== null || !row.upload_id) return c.json({ attachment: toOwnAttachment(row) } satisfies AttachmentResponse);
  const parts = parseParts((await readJson(c)).parts, partsOf(row.size));
  let size: number | null = null;
  try {
    size = (await c.env.MEDIA.resumeMultipartUpload(row.file_key, row.upload_id).complete(parts)).size;
  } catch (e) {
    // completed by an earlier try whose row was not written: the file is there
    const there = await c.env.MEDIA.head(row.file_key).catch(() => null);
    if (!there) {
      console.error('attachments: complete failed', row.id, e instanceof Error ? e.message : e);
      throw invalid('分片不全，或者有的分片没有传上来');
    }
    size = there.size;
  }
  if (size !== row.size) {
    await db.prepare('DELETE FROM attachments WHERE id = ?1').bind(row.id).run();
    await deleteAttachmentFiles(c.env.MEDIA, [{ ...row, upload_id: null }]);
    throw invalid('传上来的文件和说好的大小不一样，请重新上传');
  }
  const now = nowIso();
  await db
    .prepare('UPDATE attachments SET uploaded_at = ?2, upload_id = NULL, loose_since = ?2 WHERE id = ?1 AND uploaded_at IS NULL')
    .bind(row.id, now)
    .run();
  return c.json({
    attachment: toOwnAttachment({ ...row, uploaded_at: now, upload_id: null, loose_since: now })
  } satisfies AttachmentResponse);
});

/** The first bytes of the formats a poster may be in. */
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isWebp = (b: Uint8Array) =>
  b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP';

attachments.put('/:id/poster', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const row = await ownAttachment(c, user, paramId(c));
  if (row.kind !== 'video') throw invalid('只有视频有画面');
  const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : null;
  if (!ext) throw invalid('画面需要是 WebP 或 JPEG');
  const max = ATTACHMENT_LIMITS.posterMaxBytes;
  if (Number(c.req.header('content-length') ?? 0) > max) throw tooLarge(`画面最多 ${max / 1024 / 1024} MB`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await c.req.arrayBuffer());
  } catch {
    throw invalid('无法读取请求内容');
  }
  if (bytes.byteLength > max) throw tooLarge(`画面最多 ${max / 1024 / 1024} MB`);
  if (!(ext === 'jpg' ? isJpeg(bytes) : isWebp(bytes))) throw invalid('画面不是有效的图片');
  const key = posterKeyOf(user.id, row.id, ext);
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
  await db.prepare('UPDATE attachments SET poster_key = ?2 WHERE id = ?1').bind(row.id, key).run();
  if (row.poster_key && row.poster_key !== key) {
    await c.env.MEDIA.delete(row.poster_key).catch((e: unknown) => console.error('attachments: old poster', row.id, e));
  }
  return c.json({ attachment: toOwnAttachment({ ...row, poster_key: key }) } satisfies AttachmentResponse);
});

attachments.delete('/:id', async (c) => {
  const user = await requireUser(c);
  const row = await ownAttachment(c, user, paramId(c));
  if (row.entry_id) throw conflict('附件在记录里：先在记录里去掉它');
  // rows first: once gone, nothing reaches the file
  const res = await c.env.DB.prepare('DELETE FROM attachments WHERE id = ?1 AND entry_id IS NULL').bind(row.id).run();
  if (!res.meta.changes) throw conflict('附件在记录里：先在记录里去掉它');
  await deleteAttachmentFiles(c.env.MEDIA, [row]);
  return c.json({ ok: true });
});
