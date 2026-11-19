import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { AttachmentKind, CreateAttachmentBody, OwnAttachment } from '../../shared/types';
import { ApiError } from '../lib/api';
import { fitName, kindOf, typeOf } from './kinds';
import { withoutLocation } from './mp4';
import { probe } from './probe';
import { beginUpload, discardUpload, sendParts, sendPoster, type Sending } from './upload';

// Files going up as attachments, one after another. Each is read first (what the browser tells of it; where a video
// was made, taken out), then sent in parts, then given its frame. One that fails stays to be tried again, going on
// from where it stopped, or given up, which deletes what was sent. Leaving the page gives up every one not done.
// Docs: /docs/product/features/attachments.md

export interface Upload {
  key: string;
  name: string;
  kind: AttachmentKind;
  size: number;
  /** bytes the Worker has */
  sent: number;
  state: 'waiting' | 'reading' | 'sending' | 'failed';
  error: string | null;
}

interface Job {
  view: Upload;
  file: File;
  /** a recording's length, timed as it was made */
  seconds: number | null;
  /** the file as it goes up */
  body: Blob | null;
  meta: CreateAttachmentBody | null;
  poster: Blob | null;
  sending: Sending | null;
  stop: AbortController | null;
}

/** What a failure says. */
function why(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return '网络中断了';
  return '上传没有成功';
}

/** A refusal after which the upload cannot go on (deleted, cleaned up, not as it was begun): a retry begins anew. */
const dead = (e: unknown) => e instanceof ApiError && [400, 403, 404, 409, 410, 413].includes(e.status);

let counter = 0;

/** `onDone` gets each attachment once it is up, loose: the page puts it in its entry. */
export function useUploads(onDone: (a: OwnAttachment) => void) {
  const [, render] = useReducer((n: number) => n + 1, 0);
  const jobs = useRef(new Map<string, Job>());
  const running = useRef(false);
  const gone = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;

  const update = useCallback((job: Job, change: Partial<Upload>) => {
    job.view = { ...job.view, ...change };
    render();
  }, []);

  const pump = useCallback(() => {
    if (running.current || gone.current) return;
    const job = [...jobs.current.values()].find((j) => j.view.state === 'waiting');
    if (!job) return;
    running.current = true;
    void run(job).finally(() => {
      running.current = false;
      pump();
    });

    async function run(job: Job) {
      const stop = new AbortController();
      job.stop = stop;
      try {
        if (!job.meta || !job.body) {
          update(job, { state: 'reading', error: null });
          const { kind } = job.view;
          job.body = kind === 'file' ? job.file : (await withoutLocation(job.file)).blob;
          const probed = await probe(job.file, kind);
          job.poster = probed.poster;
          job.meta = {
            kind,
            name: job.view.name,
            mime: typeOf(job.file) || 'application/octet-stream',
            size: job.file.size,
            duration: job.seconds ?? probed.duration,
            width: probed.width,
            height: probed.height
          };
        }
        stop.signal.throwIfAborted();
        update(job, { state: 'sending', error: null });
        job.sending ??= await beginUpload(job.meta, stop.signal);
        const up = await sendParts(job.sending, job.body, { signal: stop.signal, onProgress: (sent) => update(job, { sent }) });
        const framed = job.poster ? ((await sendPoster(up.id, job.poster, stop.signal)) ?? up) : up;
        jobs.current.delete(job.view.key);
        render();
        if (!gone.current) done.current(framed);
      } catch (e) {
        if (stop.signal.aborted) return;
        if (dead(e) && job.sending) {
          discardUpload(job.sending.upload.attachment.id);
          job.sending = null;
          update(job, { sent: 0 });
        }
        update(job, { state: 'failed', error: why(e) });
      } finally {
        job.stop = null;
      }
    }
  }, [update]);

  /** Files to send, in order; a recording with its length. */
  const add = useCallback(
    (files: { file: File; seconds?: number }[]) => {
      for (const { file, seconds } of files) {
        const key = `u${++counter}`;
        const kind = kindOf(file);
        jobs.current.set(key, {
          view: {
            key,
            name: fitName(file.name),
            kind: kind === 'image' ? 'file' : kind,
            size: file.size,
            sent: 0,
            state: 'waiting',
            error: null
          },
          file,
          seconds: seconds ?? null,
          body: null,
          meta: null,
          poster: null,
          sending: null,
          stop: null
        });
      }
      render();
      pump();
    },
    [pump]
  );

  const retry = useCallback(
    (key: string) => {
      const job = jobs.current.get(key);
      if (!job || job.view.state !== 'failed') return;
      update(job, { state: 'waiting', error: null });
      pump();
    },
    [pump, update]
  );

  const cancel = useCallback((key: string) => {
    const job = jobs.current.get(key);
    if (!job) return;
    jobs.current.delete(key);
    job.stop?.abort();
    if (job.sending) discardUpload(job.sending.upload.attachment.id);
    render();
  }, []);

  useEffect(() => {
    gone.current = false;
    const all = jobs.current;
    return () => {
      gone.current = true;
      for (const job of all.values()) {
        job.stop?.abort();
        if (job.sending) discardUpload(job.sending.upload.attachment.id);
      }
      all.clear();
    };
  }, []);

  const uploads = [...jobs.current.values()].map((j) => j.view);
  return { uploads, busy: uploads.some((u) => u.state !== 'failed'), add, retry, cancel };
}
