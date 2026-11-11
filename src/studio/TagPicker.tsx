import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'wouter';
import { TAG_LIMITS } from '../../shared/limits';
import type { Tag } from '../../shared/types';
import { Icon } from '../components/icons';
import { api } from '../lib/api';
import { buildTagTree, isSwatch, swatchFill, type TagNode } from '../lib/tags';
import { invalidate, useApi } from '../lib/useApi';
import { boardChoices, boardRows, firstChoice, searchBoard, type BoardItem, type BoardRow, type TagEdit } from './tag-board';
import { errMsg, useKeep } from './util';

// Tag board for the upload form, the upload batch panel and the photo editor. The search box holds the chosen tags as
// tokens; typing narrows the board, ↑ ↓ move through the matches, Enter adds the highlighted one (or offers to create
// the tag), Backspace in an empty box takes off the last token. Below it every tag is in view as a two-column table:
// a label (the group 自然 or 天气, or the root 季节 for tags right under it) and that line's tags, each a toggle. A
// season, a light and a tone exclude the others of their kind (tag-board.ts). Editing several photos at once, a tag
// only some of them have is drawn half-on; clicking it gives it to all. Docs: /docs/product/features/hierarchical-tags.md#打标签

interface Props {
  /** tags the photo has; editing several, tags every one of them has */
  value: readonly string[];
  /** editing several photos: tags only some of them have */
  mixed?: readonly string[];
  onEdit: (e: TagEdit) => void;
  disabled?: boolean;
}

/** A group label deeper in a line and the tag after it go together, so a line never ends on a label. */
function runs(items: readonly BoardItem[]): BoardItem[][] {
  const out: BoardItem[][] = [];
  for (let i = 0; i < items.length; i++) {
    const next = items[i + 1];
    if (items[i].group && next && !next.group) out.push([items[i], items[++i]]);
    else out.push([items[i]]);
  }
  return out;
}

interface Line {
  /** the group that heads the line (自然, 天气); null for tags that sit directly under the root */
  head: BoardItem | null;
  items: BoardItem[];
}

/**
 * A root's tags as the board's lines: each group right under the root heads a line of its own tags; tags that sit
 * directly under the root share a line headed by the root itself. A root of one's own always gets that line, since
 * it is a tag that can be chosen.
 */
function lines(row: BoardRow): Line[] {
  const out: Line[] = [];
  for (const it of row.items) {
    const last = out[out.length - 1];
    if (it.level === 1 && it.group) out.push({ head: it, items: [] });
    else if (last && (it.level > 1 || !last.head)) last.items.push(it);
    else out.push({ head: null, items: [it] });
  }
  if (row.root.ownerId && !out.some((l) => !l.head)) out.unshift({ head: null, items: [] });
  return out;
}

export default function TagPicker({ value, mixed = [], onEdit, disabled }: Props) {
  const id = useId();
  const { data, error, reload } = useApi<{ tags: Tag[] }>('/api/tags');
  const kept = useKeep(data);
  const [extra, setExtra] = useState<Tag[]>([]);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<{ name: string; parent: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLSelectElement>(null);
  /** the create form was opened from the keyboard: put the caret on "放在" */
  const fromKeys = useRef(false);
  const open = creating !== null;
  useEffect(() => {
    if (open && fromKeys.current) parentRef.current?.focus();
    fromKeys.current = false;
  }, [open]);

  const tags = useMemo(() => {
    const base = kept?.tags ?? [];
    const have = new Set(base.map((t) => t.id));
    return [...base, ...extra.filter((t) => !have.has(t.id))];
  }, [kept, extra]);
  const tree = useMemo(() => buildTagTree(tags), [tags]);
  const rows = useMemo(() => boardRows(tree), [tree]);
  const shown = useMemo(() => searchBoard(rows, q), [rows, q]);
  const term = q.trim();
  const choices = useMemo(() => (term ? boardChoices(shown.rows) : []), [shown, term]);
  const on = new Set(value);
  const half = new Set(mixed.filter((t) => !on.has(t)));
  const activeId = choices[Math.min(active, choices.length - 1)]?.id ?? null;

  const toggle = (tagId: string) => {
    if (!disabled) onEdit({ op: on.has(tagId) ? 'remove' : 'add', id: tagId });
  };

  const search = (next: string) => {
    setQ(next);
    setCreating(null);
    const t = next.trim();
    setActive(t ? firstChoice(boardChoices(searchBoard(rows, t).rows), t) : 0);
  };

  const offerCreate = (keys = false) => {
    fromKeys.current = keys;
    setProblem(null);
    setCreating({ name: term, parent: '' });
  };

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return; // an IME is still turning keystrokes into characters
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!choices.length) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (Math.min(a, choices.length - 1) + step + choices.length) % choices.length);
    } else if (e.key === 'Enter') {
      if (!term) return;
      e.preventDefault();
      if (activeId) {
        if (!on.has(activeId)) onEdit({ op: 'add', id: activeId });
        search('');
      } else offerCreate(true);
    } else if (e.key === 'Backspace' && !q) {
      const last = value.length ? value[value.length - 1] : mixed[mixed.length - 1];
      if (last) onEdit({ op: 'remove', id: last });
    } else if (e.key === 'Escape' && q) {
      e.preventDefault();
      search('');
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!creating) return;
    const name = creating.name.trim();
    if (!name) return;
    if ([...name].length > TAG_LIMITS.nameMax) {
      setProblem(`名称最多 ${TAG_LIMITS.nameMax} 个字符`);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const res = await api<{ tag: Tag }>('/api/tags', { json: { name, parentId: creating.parent || null } });
      setExtra((prev) => [...prev, res.tag]);
      invalidate('/api/tags');
      onEdit({ op: 'add', id: res.tag.id });
      setCreating(null);
      search('');
      input.current?.focus();
    } catch (err) {
      setProblem(errMsg(err, '新建标签失败'));
    } finally {
      setBusy(false);
    }
  }

  const name = (tagId: string) => tree.byId.get(tagId)?.name ?? extra.find((t) => t.id === tagId)?.name;
  const tokens = [...value, ...half].filter((t) => name(t) !== undefined);

  const chip = (n: TagNode, group = false) => (
    <button
      key={n.id}
      type="button"
      className={group ? 'tp-grp' : 'tp-chip'}
      aria-pressed={on.has(n.id) ? true : half.has(n.id) ? 'mixed' : false}
      data-active={n.id === activeId || undefined}
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
        {/* the chosen tags sit in the search box, so what a photo has is always in one place */}
        <label className="tp-search" htmlFor={`${id}-q`}>
          <Icon name="search" size={15} />
          {tokens.map((t) => (
            <span key={t} className="tp-token" data-mixed={half.has(t) || undefined} title={tree.path(t).join(' / ')}>
              {name(t)}
              <button
                type="button"
                className="tp-token-x"
                aria-label={`去掉 ${name(t)}`}
                disabled={disabled}
                onClick={() => onEdit({ op: 'remove', id: t })}
              >
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
          <input
            ref={input}
            id={`${id}-q`}
            aria-label="搜索标签"
            className="tp-q"
            type="search"
            value={q}
            onChange={(e) => search(e.target.value)}
            onKeyDown={onKey}
            placeholder={tokens.length ? '' : '搜索或新建标签'}
            autoComplete="off"
            enterKeyHint="done"
            maxLength={TAG_LIMITS.nameMax}
            disabled={disabled}
            aria-describedby={term ? `${id}-hint` : undefined}
          />
        </label>
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
              {lines(row).map((line, i) => (
                <div key={line.head?.node.id ?? `under-${i}`} className="tp-line">
                  {/* the line's label: its group, which can be chosen too; else the root. A preset root (季节, 色调)
                      only names the line, a root of one's own is a tag like any other */}
                  {line.head ? (
                    chip(line.head.node, true)
                  ) : row.root.ownerId ? (
                    chip(row.root, true)
                  ) : (
                    <span className="tp-root">{row.root.name}</span>
                  )}
                  <span className="tp-chips">
                    {runs(line.items).map((run) =>
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
            </div>
          ))}
          {term && !shown.exact && !creating && (
            <button type="button" className="tp-new" disabled={disabled} onClick={() => offerCreate()}>
              <Icon name="plus" size={14} />
              新建「{term}」
            </button>
          )}
          {term && (
            <p id={`${id}-hint`} className="visually-hidden">
              {activeId ? `回车添加「${name(activeId)}」` : `回车新建「${term}」`}
            </p>
          )}
        </div>
      )}

      {creating && (
        <form className="tp-create" onSubmit={create}>
          <label className="small muted" htmlFor={`${id}-parent`}>
            放在
          </label>
          <select
            ref={parentRef}
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
            maxLength={TAG_LIMITS.nameMax}
            disabled={busy}
            required
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !creating.name.trim()}>
            {busy ? '添加中…' : '添加'}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setCreating(null);
              input.current?.focus();
            }}
            disabled={busy}
          >
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
