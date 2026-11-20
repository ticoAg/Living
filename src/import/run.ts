// Runs an import (docs/product/features/import.md). First the plan: living.json read, and the Worker asked which of
// its photos, attachments, entries, projects and collections are here already. Then the rest goes up a batch at a
// time, in the order things point to each other: tags, places and privacy zones; the photos, each read from the
// export, resized as an upload is (studio/process.ts) and uploaded with what living.json says of it; the attachments'
// files, in parts as an attachment goes up; projects, entries, collections.
// Each step takes this site's ids from the steps before it. Stopping half-way loses nothing: a second import skips
// what the first one brought. The contract: /docs/api/import.md

import { IMPORT_LIMITS } from '../../shared/limits';
import type {
  ImportAttachmentResponse,
  ImportIdsResponse,
  ImportResolveResponse,
  ImportRowsResponse,
  ImportTarget,
  ImportZonesResponse,
  PhotoDetail
} from '../../shared/types';
import { sendParts, sendPoster, type PutBytes } from '../attachments/upload';
import { api, ApiError } from '../lib/api';
import type { Processed } from '../studio/process';
import type { PublishResult } from '../studio/publish';
import {
  attachmentBody,
  batches,
  byCreated,
  collectionRow,
  emptyMaps,
  entryRow,
  photoMeta,
  projectRow,
  readArchive,
  relinker,
  zoneRow,
  type Archive,
  type ArchiveAttachment,
  type ArchivePhoto,
  type IdMaps
} from './archive';
import type { ImportSource } from './source';

export interface ImportPlan {
  archive: Archive;
  /** photos here already: id in the export → id here */
  photosHere: Map<string, string>;
  entries: Map<string, ImportTarget>;
  projects: Map<string, ImportTarget>;
  collections: Map<string, ImportTarget>;
  /** photos to bring: not known to be here, their file among the files picked; uploaded first, first */
  upload: ArchivePhoto[];
  /** bytes of their files */
  bytes: number;
  /** photos the export has no file for (it was made without them, or the file was gone) */
  noFile: number;
  /** photos whose file the export has, but not among the files picked (a ZIP part left out) */
  notPicked: number;
  /** attachments here already, of entries still to bring: id in the export → id here */
  attachmentsHere: Map<string, string>;
  /** attachments of entries still to bring, their file among the files picked */
  attachments: ArchiveAttachment[];
  /** bytes of their files */
  attachmentBytes: number;
  /** attachments without a file in the export, or with one not picked */
  attachmentsNoFile: number;
  attachmentsNotPicked: number;
}

export type ImportPhase = 'tags' | 'places' | 'zones' | 'photos' | 'attachments' | 'projects' | 'entries' | 'collections';
export const PHASES: readonly ImportPhase[] = ['tags', 'places', 'zones', 'photos', 'attachments', 'projects', 'entries', 'collections'];

export interface ImportProgress {
  phase: ImportPhase;
  /** photos done (uploaded, found here, or failed), of those to bring */
  photos: number;
  totalPhotos: number;
  /** attachments done, the same way */
  attachments: number;
  totalAttachments: number;
  /** bytes of the photos' and attachments' files sent, of all */
  bytes: number;
  totalBytes: number;
}

export interface Failure {
  kind: 'photo' | 'attachment' | 'entry' | 'project' | 'collection';
  /** the photo's or attachment's file name, or the row's title */
  label: string;
  message: string;
}

export interface ImportOutcome {
  created: {
    photos: number;
    attachments: number;
    entries: number;
    projects: number;
    collections: number;
    tags: number;
    places: number;
    zones: number;
  };
  /** here already, left as they are */
  existing: { photos: number; attachments: number; entries: number; projects: number; collections: number; zones: number };
  failed: Failure[];
  noFile: number;
  notPicked: number;
  attachmentsNoFile: number;
  attachmentsNotPicked: number;
  /** privacy zones over the 50 an account may have */
  zonesFull: number;
  /** share links of the export: never brought, an export has no addresses */
  shareLinks: number;
}

/** An import that stopped before the end: why, and what it had brought by then. */
export class ImportStopped extends Error {
  constructor(
    message: string,
    readonly outcome: ImportOutcome
  ) {
    super(message);
  }
}

export interface ImportOptions {
  plan: ImportPlan;
  source: ImportSource;
  /** everything brought is to be private, whatever the export says */
  privateAll: boolean;
  /** this site's origin: links to the exporting site's items come here */
  origin: string;
  signal: AbortSignal;
  onProgress?: (p: ImportProgress) => void;
  /** reads and resizes a photo's file (studio/process.ts); tests pass their own */
  resize: (file: File) => Promise<Pick<Processed, 'width' | 'height' | 'variants' | 'thumbhash' | 'palette' | 'sha256'>>;
  /** uploads it (studio/publish.ts) */
  send: (form: FormData, onProgress: (fraction: number) => void, signal: AbortSignal) => Promise<PublishResult>;
  /** photos in flight at once */
  parallel?: number;
  /** sends an attachment's part (attachments/upload.ts); tests pass their own */
  putPart?: PutBytes;
  /** waits before a retry; tests pass one that does not */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Waits before the retries of a request that failed on the way (network, 5xx other than the database's limit, 429). */
export const RETRY_WAIT = [1000, 4000, 15000];

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true }
    );
  });

const QUOTA = 'quota_exceeded';
const AGAIN = '再导入一次，已经导入的会跳过。';
const transientStatus = (s: number) => s === 0 || s === 408 || s === 429 || s >= 500;
const transient = (e: unknown) => e instanceof TypeError || (e instanceof ApiError && transientStatus(e.status) && e.code !== QUOTA);

/** Why a request means the import cannot go on, or null when it can be retried or the row failed alone. */
function fatal(status: number, code: string, message: string): string | null {
  if (status === 401) return `登录已经失效。重新登录后${AGAIN}`;
  if (code === QUOTA) return `${message}。到时候${AGAIN}`;
  return null;
}

async function retrying<T>(fn: () => Promise<T>, signal: AbortSignal, sleep: ImportOptions['sleep'] = wait): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (signal.aborted || !transient(e) || attempt >= RETRY_WAIT.length) throw e;
    }
    await sleep(RETRY_WAIT[attempt], signal);
  }
}

const post = <T>(path: string, json: unknown, signal: AbortSignal) => api<T>(path, { method: 'POST', json, signal });

/** Reads living.json from what was picked, and asks the Worker what of it is here already. */
export async function planImport(source: ImportSource, signal: AbortSignal, sleep: ImportOptions['sleep'] = wait): Promise<ImportPlan> {
  const json = source.files.get('living.json');
  if (!json) throw new Error('没有找到 living.json');
  const archive = readArchive(await (await json.read()).text());

  // photos by the hash the export recorded for their original; a large size standing in for one has another
  const byHash = new Map<string, string>();
  for (const p of archive.photos) if (p.sha256 && !p.large) byHash.set(p.sha256, p.id);
  const hashes = [...byHash.keys()];
  const entryIds = archive.entries.map((e) => e.id);
  const attachmentIds = archive.entries.flatMap((e) => e.attachments.map((a) => a.id));
  const projectIds = archive.projects.map((p) => p.id);
  const collectionIds = archive.collections.map((c) => c.id);
  const photosHere = new Map<string, string>();
  const entries = new Map<string, ImportTarget>();
  const projects = new Map<string, ImportTarget>();
  const collections = new Map<string, ImportTarget>();
  const attachmentTargets = new Map<string, ImportTarget>();
  const n = IMPORT_LIMITS.resolve;
  const longest = Math.max(hashes.length, entryIds.length, attachmentIds.length, projectIds.length, collectionIds.length);
  const rounds = Math.ceil(longest / n);
  for (let i = 0; i < rounds; i++) {
    const slice = (list: string[]) => list.slice(i * n, (i + 1) * n);
    const got = await retrying(
      () =>
        post<ImportResolveResponse>(
          '/api/import/resolve',
          {
            photos: slice(hashes),
            entries: slice(entryIds),
            attachments: slice(attachmentIds),
            projects: slice(projectIds),
            collections: slice(collectionIds)
          },
          signal
        ),
      signal,
      sleep
    );
    for (const [sha, id] of Object.entries(got.photos)) photosHere.set(byHash.get(sha) as string, id);
    for (const [k, v] of Object.entries(got.entries)) entries.set(k, v);
    for (const [k, v] of Object.entries(got.attachments ?? {})) attachmentTargets.set(k, v);
    for (const [k, v] of Object.entries(got.projects)) projects.set(k, v);
    for (const [k, v] of Object.entries(got.collections)) collections.set(k, v);
  }

  let noFile = 0;
  let notPicked = 0;
  const upload: ArchivePhoto[] = [];
  for (const p of archive.photos) {
    if (photosHere.has(p.id)) continue;
    if (!p.file) noFile++;
    else if (!source.files.has(p.file)) notPicked++;
    else upload.push(p);
  }
  // in the order they were uploaded there, so that photos without a time taken keep their order in the gallery
  upload.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt) || a.id.localeCompare(b.id));

  // the attachments of entries to bring: an entry here already stays as it is, with what it holds
  const attachmentsHere = new Map<string, string>();
  const attachments: ArchiveAttachment[] = [];
  let attachmentsNoFile = 0;
  let attachmentsNotPicked = 0;
  for (const e of archive.entries) {
    if (entries.get(e.id)?.exists) continue;
    for (const a of e.attachments) {
      const t = attachmentTargets.get(a.id);
      if (t?.exists) attachmentsHere.set(a.id, t.id);
      else if (!a.file) attachmentsNoFile++;
      else if (!source.files.has(a.file)) attachmentsNotPicked++;
      else attachments.push(a);
    }
  }
  return {
    archive,
    photosHere,
    entries,
    projects,
    collections,
    upload,
    bytes: upload.reduce((s, p) => s + (source.files.get(p.file as string)?.size ?? 0), 0),
    noFile,
    notPicked,
    attachmentsHere,
    attachments,
    attachmentBytes: attachments.reduce((s, a) => s + (source.files.get(a.file as string)?.size ?? 0), 0),
    attachmentsNoFile,
    attachmentsNotPicked
  };
}

const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp'
};
/** The type a file goes up as, from its name: a file read out of a ZIP has none of its own. */
export const typeOf = (name: string): string => TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
/** A video's frame, by the name the export gave it. */
const posterType = (path: string) => (path.toLowerCase().endsWith('.jpg') ? 'image/jpeg' : 'image/webp');

const titleOf = (row: Record<string, unknown>, fallback: string) =>
  typeof row.title === 'string' && row.title.trim() ? row.title.trim() : fallback;

export async function runImport(o: ImportOptions): Promise<ImportOutcome> {
  const { plan, source, signal, privateAll } = o;
  const sleep = o.sleep ?? wait;
  const archive = plan.archive;
  const outcome: ImportOutcome = {
    created: { photos: 0, attachments: 0, entries: 0, projects: 0, collections: 0, tags: 0, places: 0, zones: 0 },
    existing: { photos: plan.photosHere.size, attachments: plan.attachmentsHere.size, entries: 0, projects: 0, collections: 0, zones: 0 },
    failed: [],
    noFile: plan.noFile,
    notPicked: plan.notPicked,
    attachmentsNoFile: plan.attachmentsNoFile,
    attachmentsNotPicked: plan.attachmentsNotPicked,
    zonesFull: 0,
    shareLinks: archive.shareLinks
  };
  const progress: ImportProgress = {
    phase: 'tags',
    photos: 0,
    totalPhotos: plan.upload.length,
    attachments: 0,
    totalAttachments: plan.attachments.length,
    bytes: 0,
    totalBytes: plan.bytes + plan.attachmentBytes
  };
  const report = () => o.onProgress?.({ ...progress });
  const stop = (message: string) => new ImportStopped(message, outcome);

  /** A batch request: retried on the way, and the end of the import when it cannot go on. */
  async function send<T>(path: string, json: unknown): Promise<T> {
    try {
      return await retrying(() => post<T>(path, json, signal), signal, sleep);
    } catch (e) {
      if (signal.aborted) throw stop('已取消');
      if (e instanceof ApiError) throw stop(fatal(e.status, e.code, e.message) ?? `${e.message}。${AGAIN}`);
      throw stop(`网络中断了。${AGAIN}`);
    }
  }

  const maps: IdMaps = emptyMaps();
  for (const [k, v] of plan.photosHere) maps.photos.set(k, v);
  for (const [k, v] of plan.attachmentsHere) maps.attachments.set(k, v);
  for (const [k, t] of plan.entries) maps.entries.set(k, t.id);
  for (const [k, t] of plan.projects) maps.projects.set(k, t.id);
  for (const [k, t] of plan.collections) maps.collections.set(k, t.id);
  const relink = relinker(maps, archive.site?.url ?? null, o.origin);

  try {
    // ---- tags: parents before children, so that one in a later batch finds its parent's id here
    report();
    const tags = [...archive.tags];
    const depth = new Map<string, number>();
    const byId = new Map(tags.map((t) => [t.id as string, t]));
    const depthOf = (t: Record<string, unknown>, seen = new Set<string>()): number => {
      const id = t.id as string;
      if (depth.has(id)) return depth.get(id) as number;
      const parent = typeof t.parentId === 'string' ? byId.get(t.parentId) : undefined;
      const d = parent && !seen.has(id) ? depthOf(parent, seen.add(id)) + 1 : 0;
      depth.set(id, d);
      return d;
    };
    tags.sort((a, b) => depthOf(a) - depthOf(b));
    for (const batch of batches(tags, IMPORT_LIMITS.tags)) {
      const rows = batch.map((t) =>
        typeof t.parentId === 'string' && maps.tags.has(t.parentId) ? { ...t, parentId: maps.tags.get(t.parentId) } : t
      );
      const got = await send<ImportIdsResponse>('/api/import/tags', { tags: rows });
      for (const [k, v] of Object.entries(got.ids)) maps.tags.set(k, v);
      outcome.created.tags += got.created;
    }

    progress.phase = 'places';
    report();
    for (const batch of batches(archive.places, IMPORT_LIMITS.places)) {
      const got = await send<ImportIdsResponse>('/api/import/places', { places: batch });
      for (const [k, v] of Object.entries(got.ids)) maps.places.set(k, v);
      outcome.created.places += got.created;
    }

    progress.phase = 'zones';
    report();
    for (const batch of batches(archive.zones.map(zoneRow), IMPORT_LIMITS.zones)) {
      const got = await send<ImportZonesResponse>('/api/import/zones', { zones: batch });
      outcome.created.zones += got.created;
      outcome.existing.zones += got.existing;
      outcome.zonesFull += got.full;
    }

    // ---- photos: a few at a time, each read, resized and uploaded
    progress.phase = 'photos';
    report();
    const inFlight = new Map<string, number>();
    let doneBytes = 0;
    const sent = () => {
      progress.bytes = doneBytes + [...inFlight.values()].reduce((a, b) => a + b, 0);
      report();
    };
    let next = 0;
    let fatalStop: ImportStopped | null = null;
    const one = async (p: ArchivePhoto): Promise<void> => {
      const path = p.file as string;
      const name = path.split('/').pop() as string;
      const entry = source.files.get(path);
      const size = entry?.size ?? 0;
      const failed = (message: string) => outcome.failed.push({ kind: 'photo', label: name, message });
      try {
        let file: File;
        try {
          const blob = await (entry as NonNullable<typeof entry>).read();
          file = new File([blob], name, { type: typeOf(name) || blob.type });
        } catch {
          failed('读不出这张照片的文件');
          return;
        }
        let resized: Awaited<ReturnType<ImportOptions['resize']>>;
        try {
          resized = await o.resize(file);
        } catch (e) {
          failed(e instanceof Error ? e.message : '这张照片处理不了');
          return;
        }
        if (signal.aborted) return;
        const form = new FormData();
        form.append('meta', JSON.stringify(photoMeta(p, resized, maps, relink, privateAll)));
        form.append('original', file, name);
        for (const k of ['s', 'm', 'l'] as const) form.append(k, resized.variants[k].blob, `${k}.${resized.variants[k].ext}`);
        for (let attempt = 0; ; attempt++) {
          const res = await o.send(form, (f) => (inFlight.set(p.id, f * size), sent()), signal);
          if (res.ok) {
            maps.photos.set(p.id, (res.photo as PhotoDetail).id);
            outcome.created.photos++;
            return;
          }
          if (res.code === 'duplicate' && res.photoId) {
            maps.photos.set(p.id, res.photoId);
            outcome.existing.photos++;
            return;
          }
          if (signal.aborted || res.code === 'abort') return;
          const why = fatal(res.status, res.code, res.message);
          if (why) {
            fatalStop ??= stop(why);
            return;
          }
          if (transientStatus(res.status) && attempt < RETRY_WAIT.length) {
            await sleep(RETRY_WAIT[attempt], signal).catch(() => {});
            if (signal.aborted) return;
            continue;
          }
          failed(res.message);
          return;
        }
      } finally {
        inFlight.delete(p.id);
        doneBytes += size;
        progress.photos++;
        sent();
      }
    };
    const worker = async () => {
      while (next < plan.upload.length && !signal.aborted && !fatalStop) await one(plan.upload[next++]);
    };
    await Promise.all(Array.from({ length: Math.max(1, o.parallel ?? 2) }, worker));
    if (signal.aborted) throw stop('已取消');
    if (fatalStop) throw fatalStop;

    // ---- attachments: one after another, each file in parts, a video's frame after it
    progress.phase = 'attachments';
    report();
    for (const a of plan.attachments) {
      const path = a.file as string;
      const name = typeof a.row.name === 'string' ? a.row.name : (path.split('/').pop() as string);
      const entry = source.files.get(path);
      const size = entry?.size ?? 0;
      try {
        let file: Blob;
        try {
          file = await (entry as NonNullable<typeof entry>).read();
        } catch {
          outcome.failed.push({ kind: 'attachment', label: name, message: '读不出这个附件的文件' });
          continue;
        }
        let begun: ImportAttachmentResponse;
        try {
          begun = await retrying(
            () => post<ImportAttachmentResponse>('/api/import/attachments', attachmentBody(a, file.size), signal),
            signal,
            sleep
          );
        } catch (e) {
          if (signal.aborted) throw stop('已取消');
          if (e instanceof ApiError) {
            const why = fatal(e.status, e.code, e.message);
            if (why) throw stop(why);
            outcome.failed.push({ kind: 'attachment', label: name, message: e.message });
            continue;
          }
          throw stop(`网络中断了。${AGAIN}`);
        }
        if (begun.here) {
          maps.attachments.set(a.id, begun.attachment.id);
          outcome.existing.attachments++;
          continue;
        }
        try {
          const up = await sendParts({ upload: begun, done: [] }, file, {
            signal,
            put: o.putPart,
            sleep: (ms) => sleep(ms, signal),
            onProgress: (sent) => {
              progress.bytes = doneBytes + sent;
              report();
            }
          });
          maps.attachments.set(a.id, up.id);
          outcome.created.attachments++;
        } catch (e) {
          if (signal.aborted) throw stop('已取消');
          if (e instanceof ApiError) {
            const why = fatal(e.status, e.code, e.message);
            if (why) throw stop(why);
            outcome.failed.push({ kind: 'attachment', label: name, message: e.message });
            continue;
          }
          throw stop(`网络中断了。${AGAIN}`);
        }
        const poster = a.posterFile ? source.files.get(a.posterFile) : undefined;
        if (poster) {
          const frame = await poster.read().catch(() => null);
          if (frame)
            await sendPoster(maps.attachments.get(a.id) as string, new Blob([frame], { type: posterType(a.posterFile as string) }), signal);
        }
      } finally {
        doneBytes += size;
        progress.bytes = doneBytes;
        progress.attachments++;
        report();
      }
    }

    // ---- the rows, now that what they point to has its id here
    const rowsOf = async (
      phase: ImportPhase,
      path: string,
      key: string,
      rows: { id: string; label: string; body: unknown }[],
      max: number,
      map: Map<string, string>,
      kind: Failure['kind'],
      count: 'entries' | 'projects' | 'collections'
    ) => {
      progress.phase = phase;
      report();
      const label = new Map(rows.map((r) => [r.id, r.label]));
      for (const batch of batches(rows, max)) {
        const got = await send<ImportRowsResponse>(path, { [key]: batch.map((r) => r.body) });
        for (const [k, v] of Object.entries(got.ids)) map.set(k, v);
        outcome.created[count] += got.created;
        outcome.existing[count] += got.existing;
        for (const f of got.failed) outcome.failed.push({ kind, label: label.get(f.id) ?? f.id, message: f.message });
      }
    };

    await rowsOf(
      'projects',
      '/api/import/projects',
      'projects',
      [...archive.projects]
        .sort(byCreated)
        .map((p) => ({ id: p.id, label: titleOf(p.row, p.id), body: projectRow(p, relink, privateAll) })),
      IMPORT_LIMITS.projects,
      maps.projects,
      'project',
      'projects'
    );
    await rowsOf(
      'entries',
      '/api/import/entries',
      'entries',
      [...archive.entries].sort(byCreated).map((e) => ({
        id: e.id,
        label: titleOf(e.row, typeof e.row.occurredAt === 'string' ? e.row.occurredAt.slice(0, 10) : e.id),
        body: entryRow(e, maps, relink, privateAll)
      })),
      IMPORT_LIMITS.entries,
      maps.entries,
      'entry',
      'entries'
    );
    await rowsOf(
      'collections',
      '/api/import/collections',
      'collections',
      [...archive.collections]
        .sort(byCreated)
        .map((c) => ({ id: c.id, label: titleOf(c.row, c.id), body: collectionRow(c, maps, relink, privateAll) })),
      IMPORT_LIMITS.collections,
      maps.collections,
      'collection',
      'collections'
    );
  } catch (e) {
    if (e instanceof ImportStopped) throw e;
    if (signal.aborted) throw stop('已取消');
    throw e;
  }
  return outcome;
}
