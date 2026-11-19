// Export (导出): everything one keeps here, read out page by page so that the browser can build the archive (Markdown,
// JSON and the original files) without the Worker holding it. Only the signed-in user's own rows, and no secrets: no
// password hash, no share-link token. Contract: /docs/api/export.md
//
// A page stops at PAGE_ROWS rows or about PAGE_BYTES of text, whichever comes first, so that one long article after
// another cannot make a response too big to build within a request's CPU time.

import { Hono } from 'hono';
import {
  EXPORT_PARTS,
  type ExportAttachment,
  type ExportEntry,
  type ExportEntryMedia,
  type ExportEntryProject,
  type ExportEntryTag,
  type ExportMilestone,
  type ExportPage,
  type ExportPart,
  type ExportPhoto,
  type ExportPhotoTag,
  type ExportPlace,
  type ExportPrivacyZone,
  type ExportProfile,
  type ExportProject,
  type ExportShareLink,
  type ExportSummary,
  type ExportTag,
  type ExportTheme,
  type ExportThemeItem,
  type Role,
  type Variants,
  type Visibility
} from '../../shared/types';
import type { AppEnv } from '../env';
import { ID_RE, invalid, notFound, unauthenticated } from '../lib/http';
import { viewerId } from '../lib/session';
import { parseAliases } from '../lib/poi';
import { parseJson, prepQ, Sql } from '../lib/sql';

export const exporter = new Hono<AppEnv>({ strict: false });

export const PAGE_ROWS = 500;
export const PAGE_BYTES = 1_000_000;

/** Bytes of a text column (NULL as 0). */
const bytes = (col: string) => `coalesce(length(CAST(${col} AS BLOB)), 0)`;

type Row = Record<string, unknown>;

interface PartSpec<T> {
  /** FROM clause, aliases included */
  from: string;
  /** whose rows: SQL with `?owner` standing for the user's id */
  where: string;
  /** columns that order the rows and tell one from another: the cursor */
  key: string[];
  cols: string;
  /** about how many bytes a row takes in the response */
  size: string;
  map: (r: Row) => T;
}

const str = (v: unknown) => v as string;
const opt = (v: unknown) => (v ?? null) as string | null;
const num = (v: unknown) => (v ?? null) as number | null;

const PARTS: { [P in ExportPart]: PartSpec<unknown> } = {
  photos: {
    from: 'photos p',
    where: 'p.owner_id = ?owner',
    key: ['p.id'],
    cols: `p.id, p.title, p.note, p.taken_at, p.tz, p.lat, p.lng, p.alt, p.heading, p.geo_privacy, p.province, p.city, p.district,
      p.poi_id, p.poi_distance, p.poi_method, p.camera, p.lens, p.focal, p.focal35, p.aperture, p.shutter, p.iso, p.width, p.height,
      p.file_key, p.file_type, p.file_size, p.sha256, p.variants, p.thumbhash, p.palette, p.focus_x, p.focus_y, p.visibility,
      p.in_living, p.favorite, p.uploaded_at, p.updated_at`,
    size: `${bytes('p.note')} + ${bytes('p.title')} + 900`,
    map: (r): ExportPhoto => ({
      id: str(r.id),
      title: opt(r.title),
      note: opt(r.note),
      takenAt: opt(r.taken_at),
      tz: opt(r.tz),
      lat: num(r.lat),
      lng: num(r.lng),
      alt: num(r.alt),
      heading: num(r.heading),
      geoPrivacy: r.geo_privacy as ExportPhoto['geoPrivacy'],
      // '' once looked up without a result, as everywhere else in the API
      province: (r.province as string | null) || null,
      city: opt(r.city),
      district: opt(r.district),
      poiId: opt(r.poi_id),
      poiDistance: num(r.poi_distance),
      poiMethod: (r.poi_method ?? null) as ExportPhoto['poiMethod'],
      camera: opt(r.camera),
      lens: opt(r.lens),
      focal: num(r.focal),
      focal35: num(r.focal35),
      aperture: num(r.aperture),
      shutter: opt(r.shutter),
      iso: num(r.iso),
      width: r.width as number,
      height: r.height as number,
      fileKey: str(r.file_key),
      fileType: opt(r.file_type),
      fileSize: num(r.file_size),
      sha256: opt(r.sha256),
      variants: parseJson<Variants>(r.variants as string) as Variants,
      thumbhash: opt(r.thumbhash),
      palette: parseJson<string[]>(r.palette as string | null),
      focus: r.focus_x !== null && r.focus_y !== null ? [r.focus_x as number, r.focus_y as number] : null,
      visibility: r.visibility as Visibility,
      inLiving: r.in_living === 1,
      favorite: r.favorite === 1,
      uploadedAt: str(r.uploaded_at),
      updatedAt: opt(r.updated_at)
    })
  },
  photoTags: {
    from: 'photo_tags pt JOIN photos p ON p.id = pt.photo_id',
    where: 'p.owner_id = ?owner',
    key: ['pt.photo_id', 'pt.tag_id'],
    cols: 'pt.photo_id, pt.tag_id, pt.source',
    size: '80',
    map: (r): ExportPhotoTag => ({ photoId: str(r.photo_id), tagId: str(r.tag_id), source: r.source as ExportPhotoTag['source'] })
  },
  entries: {
    from: 'entries e',
    where: 'e.owner_id = ?owner',
    key: ['e.id'],
    cols: 'e.id, e.type, e.title, e.body, e.occurred_at, e.visibility, e.status, e.revision, e.poi_id, e.created_at, e.updated_at',
    size: `${bytes('e.body')} + ${bytes('e.title')} + 300`,
    map: (r): ExportEntry => ({
      id: str(r.id),
      type: r.type as ExportEntry['type'],
      title: opt(r.title),
      body: opt(r.body),
      occurredAt: str(r.occurred_at),
      visibility: r.visibility as Visibility,
      status: r.status as ExportEntry['status'],
      revision: r.revision as number,
      poiId: opt(r.poi_id),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at)
    })
  },
  entryMedia: {
    from: 'entry_media em JOIN entries e ON e.id = em.entry_id',
    where: 'e.owner_id = ?owner',
    key: ['em.entry_id', 'em.photo_id'],
    cols: 'em.entry_id, em.photo_id, em.position, em.caption',
    size: `${bytes('em.caption')} + 120`,
    map: (r): ExportEntryMedia => ({
      entryId: str(r.entry_id),
      photoId: str(r.photo_id),
      position: r.position as number,
      caption: opt(r.caption)
    })
  },
  entryTags: {
    from: 'entry_tags et JOIN entries e ON e.id = et.entry_id',
    where: 'e.owner_id = ?owner',
    key: ['et.entry_id', 'et.tag_id'],
    cols: 'et.entry_id, et.tag_id',
    size: '70',
    map: (r): ExportEntryTag => ({ entryId: str(r.entry_id), tagId: str(r.tag_id) })
  },
  entryProjects: {
    from: 'entry_projects ep JOIN entries e ON e.id = ep.entry_id',
    where: 'e.owner_id = ?owner',
    key: ['ep.entry_id', 'ep.project_id'],
    cols: 'ep.entry_id, ep.project_id',
    size: '80',
    map: (r): ExportEntryProject => ({ entryId: str(r.entry_id), projectId: str(r.project_id) })
  },
  // the ones in entries: a loose one is an upload not kept, or one taken out of its entry
  attachments: {
    from: 'attachments a',
    where: 'a.owner_id = ?owner AND a.entry_id IS NOT NULL AND a.uploaded_at IS NOT NULL',
    key: ['a.id'],
    cols: 'a.id, a.entry_id, a.position, a.caption, a.kind, a.name, a.mime, a.size, a.duration, a.width, a.height, a.poster_key, a.created_at',
    size: `${bytes('a.caption')} + ${bytes('a.name')} + 300`,
    map: (r): ExportAttachment => ({
      id: str(r.id),
      entryId: str(r.entry_id),
      position: r.position as number,
      caption: opt(r.caption),
      kind: r.kind as ExportAttachment['kind'],
      name: str(r.name),
      mime: str(r.mime),
      size: r.size as number,
      duration: num(r.duration),
      width: num(r.width),
      height: num(r.height),
      poster: r.poster_key !== null,
      createdAt: str(r.created_at)
    })
  },
  projects: {
    from: 'projects pj',
    where: 'pj.owner_id = ?owner',
    key: ['pj.id'],
    cols: 'pj.id, pj.type, pj.title, pj.description, pj.start_date, pj.end_date, pj.status, pj.visibility, pj.created_at, pj.updated_at',
    size: `${bytes('pj.description')} + ${bytes('pj.title')} + 300`,
    map: (r): ExportProject => ({
      id: str(r.id),
      type: r.type as ExportProject['type'],
      title: str(r.title),
      description: opt(r.description),
      startDate: str(r.start_date),
      endDate: opt(r.end_date),
      status: r.status as ExportProject['status'],
      visibility: r.visibility as Visibility,
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at)
    })
  },
  milestones: {
    from: 'milestones ms JOIN projects pj ON pj.id = ms.project_id',
    where: 'pj.owner_id = ?owner',
    key: ['ms.id'],
    cols: 'ms.id, ms.project_id, ms.title, ms.body, ms.date, ms.created_at, ms.updated_at',
    size: `${bytes('ms.body')} + ${bytes('ms.title')} + 200`,
    map: (r): ExportMilestone => ({
      id: str(r.id),
      projectId: str(r.project_id),
      title: str(r.title),
      body: opt(r.body),
      date: str(r.date),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at)
    })
  },
  themes: {
    from: 'themes th',
    where: 'th.owner_id = ?owner',
    key: ['th.id'],
    cols: `th.id, th.kind, th.title, th.subtitle, th.intro, th.cover_photo_id, th.start_date, th.end_date, th.visibility,
      th.created_at, th.updated_at, th.published_at`,
    size: `${bytes('th.intro')} + ${bytes('th.subtitle')} + ${bytes('th.title')} + 300`,
    map: (r): ExportTheme => ({
      id: str(r.id),
      kind: r.kind as ExportTheme['kind'],
      title: str(r.title),
      subtitle: opt(r.subtitle),
      intro: opt(r.intro),
      coverPhotoId: opt(r.cover_photo_id),
      startDate: opt(r.start_date),
      endDate: opt(r.end_date),
      visibility: r.visibility as Visibility,
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
      publishedAt: opt(r.published_at)
    })
  },
  themeItems: {
    from: 'theme_items ti JOIN themes th ON th.id = ti.theme_id',
    where: 'th.owner_id = ?owner',
    key: ['ti.id'],
    cols: 'ti.id, ti.theme_id, ti.position, ti.kind, ti.photo_id, ti.entry_id, ti.text, ti.day',
    size: `${bytes('ti.text')} + 200`,
    map: (r): ExportThemeItem => ({
      id: str(r.id),
      themeId: str(r.theme_id),
      position: r.position as number,
      kind: r.kind as ExportThemeItem['kind'],
      photoId: opt(r.photo_id),
      entryId: opt(r.entry_id),
      text: opt(r.text),
      day: opt(r.day)
    })
  },
  tags: {
    from: 'tags t',
    // the presets too: one's own tags hang under them, and photos and entries carry them
    where: '(t.owner_id IS NULL OR t.owner_id = ?owner)',
    key: ['t.id'],
    cols: 't.id, t.owner_id, t.parent_id, t.name, t.color, t.sort, t.created_at',
    size: '200',
    map: (r): ExportTag => ({
      id: str(r.id),
      ownerId: opt(r.owner_id),
      parentId: opt(r.parent_id),
      name: str(r.name),
      color: opt(r.color),
      sort: r.sort as number,
      createdAt: str(r.created_at)
    })
  },
  places: {
    from: 'pois po',
    where: `(po.created_by = ?owner OR EXISTS (SELECT 1 FROM photos p WHERE p.poi_id = po.id AND p.owner_id = ?owner)
      OR EXISTS (SELECT 1 FROM entries e WHERE e.poi_id = po.id AND e.owner_id = ?owner))`,
    key: ['po.id'],
    cols: 'po.id, po.name, po.aliases, po.category, po.city, po.district, po.lat, po.lng, po.radius, po.source, po.source_id, po.created_by, po.created_at',
    size: `${bytes('po.aliases')} + 400`,
    map: (r): ExportPlace => ({
      id: str(r.id),
      name: str(r.name),
      // as GET /api/pois/:id: only who made a place sees its aliases
      aliases: r.own === 1 ? parseAliases(r.aliases as string | null) : [],
      category: str(r.category),
      city: opt(r.city),
      district: opt(r.district),
      lat: r.lat as number,
      lng: r.lng as number,
      radius: r.radius as number,
      source: r.source as ExportPlace['source'],
      sourceId: opt(r.source_id),
      own: r.own === 1,
      createdAt: str(r.created_at)
    })
  },
  privacyZones: {
    from: 'privacy_zones z',
    where: 'z.owner_id = ?owner',
    key: ['z.id'],
    cols: 'z.id, z.name, z.lat, z.lng, z.radius, z.created_at',
    size: '200',
    map: (r): ExportPrivacyZone => ({
      id: str(r.id),
      name: str(r.name),
      lat: r.lat as number,
      lng: r.lng as number,
      radius: r.radius as number,
      createdAt: str(r.created_at)
    })
  },
  shareLinks: {
    from: 'share_links s',
    where: 's.owner_id = ?owner',
    key: ['s.id'],
    // never the token
    cols: 's.id, s.entry_id, s.theme_id, s.project_id, s.created_at, s.expires_at',
    size: '200',
    map: (r): ExportShareLink => ({
      id: str(r.id),
      kind: r.entry_id ? 'entry' : r.theme_id ? 'theme' : 'project',
      itemId: str(r.entry_id ?? r.theme_id ?? r.project_id),
      createdAt: str(r.created_at),
      expiresAt: opt(r.expires_at)
    })
  }
};

/** `where` with the user bound on `q`. */
const scoped = (spec: PartSpec<unknown>, q: Sql, owner: string) => {
  const p = q.p(owner);
  return spec.where.replaceAll('?owner', p);
};

/** `(k1, k2) > (?, ?)` for a cursor, or `(k1) <= (…)` with `op`. */
function keyCompare(spec: PartSpec<unknown>, q: Sql, op: '>' | '<=', values: string[]): string {
  return `(${spec.key.join(', ')}) ${op} (${values.map((v) => q.p(v)).join(', ')})`;
}

const keyAlias = (i: number) => `k${i}`;

/** The cursor of a row: its key values, comma-joined (ids hold no commas). */
const cursorOf = (spec: PartSpec<unknown>, r: Row) => spec.key.map((_, i) => r[keyAlias(i)] as string).join(',');

async function readPage(db: D1Database, part: ExportPart, owner: string, after: string[] | null): Promise<ExportPage> {
  const spec = PARTS[part];
  const order = spec.key.join(', ');
  // which rows fit: their keys and sizes, one past the page to tell whether the part goes on
  const qk = new Sql();
  const keys = await prepQ(
    db,
    `SELECT ${spec.key.map((k, i) => `${k} AS ${keyAlias(i)}`).join(', ')}, ${spec.size} AS n FROM ${spec.from}
     WHERE ${scoped(spec, qk, owner)}${after ? ` AND ${keyCompare(spec, qk, '>', after)}` : ''}
     ORDER BY ${order} LIMIT ${PAGE_ROWS + 1}`,
    qk
  ).all<Row>();
  const fit: Row[] = [];
  let used = 0;
  for (const r of keys.results) {
    if (fit.length === PAGE_ROWS || (fit.length && used + (r.n as number) > PAGE_BYTES)) break;
    fit.push(r);
    used += r.n as number;
  }
  if (!fit.length) return { rows: [], next: null };
  const last = cursorOf(spec, fit[fit.length - 1]).split(',');

  const q = new Sql();
  // places say whether this account made them
  const own = part === 'places' ? `, (po.created_by IS NOT NULL AND po.created_by = ${q.p(owner)}) AS own` : '';
  const rows = await prepQ(
    db,
    `SELECT ${spec.cols}${own} FROM ${spec.from}
     WHERE ${scoped(spec, q, owner)}${after ? ` AND ${keyCompare(spec, q, '>', after)}` : ''} AND ${keyCompare(spec, q, '<=', last)}
     ORDER BY ${order}`,
    q
  ).all<Row>();
  return { rows: rows.results.map(spec.map) as Row[], next: keys.results.length > fit.length ? last.join(',') : null };
}

async function requireViewer(c: Parameters<typeof viewerId>[0]): Promise<string> {
  const viewer = await viewerId(c);
  if (!viewer) throw unauthenticated();
  return viewer;
}

exporter.get('/', async (c) => {
  const viewer = await requireViewer(c);
  const db = c.env.DB;
  const q = new Sql();
  const v = q.p(viewer);
  const counts = EXPORT_PARTS.map((part) => {
    const spec = PARTS[part];
    return `(SELECT COUNT(*) FROM ${spec.from} WHERE ${spec.where.replaceAll('?owner', v)}) AS ${part}`;
  });
  const row = await prepQ(
    db,
    `SELECT u.id, u.handle, u.display_name, u.bio, u.avatar_photo_id, u.role, u.photo_visibility, u.created_at,
       (SELECT coalesce(SUM(file_size), 0) FROM photos WHERE owner_id = ${v}) AS original_bytes,
       (SELECT coalesce(SUM(a.size), 0) FROM ${PARTS.attachments.from} WHERE ${PARTS.attachments.where.replaceAll('?owner', v)}) AS attachment_bytes,
       ${counts.join(', ')}
     FROM users u WHERE u.id = ${v}`,
    q
  ).first<Row>();
  if (!row) throw unauthenticated();
  const profile: ExportProfile = {
    id: str(row.id),
    handle: str(row.handle),
    displayName: str(row.display_name),
    bio: opt(row.bio),
    avatarPhotoId: opt(row.avatar_photo_id),
    role: row.role as Role,
    photoVisibility: row.photo_visibility as Visibility,
    createdAt: str(row.created_at)
  };
  const body: ExportSummary = {
    profile,
    counts: Object.fromEntries(EXPORT_PARTS.map((p) => [p, row[p] as number])) as ExportSummary['counts'],
    originalBytes: row.original_bytes as number,
    attachmentBytes: row.attachment_bytes as number
  };
  return c.json(body);
});

exporter.get('/:part', async (c) => {
  const viewer = await requireViewer(c);
  const part = c.req.param('part');
  if (!(EXPORT_PARTS as readonly string[]).includes(part)) throw notFound('没有这一部分');
  const spec = PARTS[part as ExportPart];
  const raw = c.req.query('after');
  let after: string[] | null = null;
  if (raw !== undefined) {
    after = raw.split(',');
    if (after.length !== spec.key.length || !after.every((k) => ID_RE.test(k))) throw invalid('after 不是这一部分的位置');
  }
  return c.json(await readPage(c.env.DB, part as ExportPart, viewer, after));
});
