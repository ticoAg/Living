import { useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import { PROJECT_STATUS_LABELS, projectTypeLabel } from '../../shared/projects';
import type { EntrySummary, Milestone, PhotoSummary, ProjectDetail } from '../../shared/types';
import { LoadError, Loading } from '../browse/ui';
import { Icon } from '../components/icons';
import Img from '../components/Img';
import { useEntryList, useTagMap } from '../entries/api';
import EntryCard from '../entries/EntryCard';
import Markdown from '../entries/Markdown';
import PhotoRun from '../entries/PhotoRun';
import { fmtDay, localDay } from '../lib/format';
import { useSession } from '../lib/session';
import { usePaged } from '../lib/usePaged';
import { projectEntriesPath, useProject } from '../projects/api';
import MilestoneForm from '../projects/MilestoneForm';
import { countsText, spanText } from '../projects/ProjectCard';
import { courseOf, firstAndLatest, type Stage } from '../projects/stages';
import ShareButton from '../shares/ShareButton';
import { occurredDay } from '../../shared/entries';
import { useDocumentTitle, useScrollTop } from '../themes/hooks';
import { fmtRange, VISIBILITY_LABEL } from '../themes/util';
import '../styles/browse.css';
import '../styles/entries.css';
import '../styles/projects.css';

// /projects/:id — a project as a course of time: how long it has run and what it holds, its first work beside its
// latest, its stages between milestones with the works of each, and its entries. Others see what they could open by
// link: a public project shows none of its private entries or photos. Docs: /docs/product/features/projects.md

/** entries rendered at first, and added as the end comes near */
const PAGE = 20;

function Work({ label, photo, entry }: { label: string; photo: PhotoSummary; entry: EntrySummary }) {
  return (
    <figure className="pj-work">
      <Link href={`/e/${entry.id}`} className="pj-work-img">
        <Img photo={photo} ratio="1 / 1" sizes="(max-width: 640px) 45vw, 320px" alt="" />
      </Link>
      <figcaption>
        <span>{label}</span> <span className="mono">{fmtDay(entry.occurredAt)}</span>
      </figcaption>
    </figure>
  );
}

function MilestoneHead({ m, onEdit, planned }: { m: Milestone; onEdit?: () => void; planned?: boolean }) {
  return (
    <div className="pj-stage-head">
      <h3 className="pj-stage-name">{m.title}</h3>
      <span className="mono small">{fmtDay(m.date)}</span>
      {planned && <span className="en-mark">计划</span>}
      {onEdit && (
        <button type="button" className="btn btn-ghost btn-icon pj-stage-edit" aria-label={`编辑里程碑 ${m.title}`} onClick={onEdit}>
          <Icon name="edit" size={16} />
        </button>
      )}
    </div>
  );
}

function StageItem({ stage, project, own, editing, setEditing }: StageProps) {
  const m = stage.milestone;
  if (m && editing === m.id) {
    return (
      <li className="pj-stage">
        <MilestoneForm projectId={project.id} milestone={m} onDone={() => setEditing(null)} />
      </li>
    );
  }
  // the stage after the last milestone: still going, or the close of a completed project
  const done = project.status === 'completed';
  const name = m ? m.title : done ? '完成' : '现在';
  const last = stage.entries.at(-1);
  const to = stage.to ?? (done ? (project.endDate ?? (last ? occurredDay(last.occurredAt) : null)) : null);
  return (
    <li className="pj-stage" data-current={m || done ? undefined : 'true'}>
      {m ? (
        <MilestoneHead m={m} onEdit={own ? () => setEditing(m.id) : undefined} />
      ) : (
        <div className="pj-stage-head">
          <h3 className="pj-stage-name">{name}</h3>
        </div>
      )}
      <p className="pj-stage-sub">
        <span className="mono">{to ? fmtRange(stage.from, to) : `${fmtDay(stage.from)} – 今天`}</span>
        {stage.entries.length > 0 && <span>{stage.entries.length} 条记录</span>}
      </p>
      {stage.photos.length > 0 && <PhotoRun photos={stage.photos} label={`${name}的照片`} />}
      {m?.body && <Markdown text={m.body} className="pj-stage-text" />}
    </li>
  );
}

interface StageProps {
  stage: Stage;
  project: ProjectDetail;
  own: boolean;
  editing: string | null;
  setEditing: (id: string | null) => void;
}

function Page({ project: p, photoById, own }: { project: ProjectDetail; photoById: ReadonlyMap<string, PhotoSummary>; own: boolean }) {
  const today = localDay();
  const list = useEntryList(projectEntriesPath(p.id));
  const tags = useTagMap(own ? '/api/tags' : `/api/tags?owner=${encodeURIComponent(p.ownerHandle)}`);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  useDocumentTitle(p.title);

  // the author's archived entries stay in the archive; drafts show, marked, to be finished
  const entries = useMemo(() => (list.entries ?? []).filter((e) => e.status !== 'archived'), [list.entries]);
  const course = useMemo(() => courseOf(p, p.milestones, entries, photoById, today), [p, entries, photoById, today]);
  const pair = useMemo(() => firstAndLatest(entries, photoById), [entries, photoById]);
  const { n, more, end } = usePaged(entries.length, PAGE);

  const marks = [
    projectTypeLabel(p.type),
    PROJECT_STATUS_LABELS[p.status],
    own ? `${VISIBILITY_LABEL[p.visibility]}${p.visibility === 'public' ? '' : '可见'}` : ''
  ].filter(Boolean);
  const staged = p.milestones.length > 0;

  return (
    <article className="pj">
      <header className="pj-top">
        <p className="er-meta">
          {marks.map((m) => (
            <span key={m} className="en-mark">
              {m}
            </span>
          ))}
          <span className="mono">{p.endDate ? fmtRange(p.startDate, p.endDate) : `${fmtDay(p.startDate)} 起`}</span>
        </p>
        <h1 className="display display-l pj-title">{p.title}</h1>
        <p className="pj-stats">
          <span>{spanText(p, today)}</span>
          <span>{countsText(p)}</span>
        </p>
        {own ? (
          <div className="row pj-actions">
            <Link href={`/entries/new?project=${encodeURIComponent(p.id)}`} className="btn btn-primary">
              <Icon name="plus" size={18} />
              记一笔
            </Link>
            <ShareButton kind="project" id={p.id} />
            <Link href={`/projects/${p.id}/edit`} className="btn btn-quiet">
              <Icon name="edit" size={18} />
              编辑
            </Link>
          </div>
        ) : (
          <p className="er-by">
            <Link href={`/@${p.ownerHandle}`}>@{p.ownerHandle}</Link>
          </p>
        )}
      </header>

      {p.description && <Markdown text={p.description} className="pj-desc" />}

      {pair && (
        <section className="pj-sec" aria-labelledby="pj-pair">
          <h2 id="pj-pair" className="en-h2">
            最初与最近
          </h2>
          <div className="pj-pair">
            <Work label="最初" photo={pair.first.photo} entry={pair.first.entry} />
            <Work label="最近" photo={pair.latest.photo} entry={pair.latest.entry} />
          </div>
        </section>
      )}

      {(staged || own) && (
        <section className="pj-sec" aria-labelledby="pj-stages">
          <div className="pj-sec-head">
            <h2 id="pj-stages" className="en-h2">
              阶段
            </h2>
            {own && !adding && (
              <button type="button" className="btn btn-quiet" onClick={() => setAdding(true)}>
                <Icon name="plus" size={18} />
                里程碑
              </button>
            )}
          </div>
          {adding && <MilestoneForm projectId={p.id} onDone={() => setAdding(false)} />}
          {staged && (
            <ol className="pj-stages">
              {course.stages.map((s) => (
                <StageItem key={s.milestone?.id ?? 'open'} stage={s} project={p} own={own} editing={editing} setEditing={setEditing} />
              ))}
              {course.planned.map((m) =>
                editing === m.id ? (
                  <li key={m.id} className="pj-stage">
                    <MilestoneForm projectId={p.id} milestone={m} onDone={() => setEditing(null)} />
                  </li>
                ) : (
                  <li key={m.id} className="pj-stage" data-planned="true">
                    <MilestoneHead m={m} planned onEdit={own ? () => setEditing(m.id) : undefined} />
                    {m.body && <Markdown text={m.body} className="pj-stage-text" />}
                  </li>
                )
              )}
            </ol>
          )}
        </section>
      )}

      <section className="pj-sec" aria-labelledby="pj-entries">
        <h2 id="pj-entries" className="en-h2">
          记录
        </h2>
        {list.error && !list.entries ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.entries ? (
          <Loading />
        ) : entries.length === 0 ? (
          <p className="muted">还没有记录。</p>
        ) : (
          <>
            <ul className="en-list">
              {entries.slice(0, n).map((e) => (
                <li key={e.id}>
                  <EntryCard entry={e} photos={photoById} tags={tags.byId} withDay own={own} />
                </li>
              ))}
            </ul>
            {more && <div ref={end} className="ar-end" />}
          </>
        )}
      </section>
    </article>
  );
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  const { project, photoById, error, reload } = useProject(id);
  useScrollTop(id);
  let body;
  if (error && !project) {
    body = <LoadError error={error} onRetry={reload} notFound={{ title: '项目不存在，或你没有权限查看' }} />;
  } else if (!project) {
    body = <Loading />;
  } else {
    body = <Page project={project} photoById={photoById} own={user?.id === project.ownerId} />;
  }
  return <main className="page-narrow en">{body}</main>;
}
