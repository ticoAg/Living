import { useEffect, useMemo } from 'react';
import type { Poi, PhotoSummary, Tag } from '../../shared/types';
import { invalidate, useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import { buildTagTree, type TagTree } from '../lib/tags';

// Typed readers over the shared GET cache for the endpoints the browse pages use.

export const enc = encodeURIComponent;

/** Some endpoints document a bare object and some an envelope; accept both. */
export function unwrap<T extends object>(data: unknown, key: string): T | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const inner = (data as Record<string, unknown>)[key];
  return (inner && typeof inner === 'object' ? inner : data) as T;
}

// Lists depend on who is asking (own tags, own unlisted photos). When the signed-in user changes,
// drop the cached lists so the next render refetches them with the new cookie.
let lastUser: string | null | undefined;
function useFreshPerUser() {
  const { user, loading } = useSession();
  const id = user?.id ?? null;
  useEffect(() => {
    if (loading) return;
    if (lastUser !== undefined && lastUser !== id) {
      for (const prefix of ['/api/photos', '/api/tags', '/api/pois', '/api/themes', '/api/users']) invalidate(prefix);
    }
    lastUser = id;
  }, [id, loading]);
}

/**
 * Photo lists. `query` is the part after `?`: '' = all public photos, 'owner=alice', 'poi=poi_x'.
 * Pass null to skip the request.
 */
export function usePhotoList(query: string | null) {
  useFreshPerUser();
  const r = useApi<{ photos: PhotoSummary[] }>(query === null ? null : `/api/photos${query ? `?${query}` : ''}`);
  return { photos: r.data?.photos, error: r.error, reload: r.reload };
}

/** Tag tree: presets plus the requester's own tags, or the given owner's. */
export function useTagTree(owner?: string | null, skip = false) {
  useFreshPerUser();
  const r = useApi<{ tags: Tag[] }>(skip ? null : owner ? `/api/tags?owner=${enc(owner)}` : '/api/tags');
  const tags = r.data?.tags;
  const tree = useMemo<TagTree | undefined>(() => (tags ? buildTagTree(tags) : undefined), [tags]);
  return { tags, tree, error: r.error };
}

/** POIs that have visible photos, with their photo counts. */
export function usePoiList(owner?: string | null) {
  useFreshPerUser();
  const r = useApi<{ pois: Poi[] }>(owner ? `/api/pois?owner=${enc(owner)}` : '/api/pois');
  const pois = r.data?.pois;
  const byId = useMemo(() => new Map<string, Poi>((pois ?? []).map((p) => [p.id, p])), [pois]);
  return { pois, byId, error: r.error, reload: r.reload };
}
