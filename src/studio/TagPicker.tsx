import { useId, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import type { Tag } from '../../shared/types';
import { Icon } from '../components/icons';
import { api } from '../lib/api';
import { buildTagTree, isSwatch, swatchFill, type TagNode } from '../lib/tags';
import { invalidate, useApi } from '../lib/useApi';
import { boardRows, searchBoard, toggleTag, withTag, type BoardItem } from './tag-board';
import { errMsg, useKeep } from './util';

// Tag board for the upload form and the photo editor: every tag in view, one row per root (题材 · 光与天气 · 季节 ·
// 色调 · people's own roots), each a toggle; groups such as 自然 or 天气 start their run of tags. A season, a light and
// a tone exclude the others of their kind (tag-board.ts). The search box narrows the board and offers to create a tag
// that does not exist yet. Controlled: `value` is every selected id.

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

/** A group label and the tag after it go together, so a line never ends on a label. */
function runs(items: readonly BoardItem[]): BoardItem[][] {
  const out: BoardItem[][] = [];
  for (let i = 0; i < items.length; i++) {
    const next = items[i + 1];
    if (items[i].group && next && !next.group) out.push([items[i], items[++i]]);
    else out.push([items[i]]);
  }
  return out;
}

export default function TagPicker({ value, onChange, disabled }: Props) {
  const id = useId();
  const { data, error, reload } = useApi<{ tags: Tag[] }>('/api/tags');
  const kept = useKeep(data);
  const [extra, setExtra] = useState<Tag[]>([]);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState<{ name: string; parent: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const tags = useMemo(() => {
    const base = kept?.tags ?? [];
    const have = new Set(base.map((t) => t.id));
    return [...base, ...extra.filter((t) => !have.has(t.id))];
  }, [kept, extra]);
  const tree = useMemo(() => buildTagTree(tags), [tags]);
  const rows = useMemo(() => boardRows(tree), [tree]);
  const shown = useMemo(() => searchBoard(rows, q), [rows, q]);
  const selected = new Set(value);
  const term = q.trim();

  const toggle = (tagId: string) => {
    if (!disabled) onChange(toggleTag(value, tagId));
  };

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!creating) return;
    const name = creating.name.trim();
    if (!name) return;
    if ([...name].length > 24) {
      setProblem('名称最多 24 个字符');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const res = await api<{ tag: Tag }>('/api/tags', { json: { name, parentId: creating.parent || null } });
      setExtra((prev) => [...prev, res.tag]);
      invalidate('/api/tags');
      onChange(withTag(value, res.tag.id));
      setCreating(null);
      setQ('');
    } catch (err) {
      setProblem(errMsg(err, '新建标签失败'));
    } finally {
      setBusy(false);
    }
  }

  const chip = (n: TagNode, group = false) => (
    <button
      key={n.id}
      type="button"
      className={group ? 'tp-grp' : 'tp-chip'}
      aria-pressed={selected.has(n.id)}
      title={tree.path(n.id).join(' / ')}
      disabled={disabled}
      onClick={() => toggle(n.id)}
    >
      {isSwatch(n) && <span className="tp-dot" style={{ background: swatchFill(n.color) }} aria-hidden="true" />}
      {n.name}
    </button>
  );

  return (
    <div className="tp">
      <div className="tp-bar">
        <label className="visually-hidden" htmlFor={`${id}-q`}>
          搜索标签
        </label>
        <span className="tp-search">
          <Icon name="search" size={15} />
          <input
            id={`${id}-q`}
            className="tp-q"
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCreating(null);
            }}
            placeholder="搜索或新建标签"
            autoComplete="off"
            maxLength={24}
            disabled={disabled}
          />
        </span>
        <Link href="/studio/tags" className="tp-manage small" target="_blank" rel="noopener">
          管理
        </Link>
      </div>

      {!kept && !error && <p className="small muted tp-note">标签加载中…</p>}
      {!kept && error != null && (
        <p className="small error-text tp-note" role="alert">
          标签加载失败。
          <button type="button" className="btn btn-quiet" onClick={reload}>
            重试
          </button>
        </p>
      )}

      {kept && (
        <div className="tp-board">
          {shown.rows.map((row) => (
            <div key={row.root.id} className="tp-row" role="group" aria-label={row.root.name}>
              {/* a preset root (题材, 季节…) only heads its row; a root of one's own is a tag like any other */}
              {row.root.ownerId ? chip(row.root, true) : <span className="tp-root">{row.root.name}</span>}
              <span className="tp-chips">
                {runs(row.items).map((run) =>
                  run.length > 1 ? (
                    <span key={run[0].node.id} className="tp-run">
                      {run.map((it) => chip(it.node, it.group))}
                    </span>
                  ) : (
                    chip(run[0].node, run[0].group)
                  )
                )}
              </span>
            </div>
          ))}
          {term && !shown.exact && !creating && (
            <button
              type="button"
              className="tp-new"
              disabled={disabled}
              onClick={() => {
                setProblem(null);
                setCreating({ name: term, parent: '' });
              }}
            >
              <Icon name="plus" size={14} />
              新建「{term}」
            </button>
          )}
          {term && shown.rows.length === 0 && !creating && <p className="small muted tp-note">没有叫「{term}」的标签</p>}
        </div>
      )}

      {creating && (
        <form className="tp-create" onSubmit={create}>
          <label className="small muted" htmlFor={`${id}-parent`}>
            放在
          </label>
          <select
            id={`${id}-parent`}
            className="input select tp-parent"
            value={creating.parent}
            onChange={(e) => setCreating({ ...creating, parent: e.target.value })}
            disabled={busy}
          >
            <option value="">最上层</option>
            {rows
              .flatMap((r) => [r.root, ...r.items.map((it) => it.node)])
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {'　'.repeat(n.depth)}
                  {n.name}
                </option>
              ))}
          </select>
          <label className="visually-hidden" htmlFor={`${id}-name`}>
            名称
          </label>
          <input
            id={`${id}-name`}
            className="input tp-name"
            value={creating.name}
            onChange={(e) => setCreating({ ...creating, name: e.target.value })}
            maxLength={24}
            disabled={busy}
            required
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !creating.name.trim()}>
            {busy ? '添加中…' : '添加'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => setCreating(null)} disabled={busy}>
            取消
          </button>
          {problem && (
            <p className="error-text tp-problem" role="alert">
              {problem}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
