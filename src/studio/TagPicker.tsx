import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { Tag } from '../../shared/types';
import { Icon } from '../components/icons';
import { api } from '../lib/api';
import { buildTagTree, isSwatch, swatchFill, type TagNode, type TagTree } from '../lib/tags';
import { invalidate, useApi } from '../lib/useApi';
import { errMsg, useKeep } from './util';

// Tag chooser: suggested chips (pre-selected by the caller), the other chosen tags, and a browsable tree
// with search and an inline "新建标签" under a chosen parent. Controlled: `value` is every selected id,
// suggestions included; the caller works out which of them were only suggested.

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
  /** preset/own tag ids proposed for this photo; shown as toggleable chips marked 建议 */
  suggested?: string[];
  disabled?: boolean;
}

function flatten(nodes: TagNode[], out: TagNode[] = []): TagNode[] {
  for (const n of nodes) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

function Chip({ tag, tree, pressed, suggested, disabled, onToggle }: { tag: Tag; tree: TagTree; pressed: boolean; suggested?: boolean; disabled?: boolean; onToggle: () => void }) {
  const path = tree.path(tag.id).join(' / ');
  return (
    <button
      type="button"
      className="chip chip-outline tp-chip"
      aria-pressed={pressed}
      data-suggested={suggested || undefined}
      title={path}
      aria-label={`${path}${suggested ? '（建议）' : ''}`}
      disabled={disabled}
      onClick={onToggle}
    >
      {isSwatch(tag) && <span className="tp-dot" style={{ background: swatchFill(tag.color) }} aria-hidden="true" />}
      <span>{tag.name}</span>
      {suggested && <span className="tp-sug" aria-hidden="true">建议</span>}
      {!suggested && pressed && <Icon name="close" size={13} />}
    </button>
  );
}

export default function TagPicker({ value, onChange, suggested = [], disabled }: Props) {
  const id = useId();
  const { data, error, reload } = useApi<{ tags: Tag[] }>('/api/tags');
  const kept = useKeep(data);
  const [extra, setExtra] = useState<Tag[]>([]);
  const [panel, setPanel] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const tags = useMemo(() => {
    const base = kept?.tags ?? [];
    const have = new Set(base.map((t) => t.id));
    return [...base, ...extra.filter((t) => !have.has(t.id))];
  }, [kept, extra]);
  const tree = useMemo(() => buildTagTree(tags), [tags]);
  const all = useMemo(() => flatten(tree.roots), [tree]);

  const selected = useMemo(() => new Set(value), [value]);
  const suggestedTags = suggested.map((s) => tree.byId.get(s)).filter((t): t is TagNode => !!t);
  const suggestedSet = new Set(suggested);
  const chosen = value.filter((v) => !suggestedSet.has(v)).map((v) => tree.byId.get(v)).filter((t): t is TagNode => !!t);

  const toggle = (tagId: string) => {
    if (disabled) return;
    onChange(selected.has(tagId) ? value.filter((v) => v !== tagId) : [...value, tagId]);
  };

  const openPanel = () => {
    if (!panel) {
      const next = new Set(open);
      for (const v of value) for (const a of tree.ancestors(v)) next.add(a);
      setOpen(next);
    }
    setPanel(!panel);
  };

  const query = q.trim().toLowerCase();
  const matches = query ? all.filter((n) => n.name.toLowerCase().includes(query)) : [];

  const startCreate = (parentId: string, name = '') => {
    setPanel(true);
    setCreating(true);
    setParent(parentId);
    setNewName(name);
    setProblem(null);
  };

  async function create(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (name.length > 24) {
      setProblem('名称最多 24 个字符');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const res = await api<{ tag: Tag }>('/api/tags', { json: { name, parentId: parent || null } });
      setExtra((prev) => [...prev, res.tag]);
      invalidate('/api/tags');
      if (parent) setOpen((o) => new Set(o).add(parent));
      if (!selected.has(res.tag.id)) onChange([...value, res.tag.id]);
      setNewName('');
      setCreating(false);
      setQ('');
    } catch (err) {
      setProblem(errMsg(err, '新建标签失败'));
    } finally {
      setBusy(false);
    }
  }

  // A plain function, not a component: a component declared here would remount the whole tree on every render.
  const renderBranch = (nodes: TagNode[], depth: number): ReactNode => {
    return (
      <ul className="tp-tree" data-depth={depth}>
        {nodes.map((n) => {
          const isOpen = open.has(n.id);
          const on = selected.has(n.id);
          const path = tree.path(n.id).join(' / ');
          return (
            <li key={n.id}>
              <div className="tp-node" data-selected={on}>
                {n.children.length ? (
                  <button
                    type="button"
                    className="tp-fold"
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? '收起' : '展开'}「${n.name}」`}
                    onClick={() =>
                      setOpen((o) => {
                        const next = new Set(o);
                        if (next.has(n.id)) next.delete(n.id);
                        else next.add(n.id);
                        return next;
                      })
                    }
                  >
                    <Icon name="right" size={16} />
                  </button>
                ) : (
                  <span className="tp-fold tp-fold-pad" aria-hidden="true" />
                )}
                <button
                  type="button"
                  className="tp-pick"
                  aria-pressed={on}
                  title={path}
                  disabled={disabled}
                  onClick={() => {
                    setAnchor(n.id);
                    toggle(n.id);
                  }}
                >
                  {isSwatch(n) && <span className="tp-dot" style={{ background: swatchFill(n.color) }} aria-hidden="true" />}
                  <span className="tp-pick-name">{n.name}</span>
                  {on && <Icon name="check" size={15} />}
                </button>
                <button type="button" className="tp-add" aria-label={`在「${n.name}」下新建标签`} title="新建子标签" disabled={disabled} onClick={() => startCreate(n.id)}>
                  <Icon name="plus" size={15} />
                </button>
              </div>
              {isOpen && n.children.length > 0 && renderBranch(n.children, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  const loading = !kept && !error;

  return (
    <div className="tp">
      {suggestedTags.length > 0 && (
        <div className="tp-group" role="group" aria-label="建议标签">
          <span className="tp-label">建议</span>
          <div className="tp-chips">
            {suggestedTags.map((t) => (
              <Chip key={t.id} tag={t} tree={tree} suggested pressed={selected.has(t.id)} disabled={disabled} onToggle={() => toggle(t.id)} />
            ))}
          </div>
        </div>
      )}

      <div className="tp-group" role="group" aria-label="已选标签">
        <span className="tp-label">已选</span>
        <div className="tp-chips">
          {chosen.map((t) => (
            <Chip key={t.id} tag={t} tree={tree} pressed disabled={disabled} onToggle={() => toggle(t.id)} />
          ))}
          {chosen.length === 0 && <span className="small muted tp-none">{suggestedTags.length ? '还没有手动添加的标签' : '还没有标签'}</span>}
          <button type="button" className="btn btn-quiet tp-open" aria-expanded={panel} aria-controls={`${id}-panel`} onClick={openPanel} disabled={disabled}>
            <Icon name={panel ? 'close' : 'plus'} size={16} />
            {panel ? '收起' : '添加标签'}
          </button>
        </div>
      </div>

      {panel && (
        <div className="tp-panel" id={`${id}-panel`}>
          {loading && <p className="small muted">标签加载中…</p>}
          {error != null && !kept && (
            <p className="error-text" role="alert">
              标签加载失败。<button type="button" className="btn btn-quiet" onClick={reload}>重试</button>
            </p>
          )}
          {kept && (
            <>
              <div className="field">
                <label className="label" htmlFor={`${id}-q`}>搜索标签</label>
                <input id={`${id}-q`} className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入标签名" autoComplete="off" />
              </div>

              <div className="tp-scroll">
                {query ? (
                  matches.length ? (
                    <ul className="tp-tree" data-depth="0">
                      {matches.map((n) => {
                        const on = selected.has(n.id);
                        const trail = tree.ancestors(n.id).map((a) => tree.byId.get(a)?.name ?? a).join(' / ');
                        return (
                          <li key={n.id}>
                            <div className="tp-node" data-selected={on}>
                              <button type="button" className="tp-pick" aria-pressed={on} disabled={disabled} onClick={() => { setAnchor(n.id); toggle(n.id); }}>
                                {isSwatch(n) && <span className="tp-dot" style={{ background: swatchFill(n.color) }} aria-hidden="true" />}
                                <span className="tp-pick-name">{n.name}</span>
                                {trail && <span className="small muted tp-trail">{trail}</span>}
                                {on && <Icon name="check" size={15} />}
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="tp-empty">
                      <p className="small muted">没有叫「{q.trim()}」的标签。</p>
                      <button type="button" className="btn btn-quiet" onClick={() => startCreate(anchor, q.trim())} disabled={disabled}>
                        新建「{q.trim()}」
                      </button>
                    </div>
                  )
                ) : (
                  renderBranch(tree.roots, 0)
                )}
              </div>

              {!creating ? (
                <button type="button" className="btn btn-quiet tp-new" onClick={() => startCreate(anchor)} disabled={disabled}>
                  <Icon name="plus" size={16} />
                  新建标签
                </button>
              ) : (
                <form className="tp-create" onSubmit={create}>
                  <div className="field">
                    <label className="label" htmlFor={`${id}-parent`}>上级</label>
                    <select id={`${id}-parent`} className="input select" value={parent} onChange={(e) => setParent(e.target.value)} disabled={busy}>
                      <option value="">无（作为根标签）</option>
                      {all.map((n) => (
                        <option key={n.id} value={n.id}>
                          {'　'.repeat(n.depth)}
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label" htmlFor={`${id}-name`}>名称</label>
                    <input id={`${id}-name`} className="input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={24} placeholder="如 西湖" disabled={busy} required autoFocus />
                  </div>
                  {problem && <p className="error-text" role="alert">{problem}</p>}
                  <div className="row">
                    <button type="submit" className="btn btn-primary" disabled={busy || !newName.trim()}>{busy ? '添加中…' : '添加并选中'}</button>
                    <button type="button" className="btn btn-quiet" onClick={() => { setCreating(false); setProblem(null); }} disabled={busy}>取消</button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
