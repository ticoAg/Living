import type { Processed } from './process';

// Taking a photo from the site (the camera button in the phone's bottom bar): where the phone is while it is taken,
// and the way from the camera to the upload queue. The camera itself is in camera.ts. Also which file types the
// upload page asks the browser for, because on Android that decides whether photos arrive with their position.
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

export type Geo = Pick<Geolocation, 'watchPosition' | 'clearWatch'>;

/**
 * One watch on the phone's position shared by everything on the page that wants it. A browser tells a second watch
 * nothing until the position changes, so someone who starts listening while the phone stands still would wait for
 * good; here a newcomer hears the latest position at once (it is current: the watch has been running since). The
 * real watch starts with the first listener, with its options, and ends with the last.
 */
export function shareWatch(geo: Geo): Geo {
  const watchers = new Map<number, { ok: PositionCallback; fail: PositionErrorCallback | null }>();
  let ids = 0;
  let real: number | undefined;
  let last: GeolocationPosition | null = null;
  let refused: GeolocationPositionError | null = null;

  const end = () => {
    if (real !== undefined) geo.clearWatch(real);
    real = undefined;
    last = null;
    refused = null;
  };

  return {
    watchPosition(ok, fail, options) {
      const id = ++ids;
      watchers.set(id, { ok, fail: fail ?? null });
      if (real === undefined) {
        real = geo.watchPosition(
          (pos) => {
            last = pos;
            for (const w of watchers.values()) w.ok(pos);
          },
          (err) => {
            // a refusal is final; the other errors can be followed by a position
            if (err.code === 1) refused = err;
            for (const w of watchers.values()) w.fail?.(err);
          },
          options
        );
        // everyone may have left again inside the first answer
        if (!watchers.size) end();
      } else if (last || refused) {
        const pos = last;
        const err = refused;
        queueMicrotask(() => {
          const w = watchers.get(id);
          if (!w) return;
          if (err) w.fail?.(err);
          else if (pos) w.ok(pos);
        });
      }
      return id;
    },
    clearWatch(id) {
      if (watchers.delete(id) && !watchers.size) end();
    }
  };
}

let shared: Geo | undefined;

/** The phone's position for this page: `navigator.geolocation` behind one shared watch, or undefined where there is none. */
export function phonePosition(): Geo | undefined {
  if (shared) return shared;
  const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
  if (geo) shared = shareWatch(geo);
  return shared;
}

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

/** What a Tracker knows right now, for the camera screen. */
export type Tracked = { state: 'waiting' } | { state: 'refused' } | { state: 'found'; fix: DeviceFix };

export interface Tracker {
  /**
   * The phone's position for a photo taken now. At once when the latest fix is good; otherwise the most accurate fix
   * heard from now on, taken SETTLE_MS after the phone's first answer (ASK_MS when it has not answered yet), sooner
   * if a good one arrives. Never rejects.
   */
  fixNow(): Promise<DeviceFix | null>;
  now(): Tracked;
  /** Hear about every change of `now()`. */
  subscribe(fn: () => void): () => void;
  /** The camera is closing: stop listening. Photos still waiting get the best fix they have. */
  stop(): void;
}

interface Waiting {
  best: DeviceFix | null;
  timer: ReturnType<typeof setTimeout>;
  resolve: (fix: DeviceFix | null) => void;
}

/**
 * Follow the phone's position for as long as the site's own camera is open, so that every photo taken there can ask
 * where it is (`fixNow`). Unlike `startLocating`, which serves one photo and stops, this keeps the latest fix: with
 * the camera open for minutes, the latest one is where the phone is now.
 */
export function trackPosition(geo: Geo | undefined): Tracker {
  let last: DeviceFix | null = null;
  let heard = false;
  let refused = !geo;
  let stopped = false;
  let watch: number | undefined;
  const waiting = new Set<Waiting>();
  const listeners = new Set<() => void>();

  const usable = (fix: DeviceFix | null) => (fix && fix.accuracy <= COARSE_M ? fix : null);
  const tell = () => {
    for (const fn of listeners) fn();
  };
  const settle = (w: Waiting, keep = true) => {
    clearTimeout(w.timer);
    waiting.delete(w);
    w.resolve(keep ? usable(w.best) : null);
  };
  /** the phone's first answer: photos that were waiting for it now wait the short time for a better fix */
  const answered = () => {
    if (heard) return;
    heard = true;
    for (const w of waiting) {
      clearTimeout(w.timer);
      w.timer = setTimeout(() => settle(w), SETTLE_MS);
    }
  };

  if (geo) {
    watch = geo.watchPosition(
      (pos) => {
        const c = pos.coords;
        last = { lat: round(c.latitude), lng: round(c.longitude), accuracy: Math.round(c.accuracy) };
        answered();
        for (const w of waiting) {
          if (!w.best || last.accuracy < w.best.accuracy) w.best = last;
          if (last.accuracy <= GOOD_M) settle(w);
        }
        tell();
      },
      (err) => {
        // a refusal is final; "unavailable" and "timeout" can still be followed by a fix
        if (err.code === 1) {
          refused = true;
          for (const w of waiting) settle(w, false);
        } else answered();
        tell();
      },
      { enableHighAccuracy: true, maximumAge: 0 }
    );
    if (stopped) geo.clearWatch(watch);
  }

  return {
    fixNow() {
      if (refused) return Promise.resolve(null);
      if (stopped || (last && last.accuracy <= GOOD_M)) return Promise.resolve(usable(last));
      return new Promise((resolve) => {
        const w: Waiting = { best: last, resolve, timer: setTimeout(() => settle(w), heard ? SETTLE_MS : ASK_MS) };
        waiting.add(w);
      });
    },
    now: () => (refused ? { state: 'refused' } : last ? { state: 'found', fix: last } : { state: 'waiting' }),
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (watch !== undefined) geo?.clearWatch(watch);
      for (const w of waiting) settle(w);
      listeners.clear();
    }
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
