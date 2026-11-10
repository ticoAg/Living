import { useCallback, useDeferredValue, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { PhotoSummary } from '../../shared/types';
import { Icon } from '../components/icons';
import { useSession } from '../lib/session';
import { buildTagTree, filterByTags, inclusiveCounts } from '../lib/tags';
import { enc, usePhotoList, usePoiList, useTagTree } from './api';
import { setBrowseList } from './context';
import GalleryTile, { galleryTileSize } from './GalleryTile';
import { livingForFilter } from './links';
import Masonry from './Masonry';
import { byTakenDesc } from './sort';
import TagFilter from './TagFilter';
import { EmptyState, FilterToggle, LoadError, TruncatedNote } from './ui';
import { replaceQuery, splitIds, useQuery } from './url';

// The masonry gallery shared by the home page (everyone's public photos) and a profile (`owner`).
// Photos, tags and places load once; every filter, count and ordering is derived client-side so
// toggling a chip is instant. State lives in the address bar: ?tags=a,b&city=杭州

const EMPTY_TREE = buildTagTree([]);

const photoId = (p: PhotoSummary) => p.id;

const SKELETON_RATIOS = ['4 / 5', '3 / 2', '2 / 3', '1 / 1', '3 / 4', '3 / 2', '4 / 5', '2 / 3', '3 / 2', '1 / 1', '3 / 4', '4 / 3'];

export default function Gallery({ owner }: { owner?: string }) {
  const { user } = useSession();
  const q = useQuery();
  const rawTags = useMemo(() => splitIds(q.get('tags')), [q]);
  const city = q.get('city') ?? '';

  const { photos, truncated, error, reload } = usePhotoList(owner ? `owner=${enc(owner)}` : '');
  const { tree, error: tagsError } = useTagTree(owner);
  const { pois, byId: poiById, error: poisError } = usePoiList(owner);

  const tagsReady = !!tree || !!tagsError;
  // captions need the places; wait for them (or their failure) so tiles do not change text after appearing
  const poisReady = !!pois || !!poisError;
  const effTree = tree ?? EMPTY_TREE;
  // tag ids from a shared link that this viewer cannot see (someone else's custom tags) are ignored
  const selected = useMemo(() => rawTags.filter((id) => effTree.byId.has(id)), [rawTags, effTree]);

  const byDate = useMemo(() => (photos ? photos.slice().sort(byTakenDesc) : undefined), [photos]);
  // tags narrow first, then an optional ?city= from a photo's place link
  const byTag = useMemo(() => (byDate ? filterByTags(byDate, selected, effTree) : []), [byDate, selected, effTree]);
  const shown = useMemo(() => (city ? byTag.filter((p) => p.city === city) : byTag), [byTag, city]);
  const counts = useMemo(() => inclusiveCounts(shown, effTree), [shown, effTree]);
  // chips answer at once; the (large) tile list catches up right behind them
  const listed = useDeferredValue(shown);

  // the photo page steps through the whole filtered list, not just the tiles rendered so far
  useEffect(() => {
    setBrowseList(shown.map((p) => p.id));
  }, [shown]);

  const poiOf = useCallback((p: PhotoSummary) => (p.poiId ? poiById.get(p.poiId) : undefined), [poiById]);
  const tileSize = useCallback((p: PhotoSummary) => galleryTileSize(p, poiOf(p)), [poiOf]);
  const tile = useCallback((p: PhotoSummary) => <GalleryTile photo={p} poi={poiOf(p)} />, [poiOf]);

  const toggleTag = (id: string) =>
    replaceQuery({ tags: (selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]).join(',') });
  const clear = () => replaceQuery({ tags: null, city: null });

  // phones fold the tag rows behind a button (browse.css); wider screens always show them
  const [filterOpen, setFilterOpen] = useState(false);
  const filterId = useId();

  const filtered = selected.length > 0 || !!city;
  const total = shown.length;
  const livingHref = livingForFilter({ tags: selected, city, user: owner });
  const livingLabel = `Living，${filtered ? '播放当前筛选的' : '随机播放全部'} ${total} 张`;
  const canUpload = !!user && (!owner || user.handle.toLowerCase() === owner.toLowerCase());

  let body: ReactNode;
  if (error) {
    body = <LoadError error={error} onRetry={reload} />;
  } else if (!photos || !poisReady || (rawTags.length > 0 && !tagsReady)) {
    body = (
      <div className="gal-masonry gal-skel" aria-hidden="true">
        {SKELETON_RATIOS.map((r, i) => (
          <div key={i} style={{ aspectRatio: r }} />
        ))}
      </div>
    );
  } else if (photos.length === 0) {
    body = (
      <EmptyState title="还没有照片">
        {canUpload && (
          <Link href="/upload" className="btn">
            <Icon name="upload" size={18} />
            上传照片
          </Link>
        )}
      </EmptyState>
    );
  } else if (total === 0) {
    body = (
      <EmptyState title="没有符合的照片">
        <button type="button" className="btn" onClick={clear}>
          清除筛选
        </button>
      </EmptyState>
    );
  } else {
    body = <Masonry className="gal-masonry" items={listed} keyOf={photoId} measure={tileSize} render={tile} />;
  }

  const hasFilter = !!photos && !!tree && tree.roots.length > 0;

  return (
    <div className="gal">
      <div className="gal-head">
        {hasFilter && (
          <FilterToggle open={filterOpen} onToggle={() => setFilterOpen((o) => !o)} count={selected.length} controls={filterId} />
        )}
        <div className="gal-head-tags" id={filterId} data-open={filterOpen}>
          {hasFilter && <TagFilter tree={tree} selected={selected} counts={counts} onToggle={toggleTag} />}
        </div>
        {total > 0 ? (
          <Link href={livingHref} className="btn btn-primary btn-living" aria-label={livingLabel}>
            <Icon name="play" size={16} />
            Living
          </Link>
        ) : (
          <button type="button" className="btn btn-primary btn-living" disabled>
            <Icon name="play" size={16} />
            Living
          </button>
        )}
      </div>
      {truncated && !error && <TruncatedNote className="gal-limit" />}
      {body}
    </div>
  );
}
