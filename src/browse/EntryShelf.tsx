import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ENTRY_TYPE_LABELS } from '../../shared/entries';
import { ENTRY_TYPES, type EntryListResponse, type EntryType } from '../../shared/types';
import { Icon } from '../components/icons';
import { useApi } from '../lib/useApi';
import { WORK_STEP } from '../showcase/showcase';
import WorkGrid from '../showcase/WorkGrid';
import ChipGroup from './ChipGroup';
import { livingEntries } from './links';
import { EmptyState, LoadError } from './ui';
import { replaceQuery, useQuery } from './url';
import '../styles/showcase.css';

// The gallery's other layer (?layer=entries): everyone's finished public entries, newest first, each as a work is shown
// (its first photo, a video's frame, or the start of its text), narrowed to one type (?type=practice). Living plays
// their photos. Docs: /docs/product/features/gallery.md#记录

/** `?type=`: one entry type, or none. */
export const typeParam = (v: string | null): EntryType | null =>
  v && (ENTRY_TYPES as readonly string[]).includes(v) ? (v as EntryType) : null;

export default function EntryShelf({ lead }: { lead: ReactNode }) {
  const q = useQuery();
  const type = typeParam(q.get('type'));
  const { data, error, reload } = useApi<EntryListResponse>('/api/entries');
  const entries = data?.entries;
  const types = useMemo(() => ENTRY_TYPES.filter((t) => t === type || entries?.some((e) => e.type === t)), [entries, type]);
  const shown = useMemo(() => (entries && type ? entries.filter((e) => e.type === type) : (entries ?? [])), [entries, type]);
  const photos = useMemo(() => new Set(shown.flatMap((e) => e.photoIds)).size, [shown]);
  const [limit, setLimit] = useState(WORK_STEP);
  useEffect(() => setLimit(WORK_STEP), [type]);

  let body: ReactNode;
  if (error) body = <LoadError error={error} onRetry={reload} />;
  else if (!entries) {
    body = (
      <ul className="sc-works gal-entries-skel" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} />
        ))}
      </ul>
    );
  } else if (entries.length === 0) body = <EmptyState title="还没有公开的记录" />;
  else if (shown.length === 0) {
    body = (
      <EmptyState title="没有符合的记录">
        <button type="button" className="btn" onClick={() => replaceQuery({ type: null })}>
          清除筛选
        </button>
      </EmptyState>
    );
  } else {
    body = (
      <>
        <WorkGrid works={shown.slice(0, limit)} own={false} />
        {shown.length > limit && (
          <div className="gal-more">
            <button type="button" className="btn btn-quiet" onClick={() => setLimit((n) => n + WORK_STEP)}>
              显示更多（还有 {shown.length - limit} 条）
            </button>
          </div>
        )}
      </>
    );
  }

  const living = `Living，播放${type ? `「${ENTRY_TYPE_LABELS[type]}」` : '这些'}记录里的 ${photos} 张照片`;
  return (
    <div className="gal">
      <div className="gal-head">
        {lead}
        <div className="gal-head-tags gal-head-types" data-open="true">
          {types.length > 1 && (
            <ChipGroup
              label="类型"
              chips={types.map((t) => ({ id: t, label: ENTRY_TYPE_LABELS[t] }))}
              selected={type ? [type] : []}
              onPick={(id) => replaceQuery({ type: id === type ? null : id })}
            />
          )}
        </div>
        {photos > 0 ? (
          <Link href={livingEntries(type ? [type] : [])} className="btn btn-quiet btn-living" aria-label={living}>
            <Icon name="play" size={16} />
            Living
          </Link>
        ) : (
          <button type="button" className="btn btn-quiet btn-living" disabled>
            <Icon name="play" size={16} />
            Living
          </button>
        )}
      </div>
      {data?.truncated && <p className="bw-limit gal-limit">只显示最近的 {entries?.length} 条</p>}
      <div className="gal-entries">{body}</div>
    </div>
  );
}
