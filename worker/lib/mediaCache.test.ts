import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Variants } from '../../shared/types';
import { mediaCacheKey, purgeVariantCache } from './mediaCache';

const variants: Variants = {
  s: { key: 'v/ph_1/s.webp', w: 480, h: 360 },
  m: { key: 'v/ph_1/m.webp', w: 1600, h: 1200 },
  l: { key: 'v/ph_1/l.jpg', w: 2560, h: 1920 }
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mediaCacheKey', () => {
  it('is a GET request for the public media URL, without query or fragment', () => {
    const key = mediaCacheKey('https://living.example', 'v/ph_1/s.webp');
    expect(key).toBeInstanceOf(Request);
    expect(key.method).toBe('GET');
    expect(key.url).toBe('https://living.example/media/v/ph_1/s.webp');
  });
});

describe('purgeVariantCache', () => {
  it('removes each size of a photo from the edge cache under its media URL', async () => {
    const remove = vi.fn(async (request: Request) => request.method === 'GET');
    vi.stubGlobal('caches', { default: { delete: remove } });
    await purgeVariantCache('https://living.example', variants);
    expect(remove).toHaveBeenCalledTimes(3);
    const urls = remove.mock.calls.map(([request]) => request.url).sort();
    expect(urls).toEqual([
      'https://living.example/media/v/ph_1/l.jpg',
      'https://living.example/media/v/ph_1/m.webp',
      'https://living.example/media/v/ph_1/s.webp'
    ]);
  });

  it('does nothing for a photo without variants', async () => {
    const remove = vi.fn(async (request: Request) => request.method === 'GET');
    vi.stubGlobal('caches', { default: { delete: remove } });
    await purgeVariantCache('https://living.example', null);
    expect(remove).not.toHaveBeenCalled();
  });

  it('never fails the request that triggered it, whatever the Cache API does', async () => {
    vi.stubGlobal('caches', {
      default: {
        delete: async () => {
          throw new Error('cache unavailable');
        }
      }
    });
    await expect(purgeVariantCache('https://living.example', variants)).resolves.toBeUndefined();
  });

  it('copes with a runtime that has no Cache API at all', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(purgeVariantCache('https://living.example', variants)).resolves.toBeUndefined();
  });
});
