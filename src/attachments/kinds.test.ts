import { describe, expect, it } from 'vite-plus/test';
import { attachmentFacts, attachmentsLabel, attachProblem, fitName, fmtDuration, kindOf, typeOf } from './kinds';

const f = (name: string, type = '', size = 1) => ({ name, type, size });

describe('a picked file', () => {
  it('has the type the browser names, or one by its extension when it names none', () => {
    expect(typeOf(f('a.mov', 'video/quicktime'))).toBe('video/quicktime');
    expect(typeOf(f('a.webm', 'audio/webm;codecs=opus'))).toBe('audio/webm');
    expect(typeOf(f('a.MKV'))).toBe('video/x-matroska');
    expect(typeOf(f('a.m4a', 'application/octet-stream'))).toBe('audio/mp4');
    expect(typeOf(f('a.xyz', 'application/octet-stream'))).toBe('application/octet-stream');
    expect(typeOf(f('README'))).toBe('');
  });

  it('is a video, a sound, a picture, or any other file', () => {
    expect(kindOf(f('a.mp4', 'video/mp4'))).toBe('video');
    expect(kindOf(f('a.3gp'))).toBe('video');
    expect(kindOf(f('录音.m4a', 'audio/x-m4a'))).toBe('audio');
    expect(kindOf(f('a.HEIC'))).toBe('image');
    expect(kindOf(f('a.png', 'image/png'))).toBe('image');
    expect(kindOf(f('a.pdf', 'application/pdf'))).toBe('file');
    expect(kindOf(f('notes.txt', 'text/plain'))).toBe('file');
  });

  it('is refused as a picture, empty, or over 2 GB', () => {
    expect(attachProblem(f('a.jpg', 'image/jpeg'))).toContain('照片');
    expect(attachProblem(f('a.pdf', 'application/pdf', 0))).toBe('文件是空的');
    expect(attachProblem(f('a.mp4', 'video/mp4', 2 * 1024 ** 3 + 1))).toBe('一个附件最多 2 GB');
    expect(attachProblem(f('a.mp4', 'video/mp4', 2 * 1024 ** 3))).toBeNull();
  });

  it('keeps its name, cut before the extension when too long', () => {
    expect(fitName(' 湖边.mp4 ')).toBe('湖边.mp4');
    expect(fitName('')).toBe('附件');
    const long = `${'长'.repeat(300)}.MOV`;
    expect([...fitName(long)]).toHaveLength(200);
    expect(fitName(long).endsWith('长.MOV')).toBe(true);
    expect([...fitName('长'.repeat(300))]).toHaveLength(200);
  });
});

describe('an attachment in a list', () => {
  it('says how long it runs, as a clock does', () => {
    expect(fmtDuration(7.4)).toBe('0:07');
    expect(fmtDuration(185)).toBe('3:05');
    expect(fmtDuration(3723)).toBe('1:02:03');
    expect(fmtDuration(-1)).toBe('0:00');
  });

  it('are counted by kind', () => {
    expect(attachmentsLabel([{ kind: 'audio' }, { kind: 'video' }, { kind: 'video' }])).toBe('2 个视频，1 段音频');
    expect(attachmentsLabel([{ kind: 'file' }])).toBe('1 个文件');
    expect(attachmentsLabel([])).toBe('');
  });

  it('says its length and size', () => {
    expect(attachmentFacts({ size: 3_000_000, duration: 12.5 })).toBe('0:13 · 2.9 MB');
    expect(attachmentFacts({ size: 900, duration: null })).toBe('900 B');
  });
});
