import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import type { PhotoDetail } from '../../shared/types';
import { ApiError } from '../lib/api';
import { fmtLongDay } from '../lib/format';
import { inclusiveCounts } from '../lib/tags';
import { useApi } from '../lib/useApi';
import Caption from '../living/Caption';
import Controls from '../living/Controls';
import Drawer, { type Scope, type TagsState } from '../living/Drawer';
import Stage from '../living/Stage';
import { announceText, buildCaption, hasCaption } from '../living/captionText';
import { useClock, useDarkChrome, useDocumentHidden, useFullscreen, useReducedMotion, useWakeLock } from '../living/hooks';
import { absoluteLink, buildQuery, readInitial, replaceUrl, writeStored, type Settings, type Source } from '../living/settings';
import { scopeSwitches, summaryLine, type SourceNames } from '../living/summary';
import { useBar } from '../living/useBar';
import { useCaptionToggle } from '../living/useCaptionToggle';
import { useDrawer } from '../living/useDrawer';
import { unwrap, useLivingData } from '../living/useLivingData';
import { useLivingKeys } from '../living/useLivingKeys';
import { usePlayback } from '../living/usePlayback';
import { useStageGestures } from '../living/useStageGestures';
import '../styles/living.css';

// Living mode: the fullscreen slideshow. Spec: docs/product/features/living-mode.md.
// Parameters, storage, the playlist and the page's state live in src/living/ (data, playback, bar, drawer, keys);
// this page wires them to the screen.

const localDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Living() {
  const [, navigate] = useLocation();
  const [init] = useState(() => readInitial());
  const [source, setSource] = useState<Source>(init.source);
  const [settings, setSettings] = useState<Settings>(init.settings);
  // `start` applies to the first source only; any change of source drops it.
  const [startId, setStartId] = useState(init.start);
  const [, rerender] = useState(0);
  // One shuffle per visit: same order until the page is reloaded.
  const [seed] = useState(() => Math.floor(Math.random() * 4294967296));
  // What the link opened with, so the drawer can offer to switch those parts on and off again.
  const [scope0] = useState(() => ({ place: init.source.place, theme: init.source.theme, city: init.source.city, user: init.source.user }));

  const rootRef = useRef<HTMLElement>(null);
  const touched = useRef(false);

  const reduced = useReducedMotion();
  const hidden = useDocumentHidden();
  const now = useClock();
  const fs = useFullscreen(rootRef);
  useWakeLock(settings.awake);
  const drawer = useDrawer();

  const today = localDate(now);
  const data = useLivingData({ source, settings, drawerEverOpened: drawer.everOpened, startId, seed, today });
  const { photos, status, activeRes, tagsRes, tree, poiById } = data;
  const play = usePlayback({ playlist: data.playlist, firstId: init.start, everySec: settings.every, hidden });
  const { cur, next, n } = play;

  /* ---------------------------------------------------- settings changes */

  const changeSettings = useCallback((patch: Partial<Settings>) => {
    touched.current = true;
    setSettings((s) => ({ ...s, ...patch }));
  }, []);
  const { restart } = play;
  const changeSource = useCallback(
    (patch: Partial<Source>) => {
      touched.current = true;
      setSource((s) => ({ ...s, ...patch }));
      setStartId('');
      restart();
    },
    [restart]
  );

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
  const bar = useBar(play.paused || drawer.open || status !== 'ready' || n === 0);

  const leave = useCallback(() => {
    fs.exit();
    // Back when there is somewhere in this site to go back to, else the gallery. The Navigation API
    // knows whether the previous entry is ours; elsewhere history.length is the best available hint.
    const nav = (window as unknown as { navigation?: { canGoBack?: boolean } }).navigation;
    const canGoBack = typeof nav?.canGoBack === 'boolean' ? nav.canGoBack : window.history.length > 1;
    if (canGoBack) window.history.back();
    else navigate('/');
  }, [fs, navigate]);

  const fields = useCaptionToggle(settings.brief, play.run, cur?.id);
  useLivingKeys({
    go: play.go,
    togglePause: play.togglePause,
    toggleFields: fields.toggle,
    toggleDrawer: drawer.toggleDrawer,
    closeDrawer: drawer.closeDrawer,
    drawerOpen: drawer.open,
    fs,
    leave,
    poke: bar.poke
  });
  const stage = useStageGestures(play.go, bar.toggle);
  useDarkChrome();

  /* ------------------------------------------------------------ display */

  const fieldSet = useMemo(() => new Set(settings.fields), [settings.fields]);
  const wantExif = fieldSet.has('exif');
  const detailRes = useApi<unknown>(wantExif && cur ? `/api/photos/${encodeURIComponent(cur.id)}` : null);
  useApi<unknown>(wantExif && next ? `/api/photos/${encodeURIComponent(next.id)}` : null); // prefetch for the next slide
  const detail = useMemo(() => (wantExif ? (unwrap<PhotoDetail>(detailRes.data, 'photo') ?? null) : null), [wantExif, detailRes.data]);

  const poi = cur?.poiId ? (poiById.get(cur.poiId) ?? null) : null;
  const tagName = useCallback((id: string) => tree?.byId.get(id)?.name ?? null, [tree]);
  const caption = useMemo(
    () =>
      cur
        ? buildCaption(cur, { fields: fieldSet, poi, tagName, detail: detail && detail.id === cur.id ? detail : null, today: now })
        : null,
    [cur, fieldSet, poi, tagName, detail, now]
  );
  const showCaption = !!cur && hasCaption(caption);

  const effectiveFx = settings.fx === 'drift' && reduced ? 'fade' : settings.fx;
  const dimmed = settings.night && (now.getHours() >= 22 || now.getHours() < 7);

  const names: SourceNames = { place: (id) => poiById.get(id)?.name, themeTitle: data.themeTitle, tag: (id) => tree?.byId.get(id)?.name };
  const summary = summaryLine(source, names, status, n);

  /* -------------------------------------------------------------- drawer */

  const tagsState: TagsState = useMemo(() => {
    const tagsStatus = tagsRes.error ? 'error' : tagsRes.data ? 'ready' : 'loading';
    const counts =
      source.src === 'tags' && tree && photos
        ? inclusiveCounts(
            photos
              .filter((p) => p.inLiving !== false && (!source.city || p.city === source.city))
              .map((p) => (p.tagIds ? p : { ...p, tagIds: [] })),
            tree
          )
        : null;
    return { status: tagsStatus, tree, counts };
  }, [tagsRes.error, tagsRes.data, tree, photos, source.src, source.city]);

  const scopes: Scope[] = scopeSwitches(scope0, source, names).map(({ patch, ...s }) => ({ ...s, onToggle: () => changeSource(patch) }));

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
      data-ui={bar.shown ? 'on' : 'off'}
      data-drawer={drawer.open ? 'open' : 'closed'}
      data-night={dimmed}
      onPointerMove={(e) => {
        if (e.pointerType !== 'touch') bar.poke();
      }}
    >
      <div
        className="lv-stage"
        onPointerDown={stage.onPointerDown}
        onPointerUp={stage.onPointerUp}
        onPointerCancel={stage.onPointerCancel}
        onClick={stage.onClick}
      >
        <Stage
          photo={cur}
          fit={settings.fit}
          fx={effectiveFx}
          everySec={settings.every}
          paused={play.holding}
          onShown={play.onShown}
          onBroken={play.onBroken}
        />
      </div>

      {dimmed && <div className="lv-dim" aria-hidden="true" />}
      {showCaption && <div className="lv-scrim lv-scrim-bottom" data-visible={fields.visible} aria-hidden="true" />}
      {(bar.shown || settings.clock) && <div className="lv-scrim lv-scrim-top" aria-hidden="true" />}

      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {cur ? announceText(cur, poi) : status === 'loading' ? '载入中' : ''}
      </p>

      <div className="lv-brand" data-hidden={!bar.shown}>
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
        <Caption
          data={caption}
          photoId={cur.id}
          visible={fields.visible}
          pos={settings.pos}
          size={settings.size}
          barUp={bar.shown}
          animate={effectiveFx !== 'cut'}
        />
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
        index={play.idx}
        count={n}
        paused={play.paused}
        settingsOpen={drawer.open}
        hidden={!bar.shown}
        fullscreenSupported={fs.supported}
        fullscreenActive={fs.active}
        everySec={settings.every}
        runKey={play.sig}
        running={!play.holding}
        settingsRef={drawer.settingsRef}
        onPrev={() => play.go(-1)}
        onToggle={play.togglePause}
        onNext={() => play.go(1)}
        onSettings={drawer.toggleDrawer}
        onFullscreen={fs.toggle}
        onExit={leave}
        onEngage={bar.onEngage}
      />

      <Drawer
        open={drawer.open}
        onClose={drawer.closeDrawer}
        closeRef={drawer.closeRef}
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
