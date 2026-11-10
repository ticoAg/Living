import { useCallback, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { POI_CATEGORIES, type MatchCandidate, type Poi } from '../../shared/types';
import { distance as geoDistance, fmtDistance } from '../../shared/geo';
import { POI_SEARCH_LIMITS } from '../../shared/limits';
import { CategoryIcon, Icon } from '../components/icons';
import { invalidate } from '../lib/useApi';
import MatchMap, { resultMark } from './MatchMap';
import MatchPlot from './MatchPlot';
import {
  DEFAULT_RADIUS,
  MAX_RADIUS,
  METHOD_LABEL,
  MIN_RADIUS,
  PROVIDER_LABEL,
  choiceFromCandidate,
  choiceFromPoi,
  createPoi,
  isPickable,
  searchPois,
  type MatchState,
  type PlaceChoice
} from './match';
import { errMsg } from './util';

/** Candidates shown before "显示全部". */
const SHORT_LIST = 8;
/** MapLibre needs WebGL 2; without it the schematic plot stands in for the map. */
const HAS_WEBGL2 = typeof WebGL2RenderingContext !== 'undefined';

// Place chooser used by the upload page and the photo editor: the match map with its radius slider and
// radio list of candidates, search by name (results shown on the same map, lettered), and "create a place".
// It never talks to the photo itself; it reports the chosen PlaceChoice (or null to clear) and the caller
// decides when to save.

/** The current place with how it was decided. */
export function PlaceSummary({
  value,
  onClear,
  disabled,
  empty
}: {
  value: PlaceChoice | null;
  onClear?: () => void;
  disabled?: boolean;
  /** what to add when there is no place, e.g. that the photo has no position */
  empty?: string;
}) {
  if (!value) {
    return (
      <div className="pk-current" data-empty="true">
        <span className="muted">未选择地点{empty ? ` · ${empty}` : ''}</span>
      </div>
    );
  }
  return (
    <div className="pk-current">
      <CategoryIcon category={value.category} size={22} />
      <div className="pk-current-main">
        <span className="pk-current-name serif">{value.name}</span>
        <span className="small muted">
          {value.category} · {METHOD_LABEL[value.method]}
          {value.distance != null && !value.area && (
            <>
              {' '}
              · <span className="mono">{fmtDistance(value.distance)}</span>
            </>
          )}
          {value.area && <> · 范围内</>}
        </span>
        {value.from && <span className="small pk-from">{value.from}</span>}
      </div>
      {onClear && (
        <button type="button" className="btn btn-quiet pk-clear" onClick={onClear} disabled={disabled}>
          清除
        </button>
      )}
    </div>
  );
}

export interface RowData {
  key: string;
  name: string;
  category: string;
  distance: number | null;
  inView?: boolean;
  area?: boolean;
  local?: boolean;
  far?: boolean;
  /** how many of the selected photos list it (the batch panel) */
  count?: number;
}

export function Row({
  group,
  rank,
  row,
  checked,
  disabled,
  onSelect,
  onActive
}: {
  group: string;
  /** the number (candidates) or letter (search results) also shown on the map */
  rank?: number | string;
  row: RowData;
  checked: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onActive?: (key: string | null) => void;
}) {
  return (
    <label
      className="pk-row"
      data-checked={checked}
      data-disabled={disabled || undefined}
      onMouseEnter={() => onActive?.(row.key)}
      onMouseLeave={() => onActive?.(null)}
    >
      <input
        type="radio"
        name={group}
        className="visually-hidden"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        onFocus={() => onActive?.(row.key)}
        onBlur={() => onActive?.(null)}
      />
      {rank != null && (
        <span className="pk-rank mono" aria-hidden="true">
          {rank}
        </span>
      )}
      <span className="pk-main">
        <span className="pk-name serif">{row.name}</span>
        <span className="pk-sub small muted">
          <CategoryIcon category={row.category} size={14} />
          <span>{row.category}</span>
          {row.area ? (
            <span className="pk-tag">范围内</span>
          ) : (
            row.distance != null && <span className="mono">{fmtDistance(row.distance)}</span>
          )}
          {row.inView && <span className="pk-tag pk-tag-view">朝向内</span>}
          {row.local && <span className="pk-tag">站内</span>}
          {row.count != null && <span className="pk-tag pk-tag-count">{row.count} 张</span>}
          {row.far && <span className="pk-tag pk-tag-far">超出半径</span>}
        </span>
      </span>
    </label>
  );
}

export interface SearchState {
  loading: boolean;
  error: string | null;
  results: MatchCandidate[] | null;
  term: string;
}
const NO_SEARCH: SearchState = { loading: false, error: null, results: null, term: '' };

/** A name search around `at` (anywhere without it); the last request wins. */
export function usePlaceSearch(at: { lat: number; lng: number } | null) {
  const [search, setSearch] = useState<SearchState>(NO_SEARCH);
  const seq = useRef(0);
  const lat = at?.lat;
  const lng = at?.lng;
  const run = useCallback(
    async (term: string) => {
      const mine = ++seq.current;
      setSearch({ loading: true, error: null, results: null, term });
      try {
        const results = await searchPois(term, lat != null && lng != null ? { lat, lng } : null);
        if (mine === seq.current) setSearch({ loading: false, error: null, results, term });
      } catch (err) {
        if (mine === seq.current) setSearch({ loading: false, error: errMsg(err, '搜索失败'), results: null, term });
      }
    },
    [lat, lng]
  );
  return { search, runSearch: run };
}

/** The search box: one row, the label read out but not shown. */
export function SearchForm({
  at,
  loading,
  onSearch,
  disabled
}: {
  at: { lat: number; lng: number } | null;
  loading: boolean;
  onSearch: (term: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (term) onSearch(term);
  };
  return (
    <form className="pk-searchrow" onSubmit={submit} role="search">
      <label className="visually-hidden" htmlFor={`${id}-q`}>
        {at ? '搜索附近的地点' : '搜索地点'}
      </label>
      <input
        id={`${id}-q`}
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={at ? '搜索附近的地点，如 断桥、咖啡' : '搜索地点，如 断桥残雪'}
        disabled={disabled}
        maxLength={POI_SEARCH_LIMITS.queryMax}
        enterKeyHint="search"
      />
      <button type="submit" className="btn" disabled={disabled || loading || !q.trim()}>
        <Icon name="search" size={16} />
        搜索
      </button>
    </form>
  );
}

/** What the search found, lettered as on the map. */
export function SearchResults({
  at,
  state,
  value,
  onPick,
  disabled
}: {
  at: { lat: number; lng: number } | null;
  state: SearchState;
  value: PlaceChoice | null;
  onPick: (c: PlaceChoice) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <>
      <div aria-live="polite" className="pk-status small">
        {state.loading && <span className="muted">搜索中…</span>}
        {state.error && (
          <span className="error-text" role="alert">
            {state.error}
          </span>
        )}
        {state.results && state.results.length === 0 && <span className="muted">没有找到「{state.term}」，换个说法或新建。</span>}
      </div>
      {state.results && state.results.length > 0 && (
        <div className="pk-list" role="radiogroup" aria-label={`「${state.term}」的搜索结果`}>
          {state.results.map((c, i) => (
            <Row
              key={c.key}
              group={`${id}-r`}
              rank={resultMark(i)}
              row={{
                key: c.key,
                name: c.name,
                category: c.category,
                distance: at ? c.distance : null,
                area: c.area && !!at,
                local: c.source === 'local'
              }}
              checked={value?.key === c.key}
              disabled={disabled}
              onSelect={() => onPick(choiceFromCandidate(c, 'manual'))}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function PlaceCustom({
  at,
  city,
  district,
  onCreated,
  disabled,
  where = '这张照片的拍摄位置'
}: {
  at: { lat: number; lng: number } | null;
  /** where the new place goes, in the sentence under the form */
  where?: string;
  city: string | null;
  district: string | null;
  onCreated: (poi: Poi) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('景');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!at || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const poi = await createPoi({ name: name.trim(), category, lat: at.lat, lng: at.lng, city, district, source: 'custom' });
      invalidate('/api/pois');
      setName('');
      setOpen(false);
      onCreated(poi);
    } catch (err) {
      setError(errMsg(err, '新建地点失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pk-block">
      <button
        type="button"
        className="btn btn-quiet pk-custom-toggle"
        aria-expanded={open}
        aria-controls={`${id}-form`}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
      >
        <Icon name="plus" size={16} />
        新建地点
      </button>
      {open && (
        <form id={`${id}-form`} className="pk-custom" onSubmit={submit}>
          {at ? (
            <p className="small muted">新地点会建在{where}，所有人共用。</p>
          ) : (
            <p className="small muted">这张照片没有坐标，新地点没法定位。请先搜索已有地点。</p>
          )}
          <div className="field">
            <label className="label" htmlFor={`${id}-name`}>
              名称
            </label>
            <input
              id={`${id}-name`}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="如 家门口的桥"
              disabled={!at || busy}
              required
            />
          </div>
          <div className="field">
            <label className="label" htmlFor={`${id}-cat`}>
              类别
            </label>
            <select
              id={`${id}-cat`}
              className="input select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={!at || busy}
            >
              {POI_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={!at || busy || !name.trim()}>
              {busy ? '新建中…' : '新建并使用'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)} disabled={busy}>
              取消
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

export interface PlacePickerProps {
  /** shot position; null for photos without GPS */
  coords: { lat: number; lng: number } | null;
  heading: number | null;
  /** null until a match has been requested */
  match: MatchState | null;
  onRadius: (radius: number) => void;
  onRetry: () => void;
  value: PlaceChoice | null;
  onChange: (choice: PlaceChoice | null) => void;
  /** places created earlier in this session, offered again */
  extras?: Poi[];
  onCreated?: (poi: Poi) => void;
  /** where a new custom place would be put (the shot position, or a neighbour's for photos without GPS) */
  customAt: { lat: number; lng: number } | null;
  privacyZone?: string | null;
  /** hide the "current place" header when the caller shows its own */
  hideCurrent?: boolean;
  disabled?: boolean;
}

export default function PlacePicker({
  coords,
  heading,
  match,
  onRadius,
  onRetry,
  value,
  onChange,
  extras = [],
  onCreated,
  customAt,
  privacyZone,
  hideCurrent,
  disabled
}: PlacePickerProps) {
  const id = useId();
  const [active, setActive] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const radius = match?.radius ?? DEFAULT_RADIUS;
  const candidates = match?.res?.candidates ?? [];
  // The nearest first; the rest one click away (the chosen place always stays in view).
  const chosenAt = candidates.findIndex((c) => c.key === value?.key);
  const listed = showAll || chosenAt >= SHORT_LIST ? candidates : candidates.slice(0, SHORT_LIST);
  const res = match?.res ?? null;

  const extraRows = useMemo(() => {
    const seen = new Set(candidates.map((c) => c.key));
    return extras
      .filter((p) => !seen.has(p.id))
      .map((p) => ({ poi: p, distance: coords ? Math.round(geoDistance(coords.lat, coords.lng, p.lat, p.lng)) : null }));
  }, [candidates, extras, coords]);

  // the name search lives here so its results can share the map with the candidates
  const { search, runSearch } = usePlaceSearch(coords);
  const results = search.results ?? [];
  const pick = (c: MatchCandidate) => onChange(choiceFromCandidate(c, results.some((r) => r.key === c.key) ? 'manual' : 'confirmed'));

  const withMatch = !!coords && !!match;
  // without a position the map appears once there is something to show: search results, or the chosen place
  const mapless = !withMatch && !results.length && (value?.lat == null || value.lng == null);
  const map =
    HAS_WEBGL2 && !mapless ? (
      <MatchMap
        at={coords}
        heading={heading}
        radius={radius}
        candidates={candidates}
        results={results}
        selected={value}
        onPick={pick}
        disabled={disabled}
        className={withMatch ? 'pk-map' : 'pk-map pk-map-short'}
      />
    ) : null;

  return (
    <div className="pk">
      {privacyZone && (
        <p className="notice pk-zone" role="status">
          在隐私区域「{privacyZone}」内，位置默认隐藏。
        </p>
      )}

      {!hideCurrent && (
        <PlaceSummary value={value} onClear={() => onChange(null)} disabled={disabled} empty={coords ? undefined : '照片没有位置信息'} />
      )}

      {withMatch && match ? (
        <section className="pk-block" aria-label="地点匹配">
          {map ?? (
            <MatchPlot
              radius={radius}
              heading={heading}
              candidates={candidates}
              selectedKey={value?.key ?? null}
              activeKey={active}
              onActive={setActive}
              onPick={(c) => !disabled && onChange(choiceFromCandidate(c, 'confirmed'))}
            />
          )}

          <div className="pk-radius">
            <label className="small muted" htmlFor={`${id}-radius`}>
              半径
            </label>
            <input
              id={`${id}-radius`}
              className="pk-range"
              type="range"
              min={MIN_RADIUS}
              max={MAX_RADIUS}
              step={10}
              value={radius}
              onChange={(e) => onRadius(Number(e.target.value))}
              disabled={disabled}
              aria-valuetext={`${radius} 米`}
            />
            <span className="mono small pk-radius-val">{radius} m</span>
          </div>
          <div className="pk-status small" aria-live="polite">
            {match.loading && <span className="muted">匹配中…</span>}
            {!match.loading && res && (
              <span className="muted">
                {[res.city, res.district].filter(Boolean).join(' · ') || '未知区域'} · {PROVIDER_LABEL[res.provider]} · {candidates.length}{' '}
                个候选
                {res.provider === 'local' && '（外部地点服务暂时不可用）'}
              </span>
            )}
          </div>
          {match.error && (
            <div className="notice pk-error" role="alert">
              <span className="error-text">{match.error}</span>
              <button type="button" className="btn btn-quiet" onClick={onRetry}>
                重试
              </button>
            </div>
          )}
        </section>
      ) : null}

      <section className="pk-block" aria-label={coords ? '搜索附近的地点' : '搜索地点'}>
        <SearchForm at={coords} loading={search.loading} onSearch={(t) => void runSearch(t)} disabled={disabled} />
        {!withMatch && map}
        <SearchResults at={coords} state={search} value={value} onPick={onChange} disabled={disabled} />
      </section>

      {withMatch && match && (
        <section className="pk-block" aria-label="候选地点">
          {candidates.length > 0 ? (
            <div className="pk-list" role="radiogroup" aria-label="候选地点">
              {listed.map((c, i) => {
                const pickable = isPickable(c, radius);
                return (
                  <Row
                    key={c.key}
                    group={`${id}-c`}
                    rank={i + 1}
                    row={{
                      key: c.key,
                      name: c.name,
                      category: c.category,
                      distance: c.distance,
                      inView: c.inView,
                      area: c.area,
                      local: c.source === 'local',
                      far: !pickable
                    }}
                    checked={value?.key === c.key}
                    disabled={disabled || !pickable}
                    onSelect={() => onChange(choiceFromCandidate(c, 'confirmed'))}
                    onActive={setActive}
                  />
                );
              })}
            </div>
          ) : (
            !match.loading && !match.error && <p className="muted small">{radius} 米内没有找到地点。可以放大半径、搜索，或新建一个。</p>
          )}
          {candidates.length > SHORT_LIST && chosenAt < SHORT_LIST && (
            <button type="button" className="btn btn-quiet pk-more" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
              {showAll ? '只看最近的' : `显示全部 ${candidates.length} 个`}
            </button>
          )}
        </section>
      )}

      {extraRows.length > 0 && (
        <section className="pk-block" aria-label="本次新建的地点">
          <p className="label">本次新建的地点</p>
          <div className="pk-list" role="radiogroup" aria-label="本次新建的地点">
            {extraRows.map(({ poi, distance }) => (
              <Row
                key={poi.id}
                group={`${id}-x`}
                row={{ key: poi.id, name: poi.name, category: poi.category, distance }}
                checked={value?.key === poi.id}
                disabled={disabled}
                onSelect={() => onChange(choiceFromPoi(poi, 'manual', coords))}
              />
            ))}
          </div>
        </section>
      )}

      <PlaceCustom
        at={customAt}
        city={res?.city ?? null}
        district={res?.district ?? null}
        disabled={disabled}
        onCreated={(poi) => {
          onCreated?.(poi);
          onChange(choiceFromPoi(poi, 'manual', coords));
        }}
      />
    </div>
  );
}
