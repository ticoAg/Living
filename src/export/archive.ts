// What an export holds, worked out from the rows of GET /api/export/:part: the path of every file, each entry,
// project and collection as Markdown, and living.json with everything. Pure functions; run.ts fetches and writes.
// Docs: /docs/product/features/export.md, the format: /docs/api/export.md#导出的文件

import { entryLabel, entryTypeLabel, ENTRY_STATUS_LABELS } from '../../shared/entries';
import { PROJECT_STATUS_LABELS, projectTypeLabel } from '../../shared/projects';
import type {
  ExportAttachment,
  ExportEntry,
  ExportEntryMedia,
  ExportEntryProject,
  ExportEntryTag,
  ExportMilestone,
  ExportPhoto,
  ExportPhotoTag,
  ExportPlace,
  ExportPrivacyZone,
  ExportProfile,
  ExportProject,
  ExportShareLink,
  ExportSummary,
  ExportTag,
  ExportTheme,
  ExportThemeItem,
  SiteInfo
} from '../../shared/types';

export const FORMAT = 'living-export';
export const FORMAT_VERSION = 1;

/** Everything read from the API, by part. */
export interface ExportData {
  summary: ExportSummary;
  photos: ExportPhoto[];
  photoTags: ExportPhotoTag[];
  entries: ExportEntry[];
  entryMedia: ExportEntryMedia[];
  entryTags: ExportEntryTag[];
  entryProjects: ExportEntryProject[];
  attachments: ExportAttachment[];
  projects: ExportProject[];
  milestones: ExportMilestone[];
  themes: ExportTheme[];
  themeItems: ExportThemeItem[];
  tags: ExportTag[];
  places: ExportPlace[];
  privacyZones: ExportPrivacyZone[];
  shareLinks: ExportShareLink[];
}

/** A file of the export, by its path under the root folder. */
export interface TextFile {
  path: string;
  text: string;
  mtime: Date;
}

/** The archive's folder: one per account, the same each time, so that a later export lands on an earlier one. */
export const rootFolder = (profile: Pick<ExportProfile, 'handle'>) => `living-${safeName(profile.handle) || 'export'}`;

/** A ZIP's file name: the folder and the day, with the part's number when there are several. */
export const zipName = (root: string, day: string, part: number | null) => `${root}-${day}${part === null ? '' : `-${part}`}.zip`;

// ---- names ---------------------------------------------------------------------------------------------------------

/** Characters no file system takes in a name (or that Markdown links would trip on), and controls. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f<>:"/\\|?*#[\]\u2028\u2029]/g;
const RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;

/** `s` as a file name: unsafe characters out, spaces folded, at most `max` characters, no dot or space at the end. */
export function safeName(s: string, max = 40): string {
  const clean = [...s.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()]
    .slice(0, max)
    .join('')
    .replace(/[. ]+$/, '')
    .trim();
  return RESERVED.test(clean) ? `${clean}_` : clean;
}

/** Hands out paths, numbering a name already given ("x (2).md"); file systems may ignore case, so this does too. */
export class PathSet {
  #used = new Set<string>();
  take(dir: string, base: string, ext: string): string {
    for (let n = 1; ; n++) {
      const path = `${dir}/${n === 1 ? base : `${base} (${n})`}${ext}`;
      const key = path.toLowerCase();
      if (!this.#used.has(key)) {
        this.#used.add(key);
        return path;
      }
    }
  }
}

/** The local time of `YYYY-MM-DD[THH:mm:ss]` (a wall-clock time without zone) or of a UTC stamp ending in Z. */
export function localDate(t: string | null | undefined): Date | null {
  if (!t) return null;
  if (t.endsWith('Z')) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(t);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

const extOf = (key: string) => {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(key);
  return m ? m[1].toLowerCase() : 'bin';
};

/** Where a photo's file goes: by the year it was taken, named by its day and id; the extension is the file's own. */
export function mediaPath(p: Pick<ExportPhoto, 'id' | 'takenAt'>, key: string): string {
  const day = p.takenAt?.slice(0, 10);
  return day ? `media/${day.slice(0, 4)}/${day}_${p.id}.${extOf(key)}` : `media/undated/${p.id}.${extOf(key)}`;
}

/** The relative link from a file to another, both under the root. */
export function relative(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

// ---- Markdown ------------------------------------------------------------------------------------------------------

/** YAML frontmatter, to be followed by a blank line; values are JSON, which YAML reads as they are. Empty values are left out. */
export function frontmatter(fields: [string, unknown][]): string {
  const lines = fields
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---`;
}

/** A link destination in angle brackets, which may hold spaces; our names hold no < > or line breaks. */
const dest = (path: string) => `<${path}>`;
const escapeText = (s: string) => s.replace(/[[\]\\]/g, (m) => `\\${m}`);
const firstLine = (s: string | null | undefined) => (s ?? '').split(/\r\n?|\n/)[0].trim();

function image(from: string, id: string, file: string | undefined, caption: string | null): string {
  // without its file (an export without photos), the photo is named, so that living.json can tell which it was
  if (!file) return caption ? `（照片 ${id}）\n\n${caption}` : `（照片 ${id}）`;
  const md = `![${escapeText(firstLine(caption))}](${dest(relative(from, file))})`;
  return caption ? `${md}\n\n${caption}` : md;
}

/** Context for the Markdown of one export: the rows by id and the path each item got. */
export interface Index {
  photoFile: Map<string, string>;
  entryFile: Map<string, string>;
  tagName: Map<string, string>;
  place: Map<string, ExportPlace>;
  projectTitle: Map<string, string>;
  entryLabel: Map<string, string>;
}

const placeLine = (p: ExportPlace | undefined) => (p ? [p.name, p.district || p.city].filter(Boolean).join('，') : null);

export function entryMarkdown(
  e: ExportEntry,
  path: string,
  media: ExportEntryMedia[],
  tagIds: string[],
  projectIds: string[],
  collections: string[],
  ix: Index
): string {
  const parts = [
    frontmatter([
      ['id', e.id],
      ['type', e.type],
      ['title', e.title],
      ['occurred', e.occurredAt],
      ['created', e.createdAt],
      ['updated', e.updatedAt],
      ['status', e.status],
      ['visibility', e.visibility],
      ['place', placeLine(e.poiId ? ix.place.get(e.poiId) : undefined)],
      ['tags', tagIds.map((id) => ix.tagName.get(id)).filter(Boolean)],
      ['projects', projectIds.map((id) => ix.projectTitle.get(id)).filter(Boolean)],
      ['collections', collections]
    ])
  ];
  if (e.title) parts.push(`# ${e.title}`);
  if (e.body) parts.push(e.body);
  for (const m of media) parts.push(image(path, m.photoId, ix.photoFile.get(m.photoId), m.caption));
  return `${parts.join('\n\n')}\n`;
}

export function projectMarkdown(p: ExportProject, path: string, milestones: ExportMilestone[], entries: ExportEntry[], ix: Index): string {
  const parts = [
    frontmatter([
      ['id', p.id],
      ['type', p.type],
      ['status', p.status],
      ['visibility', p.visibility],
      ['start', p.startDate],
      ['end', p.endDate],
      ['created', p.createdAt],
      ['updated', p.updatedAt]
    ]),
    `# ${p.title}`,
    `${projectTypeLabel(p.type)} · ${PROJECT_STATUS_LABELS[p.status] ?? p.status} · ${p.startDate}${p.endDate ? ` – ${p.endDate}` : ' 起'}`
  ];
  if (p.description) parts.push(p.description);
  if (milestones.length) {
    parts.push('## 里程碑');
    for (const m of milestones) parts.push(`### ${m.date} ${m.title}${m.body ? `\n\n${m.body}` : ''}`);
  }
  if (entries.length) {
    parts.push('## 记录');
    parts.push(
      entries
        .map((e) => {
          const file = ix.entryFile.get(e.id);
          const label = escapeText(ix.entryLabel.get(e.id) ?? e.id);
          return `- ${e.occurredAt.slice(0, 10)} ${file ? `[${label}](${dest(relative(path, file))})` : label}`;
        })
        .join('\n')
    );
  }
  return `${parts.join('\n\n')}\n`;
}

export function collectionMarkdown(t: ExportTheme, path: string, items: ExportThemeItem[], ix: Index): string {
  const parts = [
    frontmatter([
      ['id', t.id],
      ['kind', t.kind],
      ['visibility', t.visibility],
      ['start', t.startDate],
      ['end', t.endDate],
      ['created', t.createdAt],
      ['updated', t.updatedAt],
      ['published', t.publishedAt]
    ]),
    `# ${t.title}`
  ];
  if (t.subtitle) parts.push(t.subtitle);
  if (t.intro) parts.push(t.intro);
  for (const it of items) {
    if (it.kind === 'day' && it.day) parts.push(`## ${it.day}${it.text ? ` ${firstLine(it.text)}` : ''}`);
    else if (it.kind === 'text' && it.text) parts.push(it.text);
    else if (it.kind === 'photo' && it.photoId) parts.push(image(path, it.photoId, ix.photoFile.get(it.photoId), it.text));
    else if (it.kind === 'entry' && it.entryId) {
      const file = ix.entryFile.get(it.entryId);
      const label = escapeText(ix.entryLabel.get(it.entryId) ?? it.entryId);
      parts.push(`${file ? `[→ ${label}](${dest(relative(path, file))})` : `→ ${label}`}${it.text ? `\n\n${it.text}` : ''}`);
    }
  }
  return `${parts.join('\n\n')}\n`;
}

// ---- the whole ------------------------------------------------------------------------------------------------------

const groupBy = <T>(rows: T[], key: (r: T) => string): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
};

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;
const byOccurred = (a: ExportEntry, b: ExportEntry) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id);

/** A photo's file as it ended up: the original, its large size instead (the original was missing), or none. */
export interface PhotoFile {
  path: string;
  /** the large size stood in for a missing original */
  large?: boolean;
}

/** The files a photo list will get, before any is downloaded: the original's path for each. */
export function plannedMedia(photos: ExportPhoto[]): Map<string, string> {
  return new Map(photos.map((p) => [p.id, mediaPath(p, p.fileKey)]));
}

/**
 * Every text file of the export: README.md, living.json and the Markdown, given where each photo's file went
 * (`files`; a photo missing from it is not in the export). `site` and `now` are for the README and the JSON;
 * `originals`: the photos were asked for.
 */
export function textFiles(
  data: ExportData,
  files: Map<string, PhotoFile>,
  site: Pick<SiteInfo, 'name' | 'url'>,
  now: Date,
  originals = true
): TextFile[] {
  const paths = new PathSet();
  const entries = [...data.entries].sort(byOccurred);
  const ix: Index = {
    photoFile: new Map([...files].map(([id, f]) => [id, f.path])),
    entryFile: new Map(),
    tagName: new Map(data.tags.map((t) => [t.id, t.name])),
    place: new Map(data.places.map((p) => [p.id, p])),
    projectTitle: new Map(data.projects.map((p) => [p.id, p.title])),
    entryLabel: new Map(entries.map((e) => [e.id, entryLabel(e.title, e.body, 40) || entryTypeLabel(e.type)]))
  };
  for (const e of entries) {
    const day = e.occurredAt.slice(0, 10);
    const label = safeName(ix.entryLabel.get(e.id) ?? '') || safeName(entryTypeLabel(e.type));
    ix.entryFile.set(e.id, paths.take(`entries/${day.slice(0, 4)}`, `${day} ${label}`, '.md'));
  }

  const media = groupBy(data.entryMedia, (m) => m.entryId);
  const tagsOf = groupBy(data.entryTags, (t) => t.entryId);
  const projectsOf = groupBy(data.entryProjects, (p) => p.entryId);
  const entriesOf = groupBy(data.entryProjects, (p) => p.projectId);
  const milestones = groupBy(data.milestones, (m) => m.projectId);
  const items = groupBy(data.themeItems, (i) => i.themeId);
  const photoTags = groupBy(data.photoTags, (t) => t.photoId);
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const collectionsOf = new Map<string, string[]>();
  for (const t of data.themes) {
    for (const it of items.get(t.id) ?? []) {
      if (it.kind !== 'entry' || !it.entryId) continue;
      const list = collectionsOf.get(it.entryId) ?? [];
      if (!list.includes(t.title)) list.push(t.title);
      collectionsOf.set(it.entryId, list);
    }
  }

  const out: TextFile[] = [];
  const entryRecords = entries.map((e) => {
    const path = ix.entryFile.get(e.id) as string;
    const m = (media.get(e.id) ?? []).sort(byPosition);
    const tagIds = (tagsOf.get(e.id) ?? []).map((t) => t.tagId);
    const projectIds = (projectsOf.get(e.id) ?? []).map((p) => p.projectId);
    out.push({
      path,
      text: entryMarkdown(e, path, m, tagIds, projectIds, collectionsOf.get(e.id) ?? [], ix),
      mtime: localDate(e.occurredAt) ?? now
    });
    return { ...e, media: m.map(({ photoId, caption }) => ({ photoId, caption })), tagIds, projectIds, file: path };
  });

  const projectRecords = [...data.projects]
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
    .map((p) => {
      const path = paths.take('projects', safeName(p.title) || p.id, '.md');
      const ms = (milestones.get(p.id) ?? []).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      const its = (entriesOf.get(p.id) ?? [])
        .map((ep) => entryById.get(ep.entryId))
        .filter((e): e is ExportEntry => !!e)
        .sort(byOccurred);
      out.push({ path, text: projectMarkdown(p, path, ms, its, ix), mtime: localDate(p.updatedAt) ?? now });
      return { ...p, milestones: ms.map(({ projectId: _p, ...m }) => m), file: path };
    });

  const collectionRecords = [...data.themes]
    .sort((a, b) => (a.startDate ?? a.createdAt).localeCompare(b.startDate ?? b.createdAt) || a.id.localeCompare(b.id))
    .map((t) => {
      const path = paths.take('collections', safeName(t.title) || t.id, '.md');
      const its = (items.get(t.id) ?? []).sort(byPosition);
      out.push({ path, text: collectionMarkdown(t, path, its, ix), mtime: localDate(t.updatedAt) ?? now });
      return { ...t, items: its.map(({ themeId: _t, ...it }) => it), file: path };
    });

  const photoRecords = data.photos.map((p) => {
    const f = files.get(p.id);
    return {
      ...p,
      tags: (photoTags.get(p.id) ?? []).map((t) => ({ id: t.tagId, source: t.source })),
      file: f?.path ?? null,
      ...(f?.large ? { fileIsLarge: true } : {})
    };
  });

  const readme: TextFile = { path: 'README.md', text: readmeText(data, files, site, now, originals), mtime: now };
  const fileList = [readme.path, ...out.map((f) => f.path), ...[...files.values()].map((f) => f.path)].sort();
  const json = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: now.toISOString(),
    site: { name: site.name, url: site.url },
    profile: data.summary.profile,
    photos: photoRecords,
    entries: entryRecords,
    projects: projectRecords,
    collections: collectionRecords,
    tags: data.tags,
    places: data.places,
    privacyZones: data.privacyZones,
    shareLinks: data.shareLinks,
    /** every file of this export but living.json itself, so that the next export to a folder can tidy up */
    files: fileList
  };
  return [readme, ...out, { path: 'living.json', text: `${JSON.stringify(json, null, 2)}\n`, mtime: now }];
}

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** The README's line on the photos' files: what came with this export and what did not. */
function mediaLine(photos: number, files: Map<string, PhotoFile>, originals: boolean): string | null {
  if (!photos) return null;
  const large = [...files.values()].filter((f) => f.large).length;
  const without = photos - files.size;
  const where = '按拍摄的年份分文件夹，文件名是拍摄日期和照片的编号';
  if (originals) {
    return [
      `- \`media/\`：${files.size} 张照片，上传时的原文件，${where}。`,
      large ? `其中 ${large} 张缺少原文件，是 2560 像素的大图。` : '',
      without ? `另有 ${without} 张找不到文件，只有信息在 living.json 里。` : ''
    ].join('');
  }
  if (!files.size) return `- 这次导出没有下载照片：${photos} 张照片只有信息在 living.json 里，Markdown 里写着照片的编号。`;
  return [
    `- \`media/\`：${files.size} 张照片的原文件，是之前导出到这个文件夹时下载的，${where}。`,
    without ? `这次没有下载照片，其余 ${without} 张只有信息在 living.json 里，Markdown 里写着照片的编号。` : ''
  ].join('');
}

function readmeText(
  data: ExportData,
  files: Map<string, PhotoFile>,
  site: Pick<SiteInfo, 'name' | 'url'>,
  now: Date,
  originals: boolean
): string {
  const profile = data.summary.profile;
  const drafts = data.entries.filter((e) => e.status !== 'published').length;
  const lines = [
    `- \`entries/\`：${data.entries.length} 条记录${drafts ? `（含 ${drafts} 条草稿和已归档的）` : ''}，每条一个 Markdown 文件，按发生的年份分文件夹。开头的 frontmatter 是类型、时间、状态（${Object.values(ENTRY_STATUS_LABELS).join('、')}）、公开范围、地点、标签和项目。`,
    `- \`projects/\`：${data.projects.length} 个项目，每个一个文件：说明、里程碑和其中的记录。`,
    `- \`collections/\`：${data.themes.length} 个合集，每个一个文件，按原来的顺序排着文字、照片和记录。`,
    mediaLine(data.photos.length, files, originals),
    '- `living.json`：全部信息，包括照片的拍摄参数、位置、地点、标签和公开范围。字段说明：https://github.com/ticoAg/Living/blob/main/docs/api/export.md'
  ].filter((l): l is string => !!l);
  return `# ${site.name} 导出

@${profile.handle}（${profile.displayName}）的档案，导出于 ${stamp(now)}，来自 ${site.url}。

${lines.join('\n')}

Markdown 里的图片和链接都是相对路径：用 Obsidian、Typora 等编辑器打开这个文件夹，就能看到照片。

导出分成几个 zip 时，把它们解压到同一个位置，合起来就是这个文件夹；living.json 和 Markdown 在最后一个里。
`;
}
