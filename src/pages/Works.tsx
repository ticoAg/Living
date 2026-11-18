import { useMemo, useState } from 'react';
import { enc } from '../browse/api';
import { useDocTitle, useScrollTop } from '../browse/hooks';
import { EmptyState, LoadError, Loading } from '../browse/ui';
import { useEntryList } from '../entries/api';
import { shelve, WORK_STEP, WORK_TYPE } from '../showcase/showcase';
import ShowcaseHead from '../showcase/ShowcaseHead';
import { usePerson } from '../showcase/usePerson';
import WorkGrid from '../showcase/WorkGrid';
import '../styles/browse.css';
import '../styles/entries.css';
import '../styles/showcase.css';

/** /@handle/works — every work of a person the viewer may see, latest first. */
export default function Works() {
  const { handle, profile, error, reload, own } = usePerson();
  const list = useEntryList(profile ? `/api/entries?owner=${enc(profile.handle)}&type=${WORK_TYPE}` : null);
  const works = useMemo(() => (list.entries ? shelve(list.entries).works : undefined), [list.entries]);
  const [limit, setLimit] = useState(WORK_STEP);

  useDocTitle(profile ? `作品 · ${profile.displayName}` : null);
  useScrollTop(handle);

  if (error || list.error) {
    return (
      <main className="page bw">
        <LoadError
          error={error ?? list.error}
          onRetry={error ? reload : list.reload}
          notFound={{ title: '没有这位用户', hint: `找不到 @${handle}。`, back: { href: '/', label: '回到图库' } }}
        />
      </main>
    );
  }
  if (!profile || !works) {
    return (
      <main className="page bw">
        <Loading />
      </main>
    );
  }
  return (
    <main className="page bw sc-page">
      <ShowcaseHead profile={profile} title="作品" count={works.length} />
      {works.length ? <WorkGrid works={works.slice(0, limit)} own={own} /> : <EmptyState title="还没有作品" />}
      {works.length > limit && (
        <button type="button" className="btn btn-quiet sc-more" onClick={() => setLimit((n) => n + WORK_STEP)}>
          更多
        </button>
      )}
    </main>
  );
}
