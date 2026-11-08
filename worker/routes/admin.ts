import { Hono } from 'hono';
import type { Invite, Role } from '../../shared/types';
import type { AppEnv } from '../env';
import { conflict, forbidden, invalid, notFound, readJson } from '../lib/http';
import { inviteCode } from '../lib/ids';
import { requireRole, requireUser } from '../lib/session';
import { addDaysIso, isUniqueViolation, nowIso, prep } from '../lib/sql';
import { has, optEnum, optNum, optText } from '../lib/validate';
import { REGISTRATION_MODES, getRegistration, type Registration } from './site';

export const admin = new Hono<AppEnv>({ strict: false });

interface InviteRow {
  code: string;
  role: Role;
  note: string | null;
  used_by: string | null;
  used_by_handle: string | null;
  used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

const toInvite = (r: InviteRow): Invite => ({
  code: r.code,
  role: r.role,
  note: r.note,
  usedBy: r.used_by,
  usedByHandle: r.used_by_handle,
  usedAt: r.used_at,
  expiresAt: r.expires_at,
  createdAt: r.created_at
});

const INVITE_SELECT = `SELECT i.code, i.role, i.note, i.used_by, u.handle AS used_by_handle, i.used_at, i.expires_at, i.created_at
  FROM invites i LEFT JOIN users u ON u.id = i.used_by`;

admin.get('/invites', async (c) => {
  requireRole(await requireUser(c), 'owner', 'admin');
  const res = await c.env.DB.prepare(`${INVITE_SELECT} ORDER BY i.created_at DESC, i.rowid DESC`).all<InviteRow>();
  return c.json({ invites: res.results.map(toInvite) });
});

admin.post('/invites', async (c) => {
  const user = await requireUser(c);
  requireRole(user, 'owner', 'admin');
  const body = await readJson(c);
  const role = optEnum<'member' | 'admin'>(body.role, '角色', ['member', 'admin']) ?? 'member';
  if (role === 'admin' && user.role !== 'owner') throw forbidden('只有站长可以生成管理员邀请码');
  const note = optText(body.note, '备注', 200);
  const days = optNum(body.expiresInDays, '有效天数', { min: 1, max: 365, int: true });
  const expiresAt = days === null ? null : addDaysIso(days);
  const db = c.env.DB;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = inviteCode();
    try {
      await prep(
        db,
        'INSERT INTO invites (code, created_by, role, note, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
        code,
        user.id,
        role,
        note,
        expiresAt,
        nowIso()
      ).run();
    } catch (e) {
      if (isUniqueViolation(e)) continue; // the 31^10 space makes this practically unreachable
      throw e;
    }
    const row = await db.prepare(`${INVITE_SELECT} WHERE i.code = ?1`).bind(code).first<InviteRow>();
    return c.json({ invite: toInvite(row as InviteRow) }, 201);
  }
  throw new Error('could not generate a unique invite code');
});

admin.delete('/invites/:code', async (c) => {
  requireRole(await requireUser(c), 'owner', 'admin');
  const code = c.req.param('code');
  if (!/^[A-Za-z0-9]{1,32}$/.test(code)) throw notFound('邀请码不存在');
  const row = await c.env.DB.prepare('SELECT used_by, used_at FROM invites WHERE code = ?1 COLLATE NOCASE')
    .bind(code)
    .first<{ used_by: string | null; used_at: string | null }>();
  if (!row) throw notFound('邀请码不存在');
  if (row.used_by || row.used_at) throw conflict('这个邀请码已经被使用，不能删除');
  await c.env.DB.prepare('DELETE FROM invites WHERE code = ?1 COLLATE NOCASE AND used_by IS NULL').bind(code).run();
  return c.json({ ok: true });
});

admin.get('/settings', async (c) => {
  requireRole(await requireUser(c), 'owner', 'admin');
  return c.json({ registration: await getRegistration(c.env.DB) });
});

admin.patch('/settings', async (c) => {
  requireRole(await requireUser(c), 'owner', 'admin');
  const body = await readJson(c);
  if (!has(body, 'registration')) throw invalid('请提供 registration');
  const registration = optEnum<Registration>(body.registration, '注册方式', REGISTRATION_MODES);
  await c.env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('registration', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
    .bind(registration)
    .run();
  return c.json({ registration: await getRegistration(c.env.DB) });
});
