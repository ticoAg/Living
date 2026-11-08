import { describe, expect, it } from 'vite-plus/test';
import { ApiError } from '../lib/api';
import { encodeNext, errMsg, fmtBytes, fmtStamp, safeNext, uid } from './util';

describe('safeNext', () => {
  it('keeps a path inside the site', () => {
    for (const ok of [
      '/',
      '/upload',
      '/studio/photo/ph_1',
      '/@ada',
      '/map?city=%E6%9D%AD%E5%B7%9E',
      '/themes/th_1#day-2',
      '/loginx',
      '/registered'
    ]) {
      expect(safeNext(ok), ok).toBe(ok);
    }
  });

  it('is null when there is nothing to go back to', () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext('')).toBeNull();
  });

  it('refuses anything that could leave the site', () => {
    for (const bad of [
      'https://evil.example',
      'http://evil.example/upload',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      'data:text/html,hi',
      'upload',
      'evil.example/upload',
      ' /upload'
    ]) {
      expect(safeNext(bad), bad).toBeNull();
    }
  });

  it('refuses the sign-in pages themselves, which would loop', () => {
    for (const bad of ['/login', '/login/', '/login?next=/upload', '/register', '/register/', '/register?next=/upload']) {
      expect(safeNext(bad), bad).toBeNull();
    }
  });
});

describe('encodeNext', () => {
  it('escapes everything but the slashes, so the address reads /login?next=/upload', () => {
    expect(encodeNext('/upload')).toBe('/upload');
    expect(encodeNext('/studio/photo/ph_1?tab=tags&x=1#top')).toBe('/studio/photo/ph_1%3Ftab%3Dtags%26x%3D1%23top');
    expect(encodeNext('/@ada')).toBe('/%40ada');
  });

  it('survives a round trip through the query string and safeNext', () => {
    for (const path of ['/upload', '/studio/photo/ph_1?tab=tags&x=1', '/@ada/themes', '/map?city=杭州&tags=a,b']) {
      const query = new URLSearchParams(`next=${encodeNext(path)}`);
      expect(safeNext(query.get('next')), path).toBe(path);
    }
  });
});

describe('fmtBytes', () => {
  it('writes bytes, kilobytes and megabytes', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(1023)).toBe('1023 B');
    expect(fmtBytes(1024)).toBe('1 KB');
    expect(fmtBytes(1536)).toBe('2 KB');
    expect(fmtBytes(300 * 1024)).toBe('300 KB');
    expect(fmtBytes(1024 * 1024)).toBe('1.0 MB');
  });

  it('shows one decimal below 10 MB and whole megabytes from there', () => {
    expect(fmtBytes(5.5 * 1024 * 1024)).toBe('5.5 MB');
    expect(fmtBytes(9.9 * 1024 * 1024)).toBe('9.9 MB');
    expect(fmtBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(fmtBytes(49.6 * 1024 * 1024)).toBe('50 MB');
  });
});

describe('fmtStamp', () => {
  it('writes a capture time as date and minutes', () => {
    expect(fmtStamp('2026-11-08T14:22:05')).toBe('2026.11.08 14:22');
    expect(fmtStamp('2026-01-02T00:00:00')).toBe('2026.01.02 00:00');
  });

  it('is empty without one', () => {
    expect(fmtStamp(null)).toBe('');
    expect(fmtStamp(undefined)).toBe('');
    expect(fmtStamp('')).toBe('');
  });
});

describe('errMsg', () => {
  it('shows the server’s message for an API error, or the fallback when it has none', () => {
    expect(errMsg(new ApiError(409, 'duplicate', '这张照片已经上传过了'))).toBe('这张照片已经上传过了');
    expect(errMsg(new ApiError(500, 'internal', ''), '保存失败')).toBe('保存失败');
  });

  it('says "cancelled" for an aborted request', () => {
    expect(errMsg(new DOMException('The operation was aborted', 'AbortError'))).toBe('已取消');
  });

  it('blames the network for a failed fetch', () => {
    expect(errMsg(new TypeError('Failed to fetch'))).toBe('网络不通，请检查网络后重试');
  });

  it('uses the message of other errors, and the fallback for the rest', () => {
    expect(errMsg(new Error('图片太大'))).toBe('图片太大');
    expect(errMsg(new Error(''), '处理失败')).toBe('处理失败');
    expect(errMsg('boom')).toBe('出错了，请稍后再试');
    expect(errMsg(undefined, '自定义')).toBe('自定义');
    expect(errMsg(null)).toBe('出错了，请稍后再试');
  });
});

describe('uid', () => {
  it('never repeats', () => {
    const ids = new Set(Array.from({ length: 500 }, () => uid()));
    expect(ids.size).toBe(500);
  });

  it('is a short token usable as a DOM id', () => {
    expect(uid()).toMatch(/^q[0-9a-z]+$/);
  });
});
