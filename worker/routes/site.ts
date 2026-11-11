import { Hono } from 'hono';
import type { SiteInfo } from '../../shared/types';
import type { AppEnv } from '../env';
import { asRegistration } from '../lib/settings';

export const site = new Hono<AppEnv>({ strict: false });

site.get('/', async (c) => {
  // One query for both answers; the registration value is read the same way as getRegistration does.
  const row = await c.env.DB.prepare(
    `SELECT (SELECT value FROM settings WHERE key = 'registration') AS registration, (SELECT COUNT(*) FROM users) AS users`
  ).first<{ registration: string | null; users: number }>();
  const info: SiteInfo = {
    name: c.env.SITE_NAME || 'Living',
    url: c.env.SITE_URL || new URL(c.req.url).origin,
    registration: asRegistration(row?.registration),
    hasAmap: Boolean(c.env.AMAP_KEY),
    needsSetup: (row?.users ?? 0) === 0
  };
  return c.json(info);
});
