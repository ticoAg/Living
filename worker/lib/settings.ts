// Site settings kept in the D1 `settings` table. docs/api/users-admin.md

import type { SiteInfo } from '../../shared/types';

export type Registration = SiteInfo['registration'];
export const REGISTRATION_MODES: readonly Registration[] = ['invite', 'open', 'closed'];

/** A stored registration mode; anything missing or unknown reads as `invite`, the safe default. */
export const asRegistration = (value: unknown): Registration =>
  REGISTRATION_MODES.includes(value as Registration) ? (value as Registration) : 'invite';

export async function getRegistration(db: D1Database): Promise<Registration> {
  const row = await db.prepare(`SELECT value FROM settings WHERE key = 'registration'`).first<{ value: string }>();
  return asRegistration(row?.value);
}
