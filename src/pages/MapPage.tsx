import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'wouter';
import type { PhotoSummary, Poi } from '../../shared/types';
import { dms } from '../../shared/geo';
import { usePhotoList, usePoiList, useTagTree } from '../browse/api';
import ChipGroup from '../browse/ChipGroup';
import { setBrowseList } from '../browse/context';
import { lightTags, SEASONS, seasonOf } from '../browse/facets';
import { useBoxSize, useDocTitle, useScrollTop } from '../browse/hooks';
import { livingPlace } from '../browse/links';
import { fitViewport } from '../browse/mapfit';
import SwapMap from '../browse/SwapMap';
import { byTakenDesc } from '../browse/sort';
import { LoadError, Loading } from '../browse/ui';
import { replaceQuery, splitIds, useQuery } from '../browse/url';
import Img from '../components/Img';
import { CategoryIcon, Icon } from '../components/icons';
import type { MapPoint } from '../components/MapView';
import { fmtDay } from '../lib/format';
import '../styles/browse.css';

const PANEL_LIMIT = 24;
const LIST_LIMIT = 14;

interface Marker extends Poi {
  /** visible photos here under the current filters */
  n: number;
}

/** /map — one numbered marker per place with photos; filters recount, the side panel shows the selection. */
export default function MapPage() {
  const { pois, error, reload } = usePoiList();
  const { photos } = usePhotoList('');
  const { tree } = useTagTree();
  const q = useQuery();
  const selectedId = q.get('poi') ?? '';
  const city = q.get('city') ?? '';
  const rawTags = useMemo(() => splitIds(q.get('tags')), [q]);
  useDocTitle('地图');
  useScrollTop(null);

  // filters: one season (the four are exclusive) and any number of light/weather tags, all ANDed
  const lights = useMemo(() => lightTags(tree), [tree]);
  const seasons = useMemo(() => (tree ? SEASONS.filter((s) => tree.byId.has(s.id)) : []), [tree]);
  const selSeason = rawTags.find((t) => seasons.some((s) => s.id === t)) ?? '';
  const selLights = useMemo(() => rawTags.filter((t) => lights.some((l) => l.id === t)), [rawTags, lights]);

  const facts = useMemo(
    () =>
      (photos ?? []).map((p) => {
        const tags = tree ? tree.expand(p.tagIds) : new Set(p.tagIds);
        return { p, tags, season: seasonOf(p, tree, tags) };
      }),
    [photos, tree]
  );
  const matching = useMemo(
    () => facts.filter((f) => (!selSeason || f.season === selSeason) && selLights.every((l) => f.tags.has(l))),
    [facts, selSeason, selLights]
  );
  // availability: seasons are judged against the light choice only, lights against everything chosen
  const avail = useMemo(() => {
    const seasonOk = new Set<string>();
    const lightOk = new Set<string>();
    for (const f of facts) {
      if (!selLights.every((l) => f.tags.has(l))) continue;
      seasonOk.add(f.season);
      if (selSeason && f.season !== selSeason) continue;
      for (const l of lights) if (f.tags.has(l.id)) lightOk.add(l.id);
    }
    return { seasonOk, lightOk };
  }, [facts, selSeason, selLights, lights]);

  const markers = useMemo<Marker[]>(() => {
    if (!pois) return [];
    const total = new Map<string, number>();
    const now = new Map<string, number>();
    for (const f of facts) if (f.p.poiId) total.set(f.p.poiId, (total.get(f.p.poiId) ?? 0) + 1);
    for (const f of matching) if (f.p.poiId) now.set(f.p.poiId, (now.get(f.p.poiId) ?? 0) + 1);
    // counts come from the public photo list so they always agree with the thumbnails; the places
    // endpoint's own count is only a fallback while that list is unavailable
    return pois
      .filter((p) => (photos ? (total.get(p.id) ?? 0) > 0 : (p.count ?? 0) > 0))
      .map((p) => ({ ...p, n: photos ? (now.get(p.id) ?? 0) : (p.count ?? 0) }));
  }, [pois, photos, facts, matching]);

  const cities = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of markers) if (m.city) n.set(m.city, (n.get(m.city) ?? 0) + 1);
    return [...n.keys()].sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || a.localeCompare(b, 'zh-CN'));
  }, [markers]);

  // On phones the panel sits under the map: after a pick, bring it into view
  const panelRef = useRef<HTMLElement>(null);
  const picked = useRef(false);
  const select = useCallback(
    (id: string) => {
      picked.current = id !== selectedId;
      replaceQuery({ poi: id === selectedId ? null : id });
    },
    [selectedId]
  );
  const selected = markers.find((m) => m.id === selectedId);
  useEffect(() => {
    if (!picked.current || !selected) return;
    picked.current = false;
    if (window.matchMedia('(max-width: 900px)').matches) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selected]);

  const points = useMemo<MapPoint[]>(
    () =>
      markers.map((m) => ({
        id: m.id,
        lat: m.lat,
        lng: m.lng,
        count: m.n,
        label: m.name,
        selected: m.id === selectedId,
        muted: m.n === 0,
        onClick: () => select(m.id)
      })),
    [markers, selectedId, select]
  );

  // The starting view contains the markers (of the chosen city); it is fixed per city so that
  // clicking markers or chips never moves the map under the visitor's hands.
  const [boxRef, size] = useBoxSize<HTMLDivElement>();
  const viewport = useMemo(() => {
    if (!size) return null;
    const of = city ? markers.filter((m) => m.city === city) : markers;
    return fitViewport(
      (of.length ? of : markers).map((m) => [m.lat, m.lng]),
      size,
      { padding: 56, right: 96, maxZoom: 15 }
    );
    // `markers` is left out of the dependencies on purpose: it changes with every filter, while the view follows only the data set and the city
  }, [size, city, pois]);

  const panelPhotos = useMemo<PhotoSummary[]>(
    () =>
      selected
        ? matching
            .filter((f) => f.p.poiId === selected.id)
            .map((f) => f.p)
            .sort(byTakenDesc)
        : [],
    [selected, matching]
  );
  useEffect(() => {
    setBrowseList(selected ? panelPhotos.map((p) => p.id) : null);
  }, [selected, panelPhotos]);

  const setTags = (season: string, ls: readonly string[]) => replaceQuery({ tags: [season, ...ls].filter(Boolean).join(',') });
  const filtering = !!selSeason || selLights.length > 0;
  const topPlaces = useMemo(
    () =>
      markers
        .filter((m) => !city || m.city === city)
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'zh-CN'))
        .slice(0, LIST_LIMIT),
    [markers, city]
  );

  if (error) {
    return (
      <main className="page bw">
        <LoadError error={error} onRetry={reload} />
      </main>
    );
  }

  return (
    <main className="page bw mpg">
      <div className="mpg-top">
        <div className="mpg-title">
          <h1 className="display mpg-h1">地图</h1>
          {cities.length > 0 && (
            <div className="mpg-cities" role="group" aria-label="城市">
              <button type="button" className="gal-city" aria-pressed={!city} onClick={() => replaceQuery({ city: null })}>
                全部
              </button>
              {cities.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="gal-city"
                  aria-pressed={city === c}
                  onClick={() => replaceQuery({ city: city === c ? null : c })}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mpg-filters">
          <ChipGroup
            label="季节"
            chips={seasons.map((s) => ({ id: s.id, label: s.label, disabled: !avail.seasonOk.has(s.id) }))}
            selected={selSeason ? [selSeason] : []}
            onPick={(id) => setTags(id === selSeason ? '' : id, selLights)}
          />
          {seasons.length > 0 && lights.length > 0 && <span className="divider-v" aria-hidden="true" />}
          <ChipGroup
            label="光与天气"
            chips={lights.map((l) => ({ id: l.id, label: l.name, disabled: !avail.lightOk.has(l.id) }))}
            selected={selLights}
            onPick={(id) => setTags(selSeason, selLights.includes(id) ? selLights.filter((x) => x !== id) : [...selLights, id])}
          />
          {filtering && (
            <button type="button" className="gal-clear" onClick={() => replaceQuery({ tags: null })}>
              <Icon name="close" size={14} />
              清除
            </button>
          )}
        </div>
      </div>

      <div className="mpg-body">
        <div ref={boxRef} className="mpg-map">
          {pois && size ? (
            <SwapMap viewKey={city || 'all'} viewport={viewport} ariaLabel="有照片的地点" points={points} />
          ) : (
            <Loading label="地图加载中" />
          )}
          {pois && photos && markers.length === 0 && <p className="mpg-none">还没有带位置的照片</p>}
        </div>

        <aside ref={panelRef} className="mpg-panel" aria-label="地点">
          <p className="visually-hidden" role="status">
            {selected ? `${selected.name}，${selected.n} 张` : ''}
          </p>
          {selected ? (
            <>
              <div className="mpg-sel">
                <p className="mpg-kind">
                  <CategoryIcon category={selected.category} size={20} />
                  {[selected.category, selected.district, selected.city].filter(Boolean).join(' · ')}
                </p>
                <h2 className="mpg-name">{selected.name}</h2>
                <p className="mpg-coord mono">
                  {dms(selected.lat, 'N', 'S', 1)} {dms(selected.lng, 'E', 'W', 1)}
                </p>
              </div>
              <p className="gal-count mpg-count">
                <span className="gal-count-n mpg-count-n">{selected.n}</span>
                <span className="gal-count-u">张</span>
              </p>
              {panelPhotos.length > 0 ? (
                <ul className="mpg-grid">
                  {panelPhotos.slice(0, PANEL_LIMIT).map((p) => (
                    <li key={p.id}>
                      <Link href={`/p/${p.id}`} aria-label={[p.title, fmtDay(p.takenAt)].filter(Boolean).join(' · ') || '照片'}>
                        <Img photo={p} ratio="1 / 1" sizes="(max-width: 640px) 30vw, 130px" alt="" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">这里没有符合筛选的照片</p>
              )}
              {panelPhotos.length > PANEL_LIMIT && (
                <p className="muted small mono">
                  {PANEL_LIMIT} / {panelPhotos.length}
                </p>
              )}
              <Link href={`/place/${selected.id}`} className="btn btn-primary mpg-open">
                打开地点
                <Icon name="arrow" size={18} />
              </Link>
              <Link href={livingPlace(selected.id)} className="btn btn-living mpg-living" aria-label={`Living，播放${selected.name}的照片`}>
                <Icon name="play" size={16} />
                Living
              </Link>
            </>
          ) : (
            <>
              <p className="mpg-hint">选择地图上的地点</p>
              <ol className="mpg-list">
                {topPlaces.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => select(m.id)} data-muted={m.n === 0 ? 'true' : undefined}>
                      <CategoryIcon category={m.category} size={17} />
                      <span className="mpg-list-name">{m.name}</span>
                      <span className="mpg-list-dots" aria-hidden="true" />
                      <span className="mono">{m.n}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
