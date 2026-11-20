import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ENTRY_STATUS_LABELS, entryTypeLabel } from '../../shared/entries';
import { PROJECT_STATUS_LABELS, projectTypeLabel } from '../../shared/projects';
import { queryProblem } from '../../shared/search';
import {
  SEARCH_GROUPS,
  type SearchEntryHit,
  type SearchGroup,
  type SearchGroupName,
  type SearchPhotoHit,
  type SearchPlaceHit,
  type SearchProjectHit,
  type SearchResponse,
  type SearchTagHit,
  type SearchThemeHit,
  type Visibility
} from '../../shared/types';
import { EmptyState, LoadError, Loading } from '../browse/ui';
import { replaceQuery, useQuery } from '../browse/url';
import { Icon } from '../components/icons';
import Img from '../components/Img';
import { SignedOut } from '../entries/ui';
import { fmtDay } from '../lib/format';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import Highlight from '../search/Highlight';
import { SEARCH_INPUT_ID } from '../search/shortcut';
import { useKeep } from '../studio/util';
import { useDocumentTitle, useScrollTop } from '../themes/hooks';
import { KIND_LABEL, VISIBILITY_LABEL } from '../themes/util';
import '../styles/entries.css';
import '../styles/search.css';

// /search?q=…&in=<group> — words in one's own archive: entries, photos, projects, collections, and the places and
// tags they use. The query lives in the address, so back and forward return to a search. Docs:
// /docs/product/features/search.md

const TYPING_MS = 350;

const HEADINGS: Record<SearchGroupName, string> = {
  entries: '记录',
  photos: '照片',
  projects: '项目',
  themes: '合集',
  places: '地点',
  tags: '标签'
};

const isGroup = (v: string | null): v is SearchGroupName => !!v && (SEARCH_GROUPS as readonly string[]).includes(v);

const searchHref = (q: string, group?: SearchGroupName) => `/search?q=${encodeURIComponent(q)}${group ? `&in=${group}` : ''}`;

/** Not public: how far it reaches, as the author's own lists mark it. */
const reach = (v: Visibility) => (v === 'public' ? null : `${VISIBILITY_LABEL[v]}可见`);

function Marks({ marks }: { marks: (string | null | false | undefined)[] }) {
  return (
    <>
      {marks.filter(Boolean).map((m) => (
        <span key={m as string} className="en-mark" data-mark={m === ENTRY_STATUS_LABELS.draft ? 'draft' : undefined}>
          {m}
        </span>
      ))}
    </>
  );
}

function Row({
  href,
  thumb,
  title,
  meta,
  snippet
}: {
  href: string;
  thumb?: ReactNode;
  title: ReactNode;
  meta: ReactNode;
  snippet?: ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="sr-row">
        {thumb}
        <span className="sr-main">
          <span className="sr-title">{title}</span>
          <span className="sr-meta">{meta}</span>
          {snippet && <span className="sr-snippet">{snippet}</span>}
        </span>
      </Link>
    </li>
  );
}

const Thumb = ({ photo }: { photo: SearchEntryHit['photo'] }) =>
  photo ? (
    <span className="sr-thumb">
      <Img photo={photo} ratio="1 / 1" sizes="72px" alt="" />
    </span>
  ) : null;

function Entries({ hits, terms }: { hits: SearchEntryHit[]; terms: string[] }) {
  return (
    <ul className="sr-list">
      {hits.map((h) => (
        <Row
          key={h.id}
          href={h.status === 'draft' ? `/e/${h.id}/edit` : `/e/${h.id}`}
          thumb={<Thumb photo={h.photo} />}
          title={<Highlight text={h.label} terms={terms} />}
          meta={
            <>
              <span className="mono">{fmtDay(h.occurredAt)}</span>
              <Marks
                marks={[
                  h.type !== 'note' && entryTypeLabel(h.type),
                  h.status !== 'published' && ENTRY_STATUS_LABELS[h.status],
                  reach(h.visibility)
                ]}
              />
            </>
          }
          snippet={h.snippet && <Highlight text={h.snippet} terms={terms} />}
        />
      ))}
    </ul>
  );
}

function Photos({ hits, terms }: { hits: SearchPhotoHit[]; terms: string[] }) {
  return (
    <ul className="sr-photos">
      {hits.map((p) => (
        <li key={p.id}>
          <Link href={`/p/${p.id}`} className="sr-photo">
            <Img photo={p} ratio="1 / 1" sizes="(max-width: 640px) 50vw, 220px" alt={p.title ?? ''} />
            {p.title && (
              <span className="sr-photo-title">
                <Highlight text={p.title} terms={terms} />
              </span>
            )}
            {p.snippet && (
              <span className="sr-snippet">
                <Highlight text={p.snippet} terms={terms} />
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Projects({ hits, terms }: { hits: SearchProjectHit[]; terms: string[] }) {
  return (
    <ul className="sr-list">
      {hits.map((p) => (
        <Row
          key={p.id}
          href={`/projects/${p.id}`}
          title={<Highlight text={p.title} terms={terms} />}
          meta={
            <>
              <span className="mono">
                {fmtDay(p.startDate)}
                {p.endDate ? ` – ${fmtDay(p.endDate)}` : ' 起'}
              </span>
              <Marks marks={[projectTypeLabel(p.type), PROJECT_STATUS_LABELS[p.status], reach(p.visibility)]} />
            </>
          }
          snippet={p.snippet && <Highlight text={p.snippet} terms={terms} />}
        />
      ))}
    </ul>
  );
}

function Themes({ hits, terms }: { hits: SearchThemeHit[]; terms: string[] }) {
  return (
    <ul className="sr-list">
      {hits.map((t) => (
        <Row
          key={t.id}
          href={`/t/${t.id}`}
          thumb={<Thumb photo={t.cover} />}
          title={<Highlight text={t.subtitle ? `${t.title} · ${t.subtitle}` : t.title} terms={terms} />}
          meta={
            <>
              {t.startDate && (
                <span className="mono">
                  {fmtDay(t.startDate)}
                  {t.endDate && t.endDate !== t.startDate ? ` – ${fmtDay(t.endDate)}` : ''}
                </span>
              )}
              <Marks marks={[KIND_LABEL[t.kind], reach(t.visibility)]} />
            </>
          }
          snippet={t.snippet && <Highlight text={t.snippet} terms={terms} />}
        />
      ))}
    </ul>
  );
}

/** "12 张 · 2 条": one's photos and entries there, the measure words telling which is which. */
const used = (photos: number, entries: number) =>
  [photos ? `${photos} 张` : '', entries ? `${entries} 条` : ''].filter(Boolean).join(' · ');

function Places({ hits, terms }: { hits: SearchPlaceHit[]; terms: string[] }) {
  return (
    <ul className="sr-chips">
      {hits.map((p) => (
        <li key={p.id}>
          <Link href={`/place/${p.id}`} className="sr-chip">
            <Icon name="pin" size={15} />
            <span className="sr-chip-name">
              <Highlight text={p.name} terms={terms} />
            </span>
            {(p.district || p.city) && <span className="sr-chip-aside">{p.district || p.city}</span>}
            {used(p.photoCount, p.entryCount) && <span className="sr-chip-aside mono">{used(p.photoCount, p.entryCount)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Tags({ hits, terms }: { hits: SearchTagHit[]; terms: string[] }) {
  return (
    <ul className="sr-chips">
      {hits.map((t) => (
        <li key={t.id}>
          <Link href={`/archive?tags=${encodeURIComponent(t.id)}`} className="sr-chip">
            <span className="sr-chip-name">
              #<Highlight text={t.name} terms={terms} />
            </span>
            {t.parentName && <span className="sr-chip-aside">{t.parentName}</span>}
            {used(t.photoCount, t.entryCount) && <span className="sr-chip-aside mono">{used(t.photoCount, t.entryCount)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Group<T>({
  name,
  group,
  q,
  only,
  children
}: {
  name: SearchGroupName;
  group: SearchGroup<T> | undefined;
  q: string;
  only: boolean;
  children: (hits: T[]) => ReactNode;
}) {
  if (!group?.hits.length) return null;
  const more = group.total - group.hits.length;
  return (
    <section className="sr-group" aria-labelledby={`sr-${name}`}>
      <h2 id={`sr-${name}`} className="sr-h2">
        {HEADINGS[name]}
        <span className="sr-count mono">{group.total}</span>
        {more > 0 && !only && (
          <Link href={searchHref(q, name)} className="sr-all">
            全部 {group.total}
          </Link>
        )}
      </h2>
      {children(group.hits)}
      {more > 0 && only && <p className="muted sr-cap">只列出前 {group.hits.length} 个，换几个更具体的字试试。</p>}
    </section>
  );
}

function Results({ q, only }: { q: string; only: SearchGroupName | null }) {
  const path = `/api/search?q=${encodeURIComponent(q)}${only ? `&in=${only}` : ''}`;
  const { data: fresh, error, reload } = useApi<SearchResponse>(path);
  // while the next words load, the last results stay instead of a blank page
  const data = useKeep(fresh);
  if (error && !fresh) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading label="正在找" />;
  const terms = data.terms;
  const found = SEARCH_GROUPS.some((g) => data[g]?.hits.length);
  return (
    <div className="sr-results" aria-busy={!fresh} data-stale={fresh ? undefined : ''}>
      {only && (
        <p className="sr-back">
          <Link href={searchHref(q)}>
            <Icon name="left" size={16} />
            全部结果
          </Link>
        </p>
      )}
      {!found && <EmptyState title={`没有找到「${q}」`} />}
      <Group name="entries" group={data.entries} q={q} only={!!only}>
        {(hits) => <Entries hits={hits} terms={terms} />}
      </Group>
      <Group name="photos" group={data.photos} q={q} only={!!only}>
        {(hits) => <Photos hits={hits} terms={terms} />}
      </Group>
      <Group name="projects" group={data.projects} q={q} only={!!only}>
        {(hits) => <Projects hits={hits} terms={terms} />}
      </Group>
      <Group name="themes" group={data.themes} q={q} only={!!only}>
        {(hits) => <Themes hits={hits} terms={terms} />}
      </Group>
      <Group name="places" group={data.places} q={q} only={!!only}>
        {(hits) => <Places hits={hits} terms={terms} />}
      </Group>
      <Group name="tags" group={data.tags} q={q} only={!!only}>
        {(hits) => <Tags hits={hits} terms={terms} />}
      </Group>
    </div>
  );
}

function SearchBox({ q }: { q: string }) {
  const [text, setText] = useState(q);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // the address changed on its own (back, forward, a link): the box follows
  useEffect(() => setText(q), [q]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (value: string) => {
    clearTimeout(timer.current);
    const next = value.trim();
    // new words search the whole archive again; one group was only for the words before
    if (next !== q) replaceQuery({ q: next || null, in: null });
  };
  const later = (value: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(value), TYPING_MS);
  };

  return (
    <form
      role="search"
      className="sr-form"
      onSubmit={(e) => {
        e.preventDefault();
        commit(text);
      }}
    >
      <Icon name="search" size={20} />
      <input
        id={SEARCH_INPUT_ID}
        type="search"
        className="sr-input"
        aria-label="搜索"
        placeholder="记录、照片、项目、合集"
        enterKeyHint="search"
        autoComplete="off"
        autoFocus={!q}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          // an input method still choosing characters: wait for the word
          if (!composing.current) later(e.target.value);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          later(e.currentTarget.value);
        }}
      />
    </form>
  );
}

export default function Search() {
  const { user, loading } = useSession();
  const query = useQuery();
  const q = (query.get('q') ?? '').trim();
  const rawIn = query.get('in');
  const only = isGroup(rawIn) ? rawIn : null;
  useDocumentTitle(q ? `搜索：${q}` : '搜索');
  useScrollTop(q);
  const problem = q ? queryProblem(q) : null;

  return (
    <main className="page-narrow en sr">
      <header className="en-head">
        <h1 className="display display-l">搜索</h1>
      </header>
      {loading ? (
        <Loading />
      ) : !user ? (
        <SignedOut title="登录后在自己的档案里搜索" next={q ? searchHref(q) : '/search'} />
      ) : (
        <>
          <SearchBox q={q} />
          {problem ? <p className="sr-problem">{problem}</p> : q && <Results q={q} only={only} />}
        </>
      )}
    </main>
  );
}
