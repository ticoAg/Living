import { describe, expect, it } from 'vite-plus/test';
import { CAMERA_PROBLEM_TEXT, cameraProblemOf, shotFile, shotName, videoConstraints } from './camera';

describe('cameraProblemOf', () => {
  const named = (name: string) => Object.assign(new Error('x'), { name });

  it('reads what went wrong from the name of the error', () => {
    expect(cameraProblemOf(named('NotAllowedError'))).toBe('denied');
    expect(cameraProblemOf(named('SecurityError'))).toBe('denied');
    expect(cameraProblemOf(named('NotFoundError'))).toBe('missing');
    expect(cameraProblemOf(named('OverconstrainedError'))).toBe('missing');
    expect(cameraProblemOf(named('NotReadableError'))).toBe('busy');
    expect(cameraProblemOf(named('AbortError'))).toBe('busy');
  });

  it('calls anything else a failure', () => {
    expect(cameraProblemOf(named('TypeError'))).toBe('failed');
    expect(cameraProblemOf('nope')).toBe('failed');
    expect(cameraProblemOf(null)).toBe('failed');
  });

  it('has words for every problem', () => {
    for (const p of ['unsupported', 'denied', 'missing', 'busy', 'failed'] as const) expect(CAMERA_PROBLEM_TEXT[p]).toMatch(/。$/);
  });
});

describe('videoConstraints', () => {
  it('asks for a modest 4:3 preview when stills come from the sensor', () => {
    const c = videoConstraints('environment', true);
    expect(c.facingMode).toEqual({ ideal: 'environment' });
    expect(c.width).toEqual({ ideal: 1920 });
    expect(c.height).toEqual({ ideal: 1440 });
    expect(c.aspectRatio).toEqual({ ideal: 4 / 3 });
  });

  it('asks for the largest preview when the photo is a frame of it', () => {
    const c = videoConstraints('user', false);
    expect(c.facingMode).toEqual({ ideal: 'user' });
    expect(c.width).toEqual({ ideal: 4096 });
    expect(c.height).toEqual({ ideal: 3072 });
  });

  it('only states preferences, so a camera that cannot meet them still opens', () => {
    for (const v of Object.values(videoConstraints('environment', true))) expect(Object.keys(v as object)).toEqual(['ideal']);
  });
});

describe('shotName', () => {
  const at = Date.UTC(2026, 10, 11, 3, 30, 45, 7);

  it('names a photo by local date and time, to the millisecond', () => {
    expect(shotName(at, 'image/jpeg', 480)).toBe('IMG_20261111_113045_007.jpg');
    expect(shotName(at, 'image/jpeg', -300)).toBe('IMG_20261110_223045_007.jpg');
  });

  it('two shots in the same second get different names', () => {
    expect(shotName(at, 'image/jpeg', 480)).not.toBe(shotName(at + 250, 'image/jpeg', 480));
  });

  it('takes the extension from the type of the still', () => {
    expect(shotName(at, 'image/png', 0)).toMatch(/\.png$/);
    expect(shotName(at, 'image/webp', 0)).toMatch(/\.webp$/);
    expect(shotName(at, '', 0)).toMatch(/\.jpg$/);
    expect(shotName(at, 'application/octet-stream', 0)).toMatch(/\.jpg$/);
  });
});

describe('shotFile', () => {
  it('wraps the still as an image file dated when it was taken', () => {
    const at = Date.UTC(2026, 10, 11, 3, 30, 45);
    const f = shotFile(new Blob(['abc'], { type: 'image/jpeg' }), at);
    expect(f.type).toBe('image/jpeg');
    expect(f.size).toBe(3);
    expect(f.lastModified).toBe(at);
    expect(f.name).toMatch(/^IMG_\d{8}_\d{6}_\d{3}\.jpg$/);
  });

  it('calls a still without a type a JPEG, so the upload page takes it for an image', () => {
    expect(shotFile(new Blob(['abc']), 0).type).toBe('image/jpeg');
  });
});
