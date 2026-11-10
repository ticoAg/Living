import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const api = vi.fn<(path: string) => Promise<unknown>>();
vi.mock('./api', () => ({ api: (path: string) => api(path) }));

/** A fresh copy of the module: the cache is module state. */
async function fresh() {
  vi.resetModules();
  return import('./useApi');
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const T0 = 1_800_000_000_000;

beforeEach(() => {
  api.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('freshness', () => {
  it('serves a fresh result from the cache without asking again', async () => {
    const { prefetch, revalidate, peek } = await fresh();
    api.mockResolvedValue({ photos: [1] });
    prefetch('/api/photos');
    await settle();
    expect(peek('/api/photos')).toMatchObject({ data: { photos: [1] }, at: T0 });
    vi.setSystemTime(T0 + 4 * 60_000);
    revalidate('/api/photos');
    prefetch('/api/photos');
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('refetches stale data in the background, showing the old data meanwhile', async () => {
    const { prefetch, revalidate, peek, STALE_MS } = await fresh();
    api.mockResolvedValueOnce({ photos: [1] });
    prefetch('/api/photos');
    await settle();
    vi.setSystemTime(T0 + STALE_MS + 1);
    let done!: (v: unknown) => void;
    api.mockReturnValueOnce(new Promise((r) => (done = r)));
    revalidate('/api/photos');
    expect(api).toHaveBeenCalledTimes(2);
    expect(peek('/api/photos')?.data).toEqual({ photos: [1] });
    revalidate('/api/photos'); // already under way
    expect(api).toHaveBeenCalledTimes(2);
    done({ photos: [1, 2] });
    await settle();
    expect(peek('/api/photos')).toMatchObject({ data: { photos: [1, 2] }, at: T0 + STALE_MS + 1 });
  });

  it('keeps the old data when a background refetch fails, and tries again next time', async () => {
    const { prefetch, revalidate, peek, STALE_MS } = await fresh();
    api.mockResolvedValueOnce({ photos: [1] });
    prefetch('/api/photos');
    await settle();
    vi.setSystemTime(T0 + STALE_MS);
    api.mockRejectedValueOnce(new TypeError('offline'));
    revalidate('/api/photos');
    await settle();
    expect(peek('/api/photos')).toEqual({ data: { photos: [1] }, at: T0 });
    api.mockResolvedValueOnce({ photos: [2] });
    revalidate('/api/photos');
    await settle();
    expect(api).toHaveBeenCalledTimes(3);
    expect(peek('/api/photos')?.data).toEqual({ photos: [2] });
  });

  it('retries a failed request on the next mount instead of keeping the error', async () => {
    const { revalidate, peek } = await fresh();
    const boom = new Error('500');
    api.mockRejectedValueOnce(boom);
    revalidate('/api/tags');
    await settle();
    expect(peek('/api/tags')).toEqual({ error: boom });
    api.mockResolvedValueOnce({ tags: [] });
    revalidate('/api/tags');
    await settle();
    expect(peek('/api/tags')).toMatchObject({ data: { tags: [] } });
  });

  it('counts setCached as fresh', async () => {
    const { setCached, revalidate, STALE_MS } = await fresh();
    setCached('/api/photos/ph_1', { id: 'ph_1' });
    revalidate('/api/photos/ph_1');
    expect(api).not.toHaveBeenCalled();
    vi.setSystemTime(T0 + STALE_MS);
    api.mockResolvedValue({ id: 'ph_1' });
    revalidate('/api/photos/ph_1');
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('on returning to the tab, refreshes only stale paths that a mounted component reads', async () => {
    const { prefetch, revalidateMounted, STALE_MS } = await fresh();
    api.mockResolvedValue({});
    prefetch('/api/photos'); // cached, but no component reads it
    await settle();
    vi.setSystemTime(T0 + STALE_MS);
    revalidateMounted();
    expect(api).toHaveBeenCalledTimes(1);
  });
});

describe('invalidate', () => {
  it('drops unmounted paths under the prefix, so the next read asks again', async () => {
    const { prefetch, invalidate, peek } = await fresh();
    api.mockResolvedValue({});
    prefetch('/api/photos');
    prefetch('/api/photos?mine=1');
    prefetch('/api/tags');
    await settle();
    invalidate('/api/photos');
    expect(peek('/api/photos')).toBeUndefined();
    expect(peek('/api/photos?mine=1')).toBeUndefined();
    expect(peek('/api/tags')).toBeDefined();
    prefetch('/api/photos');
    expect(api).toHaveBeenCalledTimes(4);
  });
});
