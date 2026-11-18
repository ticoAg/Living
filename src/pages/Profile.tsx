import { useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import type { EntrySummary, PhotoSummary, ThemeSummary, UserProfile } from '../../shared/types';
import { enc, unwrap, usePhotoList } from '../browse/api';
import Gallery from '../browse/Gallery';
import { useDocTitle, useScrollTop } from '../browse/hooks';
import { LoadError, Loading } from '../browse/ui';
import Img from '../components/Img';
import VisitorLink from '../components/VisitorLink';
import { useEntryList, useTagMap } from '../entries/api';
import EntryCard from '../entries/EntryCard';
import { useApi } from '../lib/useApi';
import { fmtDay, localDay } from '../lib/format';
import { useSession } from '../lib/session';
import { useProjectList } from '../projects/api';
import ProjectCard from '../projects/ProjectCard';
import { byStatusAndTouch } from '../projects/stages';
import ArticleRow from '../showcase/ArticleRow';
import { PROFILE_ARTICLES, PROFILE_WORKS, shelve } from '../showcase/showcase';
import WorkGrid from '../showcase/WorkGrid';
import '../styles/browse.css';
import '../styles/entries.css';
import '../styles/projects.css';
import '../styles/showcase.css';

const VISIBILITY: Record<string, string> = { unlisted: '仅链接可见', private: '仅自己可见' };

function themeMeta(t: ThemeSummary): string {
  const range = t.startDate
    ? `${fmtDay(t.startDate)}${t.endDate && t.endDate !== t.startDate ? ` – ${fmtDay(t.endDate).slice(5)}` : ''}`
    : t.kind === 'trip'
      ? '旅程'
      : '专题';
  return `${range} · ${t.photoCount} 张`;
}

/** The person's works: finished creations, the first few, with a link to all of them when there are more. */
function ProfileWorks({ handle, works, own }: { handle: string; works: readonly EntrySummary[]; own: boolean }) {
  if (!works.length) return null;
  return (
    <section className="sc-shelf" aria-labelledby="prof-works">
      <div className="sc-bar">
        <h2 id="prof-works" className="sc-h2">
          作品
        </h2>
        {works.length > PROFILE_WORKS && (
          <Link href={`/@${handle}/works`} className="sc-all">
            全部 {works.length}
          </Link>
        )}
      </div>
      <WorkGrid works={works.slice(0, PROFILE_WORKS)} own={own} />
    </section>
  );
}

/** The person's articles, latest first, the first few, with a link to all of them when there are more. */
function ProfileArticles({ handle, articles, own }: { handle: string; articles: readonly EntrySummary[]; own: boolean }) {
  if (!articles.length) return null;
  return (
    <section className="sc-shelf sc-shelf-text" aria-labelledby="prof-articles">
      <div className="sc-bar">
        <h2 id="prof-articles" className="sc-h2">
          文章
        </h2>
        {articles.length > PROFILE_ARTICLES && (
          <Link href={`/@${handle}/articles`} className="sc-all">
            全部 {articles.length}
          </Link>
        )}
      </div>
      <ul className="sc-articles">
        {articles.slice(0, PROFILE_ARTICLES).map((e) => (
          <li key={e.id}>
            <ArticleRow entry={e} own={own} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Entries shown at first, and added with each 更多. */
const ENTRY_STEP = 6;

/** The person's other finished entries, latest first; the author's own marked with who can see them. */
function ProfileEntries({
  handle,
  entries,
  photos,
  own
}: {
  handle: string;
  entries: readonly EntrySummary[];
  photos: readonly PhotoSummary[] | undefined;
  own: boolean;
}) {
  const tags = useTagMap(`/api/tags?owner=${enc(handle)}`);
  const byId = useMemo(() => new Map((photos ?? []).map((p) => [p.id, p])), [photos]);
  const [limit, setLimit] = useState(ENTRY_STEP);
  if (!entries.length) return null;
  return (
    <section className="prof-entries" aria-labelledby="prof-entries">
      <h2 id="prof-entries" className="bw-h2">
        记录
      </h2>
      <ul className="en-list">
        {entries.slice(0, limit).map((e) => (
          <li key={e.id}>
            <EntryCard entry={e} photos={byId} tags={tags.byId} withDay own={own} />
          </li>
        ))}
      </ul>
      {entries.length > limit && (
        <button type="button" className="btn btn-quiet" onClick={() => setLimit((n) => n + ENTRY_STEP * 2)}>
          更多
        </button>
      )}
    </section>
  );
}

/** The person's projects the viewer may see listed: the public ones, or all of one's own, marked. */
function ProfileProjects({ handle, own }: { handle: string; own: boolean }) {
  const { projects } = useProjectList(`/api/projects?owner=${enc(handle)}`);
  const sorted = useMemo(() => [...(projects ?? [])].sort(byStatusAndTouch), [projects]);
  if (!sorted.length) return null;
  const today = localDay();
  return (
    <section className="prof-projects" aria-labelledby="prof-projects">
      <h2 id="prof-projects" className="bw-h2">
        项目
      </h2>
      <ul className="pj-list">
        {sorted.map((p) => (
          <li key={p.id}>
            <ProjectCard project={p} today={today} own={own} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** /@handle — the user's header, works, articles, collections, projects, other entries and gallery. */
export default function Profile() {
  // The route is declared as "/@:handle"; accept the handle with or without its "@"
  const params = useParams() as Record<string, string | undefined>;
  const handle = (params.handle ?? params[0] ?? '').replace(/^@/, '');

  const user = useApi<unknown>(handle ? `/api/users/${enc(handle)}` : null);
  const profile = unwrap<UserProfile>(user.data, 'user');
  // handles are case-insensitive; use the canonical spelling so these requests share the gallery's cache entries
  const canonical = profile?.handle ?? null;
  const themes = useApi<{ themes: ThemeSummary[] }>(canonical ? `/api/themes?owner=${enc(canonical)}` : null);
  const { photos } = usePhotoList(canonical ? `owner=${enc(canonical)}` : null);
  const { entries } = useEntryList(canonical ? `/api/entries?owner=${enc(canonical)}` : null);
  const shelves = useMemo(() => shelve(entries ?? []), [entries]);
  const { user: me } = useSession();
  const own = !!me && !!canonical && me.handle.toLowerCase() === canonical.toLowerCase();

  useDocTitle(profile ? `${profile.displayName} @${profile.handle}` : null);
  useScrollTop(handle);

  if (user.error) {
    return (
      <main className="page bw">
        <LoadError
          error={user.error}
          onRetry={user.reload}
          notFound={{ title: '没有这位用户', hint: `找不到 @${handle}。`, back: { href: '/', label: '回到图库' } }}
        />
      </main>
    );
  }
  if (!profile) {
    return (
      <main className="page bw">
        <Loading />
      </main>
    );
  }

  const avatar = profile.avatarPhotoId ? photos?.find((p) => p.id === profile.avatarPhotoId) : undefined;
  const themeList = themes.data?.themes ?? [];

  return (
    <main className="page bw">
      <header className="prof-head">
        {avatar && <Img photo={avatar} ratio="1 / 1" sizes="96px" alt="" className="prof-avatar" />}
        <div className="prof-id">
          <h1 className="display display-m prof-name">{profile.displayName}</h1>
          <p className="prof-handle mono">@{profile.handle}</p>
          {profile.bio && <p className="prof-bio">{profile.bio}</p>}
          {own && (
            <p className="prof-own">
              <VisitorLink href={`/@${profile.handle}`} />
            </p>
          )}
        </div>
        <p className="prof-counts">
          <span>
            <span className="prof-num">{profile.photoCount}</span>
            <span className="prof-unit">张</span>
          </span>
          <span>
            <span className="prof-num">{profile.themeCount}</span>
            <span className="prof-unit">个合集</span>
          </span>
          {profile.entryCount > 0 && (
            <span>
              <span className="prof-num">{profile.entryCount}</span>
              <span className="prof-unit">条记录</span>
            </span>
          )}
          {profile.projectCount > 0 && (
            <span>
              <span className="prof-num">{profile.projectCount}</span>
              <span className="prof-unit">个项目</span>
            </span>
          )}
        </p>
      </header>

      <ProfileWorks handle={profile.handle} works={shelves.works} own={own} />

      <ProfileArticles handle={profile.handle} articles={shelves.articles} own={own} />

      {themeList.length > 0 && (
        <section className="prof-themes" aria-labelledby="prof-themes">
          <h2 id="prof-themes" className="bw-h2">
            合集
          </h2>
          <ul>
            {themeList.map((t) => (
              <li key={t.id}>
                <Link href={`/t/${t.id}`} className="prof-theme">
                  {t.cover ? (
                    <Img photo={t.cover} ratio="3 / 2" sizes="280px" alt="" />
                  ) : (
                    <span className="prof-theme-blank" aria-hidden="true" />
                  )}
                  <span className="prof-theme-title">{t.title}</span>
                  <span className="prof-theme-meta">
                    {themeMeta(t)}
                    {VISIBILITY[t.visibility] && <em>{VISIBILITY[t.visibility]}</em>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ProfileProjects handle={profile.handle} own={own} />

      <ProfileEntries handle={profile.handle} entries={shelves.rest} photos={photos} own={own} />

      <Gallery owner={profile.handle} />
    </main>
  );
}
