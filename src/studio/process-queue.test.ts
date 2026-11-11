import { describe, expect, it } from 'vite-plus/test';
import { isHeavy, nextToProcess, processLimit } from './process-queue';

describe('processLimit', () => {
  it('is two, whatever the computer', () => {
    expect(processLimit({ cores: 16, memory: 8 })).toBe(2);
    expect(processLimit({ cores: 4 })).toBe(2);
    expect(processLimit({})).toBe(2);
  });

  it('is one on devices that say they are very small', () => {
    expect(processLimit({ cores: 8, memory: 2 })).toBe(1);
    expect(processLimit({ cores: 2, memory: 8 })).toBe(1);
    expect(processLimit({ memory: 1 })).toBe(1);
  });
});

const jpg = (name: string, size = 5e6) => ({ name, type: 'image/jpeg', size });
const q = (id: string, stage: string, file = jpg(`${id}.jpg`)) => ({ id, stage, file });

describe('isHeavy', () => {
  it('is HEIC/HEIF by name or type, and very large files', () => {
    expect(isHeavy(jpg('IMG_1.HEIC'))).toBe(true);
    expect(isHeavy({ name: 'a', type: 'image/heif', size: 1 })).toBe(true);
    expect(isHeavy(jpg('DSCF1.hif'))).toBe(true);
    expect(isHeavy(jpg('big.jpg', 40e6))).toBe(true);
    expect(isHeavy(jpg('a.jpg'))).toBe(false);
  });
});

describe('nextToProcess', () => {
  it('fills the free places with queued photos in order', () => {
    const items = [q('a', 'ready'), q('b', 'processing'), q('c', 'queued'), q('d', 'queued'), q('e', 'queued')];
    expect(nextToProcess(items, new Set(['b']), 3).map((i) => i.id)).toEqual(['c', 'd']);
    expect(nextToProcess(items, new Set(['b', 'c', 'd']), 3)).toEqual([]);
    expect(nextToProcess(items, new Set(), 2).map((i) => i.id)).toEqual(['c', 'd']);
  });

  it('never starts a photo that is already running', () => {
    const items = [q('a', 'queued'), q('b', 'queued')];
    expect(nextToProcess(items, new Set(['a']), 2).map((i) => i.id)).toEqual(['b']);
  });

  it('reads heavy files one at a time, letting light ones pass', () => {
    const heic = (id: string) => q(id, 'queued', jpg(`${id}.heic`));
    const items = [heic('h1'), heic('h2'), q('j', 'queued')];
    expect(nextToProcess(items, new Set(), 3).map((i) => i.id)).toEqual(['h1', 'j']);
    const running = [{ ...heic('h1'), stage: 'processing' }, heic('h2'), q('j', 'queued')];
    expect(nextToProcess(running, new Set(['h1']), 3).map((i) => i.id)).toEqual(['j']);
  });
});
