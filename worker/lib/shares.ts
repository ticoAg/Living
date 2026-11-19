// Share links (分享链接): the address /s/<token> opens one entry, collection (theme) or project for whoever holds it,
// with what is shown in it, until its owner deletes the link or it runs out. A browser that opened a link keeps the
// token in a cookie; the reading routes ask `grantFor` whether one of the links it holds reaches what is asked for,
// and if so read as the visibility helpers' `grant` (lib/visibility.ts). Docs: /docs/api/shares.md

import { getCookie, setCookie } from 'hono/cookie';
import type { ShareKind } from '../../shared/types';
import type { Ctx } from './http';
import { nowIso, prepQ, Sql } from './sql';

export const SHARE_COOKIE = 'living_shares';
/** 18 random bytes as base64url. */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
/** Links one browser holds; opening one more lets the oldest go. */
const HELD_MAX = 20;
/** The cookie only remembers which links this browser opened; every request checks the links themselves. */
const COOKIE_TTL = 60 * 60 * 24 * 365;

export interface Grant {
  token: string;
  kind: ShareKind;
  target: string;
  owner: string;
}

interface GrantRow {
  token: string;
  owner_id: string;
  entry_id: string | null;
  theme_id: string | null;
  project_id: string | null;
}

function toGrant(r: GrantRow): Grant {
  const [kind, target] = r.entry_id
    ? (['entry', r.entry_id] as const)
    : r.theme_id
      ? (['theme', r.theme_id] as const)
      : (['project', r.project_id as string] as const);
  return { token: r.token, kind, target, owner: r.owner_id };
}

/** The tokens in this browser's cookie, newest first, well-formed ones only. */
function heldTokens(c: Ctx): string[] {
  const raw = getCookie(c, SHARE_COOKIE);
  if (!raw) return [];
  return [...new Set(raw.split('.').filter((t) => SHARE_TOKEN_RE.test(t)))].slice(0, HELD_MAX);
}

/** Of `tokens`, the links that still work: not deleted, not past their time. */
export async function liveGrants(db: D1Database, tokens: string[]): Promise<Grant[]> {
  if (!tokens.length) return [];
  const res = await db
    .prepare(
      `SELECT token, owner_id, entry_id, theme_id, project_id FROM share_links
       WHERE token IN (SELECT value FROM json_each(?1)) AND (expires_at IS NULL OR expires_at > ?2)`
    )
    .bind(JSON.stringify(tokens), nowIso())
    .all<GrantRow>();
  const byToken = new Map(res.results.map((r) => [r.token, toGrant(r)]));
  return tokens.flatMap((t) => byToken.get(t) ?? []);
}

/** The links this browser holds that still work. Memoised per request; without the cookie, no query at all. */
export function shareGrants(c: Ctx): Promise<Grant[]> {
  let p = c.get('shares');
  if (!p) {
    p = liveGrants(c.env.DB, heldTokens(c));
    c.set('shares', p);
  }
  return p;
}

/** Remembers `token` in this browser, ahead of the links it holds that still work. */
export async function holdShare(c: Ctx, token: string): Promise<void> {
  const others = (await liveGrants(c.env.DB, heldTokens(c))).map((g) => g.token).filter((t) => t !== token);
  const tokens = [token, ...others].slice(0, HELD_MAX);
  setCookie(c, SHARE_COOKIE, tokens.join('.'), { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: COOKIE_TTL });
}

/** What a share link may be asked to open: the item itself, or a photo or entry shown in it. */
export type Reachable = ShareKind | 'photo';

/**
 * SQL that is true when a link to a `grantKind` reaches `kind` `x` (bound on the caller's Sql; `item()` binds the link's
 * own item there), or null when that kind of link never reaches that kind of thing, its item then left unbound: a
 * parameter bound and not used fails the statement. What a link reaches is what its item shows:
 *  - an entry: its photos, while it is finished;
 *  - a collection: its photo items, its cover, and its finished entries with their photos;
 *  - a project: its finished entries with their photos.
 * Entries must be finished either way; the loaders check that again through `entryById`.
 */
function reachSql(grantKind: ShareKind, kind: Reachable, item: () => string, x: string): string | null {
  const done = `e.status = 'published'`;
  if (grantKind === 'entry') {
    if (kind !== 'photo') return null;
    const t = item();
    return `EXISTS (SELECT 1 FROM entry_media em JOIN entries e ON e.id = em.entry_id WHERE em.entry_id = ${t} AND em.photo_id = ${x} AND ${done})`;
  }
  if (grantKind === 'theme') {
    if (kind === 'entry') return `EXISTS (SELECT 1 FROM theme_items ti WHERE ti.theme_id = ${item()} AND ti.entry_id = ${x})`;
    if (kind !== 'photo') return null;
    const t = item();
    return `(EXISTS (SELECT 1 FROM theme_items ti WHERE ti.theme_id = ${t} AND ti.photo_id = ${x})
      OR EXISTS (SELECT 1 FROM themes th WHERE th.id = ${t} AND th.cover_photo_id = ${x})
      OR EXISTS (SELECT 1 FROM theme_items ti JOIN entries e ON e.id = ti.entry_id JOIN entry_media em ON em.entry_id = e.id
                 WHERE ti.theme_id = ${t} AND em.photo_id = ${x} AND ${done}))`;
  }
  if (kind === 'entry') return `EXISTS (SELECT 1 FROM entry_projects ep WHERE ep.project_id = ${item()} AND ep.entry_id = ${x})`;
  if (kind !== 'photo') return null;
  return `EXISTS (SELECT 1 FROM entry_projects ep JOIN entries e ON e.id = ep.entry_id JOIN entry_media em ON em.entry_id = e.id
                  WHERE ep.project_id = ${item()} AND em.photo_id = ${x} AND ${done})`;
}

/**
 * The owner whose content a share link held by this browser opens at `kind` `id`, or null: no such link. Pass it to
 * the loaders as their `grant`; they still show only that owner's content, and only finished entries.
 */
export async function grantFor(c: Ctx, kind: Reachable, id: string): Promise<string | null> {
  const grants = await shareGrants(c);
  if (!grants.length) return null;
  const direct = grants.find((g) => g.kind === kind && g.target === id);
  if (direct) return direct.owner;
  const q = new Sql();
  const x = q.p(id);
  const tests: string[] = [];
  for (const g of grants) {
    const reach = reachSql(g.kind, kind, () => q.p(g.target), x);
    if (reach) tests.push(`SELECT ${q.p(g.owner)} AS owner WHERE ${reach}`);
  }
  if (!tests.length) return null;
  const row = await prepQ(c.env.DB, `${tests.join(' UNION ALL ')} LIMIT 1`, q).first<{ owner: string }>();
  return row?.owner ?? null;
}

/** A response read through a share link is for that browser only. */
export function sharedCache(c: Ctx): void {
  c.header('Vary', 'Cookie');
  c.header('Cache-Control', 'private, no-store');
}
