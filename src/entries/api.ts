import { useMemo } from 'react';
import { PHOTO_IDS_LIMIT, type EntryListResponse, type PhotoListResponse, type PhotoSummary, type Tag } from '../../shared/types';
import { useApi, useApiEach } from '../lib/useApi';

// Typed readers over the shared GET cache for the entry pages. The lists are read whole, like the photo lists: there
// is no paging below ENTRY_LIST_LIMIT, and filtering happens here.

/** The signed-in author's own entries, every status; null skips the request. */
export const MY_ENTRIES = '/api/entries?mine=1';
export const MY_PHOTOS = '/api/photos?mine=1';

export function useEntryList(path: string | null) {
  const r = useApi<EntryListResponse>(path);
  return { entries: r.data?.entries, truncated: r.data?.truncated === true, error: r.error, reload: r.reload };
}

/** A photo list by id, for the thumbnails of entries. */
export function usePhotoMap(path: string | null) {
  const r = useApi<PhotoListResponse>(path);
  const photos = r.data?.photos;
  const byId = useMemo(() => new Map<string, PhotoSummary>((photos ?? []).map((p) => [p.id, p])), [photos]);
  return { photos, byId, truncated: r.data?.truncated === true, error: r.error, reload: r.reload };
}

/** The paths that ask for these photos, PHOTO_IDS_LIMIT at a time; sorted, so the same ids are the same requests. */
export function photoIdPaths(ids: Iterable<string>): string[] {
  const sorted = [...new Set(ids)].sort();
  const paths: string[] = [];
  for (let i = 0; i < sorted.length; i += PHOTO_IDS_LIMIT) paths.push(`/api/photos?ids=${sorted.slice(i, i + PHOTO_IDS_LIMIT).join(',')}`);
  return paths;
}

/**
 * Photos by id, as many as asked for: the ones the viewer may open (an entry's). `done` once every part has
 * answered or one failed.
 */
export function usePhotosById(ids: readonly string[]) {
  const paths = useMemo(() => photoIdPaths(ids), [ids]);
  const r = useApiEach<PhotoListResponse>(paths);
  const byId = useMemo(() => new Map<string, PhotoSummary>(r.data.flatMap((d) => d?.photos ?? []).map((p) => [p.id, p])), [r.data]);
  return { byId, done: r.error !== undefined || r.data.every((d) => d !== undefined), error: r.error, reload: r.reload };
}

export function useTagMap(path: string | null = '/api/tags') {
  const r = useApi<{ tags: Tag[] }>(path);
  const tags = r.data?.tags;
  const byId = useMemo(() => new Map<string, Tag>((tags ?? []).map((t) => [t.id, t])), [tags]);
  return { tags, byId };
}
