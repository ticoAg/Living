import { Hono } from 'hono';
import type { Variants, Visibility } from '../../shared/types';
import type { AppEnv } from '../env';
import { servedAs } from '../../shared/attachments';
import { attachmentCols, contentDisposition, parseRange, type AttachmentRow } from '../lib/attachments';
import { etagMatches, notFound, ID_RE, REFERRER_POLICY, type Ctx } from '../lib/http';
import { mediaCacheKey } from '../lib/mediaCache';
import { viewerId } from '../lib/session';
import { grantFor } from '../lib/shares';
import { parseJson, prepQ, Sql } from '../lib/sql';
import { entryById } from '../lib/visibility';

export const media = new Hono<AppEnv>({ strict: false });

const VARIANT_FILE = /^[sml]\.(webp|jpg)$/;
const ORIGINAL_FILE = /^[A-Za-z0-9_-]{1,64}\.[a-z0-9]{1,5}$/;
const PUBLIC_CACHE = 'public, max-age=31536000, immutable';
const PRIVATE_CACHE = 'private, no-store';
/** On every media response, including edge-cache hits stored before these headers existed. */
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': REFERRER_POLICY };

/** Serves an R2 object with ETag/304 support. `onlyIf` lets R2 evaluate If-None-Match without reading the body. */
async function serve(
  c: Ctx,
  key: string,
  cacheControl: string,
  extra: Record<string, string> = {}
): Promise<{ res: Response; full: boolean }> {
  const obj = await c.env.MEDIA.get(key, { onlyIf: c.req.raw.headers });
  if (!obj) throw notFound('文件不存在');
  const headers = new Headers({
    'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
    ETag: obj.httpEtag,
    'Cache-Control': cacheControl,
    ...SECURITY,
    ...extra
  });
  if (!('body' in obj) || !obj.body) return { res: new Response(null, { status: 304, headers }), full: false };
  headers.set('Content-Length', String(obj.size));
  return { res: new Response(obj.body, { status: 200, headers }), full: true };
}

media.get('/v/:photoId/:file', async (c) => {
  const photoId = c.req.param('photoId');
  const file = c.req.param('file');
  if (!ID_RE.test(photoId) || !VARIANT_FILE.test(file)) throw notFound('文件不存在');
  const key = `v/${photoId}/${file}`;
  const origin = new URL(c.req.url).origin;
  const cache = caches.default;
  const cacheKey = mediaCacheKey(origin, key);

  // Edge copy of a public size: no D1, no R2. A broken cache must never break the image, so lookups fail open.
  const hit = await cache.match(cacheKey).catch(() => undefined);
  if (hit) {
    const etag = hit.headers.get('ETag');
    if (etag && etagMatches(c.req.header('if-none-match'), etag)) {
      return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': PUBLIC_CACHE, ...SECURITY } });
    }
    // a cached response's headers are immutable: copy it to add the security headers
    const res = new Response(hit.body, hit);
    for (const [k, v] of Object.entries(SECURITY)) res.headers.set(k, v);
    return res;
  }

  const row = await c.env.DB.prepare('SELECT owner_id, visibility, variants FROM photos WHERE id = ?1')
    .bind(photoId)
    .first<{ owner_id: string; visibility: Visibility; variants: string }>();
  if (!row) throw notFound('文件不存在');
  const variants = parseJson<Variants>(row.variants);
  if (!variants || !Object.values(variants).some((v) => v.key === key)) throw notFound('文件不存在');

  const isPrivate = row.visibility === 'private';
  // a private photo: its owner, or a browser holding a share link to something that shows it (lib/shares.ts)
  if (isPrivate && (await viewerId(c)) !== row.owner_id && (await grantFor(c, 'photo', photoId)) !== row.owner_id) {
    throw notFound('文件不存在');
  }

  const { res, full } = await serve(c, key, isPrivate ? PRIVATE_CACHE : PUBLIC_CACHE);
  if (!isPrivate && full) c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
  return res;
});

media.get('/o/:ownerId/:file', async (c) => {
  const ownerId = c.req.param('ownerId');
  const file = c.req.param('file');
  if (!ID_RE.test(ownerId) || !ORIGINAL_FILE.test(file)) throw notFound('文件不存在');
  // Originals (with their EXIF) are for the owner only.
  if ((await viewerId(c)) !== ownerId) throw notFound('文件不存在');
  const { res } = await serve(c, `o/${ownerId}/${file}`, PRIVATE_CACHE, { 'Content-Disposition': 'inline' });
  return res;
});

// ---- attachments (docs/api/attachments.md#文件) ---------------------------------------------------------------------

interface Opened {
  row: AttachmentRow;
  /** in a finished public entry: anyone may see it */
  everyone: boolean;
  /** opened through a share link this browser holds */
  shared: boolean;
}

/**
 * An attachment as the request may open it: its author's, or in an entry the requester may open by id, by its
 * visibility or a share link reaching it (lib/shares.ts). Loose ones and unfinished uploads are their author's alone.
 */
async function openAttachment(c: Ctx, id: string): Promise<Opened> {
  if (!ID_RE.test(id)) throw notFound('文件不存在');
  const viewer = await viewerId(c);
  const q = new Sql();
  const row = await prepQ(
    c.env.DB,
    `SELECT ${attachmentCols('a')}, ${viewer ? `a.owner_id = ${q.p(viewer)}` : '0'} AS own,
       e.id IS NOT NULL AND ${entryById(q, viewer, 'e')} AS open,
       e.id IS NOT NULL AND e.visibility = 'public' AND e.status = 'published' AS everyone
     FROM attachments a LEFT JOIN entries e ON e.id = a.entry_id
     WHERE a.id = ${q.p(id)} AND a.uploaded_at IS NOT NULL`,
    q
  ).first<AttachmentRow & { own: number; open: number; everyone: number }>();
  if (!row) throw notFound('文件不存在');
  if (row.own || row.open) return { row, everyone: row.everyone === 1, shared: false };
  if (row.entry_id) {
    const grant = await grantFor(c, 'entry', row.entry_id);
    if (grant) {
      const qg = new Sql();
      const ok = await prepQ(
        c.env.DB,
        `SELECT 1 AS ok FROM entries e WHERE e.id = ${qg.p(row.entry_id)} AND ${entryById(qg, viewer, 'e', grant)}`,
        qg
      ).first();
      if (ok) return { row, everyone: false, shared: true };
    }
  }
  throw notFound('文件不存在');
}

/** Only this site may embed them; what is not a PDF opens, if at all, with nothing allowed to run. */
const ATTACHMENT_HEADERS = { 'Cross-Origin-Resource-Policy': 'same-origin', ...SECURITY };

media.get('/a/:id', async (c) => {
  const { row, shared } = await openAttachment(c, c.req.param('id'));
  const { type, inline } = servedAs(row.kind, row.mime);
  const headers = new Headers({
    'Content-Type': type,
    'Content-Disposition': contentDisposition(row.name, inline && c.req.query('download') === undefined),
    'Accept-Ranges': 'bytes',
    // the file follows its entry's visibility, which may change: kept nowhere but where it is played
    'Cache-Control': PRIVATE_CACHE,
    ...ATTACHMENT_HEADERS
  });
  if (type !== 'application/pdf') headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  if (shared) headers.set('Vary', 'Cookie');
  const range = parseRange(c.req.header('range'), row.size);
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${row.size}`);
    return new Response(null, { status: 416, headers });
  }
  const obj = await c.env.MEDIA.get(row.file_key, range ? { range } : {});
  if (!obj || !('body' in obj) || !obj.body) throw notFound('文件不存在');
  headers.set('ETag', obj.httpEtag);
  if (!range) {
    headers.set('Content-Length', String(row.size));
    return new Response(obj.body, { status: 200, headers });
  }
  headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${row.size}`);
  headers.set('Content-Length', String(range.length));
  return new Response(obj.body, { status: 206, headers });
});

media.get('/a/:id/poster', async (c) => {
  const { row, everyone, shared } = await openAttachment(c, c.req.param('id'));
  if (!row.poster_key) throw notFound('文件不存在');
  // a frame in a public entry may stay in the browser for an hour; anything else is not kept
  const { res } = await serve(c, row.poster_key, everyone ? 'private, max-age=3600' : PRIVATE_CACHE, ATTACHMENT_HEADERS);
  if (shared) res.headers.set('Vary', 'Cookie');
  return res;
});
