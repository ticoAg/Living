import { useEffect, useMemo, type CSSProperties } from 'react';
import { Link, useParams } from 'wouter';
import type { PhotoSummary, Poi } from '../../shared/types';
import { dms } from '../../shared/geo';
import { enc, usePhotoList, useTagTree } from '../browse/api';
import ChipGroup from '../browse/ChipGroup';
import { setBrowseList } from '../browse/context';
import { DAY_PARTS, partOf, seasonOf, SEASONS } from '../browse/facets';
import { useDocTitle, useScrollTop } from '../browse/hooks';
import { livingPlace } from '../browse/links';
import PlaceTile from '../browse/PlaceTile';
import { byTakenDesc } from '../browse/sort';
import { EmptyState, LoadError, Loading, spanText } from '../browse/ui';
import { replaceQuery, useQuery } from '../browse/url';
import Img from '../components/Img';
import { CategoryIcon, Icon } from '../components/icons';
import MapView, { type MapPoint, type MapShapes } from '../components/MapView';
import { fmtDistance } from '../lib/format';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import '../styles/browse.css';

type Nearby = Poi & { distance: number };

/** /place/:id — one place: map with its matching radius and every shot position, filters, photos, neighbours. */
export default function Place() {
  const { id = '' } = useParams<{ id: string }>();
  const { user } = useSession();
  const res = useApi<{ poi: Poi; nearby?: Nearby[] }>(id ? `/api/pois/${enc(id)}` : null);
  const { photos } = usePhotoList(id ? `poi=${enc(id)}` : null);
  // everyone's photos: thumbnails and counts for the neighbouring places
  const { photos: everyone } = usePhotoList('');
  const { tree } = useTagTree();
  const q = useQuery();
  const part = q.get('part') ?? '';
  const season = q.get('season') ?? '';

  const poi = res.data?.poi;
  const nearby = res.data?.nearby;
  useDocTitle(poi?.name);
  useScrollTop(id);

  const rows = useMemo(
    () => (photos ?? []).slice().sort(byTakenDesc).map((p) => ({ p, part: partOf(p), season: seasonOf(p, tree) })),
    [photos, tree]
  );
  const visible = useMemo(() => rows.filter((r) => (!part || r.part === part) && (!season || r.season === season)), [rows, part, season]);
  // a chip is disabled when choosing it (with the other group's choice kept) would leave nothing
  const partHas = useMemo(() => new Set(rows.filter((r) => !season || r.season === season).map((r) => r.part)), [rows, season]);
  const seasonHas = useMemo(() => new Set(rows.filter((r) => !part || r.part === part).map((r) => r.season)), [rows, part]);
  const showOwner = useMemo(() => new Set(rows.map((r) => r.p.ownerHandle)).size > 1, [rows]);

  useEffect(() => {
    setBrowseList(visible.map((r) => r.p.id));
  }, [visible]);

  const visibleIds = useMemo(() => new Set(visible.map((r) => r.p.id)), [visible]);
  const myId = user?.id;
  const shot = useMemo(
    () => rows.map((r) => r.p).filter((p) => p.lat != null && p.lng != null && (p.geoPrivacy === 'exact' || p.ownerId === myId)),
    [rows, myId]
  );
  const points = useMemo<MapPoint[]>(() => {
    if (!poi) return [];
    return [
      { id: 'poi', lat: poi.lat, lng: poi.lng, label: poi.name },
      ...shot.map((p) => ({ id: p.id, lat: p.lat!, lng: p.lng!, muted: !visibleIds.has(p.id) }))
    ];
  }, [poi, shot, visibleIds]);
  const shapes = useMemo<MapShapes>(() => {
    if (!poi) return {};
    const len = Math.max(25, Math.min(poi.radius * 0.45, 140));
    return {
      circles: [{ id: 'radius', lat: poi.lat, lng: poi.lng, radius: poi.radius }],
      cones: shot
        .filter((p) => p.heading != null)
        .map((p) => ({ id: p.id, lat: p.lat!, lng: p.lng!, heading: p.heading!, radius: len, muted: !visibleIds.has(p.id) }))
    };
  }, [poi, shot, visibleIds]);

  const thumbs = useMemo(() => {
    const first = new Map<string, PhotoSummary>();
    const count = new Map<string, number>();
    for (const p of everyone ?? []) {
      if (!p.poiId) continue;
      if (!first.has(p.poiId)) first.set(p.poiId, p);
      count.set(p.poiId, (count.get(p.poiId) ?? 0) + 1);
    }
    return { first, count };
  }, [everyone]);

  if (res.error) {
    return (
      <main className="page bw">
        <LoadError
          error={res.error}
          onRetry={res.reload}
          notFound={{ title: '地点不存在', hint: '它可能已被合并或删除。', back: { href: '/map', label: '回到地图' } }}
        />
      </main>
    );
  }
  if (!poi) {
    return (
      <main className="page bw">
        <Loading />
      </main>
    );
  }

  const filtering = !!part || !!season;
  const nameStyle = { '--n': Math.max(1, [...poi.name].length) } as CSSProperties;
  const kind = [poi.category, poi.district, poi.city].filter(Boolean).join(' · ');

  return (
    <main className="page bw plc">
      <nav className="plc-crumb" aria-label="位置">
        <Link href="/map">地图</Link>
        {poi.city && (
          <>
            <span aria-hidden="true">/</span>
            <Link href={`/map?city=${enc(poi.city)}`}>{poi.city}</Link>
          </>
        )}
        {poi.district && (
          <>
            <span aria-hidden="true">/</span>
            <span>{poi.district}</span>
          </>
        )}
      </nav>

      <section className="plc-top">
        <div className="plc-info">
          <div className="plc-id">
            <p className="plc-kind">
              <CategoryIcon category={poi.category} size={20} />
              {kind}
            </p>
            <h1 className="display display-xl plc-name" style={nameStyle}>
              {poi.name}
            </h1>
            <p className="plc-coord mono">
              <span>{dms(poi.lat, 'N', 'S', 1)}</span>
              <span>{dms(poi.lng, 'E', 'W', 1)}</span>
            </p>
            <Link
              href={livingPlace(poi.id)}
              className="btn btn-primary btn-living plc-living"
              aria-label={`Living，播放${poi.name}的 ${rows.length} 张照片`}
            >
              <Icon name="play" size={16} />
              Living
            </Link>
          </div>
          <dl className="plc-stats">
            <div>
              <dt>照片</dt>
              <dd className="plc-stat-n">{photos ? rows.length : '—'}</dd>
            </div>
            <div>
              <dt>时间跨度</dt>
              <dd className="mono">{spanText(rows.map((r) => r.p.takenAt))}</dd>
            </div>
            <div>
              <dt>匹配半径</dt>
              <dd className="mono">{fmtDistance(poi.radius)}</dd>
            </div>
          </dl>
        </div>
        <MapView className="plc-map" ariaLabel={`${poi.name}周边：匹配半径与拍摄位置`} points={points} shapes={shapes} maxZoom={18} />
      </section>

      {rows.length > 1 && (
        <div className="plc-filters">
          <ChipGroup
            label="时段"
            chips={DAY_PARTS.map((d) => ({ id: d, label: d, disabled: !partHas.has(d) }))}
            selected={part ? [part] : []}
            onPick={(d) => replaceQuery({ part: d === part ? null : d })}
          />
          <span className="divider-v" aria-hidden="true" />
          <ChipGroup
            label="季节"
            chips={SEASONS.map((s) => ({ id: s.id, label: s.label, disabled: !seasonHas.has(s.id) }))}
            selected={season ? [season] : []}
            onPick={(s) => replaceQuery({ season: s === season ? null : s })}
          />
          {filtering && (
            <span className="plc-shown mono" aria-live="polite">
              {visible.length} / {rows.length} 张
            </span>
          )}
        </div>
      )}

      {!photos ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState title="这里还没有公开的照片" />
      ) : visible.length === 0 ? (
        <EmptyState title="没有符合的照片">
          <button type="button" className="btn" onClick={() => replaceQuery({ part: null, season: null })}>
            清除筛选
          </button>
        </EmptyState>
      ) : (
        <div className="gal-masonry plc-masonry">
          {visible.map((r) => (
            <PlaceTile key={r.p.id} photo={r.p} showOwner={showOwner} />
          ))}
        </div>
      )}

      {nearby && nearby.length > 0 && (
        <section className="plc-near" aria-labelledby="plc-near-h">
          <h2 id="plc-near-h" className="bw-h2">
            附近
          </h2>
          <ul>
            {nearby.map((n) => {
              const thumb = thumbs.first.get(n.id);
              const count = n.count ?? thumbs.count.get(n.id);
              return (
                <li key={n.id}>
                  <Link href={`/place/${n.id}`} className="plc-near-item">
                    <span className="plc-near-thumb">{thumb ? <Img photo={thumb} ratio="1 / 1" sizes="72px" alt="" /> : <CategoryIcon category={n.category} size={24} />}</span>
                    <span className="plc-near-text">
                      <span className="plc-near-name">
                        <CategoryIcon category={n.category} />
                        {n.name}
                      </span>
                      <span className="plc-near-meta mono">
                        <span>{fmtDistance(n.distance)}</span>
                        {count != null && <span>{count} 张</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
