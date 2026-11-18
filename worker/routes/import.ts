// Import (导入): an export (docs/api/export.md#导出的文件) brought into the signed-in account. The browser reads
// living.json and the files and sends the rows a batch at a time: tags, places and privacy zones first; the photos
// through POST /api/photos, as an upload; then projects, entries and collections. Contract: /docs/api/import.md
//
// Nothing here is overwritten. An item that is here already, its id in the export being the user's own (an export of
// this account) or the id an earlier import gave it, stays as it is. A new one gets an id worked out from the account
// and its id in the export (lib/ids.ts importedId), which a second import arrives at again. What a row points to comes
// as this site's ids, translated by the browser: a photo, entry, project or tag that is not the user's to use, or a
// place that does not exist, is dropped rather than followed.

import { Hono } from 'hono';
import { IMPORT_LIMITS, MILESTONE_LIMITS, PRIVACY_ZONE_LIMITS, TAG_LIMITS } from '../../shared/limits';
import {
  POI_LIMITS,
  type ImportIdsResponse,
  type ImportResolveResponse,
  type ImportRowsResponse,
  type ImportTarget,
  type ImportZonesResponse,
  type PoiSource,
  type Visibility
} from '../../shared/types';
import type { AppEnv } from '../env';
import { writeMedia, writeProjects, writeTags } from '../lib/entries';
import { assertNotEmpty, parseEntryFields } from '../lib/entryInput';
import { HttpError, ID_RE, invalid, readJson } from '../lib/http';
import { importedId, newId } from '../lib/ids';
import { defaultRadius, parseNewPoi } from '../lib/poi';
import { photosToHide } from '../lib/privacy';
import { assertDays, parseMilestoneFields, parseProjectFields } from '../lib/projectInput';
import { usableProjectIds } from '../lib/projects';
import { requireUser } from '../lib/session';
import { nowIso, prep, prepInsert } from '../lib/sql';
import { tagNameKey, usableTagIds } from '../lib/tags';
import { insertItems, parseItems, parseThemeFields } from '../lib/themeInput';
import { isPlainObject, optColor, optNum, optText, reqNum, reqStr, type Body } from '../lib/validate';

export const imports = new Hono<AppEnv>({ strict: false });

/** Rows of text in one request: the browser keeps to about 1 MB, this leaves room for JSON escapes. */
const MAX_BYTES = 2 * 1024 * 1024;

// ---- helpers ------------------------------------------------------------------------------------------------------

/** The array `key` of the body: objects only, at most `max` of them. */
function rowsOf(body: Body, key: string, max: number): Body[] {
  const v = body[key];
  if (!Array.isArray(v)) throw invalid(`${key} 需要是数组`);
  if (v.length > max) throw invalid(`一次最多导入 ${max} 个`);
  return v.map((r, i) => {
    if (!isPlainObject(r)) throw invalid(`第 ${i + 1} 个格式不对`);
    return r;
  });
}

/** Each row's id in the export; a request whose rows cannot be told apart is malformed. */
function sourceIds(rows: Body[]): string[] {
  return rows.map((r, i) => {
    if (typeof r.id !== 'string' || !ID_RE.test(r.id)) throw invalid(`第 ${i + 1} 个的 id 格式不对`);
    return r.id;
  });
}

/** A UTC time as the API writes them (`2026-11-17T01:05:00Z`), no later than `now`; null when there is none. */
function pastIso(v: unknown, now: string): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)) return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const iso = new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return iso > now ? now : iso;
}

/** When a row was made and last changed: the export's own times, never one before the other, else now. */
function times(r: Body, now: string): { created: string; updated: string } {
  const created = pastIso(r.createdAt, now) ?? now;
  const updated = pastIso(r.updatedAt, now);
  return { created, updated: updated && updated > created ? updated : created };
}

/** The message of a check that failed, to report the row with; anything else is a real failure. */
function why(e: unknown): string {
  if (e instanceof HttpError && e.status === 400) return e.message;
  throw e;
}

type Owned = 'entries' | 'projects' | 'themes';
const PREFIX: Record<Owned, string> = { entries: 'en', projects: 'pj', themes: 'th' };

interface Where extends ImportTarget {
  /** the id this account's import would give it belongs to someone else: cannot happen short of a hash collision */
  taken: boolean;
}

/** Where each of the export's items is, or is to be, in this account (see the top of this file). */
async function targets(db: D1Database, table: Owned, ownerId: string, sources: string[]): Promise<Map<string, Where>> {
  const out = new Map<string, Where>();
  if (!sources.length) return out;
  const derived = await Promise.all(sources.map((s) => importedId(PREFIX[table], ownerId, s)));
  const res = await db
    .prepare(`SELECT id, owner_id FROM ${table} WHERE id IN (SELECT value FROM json_each(?1))`)
    .bind(JSON.stringify([...new Set([...sources, ...derived])]))
    .all<{ id: string; owner_id: string }>();
  const owner = new Map(res.results.map((r) => [r.id, r.owner_id]));
  sources.forEach((s, i) => {
    if (owner.get(s) === ownerId) out.set(s, { id: s, exists: true, taken: false });
    else {
      const o = owner.get(derived[i]);
      out.set(s, { id: derived[i], exists: o === ownerId, taken: o !== undefined && o !== ownerId });
    }
  });
  return out;
}

/** Those of `ids` that the query returns; `?1` is the list as JSON, `params` follow as `?2`… */
async function present(db: D1Database, sql: string, ids: string[], ...params: unknown[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const res = await prep(db, sql, JSON.stringify([...new Set(ids)]), ...params).all<{ id: string }>();
  return new Set(res.results.map((r) => r.id));
}

const MY_PHOTOS = 'SELECT id FROM photos WHERE id IN (SELECT value FROM json_each(?1)) AND owner_id = ?2';
const MY_ENTRIES = 'SELECT id FROM entries WHERE id IN (SELECT value FROM json_each(?1)) AND owner_id = ?2';
const PLACES = 'SELECT id FROM pois WHERE id IN (SELECT value FROM json_each(?1))';

/** Rows of a batch: which were made, which were here, which could not be. */
class Outcome {
  ids: Record<string, string> = {};
  created = 0;
  existing = 0;
  failed: { id: string; message: string }[] = [];
  /** the row is here now as `id` */
  here(source: string, id: string, made: boolean) {
    this.ids[source] = id;
    if (made) this.created++;
    else this.existing++;
  }
  json(): ImportRowsResponse {
    return { ids: this.ids, created: this.created, existing: this.existing, failed: this.failed };
  }
}

/**
 * The rows of a batch that are to be made, each with its id here; the others are recorded in `out` as here already,
 * or as failed. A row given twice counts once.
 */
async function toMake(
  db: D1Database,
  table: Owned,
  ownerId: string,
  rows: Body[],
  out: Outcome
): Promise<{ row: Body; source: string; id: string }[]> {
  const sources = sourceIds(rows);
  const where = await targets(db, table, ownerId, sources);
  const seen = new Set<string>();
  const make: { row: Body; source: string; id: string }[] = [];
  rows.forEach((row, i) => {
    const source = sources[i];
    if (seen.has(source)) return;
    seen.add(source);
    const w = where.get(source) as Where;
    if (w.exists) out.here(source, w.id, false);
    else if (w.taken) out.failed.push({ id: source, message: '这一项的 id 在这个站点已被占用' });
    else make.push({ row, source, id: w.id });
  });
  return make;
}

// ---- what is here -------------------------------------------------------------------------------------------------

imports.post('/resolve', async (c) => {
  const user = await requireUser(c);
  const body = await readJson(c, MAX_BYTES);
  const list = (key: string, re: RegExp): string[] => {
    const v = body[key];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > IMPORT_LIMITS.resolve || v.some((x) => typeof x !== 'string' || !re.test(x)))
      throw invalid(`${key} 需要是最多 ${IMPORT_LIMITS.resolve} 个 id 的数组`);
    return [...new Set(v as string[])];
  };
  const shas = list('photos', /^[0-9a-fA-F]{64}$/).map((s) => s.toLowerCase());
  const db = c.env.DB;
  const [photos, entries, projects, themes] = await Promise.all([
    shas.length
      ? db
          .prepare('SELECT id, sha256 FROM photos WHERE owner_id = ?1 AND sha256 IN (SELECT value FROM json_each(?2))')
          .bind(user.id, JSON.stringify(shas))
          .all<{ id: string; sha256: string }>()
          .then((r) => r.results)
      : [],
    targets(db, 'entries', user.id, list('entries', ID_RE)),
    targets(db, 'projects', user.id, list('projects', ID_RE)),
    targets(db, 'themes', user.id, list('collections', ID_RE))
  ]);
  const plain = (m: Map<string, Where>) => Object.fromEntries([...m].map(([k, w]) => [k, { id: w.id, exists: w.exists }]));
  return c.json({
    photos: Object.fromEntries(photos.map((p) => [p.sha256, p.id])),
    entries: plain(entries),
    projects: plain(projects),
    collections: plain(themes)
  } satisfies ImportResolveResponse);
});

// ---- tags ---------------------------------------------------------------------------------------------------------

/**
 * The export's tags, presets among them. A tag whose id is a preset or the user's own tag here is that tag; otherwise
 * the one of the same name under the same parent (presets included), as the tag manager would not allow another;
 * otherwise a new tag of the user's. A tag that fails the checks is left out, and its children go under its parent.
 */
imports.post('/tags', async (c) => {
  const user = await requireUser(c);
  const rows = rowsOf(await readJson(c, MAX_BYTES), 'tags', IMPORT_LIMITS.tags);
  const db = c.env.DB;
  const now = nowIso();

  interface In {
    id: string;
    parentId: string | null;
    name: string | null;
    color: string | null;
    sort: number;
    createdAt: string;
  }
  const input = new Map<string, In>();
  for (const r of rows) {
    if (typeof r.id !== 'string' || !ID_RE.test(r.id) || input.has(r.id)) continue;
    let name: string | null = null;
    let color: string | null = null;
    let sort = 0;
    try {
      name = reqStr(r, 'name', '标签名称', 1, TAG_LIMITS.nameMax);
      color = optColor(r.color);
      sort = optNum(r.sort, '排序', { int: true, min: -1_000_000_000, max: 1_000_000_000 }) ?? 0;
    } catch (e) {
      why(e);
      name = null;
    }
    const parentId = typeof r.parentId === 'string' && ID_RE.test(r.parentId) && r.parentId !== r.id ? r.parentId : null;
    input.set(r.id, { id: r.id, parentId, name, color, sort, createdAt: pastIso(r.createdAt, now) ?? now });
  }

  const here = await db
    .prepare('SELECT id, parent_id, name FROM tags WHERE owner_id IS NULL OR owner_id = ?1')
    .bind(user.id)
    .all<{ id: string; parent_id: string | null; name: string }>();
  const known = new Set(here.results.map((t) => t.id));
  const siblings = new Map<string, Map<string, string>>();
  const under = (parent: string | null) => {
    let m = siblings.get(parent ?? '');
    if (!m) siblings.set(parent ?? '', (m = new Map()));
    return m;
  };
  for (const t of here.results) {
    const m = under(t.parent_id);
    if (!m.has(tagNameKey(t.name))) m.set(tagNameKey(t.name), t.id);
  }

  // parents first; a loop is cut where it closes
  const order: In[] = [];
  const visited = new Set<string>();
  const visit = (t: In) => {
    if (visited.has(t.id)) return;
    visited.add(t.id);
    const parent = t.parentId ? input.get(t.parentId) : undefined;
    if (parent) visit(parent);
    order.push(t);
  };
  input.forEach(visit);

  const ids = new Map<string, string>();
  const made: { id: string; parentId: string | null; name: string; color: string | null; sort: number; createdAt: string }[] = [];
  for (const t of order) {
    // where the tag goes: its parent as it ended up here (a parent left out passes its own parent on)
    const parent = t.parentId ? (ids.get(t.parentId) ?? (known.has(t.parentId) ? t.parentId : null)) : null;
    if (known.has(t.id)) ids.set(t.id, t.id);
    else if (t.name === null) {
      if (parent) ids.set(t.id, parent);
    } else {
      const m = under(parent);
      const key = tagNameKey(t.name);
      const same = m.get(key);
      if (same) ids.set(t.id, same);
      else {
        const id = newId.tag();
        m.set(key, id);
        ids.set(t.id, id);
        made.push({ id, parentId: parent, name: t.name, color: t.color, sort: t.sort, createdAt: t.createdAt });
      }
    }
  }
  // a tag left out is not a tag to put things on, only a way through to its children
  for (const t of order) if (t.name === null && !known.has(t.id)) ids.delete(t.id);

  if (made.length) {
    // foreign keys are checked when the statement ends, so a child may come in the same statement as its parent
    await prep(
      db,
      `INSERT INTO tags (id, owner_id, parent_id, name, color, sort, created_at)
       SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.parentId'), json_extract(value, '$.name'),
              json_extract(value, '$.color'), json_extract(value, '$.sort'), json_extract(value, '$.createdAt')
       FROM json_each(?2)`,
      user.id,
      JSON.stringify(made)
    ).run();
  }
  return c.json({ ids: Object.fromEntries(ids), created: made.length } satisfies ImportIdsResponse);
});

// ---- places -------------------------------------------------------------------------------------------------------

/**
 * Places are the site's, shared by everyone. One with the same id here is that place (an export of this site); one
 * from a map provider is found by its key there, or made; one of someone's own making gets the id this account's
 * import gives it. A new place is the user's, as when an upload makes one; aliases come with the ones the user made.
 */
imports.post('/places', async (c) => {
  const user = await requireUser(c);
  const rows = rowsOf(await readJson(c, MAX_BYTES), 'places', IMPORT_LIMITS.places);
  const db = c.env.DB;
  const now = nowIso();

  interface In {
    id: string;
    name: string;
    category: string;
    lat: number;
    lng: number;
    city: string | null;
    district: string | null;
    source: PoiSource;
    sourceId: string | null;
    radius: number;
    aliases: string[];
  }
  const input: In[] = [];
  const given = new Set<string>();
  for (const r of rows) {
    if (typeof r.id !== 'string' || !ID_RE.test(r.id) || given.has(r.id)) continue;
    given.add(r.id);
    try {
      const p = parseNewPoi(r);
      // however far out the export's radius is, the place comes with one in the range a place may have here
      const radius = optNum(r.radius, '匹配半径') ?? defaultRadius(p.category);
      const aliases =
        r.own === true && Array.isArray(r.aliases)
          ? r.aliases
              .slice(0, POI_LIMITS.aliasCount)
              .map((a: unknown) => (typeof a === 'string' ? optText(a, '别名', POI_LIMITS.aliasMax) : null))
              .filter((a): a is string => !!a)
          : [];
      input.push({
        id: r.id,
        name: p.name,
        category: p.category,
        lat: p.lat,
        lng: p.lng,
        city: p.city ?? null,
        district: p.district ?? null,
        source: p.source ?? 'custom',
        sourceId: p.source && p.source !== 'custom' ? (p.sourceId ?? null) : null,
        radius: Math.min(POI_LIMITS.radiusMax, Math.max(POI_LIMITS.radiusMin, Math.round(radius))),
        aliases
      });
    } catch (e) {
      why(e);
    }
  }

  const sameId = await present(
    db,
    PLACES,
    input.map((p) => p.id)
  );
  const rest = input.filter((p) => !sameId.has(p.id));
  const keyed = rest.filter((p) => p.sourceId);
  const own = rest.filter((p) => !p.sourceId);
  const derived = await Promise.all(own.map((p) => importedId('poi', user.id, p.id)));
  const derivedHere = await present(db, PLACES, derived);
  const found = keyed.length
    ? (
        await db
          .prepare(
            `SELECT id, source, source_id FROM pois
             WHERE source IN ('amap', 'osm') AND source_id IN (SELECT value FROM json_each(?1))`
          )
          .bind(JSON.stringify([...new Set(keyed.map((p) => p.sourceId))]))
          .all<{ id: string; source: string; source_id: string }>()
      ).results
    : [];
  const byKey = new Map(found.map((r) => [`${r.source}:${r.source_id}`, r.id]));

  const ids = new Map<string, string>([...sameId].map((id) => [id, id]));
  const insert = (p: In, id: string, orIgnore: boolean) =>
    prep(
      db,
      `INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO pois (id, name, aliases, category, city, district, lat, lng, radius, source, source_id, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
      id,
      p.name,
      p.aliases.length ? JSON.stringify(p.aliases) : null,
      p.category,
      p.city,
      p.district,
      p.lat,
      p.lng,
      p.radius,
      p.source,
      p.sourceId,
      user.id,
      now
    );
  const statements: D1PreparedStatement[] = [];
  const pending: In[] = [];
  for (const p of keyed) {
    const key = `${p.source}:${p.sourceId}`;
    const at = byKey.get(key);
    if (at) ids.set(p.id, at);
    else {
      // another request may make the same place meanwhile: whichever comes first is the place, read back below
      if (at === undefined) statements.push(insert(p, newId.poi(), true));
      byKey.set(key, '');
      pending.push(p);
    }
  }
  own.forEach((p, i) => {
    if (!derivedHere.has(derived[i])) statements.push(insert(p, derived[i], false));
    ids.set(p.id, derived[i]);
  });
  let created = statements.length;
  if (statements.length) {
    if (pending.length) {
      statements.push(
        prep(
          db,
          `SELECT id, source, source_id FROM pois WHERE source IN ('amap', 'osm') AND source_id IN (SELECT value FROM json_each(?1))`,
          JSON.stringify([...new Set(pending.map((p) => p.sourceId))])
        )
      );
    }
    const results = await db.batch(statements);
    if (pending.length) {
      const back = (results[results.length - 1] as D1Result<{ id: string; source: string; source_id: string }>).results;
      const got = new Map(back.map((r) => [`${r.source}:${r.source_id}`, r.id]));
      for (const p of pending) {
        const id = got.get(`${p.source}:${p.sourceId}`);
        if (id) ids.set(p.id, id);
      }
      created -= results.slice(0, -1).filter((r) => !r.meta.changes).length;
    }
  }
  return c.json({ ids: Object.fromEntries(ids), created } satisfies ImportIdsResponse);
});

// ---- privacy zones ------------------------------------------------------------------------------------------------

/** New zones, as on the settings page: each also hides the positions of the user's photos already inside it. */
imports.post('/zones', async (c) => {
  const user = await requireUser(c);
  const rows = rowsOf(await readJson(c), 'zones', IMPORT_LIMITS.zones);
  const db = c.env.DB;
  const here = (
    await db
      .prepare('SELECT name, lat, lng, radius FROM privacy_zones WHERE owner_id = ?1')
      .bind(user.id)
      .all<{ name: string; lat: number; lng: number; radius: number }>()
  ).results;
  let room = PRIVACY_ZONE_LIMITS.count - here.length;
  const out: ImportZonesResponse = { created: 0, existing: 0, full: 0 };
  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  for (const r of rows) {
    let z: { name: string; lat: number; lng: number; radius: number };
    try {
      z = {
        name: reqStr(r, 'name', '区域名称', 1, PRIVACY_ZONE_LIMITS.nameMax),
        lat: reqNum(r.lat, '纬度', { min: -90, max: 90 }),
        lng: reqNum(r.lng, '经度', { min: -180, max: 180 }),
        radius: optNum(r.radius, '半径', { min: PRIVACY_ZONE_LIMITS.radiusMin, max: PRIVACY_ZONE_LIMITS.radiusMax }) ?? 300
      };
    } catch (e) {
      why(e);
      continue;
    }
    if (here.some((h) => h.name === z.name && h.lat === z.lat && h.lng === z.lng && h.radius === z.radius)) {
      out.existing++;
      continue;
    }
    if (room <= 0) {
      out.full++;
      continue;
    }
    room--;
    here.push(z);
    out.created++;
    const hide = await photosToHide(db, user.id, z);
    statements.push(
      prep(
        db,
        'INSERT INTO privacy_zones (id, owner_id, name, lat, lng, radius, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
        newId.zone(),
        user.id,
        z.name,
        z.lat,
        z.lng,
        z.radius,
        now
      )
    );
    if (hide.length) {
      statements.push(
        prep(
          db,
          `UPDATE photos SET geo_privacy = 'hidden', updated_at = ?1 WHERE owner_id = ?2 AND id IN (SELECT value FROM json_each(?3))`,
          now,
          user.id,
          JSON.stringify(hide)
        )
      );
    }
  }
  if (statements.length) await db.batch(statements);
  return c.json(out);
});

// ---- projects -----------------------------------------------------------------------------------------------------

imports.post('/projects', async (c) => {
  const user = await requireUser(c);
  const rows = rowsOf(await readJson(c, MAX_BYTES), 'projects', IMPORT_LIMITS.projects);
  const db = c.env.DB;
  const now = nowIso();
  const out = new Outcome();
  const statements: D1PreparedStatement[] = [];
  for (const { row, source, id } of await toMake(db, 'projects', user.id, rows, out)) {
    try {
      const f = parseProjectFields(row, true);
      assertDays(f.startDate as string, f.endDate ?? null);
      const raw = Array.isArray(row.milestones) ? row.milestones : [];
      if (raw.length > MILESTONE_LIMITS.count) throw invalid(`一个项目最多 ${MILESTONE_LIMITS.count} 个里程碑`);
      const milestones = raw.map((m: unknown, j: number) => {
        if (!isPlainObject(m)) throw invalid(`第 ${j + 1} 个里程碑格式不对`);
        const mf = parseMilestoneFields(m, true);
        const t = times(m, now);
        return { id: newId.milestone(), title: mf.title, body: mf.body ?? null, date: mf.date, createdAt: t.created, updatedAt: t.updated };
      });
      const t = times(row, now);
      statements.push(
        prepInsert(db, 'projects', {
          id,
          owner_id: user.id,
          type: f.type ?? 'other',
          title: f.title,
          description: f.description ?? null,
          start_date: f.startDate,
          end_date: f.endDate ?? null,
          status: f.status ?? 'active',
          visibility: f.visibility ?? 'private',
          created_at: t.created,
          updated_at: t.updated
        })
      );
      if (milestones.length) {
        statements.push(
          prep(
            db,
            `INSERT INTO milestones (id, project_id, title, body, date, created_at, updated_at)
             SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.title'), json_extract(value, '$.body'),
                    json_extract(value, '$.date'), json_extract(value, '$.createdAt'), json_extract(value, '$.updatedAt')
             FROM json_each(?2)`,
            id,
            JSON.stringify(milestones)
          )
        );
      }
      out.here(source, id, true);
    } catch (e) {
      out.failed.push({ id: source, message: why(e) });
    }
  }
  if (statements.length) await db.batch(statements);
  return c.json(out.json());
});

// ---- entries ------------------------------------------------------------------------------------------------------

imports.post('/entries', async (c) => {
  const user = await requireUser(c);
  const rows = rowsOf(await readJson(c, MAX_BYTES), 'entries', IMPORT_LIMITS.entries);
  const db = c.env.DB;
  const now = nowIso();
  const out = new Outcome();
  const make = await toMake(db, 'entries', user.id, rows, out);

  const parsed: { source: string; id: string; row: Body; f: ReturnType<typeof parseEntryFields> }[] = [];
  for (const m of make) {
    try {
      parsed.push({ ...m, f: parseEntryFields(m.row, true) });
    } catch (e) {
      out.failed.push({ id: m.source, message: why(e) });
    }
  }
  // what the entries point to, looked up once for the batch
  const photos = await present(
    db,
    MY_PHOTOS,
    parsed.flatMap((p) => (p.f.media ?? []).map((x) => x.photoId)),
    user.id
  );
  const tags = new Set(await usableTagIds(db, user.id, [...new Set(parsed.flatMap((p) => p.f.tagIds ?? []))]));
  const projects = new Set(await usableProjectIds(db, user.id, [...new Set(parsed.flatMap((p) => p.f.projectIds ?? []))]));
  const places = await present(
    db,
    PLACES,
    parsed.flatMap((p) => (p.f.poiId ? [p.f.poiId] : []))
  );

  const statements: D1PreparedStatement[] = [];
  for (const { source, id, row, f } of parsed) {
    const media = (f.media ?? []).filter((m) => photos.has(m.photoId));
    try {
      assertNotEmpty(f.title, f.body, media.length);
    } catch (e) {
      out.failed.push({ id: source, message: why(e) });
      continue;
    }
    const t = times(row, now);
    statements.push(
      prepInsert(db, 'entries', {
        id,
        owner_id: user.id,
        type: f.type ?? 'note',
        title: f.title ?? null,
        body: f.body ?? null,
        occurred_at: f.occurredAt,
        visibility: f.visibility ?? 'private',
        status: f.status ?? 'published',
        poi_id: f.poiId && places.has(f.poiId) ? f.poiId : null,
        revision: 1,
        created_at: t.created,
        updated_at: t.updated
      }),
      ...writeMedia(db, id, media),
      ...writeTags(
        db,
        id,
        (f.tagIds ?? []).filter((x) => tags.has(x))
      ),
      ...writeProjects(
        db,
        id,
        (f.projectIds ?? []).filter((x) => projects.has(x))
      )
    );
    out.here(source, id, true);
  }
  if (statements.length) await db.batch(statements);
  return c.json(out.json());
});

// ---- collections --------------------------------------------------------------------------------------------------

imports.post('/collections', async (c) => {
  const user = await requireUser(c);
  const rows = rowsOf(await readJson(c, MAX_BYTES), 'collections', IMPORT_LIMITS.collections);
  const db = c.env.DB;
  const now = nowIso();
  const out = new Outcome();
  const make = await toMake(db, 'themes', user.id, rows, out);

  const parsed: {
    source: string;
    id: string;
    row: Body;
    f: ReturnType<typeof parseThemeFields>;
    items: ReturnType<typeof parseItems>;
  }[] = [];
  for (const m of make) {
    try {
      parsed.push({ ...m, f: parseThemeFields(m.row, true), items: parseItems(m.row.items ?? []) });
    } catch (e) {
      out.failed.push({ id: m.source, message: why(e) });
    }
  }
  const photos = await present(
    db,
    MY_PHOTOS,
    parsed.flatMap((p) => [...p.items.photoIds, ...(p.f.coverPhotoId ? [p.f.coverPhotoId] : [])]),
    user.id
  );
  const entries = await present(
    db,
    MY_ENTRIES,
    parsed.flatMap((p) => p.items.entryIds),
    user.id
  );

  const statements: D1PreparedStatement[] = [];
  for (const { source, id, row, f, items } of parsed) {
    // an item whose photo or entry did not come along is left out, as when it is deleted here
    const kept = items.items.filter((it) =>
      it.kind === 'photo' ? photos.has(it.photoId as string) : it.kind === 'entry' ? entries.has(it.entryId as string) : true
    );
    const t = times(row, now);
    const visibility: Visibility = f.visibility ?? 'private';
    const published = pastIso(row.publishedAt, now) ?? (visibility === 'public' ? t.created : null);
    statements.push(
      prepInsert(db, 'themes', {
        id,
        owner_id: user.id,
        kind: f.kind,
        title: f.title,
        subtitle: f.subtitle ?? null,
        intro: f.intro ?? null,
        cover_photo_id: f.coverPhotoId && photos.has(f.coverPhotoId) ? f.coverPhotoId : null,
        start_date: f.startDate ?? null,
        end_date: f.endDate ?? null,
        visibility,
        created_at: t.created,
        updated_at: t.updated,
        published_at: published
      })
    );
    if (kept.length) statements.push(insertItems(db, id, kept));
    out.here(source, id, true);
  }
  if (statements.length) await db.batch(statements);
  return c.json(out.json());
});
