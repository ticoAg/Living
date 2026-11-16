import { Link, useParams } from 'wouter';
import { ENTRY_STATUS_LABELS, entryLabel, entryTypeLabel, hasTime, occurredDay } from '../../shared/entries';
import type { EntryDetail } from '../../shared/types';
import { LoadError, Loading } from '../browse/ui';
import { useTagMap } from '../entries/api';
import Markdown from '../entries/Markdown';
import { Icon } from '../components/icons';
import Img from '../components/Img';
import { fmtLongDay, fmtTime } from '../lib/format';
import { useSession } from '../lib/session';
import { useApi } from '../lib/useApi';
import { MY_PROJECTS, useProjectList } from '../projects/api';
import { useDocumentTitle, useScrollTop } from '../themes/hooks';
import { VISIBILITY_LABEL } from '../themes/util';
import '../styles/browse.css';
import '../styles/entries.css';

// /e/:id — an entry to read: the projects it is in, its text as Markdown, its photos with their captions, its tags. Others see it only once it
// is finished and not private; its photos are each shown or left out by their own visibility. Docs: /docs/product/features/entries.md

function Reader({ entry: e, own }: { entry: EntryDetail; own: boolean }) {
  const tags = useTagMap(own ? '/api/tags' : `/api/tags?owner=${encodeURIComponent(e.ownerHandle)}`);
  const tagNames = e.tagIds.map((id) => tags.byId.get(id)?.name).filter((n): n is string => !!n);
  // the projects it is in that the reader may see listed: the author's own, or the public ones
  const { projects } = useProjectList(
    e.projectIds.length ? (own ? MY_PROJECTS : `/api/projects?owner=${encodeURIComponent(e.ownerHandle)}`) : null
  );
  const inProjects = (projects ?? []).filter((p) => e.projectIds.includes(p.id));
  const day = fmtLongDay(occurredDay(e.occurredAt));
  const marks = [
    e.type !== 'note' ? entryTypeLabel(e.type) : '',
    own && e.status !== 'published' ? ENTRY_STATUS_LABELS[e.status] : '',
    own ? `${VISIBILITY_LABEL[e.visibility]}${e.visibility === 'public' ? '' : '可见'}` : ''
  ].filter(Boolean);

  return (
    <article className="er">
      <header className="er-head">
        {inProjects.length > 0 && (
          <p className="er-projects">
            {inProjects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                {p.title}
              </Link>
            ))}
          </p>
        )}
        <p className="er-meta">
          <span>
            {e.occurredAt.slice(0, 4)} · {day}
            {hasTime(e.occurredAt) && <span className="mono"> {fmtTime(e.occurredAt)}</span>}
          </span>
          {marks.map((m) => (
            <span key={m} className="en-mark">
              {m}
            </span>
          ))}
        </p>
        <h1 className="display display-l er-title">{e.title ?? (e.body ? day : entryTypeLabel(e.type))}</h1>
        {!own && (
          <p className="er-by">
            <Link href={`/@${e.ownerHandle}`}>@{e.ownerHandle}</Link>
          </p>
        )}
      </header>

      {e.status === 'draft' && own && (
        <p className="notice er-draft">
          还是草稿，只有你能看到。
          <Link href={`/e/${e.id}/edit`}>继续写</Link>
        </p>
      )}

      {e.body && <Markdown text={e.body} className="er-body" />}

      {e.media.length > 0 && (
        <div className="er-media">
          {e.media.map((m) => (
            <figure key={m.photoId} className="er-figure">
              <Link href={`/p/${m.photoId}`} className="er-photo" aria-label={m.caption ?? m.photo.title ?? '查看照片'}>
                <Img photo={m.photo} fit="contain" sizes="(max-width: 880px) 100vw, 880px" alt="" />
              </Link>
              {m.caption && <figcaption>{m.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}

      {(tagNames.length > 0 || own) && (
        <footer className="er-foot">
          {tagNames.length > 0 && (
            <p className="er-tags">
              {tagNames.map((n) => (
                <span key={n}>#{n}</span>
              ))}
            </p>
          )}
          {own && (
            <Link href={`/e/${e.id}/edit`} className="btn btn-quiet">
              <Icon name="edit" size={16} />
              编辑
            </Link>
          )}
        </footer>
      )}
    </article>
  );
}

export default function EntryReader() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const { data, error, reload } = useApi<EntryDetail>(`/api/entries/${encodeURIComponent(id)}`);
  useDocumentTitle(data ? entryLabel(data.title, data.body) || entryTypeLabel(data.type) : null);
  useScrollTop(id);

  let body;
  if (data) body = <Reader entry={data} own={!!user && user.id === data.ownerId} />;
  else if (error) {
    body = (
      <LoadError
        error={error}
        onRetry={reload}
        notFound={{
          title: '记录不存在，或你没有权限查看',
          back: user ? { href: '/archive', label: '回到档案' } : { href: '/', label: '回到图库' }
        }}
      />
    );
  } else body = <Loading />;

  return <main className="page-narrow en">{body}</main>;
}
