// Living — one Worker: JSON API (/api), media from R2 (/media), and the SPA via static assets.
// Contract: /docs/api/

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './env';
import { forbidden, HttpError } from './lib/http';
import { admin } from './routes/admin';
import { auth } from './routes/auth';
import { me } from './routes/me';
import { media } from './routes/media';
import { photos } from './routes/photos';
import { pois } from './routes/pois';
import { privacyZones } from './routes/privacyZones';
import { site } from './routes/site';
import { tags } from './routes/tags';
import { themes } from './routes/themes';
import { users } from './routes/users';

const app = new Hono<AppEnv>({ strict: false });

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const isLoopback = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/** `Origin` must be this site. In local development the Vite dev server (another loopback port) is allowed too. */
function originAllowed(origin: string, self: URL, siteUrl: string | undefined): boolean {
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false; // "null" and garbage
  }
  if (o.origin === self.origin) return true;
  try {
    if (siteUrl && o.origin === new URL(siteUrl).origin) return true;
  } catch {
    // misconfigured SITE_URL: ignore
  }
  return isLoopback(self.hostname) && isLoopback(o.hostname);
}

// Writes must come from the site itself (CSRF). Clients that send neither Origin nor Sec-Fetch-Site are not browsers.
app.use('/api/*', async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin) {
      if (!originAllowed(origin, new URL(c.req.url), c.env.SITE_URL)) throw forbidden('不允许跨站请求');
    } else {
      const fetchSite = c.req.header('sec-fetch-site');
      if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw forbidden('不允许跨站请求');
    }
  }
  await next();
});

// API responses are never cached unless a handler opts in (public lists, media).
app.use('/api/*', async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
});

app.route('/api/site', site);
app.route('/api/auth', auth);
app.route('/api/me', me);
app.route('/api/users', users);
app.route('/api/photos', photos);
app.route('/api/tags', tags);
app.route('/api/pois', pois);
app.route('/api/themes', themes);
app.route('/api/privacy-zones', privacyZones);
app.route('/api/admin', admin);
app.route('/media', media);

const NOT_FOUND = { error: 'not_found', message: '接口不存在' };

app.notFound((c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/') || path === '/api') return c.json(NOT_FOUND, 404, { 'Cache-Control': 'no-store' });
  if (path.startsWith('/media/')) return c.json({ error: 'not_found', message: '文件不存在' }, 404, { 'Cache-Control': 'no-store' });
  // Anything else belongs to the SPA (normally served before the Worker runs).
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.code, message: err.message, ...err.extra }, err.status as ContentfulStatusCode, { 'Cache-Control': 'no-store' });
  }
  if (err instanceof HTTPException) {
    const status = err.status as ContentfulStatusCode;
    const error = status === 400 ? 'invalid_input' : status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 413 ? 'too_large' : 'invalid_input';
    return c.json({ error, message: err.message || '请求有误' }, status, { 'Cache-Control': 'no-store' });
  }
  console.error('unhandled error', c.req.method, new URL(c.req.url).pathname, err instanceof Error ? (err.stack ?? err.message) : err);
  return c.json({ error: 'internal', message: '服务器出错了，请稍后再试' }, 500, { 'Cache-Control': 'no-store' });
});

export default app;
