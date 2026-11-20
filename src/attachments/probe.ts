// What the browser can tell of a video or a sound before it goes up: how long it is, a video's size in pixels, and a
// frame of it to show before it plays. A file it cannot play goes up without them. Docs: /docs/product/features/attachments.md

import { ATTACHMENT_LIMITS } from '../../shared/limits';
import type { AttachmentKind } from '../../shared/types';

export interface Probed {
  duration: number | null;
  width: number | null;
  height: number | null;
  /** WebP, or JPEG where the browser makes no WebP; at most `posterMaxBytes` */
  poster: Blob | null;
}

const NOTHING: Probed = { duration: null, width: null, height: null, poster: null };
/** The longest side of a frame, in pixels. */
const FRAME_SIDE = 1280;
/** Longer than the Worker takes (7 days): a length no file has. */
const MAX_SECONDS = 7 * 86400;

/** The first of `events` on `el`; refused on `error` or after `ms`. */
function first(el: HTMLMediaElement, events: string[], ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const end = (ok: boolean) => {
      clearTimeout(timer);
      for (const e of events) el.removeEventListener(e, onEvent);
      el.removeEventListener('error', onError);
      if (ok) resolve();
      else reject(new Error('媒体读不出来'));
    };
    const onEvent = () => end(true);
    const onError = () => end(false);
    const timer = setTimeout(onError, ms);
    for (const e of events) el.addEventListener(e, onEvent);
    el.addEventListener('error', onError);
  });
}

/** Its length in seconds. What MediaRecorder writes (WebM) says none until read to its end, so it is sought there once. */
async function lengthOf(el: HTMLMediaElement): Promise<number | null> {
  if (el.duration === Infinity) {
    const known = first(el, ['durationchange'], 5000).catch(() => undefined);
    el.currentTime = 1e101;
    await known;
  }
  const d = el.duration;
  return Number.isFinite(d) && d >= 0 && d <= MAX_SECONDS ? Math.round(d * 1000) / 1000 : null;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** A frame from near its start (the very first is often black), no larger than FRAME_SIDE. */
async function frameOf(el: HTMLVideoElement, duration: number | null): Promise<Blob | null> {
  const sought = first(el, ['seeked'], 8000);
  el.currentTime = duration ? Math.min(1, duration / 2) : 0.001;
  await sought;
  if (el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await first(el, ['loadeddata', 'canplay'], 8000);
  const scale = Math.min(1, FRAME_SIDE / Math.max(el.videoWidth, el.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(el.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(el.videoHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
  // a browser that makes no WebP hands back a PNG instead
  for (const [type, quality] of [
    ['image/webp', 0.8],
    ['image/jpeg', 0.82],
    ['image/jpeg', 0.6]
  ] as const) {
    const blob = await toBlob(canvas, type, quality);
    if (blob && blob.type === type && blob.size <= ATTACHMENT_LIMITS.posterMaxBytes) return blob;
  }
  return null;
}

async function read<T>(tag: 'video' | 'audio', file: Blob, then: (el: HTMLMediaElement) => Promise<T>): Promise<T | null> {
  const el = document.createElement(tag);
  el.muted = true;
  el.preload = tag === 'video' ? 'auto' : 'metadata';
  if (el instanceof HTMLVideoElement) el.playsInline = true;
  const url = URL.createObjectURL(file);
  try {
    const meta = first(el, ['loadedmetadata'], 15_000);
    el.src = url;
    await meta;
    return await then(el);
  } catch {
    return null;
  } finally {
    el.removeAttribute('src');
    el.load();
    URL.revokeObjectURL(url);
  }
}

/** What the browser tells of `file` as an attachment of `kind`; nothing for a file, or one it cannot read. */
export async function probe(file: Blob, kind: AttachmentKind): Promise<Probed> {
  if (kind === 'audio') return (await read('audio', file, async (el) => ({ ...NOTHING, duration: await lengthOf(el) }))) ?? NOTHING;
  if (kind !== 'video') return NOTHING;
  const probed = await read('video', file, async (el) => {
    const v = el as HTMLVideoElement;
    const duration = await lengthOf(v);
    const width = v.videoWidth || null;
    const height = v.videoHeight || null;
    const poster = width && height ? await frameOf(v, duration).catch(() => null) : null;
    return { duration, width, height, poster };
  });
  return probed ?? NOTHING;
}
