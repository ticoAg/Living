import { describe, expect, it } from 'vite-plus/test';
import { expiryText, shareUrl, targetPath, targetReads } from './api';

describe('share link helpers', () => {
  it('make the address to hand out', () => {
    expect(shareUrl('abcdefghijklmnopqrstuvwx', 'https://living.example')).toBe('https://living.example/s/abcdefghijklmnopqrstuvwx');
  });

  it('open each kind where it is read, and forget what was read without the link', () => {
    expect(targetPath('entry', 'en_1')).toBe('/e/en_1');
    expect(targetPath('theme', 'th_1')).toBe('/t/th_1');
    expect(targetPath('project', 'pj_1')).toBe('/projects/pj_1');
    expect(targetReads('project', 'pj_1')).toEqual(['/api/projects/pj_1', '/api/entries?project=pj_1']);
  });

  it('say until when a link opens', () => {
    const now = Date.parse('2026-11-17T04:00:00Z');
    expect(expiryText(null, now)).toEqual({ text: '不过期', expired: false });
    expect(expiryText('2026-11-17T03:59:59Z', now)).toEqual({ text: '已过期', expired: true });
    expect(expiryText('2026-11-17T04:00:00Z', now).expired).toBe(true);
    const later = expiryText('2026-11-24T04:00:00Z', now);
    expect(later.expired).toBe(false);
    expect(later.text).toMatch(/^2026\.11\.2[34] \d{2}:00 前有效$/);
  });
});
