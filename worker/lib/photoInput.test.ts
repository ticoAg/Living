import { describe, expect, test } from 'vite-plus/test';
import { originalKind } from './photoInput';

// The original is stored as uploaded, so its content type and R2 key extension come from what the browser says about the file.
// HEIC is the case that matters: Chrome and Firefox upload iPhone photos they cannot decode themselves.
describe('originalKind: HEIC and HEIF originals', () => {
  test('uses the MIME type', () => {
    expect(originalKind({ type: 'image/heic', name: 'IMG_0001.HEIC' })).toEqual({ ext: 'heic', type: 'image/heic' });
    expect(originalKind({ type: 'image/heif', name: 'IMG_0001.HEIC' })).toEqual({ ext: 'heif', type: 'image/heif' });
  });

  test('ignores case and MIME parameters', () => {
    expect(originalKind({ type: 'IMAGE/HEIC; charset=binary' })).toEqual({ ext: 'heic', type: 'image/heic' });
  });

  test('falls back to the extension when the browser reports no type or a generic one (Windows, Linux)', () => {
    expect(originalKind({ type: '', name: 'IMG_0042.HEIC' })).toEqual({ ext: 'heic', type: 'image/heic' });
    expect(originalKind({ type: '', name: 'holiday.heif' })).toEqual({ ext: 'heif', type: 'image/heif' });
    expect(originalKind({ type: 'application/octet-stream', name: 'IMG_0042.heic' })).toEqual({ ext: 'heic', type: 'image/heic' });
  });

  test('still refuses files that are not images', () => {
    expect(() => originalKind({ type: 'text/plain', name: 'notes.txt' })).toThrow();
    expect(() => originalKind({ type: '', name: 'IMG_0042' })).toThrow();
  });
});
