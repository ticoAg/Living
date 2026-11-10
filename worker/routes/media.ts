import { Hono } from 'hono';
import type { Variants, Visibility } from '../../shared/types';
import type { AppEnv } from '../env';
import { etagMatches, notFound, ID_RE, REFERRER_POLICY, type Ctx } from '../lib/http';
import { mediaCacheKey } from '../lib/mediaCache';
import { viewerId } from '../lib/session';
import { parseJson } from '../lib/sql';

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
  if (isPrivate && (await viewerId(c)) !== row.owner_id) throw notFound('文件不存在');

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
