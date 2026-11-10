import { Hono } from 'hono';
import { ACCOUNT_LIMITS } from '../../shared/limits';
import type { AppEnv } from '../env';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { invalid, readJson } from '../lib/http';
import { requireUser, toSessionUser, USER_COLS } from '../lib/session';
import { has, optText, reqStr } from '../lib/validate';

export const me = new Hono<AppEnv>({ strict: false });

me.patch('/', async (c) => {
  const user = await requireUser(c);
  const body = await readJson(c);
  const db = c.env.DB;
  const sets: string[] = [];
  const params: (string | null)[] = [];
  const set = (col: string, v: string | null) => {
    params.push(v);
    sets.push(`${col} = ?${params.length}`);
  };

  if (has(body, 'displayName')) set('display_name', reqStr(body, 'displayName', '显示名', 1, ACCOUNT_LIMITS.displayNameMax));
  if (has(body, 'bio')) set('bio', optText(body.bio, '简介', ACCOUNT_LIMITS.bioMax));
  if (has(body, 'avatarPhotoId')) {
    const id = body.avatarPhotoId;
    if (id === null) set('avatar_photo_id', null);
    else {
      if (typeof id !== 'string') throw invalid('头像需要是你自己的一张照片');
      const own = await db.prepare('SELECT 1 AS x FROM photos WHERE id = ?1 AND owner_id = ?2').bind(id, user.id).first();
      if (!own) throw invalid('头像必须是你自己的照片');
      set('avatar_photo_id', id);
    }
  }
  if (sets.length) {
    params.push(user.id);
    await db
      .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?${params.length}`)
      .bind(...params)
      .run();
  }
  const row = await db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?1`).bind(user.id).first<Parameters<typeof toSessionUser>[0]>();
  return c.json({ user: toSessionUser(row!) });
});

me.post('/password', async (c) => {
  const user = await requireUser(c);
  const body = await readJson(c);
  const current = typeof body.current === 'string' ? body.current : '';
  const next = body.next;
  const { passwordMin, passwordMax } = ACCOUNT_LIMITS;
  if (typeof next !== 'string' || next.length < passwordMin) throw invalid(`新密码至少需要 ${passwordMin} 个字符`);
  if (next.length > passwordMax) throw invalid(`新密码最多 ${passwordMax} 个字符`);
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?1').bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) throw invalid('当前密码不对');
  await c.env.DB.prepare('UPDATE users SET password_hash = ?1 WHERE id = ?2')
    .bind(await hashPassword(next), user.id)
    .run();
  return c.json({ ok: true });
});
