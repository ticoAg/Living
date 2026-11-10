import { useEffect, useMemo, useRef } from 'react';
import type { PhotoSummary, Poi, Tag, ThemeDetail } from '../../shared/types';
import { buildTagTree } from '../lib/tags';
import { useApi } from '../lib/useApi';
import { buildPlaylist } from './playlist';
import type { Settings, Source } from './settings';

const EMPTY: PhotoSummary[] = [];

type PhotosResponse = { photos: PhotoSummary[] };

/** Detail endpoints are documented as the bare object while writes return `{ photo }`; accept both. */
export function unwrap<T>(data: unknown, key: string): T | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const inner = (data as Record<string, unknown>)[key];
  return (inner && typeof inner === 'object' ? inner : data) as T;
}

function photosPath(s: Source): string | null {
  if (s.src === 'theme') return null;
  const q = new URLSearchParams();
  if (s.user) q.set('owner', s.user);
  if (s.src === 'place' && s.place) q.set('poi', s.place);
  const qs = q.toString();
  return `/api/photos${qs ? `?${qs}` : ''}`;
}

interface Options {
  source: Source;
  settings: Settings;
  /** the drawer has been opened: its tag chips need the tag list */
  drawerEverOpened: boolean;
  /** photo to start from (`start=`), or '' */
  startId: string;
  /** shuffle seed for this visit */
  seed: number;
  /** local date, `YYYY-MM-DD`; the list is refetched and 那年今日 rebuilt when it changes */
  today: string;
}

/**
 * What Living plays: the photo list (or the theme's photos), tags and places for the captions and the drawer, the
 * "start from" photo when the list does not contain it, and the playlist built from them.
 */
export function useLivingData({ source, settings, drawerEverOpened, startId, seed, today }: Options) {
  const needTags = source.src === 'tags' || settings.fields.includes('tags') || drawerEverOpened;
  const ownerQ = source.user ? `?owner=${encodeURIComponent(source.user)}` : '';
  const listPath = photosPath(source);
  const photosRes = useApi<PhotosResponse>(listPath);
  const themeRes = useApi<unknown>(source.src === 'theme' ? `/api/themes/${encodeURIComponent(source.theme)}` : null);
  const tagsRes = useApi<{ tags: Tag[] }>(needTags ? `/api/tags${ownerQ}` : null);
  const poisRes = useApi<{ pois: Poi[] }>(`/api/pois${ownerQ}`);

  const theme = useMemo(() => unwrap<ThemeDetail>(themeRes.data, 'theme'), [themeRes.data]);
  const themeTitle = useRef('');
  if (theme?.title) themeTitle.current = theme.title;
  const themePhotos = useMemo(() => theme?.items?.flatMap((it) => (it.kind === 'photo' && it.photo ? [it.photo] : [])), [theme]);
  const listed = source.src === 'theme' ? themePhotos : photosRes.data?.photos;

  // Keep the last good list while a refresh is in flight, so a midnight reload never blanks the screen.
  const listKey = source.src === 'theme' ? `theme:${source.theme}` : listPath;
  const good = useRef<{ key: string | null; photos: PhotoSummary[] }>({ key: null, photos: EMPTY });
  if (listed) good.current = { key: listKey, photos: listed };
  const photos = listed ?? (good.current.key === listKey ? good.current.photos : undefined);

  // "Start from this photo" can name one that is not in the list (unlisted, or beyond the 5000 cap).
  const canBorrowStart = !!startId && source.src === 'all' && !source.city && !source.user;
  const startListed = !startId || (!!photos && photos.some((p) => p.id === startId));
  const needStart = canBorrowStart && !!photos && !startListed;
  const startRes = useApi<unknown>(needStart ? `/api/photos/${encodeURIComponent(startId)}` : null);
  const startPending = needStart && !startRes.data && !startRes.error;
  const startPhoto = useMemo(() => {
    const p = unwrap<PhotoSummary>(startRes.data, 'photo');
    return p && p.id === startId && p.variants ? p : undefined;
  }, [startRes.data, startId]);
  const pool = useMemo(() => (photos && startPhoto && needStart ? [startPhoto, ...photos] : photos), [photos, startPhoto, needStart]);

  const activeRes = source.src === 'theme' ? themeRes : photosRes;
  const tagsPending = source.src === 'tags' && source.tags.length > 0 && !tagsRes.data && !tagsRes.error;
  const status: 'loading' | 'error' | 'ready' =
    !pool && activeRes.error ? 'error' : pool && !tagsPending && !startPending ? 'ready' : 'loading';

  const tree = useMemo(() => (tagsRes.data?.tags ? buildTagTree(tagsRes.data.tags) : null), [tagsRes.data]);
  const poiById = useMemo(() => new Map((poisRes.data?.pois ?? []).map((p) => [p.id, p] as const)), [poisRes.data]);

  const playlist = useMemo(
    () =>
      status === 'ready' && pool ? buildPlaylist({ photos: pool, source, tree, seed, today: new Date(`${today}T00:00`), startId }) : EMPTY,
    // the "那年今日" list rolls over at midnight, when `today` changes
    [status, pool, source, tree, seed, startId, today]
  );

  // A photo frame left running picks up new uploads once a day.
  const reloadList = activeRes.reload;
  const seenDay = useRef(today);
  useEffect(() => {
    if (seenDay.current === today) return;
    seenDay.current = today;
    reloadList();
  }, [today, reloadList]);

  return { photos, status, activeRes, tagsRes, tree, poiById, themeTitle: themeTitle.current, playlist };
}
