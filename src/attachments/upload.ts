// Sending an attachment's file: the upload begun (POST /api/attachments, or /api/import/attachments for an import),
// then its parts one after another with their progress, each tried again after 1, 4 and 15 seconds when the network or
// the server fails, then completed; a video's frame last. A part the Worker has is not sent again: an upload that
// failed goes on from where it stopped. Docs: /docs/api/attachments.md

import type { AttachmentPart, AttachmentResponse, AttachmentUpload, CreateAttachmentBody, OwnAttachment } from '../../shared/types';
import { api, ApiError, reportUnauthenticated } from '../lib/api';

/** Waits before the retries of a part that failed on the way (network, 5xx, 429). */
export const RETRY_WAIT = [1000, 4000, 15000];

/** A PUT of bytes with upload progress. */
export type PutBytes = (
  url: string,
  body: Blob,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal
) => Promise<{ status: number; body: unknown }>;

const abortError = () => new DOMException('已取消', 'AbortError');

/** Through XMLHttpRequest: fetch tells nothing of what it has sent. */
export const xhrPut: PutBytes = (url, body, onProgress, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = () => signal?.removeEventListener('abort', onAbort);
    xhr.open('PUT', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      done();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        parsed = null;
      }
      resolve({ status: xhr.status, body: parsed });
    };
    xhr.onerror = () => {
      done();
      reject(new TypeError('网络中断'));
    };
    xhr.onabort = () => {
      done();
      reject(abortError());
    };
    xhr.send(body);
  });

export interface SendOptions {
  signal?: AbortSignal;
  /** bytes the Worker has, of the file's */
  onProgress?: (sent: number, total: number) => void;
  put?: PutBytes;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** An upload as it goes: where its parts go and those the Worker has. Kept by the sender, to go on after a failure. */
export interface Sending {
  upload: AttachmentUpload;
  done: AttachmentPart[];
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(abortError());
      },
      { once: true }
    );
  });

const transient = (e: unknown) =>
  e instanceof TypeError || (e instanceof ApiError && (e.status >= 500 || e.status === 429 || e.status === 408));

/** An answer that is not 200, as `api()` would have thrown it. */
function refused(path: string, status: number, body: unknown): ApiError {
  if (status === 401) reportUnauthenticated(path);
  const b = (body && typeof body === 'object' ? body : {}) as { error?: string; message?: string };
  return new ApiError(status, b.error ?? `http_${status}`, b.message ?? '上传没有成功，请稍后再试', b);
}

/** Begins the upload of a file of `meta` (as POST /api/attachments takes it). */
export async function beginUpload(meta: CreateAttachmentBody, signal?: AbortSignal): Promise<Sending> {
  return { upload: await api<AttachmentUpload>('/api/attachments', { json: meta, signal }), done: [] };
}

/** `fn`, and again after 1, 4 and 15 seconds while it fails on the way. */
async function retrying<T>(fn: () => Promise<T>, o: SendOptions): Promise<T> {
  const sleep = o.sleep ?? wait;
  for (let attempt = 0; ; attempt++) {
    o.signal?.throwIfAborted();
    try {
      return await fn();
    } catch (e) {
      if (o.signal?.aborted || !transient(e) || attempt >= RETRY_WAIT.length) throw e;
    }
    await sleep(RETRY_WAIT[attempt], o.signal);
  }
}

/** Sends the parts the Worker does not have yet, then completes the upload: the attachment, in full and loose. */
export async function sendParts(s: Sending, file: Blob, o: SendOptions = {}): Promise<OwnAttachment> {
  const { attachment, partBytes, parts } = s.upload;
  const put = o.put ?? xhrPut;
  const id = encodeURIComponent(attachment.id);
  const length = (n: number) => Math.min(partBytes, file.size - (n - 1) * partBytes);
  const has = () => s.done.reduce((sum, p) => sum + length(p.partNumber), 0);
  o.onProgress?.(has(), file.size);
  for (let n = 1; n <= parts; n++) {
    if (s.done.some((p) => p.partNumber === n)) continue;
    const body = file.slice((n - 1) * partBytes, (n - 1) * partBytes + length(n));
    const path = `/api/attachments/${id}/parts/${n}`;
    const before = has();
    const part = await retrying(async () => {
      const res = await put(path, body, (loaded) => o.onProgress?.(before + Math.min(loaded, body.size), file.size), o.signal);
      if (res.status !== 200) throw refused(path, res.status, res.body);
      return res.body as AttachmentPart;
    }, o);
    s.done.push(part);
    o.onProgress?.(has(), file.size);
  }
  const done = [...s.done].sort((a, b) => a.partNumber - b.partNumber);
  const complete = () => api<AttachmentResponse>(`/api/attachments/${id}/complete`, { json: { parts: done }, signal: o.signal });
  return (await retrying(complete, o)).attachment;
}

/** A video's frame; the attachment as it is with it, or null when it could not be sent (it plays without one). */
export async function sendPoster(id: string, poster: Blob, signal?: AbortSignal): Promise<OwnAttachment | null> {
  try {
    return (await api<AttachmentResponse>(`/api/attachments/${encodeURIComponent(id)}/poster`, { method: 'PUT', body: poster, signal }))
      .attachment;
  } catch {
    return null;
  }
}

/** An upload given up: what was sent goes at once rather than with the hourly cleanup. */
export function discardUpload(id: string): void {
  void api(`/api/attachments/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
}
