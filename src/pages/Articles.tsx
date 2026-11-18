import { useMemo, useState } from 'react';
import { enc } from '../browse/api';
import { useDocTitle, useScrollTop } from '../browse/hooks';
import { EmptyState, LoadError, Loading } from '../browse/ui';
import { useEntryList } from '../entries/api';
import ArticleRow from '../showcase/ArticleRow';
import { ARTICLE_TYPE, byYear, shelve } from '../showcase/showcase';
import ShowcaseHead from '../showcase/ShowcaseHead';
import { usePerson } from '../showcase/usePerson';
import '../styles/browse.css';
import '../styles/entries.css';
import '../styles/showcase.css';

/** Articles drawn at first, and added with each 更多. */
const ARTICLE_STEP = 100;

/** /@handle/articles — every article of a person the viewer may see, latest first, a year at a time. */
export default function Articles() {
  const { handle, profile, error, reload, own } = usePerson();
  const list = useEntryList(profile ? `/api/entries?owner=${enc(profile.handle)}&type=${ARTICLE_TYPE}` : null);
  const articles = useMemo(() => (list.entries ? shelve(list.entries).articles : undefined), [list.entries]);
  const [limit, setLimit] = useState(ARTICLE_STEP);
  const years = useMemo(() => byYear((articles ?? []).slice(0, limit)), [articles, limit]);

  useDocTitle(profile ? `文章 · ${profile.displayName}` : null);
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
  if (!profile || !articles) {
    return (
      <main className="page bw">
        <Loading />
      </main>
    );
  }
  return (
    <main className="page bw sc-page sc-page-text">
      <ShowcaseHead profile={profile} title="文章" count={articles.length} />
      {articles.length ? (
        years.map((g) => (
          <section key={g.year} aria-labelledby={`sc-y${g.year}`}>
            <h2 id={`sc-y${g.year}`} className="sc-year">
              {g.year}
            </h2>
            <ul className="sc-articles">
              {g.entries.map((e) => (
                <li key={e.id}>
                  <ArticleRow entry={e} own={own} />
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <EmptyState title="还没有文章" />
      )}
      {articles.length > limit && (
        <button type="button" className="btn btn-quiet sc-more" onClick={() => setLimit((n) => n + ARTICLE_STEP)}>
          更多
        </button>
      )}
    </main>
  );
}
