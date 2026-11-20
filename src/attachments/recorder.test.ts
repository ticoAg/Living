import { describe, expect, it } from 'vite-plus/test';
import { recordError, recordingFormat, recordingName } from './recorder';

describe('recordings', () => {
  it('are made in the first format the browser records', () => {
    expect(recordingFormat(() => true)).toBe('audio/webm;codecs=opus');
    expect(recordingFormat((t) => t === 'audio/mp4' || t === 'audio/webm')).toBe('audio/mp4');
    expect(recordingFormat(() => false)).toBeNull();
  });

  it('are named by when they began, as files of their format', () => {
    const at = new Date(2026, 4, 1, 14, 3, 59);
    expect(recordingName(at, 'audio/webm;codecs=opus')).toBe('录音 2026-05-01 14.03.webm');
    expect(recordingName(at, 'audio/mp4')).toBe('录音 2026-05-01 14.03.m4a');
    expect(recordingName(at, 'audio/ogg; codecs=opus')).toBe('录音 2026-05-01 14.03.ogg');
    expect(recordingName(at, '')).toBe('录音 2026-05-01 14.03.webm');
  });

  it('say why they could not start', () => {
    const err = (name: string) => Object.assign(new Error('x'), { name });
    expect(recordError(err('NotAllowedError'))).toContain('许可');
    expect(recordError(err('NotFoundError'))).toBe('没有找到麦克风');
    expect(recordError(err('NotReadableError'))).toContain('占用');
    expect(recordError(new TypeError('x'))).toBe('这个浏览器不能录音');
  });
});
