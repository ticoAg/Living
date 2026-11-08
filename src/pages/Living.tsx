import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation } from 'wouter';
import type { PhotoDetail, PhotoSummary, Poi, Tag, ThemeDetail } from '../../shared/types';
import { ApiError } from '../lib/api';
import { fmtLongDay } from '../lib/format';
import { buildTagTree, inclusiveCounts } from '../lib/tags';
import { useApi } from '../lib/useApi';
import Caption from '../living/Caption';
import Controls from '../living/Controls';
import Drawer, { type Scope, type TagsState } from '../living/Drawer';
import Stage from '../living/Stage';
import { announceText, buildCaption, hasCaption } from '../living/caption';
import { useAutoHide, useClock, useDocumentHidden, useFullscreen, useLatest, useReducedMotion, useWakeLock } from '../living/hooks';
import { buildPlaylist } from '../living/playlist';
import { preloadPhoto } from '../living/preload';
import { absoluteLink, buildQuery, readInitial, replaceUrl, writeStored, type Settings, type Source } from '../living/settings';
import '../styles/living.css';

// Living mode: the fullscreen slideshow. Spec: docs/product/features/living-mode.md.
// Parameters, storage and the playlist live in src/living/; this page wires them to the screen.

const EMPTY: PhotoSummary[] = [];
const BRIEF_MS = 6000;
const SWIPE_MIN = 48;

type PhotosResponse = { photos: PhotoSummary[] };

/** Detail endpoints are documented as the bare object while writes return `{ photo }`; accept both. */
function unwrap<T>(data: unknown, key: string): T | undefined {
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

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Living() {
  const [, navigate] = useLocation();
  const [init] = useState(() => readInitial());
  const [source, setSource] = useState<Source>(init.source);
  const [settings, setSettings] = useState<Settings>(init.settings);
  // `start` applies to the first source only; any change of source drops it.
  const [startId, setStartId] = useState(init.start);
  const [curId, setCurId] = useState<string | null>(init.start || null);
  // Bumps on every move (auto, manual or restart): restarts the progress line and the 6 s caption window.
  const [run, setRun] = useState(0);
  const [paused, setPaused] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [fieldsOff, setFieldsOff] = useState(false);
  const [briefOver, setBriefOver] = useState(false);
  const [peek, setPeek] = useState(0);
  const [barHover, setBarHover] = useState(false);
  const [barFocus, setBarFocus] = useState(false);
  const [, rerender] = useState(0);
  // One shuffle per visit: same order until the page is reloaded.
  const [seed] = useState(() => Math.floor(Math.random() * 4294967296));
  // What the link opened with, so the drawer can offer to switch those parts on and off again.
  const [scope0] = useState(() => ({ place: init.source.place, theme: init.source.theme, city: init.source.city, user: init.source.user }));

  const rootRef = useRef<HTMLElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const touched = useRef(false);

  const reduced = useReducedMotion();
  const hidden = useDocumentHidden();
  const now = useClock();
  const fs = useFullscreen(rootRef);
  useWakeLock(settings.awake);

  /* ---------------------------------------------------------------- data */

  const needTags = source.src === 'tags' || settings.fields.includes('tags');
  const ownerQ = source.user ? `?owner=${encodeURIComponent(source.user)}` : '';
  const listPath = photosPath(source);
  const photosRes = useApi<PhotosResponse>(listPath);
  const themeRes = useApi<unknown>(source.src === 'theme' ? `/api/themes/${encodeURIComponent(source.theme)}` : null);
  const tagsRes = useApi<{ tags: Tag[] }>(needTags ? `/api/tags${ownerQ}` : null);
  const poisRes = useApi<{ pois: Poi[] }>(`/api/pois${ownerQ}`);

  const theme = useMemo(() => unwrap<ThemeDetail>(themeRes.data, 'theme'), [themeRes.data]);
  const themeTitle = useRef('');
  if (theme?.title) themeTitle.current = theme.title;
  const themePhotos = useMemo(
    () => theme?.items?.flatMap((it) => (it.kind === 'photo' && it.photo ? [it.photo] : [])),
    [theme]
  );
  const listed = source.src === 'theme' ? themePhotos : photosRes.data?.photos;

  // Keep the last good list while a refresh is in flight, so a midnight reload never blanks the screen.
  const listKey = source.src === 'theme' ? `theme:${source.theme}` : listPath;
  const good = useRef<{ key: string | null; photos: PhotoSummary[] }>({ key: null, photos: EMPTY });
  if (listed) good.current = { key: listKey, photos: listed };
  const photos = listed ?? (good.current.key === listKey ? good.current.photos : undefined);

  // "Start from this photo" can name one that is not in the list (unlisted, or beyond the 5000 cap).
  const canBorrowStart = !!startId && source.src === 'all' && !source.city && !source.user;
  const startListed = !!photos && photos.some((p) => p.id === startId);
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
  const status: 'loading' | 'error' | 'ready' = !pool && activeRes.error ? 'error' : pool && !tagsPending && !startPending ? 'ready' : 'loading';

  const tree = useMemo(() => (tagsRes.data?.tags ? buildTagTree(tagsRes.data.tags) : null), [tagsRes.data]);
  const poiById = useMemo(() => new Map((poisRes.data?.pois ?? []).map((p) => [p.id, p] as const)), [poisRes.data]);

  const today = localDate(now);
  const playlist = useMemo(
    () => (status === 'ready' && pool ? buildPlaylist({ photos: pool, source, tree, seed, today: new Date(), startId }) : EMPTY),
    // `today` stands for the date: the "那年今日" list rolls over at midnight
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

  /* ------------------------------------------------------------ position */

  const n = playlist.length;
  const idx = useMemo(() => {
    if (!curId) return 0;
    const i = playlist.findIndex((p) => p.id === curId);
    return i < 0 ? 0 : i;
  }, [playlist, curId]);
  const cur = n ? playlist[idx] : null;
  const next = n > 1 ? playlist[(idx + 1) % n] : null;

  const go = useCallback(
    (delta: number) => {
      if (!n) return;
      setCurId(playlist[(((idx + delta) % n) + n) % n].id);
      setRun((r) => r + 1);
    },
    [n, idx, playlist]
  );
  const goRef = useLatest(go);

  // Auto-advance. Time spent on the current photo survives pausing and the tab going to the
  // background; a move or a new interval starts the count again.
  const everyMs = settings.every * 1000;
  const holding = paused || hidden;
  const elapsed = useRef(0);
  const lastSig = useRef('');
  const sig = `${run}:${everyMs}`;
  useEffect(() => {
    if (lastSig.current !== sig) {
      lastSig.current = sig;
      elapsed.current = 0;
    }
    if (holding || n < 2) return;
    const started = performance.now();
    const base = elapsed.current;
    const id = window.setTimeout(() => goRef.current(1), Math.max(0, everyMs - base));
    return () => {
      window.clearTimeout(id);
      elapsed.current = base + (performance.now() - started);
    };
  }, [sig, holding, n, everyMs, goRef]);

  // Warm the cache with the next photo.
  const nextPhoto = next;
  const preloaded = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (nextPhoto) preloaded.current = preloadPhoto(nextPhoto);
  }, [nextPhoto]);

  /* ---------------------------------------------------- settings changes */

  const changeSettings = useCallback((patch: Partial<Settings>) => {
    touched.current = true;
    setSettings((s) => ({ ...s, ...patch }));
  }, []);
  const changeSource = useCallback((patch: Partial<Source>) => {
    touched.current = true;
    setSource((s) => ({ ...s, ...patch }));
    setStartId('');
    setCurId(null);
    setRun((r) => r + 1);
  }, []);

  // Drawer changes persist on this device and rewrite the address bar, so the page URL is the full link.
  const query = useMemo(() => buildQuery(source, settings), [source, settings]);
  useEffect(() => {
    if (!touched.current) return;
    writeStored(settings);
    replaceUrl(query);
  }, [settings, query]);

  const playAll = useCallback(() => {
    const plain = source.src === 'all' && !source.city && !source.user;
    changeSource({ src: 'all', tags: [], place: '', theme: '', city: '', user: '', order: 'shuffle' });
    if (plain) activeRes.reload();
    rerender((v) => v + 1);
  }, [source, changeSource, activeRes]);

  /* ------------------------------------------------------ controls and UI */

  const empty = status === 'ready' && n === 0;
  const hold = paused || drawerOpen || barHover || barFocus || status !== 'ready' || n === 0;
  const ui = useAutoHide(hold);
  const barShown = ui.visible || hold;

  const togglePause = useCallback(() => setPaused((p) => !p), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const restoreFocus = useRef(false);
  const closeDrawer = useCallback(() => {
    restoreFocus.current = !!document.getElementById('lv-drawer')?.contains(document.activeElement);
    setDrawerOpen(false);
  }, []);
  const toggleDrawer = useCallback(() => (drawerOpen ? closeDrawer() : openDrawer()), [drawerOpen, closeDrawer, openDrawer]);
  useEffect(() => {
    if (drawerOpen) closeBtnRef.current?.focus({ preventScroll: true });
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      settingsBtnRef.current?.focus({ preventScroll: true });
    }
  }, [drawerOpen]);

  const leave = useCallback(() => {
    fs.exit();
    // Back when there is somewhere in this site to go back to, else the gallery. The Navigation API
    // knows whether the previous entry is ours; elsewhere history.length is the best available hint.
    const nav = (window as unknown as { navigation?: { canGoBack?: boolean } }).navigation;
    const canGoBack = typeof nav?.canGoBack === 'boolean' ? nav.canGoBack : window.history.length > 1;
    if (canGoBack) window.history.back();
    else navigate('/');
  }, [fs, navigate]);

  // Fields on/off (I). Under "切换后 6 秒" it also brings the fields back for another 6 s.
  const briefHidden = settings.brief && briefOver;
  const captionVisible = !fieldsOff && !briefHidden;
  const toggleFields = useCallback(() => {
    if (captionVisible) {
      setFieldsOff(true);
      return;
    }
    setFieldsOff(false);
    if (briefHidden) setPeek((p) => p + 1);
  }, [captionVisible, briefHidden]);
  useEffect(() => {
    setBriefOver(false);
    if (!settings.brief) return;
    const t = window.setTimeout(() => setBriefOver(true), BRIEF_MS);
    return () => window.clearTimeout(t);
  }, [run, peek, settings.brief, cur?.id]);

  const actions = useLatest({ go, togglePause, toggleFields, toggleDrawer, closeDrawer, drawerOpen, fs, leave, poke: ui.poke });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const a = actions.current;
      a.poke();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        a.go(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (e.repeat) return;
      if (e.key === ' ' || e.key === 'Spacebar') {
        // On a focused button Space is that button's own click.
        if (t?.closest('button, a[href], summary, [role="button"]')) return;
        e.preventDefault();
        a.togglePause();
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'i':
          a.toggleFields();
          break;
        case 's':
          a.toggleDrawer();
          break;
        case 'f':
          a.fs.toggle();
          break;
        case 'escape':
          // One Esc at a time: leave fullscreen, then close the drawer, then leave Living.
          // (Browsers usually swallow the Esc that ends fullscreen; justExited covers those that do not.)
          if (a.fs.active || a.fs.justExited()) {
            if (a.fs.active) a.fs.exit();
          } else if (a.drawerOpen) a.closeDrawer();
          else a.leave();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);

  // Tap toggles the controls, a horizontal swipe changes photo.
  const swipe = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const swiped = useRef(false);
  const onStageDown = (e: ReactPointerEvent) => {
    swiped.current = false;
    swipe.current = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };
  const onStageUp = (e: ReactPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.4 && performance.now() - s.t < 900) {
      swiped.current = true;
      go(dx < 0 ? 1 : -1);
    }
  };
  const onStageClick = () => {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    ui.toggle();
  };

  // Page chrome: dark page and browser UI while Living is open.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('lv-active');
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prev = meta?.getAttribute('content') ?? null;
    meta?.setAttribute('content', '#0E0F0E');
    return () => {
      html.classList.remove('lv-active');
      if (meta && prev !== null) meta.setAttribute('content', prev);
    };
  }, []);

  /* ------------------------------------------------------------ display */

  const fieldSet = useMemo(() => new Set(settings.fields), [settings.fields]);
  const wantExif = fieldSet.has('exif');
  const detailRes = useApi<unknown>(wantExif && cur ? `/api/photos/${encodeURIComponent(cur.id)}` : null);
  useApi<unknown>(wantExif && next ? `/api/photos/${encodeURIComponent(next.id)}` : null); // prefetch for the next slide
  const detail = useMemo(() => (wantExif ? (unwrap<PhotoDetail>(detailRes.data, 'photo') ?? null) : null), [wantExif, detailRes.data]);

  const poi = cur?.poiId ? (poiById.get(cur.poiId) ?? null) : null;
  const tagName = useCallback((id: string) => tree?.byId.get(id)?.name ?? null, [tree]);
  const caption = useMemo(
    () => (cur ? buildCaption(cur, { fields: fieldSet, poi, tagName, detail: detail && detail.id === cur.id ? detail : null, today: now }) : null),
    [cur, fieldSet, poi, tagName, detail, now]
  );
  const showCaption = !!cur && hasCaption(caption);

  const effectiveFx = settings.fx === 'drift' && reduced ? 'fade' : settings.fx;
  const dimmed = settings.night && (now.getHours() >= 22 || now.getHours() < 7);

  const srcName = (() => {
    const parts: string[] = [];
    if (source.src === 'place') parts.push(poiById.get(source.place)?.name ?? '地点');
    else if (source.src === 'theme') parts.push(themeTitle.current || '主题');
    else if (source.src === 'today') parts.push('那年今日');
    else if (source.src === 'tags') parts.push(...source.tags.map((id) => tree?.byId.get(id)?.name ?? id));
    if (source.city && source.src !== 'theme') parts.push(source.city);
    if (source.user && source.src !== 'theme') parts.push(`@${source.user}`);
    return parts.length ? parts.join(' · ') : '全部';
  })();
  const orderName = source.order === 'time' ? (source.src === 'theme' ? '按顺序' : '按时间') : '随机';
  const summary = status === 'ready' ? `${srcName} · ${orderName} · ${n} 张` : status === 'error' ? srcName : `${srcName} · 载入中`;

  /* -------------------------------------------------------------- drawer */

  const tagsState: TagsState = useMemo(() => {
    const tagsStatus = tagsRes.error ? 'error' : tagsRes.data ? 'ready' : 'loading';
    const counts =
      source.src === 'tags' && tree && photos
        ? inclusiveCounts(
            photos.filter((p) => p.inLiving && (!source.city || p.city === source.city)),
            tree
          )
        : null;
    return { status: tagsStatus, tree, counts };
  }, [tagsRes.error, tagsRes.data, tree, photos, source.src, source.city]);

  const scopes: Scope[] = [];
  if (scope0.place) {
    scopes.push({
      key: 'place',
      label: `地点 · ${poiById.get(scope0.place)?.name ?? '指定地点'}`,
      on: source.src === 'place',
      onToggle: () => (source.src === 'place' ? changeSource({ src: 'all' }) : changeSource({ src: 'place', place: scope0.place }))
    });
  }
  if (scope0.theme) {
    scopes.push({
      key: 'theme',
      label: `主题 · ${themeTitle.current || '指定主题'}`,
      on: source.src === 'theme',
      onToggle: () => (source.src === 'theme' ? changeSource({ src: 'all', order: 'shuffle' }) : changeSource({ src: 'theme', theme: scope0.theme, order: 'time' }))
    });
  }
  if (scope0.city) {
    scopes.push({
      key: 'city',
      label: `城市 · ${scope0.city}`,
      on: !!source.city,
      onToggle: () => (source.city ? changeSource({ city: '', ...(source.src === 'city' ? { src: 'all' as const } : {}) }) : changeSource({ city: scope0.city }))
    });
  }
  if (scope0.user) {
    scopes.push({
      key: 'user',
      label: `仅 @${scope0.user}`,
      on: !!source.user,
      onToggle: () => changeSource({ user: source.user ? '' : scope0.user })
    });
  }

  /* ---------------------------------------------------------------- view */

  const errorText = activeRes.error instanceof ApiError ? activeRes.error.message : '请检查网络连接后重试';
  const retry = () => {
    activeRes.reload();
    rerender((v) => v + 1);
  };

  return (
    <main
      ref={rootRef}
      className="lv"
      aria-label="Living 全屏轮播"
      data-ui={barShown ? 'on' : 'off'}
      data-drawer={drawerOpen ? 'open' : 'closed'}
      data-night={dimmed}
      onPointerMove={(e) => {
        if (e.pointerType !== 'touch') ui.poke();
      }}
    >
      <div className="lv-stage" onPointerDown={onStageDown} onPointerUp={onStageUp} onPointerCancel={() => (swipe.current = null)} onClick={onStageClick}>
        <Stage photo={cur} fit={settings.fit} fx={effectiveFx} everySec={settings.every} paused={holding} />
      </div>

      {dimmed && <div className="lv-dim" aria-hidden="true" />}
      {showCaption && <div className="lv-scrim lv-scrim-bottom" data-visible={captionVisible} aria-hidden="true" />}
      {(barShown || settings.clock) && <div className="lv-scrim lv-scrim-top" aria-hidden="true" />}

      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {cur ? announceText(cur, poi) : status === 'loading' ? '载入中' : ''}
      </p>

      <div className="lv-brand" data-hidden={!barShown}>
        <span className="lv-wordmark">LIVING</span>
        <span className="lv-summary">{summary}</span>
      </div>

      {settings.clock && (
        <div className="lv-clock">
          <span className="lv-clock-time">{`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`}</span>
          <span className="lv-clock-date">{fmtLongDay(today)}</span>
        </div>
      )}

      {showCaption && caption && cur && (
        <Caption data={caption} photoId={cur.id} visible={captionVisible} pos={settings.pos} size={settings.size} barUp={barShown} animate={effectiveFx !== 'cut'} />
      )}

      {empty && (
        <div className="lv-center">
          <p className="lv-center-title">没有符合的照片</p>
          <button type="button" className="lv-outline" onClick={playAll}>
            播放全部
          </button>
        </div>
      )}
      {status === 'error' && (
        <div className="lv-center" role="alert">
          <p className="lv-center-title">无法载入照片</p>
          <p className="lv-center-note">{errorText}</p>
          <div className="lv-center-actions">
            <button type="button" className="lv-outline" onClick={retry}>
              重试
            </button>
            {(source.src !== 'all' || source.city || source.user) && (
              <button type="button" className="lv-outline" onClick={playAll}>
                播放全部
              </button>
            )}
          </div>
        </div>
      )}

      <Controls
        index={idx}
        count={n}
        paused={paused}
        settingsOpen={drawerOpen}
        hidden={!barShown}
        fullscreenSupported={fs.supported}
        fullscreenActive={fs.active}
        everySec={settings.every}
        runKey={sig}
        running={!holding}
        settingsRef={settingsBtnRef}
        onPrev={() => go(-1)}
        onToggle={togglePause}
        onNext={() => go(1)}
        onSettings={toggleDrawer}
        onFullscreen={fs.toggle}
        onExit={leave}
        onEngage={(kind, on) => (kind === 'pointer' ? setBarHover(on) : setBarFocus(on))}
      />

      <Drawer
        open={drawerOpen}
        onClose={closeDrawer}
        closeRef={closeBtnRef}
        source={source}
        settings={settings}
        onSource={changeSource}
        onSettings={changeSettings}
        count={n}
        scopes={scopes}
        tags={tagsState}
        link={absoluteLink(query)}
      />
    </main>
  );
}
