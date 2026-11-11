import { Hono } from 'hono';
import { TAG_LIMITS } from '../../shared/limits';
import type { SessionUser } from '../../shared/types';
import type { AppEnv } from '../env';
import { conflict, forbidden, invalid, listCache, notFound, paramId, readJson } from '../lib/http';
import { newId } from '../lib/ids';
import { isStaff, requireUser, viewerId } from '../lib/session';
import { nowIso, prep, prepQ, Sql } from '../lib/sql';
import { tagCount, toTag, type TagRow } from '../lib/tags';
import { has, optColor, optNum, reqStr } from '../lib/validate';
import { photoList } from '../lib/visibility';

export const tags = new Hono<AppEnv>({ strict: false });

const TAG_COLS = 'id, name, parent_id, owner_id, color, sort';

/** Case/width-insensitive form for sibling-name comparison. */
const nameKey = (s: string) => s.normalize('NFKC').toLowerCase();

tags.get('/', async (c) => {
  const viewer = await viewerId(c);
  const ownerHandle = c.req.query('owner');
  let scopeUser = viewer; // whose custom tags come with the presets
  let countOwner: string | null = null; // restrict counted photos to one owner
  if (ownerHandle) {
    const u = await c.env.DB.prepare('SELECT id FROM users WHERE handle = ?1').bind(ownerHandle).first<{ id: string }>();
    if (!u) throw notFound('用户不存在');
    scopeUser = u.id;
    countOwner = u.id;
  }

  const q = new Sql();
  const vis = photoList(q, viewer, 'p');
  const ownerCond = countOwner ? ` AND p.owner_id = ${q.p(countOwner)}` : '';
  const scope = scopeUser ? `t.owner_id IS NULL OR t.owner_id = ${q.p(scopeUser)}` : 't.owner_id IS NULL';
  const res = await prepQ(
    c.env.DB,
    `SELECT t.id, t.name, t.parent_id, t.owner_id, t.color, t.sort,
        (SELECT COUNT(*) FROM photo_tags pt JOIN photos p ON p.id = pt.photo_id WHERE pt.tag_id = t.id AND ${vis}${ownerCond}) AS count
     FROM tags t WHERE ${scope} ORDER BY t.sort, t.name, t.id`,
    q
  ).all<TagRow>();

  listCache(c, viewer);
  return c.json({ tags: res.results.map((r) => toTag(r)) });
});

/** Throws 409 when a sibling (same parent, same owner scope or a preset) already has this name. */
async function assertNameFree(db: D1Database, ownerId: string | null, parentId: string | null, name: string, exceptId = ''): Promise<void> {
  const res = await db
    .prepare('SELECT id, name FROM tags WHERE parent_id IS ?1 AND (owner_id IS NULL OR owner_id IS ?2) AND id != ?3')
    .bind(parentId, ownerId, exceptId)
    .all<{ id: string; name: string }>();
  const key = nameKey(name);
  if (res.results.some((r) => nameKey(r.name) === key)) throw conflict('同一层级下已经有同名标签，请换一个名称');
}

/** A parent a tag owned by `ownerId` may hang under: presets, or (for user tags) the user's own tags. */
async function assertParentUsable(db: D1Database, parentId: string, ownerId: string | null): Promise<void> {
  const parent = await db.prepare('SELECT owner_id FROM tags WHERE id = ?1').bind(parentId).first<{ owner_id: string | null }>();
  if (!parent) throw invalid('上级标签不存在');
  if (parent.owner_id !== null && parent.owner_id !== ownerId) throw invalid('上级标签必须是预置标签或你自己的标签');
}

async function nextSort(db: D1Database, ownerId: string, parentId: string | null): Promise<number> {
  const row = await db
    .prepare('SELECT MAX(sort) AS m FROM tags WHERE parent_id IS ?1 AND (owner_id IS NULL OR owner_id = ?2)')
    .bind(parentId, ownerId)
    .first<{ m: number | null }>();
  return (row?.m ?? 0) + 10;
}

async function loadEditable(db: D1Database, user: SessionUser, id: string): Promise<TagRow> {
  const tag = await db.prepare(`SELECT ${TAG_COLS} FROM tags WHERE id = ?1`).bind(id).first<TagRow>();
  if (!tag) throw notFound('标签不存在');
  if (tag.owner_id === null) {
    if (!isStaff(user)) throw forbidden('预置标签只有站长和管理员可以修改');
  } else if (tag.owner_id !== user.id) {
    throw forbidden('不能修改别人的标签');
  }
  return tag;
}

tags.post('/', async (c) => {
  const user = await requireUser(c);
  const body = await readJson(c);
  const db = c.env.DB;

  const name = reqStr(body, 'name', '标签名称', 1, TAG_LIMITS.nameMax);
  const parentId = body.parentId === undefined || body.parentId === null || body.parentId === '' ? null : body.parentId;
  if (parentId !== null && typeof parentId !== 'string') throw invalid('上级标签格式不对');
  const color = optColor(body.color);
  if (parentId) await assertParentUsable(db, parentId, user.id);
  await assertNameFree(db, user.id, parentId, name);

  const id = newId.tag();
  const sort = await nextSort(db, user.id, parentId);
  await prep(
    db,
    'INSERT INTO tags (id, owner_id, parent_id, name, color, sort, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
    id,
    user.id,
    parentId,
    name,
    color,
    sort,
    nowIso()
  ).run();
  return c.json({ tag: toTag({ id, name, parent_id: parentId, owner_id: user.id, color, sort }, 0) }, 201);
});

tags.patch('/:id', async (c) => {
  const user = await requireUser(c);
  const id = paramId(c);
  const db = c.env.DB;
  const tag = await loadEditable(db, user, id);
  const body = await readJson(c);

  let name = tag.name;
  let parentId = tag.parent_id;
  let color = tag.color;
  let sort = tag.sort;
  let nameChanged = false;
  let parentChanged = false;

  if (has(body, 'name')) {
    name = reqStr(body, 'name', '标签名称', 1, TAG_LIMITS.nameMax);
    nameChanged = name !== tag.name;
  }
  if (has(body, 'parentId')) {
    const p = body.parentId === '' ? null : body.parentId;
    if (p !== null && typeof p !== 'string') throw invalid('上级标签格式不对');
    if (p !== tag.parent_id) {
      parentChanged = true;
      parentId = p;
      if (p !== null) {
        // Moving under itself or a descendant would cut the subtree off from the tree.
        const cycle = await db
          .prepare(
            `WITH RECURSIVE sub(id) AS (SELECT id FROM tags WHERE id = ?1 UNION ALL SELECT t.id FROM tags t JOIN sub ON t.parent_id = sub.id)
             SELECT 1 AS x FROM sub WHERE id = ?2`
          )
          .bind(tag.id, p)
          .first();
        if (cycle) throw invalid('不能把标签移动到它自己或它的子标签下面');
        await assertParentUsable(db, p, tag.owner_id);
      }
    }
  }
  if (has(body, 'color')) color = optColor(body.color);
  if (has(body, 'sort')) sort = optNum(body.sort, '排序', { int: true, min: -1_000_000, max: 1_000_000 }) ?? tag.sort;
  if (nameChanged || parentChanged) await assertNameFree(db, tag.owner_id, parentId, name, tag.id);

  await prep(
    db,
    'UPDATE tags SET name = ?1, parent_id = ?2, color = ?3, sort = ?4 WHERE id = ?5',
    name,
    parentId,
    color,
    sort,
    tag.id
  ).run();
  const viewer = user.id;
  return c.json({ tag: toTag({ ...tag, name, parent_id: parentId, color, sort }, await tagCount(db, viewer, tag.id)) });
});

tags.delete('/:id', async (c) => {
  const user = await requireUser(c);
  const tag = await loadEditable(c.env.DB, user, paramId(c));
  const db = c.env.DB;
  const subtree = `WITH RECURSIVE sub(id) AS (SELECT id FROM tags WHERE id = ?1 UNION ALL SELECT t.id FROM tags t JOIN sub ON t.parent_id = sub.id)`;
  const [counted] = await db.batch([
    prep(db, `${subtree} SELECT COUNT(*) AS n FROM sub`, tag.id),
    prep(db, `${subtree} DELETE FROM photo_tags WHERE tag_id IN (SELECT id FROM sub)`, tag.id),
    prep(db, `${subtree} DELETE FROM tags WHERE id IN (SELECT id FROM sub)`, tag.id)
  ]);
  const deleted = (counted.results[0] as { n: number } | undefined)?.n ?? 0;
  return c.json({ ok: true, deleted });
});
