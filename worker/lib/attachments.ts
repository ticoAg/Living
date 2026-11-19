// Attachments (附件): the videos, recordings and other files of entries, kept as uploaded. The rows and what the API
// says of them, the checks on what a request names, the R2 keys and parts of an upload, the name and Range of a
// download, and the hourly cleanup of loose ones; what a file is served as is shared/attachments.ts.
// Docs: /docs/api/attachments.md, /docs/data/attachments.md

import { ATTACHMENT_LIMITS, ATTACHMENT_PART_BYTES } from '../../shared/limits';
import {
  ATTACHMENT_KINDS,
  type Attachment,
  type AttachmentBrief,
  type AttachmentKind,
  type EntryAttachment,
  type OwnAttachment
} from '../../shared/types';
import { ID_RE, invalid, rateLimited, tooLarge } from './http';
import { prep, prepInsert } from './sql';
import { cpLen, isPlainObject, optEnum, optNum, optText, type Body } from './validate';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface AttachmentRow {
  id: string;
  owner_id: string;
  entry_id: string | null;
  position: number;
  caption: string | null;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  file_key: string;
  poster_key: string | null;
  upload_id: string | null;
  created_at: string;
  uploaded_at: string | null;
  loose_since: string | null;
}

const COLS = [
  'id',
  'owner_id',
  'entry_id',
  'position',
  'caption',
  'kind',
  'name',
  'mime',
  'size',
  'duration',
  'width',
  'height',
  'file_key',
  'poster_key',
  'upload_id',
  'created_at',
  'uploaded_at',
  'loose_since'
] as const;

/** The columns of an `AttachmentRow`, of the table under alias `a` if given. */
export const attachmentCols = (a?: string): string => COLS.map((c) => (a ? `${a}.${c}` : c)).join(', ');
export const ATTACHMENT_COLS = attachmentCols();

export function toAttachment(r: AttachmentRow): Attachment {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    mime: r.mime,
    size: r.size,
    duration: r.duration,
    width: r.width,
    height: r.height,
    poster: r.poster_key !== null,
    createdAt: r.created_at
  };
}

export const toEntryAttachment = (r: AttachmentRow): EntryAttachment => ({ ...toAttachment(r), caption: r.caption });

export function toOwnAttachment(r: AttachmentRow): OwnAttachment {
  return {
    ...toAttachment(r),
    state: r.uploaded_at === null ? 'uploading' : r.entry_id ? 'attached' : 'loose',
    entryId: r.entry_id
  };
}

/** An entry's attachments in order, as its detail shows them. */
export async function attachmentsOfEntry(db: D1Database, entryId: string): Promise<EntryAttachment[]> {
  const res = await db
    .prepare(`SELECT ${ATTACHMENT_COLS} FROM attachments WHERE entry_id = ?1 AND uploaded_at IS NOT NULL ORDER BY position, id`)
    .bind(entryId)
    .all<AttachmentRow>();
  return res.results.map(toEntryAttachment);
}

/** A column of an entry list (alias `e`): its attachments as `AttachmentBrief`s, in order, as JSON. */
export const ATTACHMENTS_BRIEF_SQL = `(SELECT json_group_array(json_object('id', id, 'kind', kind, 'duration', duration, 'poster', poster_key IS NOT NULL))
  FROM (SELECT ea.id, ea.kind, ea.duration, ea.poster_key FROM attachments ea WHERE ea.entry_id = e.id AND ea.uploaded_at IS NOT NULL
        ORDER BY ea.position, ea.id))`;

export function parseBriefs(json: string | null): AttachmentBrief[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as { id: string; kind: AttachmentKind; duration: number | null; poster: number }[];
    return v.map((a) => ({ id: a.id, kind: a.kind, duration: a.duration, poster: a.poster === 1 }));
  } catch {
    return [];
  }
}

// ---- what a request says of a file --------------------------------------------------------------------------------

/** Characters that only make a name look like another one: controls, and the marks that reverse text (`…gpj.exe`). */
// oxlint-disable-next-line no-control-regex -- the controls are what it takes out
const UNSAFE_NAME = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** A file name as a download may carry it: no folders, no controls, at most `nameMax` code points. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') throw invalid('请填写文件名');
  const s = v.replace(UNSAFE_NAME, '').replace(/[\\/]/g, '_').trim();
  if (!s) throw invalid('请填写文件名');
  if (cpLen(s) > ATTACHMENT_LIMITS.nameMax) throw invalid(`文件名最多 ${ATTACHMENT_LIMITS.nameMax} 个字符`);
  return s;
}

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,99}$/;

/** The type of the file without its parameters (`audio/webm;codecs=opus` → `audio/webm`); blank: unknown. */
export function cleanMime(v: unknown, kind: AttachmentKind): string {
  if (typeof v !== 'string') throw invalid('请填写文件类型');
  const mime = v.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
  if (!MIME_RE.test(mime)) throw invalid('文件类型的格式不对');
  if (kind === 'video' && !mime.startsWith('video/')) throw invalid('视频的类型需要是 video/…');
  if (kind === 'audio' && !mime.startsWith('audio/')) throw invalid('录音的类型需要是 audio/…');
  return mime;
}

export interface AttachmentMeta {
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
}

const GB = 1024 ** 3;

/** The body of `POST /api/attachments`. A file is at least a byte; only videos have a size, and files no duration. */
export function parseAttachmentMeta(body: Body): AttachmentMeta {
  const kind = optEnum<AttachmentKind>(body.kind, '附件类型', ATTACHMENT_KINDS);
  if (!kind) throw invalid('请填写附件类型');
  const name = cleanName(body.name);
  const mime = cleanMime(body.mime, kind);
  if (body.size === 0) throw invalid('文件是空的');
  const size = optNum(body.size, '文件大小', { int: true, min: 1 });
  if (size === null) throw invalid('请填写文件大小');
  if (size > ATTACHMENT_LIMITS.maxBytes) throw tooLarge(`一个附件最多 ${ATTACHMENT_LIMITS.maxBytes / GB} GB`);
  const duration = kind === 'file' ? null : optNum(body.duration, '时长', { min: 0, max: 7 * 86400 });
  const side = (v: unknown, label: string) => (kind === 'video' ? optNum(v, label, { int: true, min: 1, max: 100_000 }) : null);
  return { kind, name, mime, size, duration, width: side(body.width, '宽度'), height: side(body.height, '高度') };
}

export interface AttachmentField {
  attachmentId: string;
  caption: string | null;
}

/** An entry's attachments, in order. One listed twice counts once, where it first appears. */
export function parseEntryAttachments(v: unknown): AttachmentField[] {
  if (!Array.isArray(v)) throw invalid('附件需要是数组');
  if (v.length > ATTACHMENT_LIMITS.perEntry) throw invalid(`一条记录最多 ${ATTACHMENT_LIMITS.perEntry} 个附件`);
  const out: AttachmentField[] = [];
  const seen = new Set<string>();
  v.forEach((raw: unknown, i) => {
    const at = `第 ${i + 1} 个附件`;
    if (!isPlainObject(raw) || typeof raw.attachmentId !== 'string' || !ID_RE.test(raw.attachmentId)) throw invalid(`${at}格式不对`);
    if (seen.has(raw.attachmentId)) return;
    seen.add(raw.attachmentId);
    out.push({ attachmentId: raw.attachmentId, caption: optText(raw.caption, `${at}的说明`, ATTACHMENT_LIMITS.captionMax) });
  });
  return out;
}

/**
 * The attachments an entry is to hold (400 otherwise): its author's, uploaded in full, and loose or in this entry
 * already. `entryId` null: an entry still to be made, which can only take loose ones.
 */
export async function assertUsableAttachments(db: D1Database, ownerId: string, entryId: string | null, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const res = await db
    .prepare('SELECT id, owner_id, entry_id, uploaded_at FROM attachments WHERE id IN (SELECT value FROM json_each(?1))')
    .bind(JSON.stringify(ids))
    .all<Pick<AttachmentRow, 'id' | 'owner_id' | 'entry_id' | 'uploaded_at'>>();
  const byId = new Map(res.results.map((r) => [r.id, r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r || r.owner_id !== ownerId) throw invalid('只能添加你自己上传的附件');
    if (r.uploaded_at === null) throw invalid('附件还没有传完');
    if (r.entry_id !== null && r.entry_id !== entryId) throw invalid('这个附件在另一条记录里');
  }
}

/**
 * The entry's attachments as statements: those listed take their places in order, with their captions; with
 * `replace`, the ones it had and no longer lists come loose (the hourly job deletes them a week later).
 */
export function writeAttachments(
  db: D1Database,
  entryId: string,
  list: AttachmentField[],
  now: string,
  replace = false
): D1PreparedStatement[] {
  const json = JSON.stringify(list);
  const out: D1PreparedStatement[] = [];
  if (replace) {
    out.push(
      prep(
        db,
        `UPDATE attachments SET entry_id = NULL, loose_since = ?2
         WHERE entry_id = ?1 AND id NOT IN (SELECT json_extract(value, '$.attachmentId') FROM json_each(?3))`,
        entryId,
        now,
        json
      )
    );
  }
  if (list.length) {
    // only ones still loose or already here: one another entry took meanwhile stays there
    out.push(
      prep(
        db,
        `UPDATE attachments SET entry_id = ?1, loose_since = NULL, position = j.key, caption = json_extract(j.value, '$.caption')
         FROM json_each(?2) AS j
         WHERE attachments.id = json_extract(j.value, '$.attachmentId') AND attachments.uploaded_at IS NOT NULL
           AND (attachments.entry_id IS NULL OR attachments.entry_id = ?1)`,
        entryId,
        json
      )
    );
  }
  return out;
}

// ---- the file in R2 -----------------------------------------------------------------------------------------------

/** At most `uploadingMax` uploads begun in the last hour and not completed (429): a browser sends a few at a time. */
export async function assertCanBegin(db: D1Database, ownerId: string): Promise<void> {
  const busy = await db
    .prepare('SELECT COUNT(*) AS n FROM attachments WHERE owner_id = ?1 AND uploaded_at IS NULL AND loose_since > ?2')
    .bind(ownerId, iso(Date.now() - HOUR))
    .first<{ n: number }>();
  if ((busy?.n ?? 0) >= ATTACHMENT_LIMITS.uploadingMax) throw rateLimited('同时在传的附件太多了，等前面的传完再试');
}

/** Attachment `id` of `meta` begun: R2's multipart upload for its file, and its row, loose since `now`. */
export async function beginUpload(
  db: D1Database,
  bucket: R2Bucket,
  ownerId: string,
  id: string,
  meta: AttachmentMeta,
  createdAt: string,
  now: string
): Promise<AttachmentRow> {
  const key = fileKeyOf(ownerId, id, meta.name);
  const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: meta.mime } });
  const row: AttachmentRow = {
    id,
    owner_id: ownerId,
    entry_id: null,
    position: 0,
    caption: null,
    ...meta,
    file_key: key,
    poster_key: null,
    upload_id: upload.uploadId,
    created_at: createdAt,
    uploaded_at: null,
    loose_since: now
  };
  await prepInsert(db, 'attachments', { ...row }).run();
  return row;
}

/** The extension of a name, for the key: lower case, letters and digits; `bin` when there is none. */
export function extOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? m[1].toLowerCase() : 'bin';
}

export const fileKeyOf = (ownerId: string, id: string, name: string): string => `a/${ownerId}/${id}.${extOf(name)}`;
export const posterKeyOf = (ownerId: string, id: string, ext: 'webp' | 'jpg'): string => `a/${ownerId}/${id}.poster.${ext}`;

export const partsOf = (size: number): number => Math.max(1, Math.ceil(size / ATTACHMENT_PART_BYTES));

/** How long part `n` (from 1) of a file of `size` bytes is: `ATTACHMENT_PART_BYTES`, the last one the rest. */
export function partLength(size: number, n: number): number {
  const parts = partsOf(size);
  return n < parts ? ATTACHMENT_PART_BYTES : size - (parts - 1) * ATTACHMENT_PART_BYTES;
}

/** What deleting an attachment's files takes: its R2 keys, and an upload not completed. */
export type AttachmentFiles = Pick<AttachmentRow, 'id' | 'file_key' | 'poster_key' | 'upload_id'>;
export const FILE_COLS = 'id, file_key, poster_key, upload_id';

/** Of `rows`, the R2 objects to delete and the uploads to abort; a failure is logged, not thrown. */
export async function deleteAttachmentFiles(bucket: R2Bucket, rows: AttachmentFiles[]): Promise<void> {
  for (const r of rows) {
    if (!r.upload_id) continue;
    try {
      await bucket.resumeMultipartUpload(r.file_key, r.upload_id).abort();
    } catch (e) {
      // R2 also aborts what was left unfinished after 7 days
      console.error('attachments: abort failed', r.id, e instanceof Error ? e.message : e);
    }
  }
  const keys = rows.flatMap((r) => (r.upload_id ? [] : [r.file_key])).concat(rows.flatMap((r) => (r.poster_key ? [r.poster_key] : [])));
  for (let i = 0; i < keys.length; i += 1000) {
    try {
      await bucket.delete(keys.slice(i, i + 1000));
    } catch (e) {
      console.error('attachments: R2 delete failed', e instanceof Error ? e.message : e);
    }
  }
}

// ---- serving ------------------------------------------------------------------------------------------------------

/** RFC 6266: the name for old browsers in ASCII, and in full as UTF-8 (RFC 5987). */
export function contentDisposition(name: string, inline: boolean): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * The one range of `Range: bytes=…` over a file of `size` bytes: `{ offset, length }`, null to send it all (no header,
 * one that is not about bytes or names several ranges), or 'unsatisfiable' (416) for a range past its end.
 */
export function parseRange(header: string | undefined, size: number): { offset: number; length: number } | null | 'unsatisfiable' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  if (a === '') {
    // the last b bytes
    const n = Number(b);
    if (n === 0) return 'unsatisfiable';
    const length = Math.min(n, size);
    return { offset: size - length, length };
  }
  const start = Number(a);
  if (start >= size) return 'unsatisfiable';
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (end < start) return null;
  return { offset: start, length: end - start + 1 };
}

// ---- loose ones ---------------------------------------------------------------------------------------------------

/**
 * The hourly job: attachments in no entry go, rows first and then their files, a day after an upload that never
 * completed and a week after one came loose (uploaded and never saved in an entry, or taken out of one). An entry
 * deleted some other way leaves its attachments in none, `loose_since` unset: they go a week after their upload.
 */
export async function purgeLooseAttachments(db: D1Database, bucket: R2Bucket, now = Date.now()): Promise<{ purged: number }> {
  const res = await db
    .prepare(
      `DELETE FROM attachments WHERE id IN (
         SELECT id FROM attachments WHERE entry_id IS NULL
           AND coalesce(loose_since, uploaded_at, created_at) < CASE WHEN uploaded_at IS NULL THEN ?1 ELSE ?2 END
         ORDER BY loose_since LIMIT 200)
       RETURNING ${FILE_COLS}`
    )
    .bind(iso(now - DAY), iso(now - 7 * DAY))
    .all<AttachmentFiles>();
  if (res.results.length) await deleteAttachmentFiles(bucket, res.results);
  return { purged: res.results.length };
}
