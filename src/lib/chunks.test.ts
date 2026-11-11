import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

/** A fresh copy of the module (it keeps per-tab state) with a stand-in sessionStorage and location. */
async function fresh(storage: Map<string, string> | null = new Map()) {
  vi.resetModules();
  const assign = vi.fn();
  vi.stubGlobal('location', { href: 'https://living.example/upload', assign });
  vi.stubGlobal(
    'sessionStorage',
    storage
      ? { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) }
      : {
          getItem: () => {
            throw new Error('blocked');
          },
          setItem: () => {
            throw new Error('blocked');
          }
        }
  );
  return { ...(await import('./chunks')), assign, storage };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('isChunkError', () => {
  it('recognises a failed page import in each engine, and a missing page stylesheet', async () => {
    const { isChunkError } = await fresh();
    for (const message of [
      'Failed to fetch dynamically imported module: https://living.example/assets/Upload-x.js',
      'error loading dynamically imported module: https://living.example/assets/Upload-x.js',
      'Importing a module script failed.',
      'Unable to preload CSS for /assets/studio-x.css'
    ]) {
      expect(isChunkError(new TypeError(message)), message).toBe(true);
    }
  });

  it('leaves other errors to the error state', async () => {
    const { isChunkError } = await fresh();
    expect(isChunkError(new Error('boom'))).toBe(false);
    expect(isChunkError(null)).toBe(false);
    expect(isChunkError('Failed to fetch dynamically imported module')).toBe(false);
  });
});

describe('reloadOnce', () => {
  it('loads the page from the server once, then refuses for a minute', async () => {
    const { reloadOnce, assign } = await fresh();
    expect(reloadOnce(undefined, 1_000_000)).toBe(true);
    expect(assign).toHaveBeenCalledWith('https://living.example/upload');
    // a second failure while the load is under way still counts as reloading
    expect(reloadOnce(undefined, 1_000_100)).toBe(true);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it('after the reload, a chunk that still fails ends on the error state', async () => {
    const storage = new Map<string, string>();
    await fresh(storage).then(({ reloadOnce }) => reloadOnce('https://living.example/upload', 1_000_000));
    // the new page: same tab, so the same sessionStorage
    const { reloadOnce, assign } = await fresh(storage);
    expect(reloadOnce(undefined, 1_000_000 + 5_000)).toBe(false);
    expect(assign).not.toHaveBeenCalled();
    // much later (another deploy), it may reload again
    expect(reloadOnce(undefined, 1_000_000 + 61_000)).toBe(true);
  });

  it('does not reload without sessionStorage, since nothing could stop a loop', async () => {
    const { reloadOnce, assign } = await fresh(null);
    expect(reloadOnce()).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it('handles failures again if the user stayed on the page', async () => {
    const storage = new Map<string, string>();
    const { reloadOnce } = await fresh(storage);
    expect(reloadOnce(undefined, 1_000_000)).toBe(true);
    vi.advanceTimersByTime(5_000);
    // no longer "reloading"; inside the minute, so the caller shows the error state
    expect(reloadOnce(undefined, 1_010_000)).toBe(false);
  });
});
