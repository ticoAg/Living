import { Hono } from 'hono';
import type { Role } from '../../shared/types';
import type { AppEnv } from '../env';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../lib/crypto';
import { forbidden, invalid, readJson, rateLimited, conflict, unauthenticated } from '../lib/http';
import { newId } from '../lib/ids';
import { clear, clientIp, hit } from '../lib/ratelimit';
import { currentUser, endSession, startSession, toSessionUser, USER_COLS } from '../lib/session';
import { isUniqueViolation, nowIso, prep } from '../lib/sql';
import { reqStr } from '../lib/validate';
import { getRegistration } from './site';

export const auth = new Hono<AppEnv>({ strict: false });

const HANDLE_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,23}$/;
const RESERVED = new Set(
  'admin api media living login register settings studio themes upload map index place t p www root owner'.split(' ')
);

interface InviteRow {
  code: string;
  role: Role;
  used_by: string | null;
  used_at: string | null;
  expires_at: string | null;
}

auth.get('/me', async (c) => {
  return c.json({ user: await currentUser(c) });
});

auth.post('/register', async (c) => {
  const body = await readJson(c);
  const db = c.env.DB;

  const [{ n: userCount }, registration] = await Promise.all([
    db
      .prepare('SELECT COUNT(*) AS n FROM users')
      .first<{ n: number }>()
      .then((r) => r ?? { n: 0 }),
    getRegistration(db)
  ]);
  const needsSetup = userCount === 0;
  if (!needsSetup && registration === 'closed') throw forbidden('站点暂不开放注册');

  const handle = reqStr(body, 'handle', '用户名', 3, 24);
  if (!HANDLE_RE.test(handle)) throw invalid('用户名需要 3 到 24 个字符，只能包含字母、数字、下划线和连字符，并以字母或数字开头');
  if (RESERVED.has(handle.toLowerCase())) throw invalid('这个用户名已被站点保留，请换一个');
  const displayName = reqStr(body, 'displayName', '显示名', 1, 40);
  const password = body.password;
  if (typeof password !== 'string' || password.length < 8) throw invalid('密码至少需要 8 个字符');
  if (password.length > 256) throw invalid('密码最多 256 个字符');

  const rawInvite = typeof body.invite === 'string' ? body.invite.trim() : '';
  let invite: InviteRow | null = null;
  if (needsSetup && !rawInvite) throw invalid('站点还没有账号：请输入站长邀请码来创建第一个账号');
  if (!needsSetup && registration === 'invite' && !rawInvite) throw invalid('注册需要邀请码，请向站长或管理员索取');
  if (rawInvite) {
    invite = await db
      .prepare('SELECT code, role, used_by, used_at, expires_at FROM invites WHERE code = ?1 COLLATE NOCASE')
      .bind(rawInvite)
      .first<InviteRow>();
    const expired = invite?.expires_at ? invite.expires_at <= nowIso() : false;
    if (!invite || invite.used_by || invite.used_at || expired) throw invalid('邀请码无效、已被使用或已过期');
    if (needsSetup && invite.role !== 'owner') throw invalid('第一个账号需要站长邀请码');
  }

  const taken = await db.prepare('SELECT 1 AS x FROM users WHERE handle = ?1').bind(handle).first();
  if (taken) throw conflict('这个用户名已被占用，请换一个');

  const id = newId.user();
  const role: Role = invite?.role ?? 'member';
  const now = nowIso();
  const passwordHash = await hashPassword(password);

  // The insert only goes through while the invite is still unused (and, during setup, while no user exists),
  // so two concurrent registrations cannot both consume one invite.
  const statements = [
    prep(
      db,
      `INSERT INTO users (id, handle, display_name, role, password_hash, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6
       WHERE (?7 IS NULL OR EXISTS (SELECT 1 FROM invites WHERE code = ?7 AND used_by IS NULL AND used_at IS NULL AND (expires_at IS NULL OR expires_at > ?6)))
         AND (?8 = 0 OR NOT EXISTS (SELECT 1 FROM users))`,
      id,
      handle,
      displayName,
      role,
      passwordHash,
      now,
      invite?.code ?? null,
      needsSetup ? 1 : 0
    )
  ];
  if (invite) {
    statements.push(
      prep(
        db,
        'UPDATE invites SET used_by = ?1, used_at = ?2 WHERE code = ?3 AND used_by IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ?1)',
        id,
        now,
        invite.code
      )
    );
  }
  try {
    const results = await db.batch(statements);
    if (results[0].meta.changes !== 1) throw conflict(needsSetup ? '站点已经完成初始化，请刷新页面后重试' : '邀请码刚刚被使用了，请换一个');
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('这个用户名已被占用，请换一个');
    throw e;
  }

  await startSession(c, id);
  const row = await db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?1`).bind(id).first<Parameters<typeof toSessionUser>[0]>();
  return c.json({ user: toSessionUser(row!) }, 201);
});

auth.post('/login', async (c) => {
  const body = await readJson(c);
  const handle = typeof body.handle === 'string' ? body.handle.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!handle || !password) throw invalid('请输入用户名和密码');
  if (handle.length > 64 || password.length > 256) throw unauthenticated('用户名或密码不对');

  const rlKey = `rl:login:${clientIp(c)}:${handle.toLowerCase()}`;
  const limit = await hit(c.env.KV, rlKey, 5, 60);
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfter));
    throw rateLimited('登录尝试过多，请一分钟后再试');
  }

  const row = await c.env.DB.prepare(`SELECT ${USER_COLS}, password_hash FROM users WHERE handle = ?1`)
    .bind(handle)
    .first<Parameters<typeof toSessionUser>[0] & { password_hash: string }>();
  // Always run a verification so unknown handles cost the same as wrong passwords.
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw unauthenticated('用户名或密码不对');

  await clear(c.env.KV, rlKey);
  await startSession(c, row.id);
  return c.json({ user: toSessionUser(row) });
});

auth.post('/logout', async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});
