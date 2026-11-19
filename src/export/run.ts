// Runs an export: reads the archive part by part from /api/export, downloads the photos' and attachments' files, and
// writes it all to a sink (ZIP parts, or a folder that a later export updates). The browser does the work, so that the Worker never
// holds an archive in memory. Docs: /docs/product/features/export.md

import {
  EXPORT_PARTS,
  type ExportAttachment,
  type ExportPage,
  type ExportPart,
  type ExportPhoto,
  type ExportSummary,
  type SessionUser,
  type SiteInfo
} from '../../shared/types';
import { api, ApiError, mediaUrl, reportUnauthenticated } from '../lib/api';
import {
  attachmentDay,
  attachmentPath,
  localDate,
  mediaPath,
  posterPath,
  textFiles,
  type AttachmentFile,
  type ExportData,
  type PhotoFile
} from './archive';
import type { ExportSink } from './sinks';

export type ExportPhase = 'reading' | 'media' | 'attachments' | 'writing' | 'tidying';

export interface ExportProgress {
  phase: ExportPhase;
  /** rows read, of the count the summary gave */
  rows: number;
  totalRows: number;
  /** photos done: written, kept from an earlier export, or without a file */
  photos: number;
  totalPhotos: number;
  /** attachments done, the same way */
  attachments: number;
  totalAttachments: number;
  /** bytes of the photos' originals and the attachments' files done, of all of them */
  bytes: number;
  totalBytes: number;
}

export interface ExportOutcome {
  photos: number;
  /** photos whose file is in the export */
  files: number;
  /** of them, kept from an earlier export to the folder instead of downloaded again */
  kept: number;
  /** photos whose original was missing: the large size stands in */
  large: string[];
  /** photos with no file at all */
  missing: string[];
  /** files of an earlier export to the folder that this one no longer has */
  removed: number;
  attachments: number;
  /** attachments whose file is in the export */
  attachmentFiles: number;
  /** of them, kept from an earlier export to the folder */
  attachmentsKept: number;
  /** attachments with no file */
  attachmentsMissing: string[];
  /** bytes downloaded */
  downloaded: number;
}

export interface ExportOptions {
  sink: ExportSink;
  /** download the photos' and attachments' files (a folder keeps those an earlier export left either way) */
  originals: boolean;
  site: Pick<SiteInfo, 'name' | 'url'>;
  signal: AbortSignal;
  onProgress?: (p: ExportProgress) => void;
  now?: () => Date;
  /** waits before a retry; tests pass one that does not */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** Photos downloaded at once: enough to keep the line busy, few enough to stay polite to the Worker. */
export const PARALLEL = 4;
/** Waits before the retries of a request that failed on the way (network, 5xx, 429). */
export const RETRY_WAIT = [1000, 4000, 15000];
/** A photo whose original is missing makes sure the session is still there, at most this often. */
const SESSION_CHECK_MS = 30_000;

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

/** A response other than 200 or 404 for a photo's or an attachment's file. */
class HttpStatus extends Error {
  constructor(
    readonly status: number,
    readonly what: '照片' | '附件'
  ) {
    super(`http ${status}`);
  }
}

const transient = (e: unknown) =>
  e instanceof TypeError ||
  ((e instanceof ApiError || e instanceof HttpStatus) && (e.status >= 500 || e.status === 429 || e.status === 408));

const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export async function runExport(o: ExportOptions): Promise<ExportOutcome> {
  const signal = o.signal;
  const sleep = o.sleep ?? wait;
  const now = (o.now ?? (() => new Date()))();

  async function retrying<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (signal.aborted || !transient(e) || attempt >= RETRY_WAIT.length) throw failure(e);
      }
      await sleep(RETRY_WAIT[attempt], signal);
    }
  }

  const summary = await retrying(() => api<ExportSummary>('/api/export', { signal }));
  const owner = summary.profile.id;
  const previous = await o.sink.previous();
  if (previous.ownerId && previous.ownerId !== owner) throw new Error('这个文件夹里是另一个账号的导出，换一个文件夹');

  const progress: ExportProgress = {
    phase: 'reading',
    rows: 0,
    totalRows: Object.values(summary.counts).reduce((a, b) => a + b, 0),
    photos: 0,
    totalPhotos: summary.counts.photos,
    attachments: 0,
    totalAttachments: summary.counts.attachments,
    bytes: 0,
    totalBytes: summary.originalBytes + summary.attachmentBytes
  };
  const report = () => o.onProgress?.({ ...progress });
  report();

  // ---- the rows ----
  async function readPart<T>(part: ExportPart): Promise<T[]> {
    const rows: T[] = [];
    let after: string | null = null;
    do {
      const path: string = `/api/export/${part}${after ? `?after=${encodeURIComponent(after)}` : ''}`;
      const page: ExportPage<T> = await retrying(() => api<ExportPage<T>>(path, { signal }));
      for (const r of page.rows) rows.push(r);
      progress.rows += page.rows.length;
      report();
      after = page.next;
    } while (after);
    return rows;
  }
  const read: Partial<Record<ExportPart, unknown[]>> = {};
  for (const part of EXPORT_PARTS) read[part] = await readPart(part);
  const data = { summary, ...read } as ExportData;

  // ---- the photos' files ----
  progress.phase = 'media';
  progress.totalPhotos = data.photos.length;
  report();
  const outcome: ExportOutcome = {
    photos: data.photos.length,
    files: 0,
    kept: 0,
    large: [],
    missing: [],
    attachments: data.attachments.length,
    attachmentFiles: 0,
    attachmentsKept: 0,
    attachmentsMissing: [],
    removed: 0,
    downloaded: 0
  };
  const files = new Map<string, PhotoFile>();

  /** A file the Worker serves: a Blob, or null when there is none (404). */
  async function getFile(url: string, what: HttpStatus['what'], stop: AbortSignal): Promise<Blob | null> {
    return retrying(async () => {
      const res = await fetch(url, { credentials: 'same-origin', signal: stop });
      if (res.status === 404) return null;
      if (!res.ok) throw new HttpStatus(res.status, what);
      return res.blob();
    });
  }
  const getMedia = (key: string, stop: AbortSignal) => getFile(mediaUrl(key), '照片', stop);

  // A signed-out browser is refused originals with 404 too: before taking one for missing, make sure it is not that.
  let checkedAt = -Infinity;
  let checking: Promise<void> | null = null;
  function stillSignedIn(force = false): Promise<void> {
    if (!force && Date.now() - checkedAt < SESSION_CHECK_MS) return Promise.resolve();
    // photos that miss their originals together wait for the one check
    return (checking ??= (async () => {
      try {
        const { user } = await retrying(() => api<{ user: SessionUser | null }>('/api/auth/me', { signal }));
        if (user?.id !== owner) {
          reportUnauthenticated('/api/export');
          throw new Error('登录已失效，重新登录后再导出');
        }
        checkedAt = Date.now();
      } finally {
        checking = null;
      }
    })());
  }

  type Got = { path: string; blob?: Blob; large?: boolean } | null;
  async function obtain(p: ExportPhoto, stop: AbortSignal): Promise<Got> {
    const path = mediaPath(p, p.fileKey);
    if (p.fileSize !== null && (await o.sink.existing(path)) === p.fileSize) return { path };
    if (!o.originals) return null;
    const blob = await getMedia(p.fileKey, stop);
    if (blob) return { path, blob };
    await stillSignedIn();
    const l = p.variants?.l?.key;
    const large = l ? await getMedia(l, stop) : null;
    return large && l ? { path: mediaPath(p, l), blob: large, large: true } : null;
  }

  // by where they go: the year, the day, the id
  const photos = [...data.photos].sort((a, b) => mediaPath(a, a.fileKey).localeCompare(mediaPath(b, b.fileKey)));
  const stop = new AbortController();
  const onAbort = () => stop.abort(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  // downloads run ahead of the writes, which keep the order; a settled result never rejects unseen
  const started: (Promise<{ got: Got } | { error: unknown }> | undefined)[] = [];
  const start = (i: number) =>
    (started[i] ??= obtain(photos[i], stop.signal).then(
      (got) => ({ got }),
      (error: unknown) => ({ error })
    ));
  try {
    for (let i = 0; i < photos.length; i++) {
      for (let k = i; k < Math.min(i + PARALLEL, photos.length); k++) void start(k);
      const settled = await start(i);
      started[i] = undefined;
      if ('error' in settled) throw settled.error;
      const p = photos[i];
      const got = settled.got;
      signal.throwIfAborted();
      if (!got) {
        if (o.originals) outcome.missing.push(p.id);
      } else if (!got.blob) {
        files.set(p.id, { path: got.path });
        outcome.kept++;
      } else {
        await o.sink.write(got.path, got.blob, localDate(p.takenAt) ?? localDate(p.uploadedAt) ?? now);
        files.set(p.id, got.large ? { path: got.path, large: true } : { path: got.path });
        outcome.downloaded += got.blob.size;
        if (got.large) outcome.large.push(p.id);
      }
      progress.photos++;
      progress.bytes += p.fileSize ?? 0;
      report();
    }
  } catch (e) {
    stop.abort();
    throw failure(e);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  // ---- the attachments' files, one after another: they can be large ----
  progress.phase = 'attachments';
  progress.totalAttachments = data.attachments.length;
  report();
  const attached = new Map<string, AttachmentFile>();
  const entryOf = new Map(data.entries.map((e) => [e.id, e]));
  const placed = data.attachments
    .map((a) => ({ a, day: attachmentDay(a, entryOf.get(a.entryId)) }))
    .sort((x, y) => attachmentPath(x.day, x.a).localeCompare(attachmentPath(y.day, y.a)));
  const fileUrl = (a: ExportAttachment) => `/media/a/${encodeURIComponent(a.id)}`;

  /** A video's frame: one an earlier export left, or downloaded; in either format the Worker may keep it in. */
  async function poster(a: ExportAttachment, day: string, mtime: Date): Promise<string | undefined> {
    if (!a.poster) return undefined;
    for (const ext of ['webp', 'jpg'] as const) {
      const path = posterPath(day, a.id, ext);
      if ((await o.sink.existing(path)) !== null) return path;
    }
    if (!o.originals) return undefined;
    const blob = await getFile(`${fileUrl(a)}/poster`, '附件', signal);
    if (!blob) return undefined;
    const path = posterPath(day, a.id, blob.type === 'image/jpeg' ? 'jpg' : 'webp');
    await o.sink.write(path, blob, mtime);
    outcome.downloaded += blob.size;
    return path;
  }

  try {
    for (const { a, day } of placed) {
      signal.throwIfAborted();
      const path = attachmentPath(day, a);
      const mtime = localDate(entryOf.get(a.entryId)?.occurredAt) ?? localDate(a.createdAt) ?? now;
      const got: AttachmentFile = {};
      if ((await o.sink.existing(path)) === a.size) {
        got.path = path;
        outcome.attachmentsKept++;
      } else if (o.originals) {
        const blob = await getFile(fileUrl(a), '附件', signal);
        if (blob) {
          await o.sink.write(path, blob, mtime);
          got.path = path;
          outcome.downloaded += blob.size;
        } else {
          await stillSignedIn();
          outcome.attachmentsMissing.push(a.id);
        }
      }
      if (got.path) got.poster = await poster(a, day, mtime);
      attached.set(a.id, got);
      progress.attachments++;
      progress.bytes += a.size;
      report();
    }
  } catch (e) {
    throw failure(e);
  }
  // the files given up were not lost to a session that ended on the way
  if (outcome.large.length || outcome.missing.length || outcome.attachmentsMissing.length) await stillSignedIn(true);
  outcome.files = files.size;
  outcome.attachmentFiles = [...attached.values()].filter((f) => f.path).length;

  // ---- the text, then the tidying, then living.json, which lists what this export holds ----
  progress.phase = 'writing';
  report();
  const all = textFiles(data, files, o.site, now, o.originals, attached);
  const texts = all.filter((f) => f.path !== 'living.json');
  const json = all.find((f) => f.path === 'living.json') as (typeof all)[number];
  for (const f of texts) {
    signal.throwIfAborted();
    await o.sink.write(f.path, new Blob([f.text], { type: 'text/markdown;charset=utf-8' }), f.mtime);
  }
  if (previous.files.length) {
    progress.phase = 'tidying';
    report();
    // file systems may ignore case: a path that differs only in case is the same file
    const current = new Set(
      [
        ...texts.map((f) => f.path),
        ...[...files.values()].map((f) => f.path),
        ...[...attached.values()].flatMap((f) => [f.path, f.poster]).filter((p): p is string => !!p)
      ].map((p) => p.toLowerCase())
    );
    for (const path of previous.files) {
      if (current.has(path.toLowerCase())) continue;
      signal.throwIfAborted();
      await o.sink.remove(path);
      outcome.removed++;
    }
  }
  signal.throwIfAborted();
  await o.sink.write(json.path, new Blob([json.text], { type: 'application/json' }), json.mtime);
  await o.sink.close();
  return outcome;
}

/** What the user reads when it stops. */
function failure(e: unknown): unknown {
  if (aborted(e) || e instanceof ApiError || !(e instanceof TypeError || e instanceof HttpStatus)) return e;
  if (e instanceof HttpStatus) return new Error(`下载${e.what}没有成功（${e.status}），稍后再试`);
  return new Error('网络断了，导出没能完成');
}
