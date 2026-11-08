import { Hono } from 'hono';
import type { SiteInfo } from '../../shared/types';
import type { AppEnv } from '../env';

export const site = new Hono<AppEnv>({ strict: false });

export type Registration = SiteInfo['registration'];
export const REGISTRATION_MODES: readonly Registration[] = ['invite', 'open', 'closed'];

export async function getRegistration(db: D1Database): Promise<Registration> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'registration'`).first<{ value: string }>();
  return REGISTRATION_MODES.includes(row?.value as Registration) ? (row?.value as Registration) : 'invite';
}

site.get('/', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT (SELECT value FROM settings WHERE key = 'registration') AS registration, (SELECT COUNT(*) FROM users) AS users`
  ).first<{ registration: string | null; users: number }>();
  const registration = REGISTRATION_MODES.includes(row?.registration as Registration) ? (row?.registration as Registration) : 'invite';
  const info: SiteInfo = {
    name: c.env.SITE_NAME || 'Living',
    url: c.env.SITE_URL || new URL(c.req.url).origin,
    registration,
    hasAmap: Boolean(c.env.AMAP_KEY),
    needsSetup: (row?.users ?? 0) === 0
  };
  return c.json(info);
});
