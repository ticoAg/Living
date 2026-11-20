import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { distance } from '../../shared/geo';
import type { EntryPlace, PhotoSummary, PoiDetail, PrivacyZone } from '../../shared/types';
import { CategoryIcon, Icon } from '../components/icons';
import { invalidate, useApi } from '../lib/useApi';
import { createPoi, type PlaceChoice } from '../studio/match';
import { SearchForm, SearchResults, usePlaceSearch } from '../studio/PlacePicker';
import { errMsg } from '../studio/util';

// Where an entry happened, in its editor: the places of its photos offered first, any other found by name. The place
// shows to whoever may read the entry, so one inside the author's privacy zones is pointed out.
// Docs: /docs/product/features/entries.md

/** Places of the entry's photos offered at most. */
const OFFERED = 3;

const placePath = (id: string) => `/api/pois/${encodeURIComponent(id)}`;
type PlaceResponse = { poi: PoiDetail };

const toPlace = ({ id, name, category, city, district }: EntryPlace): EntryPlace => ({ id, name, category, city, district });

/** The place of one of the entry's photos, offered by name once it has loaded. */
function PhotoPlace({ poiId, onPick, disabled }: { poiId: string; onPick: (p: EntryPlace) => void; disabled: boolean }) {
  const { data } = useApi<PlaceResponse>(placePath(poiId));
  if (!data) return null;
  return (
    <button type="button" className="chip chip-outline ee-place-offer" disabled={disabled} onClick={() => onPick(toPlace(data.poi))}>
      <CategoryIcon category={data.poi.category} size={16} />
      {data.poi.name}
    </button>
  );
}

/** The author's privacy zone the place lies in, if any. */
function useZoneOf(place: EntryPlace | null): string | null {
  const zones = useApi<{ zones: PrivacyZone[] }>(place ? '/api/privacy-zones' : null);
  const poi = useApi<PlaceResponse>(place ? placePath(place.id) : null);
  const at = poi.data?.poi;
  if (!at || !zones.data) return null;
  return zones.data.zones.find((z) => distance(at.lat, at.lng, z.lat, z.lng) <= z.radius)?.name ?? null;
}

export default function EntryPlaceField({
  value,
  photos,
  onChange
}: {
  value: EntryPlace | null;
  /** the entry's photos, for their places and for searching near them */
  photos: readonly (PhotoSummary | null)[];
  onChange: (place: EntryPlace | null) => void;
}) {
  const id = useId();
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const near = useMemo(() => {
    const p = photos.find((x) => x?.lat != null && x.lng != null);
    return p?.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null;
  }, [photos]);
  const { search, runSearch } = usePlaceSearch(near);
  const offered = useMemo(
    () => [...new Set(photos.map((p) => p?.poiId).filter((x): x is string => !!x && x !== value?.id))].slice(0, OFFERED),
    [photos, value?.id]
  );
  const zone = useZoneOf(value);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (searching) box.current?.querySelector('input')?.focus();
  }, [searching]);

  const choose = (place: EntryPlace | null) => {
    onChange(place);
    setSearching(false);
    setError(null);
  };

  // a result from a map provider becomes a place of the site first; the server finds it if it is one already
  async function pick(c: PlaceChoice) {
    if (c.poiId) return choose({ id: c.poiId, name: c.name, category: c.category, city: c.city, district: c.district });
    if (!c.newPoi) return;
    setBusy(true);
    setError(null);
    try {
      const poi = await createPoi(c.newPoi);
      invalidate('/api/pois');
      choose(toPlace(poi));
    } catch (e) {
      setError(errMsg(e, '没能选上这个地点'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ee-sec" aria-labelledby={`${id}-h`}>
      <div className="ee-sec-head">
        <h2 id={`${id}-h`} className="ee-h">
          地点
        </h2>
        {!searching && (
          <button type="button" className="btn btn-quiet" onClick={() => setSearching(true)}>
            <Icon name="search" size={18} />
            {value ? '更换' : '搜索'}
          </button>
        )}
      </div>

      {value && (
        <div className="ee-place">
          <CategoryIcon category={value.category} size={20} />
          <span className="ee-place-name">{value.name}</span>
          {(value.city || value.district) && (
            <span className="small muted">{[value.city, value.district].filter(Boolean).join(' · ')}</span>
          )}
          <button type="button" className="btn btn-ghost btn-icon" aria-label={`去掉地点「${value.name}」`} onClick={() => choose(null)}>
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {zone && (
        <p className="small ee-warn" role="note">
          在隐私区域「{zone}」内。能读到这条记录的人都会看到这个地点。
        </p>
      )}

      {offered.length > 0 && (
        <div className="row ee-place-offers" role="group" aria-label="照片里的地点">
          {offered.map((poiId) => (
            <PhotoPlace key={poiId} poiId={poiId} disabled={busy} onPick={choose} />
          ))}
        </div>
      )}

      {searching && (
        <div ref={box} className="ee-place-search">
          <SearchForm at={near} loading={search.loading} onSearch={(t) => void runSearch(t)} disabled={busy} />
          <SearchResults at={near} state={search} value={null} onPick={(c) => void pick(c)} disabled={busy} />
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn btn-quiet ee-place-cancel" onClick={() => setSearching(false)} disabled={busy}>
            取消
          </button>
        </div>
      )}
    </section>
  );
}
