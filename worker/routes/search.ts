// Search (搜索): the words of a query in the signed-in user's own archive — entries, photos, projects, collections, and
// the places and tags they use. Nobody else's content is searched, whatever its visibility, so a search can never
// show what its own pages would not. Contract: /docs/api/search.md
//
// Words are matched as written, anywhere in the text (LIKE '%word%'): Chinese has no spaces to split on, and two
// characters (西湖, 书法) are a whole word. There is no FTS5 index: D1 cannot export a database with virtual tables in a
// form it can import again, and that export is the backup (docs/runbooks/backup.md).

import { Hono } from 'hono';
import { entryLabel, entryTypeLabel } from '../../shared/entries';
import { asciiLower, queryProblem, searchTerms, snippetAround } from '../../shared/search';
import {
  SEARCH_GROUP_MAX,
  SEARCH_GROUPS,
  SEARCH_HITS,
  type EntryStatus,
  type EntryType,
  type ProjectStatus,
  type ProjectType,
  type SearchGroup,
  type SearchGroupName,
  type SearchResponse,
  type ThemeKind,
  type Visibility
} from '../../shared/types';
import type { AppEnv } from '../env';
import { invalid, unauthenticated } from '../lib/http';
import { PHOTO_FROM, summariesByIds, SUMMARY_COLS, toSummary, type PhotoRow } from '../lib/photos';
import { viewerId } from '../lib/session';
import { likeContains, prepQ, Sql } from '../lib/sql';

export const search = new Hono<AppEnv>({ strict: false });

/** A snippet's source window: code points before the first word found, and in all. */
const BEFORE = 60;
const SPAN = 240;
const NOWHERE = 2147483647;

/**
 * The words of one query for one statement. Patterns are bound on `q` the first time a statement uses them, and once:
 * every parameter bound must appear in that statement's SQL.
 */
class Words {
  #likes?: string[];
  #lows?: string[];
  constructor(
    private readonly q: Sql,
    readonly terms: string[]
  ) {}
  /** `LIKE '%word%'` patterns */
  get likes(): string[] {
    return (this.#likes ??= this.terms.map((t) => this.q.p(likeContains(t))));
  }
  /** the words lower-cased as SQLite's lower() does, for instr() */
  get lows(): string[] {
    return (this.#lows ??= this.terms.map((t) => this.q.p(asciiLower(t))));
  }
}

const like = (expr: string, pattern: string) => `${expr} LIKE ${pattern} ESCAPE '\\'`;

/** Every word is somewhere in `exprs` (each word may be in a different one). */
const allWords = (w: Words, exprs: (pattern: string) => string[]) => w.likes.map((l) => `(${exprs(l).join(' OR ')})`).join(' AND ');

/** Some word is in `expr`. */
const anyWord = (w: Words, expr: string) => `(${w.likes.map((l) => like(expr, l)).join(' OR ')})`;

/** 1-based position of the earliest word in `expr`, or NULL (one-argument min() would be the aggregate). */
function firstPos(w: Words, expr: string): string {
  const each = w.lows.map((l) => `coalesce(nullif(instr(lower(${expr}), ${l}), 0), ${NOWHERE})`);
  return `nullif(${each.length === 1 ? each[0] : `min(${each.join(', ')})`}, ${NOWHERE})`;
}

/** `'from|length|text'`: the window of `expr` around its earliest word, or NULL when no word is in it. */
function around(w: Words, expr: string): string {
  const from = `max(1, ${firstPos(w, expr)} - ${BEFORE})`;
  return `(printf('%d|%d|', ${from}, length(${expr})) || substr(${expr}, ${from}, ${SPAN}))`;
}

/** The same from the start of `expr`, for a hit whose words are elsewhere (its title). */
const head = (expr: string) => `(printf('1|%d|', length(${expr})) || substr(${expr}, 1, ${SPAN}))`;

/** A window back from SQL, as a plain-text snippet around the words. */
function snippet(terms: string[], s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d+)\|(\d+)\|/.exec(s);
  if (!m) return null;
  const from = Number(m[1]);
  const text = s.slice(m[0].length);
  if (!text.trim()) return null;
  return snippetAround(text, terms, from > 1, from - 1 + [...text].length < Number(m[2])) || null;
}

const counted = <T>(hits: T[], rows: { total: number }[]): SearchGroup<T> => ({ hits, total: rows[0]?.total ?? 0 });

// ---- the groups: each is one statement over the viewer's own rows ------------------------------------------------------

interface EntryHitRow {
  id: string;
  type: EntryType;
  title: string | null;
  body_head: string | null;
  occurred_at: string;
  status: EntryStatus;
  visibility: Visibility;
  photo_id: string | null;
  snip: string | null;
  total: number;
}

function entriesSql(w: Words, v: string, limit: number): string {
  const caption = (l: string) => `EXISTS (SELECT 1 FROM entry_media em WHERE em.entry_id = e.id AND ${like('em.caption', l)})`;
  return `SELECT e.id, e.type, e.title, substr(e.body, 1, 400) AS body_head, e.occurred_at, e.status, e.visibility,
      (SELECT em.photo_id FROM entry_media em WHERE em.entry_id = e.id ORDER BY em.position LIMIT 1) AS photo_id,
      coalesce(${around(w, 'e.body')},
        (SELECT ${around(w, 'em.caption')} FROM entry_media em WHERE em.entry_id = e.id AND ${anyWord(w, 'em.caption')} ORDER BY em.position LIMIT 1),
        ${head('e.body')}) AS snip,
      COUNT(*) OVER () AS total
    FROM entries e
    WHERE e.owner_id = ${v} AND ${allWords(w, (l) => [like('e.title', l), like('e.body', l), caption(l)])}
    ORDER BY ${anyWord(w, 'e.title')} DESC, e.occurred_at DESC, e.rowid DESC LIMIT ${limit}`;
}

type PhotoHitRow = PhotoRow & { snip: string | null; total: number };

function photosSql(w: Words, v: string, limit: number): string {
  // the same condition as the partial index photos_owner_text (migrations/0009), so the search only visits photos
  // with words of their own
  return `SELECT ${SUMMARY_COLS}, coalesce(${around(w, 'p.note')}, ${head('p.note')}) AS snip, COUNT(*) OVER () AS total
    FROM ${PHOTO_FROM}
    WHERE p.owner_id = ${v} AND (p.title IS NOT NULL OR p.note IS NOT NULL)
      AND ${allWords(w, (l) => [like('p.title', l), like('p.note', l)])}
    ORDER BY ${anyWord(w, 'p.title')} DESC, p.taken_at DESC, p.rowid DESC LIMIT ${limit}`;
}

interface ProjectHitRow {
  id: string;
  type: ProjectType;
  title: string;
  status: ProjectStatus;
  visibility: Visibility;
  start_date: string;
  end_date: string | null;
  snip: string | null;
  total: number;
}

function projectsSql(w: Words, v: string, limit: number): string {
  const ms = `(ms.title || char(10) || coalesce(ms.body, ''))`;
  const milestone = (l: string) =>
    `EXISTS (SELECT 1 FROM milestones ms WHERE ms.project_id = pj.id AND (${like('ms.title', l)} OR ${like('ms.body', l)}))`;
  return `SELECT pj.id, pj.type, pj.title, pj.status, pj.visibility, pj.start_date, pj.end_date,
      coalesce(${around(w, 'pj.description')},
        (SELECT ${around(w, ms)} FROM milestones ms WHERE ms.project_id = pj.id AND ${anyWord(w, ms)} ORDER BY ms.date, ms.id LIMIT 1),
        ${head('pj.description')}) AS snip,
      COUNT(*) OVER () AS total
    FROM projects pj
    WHERE pj.owner_id = ${v} AND ${allWords(w, (l) => [like('pj.title', l), like('pj.description', l), milestone(l)])}
    ORDER BY ${anyWord(w, 'pj.title')} DESC, pj.updated_at DESC, pj.id DESC LIMIT ${limit}`;
}

interface ThemeHitRow {
  id: string;
  kind: ThemeKind;
  title: string;
  subtitle: string | null;
  visibility: Visibility;
  start_date: string | null;
  end_date: string | null;
  cover_photo_id: string | null;
  snip: string | null;
  total: number;
}

function themesSql(w: Words, v: string, limit: number): string {
  const item = (l: string) => `EXISTS (SELECT 1 FROM theme_items ti WHERE ti.theme_id = th.id AND ${like('ti.text', l)})`;
  return `SELECT th.id, th.kind, th.title, th.subtitle, th.visibility, th.start_date, th.end_date, th.cover_photo_id,
      coalesce(${around(w, 'th.intro')},
        (SELECT ${around(w, 'ti.text')} FROM theme_items ti WHERE ti.theme_id = th.id AND ${anyWord(w, 'ti.text')} ORDER BY ti.position LIMIT 1),
        ${head('th.intro')}) AS snip,
      COUNT(*) OVER () AS total
    FROM themes th
    WHERE th.owner_id = ${v} AND ${allWords(w, (l) => [like('th.title', l), like('th.subtitle', l), like('th.intro', l), item(l)])}
    ORDER BY ${anyWord(w, 'th.title')} DESC, th.updated_at DESC, th.id DESC LIMIT ${limit}`;
}

interface PlaceHitRow {
  id: string;
  name: string;
  category: string;
  city: string | null;
  district: string | null;
  photo_count: number;
  entry_count: number;
  total: number;
}

function placesSql(w: Words, v: string, limit: number): string {
  return `SELECT *, COUNT(*) OVER () AS total FROM (
      SELECT po.id, po.name, po.category, po.city, po.district, po.created_by,
        (SELECT COUNT(*) FROM photos p WHERE p.poi_id = po.id AND p.owner_id = ${v}) AS photo_count,
        (SELECT COUNT(*) FROM entries e WHERE e.poi_id = po.id AND e.owner_id = ${v}) AS entry_count
      FROM pois po WHERE ${allWords(w, (l) => [like('po.name', l), like('po.aliases', l)])}
    ) WHERE photo_count + entry_count > 0 OR created_by = ${v}
    ORDER BY photo_count + entry_count DESC, name, id LIMIT ${limit}`;
}

interface TagHitRow {
  id: string;
  name: string;
  parent_name: string | null;
  color: string | null;
  photo_count: number;
  entry_count: number;
  total: number;
}

function tagsSql(w: Words, v: string, limit: number): string {
  return `SELECT *, COUNT(*) OVER () AS total FROM (
      SELECT t.id, t.name, t.color, t.owner_id, (SELECT pt.name FROM tags pt WHERE pt.id = t.parent_id) AS parent_name,
        (SELECT COUNT(*) FROM photo_tags x JOIN photos p ON p.id = x.photo_id WHERE x.tag_id = t.id AND p.owner_id = ${v}) AS photo_count,
        (SELECT COUNT(*) FROM entry_tags x JOIN entries e ON e.id = x.entry_id WHERE x.tag_id = t.id AND e.owner_id = ${v}) AS entry_count
      FROM tags t WHERE (t.owner_id IS NULL OR t.owner_id = ${v}) AND ${allWords(w, (l) => [like('t.name', l)])}
    ) WHERE photo_count + entry_count > 0 OR owner_id = ${v}
    ORDER BY photo_count + entry_count DESC, name, id LIMIT ${limit}`;
}

const SQL: Record<SearchGroupName, (w: Words, v: string, limit: number) => string> = {
  entries: entriesSql,
  photos: photosSql,
  projects: projectsSql,
  themes: themesSql,
  places: placesSql,
  tags: tagsSql
};

search.get('/', async (c) => {
  const viewer = await viewerId(c);
  if (!viewer) throw unauthenticated();
  const raw = c.req.query('q') ?? '';
  const problem = queryProblem(raw);
  if (problem) throw invalid(problem);
  const only = c.req.query('in');
  if (only !== undefined && !(SEARCH_GROUPS as readonly string[]).includes(only)) throw invalid('in 只能是 ' + SEARCH_GROUPS.join('、'));
  const groups: SearchGroupName[] = only ? [only as SearchGroupName] : [...SEARCH_GROUPS];

  const terms = searchTerms(raw);
  const db = c.env.DB;
  // One statement per group, all bound on their own Sql (a batch takes prepared statements, each with its params).
  const statements = groups.map((g) => {
    const q = new Sql();
    const v = q.p(viewer);
    return prepQ(db, SQL[g](new Words(q, terms), v, only ? SEARCH_GROUP_MAX : SEARCH_HITS[g]), q);
  });
  const results = await db.batch(statements);
  const rowsOf = <T>(g: SearchGroupName): T[] => (results[groups.indexOf(g)]?.results ?? []) as T[];

  const entryRows = rowsOf<EntryHitRow>('entries');
  const themeRows = rowsOf<ThemeHitRow>('themes');
  // thumbnails: each entry's first photo and each collection's cover, all the viewer's own
  const thumbs = await summariesByIds(db, viewer, [
    ...entryRows.flatMap((r) => (r.photo_id ? [r.photo_id] : [])),
    ...themeRows.flatMap((r) => (r.cover_photo_id ? [r.cover_photo_id] : []))
  ]);
  const thumb = (id: string | null) => {
    const p = id ? thumbs.get(id) : undefined;
    if (!p) return null;
    const { note: _note, ...summary } = p;
    return summary;
  };

  const out: SearchResponse = { terms };
  for (const g of groups) {
    if (g === 'entries') {
      out.entries = counted(
        entryRows.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          label: entryLabel(r.title, r.body_head) || entryTypeLabel(r.type),
          occurredAt: r.occurred_at,
          status: r.status,
          visibility: r.visibility,
          photo: thumb(r.photo_id),
          snippet: snippet(terms, r.snip)
        })),
        entryRows
      );
    } else if (g === 'photos') {
      const rows = rowsOf<PhotoHitRow>('photos');
      out.photos = counted(
        rows.map((r) => ({ ...toSummary(r, viewer), snippet: snippet(terms, r.snip) })),
        rows
      );
    } else if (g === 'projects') {
      const rows = rowsOf<ProjectHitRow>('projects');
      out.projects = counted(
        rows.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          status: r.status,
          visibility: r.visibility,
          startDate: r.start_date,
          endDate: r.end_date,
          snippet: snippet(terms, r.snip)
        })),
        rows
      );
    } else if (g === 'themes') {
      out.themes = counted(
        themeRows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          subtitle: r.subtitle,
          visibility: r.visibility,
          startDate: r.start_date,
          endDate: r.end_date,
          cover: thumb(r.cover_photo_id),
          snippet: snippet(terms, r.snip)
        })),
        themeRows
      );
    } else if (g === 'places') {
      const rows = rowsOf<PlaceHitRow>('places');
      out.places = counted(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          city: r.city,
          district: r.district,
          photoCount: r.photo_count,
          entryCount: r.entry_count
        })),
        rows
      );
    } else {
      const rows = rowsOf<TagHitRow>('tags');
      out.tags = counted(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          parentName: r.parent_name,
          color: r.color,
          photoCount: r.photo_count,
          entryCount: r.entry_count
        })),
        rows
      );
    }
  }
  return c.json(out);
});
