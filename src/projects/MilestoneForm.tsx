import { useId, useState, type FormEvent } from 'react';
import { MILESTONE_LIMITS } from '../../shared/limits';
import type { CreateMilestoneBody, Milestone } from '../../shared/types';
import AutoTextarea from '../components/AutoTextarea';
import { api, ApiError } from '../lib/api';
import { localDay } from '../lib/format';
import { invalidate } from '../lib/useApi';
import { projectPath } from './api';

// A milestone written in place on the project page: a name, a day (reached, or aimed at), and what the stage it
// closes came to. New ones default to today.

interface Props {
  projectId: string;
  /** the milestone to change; none for a new one */
  milestone?: Milestone;
  onDone: () => void;
}

export default function MilestoneForm({ projectId, milestone, onDone }: Props) {
  const id = useId();
  const [title, setTitle] = useState(milestone?.title ?? '');
  const [date, setDate] = useState(milestone?.date ?? localDay());
  const [body, setBody] = useState(milestone?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `${projectPath(projectId)}/milestones`;

  async function run(send: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await send();
      invalidate(projectPath(projectId));
      invalidate('/api/projects?');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败，请稍后再试');
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('请填写里程碑名称');
      return;
    }
    if (!date) {
      setError('请填写日期');
      return;
    }
    const json: CreateMilestoneBody = { title: title.trim(), date, body: body.trim() ? body : null };
    void run(() => (milestone ? api(`${base}/${milestone.id}`, { method: 'PATCH', json }) : api(base, { json })));
  }

  return (
    <form className="ms-form" onSubmit={submit} noValidate aria-label={milestone ? `编辑里程碑 ${milestone.title}` : '新的里程碑'}>
      <div className="ms-form-row">
        <label className="visually-hidden" htmlFor={`${id}-title`}>
          里程碑名称
        </label>
        <input
          id={`${id}-title`}
          className="input"
          placeholder="里程碑，比如 临完第一本字帖"
          value={title}
          maxLength={MILESTONE_LIMITS.titleMax}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <label className="visually-hidden" htmlFor={`${id}-date`}>
          日期
        </label>
        <input id={`${id}-date`} type="date" className="input ms-date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <label className="visually-hidden" htmlFor={`${id}-body`}>
        阶段总结
      </label>
      <AutoTextarea
        id={`${id}-body`}
        className="textarea"
        placeholder="这一阶段的总结，可以用 Markdown"
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="row ms-form-bar">
        {milestone &&
          (confirm ? (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void run(() => api(`${base}/${milestone.id}`, { method: 'DELETE' }))}
            >
              确认删除
            </button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(true)}>
              删除
            </button>
          ))}
        <span className="ms-form-gap" />
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          取消
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}
