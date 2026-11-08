import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import type { PhotoDetail } from '../../shared/types';
import { distance, dms } from '../../shared/geo';
import { enc, unwrap, usePhotoList, useTagTree } from '../browse/api';
import { getBrowseList } from '../browse/context';
import { useDocTitle, useScrollTop } from '../browse/hooks';
import { galleryLink, livingStart } from '../browse/links';
import { NoteText } from '../browse/note';
import { byTakenDesc } from '../browse/sort';
import { fmtTz, LoadError, Loading } from '../browse/ui';
import Img from '../components/Img';
import { CategoryIcon, Icon } from '../components/icons';
import MapView, { type MapPoint, type MapShapes } from '../components/MapView';
import { mediaUrl } from '../lib/api';
import { compass, fmtDay, fmtDistance, fmtTime } from '../lib/format';
import { useSession } from '../lib/session';
import { swatchFill } from '../lib/tags';
import { useApi } from '../lib/useApi';
import '../styles/browse.css';

const MAIN_SIZES = '(max-width: 900px) calc(100vw - 72px), 62vw';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));

/** Warm the cache for the photo the visitor is most likely to open next. */
function preload(p: PhotoDetail) {
  const v = p.variants;
  const im = new Image();
  im.sizes = MAIN_SIZES;
  im.srcset = `${mediaUrl(v.s.key)} ${v.s.w}w, ${mediaUrl(v.m.key)} ${v.m.w}w, ${mediaUrl(v.l.key)} ${v.l.w}w`;
  im.src = mediaUrl(v.m.key);
}

/** Where the photo was taken: its point, the view cone, the matched place and the line between them. */
function PhotoMap({ photo, precise }: { photo: PhotoDetail; precise: boolean }) {
  const { poi, lat, lng, heading } = photo;
  const points = useMemo<MapPoint[]>(() => {
    const pts: MapPoint[] = [];
    if (poi) pts.push({ id: 'poi', lat: poi.lat, lng: poi.lng, label: poi.name });
    if (precise && lat != null && lng != null) pts.push({ id: 'photo', lat, lng });
    return pts;
  }, [poi, precise, lat, lng]);
  const shapes = useMemo<MapShapes>(() => {
    const s: MapShapes = {};
    if (lat == null || lng == null) return s;
    if (!precise) {
      // rounded coordinates: show the ~500 m cell instead of a point
      s.circles = [{ id: 'cell', lat, lng, radius: 300 }];
      return s;
    }
    const d = poi ? distance(lat, lng, poi.lat, poi.lng) : 0;
    if (heading != null) s.cones = [{ id: 'view', lat, lng, heading, radius: d > 0 ? clamp(d * 0.75, 30, 240) : 80 }];
    if (poi) s.lines = [{ id: 'link', coords: [[lat, lng], [poi.lat, poi.lng]], dashed: true }];
    return s;
  }, [poi, precise, lat, lng, heading]);
  if (!points.length && !shapes.circles) return null;
  return <MapView className="pho-map" ariaLabel={poi ? `拍摄位置，${poi.name}` : '拍摄位置'} points={points} shapes={shapes} maxZoom={17} />;
}

/** Other photos at the same place, as a horizontal strip with the current one marked. */
function PoiStrip({ poiId, name, category, currentId }: { poiId: string; name: string; category: string; currentId: string }) {
  const { photos } = usePhotoList(`poi=${enc(poiId)}`);
  const list = useMemo(() => photos?.slice().sort(byTakenDesc), [photos]);
  const box = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = box.current;
    const cur = el?.querySelector<HTMLElement>('[aria-current="true"]');
    if (el && cur) el.scrollLeft = Math.max(0, cur.offsetLeft - (el.clientWidth - cur.clientWidth) / 2);
  }, [list, currentId]);
  if (!list || list.length < 2) return null;
  return (
    <section className="pho-strip" aria-label={`同在${name}`}>
      <div className="pho-strip-head">
        <h2>
          <CategoryIcon category={category} size={20} />
          {name}
          <span className="mono">{list.length}</span>
        </h2>
        <Link href={`/place/${poiId}`} className="pho-strip-all">
          全部
          <Icon name="arrow" size={16} />
        </Link>
      </div>
      <ul ref={box} className="pho-strip-list">
        {list.map((p) => (
          <li key={p.id}>
            <Link
              href={`/p/${p.id}`}
              className="pho-thumb"
              aria-current={p.id === currentId ? 'true' : undefined}
              aria-label={[p.title, fmtDay(p.takenAt)].filter(Boolean).join(' · ') || '照片'}
            >
              <Img photo={p} ratio="1 / 1" sizes="148px" alt="" />
              <span className="mono">{fmtDay(p.takenAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function PhotoPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user } = useSession();

  const detail = useApi<unknown>(id ? `/api/photos/${enc(id)}` : null);
  const loaded = unwrap<PhotoDetail>(detail.data, 'photo');
  // keep the previous photo on screen while the next one loads
  const last = useRef<PhotoDetail | undefined>(undefined);
  useEffect(() => {
    if (loaded) last.current = loaded;
  }, [loaded]);
  const photo = loaded ?? (detail.error ? undefined : last.current);
  const stale = !!photo && photo.id !== id;

  // prev / next: the list the visitor came from, else the gallery order
  const { photos: all } = usePhotoList('');
  const ids = useMemo(() => {
    const ctx = getBrowseList();
    if (ctx && ctx.includes(id)) return ctx;
    return all ? all.slice().sort(byTakenDesc).map((p) => p.id) : [];
  }, [id, all]);
  const idx = ids.indexOf(id);
  const prevId = idx > 0 ? ids[idx - 1] : null;
  const nextId = idx >= 0 && idx < ids.length - 1 ? ids[idx + 1] : null;

  // fetch both neighbours ahead of time so stepping is instant
  const prevDetail = unwrap<PhotoDetail>(useApi<unknown>(prevId ? `/api/photos/${enc(prevId)}` : null).data, 'photo');
  const nextDetail = unwrap<PhotoDetail>(useApi<unknown>(nextId ? `/api/photos/${enc(nextId)}` : null).data, 'photo');
  useEffect(() => {
    if (prevDetail) preload(prevDetail);
    if (nextDetail) preload(nextDetail);
  }, [prevDetail, nextDetail]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target;
      // typing in a field or panning the map with the arrow keys must not turn the page
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('.map-frame'))) return;
      if (e.key === 'ArrowLeft' && prevId) {
        e.preventDefault();
        navigate(`/p/${prevId}`, { replace: true });
      } else if (e.key === 'ArrowRight' && nextId) {
        e.preventDefault();
        navigate(`/p/${nextId}`, { replace: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prevId, nextId, navigate]);

  const { tree } = useTagTree(photo?.ownerHandle, !photo);
  const tagLinks = useMemo(() => {
    if (!photo || !tree) return [];
    const order = new Map<string, number>();
    const walk = (nodes: typeof tree.roots) => {
      for (const n of nodes) {
        order.set(n.id, order.size);
        walk(n.children);
      }
    };
    walk(tree.roots);
    return [...new Set(photo.tagIds)]
      .filter((t) => tree.byId.has(t))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      .map((t) => {
        const node = tree.byId.get(t)!;
        return {
          id: t,
          path: tree.path(t).join(' / '),
          color: node.color,
          // someone's own tags only resolve in their profile gallery
          href: node.ownerId ? galleryLink({ tags: [t] }, photo.ownerHandle) : galleryLink({ tags: [t] })
        };
      });
  }, [photo, tree]);

  const poi = photo?.poi ?? null;
  const title = photo ? photo.title ?? poi?.name ?? photo.city ?? '无题' : null;
  useDocTitle(title);
  useScrollTop(id);

  if (!photo) {
    if (detail.error) {
      return (
        <main className="page bw">
          <LoadError
            error={detail.error}
            onRetry={detail.reload}
            notFound={{ title: '照片不存在', hint: '它可能已被删除，或没有对你公开。', back: { href: '/', label: '回到图库' } }}
          />
        </main>
      );
    }
    return (
      <main className="page bw">
        <Loading />
      </main>
    );
  }

  const isOwner = !!user && user.id === photo.ownerId;
  const precise = isOwner || photo.geoPrivacy === 'exact';
  const hasPos = photo.lat != null && photo.lng != null;
  const poiDistance =
    photo.poiDistance ?? (precise && poi && hasPos ? distance(photo.lat!, photo.lng!, poi.lat, poi.lng) : null);

  const exif: [string, ReactNode][] = [];
  if (photo.camera) exif.push(['相机', photo.camera]);
  if (photo.lens) exif.push(['镜头', photo.lens]);
  if (photo.focal != null || photo.focal35 != null) {
    const parts = [photo.focal != null ? `${num(photo.focal)} mm` : '', photo.focal35 != null ? `等效 ${num(photo.focal35)} mm` : ''];
    exif.push(['焦距', parts.filter(Boolean).join(' · ')]);
  }
  const exposure = [
    photo.aperture != null ? `f/${num(photo.aperture)}` : '',
    photo.shutter ? (/s$/i.test(photo.shutter) ? photo.shutter : `${photo.shutter} s`) : '',
    photo.iso != null ? `ISO ${photo.iso}` : ''
  ].filter(Boolean);
  if (exposure.length) {
    exif.push([
      '曝光',
      <span key="exp" className="pho-exp">
        {exposure.map((x) => (
          <span key={x}>{x}</span>
        ))}
      </span>
    ]);
  }

  const imgRatio = photo.width / photo.height;
  const alt = photo.title ?? poi?.name ?? photo.city ?? '照片';

  return (
    <main className="page bw pho" data-stale={stale ? 'true' : undefined} aria-busy={stale}>
      <div className="pho-bar">
        <nav className="pho-crumb" aria-label="位置">
          <Link href="/">图库</Link>
          {photo.city && (
            <>
              <span aria-hidden="true">/</span>
              <Link href={galleryLink({ city: photo.city })}>{photo.city}</Link>
            </>
          )}
          {poi && (
            <>
              <span aria-hidden="true">/</span>
              <Link href={`/place/${poi.id}`} aria-current="page" className="pho-crumb-here">
                {poi.name}
              </Link>
            </>
          )}
        </nav>
        <div className="pho-actions">
          {isOwner && (
            <Link href={`/studio/photo/${photo.id}`} className="btn btn-quiet pho-edit">
              <Icon name="edit" size={16} />
              编辑
            </Link>
          )}
          <Link href={livingStart(photo.id)} className="btn btn-living pho-living" aria-label="Living，从这张开始播放">
            <Icon name="play" size={16} />
            Living
          </Link>
          <div className="pho-step">
            {prevId ? (
              <Link href={`/p/${prevId}`} replace className="btn btn-ghost btn-icon" aria-label="上一张">
                <Icon name="left" />
              </Link>
            ) : (
              <button type="button" className="btn btn-ghost btn-icon" aria-label="上一张" disabled>
                <Icon name="left" />
              </button>
            )}
            <span className="pho-count mono" aria-live="polite">
              {idx >= 0 ? `${idx + 1} / ${ids.length}` : ''}
            </span>
            {nextId ? (
              <Link href={`/p/${nextId}`} replace className="btn btn-ghost btn-icon" aria-label="下一张">
                <Icon name="right" />
              </Link>
            ) : (
              <button type="button" className="btn btn-ghost btn-icon" aria-label="下一张" disabled>
                <Icon name="right" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="pho-main">
        <div className="pho-mat">
          <Img
            key={photo.id}
            photo={photo}
            alt={alt}
            eager
            sizes={MAIN_SIZES}
            className="pho-img"
            style={{ width: `min(100%, calc(78vh * ${imgRatio.toFixed(5)}))` }}
          />
        </div>

        <aside className="pho-side">
          <div className="pho-head">
            <h1 className="pho-title">{title}</h1>
            <p className="pho-meta mono">
              {photo.takenAt && <span>{fmtDay(photo.takenAt)}</span>}
              {fmtTime(photo.takenAt) && <span>{fmtTime(photo.takenAt)}</span>}
              {photo.tz && photo.takenAt && <span className="pho-tz">{fmtTz(photo.tz)}</span>}
              <Link href={`/@${photo.ownerHandle}`} className="bw-hydro">
                @{photo.ownerHandle}
              </Link>
            </p>
            {isOwner && photo.visibility !== 'public' && (
              <p className="pho-flag">{photo.visibility === 'private' ? '仅自己可见' : '仅链接可见'}</p>
            )}
          </div>

          {photo.note && <NoteText text={photo.note} className="pho-note" />}

          {(poi || hasPos) && (
            <section className="pho-place" aria-label="拍摄位置">
              <PhotoMap photo={photo} precise={precise} />
              {poi && (
                <Link href={`/place/${poi.id}`} className="pho-poi">
                  <CategoryIcon category={poi.category} size={22} />
                  <span className="pho-poi-name">{poi.name}</span>
                  {poiDistance != null && <span className="pho-poi-dist mono">{fmtDistance(poiDistance)}</span>}
                  <Icon name="right" size={18} />
                </Link>
              )}
              <dl className="pho-dl">
                {hasPos && (
                  <>
                    <dt>坐标</dt>
                    <dd className="mono pho-coord">
                      {precise ? (
                        <>
                          <span>{dms(photo.lat!, 'N', 'S', 1)}</span>
                          <span>{dms(photo.lng!, 'E', 'W', 1)}</span>
                          <small>WGS-84</small>
                        </>
                      ) : (
                        <>
                          <span>约 {Math.abs(photo.lat!).toFixed(3)}°{photo.lat! >= 0 ? 'N' : 'S'}</span>
                          <span>{Math.abs(photo.lng!).toFixed(3)}°{photo.lng! >= 0 ? 'E' : 'W'}</span>
                          <small>WGS-84</small>
                        </>
                      )}
                    </dd>
                  </>
                )}
                {photo.heading != null && (
                  <>
                    <dt>朝向</dt>
                    <dd>
                      <span className="mono">{Math.round(photo.heading)}°</span> {compass(photo.heading)}
                    </dd>
                  </>
                )}
              </dl>
              {isOwner && photo.geoPrivacy !== 'exact' && (
                <p className="pho-flag">{photo.geoPrivacy === 'fuzzy' ? '他人看到约 500 米范围' : '他人看不到位置'}</p>
              )}
            </section>
          )}

          {exif.length > 0 && (
            <dl className="pho-dl pho-exif">
              {exif.map(([k, v]) => (
                <div key={k} className="pho-dl-row">
                  <dt>{k}</dt>
                  <dd className="mono">{v}</dd>
                </div>
              ))}
            </dl>
          )}

          {tagLinks.length > 0 && (
            <ul className="pho-tags" aria-label="标签">
              {tagLinks.map((t) => (
                <li key={t.id}>
                  <Link href={t.href} className="pho-tag">
                    {t.color && <i aria-hidden="true" style={{ background: swatchFill(t.color) }} />}
                    {t.path}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {photo.themes.length > 0 && (
            <ul className="pho-themes" aria-label="所属主题">
              {photo.themes.map((t) => (
                <li key={t.id}>
                  <Link href={`/t/${t.id}`}>
                    <Icon name="book" size={16} />
                    {t.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {poi && <PoiStrip poiId={poi.id} name={poi.name} category={poi.category} currentId={photo.id} />}
    </main>
  );
}
