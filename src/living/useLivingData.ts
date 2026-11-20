import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { EntryDetail, EntryListResponse, PhotoSummary, Poi, Tag, ThemeDetail } from '../../shared/types';
import { usePhotosById } from '../entries/api';
import { buildTagTree } from '../lib/tags';
import { themePhotos } from '../themes/model';
import { useApi } from '../lib/useApi';
import { entriesPath, entryName, missingPhotoIds, photosOfEntries, photosOfEntry, playableEntries, type EntryPlay } from './entries';
import { buildPlaylist } from './playlist';
import type { Settings, Source } from './settings';

const EMPTY: PhotoSummary[] = [];
const NO_IDS: string[] = [];
const NO_ENTRIES: ReadonlyMap<string, string> = new Map();

type PhotosResponse = { photos: PhotoSummary[] };

/** Detail endpoints are documented as the bare object while writes return `{ photo }`; accept both. */
export function unwrap<T>(data: unknown, key: string): T | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const inner = (data as Record<string, unknown>)[key];
  return (inner && typeof inner === 'object' ? inner : data) as T;
}

function photosPath(s: Source): string | null {
  if (s.src === 'theme' || s.src === 'entry') return null;
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
 * What Living plays: the photo list (or the theme's photos, an entry's, the photos of a list of entries), tags and places
 * for the captions and the drawer, the "start from" photo when the list does not contain it, and the playlist built from
 * them.
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
  // a theme plays its photos and its entries' photos, in its order
  const playable = useMemo(() => (theme?.items ? themePhotos(theme) : undefined), [theme]);

  // an entry plays its photos the viewer may see, in its order; its name goes under each
  const entryRes = useApi<EntryDetail>(source.src === 'entry' ? `/api/entries/${encodeURIComponent(source.entry)}` : null);
  const entryTitle = useRef('');
  const one = entryRes.data && entryRes.data.id === source.entry ? entryRes.data : undefined;
  if (one) entryTitle.current = entryName(one, one.body);
  // entries play their finished ones' photos, each once, under the name of the first (newest) it is in: the photos
  // from the photo list, those not in it (unlisted, or one's own private) by id
  const shelfPath = entriesPath(source);
  const shelfRes = useApi<EntryListResponse>(shelfPath);
  const shelf = useMemo(() => (shelfRes.data ? playableEntries(shelfRes.data.entries) : undefined), [shelfRes.data]);
  const listedById = useMemo(() => new Map((photosRes.data?.photos ?? []).map((p) => [p.id, p] as const)), [photosRes.data]);
  const missing = useMemo(
    () => (shelf && photosRes.data ? missingPhotoIds(shelf, listedById) : NO_IDS),
    [shelf, photosRes.data, listedById]
  );
  const extra = usePhotosById(missing);
  const fromEntries = useMemo((): EntryPlay | undefined => {
    if (source.src === 'entry') return one ? photosOfEntry(one) : undefined;
    if (source.src !== 'entries' || !shelf || !photosRes.data || !extra.done) return undefined;
    return photosOfEntries(shelf, (id) => listedById.get(id) ?? extra.byId.get(id));
  }, [source.src, one, shelf, photosRes.data, extra.done, extra.byId, listedById]);

  const fromList = source.src === 'entry' || source.src === 'entries' ? fromEntries?.photos : photosRes.data?.photos;
  const listed = source.src === 'theme' ? playable : fromList;

  // Keep the last good list while a refresh is in flight, so a midnight reload never blanks the screen.
  const listKey =
    source.src === 'theme'
      ? `theme:${source.theme}`
      : source.src === 'entry'
        ? `entry:${source.entry}`
        : source.src === 'entries'
          ? `entries:${shelfPath}:${listPath}`
          : listPath;
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

  const shelfReload = shelfRes.reload;
  const photosReload = photosRes.reload;
  const extraReload = extra.reload;
  const reloadShelf = useCallback(() => {
    shelfReload();
    photosReload();
    extraReload();
  }, [shelfReload, photosReload, extraReload]);
  const shelfError = shelfRes.error ?? photosRes.error ?? extra.error;
  const shelfState = useMemo(() => ({ error: shelfError, reload: reloadShelf }), [shelfError, reloadShelf]);
  const activeRes: { error: unknown; reload: () => void } =
    source.src === 'theme' ? themeRes : source.src === 'entry' ? entryRes : source.src === 'entries' ? shelfState : photosRes;
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

  return {
    photos,
    status,
    activeRes,
    tagsRes,
    tree,
    poiById,
    themeTitle: themeTitle.current,
    entryTitle: entryTitle.current,
    entryOf: fromEntries?.entryOf ?? NO_ENTRIES,
    playlist
  };
}
