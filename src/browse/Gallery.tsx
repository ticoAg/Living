import { useEffect, useMemo, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { PhotoSummary } from '../../shared/types';
import { Icon } from '../components/icons';
import { useSession } from '../lib/session';
import { buildTagTree, filterByTags, inclusiveCounts } from '../lib/tags';
import { enc, usePhotoList, usePoiList, useTagTree } from './api';
import { setBrowseList } from './context';
import GalleryTile from './GalleryTile';
import { livingForFilter } from './links';
import { byTakenDesc } from './sort';
import TagFilter from './TagFilter';
import { EmptyState, LoadError } from './ui';
import { replaceQuery, splitIds, useQuery } from './url';

// The masonry gallery shared by the home page (everyone's public photos) and a profile (`owner`).
// Photos, tags and places load once; every filter, count and ordering is derived client-side so
// toggling a chip is instant. State lives in the address bar: ?tags=a,b&city=杭州&sort=shuffle

const EMPTY_TREE = buildTagTree([]);

// "Random" order is seeded once per page load: it stays put while you filter and navigate, and
// re-rolls on refresh.
const SEED = Math.floor(Math.random() * 0x100000000) >>> 0;
function rank(id: string): number {
  let h = (0x811c9dc5 ^ SEED) >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
const shuffled = (items: readonly PhotoSummary[]) =>
  items
    .map((p) => [rank(p.id), p] as const)
    .sort((a, b) => a[0] - b[0])
    .map((x) => x[1]);

const SKELETON_RATIOS = ['4 / 5', '3 / 2', '2 / 3', '1 / 1', '3 / 4', '3 / 2', '4 / 5', '2 / 3', '3 / 2', '1 / 1', '3 / 4', '4 / 3'];

export default function Gallery({ owner }: { owner?: string }) {
  const { user } = useSession();
  const q = useQuery();
  const rawTags = useMemo(() => splitIds(q.get('tags')), [q]);
  const city = q.get('city') ?? '';
  const sort: 'new' | 'shuffle' = q.get('sort') === 'shuffle' ? 'shuffle' : 'new';

  const { photos, error, reload } = usePhotoList(owner ? `owner=${enc(owner)}` : '');
  const { tree, error: tagsError } = useTagTree(owner);
  const { byId: poiById } = usePoiList(owner);

  const tagsReady = !!tree || !!tagsError;
  const effTree = tree ?? EMPTY_TREE;
  // tag ids from a shared link that this viewer cannot see (someone else's custom tags) are ignored
  const selected = useMemo(() => rawTags.filter((id) => effTree.byId.has(id)), [rawTags, effTree]);

  const byDate = useMemo(() => (photos ? photos.slice().sort(byTakenDesc) : undefined), [photos]);
  const cities = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of byDate ?? []) if (p.city) n.set(p.city, (n.get(p.city) ?? 0) + 1);
    const list = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).map(([c]) => c);
    return city && !n.has(city) ? [...list, city] : list;
  }, [byDate, city]);

  // tags narrow first; city availability is judged against that, tag availability against tags + city
  const byTag = useMemo(() => (byDate ? filterByTags(byDate, selected, effTree) : []), [byDate, selected, effTree]);
  const shown = useMemo(() => (city ? byTag.filter((p) => p.city === city) : byTag), [byTag, city]);
  const ordered = useMemo(() => (sort === 'shuffle' ? shuffled(shown) : shown), [shown, sort]);
  const counts = useMemo(() => inclusiveCounts(shown, effTree), [shown, effTree]);
  const cityHasResults = useMemo(() => new Set(byTag.map((p) => p.city)), [byTag]);

  useEffect(() => {
    setBrowseList(ordered.map((p) => p.id));
  }, [ordered]);

  const filtered = selected.length > 0 || !!city;
  const toggleTag = (id: string) =>
    replaceQuery({ tags: (selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]).join(',') });
  const clear = () => replaceQuery({ tags: null, city: null });

  const total = ordered.length;
  const livingHref = livingForFilter({ tags: selected, city, user: owner });
  const livingLabel = `Living，${filtered ? '播放当前筛选的' : '随机播放全部'} ${total} 张`;
  const canUpload = !!user && (!owner || user.handle.toLowerCase() === owner.toLowerCase());

  let body: ReactNode;
  if (error) {
    body = <LoadError error={error} onRetry={reload} />;
  } else if (!photos || (rawTags.length > 0 && !tagsReady)) {
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
    body = (
      <div className="gal-masonry">
        {ordered.map((p) => (
          <GalleryTile key={p.id} photo={p} poi={p.poiId ? poiById.get(p.poiId) : undefined} />
        ))}
      </div>
    );
  }

  return (
    <div className="gal">
      <div className="gal-top">
        <div className="gal-cities" role="group" aria-label="城市">
          <button type="button" className="gal-city" aria-pressed={!city} onClick={() => replaceQuery({ city: null })}>
            全部
          </button>
          {cities.map((c) => (
            <button
              key={c}
              type="button"
              className="gal-city"
              aria-pressed={city === c}
              disabled={city !== c && !cityHasResults.has(c)}
              onClick={() => replaceQuery({ city: city === c ? null : c })}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="gal-tools">
          <p className="gal-count" aria-live="polite">
            <span className="gal-count-n">{photos ? total : '—'}</span>
            <span className="gal-count-u">张</span>
          </p>
          {filtered && (
            <button type="button" className="gal-clear" onClick={clear}>
              <Icon name="close" size={14} />
              清除
            </button>
          )}
          <div className="gal-sort" role="group" aria-label="排序">
            <button type="button" aria-pressed={sort === 'new'} onClick={() => replaceQuery({ sort: null })}>
              最新
            </button>
            <button type="button" aria-pressed={sort === 'shuffle'} onClick={() => replaceQuery({ sort: 'shuffle' })}>
              随机
            </button>
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
      </div>
      {photos && tree && tree.roots.length > 0 && <TagFilter tree={tree} selected={selected} counts={counts} onToggle={toggleTag} />}
      {body}
    </div>
  );
}
