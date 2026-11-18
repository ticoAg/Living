// living.json as an import reads it (docs/api/export.md#livingjson): checked only as far as an import needs to work
// with it, every row otherwise as the export has it, for the Worker to check as it would a new one. And what an import
// sends for each row once what it points to has its id here, with the links in its text following along.
// Pure functions; run.ts reads the files and sends. Docs: /docs/product/features/import.md

import type {
  CreatePhotoMeta,
  ImportCollection,
  ImportCollectionItem,
  ImportEntry,
  ImportMilestone,
  ImportProject,
  Visibility
} from '../../shared/types';
import { FORMAT, FORMAT_VERSION } from '../export/archive';

type Json = Record<string, unknown>;

export interface ArchivePhoto {
  id: string;
  /** its file in the export, a path under the export's folder; null when none came with it */
  file: string | null;
  /** the 2560-pixel size stood in for an original the export could not read */
  large: boolean;
  /** of the original, as the site that exported it recorded it */
  sha256: string | null;
  uploadedAt: string;
  tags: { id: string; source: 'manual' | 'suggested' }[];
  row: Json;
}

export interface ArchiveEntry {
  id: string;
  media: { photoId: string; caption: string | null }[];
  tagIds: string[];
  projectIds: string[];
  row: Json;
}

export interface ArchiveProject {
  id: string;
  milestones: Json[];
  row: Json;
}

export interface ArchiveCollection {
  id: string;
  items: Json[];
  row: Json;
}

export interface Archive {
  exportedAt: string | null;
  site: { name: string; url: string } | null;
  profile: { id: string | null; handle: string | null; displayName: string | null };
  photos: ArchivePhoto[];
  entries: ArchiveEntry[];
  projects: ArchiveProject[];
  collections: ArchiveCollection[];
  tags: Json[];
  places: Json[];
  zones: Json[];
  /** an export holds which share links there were, never their addresses: there is nothing to bring over */
  shareLinks: number;
  /** rows not even shaped like rows (no id), left out */
  skipped: number;
}

/** A living.json an import cannot work with, said for the person who picked it. */
export class ArchiveError extends Error {}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SHA_RE = /^[0-9a-f]{64}$/i;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && ID_RE.test(x)) : []);

/** The rows of `key` that have an id; `skip` counts the others. */
function rows(json: Json, key: string, skip: () => void): Json[] {
  const v = json[key];
  if (!Array.isArray(v)) return [];
  return v.filter((r): r is Json => {
    const ok = isObj(r) && typeof r.id === 'string' && ID_RE.test(r.id);
    if (!ok) skip();
    return ok;
  });
}

export function readArchive(text: string): Archive {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ArchiveError('living.json 读不出来，文件可能不完整');
  }
  if (!isObj(json) || json.format !== FORMAT) throw new ArchiveError('这个 living.json 不是 Living 的导出');
  if (typeof json.version !== 'number' || json.version > FORMAT_VERSION)
    throw new ArchiveError('这份导出来自更新版本的 Living，这个站点还读不了');
  let skipped = 0;
  const skip = () => void skipped++;

  const site = isObj(json.site) && typeof json.site.url === 'string' ? { name: str(json.site.name) ?? 'Living', url: json.site.url } : null;
  const p = isObj(json.profile) ? json.profile : {};
  return {
    exportedAt: str(json.exportedAt),
    site,
    profile: { id: str(p.id), handle: str(p.handle), displayName: str(p.displayName) },
    photos: rows(json, 'photos', skip).map((r) => ({
      id: r.id as string,
      file: str(r.file),
      large: r.fileIsLarge === true,
      sha256: typeof r.sha256 === 'string' && SHA_RE.test(r.sha256) ? r.sha256.toLowerCase() : null,
      uploadedAt: str(r.uploadedAt) ?? '',
      tags: Array.isArray(r.tags)
        ? r.tags.flatMap((t) =>
            isObj(t) && typeof t.id === 'string'
              ? [{ id: t.id, source: t.source === 'suggested' ? ('suggested' as const) : ('manual' as const) }]
              : []
          )
        : [],
      row: r
    })),
    entries: rows(json, 'entries', skip).map((r) => ({
      id: r.id as string,
      media: Array.isArray(r.media)
        ? r.media.flatMap((m) => (isObj(m) && typeof m.photoId === 'string' ? [{ photoId: m.photoId, caption: str(m.caption) }] : []))
        : [],
      tagIds: ids(r.tagIds),
      projectIds: ids(r.projectIds),
      row: r
    })),
    projects: rows(json, 'projects', skip).map((r) => ({
      id: r.id as string,
      milestones: Array.isArray(r.milestones) ? r.milestones.filter(isObj) : [],
      row: r
    })),
    collections: rows(json, 'collections', skip).map((r) => ({
      id: r.id as string,
      items: Array.isArray(r.items) ? r.items.filter(isObj) : [],
      row: r
    })),
    tags: rows(json, 'tags', skip),
    places: rows(json, 'places', skip),
    zones: Array.isArray(json.privacyZones) ? json.privacyZones.filter(isObj) : [],
    shareLinks: Array.isArray(json.shareLinks) ? json.shareLinks.length : 0,
    skipped
  };
}

// ---- ids here, and the links that follow them ----------------------------------------------------------------------

/** Each kind's ids in the export → its ids here, filled in as the import goes. */
export interface IdMaps {
  photos: Map<string, string>;
  tags: Map<string, string>;
  places: Map<string, string>;
  entries: Map<string, string>;
  projects: Map<string, string>;
  collections: Map<string, string>;
}

export const emptyMaps = (): IdMaps => ({
  photos: new Map(),
  tags: new Map(),
  places: new Map(),
  entries: new Map(),
  projects: new Map(),
  collections: new Map()
});

export type Relink = (text: string | null) => string | null;

/** An id as this site makes them, of an item a page can be about: a prefix and a ULID (or an import's id, alike). */
const ID_TOKEN = /\b(?:en|ph|pj|th|poi|t)_[0-9A-HJKMNP-TV-Z]{26}\b/g;
const KIND: Record<string, keyof IdMaps> = { en: 'entries', ph: 'photos', pj: 'projects', th: 'collections', poi: 'places', t: 'tags' };
/** An absolute link in a text, as far as it runs: up to a space, a bracket or a quote (Markdown, HTML, prose). */
const LINK = /\bhttps?:\/\/[^\s<>()[\]"'`]+/gi;

/**
 * Links in an export's text that are to follow its items here: an id of an item in the maps becomes its id here, and
 * a link to the exporting site (`from`) whose path holds such an id goes to this site (`to`) instead. Other links, the
 * old site's other pages and other sites among them, stay as they were written. The maps are read as they are when a
 * text is relinked, so a text sent later follows more of its links.
 */
export function relinker(maps: IdMaps, from: string | null, to: string): Relink {
  const here = (id: string) => maps[KIND[id.slice(0, id.indexOf('_'))]]?.get(id);
  let origin: string | null = null;
  try {
    origin = from ? new URL(from).origin : null;
  } catch {
    origin = null;
  }
  const ids = (s: string) => s.replace(ID_TOKEN, (id) => here(id) ?? id);
  const holdsItem = (path: string) => (path.match(ID_TOKEN) ?? []).some((id) => here(id) !== undefined);
  const link = (url: string) => {
    if (origin && origin !== to && url.startsWith(`${origin}/`)) {
      const path = url.slice(origin.length);
      return holdsItem(path) ? `${to}${ids(path)}` : url;
    }
    // this site's own links follow its items; a link anywhere else is not about them
    return url === to || url.startsWith(`${to}/`) ? ids(url) : url;
  };
  return (text) => {
    if (!text) return text;
    let out = '';
    let last = 0;
    for (const m of text.matchAll(LINK)) {
      out += ids(text.slice(last, m.index)) + link(m[0]);
      last = m.index + m[0].length;
    }
    return out + ids(text.slice(last));
  };
}

// ---- what is sent ---------------------------------------------------------------------------------------------------

const VISIBILITIES = ['public', 'unlisted', 'private'];
const visibility = (v: unknown, privateAll: boolean): Visibility | undefined =>
  privateAll ? 'private' : VISIBILITIES.includes(v as string) ? (v as Visibility) : undefined;
const mapped = (list: string[], m: Map<string, string>) => list.flatMap((id) => (m.has(id) ? [m.get(id) as string] : []));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The parts of a processed file that an upload sends. */
export interface Resized {
  width: number;
  height: number;
  variants: Record<'s' | 'm' | 'l', { w: number; h: number }>;
  thumbhash: string;
  palette: string[];
  sha256: string | null;
}

/**
 * The upload's meta for a photo of the export: everything from living.json, nothing from the file's EXIF (a position
 * or a time taken off a photo there stays off), but the sizes, ThumbHash, palette and hash of the file as resized here.
 */
export function photoMeta(p: ArchivePhoto, file: Resized, maps: IdMaps, relink: Relink, privateAll: boolean): CreatePhotoMeta {
  const r = p.row;
  const poiId = typeof r.poiId === 'string' ? (maps.places.get(r.poiId) ?? null) : null;
  const tagged = (source: 'manual' | 'suggested') =>
    mapped(
      p.tags.filter((t) => t.source === source).map((t) => t.id),
      maps.tags
    );
  const focus =
    Array.isArray(r.focus) && r.focus.length === 2 && r.focus.every((x) => typeof x === 'number') ? (r.focus as [number, number]) : null;
  return {
    title: relink(str(r.title)),
    note: relink(str(r.note)),
    takenAt: str(r.takenAt),
    tz: str(r.tz),
    lat: num(r.lat),
    lng: num(r.lng),
    alt: num(r.alt),
    heading: num(r.heading),
    geoPrivacy: r.geoPrivacy === 'fuzzy' || r.geoPrivacy === 'hidden' ? r.geoPrivacy : 'exact',
    province: str(r.province),
    city: str(r.city),
    district: str(r.district),
    poiId,
    poiDistance: poiId ? num(r.poiDistance) : null,
    poiMethod: poiId && typeof r.poiMethod === 'string' ? (r.poiMethod as CreatePhotoMeta['poiMethod']) : null,
    camera: str(r.camera),
    lens: str(r.lens),
    focal: num(r.focal),
    focal35: num(r.focal35),
    aperture: num(r.aperture),
    shutter: str(r.shutter),
    iso: num(r.iso),
    width: file.width,
    height: file.height,
    variantSizes: {
      s: [file.variants.s.w, file.variants.s.h],
      m: [file.variants.m.w, file.variants.m.h],
      l: [file.variants.l.w, file.variants.l.h]
    },
    thumbhash: file.thumbhash,
    palette: file.palette,
    focus,
    visibility: visibility(r.visibility, privateAll),
    inLiving: r.inLiving !== false,
    favorite: r.favorite === true,
    sha256: file.sha256,
    tagIds: tagged('manual'),
    suggestedTagIds: tagged('suggested')
  };
}

export function projectRow(p: ArchiveProject, relink: Relink, privateAll: boolean): ImportProject {
  const r = p.row;
  return {
    id: p.id,
    type: r.type,
    title: r.title,
    description: relink(str(r.description)),
    startDate: r.startDate,
    endDate: r.endDate ?? null,
    status: r.status,
    visibility: visibility(r.visibility, privateAll),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    milestones: p.milestones.map((m): ImportMilestone => ({
      title: m.title as string,
      body: relink(str(m.body)),
      date: m.date as string,
      createdAt: m.createdAt as string,
      updatedAt: m.updatedAt as string
    }))
  } as ImportProject;
}

export function entryRow(e: ArchiveEntry, maps: IdMaps, relink: Relink, privateAll: boolean): ImportEntry {
  const r = e.row;
  return {
    id: e.id,
    type: r.type,
    title: relink(str(r.title)),
    body: relink(str(r.body)),
    occurredAt: r.occurredAt,
    visibility: visibility(r.visibility, privateAll),
    status: r.status,
    poiId: typeof r.poiId === 'string' ? (maps.places.get(r.poiId) ?? null) : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    media: e.media.flatMap((m) => {
      const id = maps.photos.get(m.photoId);
      return id ? [{ photoId: id, caption: relink(m.caption) }] : [];
    }),
    tagIds: mapped(e.tagIds, maps.tags),
    projectIds: mapped(e.projectIds, maps.projects)
  } as ImportEntry;
}

export function collectionRow(t: ArchiveCollection, maps: IdMaps, relink: Relink, privateAll: boolean): ImportCollection {
  const r = t.row;
  const items = t.items.flatMap((it): ImportCollectionItem[] => {
    const text = relink(str(it.text));
    if (it.kind === 'photo') {
      const id = typeof it.photoId === 'string' ? maps.photos.get(it.photoId) : undefined;
      return id ? [{ kind: 'photo', photoId: id, entryId: null, text, day: null }] : [];
    }
    if (it.kind === 'entry') {
      const id = typeof it.entryId === 'string' ? maps.entries.get(it.entryId) : undefined;
      return id ? [{ kind: 'entry', photoId: null, entryId: id, text, day: null }] : [];
    }
    if (it.kind === 'day') return [{ kind: 'day', photoId: null, entryId: null, text, day: str(it.day) }];
    if (it.kind === 'text') return text ? [{ kind: 'text', photoId: null, entryId: null, text, day: null }] : [];
    // a kind this site does not know: the Worker says so
    return [it as unknown as ImportCollectionItem];
  });
  return {
    id: t.id,
    kind: r.kind,
    title: relink(str(r.title)),
    subtitle: relink(str(r.subtitle)),
    intro: relink(str(r.intro)),
    coverPhotoId: typeof r.coverPhotoId === 'string' ? (maps.photos.get(r.coverPhotoId) ?? null) : null,
    startDate: r.startDate ?? null,
    endDate: r.endDate ?? null,
    visibility: visibility(r.visibility, privateAll),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    publishedAt: r.publishedAt ?? null,
    items
  } as ImportCollection;
}

/** A privacy zone as the Worker takes it. */
export const zoneRow = (z: Json) => ({ name: z.name, lat: z.lat, lng: z.lng, radius: z.radius });

const encoder = new TextEncoder();
/** `items` in batches of at most `max` rows and about `bytes` bytes of JSON; a row bigger than that goes alone. */
export function batches<T>(items: readonly T[], max: number, bytes = 1_000_000): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 0;
  for (const it of items) {
    const n = encoder.encode(JSON.stringify(it)).length;
    if (cur.length && (cur.length >= max || size + n > bytes)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(it);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Oldest first, as they were made, so that rows made in the same moment here keep their order. */
export const byCreated = (a: { row: Json; id: string }, b: { row: Json; id: string }) =>
  (str(a.row.createdAt) ?? '').localeCompare(str(b.row.createdAt) ?? '') || a.id.localeCompare(b.id);
