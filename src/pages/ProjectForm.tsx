import { useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS } from '../../shared/projects';
import { PROJECT_LIMITS } from '../../shared/limits';
import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  VISIBILITIES,
  type CreateProjectBody,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectType,
  type SessionUser,
  type Visibility
} from '../../shared/types';
import { LoadError, Loading } from '../browse/ui';
import AutoTextarea from '../components/AutoTextarea';
import { Icon } from '../components/icons';
import { SignedOut } from '../entries/ui';
import { api, ApiError } from '../lib/api';
import { localDay } from '../lib/format';
import { useSession } from '../lib/session';
import { forget, invalidate, setCached } from '../lib/useApi';
import { projectPath, useProject } from '../projects/api';
import { useDocumentTitle } from '../themes/hooks';
import { VISIBILITY_LABEL } from '../themes/util';
import '../styles/entries.css';
import '../styles/projects.css';

// /projects/new and /projects/:id/edit — a project's name, kind, days, plan, state and who may see it. Saved when the
// author says so; the entries come in from the entry editor. Docs: /docs/product/features/projects.md

const VISIBILITY_HINT: Record<Visibility, string> = {
  public: '出现在你的主页，任何人都能看到。',
  unlisted: '不进入列表，知道链接的人可以看到。',
  private: '只有你能看到。'
};

interface Form {
  title: string;
  type: ProjectType;
  description: string;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  visibility: Visibility;
}

const formOf = (p: ProjectDetail | null): Form =>
  p
    ? {
        title: p.title,
        type: p.type,
        description: p.description ?? '',
        startDate: p.startDate,
        endDate: p.endDate ?? '',
        status: p.status,
        visibility: p.visibility
      }
    : { title: '', type: 'learning', description: '', startDate: localDay(), endDate: '', status: 'active', visibility: 'private' };

const bodyOf = (f: Form): Required<CreateProjectBody> => ({
  title: f.title.trim(),
  type: f.type,
  description: f.description.trim() ? f.description : null,
  startDate: f.startDate,
  endDate: f.endDate || null,
  status: f.status,
  visibility: f.visibility
});

function problemOf(f: Form): string | null {
  if (!f.title.trim()) return '请填写项目名称';
  if ([...f.title.trim()].length > PROJECT_LIMITS.titleMax) return `项目名称最多 ${PROJECT_LIMITS.titleMax} 个字符`;
  if (!f.startDate) return '请填写开始日期';
  if (f.endDate && f.endDate < f.startDate) return '结束日期不能早于开始日期';
  if ([...f.description.trim()].length > PROJECT_LIMITS.descriptionMax) return `说明最多 ${PROJECT_LIMITS.descriptionMax} 个字符`;
  return null;
}

function Editor({ initial }: { initial: ProjectDetail | null }) {
  const id = useId();
  const [, navigate] = useLocation();
  const [form, setForm] = useState<Form>(() => formOf(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  useDocumentTitle(initial ? `编辑 ${initial.title}` : '新建项目');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = problemOf(form);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { project } = initial
        ? await api<{ project: ProjectDetail }>(projectPath(initial.id), { method: 'PATCH', json: bodyOf(form) })
        : await api<{ project: ProjectDetail }>('/api/projects', { json: bodyOf(form) });
      setCached(projectPath(project.id), project);
      invalidate('/api/projects?');
      invalidate('/api/entries?');
      navigate(`/projects/${project.id}`, { replace: !initial });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败，请稍后再试');
      setBusy(false);
    }
  }

  async function destroy() {
    if (!initial) return;
    setBusy(true);
    setError(null);
    try {
      await api(projectPath(initial.id), { method: 'DELETE' });
      forget(projectPath(initial.id));
      invalidate('/api/projects?');
      invalidate('/api/entries?');
      navigate('/projects', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败，请稍后再试');
      setBusy(false);
    }
  }

  return (
    <form className="pf" onSubmit={submit} noValidate>
      <label className="visually-hidden" htmlFor={`${id}-title`}>
        项目名称
      </label>
      <input
        id={`${id}-title`}
        className="ee-title"
        placeholder="项目名称，比如 从零开始学书法"
        value={form.title}
        maxLength={PROJECT_LIMITS.titleMax}
        onChange={(e) => set('title', e.target.value)}
        autoFocus={!initial}
      />

      <div className="pf-row">
        <label className="field">
          <span className="label">类型</span>
          <select className="select" value={form.type} onChange={(e) => set('type', e.target.value as ProjectType)}>
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROJECT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">开始</span>
          <input type="date" className="input" required value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </label>
        <label className="field">
          <span className="label">结束</span>
          <input type="date" className="input" min={form.startDate} value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </label>
      </div>

      <label className="visually-hidden" htmlFor={`${id}-desc`}>
        说明
      </label>
      <AutoTextarea
        id={`${id}-desc`}
        className="textarea pf-desc"
        placeholder="目标、计划、为什么开始，可以用 Markdown"
        value={form.description}
        onChange={(e) => set('description', e.target.value)}
      />

      {initial && (
        <section className="ee-sec" aria-labelledby={`${id}-status`}>
          <h2 id={`${id}-status`} className="ee-h">
            状态
          </h2>
          <div className="seg" role="group" aria-labelledby={`${id}-status`}>
            {PROJECT_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={form.status === s}
                onClick={() => setForm((f) => ({ ...f, status: s, endDate: s === 'completed' && !f.endDate ? localDay() : f.endDate }))}
              >
                {PROJECT_STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="ee-sec" aria-labelledby={`${id}-vis`}>
        <h2 id={`${id}-vis`} className="ee-h">
          公开范围
        </h2>
        <div className="seg" role="group" aria-labelledby={`${id}-vis`}>
          {[...VISIBILITIES].reverse().map((v) => (
            <button key={v} type="button" aria-pressed={form.visibility === v} onClick={() => set('visibility', v)}>
              {VISIBILITY_LABEL[v]}
            </button>
          ))}
        </div>
        <p className="small muted">{VISIBILITY_HINT[form.visibility]}其中的记录和照片各按自己的公开范围显示。</p>
      </section>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="pf-bar">
        {initial &&
          (confirmDelete ? (
            <span className="pf-confirm">
              <span className="small">删除项目和它的里程碑？记录会留下。</span>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void destroy()}>
                确认删除
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                取消
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-ghost pf-delete" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={18} />
              删除
            </button>
          ))}
        <Link href={initial ? `/projects/${initial.id}` : '/projects'} className="btn btn-ghost">
          取消
        </Link>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? '保存中…' : initial ? '保存' : '创建'}
        </button>
      </div>
    </form>
  );
}

function Edit({ user, id }: { user: SessionUser; id: string }) {
  const { project, error, reload } = useProject(id);
  if (error && !project) {
    return (
      <LoadError
        error={error}
        onRetry={reload}
        notFound={{ title: '项目不存在，或你没有权限查看', back: { href: '/projects', label: '我的项目' } }}
      />
    );
  }
  if (!project) return <Loading />;
  if (project.ownerId !== user.id) return <p className="muted">只能修改自己的项目。</p>;
  return <Editor key={project.id} initial={project} />;
}

export default function ProjectForm() {
  const { id } = useParams<{ id?: string }>();
  const { user, loading } = useSession();
  return (
    <main className="page-narrow en ee pf-page">
      <header className="en-head">
        <h1 className="display display-m">{id ? '编辑项目' : '新建项目'}</h1>
      </header>
      {loading ? (
        <Loading />
      ) : user ? (
        id ? (
          <Edit user={user} id={id} />
        ) : (
          <Editor initial={null} />
        )
      ) : (
        <SignedOut title="登录后建立项目" next={id ? `/projects/${id}/edit` : '/projects/new'} />
      )}
    </main>
  );
}
