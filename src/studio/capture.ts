import type { Processed } from './process';

// Taking a photo from the site (the camera button in the phone's bottom bar): where the phone is while it is taken,
// and the way from that button to the upload queue. Also which file types the upload page asks the browser for,
// because on Android that decides whether photos arrive with their position.
// Docs: /docs/product/features/upload.md#拍照 and #安卓上的位置

/** Where the phone says it is. Stands in for the position of a photo whose file carries none. */
export interface DeviceFix {
  lat: number;
  lng: number;
  /** metres; the phone is within this distance of the point (95%) */
  accuracy: number;
}

/** What is known about a photo taken through the site, besides its file. */
export interface Capture {
  /** when the photo came back from the camera, epoch ms */
  at: number;
  /** the phone's position, or null when it is not known (refused, no signal, too coarse) */
  fix: Promise<DeviceFix | null>;
}

export interface Captured extends Capture {
  file: File;
}

/* ------------------------------------------------------------ position */

/** A fix this accurate is taken at once. */
export const GOOD_M = 25;
/** A coarser fix than this (a cell tower, a network guess) says too little about where a photo was taken. */
export const COARSE_M = 1000;
/** Once the photo is back and the phone has answered, how long to keep waiting for a better fix. */
export const SETTLE_MS = 6000;
/** Once the photo is back, how long the first answer may take: the permission prompt has to be read, GPS has to start. */
export const ASK_MS = 20_000;
/** A camera that never comes back (the tab was dropped, the picker closed without a word) stops the watch after this. */
export const GIVE_UP_MS = 5 * 60 * 1000;

type Geo = Pick<Geolocation, 'watchPosition' | 'clearWatch'>;

export interface Locator {
  fix: Promise<DeviceFix | null>;
  /**
   * The photo is back: stop waiting soon. A good fix ends it at once; otherwise the best one is taken SETTLE_MS after
   * the phone's first answer, and no answer within ASK_MS ends it with nothing.
   */
  settle(): void;
  /** No photo after all: stop listening. */
  stop(): void;
}

const round = (deg: number) => Math.round(deg * 1e6) / 1e6;

/**
 * Listen for the phone's position, keeping the most accurate fix. GPS starts coarse and tightens over a few seconds,
 * so the first answer is not taken unless it is already good. Never rejects: no geolocation, a refusal or nothing
 * usable all end in null.
 */
export function startLocating(geo: Geo | undefined): Locator {
  if (!geo) return { fix: Promise.resolve(null), settle() {}, stop() {} };
  let best: DeviceFix | null = null;
  let watch: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let over = false;
  /** the phone has answered, with a position or an error */
  let heard = false;
  let settling = false;
  let resolve!: (fix: DeviceFix | null) => void;
  const fix = new Promise<DeviceFix | null>((r) => (resolve = r));

  const finish = (keep: boolean) => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    if (watch !== undefined) geo.clearWatch(watch);
    resolve(keep && best && best.accuracy <= COARSE_M ? best : null);
  };
  const within = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => finish(true), ms);
  };

  const answered = () => {
    if (heard) return;
    heard = true;
    if (settling) within(SETTLE_MS);
  };

  within(GIVE_UP_MS);
  watch = geo.watchPosition(
    (pos) => {
      const c = pos.coords;
      if (!best || c.accuracy < best.accuracy) best = { lat: round(c.latitude), lng: round(c.longitude), accuracy: Math.round(c.accuracy) };
      if (best.accuracy <= GOOD_M) finish(true);
      else answered();
    },
    (err) => {
      // a refusal is final; "unavailable" and "timeout" can still be followed by a fix
      if (err.code === 1) finish(false);
      else answered();
    },
    { enableHighAccuracy: true, maximumAge: 0 }
  );
  // the watch may have answered (or been refused) before its id was known
  if (over) geo.clearWatch(watch);

  return {
    fix,
    settle: () => {
      if (over || settling) return;
      settling = true;
      within(heard ? SETTLE_MS : ASK_MS);
    },
    stop: () => finish(false)
  };
}

/* ------------------------------------------------------------ the photo */

const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock time and UTC offset of an instant, in the shapes EXIF time takes in the queue. */
export function wallClock(at: number, offsetMin = -new Date(at).getTimezoneOffset()): { takenAt: string; tz: string } {
  const d = new Date(at + offsetMin * 60000);
  const takenAt = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const abs = Math.abs(offsetMin);
  return { takenAt, tz: `${offsetMin < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}` };
}

/** The file says where it was taken. */
export const hasPosition = (p: Processed) => p.exif.lat != null && p.exif.lng != null;

/**
 * A photo taken through the site: what its file does not say is filled in with what the phone knew at that moment.
 * The file's own time and position always win.
 */
export function withCapture(p: Processed, at: number, fix: DeviceFix | null, offsetMin?: number): Processed {
  const place = !hasPosition(p) && fix ? { lat: fix.lat, lng: fix.lng } : null;
  const time = p.exif.takenAt ? null : wallClock(at, offsetMin);
  if (!place && !time) return p;
  return { ...p, exif: { ...p.exif, ...place, ...time } };
}

/* ------------------------------------------------------------ to the upload queue */

let waiting: Captured[] = [];
const listeners = new Set<() => void>();

/** Leave a photo for the upload page, which may not be open yet. */
export function handOver(shot: Captured): void {
  waiting.push(shot);
  for (const fn of listeners) fn();
}

/** The photos left since the last call. */
export function takeCaptured(): Captured[] {
  const out = waiting;
  waiting = [];
  return out;
}

export function onCaptured(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/* ------------------------------------------------------------ choosing files */

const IMAGES = 'image/*,.heic,.heif,.avif';

export const isAndroid = (ua: string) => /Android/i.test(ua);

/**
 * The upload page's `accept`. Android's photo picker hands a browser copies with the position removed (the system
 * redacts it for apps without ACCESS_MEDIA_LOCATION, which browsers do not hold); files chosen in the system file
 * browser are the originals. Chrome opens the photo picker only when every accepted type is an image or a video
 * (SelectFileDialog.shouldUsePhotoPicker), so one more type makes it offer 文件 instead. The type matches no file:
 * the file browser still lists images only.
 */
export const pickerAccept = (ua: string) => (isAndroid(ua) ? `${IMAGES},application/x-original-photo` : IMAGES);
