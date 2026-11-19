// Fixtures shared by the front end's unit tests. Nothing in the app imports this file.

import type {
  Attachment,
  EntryDetail,
  EntrySummary,
  ExportEntry,
  ExportPhoto,
  ExportPlace,
  ExportProfile,
  ExportProject,
  ExportTheme,
  PhotoDetail,
  PhotoSummary,
  Poi,
  ThemeDetail
} from '../shared/types';
import type { ExportData } from './export/archive';

export const VARIANTS: PhotoSummary['variants'] = {
  s: { key: 'v/x/s.webp', w: 480, h: 320 },
  m: { key: 'v/x/m.webp', w: 1600, h: 1067 },
  l: { key: 'v/x/l.webp', w: 2560, h: 1707 }
};

/** A public, located-nowhere photo that Living can play; override what a test cares about. */
export function photo(id: string, over: Partial<PhotoSummary> = {}): PhotoSummary {
  return {
    id,
    ownerId: 'u_1',
    ownerHandle: 'ada',
    title: null,
    takenAt: null,
    width: 3000,
    height: 2000,
    thumbhash: null,
    variants: VARIANTS,
    palette: null,
    poiId: null,
    province: null,
    city: null,
    district: null,
    tagIds: [],
    visibility: 'public',
    geoPrivacy: 'exact',
    lat: null,
    lng: null,
    heading: null,
    inLiving: true,
    favorite: false,
    hasNote: false,
    focus: null,
    ...over
  };
}

export function photoDetail(id: string, over: Partial<PhotoDetail> = {}): PhotoDetail {
  return {
    ...photo(id),
    note: null,
    tz: '+08:00',
    alt: null,
    poi: null,
    poiDistance: null,
    poiMethod: null,
    camera: null,
    lens: null,
    focal: null,
    focal35: null,
    aperture: null,
    shutter: null,
    iso: null,
    themes: [],
    entries: [],
    uploadedAt: '2026-11-08T08:00:00Z',
    updatedAt: null,
    ...over
  };
}

export function poi(id: string, over: Partial<Poi> = {}): Poi {
  return {
    id,
    name: '断桥',
    category: '桥',
    city: '杭州',
    district: '西湖区',
    lat: 30.2589,
    lng: 120.1494,
    radius: 60,
    source: 'custom',
    sourceId: null,
    ...over
  };
}

export function themeDetail(over: Partial<ThemeDetail> = {}): ThemeDetail {
  return {
    id: 'th_1',
    ownerId: 'u_1',
    ownerHandle: 'ada',
    kind: 'trip',
    title: '西湖三日',
    subtitle: null,
    coverPhotoId: null,
    cover: null,
    startDate: null,
    endDate: null,
    visibility: 'public',
    photoCount: 0,
    entryCount: 0,
    createdAt: '2026-11-08T00:00:00Z',
    updatedAt: '2026-11-08T00:00:00Z',
    publishedAt: null,
    intro: null,
    items: [],
    pois: [],
    ...over
  };
}

/** A video of ada's, uploaded in full: 3 MB, 12.5 seconds, with a frame. */
export function attachment(id: string, over: Partial<Attachment> = {}): Attachment {
  return {
    id,
    kind: 'video',
    name: '湖边.mp4',
    mime: 'video/mp4',
    size: 3_000_000,
    duration: 12.5,
    width: 1920,
    height: 1080,
    poster: true,
    createdAt: '2026-11-16T01:00:00Z',
    ...over
  };
}

/** A finished private note of ada's, written when it happened; override what a test cares about. */
export function entry(id: string, over: Partial<EntrySummary> = {}): EntrySummary {
  return {
    id,
    ownerId: 'u_1',
    ownerHandle: 'ada',
    type: 'note',
    title: null,
    excerpt: '今天',
    hasMore: false,
    chars: 2,
    occurredAt: '2026-11-16T09:00:00',
    visibility: 'private',
    status: 'published',
    photoIds: [],
    tagIds: [],
    projectIds: [],
    poi: null,
    attachments: [],
    createdAt: '2026-11-16T01:00:00Z',
    updatedAt: '2026-11-16T01:00:00Z',
    ...over
  };
}

export function entryDetail(id: string, over: Partial<EntryDetail> = {}): EntryDetail {
  return { ...entry(id), body: '今天', media: [], attachments: [], revision: 1, themes: [], ...over };
}

// ---- export ----

export const EXPORT_PROFILE: ExportProfile = {
  id: 'u_ADA',
  handle: 'ada',
  displayName: 'Ada',
  bio: null,
  avatarPhotoId: null,
  role: 'owner',
  photoVisibility: 'public',
  createdAt: '2026-01-01T00:00:00Z'
};

/** An original of `size` bytes taken on `takenAt` (or undated), with its three sizes. */
export function exportPhoto(id: string, over: Partial<ExportPhoto> = {}): ExportPhoto {
  return {
    id,
    title: null,
    note: null,
    takenAt: '2026-11-16T15:30:00',
    tz: null,
    lat: null,
    lng: null,
    alt: null,
    heading: null,
    geoPrivacy: 'exact',
    province: null,
    city: null,
    district: null,
    poiId: null,
    poiDistance: null,
    poiMethod: null,
    camera: null,
    lens: null,
    focal: null,
    focal35: null,
    aperture: null,
    shutter: null,
    iso: null,
    width: 3000,
    height: 2000,
    fileKey: `o/${EXPORT_PROFILE.id}/${id}.jpg`,
    fileType: 'image/jpeg',
    fileSize: 8,
    sha256: null,
    variants: {
      s: { key: `v/${id}/s.webp`, w: 480, h: 320 },
      m: { key: `v/${id}/m.webp`, w: 1600, h: 1067 },
      l: { key: `v/${id}/l.webp`, w: 2560, h: 1707 }
    },
    thumbhash: null,
    palette: null,
    focus: null,
    visibility: 'public',
    inLiving: true,
    favorite: false,
    uploadedAt: '2026-11-16T08:00:00Z',
    updatedAt: null,
    ...over
  };
}

export function exportEntry(id: string, over: Partial<ExportEntry> = {}): ExportEntry {
  return {
    id,
    type: 'note',
    title: null,
    body: '今天',
    occurredAt: '2026-11-16T15:30:00',
    visibility: 'private',
    status: 'published',
    revision: 1,
    poiId: null,
    createdAt: '2026-11-16T08:00:00Z',
    updatedAt: '2026-11-16T08:00:00Z',
    ...over
  };
}

export function exportProject(id: string, over: Partial<ExportProject> = {}): ExportProject {
  return {
    id,
    type: 'learning',
    title: '学吉他',
    description: null,
    startDate: '2026-09-01',
    endDate: null,
    status: 'active',
    visibility: 'private',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...over
  };
}

export function exportTheme(id: string, over: Partial<ExportTheme> = {}): ExportTheme {
  return {
    id,
    kind: 'trip',
    title: '杭州',
    subtitle: null,
    intro: null,
    coverPhotoId: null,
    startDate: '2026-11-15',
    endDate: '2026-11-17',
    visibility: 'private',
    createdAt: '2026-11-17T00:00:00Z',
    updatedAt: '2026-11-17T00:00:00Z',
    publishedAt: null,
    ...over
  };
}

export function exportPlace(id: string, over: Partial<ExportPlace> = {}): ExportPlace {
  return {
    id,
    name: '西湖',
    aliases: [],
    category: 'scenic',
    city: '杭州',
    district: '西湖区',
    lat: 30.25,
    lng: 120.15,
    radius: 500,
    source: 'custom',
    sourceId: null,
    own: true,
    createdAt: '2026-01-01T00:00:00Z',
    ...over
  };
}

/** An export of `over`'s rows; the summary counts them. */
export function exportData(over: Partial<Omit<ExportData, 'summary'>> = {}): ExportData {
  const rows = {
    photos: [],
    photoTags: [],
    entries: [],
    entryMedia: [],
    entryTags: [],
    entryProjects: [],
    attachments: [],
    projects: [],
    milestones: [],
    themes: [],
    themeItems: [],
    tags: [],
    places: [],
    privacyZones: [],
    shareLinks: [],
    ...over
  };
  const counts = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length])) as ExportData['summary']['counts'];
  const originalBytes = rows.photos.reduce((n, p) => n + (p.fileSize ?? 0), 0);
  const attachmentBytes = rows.attachments.reduce((n, a) => n + a.size, 0);
  return { summary: { profile: EXPORT_PROFILE, counts, originalBytes, attachmentBytes }, ...rows };
}

/** A folder in memory that answers like a FileSystemDirectoryHandle, as far as the export uses one. */
export class FakeDir {
  readonly kind = 'directory';
  readonly entries = new Map<string, FakeDir | FakeFile>();
  constructor(readonly name: string) {}

  #child(name: string) {
    if (!name || name === '.' || name === '..' || name.includes('/')) throw new TypeError(`bad name: ${name}`);
    return this.entries.get(name);
  }

  async getDirectoryHandle(name: string, o: { create?: boolean } = {}): Promise<FakeDir> {
    const e = this.#child(name);
    if (e instanceof FakeDir) return e;
    if (e) throw new DOMException(name, 'TypeMismatchError');
    if (!o.create) throw new DOMException(name, 'NotFoundError');
    const d = new FakeDir(name);
    this.entries.set(name, d);
    return d;
  }

  async getFileHandle(name: string, o: { create?: boolean } = {}): Promise<FakeFile> {
    const e = this.#child(name);
    if (e instanceof FakeFile) return e;
    if (e) throw new DOMException(name, 'TypeMismatchError');
    if (!o.create) throw new DOMException(name, 'NotFoundError');
    const f = new FakeFile(name);
    this.entries.set(name, f);
    return f;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.entries.delete(name)) throw new DOMException(name, 'NotFoundError');
  }

  /** Every file below, by its path. */
  files(prefix = ''): Map<string, Blob> {
    const out = new Map<string, Blob>();
    for (const [name, e] of this.entries) {
      if (e instanceof FakeDir) for (const [p, b] of e.files(`${prefix}${name}/`)) out.set(p, b);
      else out.set(`${prefix}${name}`, e.data);
    }
    return out;
  }

  /** Puts a file at `path`, making its folders. */
  async put(path: string, data: BlobPart): Promise<void> {
    const parts = path.split('/');
    const name = parts.pop() as string;
    const dir = await parts.reduce<Promise<FakeDir>>(
      async (d, p) => (await d).getDirectoryHandle(p, { create: true }),
      Promise.resolve(this)
    );
    (await dir.getFileHandle(name, { create: true })).data = new Blob([data]);
  }

  get handle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle;
  }
}

export class FakeFile {
  readonly kind = 'file';
  data = new Blob([]);
  constructor(readonly name: string) {}

  async getFile(): Promise<File> {
    return new File([this.data], this.name);
  }

  /** Like the real one, the file changes only when the stream is closed. */
  async createWritable() {
    const chunks: BlobPart[] = [];
    return {
      write: async (d: Blob) => void chunks.push(d),
      close: async () => {
        this.data = new Blob(chunks);
      },
      abort: async () => {}
    };
  }
}
