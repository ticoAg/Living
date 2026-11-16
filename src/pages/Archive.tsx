import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ENTRY_TYPE_LABELS } from '../../shared/entries';
import { ENTRY_LIST_LIMIT, ENTRY_TYPES } from '../../shared/types';
import { useTagTree } from '../browse/api';
import TagFilter from '../browse/TagFilter';
import { EmptyState, LoadError, Loading, TruncatedNote } from '../browse/ui';
import { replaceQuery, splitIds, useQuery } from '../browse/url';
import { MY_ENTRIES, MY_PHOTOS, useEntryList, usePhotoMap } from '../entries/api';
import ArchiveTabs from '../entries/ArchiveTabs';
import EntryCard from '../entries/EntryCard';
import PhotoRun from '../entries/PhotoRun';
import { buildTimeline, keepEntries, showsPhotos, yearMarks, type Kind } from '../entries/timeline';
import { DayName, SignedOut } from '../entries/ui';
import { localDay } from '../lib/format';
import { useSession } from '../lib/session';
import { filterByTags, inclusiveCounts } from '../lib/tags';
import { usePaged } from '../lib/usePaged';
import { useDocumentTitle, useScrollTop } from '../themes/hooks';
import '../styles/browse.css';
import '../styles/entries.css';

// /archive — everything one has kept, as one line of days: entries where they happened, photos where they were taken.
// The filters live in the address: ?type=<entry type>|photos, ?archived=1, ?tags=a,b. Docs: /docs/product/features/archive.md

/** days rendered at first, and added each time the end comes near */
const PAGE_DAYS = 14;

const KINDS: readonly Kind[] = ['all', ...ENTRY_TYPES, 'photos'];
const kindLabel = (k: Kind) => (k === 'all' ? '全部' : k === 'photos' ? '照片' : ENTRY_TYPE_LABELS[k]);
const parseKind = (v: string | null): Kind => (v && (KINDS as readonly string[]).includes(v) ? (v as Kind) : 'all');

function Body() {
  const query = useQuery();
  const kind = parseKind(query.get('type'));
  const archived = query.get('archived') === '1';
  const tagParam = query.get('tags');
  const selected = useMemo(() => splitIds(tagParam), [tagParam]);
  const list = useEntryList(MY_ENTRIES);
  const photos = usePhotoMap(MY_PHOTOS);
  const { tags, tree } = useTagTree();
  const tagMap = useMemo(() => new Map((tags ?? []).map((t) => [t.id, t])), [tags]);
  const today = localDay();

  const entries = list.entries;
  const allPhotos = photos.photos;
  const kept = useMemo(
    () => ({ entries: keepEntries(entries ?? [], kind, archived), photos: showsPhotos(kind) ? (allPhotos ?? []) : [] }),
    [entries, allPhotos, kind, archived]
  );
  const counts = useMemo(() => (tree ? inclusiveCounts([...kept.entries, ...kept.photos], tree) : new Map<string, number>()), [kept, tree]);
  const timeline = useMemo(
    () =>
      buildTimeline(
        tree ? filterByTags(kept.entries, selected, tree) : kept.entries,
        tree ? filterByTags(kept.photos, selected, tree) : kept.photos
      ),
    [kept, selected, tree]
  );
  const typesHere = useMemo(() => new Set((entries ?? []).map((e) => e.type)), [entries]);
  const archivedCount = useMemo(() => (entries ?? []).filter((e) => e.status === 'archived').length, [entries]);

  const { n, more, end, showAtLeast } = usePaged(timeline.days.length, PAGE_DAYS);
  const years = useMemo(() => yearMarks(timeline.days), [timeline.days]);
  const [jump, setJump] = useState<string | null>(null);
  useEffect(() => {
    if (!jump) return;
    document.getElementById(`ar-y${jump}`)?.scrollIntoView({ block: 'start' });
    setJump(null);
  }, [jump, n]);

  const [tagsOpen, setTagsOpen] = useState(selected.length > 0);
  const tagsId = useId();
  const toggleTag = (id: string) =>
    replaceQuery({ tags: (selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]).join(',') });
  const filtered = kind !== 'all' || archived || selected.length > 0;

  if (list.error && !entries) return <LoadError error={list.error} onRetry={list.reload} />;
  if (!entries || (!allPhotos && !photos.error)) return <Loading />;
  if (entries.length === 0 && allPhotos?.length === 0) {
    return (
      <EmptyState title="档案还是空的">
        <Link href="/today" className="btn btn-primary">
          记一笔
        </Link>
        <Link href="/upload" className="btn">
          上传照片
        </Link>
      </EmptyState>
    );
  }

  const days = timeline.days.slice(0, n);
  const undated = !more && showsPhotos(kind) ? timeline.undated : [];
  return (
    <>
      <div className="ar-filters">
        <div className="ar-kinds" role="group" aria-label="类型">
          {KINDS.filter((k) => k === 'all' || k === 'photos' || k === kind || typesHere.has(k)).map((k) => (
            <button
              key={k}
              type="button"
              className="chip"
              aria-pressed={kind === k}
              onClick={() => replaceQuery({ type: k === 'all' ? null : k })}
            >
              {kindLabel(k)}
            </button>
          ))}
          {(archivedCount > 0 || archived) && kind !== 'photos' && (
            <button
              type="button"
              className="chip"
              aria-pressed={archived}
              onClick={() => replaceQuery({ archived: archived ? null : '1' })}
            >
              已归档
            </button>
          )}
          {tree && tree.roots.length > 0 && (
            <button type="button" className="chip" aria-expanded={tagsOpen} aria-controls={tagsId} onClick={() => setTagsOpen((o) => !o)}>
              标签{selected.length > 0 && <span className="mono">&nbsp;{selected.length}</span>}
            </button>
          )}
        </div>
        {tree && (
          <div id={tagsId} className="ar-tags" hidden={!tagsOpen}>
            <TagFilter tree={tree} selected={selected} counts={counts} onToggle={toggleTag} unit="项" />
          </div>
        )}
        {years.length > 1 && (
          <nav className="ar-years mono" aria-label="年份">
            {years.map((y) => (
              <a
                key={y.year}
                href={`#ar-y${y.year}`}
                onClick={(e) => {
                  e.preventDefault();
                  showAtLeast(y.index + PAGE_DAYS);
                  setJump(y.year);
                }}
              >
                {y.year}
              </a>
            ))}
          </nav>
        )}
      </div>

      {list.truncated && <p className="bw-limit">只显示最近的 {ENTRY_LIST_LIMIT} 条记录</p>}
      {photos.truncated && showsPhotos(kind) && <TruncatedNote />}
      {photos.error && showsPhotos(kind) && <p className="error-text">照片没有加载出来</p>}

      {timeline.days.length === 0 && undated.length === 0 ? (
        <EmptyState title="没有符合的内容">
          {filtered && (
            <button type="button" className="btn" onClick={() => replaceQuery({ type: null, archived: null, tags: null })}>
              清除筛选
            </button>
          )}
        </EmptyState>
      ) : (
        <div className="ar-line">
          {days.map((d, i) => {
            const year = d.day.slice(0, 4);
            const firstOfYear = i === 0 || days[i - 1].day.slice(0, 4) !== year;
            return (
              <Fragment key={d.day}>
                {firstOfYear && (
                  <h2 id={`ar-y${year}`} className="ar-year mono">
                    {year}
                  </h2>
                )}
                <section className="ar-day" aria-labelledby={`ar-d${d.day}`}>
                  <h3 id={`ar-d${d.day}`} className="ar-day-name">
                    <DayName day={d.day} today={today} />
                  </h3>
                  <div className="ar-day-body">
                    {d.segments.map((s) =>
                      s.kind === 'entry' ? (
                        <EntryCard key={s.entry.id} entry={s.entry} photos={photos.byId} tags={tagMap} own />
                      ) : (
                        <PhotoRun key={s.photos[0].id} photos={s.photos} />
                      )
                    )}
                  </div>
                </section>
              </Fragment>
            );
          })}
          {more && <div ref={end} className="ar-end" />}
          {undated.length > 0 && (
            <section className="ar-day" aria-labelledby="ar-undated">
              <h3 id="ar-undated" className="ar-day-name">
                没有拍摄时间
              </h3>
              <div className="ar-day-body">
                <PhotoRun photos={undated} />
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

export default function Archive() {
  const { user, loading } = useSession();
  useDocumentTitle('档案');
  useScrollTop();
  return (
    <main className="page-narrow en">
      <ArchiveTabs />
      <header className="en-head">
        <h1 className="display display-l">档案</h1>
      </header>
      {loading ? <Loading /> : user ? <Body /> : <SignedOut title="登录后查看自己的档案" next="/archive" />}
    </main>
  );
}
