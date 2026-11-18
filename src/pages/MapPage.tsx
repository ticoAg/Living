import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ENTRY_TYPE_LABELS } from '../../shared/entries';
import { dms } from '../../shared/geo';
import { ENTRY_TYPES, type EntrySummary, type EntryType, type PhotoSummary } from '../../shared/types';
import {
  albumOf,
  areaOfRef,
  buildEntryIndex,
  buildIndex,
  coversOf,
  layoutAt,
  LEVEL_ZOOM,
  overview,
  partsOf,
  refOfArea,
  zoomTarget,
  type Album,
  type AlbumIndex,
  type Unit
} from '../browse/albums';
import { usePhotoList, usePoiList, useTagTree } from '../browse/api';
import ChipGroup from '../browse/ChipGroup';
import { setBrowseList } from '../browse/context';
import { lightTags, SEASONS, seasonOf } from '../browse/facets';
import { useBoxSize, useDocTitle, useScrollTop } from '../browse/hooks';
import LibraryTabs from '../browse/LibraryTabs';
import { livingForFilter, livingPlace } from '../browse/links';
import { fitViewport } from '../browse/mapfit';
import { shortCity, shortProvince } from '../browse/regions';
import SwapMap from '../browse/SwapMap';
import { byTakenDesc } from '../browse/sort';
import { FilterToggle, LoadError, Loading, spanText, TruncatedNote } from '../browse/ui';
import { replaceQuery, splitIds, useQuery } from '../browse/url';
import Img from '../components/Img';
import { CategoryIcon, Icon } from '../components/icons';
import type { AlbumMark, AlbumSize, AlbumSource, MapTarget } from '../components/mapAlbums';
import { fmtCount } from '../components/mapAlbums';
import { useEntryList, usePhotosById } from '../entries/api';
import EntryCard, { entryHref } from '../entries/EntryCard';
import { fmtDay } from '../lib/format';
import { useVisitor } from '../lib/visitor';
import '../styles/browse.css';
import '../styles/entries.css';

const PANEL_LIMIT = 24;
const ENTRY_PANEL_LIMIT = 12;
const LIST_LIMIT = 14;
/** city shortcuts above the map; the panel's list reaches the rest */
const CITY_LIMIT = 6;
/** the deepest zoom the map starts at without a linked album: the last of the county level */
const OVERVIEW_ZOOM = LEVEL_ZOOM.place - 1;
/** the entries layer: everyone's finished public entries that the map can place */
const LOCATED = '/api/entries?located=1';

const SIZE: Record<Album['type'], AlbumSize> = { region: 'xl', province: 'xl', city: 'l', county: 'm', place: 's', spot: 's', photo: 'xs' };

type Layer = 'photos' | 'entries';
type Item = PhotoSummary | EntrySummary;
const isEntry = (item: Item): item is EntrySummary => 'occurredAt' in item;
const isPhoto = (item: Item): item is PhotoSummary => !isEntry(item);
const dayOf = (item: Item) => (isEntry(item) ? item.occurredAt : item.takenAt);
const UNIT: Record<Layer, string> = { photos: '张', entries: '条' };
const byOccurredDesc = (a: EntrySummary, b: EntrySummary) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id);

/** What a screen reader and the panel call an album without a name of its own. */
function nameOf(a: Album<Item>, layer: Layer): string {
  if (a.name) return a.name;
  if (a.type === 'photo') return layer === 'entries' ? '记录' : '照片';
  return layer === 'entries' ? '一处地方' : '一处拍摄地';
}

/** The line above the name: what the album lies in (浙江 · 杭州), a region's provinces, one item's day and place. */
function kindOf(a: Album<Item>, parts: ReturnType<typeof partsOf<Item>>): string {
  if (a.type === 'region')
    return (parts?.units ?? [])
      .slice(0, 3)
      .map((u) => u.label)
      .join(' · ');
  if (a.type === 'photo') {
    const s = a.spots[0];
    return [fmtDay(dayOf(s.item)), s.poi?.name, s.county].filter(Boolean).join(' · ');
  }
  return a.parents.map((p, i) => (i === 0 ? shortProvince(p) : i === 1 ? shortCity(p) : p)).join(' · ');
}

/** The same album, whatever zoom it was picked at: by what it selects, else by what it holds. */
function sameAlbum(a: Album<Item>, b: Album<Item>): boolean {
  if (a.ref || b.ref) return a.ref === b.ref;
  return a.spots.length === b.spots.length && a.spots.every((s, i) => s === b.spots[i]);
}

const NO_ALBUMS: AlbumSource = { at: () => [], pick: () => null };

/**
 * /map — the located photos as albums (小图册): provinces zoomed out, then cities, counties, places and single photos;
 * each turns through a few of its photos and shows how many it holds. Filters recount them, the side panel shows the
 * chosen album with its parts. `?layer=entries` shows the located entries the same way. Spec:
 * docs/product/features/map.md
 */
export default function MapPage() {
  const { pois, byId: poiById, error: poisError } = usePoiList();
  const { photos, truncated, error, reload } = usePhotoList('');
  const { tree } = useTagTree();
  const q = useQuery();
  const layer: Layer = q.get('layer') === 'entries' ? 'entries' : 'photos';
  const onEntries = layer === 'entries';
  const poiParam = q.get('poi') ?? '';
  const areaParam = q.get('area') ?? '';
  const city = q.get('city') ?? '';
  const rawTags = useMemo(() => splitIds(q.get('tags')), [q]);
  const typeParam = q.get('type') ?? '';
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
  const matchingPhotos = useMemo(
    () => new Set(facts.filter((f) => (!selSeason || f.season === selSeason) && selLights.every((l) => f.tags.has(l))).map((f) => f.p.id)),
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

  // The albums are laid out from every located photo, so filters change counts and covers, never the layout.
  // Places only lend a position and a name; without them (failed request) photos with coordinates still show.
  const photoIndex = useMemo<AlbumIndex | null>(
    () => (photos && (pois || poisError) ? buildIndex(photos, poiById) : null),
    [photos, pois, poisError, poiById]
  );

  // The entries layer, asked for once it is shown: the entries with the photos they show, which are mostly in the
  // photo list above; the rest (unlisted ones, one's own private ones) are asked for by id. The located photos lend
  // provinces to the cities of the entries' places.
  const located = useEntryList(onEntries ? LOCATED : null);
  const listed = useMemo(() => new Map((photos ?? []).map((p) => [p.id, p])), [photos]);
  const missing = useMemo(
    () => (photos && located.entries ? located.entries.flatMap((e) => e.photoIds).filter((id) => !listed.has(id)) : []),
    [photos, located.entries, listed]
  );
  const extra = usePhotosById(missing);
  const entryPhotos = useMemo(() => (extra.byId.size ? new Map([...listed, ...extra.byId]) : listed), [listed, extra.byId]);
  const entryIndex = useMemo(
    () => (located.entries && photoIndex && extra.done ? buildEntryIndex(located.entries, entryPhotos, poiById, photoIndex.spots) : null),
    [located.entries, photoIndex, extra.done, entryPhotos, poiById]
  );
  const typesHere = useMemo(() => new Set(entryIndex?.spots.map((s) => s.item.type)), [entryIndex]);
  const selType = (ENTRY_TYPES as readonly string[]).includes(typeParam) ? (typeParam as EntryType) : null;
  const matchingEntries = useMemo(
    () => new Set((entryIndex?.spots ?? []).filter((s) => !selType || s.item.type === selType).map((s) => s.id)),
    [entryIndex, selType]
  );

  const index: AlbumIndex<Item> | null = onEntries ? entryIndex : photoIndex;
  const matching = onEntries ? matchingEntries : matchingPhotos;
  const unit = UNIT[layer];

  // The selection: a unit named in the address bar (?poi=, ?area=), or an album that is only a merge on screen.
  const [loose, setLoose] = useState<Album<Item> | null>(null);
  useEffect(() => setLoose(null), [index]);
  const ref = poiParam ? `pl:${poiParam}` : refOfArea(areaParam);
  const selected = useMemo(() => (index && ref ? albumOf(index, ref) : loose), [index, ref, loose]);
  const selIds = useMemo(() => new Set(selected?.spots.map((s) => s.id)), [selected]);

  // On phones the panel sits under the map: after a pick that leaves the map where it is, bring the panel into view
  const panelRef = useRef<HTMLElement>(null);
  const picked = useRef(false);
  const select = useCallback((album: Album<Item> | null, reveal = false) => {
    picked.current = reveal && !!album;
    const area = album ? areaOfRef(album.ref) : null;
    if (album?.ref.startsWith('pl:')) replaceQuery({ poi: album.ref.slice(3), area: null });
    else if (area !== null) replaceQuery({ area, poi: null });
    else replaceQuery({ poi: null, area: null });
    setLoose(album && (album.ref.startsWith('pl:') || area !== null) ? null : album);
  }, []);
  useEffect(() => {
    if (!picked.current || !selected) return;
    picked.current = false;
    if (window.matchMedia('(max-width: 900px)').matches) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selected]);

  // The starting view holds the album a link names, else what the layer shows (of the chosen city); it is fixed per
  // city so that picking albums, filters or the other layer never moves the map under the visitor's hands. Going to
  // a part from the panel is asked for through `target`.
  const [boxRef, size] = useBoxSize<HTMLDivElement>();
  const linked = useRef(ref);
  const viewport = useMemo(() => {
    if (!size || !index) return null;
    const first = !city && linked.current ? albumOf(index, linked.current) : null;
    const of = first ? first.spots : city ? index.spots.filter((s) => s.city && shortCity(s.city) === city) : index.spots;
    // an overview starts no deeper than the counties, where every album has a name; a linked album at its own zoom
    return fitViewport(
      (of.length ? of : index.spots).map((s) => [s.lat, s.lng]),
      size,
      { padding: 72, maxZoom: first ? 15 : OVERVIEW_ZOOM, singleZoom: first ? 15 : OVERVIEW_ZOOM }
    );
  }, [size, city, index]);
  // once a city has been chosen, 全部 means all of the layer again, not the album the page was opened with
  useEffect(() => {
    if (city) linked.current = '';
  }, [city]);
  const [target, setTarget] = useState<(MapTarget & { id: number }) | null>(null);
  const goTo = useCallback(
    (album: Album<Item>) => {
      if (!size) return;
      const v = fitViewport(
        album.spots.map((s) => [s.lat, s.lng]),
        size,
        { padding: 72, maxZoom: 15 }
      );
      if (v) setTarget((t) => ({ id: (t?.id ?? 0) + 1, lat: v.center[0], lng: v.center[1], zoom: v.zoom }));
    },
    [size]
  );
  const open = useCallback(
    (u: Unit<Item>) => {
      if (!index) return;
      const album = albumOf(index, u.ref);
      if (!album) return;
      select(album);
      goTo(album);
    },
    [index, select, goTo]
  );

  const source = useMemo<AlbumSource | null>(() => {
    if (!index) return null;
    const marks = new Map<number, AlbumMark[]>();
    // the two layers' albums never share a marker, so switching layers draws each afresh
    const prefix = onEntries ? 'e:' : '';
    const mark = (a: Album<Item>): AlbumMark => {
      const count = a.spots.reduce((n, s) => n + (matching.has(s.id) ? 1 : 0), 0);
      return {
        key: prefix + a.key,
        lat: a.lat,
        lng: a.lng,
        size: SIZE[a.type],
        label: a.label,
        count,
        total: a.spots.length,
        kind: onEntries ? 'entry' : 'photo',
        covers: coversOf(a.spots, (s) => matching.has(s.id)),
        selected: selIds.size > 0 && a.spots.some((s) => selIds.has(s.id)),
        muted: count === 0,
        title: `${nameOf(a, layer)}，${count} ${unit}`
      };
    };
    return {
      at(z) {
        let list = marks.get(z);
        if (!list) {
          list = layoutAt(index, z).map(mark);
          marks.set(z, list);
        }
        return list;
      },
      pick(key, z, view) {
        const album = layoutAt(index, z).find((a) => prefix + a.key === key);
        if (!album) return null;
        const to = zoomTarget(index, album, z, view);
        // picking the chosen album again lets go of it, unless it opens up further
        if (!to && selected && sameAlbum(selected, album)) select(null);
        else select(album, !to);
        return to;
      },
      target
    };
  }, [index, onEntries, layer, unit, matching, selIds, selected, select, target]);
  // Once the map is up it stays while the other layer loads, rather than starting over where that layer would
  const [mapShown, setMapShown] = useState(false);
  useEffect(() => {
    if (source) setMapShown(true);
  }, [source]);

  const panelItems = useMemo(
    () => (selected ? selected.spots.map((s) => s.item).filter((item) => matching.has(item.id)) : []),
    [selected, matching]
  );
  const panelPhotos = useMemo(() => panelItems.filter(isPhoto).sort(byTakenDesc), [panelItems]);
  const panelEntries = useMemo(() => panelItems.filter(isEntry).sort(byOccurredDesc), [panelItems]);
  const visitor = useVisitor();
  useEffect(() => {
    setBrowseList(selected && !onEntries ? panelPhotos.map((p) => p.id) : null, visitor);
  }, [selected, onEntries, panelPhotos, visitor]);

  const cities = useMemo(() => {
    const n = new Map<string, number>();
    for (const s of index?.spots ?? []) if (s.city) n.set(shortCity(s.city), (n.get(shortCity(s.city)) ?? 0) + 1);
    const list = [...n.keys()].sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || a.localeCompare(b, 'zh-CN')).slice(0, CITY_LIMIT);
    return city && n.has(city) && !list.includes(city) ? [...list, city] : list;
  }, [index, city]);
  const top = useMemo(() => (index ? overview(index) : null), [index]);
  const parts = useMemo(() => (selected ? partsOf(selected) : null), [selected]);
  const countIn = (u: Unit<Item>) => u.spots.reduce((n, s) => n + (matching.has(s.id) ? 1 : 0), 0);

  const setTags = (season: string, ls: readonly string[]) => replaceQuery({ tags: [season, ...ls].filter(Boolean).join(',') });
  const filterCount = onEntries ? (selType ? 1 : 0) : (selSeason ? 1 : 0) + selLights.length;
  const hasFilters = onEntries ? typesHere.size > 1 || !!selType : seasons.length > 0 || lights.length > 0;
  // phones fold the filter chips behind a button, so the map gets the screen
  const [filterOpen, setFilterOpen] = useState(false);
  const filterId = useId();

  const failed = error ?? (onEntries ? (located.error ?? extra.error) : undefined);
  if (failed) {
    return (
      <main className="page bw">
        <LoadError
          error={failed}
          onRetry={() => {
            if (error) reload();
            if (located.error) located.reload();
            if (extra.error) extra.reload();
          }}
        />
      </main>
    );
  }

  const poi = selected?.type === 'place' && !selected.merged ? selected.spots[0]?.poi : null;
  // a single photo or entry, outside a place, opens itself
  const one = selected && !poi && selected.spots.length === 1 ? selected.spots[0].item : null;
  const kind = selected ? kindOf(selected, parts) : '';
  const shownCount = onEntries ? panelEntries.length : panelPhotos.length;
  const authors = new Set(panelEntries.map((e) => e.ownerId)).size;

  return (
    <main className="page bw mpg">
      <LibraryTabs />
      <div className="mpg-top">
        <div className="mpg-title">
          <h1 className="display mpg-h1">地图</h1>
          <div className="seg mpg-layers" role="group" aria-label="图层">
            <button type="button" aria-pressed={!onEntries} onClick={() => replaceQuery({ layer: null })}>
              照片
            </button>
            <button type="button" aria-pressed={onEntries} onClick={() => replaceQuery({ layer: 'entries' })}>
              记录
            </button>
          </div>
          {cities.length > 1 && (
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
        {hasFilters && <FilterToggle open={filterOpen} onToggle={() => setFilterOpen((o) => !o)} count={filterCount} controls={filterId} />}
        <div className="mpg-filters" id={filterId} data-open={filterOpen}>
          {onEntries ? (
            hasFilters && (
              <ChipGroup
                label="类型"
                chips={ENTRY_TYPES.filter((t) => typesHere.has(t) || t === selType).map((t) => ({ id: t, label: ENTRY_TYPE_LABELS[t] }))}
                selected={selType ? [selType] : []}
                onPick={(id) => replaceQuery({ type: id === selType ? null : id })}
              />
            )
          ) : (
            <>
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
            </>
          )}
          {filterCount > 0 && (
            <button type="button" className="gal-clear" onClick={() => replaceQuery(onEntries ? { type: null } : { tags: null })}>
              <Icon name="close" size={14} />
              清除
            </button>
          )}
        </div>
        {(onEntries ? located.truncated : truncated) && <TruncatedNote className="mpg-limit" />}
      </div>

      <div className="mpg-body">
        <div ref={boxRef} className="mpg-map">
          {size && (source || mapShown) ? (
            <SwapMap
              viewKey={city || 'all'}
              viewport={viewport}
              ariaLabel={onEntries ? '记录图集' : '照片图集'}
              albums={source ?? NO_ALBUMS}
            />
          ) : (
            <Loading label="地图加载中" />
          )}
          {index && index.spots.length === 0 && <p className="mpg-none">{onEntries ? '还没有带位置的记录' : '还没有带位置的照片'}</p>}
        </div>

        <aside ref={panelRef} className="mpg-panel" aria-label="图集">
          <p className="visually-hidden" role="status">
            {selected ? `${nameOf(selected, layer)}，${shownCount} ${unit}` : ''}
          </p>
          {selected ? (
            <>
              <div className="mpg-sel">
                {(poi || kind) && (
                  <p className="mpg-kind">
                    {poi && <CategoryIcon category={poi.category} size={20} />}
                    {poi ? [poi.category, poi.district, poi.city].filter(Boolean).join(' · ') : kind}
                  </p>
                )}
                {selected.name ? (
                  <h2 className="mpg-name">{selected.name}</h2>
                ) : (
                  <h2 className="mpg-name mpg-name-coord mono">
                    {dms(selected.lat, 'N', 'S')} {dms(selected.lng, 'E', 'W')}
                  </h2>
                )}
                {selected.name && (
                  <p className="mpg-coord mono">
                    {dms(selected.lat, 'N', 'S', 1)} {dms(selected.lng, 'E', 'W', 1)}
                  </p>
                )}
              </div>
              <p className="gal-count mpg-count">
                <span className="gal-count-n mpg-count-n">{fmtCount(shownCount)}</span>
                <span className="gal-count-u">{unit}</span>
                {shownCount > 0 && <span className="mpg-span mono">{spanText(panelItems.map(dayOf))}</span>}
              </p>
              {parts && parts.units.length > 1 && (
                <ol className="mpg-list mpg-parts">
                  {parts.units.slice(0, LIST_LIMIT).map((u) => {
                    const n = countIn(u);
                    return (
                      <li key={u.ref}>
                        <button type="button" onClick={() => open(u)} data-muted={n === 0 ? 'true' : undefined}>
                          {parts.level === 'place' && <CategoryIcon category={u.spots[0]?.poi?.category} size={17} />}
                          <span className="mpg-list-name">{u.label}</span>
                          <span className="mpg-list-dots" aria-hidden="true" />
                          <span className="mono">{fmtCount(n)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
              {onEntries ? (
                panelEntries.length > 0 ? (
                  <ul className="en-list mpg-entries">
                    {panelEntries.slice(0, ENTRY_PANEL_LIMIT).map((e) => (
                      <li key={e.id}>
                        <EntryCard entry={e} photos={entryPhotos} withDay by={authors > 1} place={!poi} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">这里没有符合筛选的记录</p>
                )
              ) : panelPhotos.length > 0 ? (
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
              {shownCount > (onEntries ? ENTRY_PANEL_LIMIT : PANEL_LIMIT) && (
                <p className="muted small mono">
                  {onEntries ? ENTRY_PANEL_LIMIT : PANEL_LIMIT} / {shownCount}
                </p>
              )}
              {poi && (
                <>
                  <Link href={`/place/${poi.id}`} className="btn btn-primary mpg-open">
                    打开地点
                    <Icon name="arrow" size={18} />
                  </Link>
                  {!onEntries && (
                    <Link href={livingPlace(poi.id)} className="btn btn-living mpg-living" aria-label={`Living，播放${poi.name}的照片`}>
                      <Icon name="play" size={16} />
                      Living
                    </Link>
                  )}
                </>
              )}
              {selected.type === 'city' && !onEntries && (
                <Link
                  href={livingForFilter({ city: selected.name })}
                  className="btn btn-living mpg-living mpg-living-solo"
                  aria-label={`Living，播放${selected.name}的照片`}
                >
                  <Icon name="play" size={16} />
                  Living
                </Link>
              )}
              {one && (
                <Link href={isEntry(one) ? entryHref(one) : `/p/${one.id}`} className="btn btn-primary mpg-open">
                  {isEntry(one) ? '打开记录' : '打开照片'}
                  <Icon name="arrow" size={18} />
                </Link>
              )}
            </>
          ) : (
            <>
              <p className="mpg-hint">选择地图上的图集</p>
              {top && (
                <ol className="mpg-list">
                  {top.units.slice(0, LIST_LIMIT).map((u) => {
                    const n = countIn(u);
                    return (
                      <li key={u.ref}>
                        <button type="button" onClick={() => open(u)} data-muted={n === 0 ? 'true' : undefined}>
                          {top.level === 'place' && <CategoryIcon category={u.spots[0]?.poi?.category} size={17} />}
                          <span className="mpg-list-name">{u.label}</span>
                          <span className="mpg-list-dots" aria-hidden="true" />
                          <span className="mono">{fmtCount(n)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
