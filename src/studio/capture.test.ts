import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  ASK_MS,
  COARSE_M,
  GIVE_UP_MS,
  handOver,
  onCaptured,
  pickerAccept,
  SETTLE_MS,
  startLocating,
  takeCaptured,
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
