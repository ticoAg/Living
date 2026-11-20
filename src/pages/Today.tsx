import { useMemo } from 'react';
import type { SessionUser } from '../../shared/types';
import { LoadError, Loading } from '../browse/ui';
import { MY_ENTRIES, MY_PHOTOS, useEntryList, usePhotoMap, useTagMap } from '../entries/api';
import EntryCard from '../entries/EntryCard';
import PhotoRun from '../entries/PhotoRun';
import QuickCapture from '../entries/QuickCapture';
import { todayView } from '../entries/timeline';
import { SignedOut } from '../entries/ui';
import { fmtLongDay, localDay } from '../lib/format';
import { useSession } from '../lib/session';
import ActiveProjects from '../projects/ActiveProjects';
import { useDocumentTitle, useScrollTop } from '../themes/hooks';
import '../styles/browse.css';
import '../styles/entries.css';

// /today — the day so far: a quick note, the projects going on, the day's entries and photos, what is unfinished, and
// the same day in the years before. Docs: /docs/product/features/today.md

function Body({ user }: { user: SessionUser }) {
  const today = localDay();
  const list = useEntryList(MY_ENTRIES);
  const photos = usePhotoMap(MY_PHOTOS);
  const tags = useTagMap();
  const view = useMemo(
    () => (list.entries ? todayView(list.entries, photos.photos ?? [], today) : null),
    [list.entries, photos.photos, today]
  );

  let body;
  if (list.error && !list.entries) body = <LoadError error={list.error} onRetry={list.reload} />;
  else if (!view) body = <Loading />;
  else {
    const card = (e: (typeof view.entries)[number], withDay = false) => (
      <li key={e.id}>
        <EntryCard entry={e} photos={photos.byId} tags={tags.byId} withDay={withDay} own />
      </li>
    );
    body = (
      <>
        {(view.entries.length > 0 || view.photos.length > 0) && (
          <section className="td-section" aria-label="今天">
            {view.entries.length > 0 && <ul className="en-list">{view.entries.map((e) => card(e))}</ul>}
            {view.photos.length > 0 && <PhotoRun photos={view.photos} label="今天的照片" />}
          </section>
        )}
        {view.drafts.length > 0 && (
          <section className="td-section" aria-labelledby="td-drafts">
            <h2 id="td-drafts" className="en-h2">
              草稿
            </h2>
            <ul className="en-list">{view.drafts.map((e) => card(e, true))}</ul>
          </section>
        )}
        {view.past.length > 0 && (
          <section className="td-section" aria-labelledby="td-past">
            <h2 id="td-past" className="en-h2">
              往年今天
            </h2>
            {view.past.map((y) => (
              <div key={y.year} className="td-year">
                <h3 className="en-h3">
                  <span className="mono">{y.year}</span>
                  <span className="muted">{Number(today.slice(0, 4)) - y.year} 年前</span>
                </h3>
                {y.entries.length > 0 && <ul className="en-list">{y.entries.map((e) => card(e))}</ul>}
                {y.photos.length > 0 && <PhotoRun photos={y.photos} label={`${y.year} 年的照片`} />}
              </div>
            ))}
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <QuickCapture userId={user.id} />
      <ActiveProjects today={today} />
      {body}
    </>
  );
}

export default function Today() {
  const { user, loading } = useSession();
  useDocumentTitle('今天');
  useScrollTop();
  return (
    <main className="page-narrow en">
      <header className="en-head">
        <h1 className="display display-l">今天</h1>
        <p className="en-head-sub">{fmtLongDay(localDay())}</p>
      </header>
      {loading ? <Loading /> : user ? <Body user={user} /> : <SignedOut title="登录后记下今天" next="/today" />}
    </main>
  );
}
