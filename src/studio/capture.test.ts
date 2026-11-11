import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  ASK_MS,
  COARSE_M,
  GIVE_UP_MS,
  handOver,
  onCaptured,
  pickerAccept,
  SETTLE_MS,
  shareWatch,
  startLocating,
  takeCaptured,
  trackPosition,
  wallClock,
  withCapture,
  type DeviceFix
} from './capture';
import type { Processed } from './process';

/** A stand-in for navigator.geolocation: the test decides what the phone reports and when. */
function fakeGeo() {
  let ok: PositionCallback | null = null;
  let fail: PositionErrorCallback | null = null;
  const cleared: number[] = [];
  return {
    cleared,
    options: undefined as PositionOptions | undefined,
    watchPosition(success: PositionCallback, error?: PositionErrorCallback | null, options?: PositionOptions) {
      ok = success;
      fail = error ?? null;
      this.options = options;
      return 7;
    },
    clearWatch(id: number) {
      cleared.push(id);
    },
    report(latitude: number, longitude: number, accuracy: number) {
      ok?.({ coords: { latitude, longitude, accuracy } } as GeolocationPosition);
    },
    refuse(code = 1) {
      fail?.({ code } as GeolocationPositionError);
    }
  };
}

const exif = (over: Partial<Processed['exif']> = {}) =>
  ({ exif: { takenAt: '2026-05-17T09:30:00', tz: '+08:00', lat: null, lng: null, ...over } }) as unknown as Processed;

describe('startLocating', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('takes a good fix at once and stops listening', async () => {
    const geo = fakeGeo();
    const loc = startLocating(geo);
    geo.report(30.2590512, 120.1480649, 12.4);
    await expect(loc.fix).resolves.toEqual({ lat: 30.259051, lng: 120.148065, accuracy: 12 });
    expect(geo.cleared).toEqual([7]);
    expect(geo.options).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
  });

  it('keeps the most accurate of several coarse fixes until the photo is back, then a little longer', async () => {
    const geo = fakeGeo();
    const loc = startLocating(geo);
    let got: DeviceFix | null | undefined;
    void loc.fix.then((f) => (got = f));
    geo.report(30.3, 120.2, 800);
    geo.report(30.26, 120.15, 60);
    geo.report(30.27, 120.16, 300);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(got).toBeUndefined();
    loc.settle();
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(got).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toEqual({ lat: 30.26, lng: 120.15, accuracy: 60 });
    expect(geo.cleared).toEqual([7]);
  });

  it('a good fix that arrives while settling ends the wait', async () => {
    const geo = fakeGeo();
    const loc = startLocating(geo);
    geo.report(30.3, 120.2, 500);
    loc.settle();
    await vi.advanceTimersByTimeAsync(1000);
    geo.report(30.26, 120.15, 8);
    await expect(loc.fix).resolves.toEqual({ lat: 30.26, lng: 120.15, accuracy: 8 });
  });

  it('gives null for a refusal, without waiting', async () => {
    const geo = fakeGeo();
    const loc = startLocating(geo);
    geo.refuse(1);
    await expect(loc.fix).resolves.toBeNull();
    expect(geo.cleared).toEqual([7]);
  });

  it('waits on after "position unavailable": a fix can still follow', async () => {
    const geo = fakeGeo();
    const loc = startLocating(geo);
    geo.refuse(2);
    geo.report(30.26, 120.15, 20);
    await expect(loc.fix).resolves.toMatchObject({ accuracy: 20 });
  });

  it('gives null when the best fix is too coarse to place a photo', async () => {
    const geo = fakeGeo();
    const loc = startLocating(geo);
    geo.report(30.3, 120.2, COARSE_M + 1);
    loc.settle();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await expect(loc.fix).resolves.toBeNull();
  });

  it('gives the phone time for its first answer (a permission prompt to read), then settles as usual', async () => {
    const geo = fakeGeo();
    const loc = startLocating(geo);
    let got: DeviceFix | null | undefined;
    void loc.fix.then((f) => (got = f));
    loc.settle();
    // the prompt is answered well after SETTLE_MS, and the first fix is coarse
    await vi.advanceTimersByTimeAsync(ASK_MS - 1000);
    expect(got).toBeUndefined();
    geo.report(30.3, 120.2, 90);
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(got).toBeUndefined();
    geo.report(30.26, 120.15, 40);
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toEqual({ lat: 30.26, lng: 120.15, accuracy: 40 });
  });

  it('gives null when nothing was heard', async () => {
    const geo = fakeGeo();
    const loc = startLocating(geo);
    let got: DeviceFix | null | undefined;
    void loc.fix.then((f) => (got = f));
    loc.settle();
    loc.settle(); // a second call does not start the wait over
    await vi.advanceTimersByTimeAsync(ASK_MS - 1);
    expect(got).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toBeNull();
  });

  it('"position unavailable" counts as an answer: the wait for a fix is the short one', async () => {
    const geo = fakeGeo();
    const loc = startLocating(geo);
    loc.settle();
    geo.refuse(2);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await expect(loc.fix).resolves.toBeNull();
  });

  it('stop ends it with null, and a camera that never comes back does too', async () => {
    const a = fakeGeo();
    const one = startLocating(a);
    a.report(30.26, 120.15, 40);
    one.stop();
    await expect(one.fix).resolves.toBeNull();
    expect(a.cleared).toEqual([7]);

    const b = fakeGeo();
    const two = startLocating(b);
    await vi.advanceTimersByTimeAsync(GIVE_UP_MS);
    await expect(two.fix).resolves.toBeNull();
    expect(b.cleared).toEqual([7]);
  });

  it('gives null where there is no geolocation', async () => {
    const loc = startLocating(undefined);
    loc.settle();
    loc.stop();
    await expect(loc.fix).resolves.toBeNull();
  });
});

describe('shareWatch', () => {
  /** A phone that, like a browser, answers a watch only when it has something new: one real watch at a time. */
  function phone() {
    const real = fakeGeo();
    let started = 0;
    const watchPosition = real.watchPosition.bind(real);
    real.watchPosition = (...args: Parameters<typeof watchPosition>) => {
      started++;
      return watchPosition(...args);
    };
    return { real, started: () => started };
  }
  const coords = (p: GeolocationPosition) => [p.coords.latitude, p.coords.longitude, p.coords.accuracy];

  it('gives a newcomer the latest position at once, while the phone stands still', async () => {
    const { real, started } = phone();
    const geo = shareWatch(real);
    const first = vi.fn();
    geo.watchPosition(first, null, { enableHighAccuracy: true, maximumAge: 0 });
    real.report(30.26, 120.15, 12);
    expect(first).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    geo.watchPosition(second);
    expect(second).not.toHaveBeenCalled(); // after watchPosition has returned, as a browser does
    await Promise.resolve();
    expect(second).toHaveBeenCalledTimes(1);
    expect(coords(second.mock.calls[0][0])).toEqual([30.26, 120.15, 12]);
    // one watch on the phone, with the first listener's options
    expect(started()).toBe(1);
    expect(real.options).toEqual({ enableHighAccuracy: true, maximumAge: 0 });
  });

  it('passes every new position and error on to all listeners', () => {
    const { real } = phone();
    const geo = shareWatch(real);
    const a = { ok: vi.fn(), fail: vi.fn() };
    const b = { ok: vi.fn(), fail: vi.fn() };
    geo.watchPosition(a.ok, a.fail);
    geo.watchPosition(b.ok, b.fail);
    real.report(30.26, 120.15, 40);
    real.refuse(2);
    real.report(30.27, 120.16, 20);
    for (const w of [a, b]) {
      expect(w.ok).toHaveBeenCalledTimes(2);
      expect(w.fail).toHaveBeenCalledTimes(1);
    }
  });

  it('a listener that left hears nothing more, and the phone is let go with the last one', async () => {
    const { real } = phone();
    const geo = shareWatch(real);
    const a = vi.fn();
    const b = vi.fn();
    const ida = geo.watchPosition(a);
    const idb = geo.watchPosition(b);
    real.report(30.26, 120.15, 40);
    geo.clearWatch(ida);
    real.report(30.27, 120.16, 20);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    expect(real.cleared).toEqual([]);
    geo.clearWatch(idb);
    geo.clearWatch(idb);
    expect(real.cleared).toEqual([7]);
    // left before the replay it was owed
    const c = vi.fn();
    geo.watchPosition(vi.fn());
    real.report(30.26, 120.15, 40);
    geo.clearWatch(geo.watchPosition(c));
    await Promise.resolve();
    expect(c).not.toHaveBeenCalled();
  });

  it('starts over after everyone has left: an old position is not handed to the next listener', async () => {
    const { real, started } = phone();
    const geo = shareWatch(real);
    geo.clearWatch(geo.watchPosition(vi.fn()));
    real.report(30.26, 120.15, 12); // nobody is listening any more
    const later = vi.fn();
    geo.watchPosition(later);
    await Promise.resolve();
    expect(later).not.toHaveBeenCalled();
    expect(started()).toBe(2);
    real.report(31.0, 121.0, 15);
    expect(coords(later.mock.calls[0][0])).toEqual([31.0, 121.0, 15]);
  });

  it('tells a newcomer about a refusal, which is final', async () => {
    const { real } = phone();
    const geo = shareWatch(real);
    geo.watchPosition(vi.fn(), vi.fn());
    real.refuse(1);
    const fail = vi.fn();
    geo.watchPosition(vi.fn(), fail);
    await Promise.resolve();
    expect(fail).toHaveBeenCalledTimes(1);
    expect(fail.mock.calls[0][0].code).toBe(1);
  });

  it('serves a camera screen and a single photo at the same time', async () => {
    vi.useFakeTimers();
    const { real } = phone();
    const geo = shareWatch(real);
    const screen = trackPosition(geo);
    real.report(30.26, 120.15, 12);
    // the system camera is asked for while the screen is still following the phone, which does not move
    const one = startLocating(geo);
    await expect(one.fix).resolves.toEqual({ lat: 30.26, lng: 120.15, accuracy: 12 });
    screen.stop();
    expect(real.cleared).toEqual([7]);
    vi.useRealTimers();
  });
});

describe('trackPosition', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('answers at once from a good latest fix, and keeps following the phone', async () => {
    const geo = fakeGeo();
    const t = trackPosition(geo);
    expect(t.now()).toEqual({ state: 'waiting' });
    geo.report(30.26, 120.15, 10);
    await expect(t.fixNow()).resolves.toEqual({ lat: 30.26, lng: 120.15, accuracy: 10 });
    // the phone moved: the next photo is where the phone is now, not where the best fix was
    geo.report(30.27, 120.16, 18);
    await expect(t.fixNow()).resolves.toEqual({ lat: 30.27, lng: 120.16, accuracy: 18 });
    expect(t.now()).toEqual({ state: 'found', fix: { lat: 30.27, lng: 120.16, accuracy: 18 } });
    expect(geo.cleared).toEqual([]);
    expect(geo.options).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
  });

  it('a photo taken on a coarse fix waits a little for a better one', async () => {
    const geo = fakeGeo();
    const t = trackPosition(geo);
    geo.report(30.3, 120.2, 400);
    let got: DeviceFix | null | undefined;
    void t.fixNow().then((f) => (got = f));
    await vi.advanceTimersByTimeAsync(1000);
    geo.report(30.26, 120.15, 60);
    geo.report(30.28, 120.17, 150);
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1001);
    expect(got).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toEqual({ lat: 30.26, lng: 120.15, accuracy: 60 });
  });

  it('a good fix ends the wait of every photo waiting', async () => {
    const geo = fakeGeo();
    const t = trackPosition(geo);
    geo.report(30.3, 120.2, 400);
    const one = t.fixNow();
    const two = t.fixNow();
    geo.report(30.26, 120.15, 9);
    await expect(one).resolves.toMatchObject({ accuracy: 9 });
    await expect(two).resolves.toMatchObject({ accuracy: 9 });
  });

  it('before the phone has answered, gives it time (a permission prompt), then the short wait', async () => {
    const geo = fakeGeo();
    const t = trackPosition(geo);
    let got: DeviceFix | null | undefined;
    void t.fixNow().then((f) => (got = f));
    await vi.advanceTimersByTimeAsync(ASK_MS - 1000);
    expect(got).toBeUndefined();
    geo.report(30.3, 120.2, 90);
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    expect(got).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(got).toEqual({ lat: 30.3, lng: 120.2, accuracy: 90 });
  });

  it('gives null when the phone never answers, when it refuses, and for a fix too coarse to place a photo', async () => {
    const silent = fakeGeo();
    const a = trackPosition(silent);
    let got: DeviceFix | null | undefined;
    void a.fixNow().then((f) => (got = f));
    await vi.advanceTimersByTimeAsync(ASK_MS);
    expect(got).toBeNull();

    const no = fakeGeo();
    const b = trackPosition(no);
    const pending = b.fixNow();
    no.refuse(1);
    await expect(pending).resolves.toBeNull();
    await expect(b.fixNow()).resolves.toBeNull();
    expect(b.now()).toEqual({ state: 'refused' });

    const far = fakeGeo();
    const c = trackPosition(far);
    far.report(30.3, 120.2, COARSE_M + 1);
    const coarse = c.fixNow();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await expect(coarse).resolves.toBeNull();
  });

  it('tells its listeners about fixes and refusals', () => {
    const geo = fakeGeo();
    const t = trackPosition(geo);
    const heard = vi.fn();
    const off = t.subscribe(heard);
    geo.report(30.26, 120.15, 40);
    geo.refuse(2);
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    geo.report(30.26, 120.15, 30);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('stop ends the watch and gives waiting photos the best fix they have', async () => {
    const geo = fakeGeo();
    const t = trackPosition(geo);
    geo.report(30.3, 120.2, 200);
    const pending = t.fixNow();
    t.stop();
    await expect(pending).resolves.toEqual({ lat: 30.3, lng: 120.2, accuracy: 200 });
    expect(geo.cleared).toEqual([7]);
    // asked after the camera closed: what was last known
    await expect(t.fixNow()).resolves.toEqual({ lat: 30.3, lng: 120.2, accuracy: 200 });
  });

  it('refuses where there is no geolocation', async () => {
    const t = trackPosition(undefined);
    expect(t.now()).toEqual({ state: 'refused' });
    await expect(t.fixNow()).resolves.toBeNull();
    t.stop();
  });
});

describe('withCapture', () => {
  const fix: DeviceFix = { lat: 30.26, lng: 120.15, accuracy: 15 };
  const at = Date.UTC(2026, 10, 11, 3, 4, 5);

  it("fills in the phone's position when the file has none", () => {
    const p = exif();
    const out = withCapture(p, at, fix);
    expect(out.exif).toMatchObject({ lat: 30.26, lng: 120.15, takenAt: '2026-05-17T09:30:00', tz: '+08:00' });
    expect(out).not.toBe(p);
  });

  it("keeps the file's own position", () => {
    const p = exif({ lat: 31.3238, lng: 120.6296 });
    expect(withCapture(p, at, fix)).toBe(p);
  });

  it('half a position is no position', () => {
    expect(withCapture(exif({ lat: 31.3238 }), at, fix).exif).toMatchObject({ lat: 30.26, lng: 120.15 });
  });

  it('leaves the photo without a position when the phone gave none', () => {
    const p = exif();
    expect(withCapture(p, at, null)).toBe(p);
  });

  it('dates a photo whose file has no time from the moment it came back', () => {
    const out = withCapture(exif({ takenAt: null, tz: null }), at, null, 480);
    expect(out.exif).toMatchObject({ takenAt: '2026-11-11T11:04:05', tz: '+08:00', lat: null, lng: null });
  });
});

describe('wallClock', () => {
  it('writes local time with its offset, across midnight and west of Greenwich', () => {
    expect(wallClock(Date.UTC(2026, 11, 31, 20, 0, 0), 480)).toEqual({ takenAt: '2027-01-01T04:00:00', tz: '+08:00' });
    expect(wallClock(Date.UTC(2026, 0, 1, 2, 30, 0), -210)).toEqual({ takenAt: '2025-12-31T23:00:00', tz: '-03:30' });
    expect(wallClock(Date.UTC(2026, 5, 1, 12, 0, 0), 0)).toEqual({ takenAt: '2026-06-01T12:00:00', tz: '+00:00' });
  });
});

describe('handing photos over to the upload page', () => {
  const shot = (name: string) => ({ file: new File(['x'], name, { type: 'image/jpeg' }), at: 1, fix: Promise.resolve(null) });

  it('keeps photos until they are taken, once', () => {
    const a = shot('a.jpg');
    const b = shot('b.jpg');
    handOver(a);
    handOver(b);
    expect(takeCaptured()).toEqual([a, b]);
    expect(takeCaptured()).toEqual([]);
  });

  it('tells an open upload page, until it stops listening', () => {
    const heard = vi.fn();
    const off = onCaptured(heard);
    handOver(shot('c.jpg'));
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    handOver(shot('d.jpg'));
    expect(heard).toHaveBeenCalledTimes(1);
    takeCaptured();
  });
});

describe('pickerAccept', () => {
  const chromeAndroid =
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
  const safari =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
  const desktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

  it('asks for images only, except on Android', () => {
    expect(pickerAccept(desktop)).toBe('image/*,.heic,.heif,.avif');
    expect(pickerAccept(safari)).toBe('image/*,.heic,.heif,.avif');
  });

  it('adds a type that is not an image on Android, so the browser offers the file browser and not the photo picker', () => {
    const types = pickerAccept(chromeAndroid).split(',');
    expect(types.slice(0, 4)).toEqual(['image/*', '.heic', '.heif', '.avif']);
    const extra = types.slice(4);
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
    expect(extra[0].startsWith('image/') || extra[0].startsWith('video/')).toBe(false);
    // "application/octet-stream" would make Chrome list every file instead of images
    expect(extra[0]).not.toBe('application/octet-stream');
  });
});
