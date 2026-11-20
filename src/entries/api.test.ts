import { describe, expect, it } from 'vite-plus/test';
import { PHOTO_IDS_LIMIT } from '../../shared/types';
import { photoIdPaths } from './api';

describe('photoIdPaths', () => {
  it('asks for each photo once, in parts of at most PHOTO_IDS_LIMIT, sorted so the same ids make the same requests', () => {
    const ids = Array.from({ length: PHOTO_IDS_LIMIT + 3 }, (_, i) => `ph_${String(i).padStart(3, '0')}`);
    const paths = photoIdPaths([...ids].reverse().concat(ids.slice(0, 5)));
    expect(paths).toHaveLength(2);
    const asked = paths.map((p) => new URL(p, 'https://x').searchParams.get('ids')?.split(',') ?? []);
    expect(asked.map((a) => a.length)).toEqual([PHOTO_IDS_LIMIT, 3]);
    expect(asked.flat()).toEqual(ids);
    expect(paths[0].startsWith('/api/photos?ids=ph_000,ph_001,')).toBe(true);
    expect(photoIdPaths(ids)).toEqual(paths);
  });

  it('asks for nothing without ids', () => {
    expect(photoIdPaths([])).toEqual([]);
  });
});
