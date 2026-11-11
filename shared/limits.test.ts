import { describe, expect, it } from 'vite-plus/test';
import { ACCOUNT_LIMITS, HANDLE_RE } from './limits';

describe('HANDLE_RE', () => {
  it('spans the handle length range', () => {
    expect(HANDLE_RE.test('a'.repeat(ACCOUNT_LIMITS.handleMin))).toBe(true);
    expect(HANDLE_RE.test('a'.repeat(ACCOUNT_LIMITS.handleMax))).toBe(true);
    expect(HANDLE_RE.test('a'.repeat(ACCOUNT_LIMITS.handleMin - 1))).toBe(false);
    expect(HANDLE_RE.test('a'.repeat(ACCOUNT_LIMITS.handleMax + 1))).toBe(false);
  });

  it('starts with a letter or digit and allows _ and - after it', () => {
    expect(HANDLE_RE.test('song_li-2')).toBe(true);
    expect(HANDLE_RE.test('_song')).toBe(false);
    expect(HANDLE_RE.test('-song')).toBe(false);
    expect(HANDLE_RE.test('so ng')).toBe(false);
    expect(HANDLE_RE.test('宋丽丽')).toBe(false);
  });
});
