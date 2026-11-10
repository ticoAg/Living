import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { PhotoSummary, Tag } from '../../shared/types';
import { Icon, type IconName } from '../components/icons';
import { api } from '../lib/api';
import { buildTagTree, inclusiveCounts, isSwatch, swatchFill, type TagNode, type TagTree } from '../lib/tags';
import { invalidate, useApi } from '../lib/useApi';
import { ConfirmBar, PageHead, Toggle } from '../studio/ui';
import { errMsg, useKeep, useRequireLogin, useTitle } from '../studio/util';
import '../styles/studio.css';

// /studio/tags — the tag tree: add, rename, move, reorder, colour, delete.
// Presets (no owner) are editable only by the owner and admins; everyone can add children under them.
// Docs: /docs/product/features/hierarchical-tags.md

const SWATCHES: { color: string; label: string }[] = [
  { color: '#C9925E', label: '暖橙' },
  { color: '#8FA3B2', label: '冷灰蓝' },
  { color: '#7D9A6B', label: '绿' },
  { color: '#4A7BA6', label: '蓝' },
  { color: 'mono', label: '黑白' }
];

function IconBtn({
  label,
  text,
  icon,
  onClick,
  disabled,
  danger,
  pressed,
  flip
}: {
  label: string;
  /** short name shown beside the icon in the phone's action menu; part of `label`, so speech matches what is seen */
  text: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  pressed?: boolean;
  flip?: boolean;
}) {
  return (
    <button
      type="button"
      className="tm-icon"
      data-danger={danger || undefined}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={17} style={flip ? { transform: 'rotate(180deg)' } : undefined} />
      <span className="tm-icon-text" aria-hidden="true">
        {text}
      </span>
    </button>
  );
}

function RenameForm({
  tag,
  busy,
  onSubmit,
  onCancel
}: {
  tag: TagNode;
  busy: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(tag.name);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  };
  return (
    <form
      className="tm-rename"
      onKeyDown={onKey}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
    >
      <label className="visually-hidden" htmlFor={`rn-${tag.id}`}>
        标签名称
      </label>
      <input
        id={`rn-${tag.id}`}
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={24}
        autoFocus
        required
      />
      <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
        保存
      </button>
      <button type="button" className="btn btn-quiet" onClick={onCancel}>
        取消
      </button>
    </form>
  );
}

function AddForm({
  tag,
  busy,
  onSubmit,
  onCancel
}: {
  tag: TagNode;
  busy: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  return (
    <form
      className="tm-panel"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim());
      }}
    >
      <label className="label" htmlFor={`add-${tag.id}`}>
        在「{tag.name}」下新建标签
      </label>
      <div className="tm-inline">
        <input
          id={`add-${tag.id}`}
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          placeholder="标签名称"
          autoFocus
          required
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          添加
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

/** Move under another tag, and switch the colour swatch on or off. */
function MorePanel({
  tag,
  tree,
  editable,
  busy,
  onMove,
  onColor,
  onClose
}: {
  tag: TagNode;
  tree: TagTree;
  editable: boolean;
  busy: boolean;
  onMove: (parentId: string | null) => void;
  onColor: (color: string | null) => void;
  onClose: () => void;
}) {
  const [parent, setParent] = useState(tag.parentId ?? '');
  // Not itself or anything below it. Presets can only live under presets; user tags under presets or their own.
  const targets = useMemo(() => {
    const banned = new Set([tag.id, ...tree.descendants(tag.id)]);
    const out: TagNode[] = [];
    const walk = (nodes: TagNode[]) => {
      for (const t of nodes) {
        if (banned.has(t.id) || (tag.ownerId === null && t.ownerId !== null)) continue;
        out.push(t);
        walk(t.children);
      }
    };
    walk(tree.roots);
    return out;
  }, [tag.id, tag.ownerId, tree]);
  const colored = isSwatch(tag);

  return (
    <div className="tm-panel">
      <div className="field">
        <label className="label" htmlFor={`mv-${tag.id}`}>
          移动到
        </label>
        <div className="tm-inline">
          <select
            id={`mv-${tag.id}`}
            className="input select"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            disabled={!editable || busy}
          >
            <option value="">（根）</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {'　'.repeat(t.depth)}
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={!editable || busy || parent === (tag.parentId ?? '')}
            onClick={() => onMove(parent || null)}
          >
            移动
          </button>
        </div>
      </div>

      <div className="field">
        <Toggle
          label="显示为色块"
          hint="带颜色的标签在图库里显示成色块"
          checked={colored}
          disabled={!editable || busy}
          onChange={(on) => onColor(on ? SWATCHES[0].color : null)}
        />
        {colored && (
          <div className="tm-colors" role="group" aria-label="色块颜色">
            {SWATCHES.map((s) => (
              <button
                key={s.color}
                type="button"
                className="swatch"
                aria-label={s.label}
                title={s.label}
                aria-pressed={tag.color === s.color}
                disabled={!editable || busy}
                onClick={() => onColor(s.color)}
              >
                <span style={{ background: swatchFill(s.color) }} />
              </button>
            ))}
            <label className="tm-pick-color">
              <span className="small muted">自定义</span>
              <input
                type="color"
                aria-label="自定义颜色"
                value={tag.color && tag.color.startsWith('#') ? tag.color.toLowerCase() : '#888888'}
                disabled={!editable || busy}
                onChange={(e) => onColor(e.target.value.toUpperCase())}
              />
            </label>
          </div>
        )}
      </div>
      <div>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          收起
        </button>
      </div>
    </div>
  );
}

type Panel = { id: string; kind: 'add' | 'more' | 'delete' };

export default function TagsManager() {
  useTitle('标签');
  const { user, ready } = useRequireLogin();
  const tagsReq = useApi<{ tags: Tag[] }>(ready ? '/api/tags' : null);
  const photosReq = useApi<{ photos: PhotoSummary[] }>(ready ? '/api/photos?mine=1' : null);
  const tagData = useKeep(tagsReq.data);
  const photoData = useKeep(photosReq.data);

  const tree = useMemo(() => buildTagTree(tagData?.tags ?? []), [tagData]);
  const counts = useMemo(() => inclusiveCounts(photoData?.photos ?? [], tree), [photoData, tree]);
  const staff = user?.role === 'owner' || user?.role === 'admin';
  const canEdit = (t: Tag) => t.ownerId === user?.id || (t.ownerId === null && staff);
  const countOf = (n: TagNode) => counts.get(n.id) ?? 0;

  const [open, setOpen] = useState<Set<string>>(new Set());
  const seeded = useRef(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // phones: the row whose actions are unfolded behind its "more" button (wider screens always show them)
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [rootName, setRootName] = useState('');

  // Open every branch for a small tree, only the roots for a big one.
  useEffect(() => {
    if (seeded.current || !tagData) return;
    seeded.current = true;
    const all = tagData.tags;
    setOpen(all.length <= 60 ? new Set(all.map((t) => t.parentId).filter((p): p is string => !!p)) : new Set());
  }, [tagData]);

  const toggleOpen = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expand = (id: string) => setOpen((o) => new Set(o).add(id));
  const expandAll = () =>
    setOpen(
      new Set(
        Array.from(tree.byId.values())
          .filter((n) => n.children.length)
          .map((n) => n.id)
      )
    );

  async function run(id: string, job: () => Promise<unknown>, success?: string, alsoPhotos = false): Promise<boolean> {
    setBusy(id);
    setProblem(null);
    setDone(null);
    try {
      await job();
      invalidate('/api/tags');
      if (alsoPhotos) invalidate('/api/photos');
      if (success) setDone(success);
      return true;
    } catch (e) {
      setProblem(errMsg(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const patchTag = (id: string, body: Record<string, unknown>) => api<{ tag: Tag }>(`/api/tags/${id}`, { method: 'PATCH', json: body });

  async function addTag(parentId: string | null, name: string): Promise<boolean> {
    const ok = await run(parentId ?? '__root', () => api<{ tag: Tag }>('/api/tags', { json: { name, parentId } }), `已添加「${name}」`);
    if (ok && parentId) expand(parentId);
    return ok;
  }

  /** Open (or with null close) a tag's panel; the phone's action menu folds away, the panel takes its place. */
  const openPanel = (id: string, kind: Panel['kind'] | null) => {
    setMenu(null);
    setPanel(kind ? { id, kind } : null);
  };

  const siblingsOf = (n: TagNode): TagNode[] => (n.parentId ? tree.byId.get(n.parentId)?.children : undefined) ?? tree.roots;

  /** Swap places with the neighbour by trading `sort` values; hop over a preset the user may not touch. */
  async function reorder(n: TagNode, dir: -1 | 1) {
    const sibs = siblingsOf(n);
    const i = sibs.findIndex((s) => s.id === n.id);
    const nb = sibs[i + dir];
    if (!nb) return;
    await run(n.id, async () => {
      if (!canEdit(nb)) {
        await patchTag(n.id, { sort: nb.sort + dir });
      } else if (nb.sort !== n.sort) {
        await Promise.all([patchTag(n.id, { sort: nb.sort }), patchTag(nb.id, { sort: n.sort })]);
      } else {
        // equal sort values cannot be swapped: renumber the siblings in their new order
        const order = [...sibs];
        [order[i], order[i + dir]] = [order[i + dir], order[i]];
        await Promise.all(
          order
            .map((s, k) => ({ s, sort: (k + 1) * 10 }))
            .filter(({ s, sort }) => canEdit(s) && s.sort !== sort)
            .map(({ s, sort }) => patchTag(s.id, { sort }))
        );
      }
    });
  }

  function renderNodes(nodes: TagNode[]): ReactNode {
    return (
      <ul className="tm-list">
        {nodes.map((n) => {
          const isOpen = open.has(n.id);
          const mine = canEdit(n);
          const sibs = siblingsOf(n);
          const at = sibs.findIndex((s) => s.id === n.id);
          const here = panel?.id === n.id ? panel.kind : null;
          const working = busy === n.id;
          return (
            <li key={n.id} className="tm-item">
              <div
                className="tm-row"
                data-preset={n.ownerId === null || undefined}
                data-busy={working || undefined}
                data-menu={menu === n.id || undefined}
              >
                {n.children.length ? (
                  <button
                    type="button"
                    className="tm-fold"
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? '收起' : '展开'}「${n.name}」`}
                    onClick={() => toggleOpen(n.id)}
                  >
                    <Icon name="right" size={16} />
                  </button>
                ) : (
                  <span className="tm-fold" aria-hidden="true" />
                )}

                {renaming === n.id ? (
                  <RenameForm
                    tag={n}
                    busy={working}
                    onCancel={() => setRenaming(null)}
                    onSubmit={async (name) => {
                      if (name === n.name || (await run(n.id, () => patchTag(n.id, { name }), `已改名为「${name}」`))) setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="tm-name">
                    {isSwatch(n) && <span className="tm-dot" style={{ background: swatchFill(n.color) }} aria-hidden="true" />}
                    <span className="tm-label serif">{n.name}</span>
                    {n.ownerId === null && (
                      <span className="tm-badge" title={mine ? '预置标签，你有权修改' : '预置标签，只读；可以在它下面添加你自己的标签'}>
                        预置
                      </span>
                    )}
                  </span>
                )}

                <span className="tm-count mono" aria-label={`${countOf(n)} 张照片`} title="含子标签的照片数">
                  {countOf(n)}
                </span>

                <button
                  type="button"
                  className="tm-icon tm-more"
                  aria-label={`「${n.name}」的更多操作`}
                  aria-expanded={menu === n.id}
                  aria-controls={`tm-act-${n.id}`}
                  onClick={() => setMenu(menu === n.id ? null : n.id)}
                >
                  <Icon name="more" size={18} />
                </button>

                <span className="tm-actions" id={`tm-act-${n.id}`}>
                  {mine && (
                    <IconBtn
                      label={`「${n.name}」上移`}
                      text="上移"
                      icon="down"
                      flip
                      onClick={() => void reorder(n, -1)}
                      disabled={at <= 0 || !!busy}
                    />
                  )}
                  {mine && (
                    <IconBtn
                      label={`「${n.name}」下移`}
                      text="下移"
                      icon="down"
                      onClick={() => void reorder(n, 1)}
                      disabled={at < 0 || at >= sibs.length - 1 || !!busy}
                    />
                  )}
                  <IconBtn
                    label={`在「${n.name}」下添加子标签`}
                    text="添加"
                    icon="plus"
                    onClick={() => openPanel(n.id, here === 'add' ? null : 'add')}
                    pressed={here === 'add'}
                  />
                  {mine && (
                    <IconBtn
                      label={`给「${n.name}」改名`}
                      text="改名"
                      icon="edit"
                      onClick={() => {
                        setMenu(null);
                        setRenaming(renaming === n.id ? null : n.id);
                      }}
                      pressed={renaming === n.id}
                      disabled={!!busy}
                    />
                  )}
                  {mine && (
                    <IconBtn
                      label={`设置「${n.name}」：移动或颜色`}
                      text="设置"
                      icon="sliders"
                      onClick={() => openPanel(n.id, here === 'more' ? null : 'more')}
                      pressed={here === 'more'}
                    />
                  )}
                  {mine && (
                    <IconBtn
                      label={`删除「${n.name}」`}
                      text="删除"
                      icon="trash"
                      danger
                      onClick={() => openPanel(n.id, here === 'delete' ? null : 'delete')}
                      pressed={here === 'delete'}
                    />
                  )}
                </span>
              </div>

              {here === 'add' && (
                <AddForm
                  tag={n}
                  busy={working}
                  onCancel={() => setPanel(null)}
                  onSubmit={async (name) => {
                    if (await addTag(n.id, name)) setPanel(null);
                  }}
                />
              )}
              {here === 'more' && (
                <MorePanel
                  tag={n}
                  tree={tree}
                  editable={mine}
                  busy={working}
                  onClose={() => setPanel(null)}
                  onColor={(color) => void run(n.id, () => patchTag(n.id, { color }))}
                  onMove={async (parentId) => {
                    if (await run(n.id, () => patchTag(n.id, { parentId }), '已移动')) {
                      if (parentId) expand(parentId);
                      setPanel(null);
                    }
                  }}
                />
              )}
              {here === 'delete' && (
                <ConfirmBar
                  prompt={
                    <>
                      删除「{n.name}」会同时删除它下面的 <strong className="mono">{tree.descendants(n.id).length}</strong> 个子标签（共{' '}
                      <strong className="mono">{tree.descendants(n.id).length + 1}</strong> 个标签），并从你的{' '}
                      <strong className="mono">{countOf(n)}</strong> 张照片上取下它们。照片本身不受影响。
                      {n.ownerId === null && ' 这是预置标签，其他用户的照片也会受影响。'}
                    </>
                  }
                  confirmLabel={`删除 ${tree.descendants(n.id).length + 1} 个标签`}
                  busy={working}
                  onCancel={() => setPanel(null)}
                  onConfirm={async () => {
                    if (await run(n.id, () => api(`/api/tags/${n.id}`, { method: 'DELETE' }), `已删除「${n.name}」`, true)) setPanel(null);
                  }}
                />
              )}
              {isOpen && n.children.length > 0 && renderNodes(n.children)}
            </li>
          );
        })}
      </ul>
    );
  }

  if (!ready) return <p className="loading">加载中</p>;

  const own = Array.from(tree.byId.values()).filter((t) => t.ownerId === user?.id).length;

  return (
    <main className="page-narrow tm">
      <PageHead
        title="标签"
        caption={
          staff
            ? '你可以修改预置标签，也可以添加自己的。选中父标签会包含它所有的子孙。'
            : '预置标签只读，但你可以在任何一个下面添加自己的标签，也可以新建自己的根。选中父标签会包含它所有的子孙。'
        }
      >
        <button type="button" className="btn btn-quiet" onClick={expandAll} disabled={!tagData}>
          全部展开
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(new Set())} disabled={!tagData}>
          全部收起
        </button>
      </PageHead>

      <form
        className="tm-root"
        onSubmit={async (e) => {
          e.preventDefault();
          if (rootName.trim() && (await addTag(null, rootName.trim()))) setRootName('');
        }}
      >
        <label className="label" htmlFor="tm-root-name">
          新建根标签
        </label>
        <div className="tm-inline">
          <input
            id="tm-root-name"
            className="input"
            value={rootName}
            onChange={(e) => setRootName(e.target.value)}
            maxLength={24}
            placeholder="如 人物、家人、项目"
          />
          <button type="submit" className="btn btn-primary" disabled={!rootName.trim() || busy === '__root'}>
            添加根标签
          </button>
        </div>
      </form>

      <div className="tm-status" role="status" aria-live="polite">
        {problem && (
          <p className="error-text" role="alert">
            {problem}
          </p>
        )}
        {!problem && done && <p className="sf-ok">{done}</p>}
      </div>

      {!tagData && !tagsReq.error && <p className="loading">加载中</p>}
      {!tagData && tagsReq.error != null && (
        <div className="notice stack">
          <p className="error-text" style={{ margin: 0 }}>
            {errMsg(tagsReq.error, '标签加载失败')}
          </p>
          <div>
            <button type="button" className="btn" onClick={tagsReq.reload}>
              重试
            </button>
          </div>
        </div>
      )}
      {tagData && (
        <>
          <p className="small muted tm-summary">
            共 <span className="mono">{tagData.tags.length}</span> 个标签，其中你的 <span className="mono">{own}</span>{' '}
            个。右侧数字是带这个标签或其子孙标签的照片数。
          </p>
          <div className="tm-tree">{renderNodes(tree.roots)}</div>
        </>
      )}
    </main>
  );
}
