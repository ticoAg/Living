// HEIC/HEIF fallback for browsers that cannot open them (everything except Safari): the file is decoded to pixels by libheif
// running as WebAssembly in a Worker, and the upload pipeline carries on with those pixels as if the browser had decoded them.
// This module is imported lazily by process.ts, and the worker (with libheif, about 0.7 MB compressed) is only started when a
// file needs it, so none of it is part of the main or the upload chunk.
// Docs: /docs/product/features/upload.md

import { heifColorSpace } from './heif';
import type { HeicFailure, HeicReply, HeicRequest } from './heic.worker';

/**
 * Photos with more pixels than this are refused. A decode holds about 20 bytes per pixel between the worker and the page
 * (WebAssembly heap, two RGBA copies, the bitmap), and a tab that runs out of memory takes the unpublished queue with it.
 * Every iPhone mode is below 49 MP.
 */
export const MAX_HEIC_PIXELS = 100_000_000;

/** A decoder that has not finished loading after this long is given up on, so a stalled download ends in the retry button, not a wait without end. */
const LOAD_TIMEOUT_MS = 60_000;
/** A decode with no answer after this long is abandoned and its worker killed. */
const DECODE_TIMEOUT_MS = 3 * 60_000;
/** The WebAssembly heap never shrinks, so the worker is dropped soon after the last photo of a batch. */
const IDLE_MS = 15_000;

/** What the user waits for: the decoder arriving (first HEIC of the session), then the decode itself. */
export type HeicStage = 'load' | 'decode';

const MSG = {
  load: '加载 HEIC 解码器失败，请检查网络后重试。',
  unreadable: '这张 HEIC 无法读取，文件可能已损坏或不完整。请先转成 JPEG 再上传。',
  failed: '这张 HEIC 解码失败，请先转成 JPEG 再上传。',
  memory: '解码这张 HEIC 时内存不足。请关掉其他标签页后重试，或先转成 JPEG 再上传。',
  crashed: '解码 HEIC 时出错，可能是内存不足。请关掉其他标签页后重试，或先转成 JPEG 再上传。',
  timeout: '解码这张 HEIC 用时过长，已放弃。请先转成 JPEG 再上传。',
  tooLarge: (pixels: number) =>
    `这张 HEIC 有 ${Math.round(pixels / 1e6)} 百万像素，超过浏览器能解码的上限（${MAX_HEIC_PIXELS / 1e6} 百万）。请先缩小或转成 JPEG 再上传。`
};

function describe(reason: HeicFailure, pixels?: number): string {
  switch (reason) {
    case 'unreadable':
      return MSG.unreadable;
    case 'too-large':
      return MSG.tooLarge(pixels ?? MAX_HEIC_PIXELS);
    case 'memory':
      return MSG.memory;
    default:
      return MSG.failed;
  }
}

type Verdict = Extract<HeicReply, { id: number }>;
interface Waiter {
  resolve: (verdict: Verdict) => void;
  reject: (error: Error) => void;
}

let session: Session | undefined;
let nextId = 1;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** One worker, from start to termination. */
class Session {
  /** resolves once libheif is instantiated; rejects when the worker could not be loaded or started, or was killed first */
  readonly ready: Promise<void>;
  private readonly worker: Worker;
  private readonly waiting = new Map<number, Waiter>();
  private failReady: (error: Error) => void = () => {};
  private loaded = false;

  constructor() {
    this.worker = new Worker(new URL('./heic.worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise<void>((resolve, reject) => {
      this.failReady = reject;
      this.worker.onmessage = (e: MessageEvent<HeicReply>) => {
        const reply = e.data;
        if (reply.type === 'ready') {
          if (reply.error) {
            console.warn('[heic] decoder failed to start:', reply.error);
            return this.kill(new Error(MSG.load));
          }
          this.loaded = true;
          return resolve();
        }
        const waiter = this.waiting.get(reply.id);
        this.waiting.delete(reply.id);
        waiter?.resolve(reply);
      };
      // The worker script could not be fetched or parsed, or something threw inside it for good.
      this.worker.onerror = (e) => {
        e.preventDefault();
        console.warn('[heic] decoder worker error:', e.message || 'the script did not load');
        this.kill(new Error(this.loaded ? MSG.crashed : MSG.load));
      };
    });
    this.ready.catch(() => {}); // the caller handles it; this keeps an unobserved rejection quiet
  }

  request(buffer: ArrayBuffer): Promise<Verdict> {
    return new Promise<Verdict>((resolve, reject) => {
      const id = nextId++;
      this.waiting.set(id, { resolve, reject });
      const message: HeicRequest = { id, buffer, maxPixels: MAX_HEIC_PIXELS };
      this.worker.postMessage(message, [buffer]);
    });
  }

  /** Terminates the worker; whatever is waiting on it, the loading included, fails with `error`. */
  kill(error: Error) {
    if (session === this) session = undefined;
    this.worker.terminate();
    this.failReady(error);
    for (const waiter of this.waiting.values()) waiter.reject(error);
    this.waiting.clear();
  }
}

function stop() {
  clearTimeout(idleTimer);
  session?.kill(new Error(MSG.crashed));
}

/**
 * libheif hands over plain RGB values, whatever profile the file carries. Tagging them with their own colour space (iPhones: Display
 * P3) lets the browser convert to sRGB when they are drawn, the way it does for a P3 JPEG; one that cannot tag ImageData draws them as sRGB.
 */
function toImageData(pixels: ArrayBuffer, width: number, height: number, colorSpace: PredefinedColorSpace): ImageData {
  const data = new Uint8ClampedArray(pixels);
  try {
    return new ImageData(data, width, height, { colorSpace });
  } catch {
    return new ImageData(data, width, height);
  }
}

export interface HeicPhoto {
  /** upright pixels, rotation already applied; the caller closes it */
  image: ImageBitmap;
  width: number;
  height: number;
}

async function run(file: Blob, onStage?: (stage: HeicStage) => void): Promise<HeicPhoto> {
  clearTimeout(idleTimer);
  try {
    if (!session) onStage?.('load');
    const s = (session ??= new Session());
    const loadTimer = setTimeout(() => s.kill(new Error(MSG.load)), LOAD_TIMEOUT_MS);
    try {
      await s.ready;
    } finally {
      clearTimeout(loadTimer);
    }
    onStage?.('decode');

    const buffer = await file.arrayBuffer();
    const timer = setTimeout(() => s.kill(new Error(MSG.timeout)), DECODE_TIMEOUT_MS);
    let verdict: Verdict;
    try {
      verdict = await s.request(buffer);
    } finally {
      clearTimeout(timer);
    }
    if (verdict.type === 'fail') {
      // After an exception from the WebAssembly the instance cannot be trusted; after running out of memory, dropping the worker is
      // what frees the heap it grew.
      if (verdict.fatal || verdict.reason === 'memory') s.kill(new Error(MSG.crashed));
      throw new Error(describe(verdict.reason, verdict.pixels));
    }

    try {
      const pixels = toImageData(verdict.pixels, verdict.width, verdict.height, await heifColorSpace(file));
      return { image: await createImageBitmap(pixels), width: verdict.width, height: verdict.height };
    } catch {
      throw new Error(MSG.memory);
    }
  } finally {
    idleTimer = setTimeout(stop, IDLE_MS);
  }
}

/**
 * Decode a HEIC/HEIF file to an upright bitmap. Calls run one at a time. Rejects with a message fit to show the user.
 * `onStage` is told when the decoder is being fetched ('load', first HEIC only) and when the decode starts ('decode').
 */
export function decodeHeic(file: Blob, onStage?: (stage: HeicStage) => void): Promise<HeicPhoto> {
  const job = queue.then(() => run(file, onStage));
  queue = job.catch(() => {});
  return job;
}
