import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Role, SessionUser } from '../../shared/types';
import { randomToken } from './crypto';
import { forbidden, unauthenticated, type Ctx } from './http';
import { nowIso } from './sql';

export const SESSION_COOKIE = 'living_session';
export const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

interface UserRow {
  id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_photo_id: string | null;
  role: Role;
}

export const USER_COLS = 'id, handle, display_name, bio, avatar_photo_id, role';

export function toSessionUser(r: UserRow): SessionUser {
  return { id: r.id, handle: r.handle, displayName: r.display_name, bio: r.bio, avatarPhotoId: r.avatar_photo_id, role: r.role };
}

/** Creates the KV session and sets the cookie. */
export async function startSession(c: Ctx, userId: string): Promise<void> {
  // A fresh token per sign-in; retire the one this browser presented, if any.
  const previous = getCookie(c, SESSION_COOKIE);
  if (previous && TOKEN_RE.test(previous)) await c.env.KV.delete(`sess:${previous}`).catch(() => {});
  const token = randomToken(32);
  await c.env.KV.put(`sess:${token}`, JSON.stringify({ userId, createdAt: nowIso() }), { expirationTtl: SESSION_TTL });
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL });
}

export async function endSession(c: Ctx): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token && TOKEN_RE.test(token)) await c.env.KV.delete(`sess:${token}`);
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
}

async function lookupUserId(c: Ctx): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !TOKEN_RE.test(token)) return null;
  try {
    const v = await c.env.KV.get<{ userId?: string }>(`sess:${token}`, 'json');
    return typeof v?.userId === 'string' ? v.userId : null;
  } catch {
    return null;
  }
}

/** The signed-in user's id from KV alone (cheap; enough for visibility filters). Memoised per request. */
export function viewerId(c: Ctx): Promise<string | null> {
  let p = c.get('uid');
  if (!p) {
    p = lookupUserId(c);
    c.set('uid', p);
  }
  return p;
}

async function lookupUser(c: Ctx): Promise<SessionUser | null> {
  const id = await viewerId(c);
  if (!id) return null;
  const row = await c.env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?1`).bind(id).first<UserRow>();
  return row ? toSessionUser(row) : null;
}

/** The signed-in user (KV + D1), or null. Memoised per request. */
export function currentUser(c: Ctx): Promise<SessionUser | null> {
  let p = c.get('user');
  if (!p) {
    p = lookupUser(c);
    c.set('user', p);
  }
  return p;
}

export async function requireUser(c: Ctx): Promise<SessionUser> {
  const user = await currentUser(c);
  if (!user) throw unauthenticated();
  return user;
}

export function requireRole(user: SessionUser, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw forbidden('只有站长或管理员可以执行这个操作');
}

export const isStaff = (user: { role: Role }): boolean => user.role === 'owner' || user.role === 'admin';
