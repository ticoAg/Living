import type { Tag } from '../../shared/types';
import { entryList, photoList } from './visibility';
import { prepQ, Sql } from './sql';

export interface TagRow {
  id: string;
  name: string;
  parent_id: string | null;
  owner_id: string | null;
  color: string | null;
  sort: number;
  count?: number;
  entry_count?: number;
}

export function toTag(r: TagRow, count = r.count ?? 0, entryCount = r.entry_count ?? 0): Tag {
  return { id: r.id, name: r.name, parentId: r.parent_id, ownerId: r.owner_id, color: r.color, sort: r.sort, count, entryCount };
}

/** Subset of `ids` that exist and are usable by the user: system presets or the user's own tags. */
export async function usableTagIds(db: D1Database, userId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const res = await db
    .prepare('SELECT id FROM tags WHERE id IN (SELECT value FROM json_each(?1)) AND (owner_id IS NULL OR owner_id = ?2)')
    .bind(JSON.stringify(ids), userId)
    .all<{ id: string }>();
  const ok = new Set(res.results.map((r) => r.id));
  return ids.filter((id) => ok.has(id));
}

/** Direct count of photos carrying the tag that `viewer` sees in lists (optionally one owner's only). */
export async function tagCount(db: D1Database, viewer: string | null, tagId: string): Promise<number> {
  const q = new Sql();
  const vis = photoList(q, viewer);
  const row = await prepQ(
    db,
    `SELECT COUNT(*) AS n FROM photo_tags pt JOIN photos p ON p.id = pt.photo_id WHERE pt.tag_id = ${q.p(tagId)} AND ${vis}`,
    q
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Direct count of entries carrying the tag that `viewer` sees in lists (the owner: all of theirs). */
export async function tagEntryCount(db: D1Database, viewer: string | null, tagId: string): Promise<number> {
  const q = new Sql();
  const vis = entryList(q, viewer);
  const row = await prepQ(
    db,
    `SELECT COUNT(*) AS n FROM entry_tags et JOIN entries e ON e.id = et.entry_id WHERE et.tag_id = ${q.p(tagId)} AND ${vis}`,
    q
  ).first<{ n: number }>();
  return row?.n ?? 0;
}
