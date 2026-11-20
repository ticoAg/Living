// Share links (分享链接): the owner makes, lists and deletes them; anyone opens one. Opening checks the link and hands
// its token to the browser (cookie); the reading routes then let that browser see what the link shares (lib/shares.ts).
// Contract: /docs/api/shares.md

import { Hono } from 'hono';
import { entryLabel, entryTypeLabel } from '../../shared/entries';
import {
  SHARE_DAYS_MAX,
  SHARE_KINDS,
  SHARE_LIMITS,
  type CreateShareBody,
  type OpenShareResponse,
  type ShareKind,
  type ShareLink
} from '../../shared/types';
import type { AppEnv } from '../env';
import { randomToken } from '../lib/crypto';
import { invalid, notFound, paramId, readJson } from '../lib/http';
import { newId } from '../lib/ids';
import { requireUser } from '../lib/session';
import { holdShare, liveGrants, SHARE_TOKEN_RE } from '../lib/shares';
import { nowIso, prep, prepQ, Sql } from '../lib/sql';
import { optEnum, optNum } from '../lib/validate';

export const shares = new Hono<AppEnv>({ strict: false });

/** The column naming each kind of item, and its table. */
const TARGET: Record<ShareKind, { col: 'entry_id' | 'theme_id' | 'project_id'; table: string }> = {
  entry: { col: 'entry_id', table: 'entries' },
  theme: { col: 'theme_id', table: 'themes' },
  project: { col: 'project_id', table: 'projects' }
};

const GONE = '链接不存在或已失效';

interface ShareRow {
  id: string;
  token: string;
  entry_id: string | null;
  theme_id: string | null;
  project_id: string | null;
  created_at: string;
  expires_at: string | null;
  entry_title: string | null;
  entry_body: string | null;
  entry_type: string | null;
  theme_title: string | null;
  project_title: string | null;
}

const SHARE_COLS = `s.id, s.token, s.entry_id, s.theme_id, s.project_id, s.created_at, s.expires_at,
  e.title AS entry_title, substr(e.body, 1, 200) AS entry_body, e.type AS entry_type, th.title AS theme_title, pj.title AS project_title`;
const SHARE_FROM = `share_links s LEFT JOIN entries e ON e.id = s.entry_id LEFT JOIN themes th ON th.id = s.theme_id
  LEFT JOIN projects pj ON pj.id = s.project_id`;

function toShare(r: ShareRow): ShareLink {
  const base = { id: r.id, token: r.token, createdAt: r.created_at, expiresAt: r.expires_at };
  if (r.entry_id) {
    const title = entryLabel(r.entry_title, r.entry_body, 40) || entryTypeLabel(r.entry_type ?? 'note');
    return { ...base, kind: 'entry', targetId: r.entry_id, targetTitle: title };
  }
  if (r.theme_id) return { ...base, kind: 'theme', targetId: r.theme_id, targetTitle: r.theme_title ?? '' };
  return { ...base, kind: 'project', targetId: r.project_id as string, targetTitle: r.project_title ?? '' };
}

/** `?kind=&id=`: the links of one item; neither: all of one's links. Newest first, expired ones included. */
shares.get('/', async (c) => {
  const user = await requireUser(c);
  const kind = optEnum<ShareKind>(c.req.query('kind'), '类型', SHARE_KINDS);
  const id = c.req.query('id');
  if (Boolean(kind) !== Boolean(id)) throw invalid('kind 和 id 需要一起给出');
  const q = new Sql();
  const where = [`s.owner_id = ${q.p(user.id)}`];
  if (kind && id) where.push(`s.${TARGET[kind].col} = ${q.p(id)}`);
  const res = await prepQ(
    c.env.DB,
    `SELECT ${SHARE_COLS} FROM ${SHARE_FROM} WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC, s.id DESC`,
    q
  ).all<ShareRow>();
  return c.json({ shares: res.results.map(toShare) });
});

shares.post('/', async (c) => {
  const user = await requireUser(c);
  const body = (await readJson(c)) as Partial<CreateShareBody> & Record<string, unknown>;
  const kind = optEnum<ShareKind>(body.kind, '分享的类型', SHARE_KINDS);
  if (!kind) throw invalid('请说明分享的是记录（entry）、合集（theme）还是项目（project）');
  if (typeof body.id !== 'string' || !body.id) throw invalid('缺少要分享的 id');
  const days = optNum(body.expiresInDays, '有效天数', { int: true, min: 1, max: SHARE_DAYS_MAX });
  const db = c.env.DB;
  const { col, table } = TARGET[kind];

  // only one's own items; someone else's answers as if it did not exist
  const [own, counts] = await Promise.all([
    db.prepare(`SELECT owner_id FROM ${table} WHERE id = ?1`).bind(body.id).first<{ owner_id: string }>(),
    db
      .prepare(`SELECT COUNT(*) AS mine, SUM(${col} = ?2) AS here FROM share_links WHERE owner_id = ?1`)
      .bind(user.id, body.id)
      .first<{ mine: number; here: number | null }>()
  ]);
  if (!own || own.owner_id !== user.id) throw notFound('要分享的内容不存在');
  if ((counts?.here ?? 0) >= SHARE_LIMITS.perItem) throw invalid(`一项内容最多 ${SHARE_LIMITS.perItem} 个分享链接，请先删掉不用的`);
  if ((counts?.mine ?? 0) >= SHARE_LIMITS.perOwner) throw invalid(`分享链接最多 ${SHARE_LIMITS.perOwner} 个，请先删掉不用的`);

  const id = newId.share();
  const now = nowIso();
  const expiresAt = days ? new Date(Date.parse(now) + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
  await prep(
    db,
    `INSERT INTO share_links (id, token, owner_id, ${col}, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    id,
    randomToken(18),
    user.id,
    body.id,
    now,
    expiresAt
  ).run();
  const row = await db.prepare(`SELECT ${SHARE_COLS} FROM ${SHARE_FROM} WHERE s.id = ?1`).bind(id).first<ShareRow>();
  return c.json({ share: toShare(row as ShareRow) }, 201);
});

/** Opening a link: anyone with it. The answer names the item; the browser now holds the link. */
shares.post('/open', async (c) => {
  const body = await readJson(c);
  const token = typeof body.token === 'string' ? body.token : '';
  if (!SHARE_TOKEN_RE.test(token)) throw notFound(GONE);
  const db = c.env.DB;
  const grant = (await liveGrants(db, [token]))[0];
  if (!grant) throw notFound(GONE);
  // a shared entry opens only while it is finished, as entries do for anyone but their author
  if (grant.kind === 'entry') {
    const e = await db.prepare('SELECT status FROM entries WHERE id = ?1').bind(grant.target).first<{ status: string }>();
    if (e?.status !== 'published') throw notFound(GONE);
  }
  await holdShare(c, token);
  return c.json({ kind: grant.kind, id: grant.target } satisfies OpenShareResponse);
});

shares.delete('/:id', async (c) => {
  const user = await requireUser(c);
  const res = await c.env.DB.prepare('DELETE FROM share_links WHERE id = ?1 AND owner_id = ?2').bind(paramId(c), user.id).run();
  if (!res.meta.changes) throw notFound('分享链接不存在');
  return c.json({ ok: true });
});
