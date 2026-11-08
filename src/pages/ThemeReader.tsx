import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'wouter';
import type { ThemeDetail, ThemeSummary } from '../../shared/types';
import Img from '../components/Img';
import MapView, { type MapPoint, type MapShapes } from '../components/MapView';
import { CategoryIcon, Icon } from '../components/icons';
import { ApiError } from '../lib/api';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import Prose from '../themes/Prose';
import ThemeCard from '../themes/ThemeCard';
import { useDocumentTitle, useScrollTop } from '../themes/hooks';
import { buildReaderModel, type Block } from '../themes/model';
import { fmtRange, KIND_LABEL, unwrapTheme, VISIBILITY_LABEL } from '../themes/util';
import '../styles/themes.css';

function Missing({ error, reload }: { error: unknown; reload: () => void }) {
  const gone = error instanceof ApiError && [401, 403, 404].includes(error.status);
  return (
    <main className="th-page th-narrow">
      <div className="th-empty" role="alert">
        <p className="th-empty-title">{gone ? '找不到这个主题' : '主题加载失败'}</p>
        <p className="muted">{gone ? '它可能已被删除，或者只有作者能看到。' : '请检查网络后重试。'}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {!gone && (
            <button type="button" className="btn" onClick={reload}>
              重试
            </button>
          )}
          <Link href="/themes" className="btn">
            全部主题
          </Link>
        </div>
      </div>
    </main>
  );
}

function BlockView({ b }: { b: Block }) {
  if (b.type === 'day') {
    return (
      <div id={`item-${b.key}`} className="rd-day">
        <h2 className="rd-day-title">
          <span>
            第 {b.n} 天<span className="rd-day-sep"> · </span>
            <span className="rd-day-date">{b.label}</span>
          </span>
        </h2>
        <Prose text={b.text} className="rd-prose" />
      </div>
    );
  }
  if (b.type === 'text') {
    return (
      <div id={`item-${b.key}`} className="rd-text">
        <Prose text={b.text} className="rd-prose" />
      </div>
    );
  }
  const { photo, poi } = b;
  return (
    <figure id={`item-${b.key}`} className="rd-fig" tabIndex={-1}>
      <Img
        photo={photo}
        fit="contain"
        sizes="(max-width: 1100px) 100vw, 1100px"
        alt={photo.title ?? poi?.name ?? ''}
        style={{ '--ar': photo.width / photo.height } as CSSProperties}
      />
      {(poi || b.when || b.text) && (
        <figcaption className="rd-cap">
          {(poi || b.when) && (
            <p className="rd-cap-line">
              {poi && (
                <>
                  <CategoryIcon category={poi.category} size={16} />
                  <Link href={`/place/${poi.id}`}>{poi.name}</Link>
                </>
              )}
              {b.when && <span className="mono">{b.when}</span>}
            </p>
          )}
          <Prose text={b.text} className="rd-prose" />
        </figcaption>
      )}
    </figure>
  );
}

function MoreFromAuthor({ theme }: { theme: ThemeDetail }) {
  const { user } = useSession();
  const { data } = useApi<{ themes: ThemeSummary[] }>(`/api/themes?owner=${encodeURIComponent(theme.ownerHandle)}`);
  const others = (data?.themes ?? []).filter((t) => t.id !== theme.id).slice(0, 3);
  if (!others.length) return null;
  return (
    <section className="rd-more" aria-labelledby="rd-more-h">
      <h2 id="rd-more-h" className="rd-foot-h">
        <span className="handle">@{theme.ownerHandle}</span> 的其他主题
      </h2>
      <ul className="th-grid">
        {others.map((t) => (
          <li key={t.id}>
            <ThemeCard theme={t} own={t.ownerId === user?.id} level={3} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Reader({ theme, isOwner }: { theme: ThemeDetail; isOwner: boolean }) {
  const model = useMemo(() => buildReaderModel(theme), [theme]);

  const scrollToItem = useCallback((itemId: string | undefined) => {
    const el = itemId ? document.getElementById(`item-${itemId}`) : null;
    if (!el) return;
    // leave room for the sticky site header, whatever height it has at this width
    const header = document.querySelector('.site-header')?.getBoundingClientRect().height ?? 0;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - header - 16, behavior: calm ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }, []);

  const points = useMemo<MapPoint[]>(
    () =>
      model.places.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, label: p.name, onClick: () => scrollToItem(model.firstAt.get(p.id)) })),
    [model, scrollToItem]
  );
  const shapes = useMemo<MapShapes>(() => ({ lines: model.route.length > 1 ? [{ id: 'route', coords: model.route }] : [] }), [model.route]);
  const showMap = theme.kind === 'trip' && (model.route.length > 0 || points.length > 0);
  // A live map swallows the wheel and one-finger drags, which makes the page hard to scroll; it is opt-in.
  const [live, setLive] = useState(false);

  const dates = fmtRange(theme.startDate, theme.endDate);
  const living = `/living?src=theme&theme=${encodeURIComponent(theme.id)}`;
  const editHref = `/t/${theme.id}/edit`;

  return (
    <main className="rd">
      <div className="rd-bar">
        <Link href="/themes" className="rd-back">
          <Icon name="left" size={16} />
          主题
        </Link>
        <div className="row" style={{ gap: 8 }}>
          {model.photoCount > 0 && (
            <Link href={living} className="btn btn-quiet btn-living">
              <Icon name="play" size={14} />
              Living
            </Link>
          )}
          {isOwner && (
            <Link href={editHref} className="btn btn-quiet">
              <Icon name="edit" size={16} />
              编辑
            </Link>
          )}
        </div>
      </div>

      {theme.cover && (
        <figure className="rd-cover">
          <Img photo={theme.cover} eager sizes="100vw" />
        </figure>
      )}

      <header className="rd-head">
        <p className="rd-eyebrow">
          <span className="th-kind" data-kind={theme.kind}>
            {KIND_LABEL[theme.kind]}
          </span>
          {dates && <span className="mono">{dates}</span>}
          {isOwner && theme.visibility !== 'public' && <span className="th-flag">{VISIBILITY_LABEL[theme.visibility]}可见</span>}
        </p>
        <h1 className="display rd-title">{theme.title}</h1>
        {theme.subtitle && <p className="rd-sub">{theme.subtitle}</p>}
        <p className="rd-by">
          <Link href={`/@${theme.ownerHandle}`}>@{theme.ownerHandle}</Link>
          <span aria-hidden="true">·</span>
          <span>
            <b className="mono">{model.photoCount}</b> 张照片
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <b className="mono">{model.places.length}</b> 个地点
          </span>
        </p>
      </header>

      {theme.intro?.trim() && (
        <section className="rd-intro" aria-label="导语">
          <Prose text={theme.intro} className="rd-prose" />
        </section>
      )}

      {showMap && (
        <section className="rd-map-wrap" aria-label="路线">
          {/* the map is created once, so switching mode remounts it */}
          <MapView
            key={live ? 'live' : 'still'}
            ariaLabel="路线图"
            points={points}
            shapes={shapes}
            className="rd-map"
            maxZoom={15}
            interactive={live}
          />
          <div className="rd-map-bar">
            <span>点击地点，跳到对应的照片。</span>
            <button type="button" className="btn btn-quiet" aria-pressed={live} onClick={() => setLive((v) => !v)}>
              {live ? '锁定地图' : '缩放与拖动'}
            </button>
          </div>
        </section>
      )}

      <article className="rd-body">
        {model.blocks.map((b) => (
          <BlockView key={b.key} b={b} />
        ))}
        {model.blocks.length === 0 && <p className="muted">这个主题还没有内容。</p>}
      </article>

      <footer className="rd-foot">
        {model.places.length > 0 && (
          <section aria-labelledby="rd-places-h">
            <h2 id="rd-places-h" className="rd-foot-h">
              途经地点
            </h2>
            <ul className="rd-places">
              {model.places.map((p) => (
                <li key={p.id}>
                  <Link href={`/place/${p.id}`} className="rd-place">
                    <CategoryIcon category={p.category} size={16} />
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="rd-actions">
          {model.photoCount > 0 && (
            <Link href={living} className="btn btn-living">
              <Icon name="play" size={14} />
              Living
            </Link>
          )}
          {isOwner && (
            <Link href={editHref} className="btn btn-quiet">
              <Icon name="edit" size={16} />
              编辑
            </Link>
          )}
        </div>
        <MoreFromAuthor theme={theme} />
      </footer>
    </main>
  );
}

export default function ThemeReader() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const { data, error, reload } = useApi<unknown>(id ? `/api/themes/${encodeURIComponent(id)}` : null);
  const theme = unwrapTheme(data);
  useDocumentTitle(theme?.title);
  useScrollTop(id);

  // The cache keeps failures too: a 404 seen while logged out must not outlive logging in.
  const viewer = user?.id;
  useEffect(() => {
    if (error) reload();
    // only when the viewer changes (or on arrival with a stale failure)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer]);

  if (!theme) {
    if (error) return <Missing error={error} reload={reload} />;
    return <p className="loading">加载中</p>;
  }
  return <Reader key={theme.id} theme={theme} isOwner={!!user && user.id === theme.ownerId} />;
}
