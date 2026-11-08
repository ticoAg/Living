import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { PhotoSummary, Tag } from '../../shared/types';
import { Icon, type IconName } from '../components/icons';
import { api } from '../lib/api';
import { buildTagTree, inclusiveCounts, isSwatch, swatchFill, type TagNode } from '../lib/tags';
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

function IconBtn({ label, icon, onClick, disabled, danger, pressed }: { label: string; icon: IconName; onClick: () => void; disabled?: boolean; danger?: boolean; pressed?: boolean }) {
  return (
    <button type="button" className="tm-icon" data-danger={danger || undefined} aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={17} />
    </button>
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

  const [open, setOpen] = useState<Set<string>>(new Set());
  const seeded = useRef(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [rootName, setRootName] = useState('');

  // Open every branch for a small tree, only the roots for a big one.
  useEffect(() => {
    if (seeded.current || !tagData) return;
    seeded.current = true;
    const all = tagData.tags;
    const parents = new Set(all.map((t) => t.parentId).filter((p): p is string => !!p));
    setOpen(all.length <= 60 ? parents : new Set());
  }, [tagData]);

  const toggleOpen = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const expandAll = () => setOpen(new Set(Array.from(tree.byId.values()).filter((n) => n.children.length).map((n) => n.id)));

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
    const ok = await run(parentId ?? '__root', () => api<{ tag: Tag }>('/api/tags', { json: { name: name.trim(), parentId } }), `已添加「${name.trim()}」`);
    if (ok && parentId) setOpen((o) => new Set(o).add(parentId));
    return ok;
  }

  async function submitRoot(e: FormEvent) {
    e.preventDefault();
    if (!rootName.trim()) return;
    if (await addTag(null, rootName)) setRootName('');
  }

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
        const order = [...sibs];
        [order[i], order[i + dir]] = [order[i + dir], order[i]];
        await Promise.all(order.map((s, k) => ({ s, sort: (k + 1) * 10 })).filter(({ s, sort }) => canEdit(s) && s.sort !== sort).map(({ s, sort }) => patchTag(s.id, { sort })));
      }
    });
  }

  function reorderState(n: TagNode): { up: boolean; down: boolean } {
    if (!canEdit(n)) return { up: false, down: false };
    const sibs = siblingsOf(n);
    const i = sibs.findIndex((s) => s.id === n.id);
    // Without rights over a neighbour the tag may still hop past it, so only the ends are blocked.
    return { up: i > 0, down: i >= 0 && i < sibs.length - 1 };
  }

  const countOf = (n: TagNode) => counts.get(n.id) ?? 0;

  function RenameForm({ n }: { n: TagNode }) {
    const [name, setName] = useState(n.name);
    const submit = async (e: FormEvent) => {
      e.preventDefault();
      const next = name.trim();
      if (!next) return;
      if (next === n.name) {
        setRenaming(null);
        return;
      }
      if (await run(n.id, () => patchTag(n.id, { name: next }), `已改名为「${next}」`)) setRenaming(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRenaming(null);
    };
    return (
      <form className="tm-rename" onSubmit={submit} onKeyDown={onKey}>
        <label className="visually-hidden" htmlFor={`rn-${n.id}`}>标签名称</label>
        <input id={`rn-${n.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoFocus required />
        <button type="submit" className="btn btn-primary" disabled={busy === n.id || !name.trim()}>保存</button>
        <button type="button" className="btn btn-quiet" onClick={() => setRenaming(null)}>取消</button>
      </form>
    );
  }

  function AddForm({ n }: { n: TagNode }) {
    const [name, setName] = useState('');
    return (
      <form
        className="tm-panel tm-add"
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim() && (await addTag(n.id, name))) setPanel(null);
        }}
      >
        <label className="label" htmlFor={`add-${n.id}`}>在「{n.name}」下新建标签</label>
        <div className="tm-inline">
          <input id={`add-${n.id}`} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="标签名称" autoFocus required />
          <button type="submit" className="btn btn-primary" disabled={busy === n.id || !name.trim()}>添加</button>
          <button type="button" className="btn btn-quiet" onClick={() => setPanel(null)}>取消</button>
        </div>
      </form>
    );
  }

  function MorePanel({ n }: { n: TagNode }) {
    const banned = useMemo(() => new Set([n.id, ...tree.descendants(n.id)]), [n.id]);
    // Presets can only live under presets; a user's tag can hang under presets or their own tags.
    const targets = useMemo(() => {
      const out: TagNode[] = [];
      const walk = (nodes: TagNode[]) => {
        for (const t of nodes) {
          if (banned.has(t.id)) continue;
          if (n.ownerId === null && t.ownerId !== null) continue;
          out.push(t);
          walk(t.children);
        }
      };
      walk(tree.roots);
      return out;
    }, [banned, n.ownerId]);
    const [parent, setParent] = useState(n.parentId ?? '');
    const editable = canEdit(n);
    const colored = isSwatch(n);
    const depthOf = (t: TagNode) => t.depth;

    return (
      <div className="tm-panel tm-more">
        <div className="field">
          <label className="label" htmlFor={`mv-${n.id}`}>移动到</label>
          <div className="tm-inline">
            <select id={`mv-${n.id}`} className="input select" value={parent} onChange={(e) => setParent(e.target.value)} disabled={!editable}>
              <option value="">（根）</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {'　'.repeat(depthOf(t))}
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={!editable || busy === n.id || parent === (n.parentId ?? '')}
              onClick={async () => {
                if (await run(n.id, () => patchTag(n.id, { parentId: parent || null }), '已移动')) {
                  if (parent) setOpen((o) => new Set(o).add(parent));
                  setPanel(null);
                }
              }}
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
            disabled={!editable || busy === n.id}
            onChange={(on) => void run(n.id, () => patchTag(n.id, { color: on ? SWATCHES[0].color : null }))}
          />
          {colored && (
            <div className="tm-colors" role="group" aria-label="色块颜色">
              {SWATCHES.map((s) => (
                <button key={s.color} type="button" className="swatch" aria-label={s.label} title={s.label} aria-pressed={n.color === s.color} disabled={!editable || busy === n.id} onClick={() => void run(n.id, () => patchTag(n.id, { color: s.color }))}>
                  <span style={{ background: swatchFill(s.color) }} />
                </button>
              ))}
              <label className="tm-pick-color">
                <span className="small muted">自定义</span>
                <input
                  type="color"
                  value={n.color && n.color.startsWith('#') ? n.color : '#888888'}
                  disabled={!editable || busy === n.id}
                  onChange={(e) => void run(n.id, () => patchTag(n.id, { color: e.target.value.toUpperCase() }))}
                  aria-label="自定义颜色"
                />
              </label>
            </div>
          )}
        </div>
        <div>
          <button type="button" className="btn btn-quiet" onClick={() => setPanel(null)}>收起</button>
        </div>
      </div>
    );
  }

  function DeletePanel({ n }: { n: TagNode }) {
    const below = tree.descendants(n.id).length;
    const photos = countOf(n);
    return (
      <ConfirmBar
        prompt={
          <>
            删除「{n.name}」会同时删除它下面的 <strong className="mono">{below}</strong> 个子标签（共 <strong className="mono">{below + 1}</strong> 个），并从你的 <strong className="mono">{photos}</strong> 张照片上取下这些标签。照片本身不受影响。
            {n.ownerId === null && ' 这是预置标签，其他用户的照片也会受影响。'}
          </>
        }
        confirmLabel={`删除 ${below + 1} 个标签`}
        busy={busy === n.id}
        onConfirm={async () => {
          const ok = await run(n.id, () => api<{ ok: true; deleted: number }>(`/api/tags/${n.id}`, { method: 'DELETE' }), `已删除「${n.name}」`, true);
          if (ok) setPanel(null);
        }}
        onCancel={() => setPanel(null)}
      />
    );
  }

  function renderNodes(nodes: TagNode[]): ReactNode {
    return (
      <ul className="tm-list">
        {nodes.map((n) => {
          const isOpen = open.has(n.id);
          const mine = canEdit(n);
          const move = reorderState(n);
          const here = panel?.id === n.id ? panel.kind : null;
          const loading = busy === n.id;
          return (
            <li key={n.id} className="tm-item">
              <div className="tm-row" data-preset={n.ownerId === null || undefined} data-busy={loading || undefined}>
                {n.children.length ? (
                  <button type="button" className="tm-fold" aria-expanded={isOpen} aria-label={`${isOpen ? '收起' : '展开'}「${n.name}」`} onClick={() => toggleOpen(n.id)}>
                    <Icon name="right" size={16} />
                  </button>
                ) : (
                  <span className="tm-fold" aria-hidden="true" />
                )}

                {renaming === n.id ? (
                  <RenameForm n={n} />
                ) : (
                  <span className="tm-name">
                    {isSwatch(n) && <span className="tm-dot" style={{ background: swatchFill(n.color) }} aria-hidden="true" />}
                    <span className="tm-label serif">{n.name}</span>
                    {n.ownerId === null && <span className="tm-badge" title={mine ? '预置标签，你有权修改' : '预置标签，只读；可以在它下面添加你自己的标签'}>预置</span>}
                  </span>
                )}

                <span className="tm-count mono" aria-label={`${countOf(n)} 张照片`} title="含子标签的照片数">
                  {countOf(n)}
                </span>

                <span className="tm-actions">
                  <IconBtn label={`「${n.name}」上移`} icon="down" onClick={() => void reorder(n, -1)} disabled={!move.up || !!busy} />
                  <IconBtn label={`「${n.name}」下移`} icon="down" onClick={() => void reorder(n, 1)} disabled={!move.down || !!busy} />
                  <IconBtn label={`在「${n.name}」下新建子标签`} icon="plus" onClick={() => setPanel(here === 'add' ? null : { id: n.id, kind: 'add' })} pressed={here === 'add'} />
                  {mine && <IconBtn label={`重命名「${n.name}」`} icon="edit" onClick={() => setRenaming(renaming === n.id ? null : n.id)} pressed={renaming === n.id} disabled={!!busy} />}
                  {mine && <IconBtn label={`移动或设置颜色：「${n.name}」`} icon="sliders" onClick={() => setPanel(here === 'more' ? null : { id: n.id, kind: 'more' })} pressed={here === 'more'} />}
                  {mine && <IconBtn label={`删除「${n.name}」`} icon="trash" danger onClick={() => setPanel(here === 'delete' ? null : { id: n.id, kind: 'delete' })} pressed={here === 'delete'} />}
                </span>
              </div>

              {here === 'add' && <AddForm n={n} />}
              {here === 'more' && <MorePanel n={n} />}
              {here === 'delete' && <DeletePanel n={n} />}
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
        <button type="button" className="btn btn-quiet" onClick={expandAll} disabled={!tagData}>全部展开</button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(new Set())} disabled={!tagData}>全部收起</button>
      </PageHead>

      <form className="tm-root" onSubmit={submitRoot}>
        <label className="label" htmlFor="tm-root-name">新建根标签</label>
        <div className="tm-inline">
          <input id="tm-root-name" className="input" value={rootName} onChange={(e) => setRootName(e.target.value)} maxLength={24} placeholder="如 人物、家人、项目" />
          <button type="submit" className="btn btn-primary" disabled={!rootName.trim() || busy === '__root'}>添加根标签</button>
        </div>
      </form>

      <div className="tm-status" role="status" aria-live="polite">
        {problem && <p className="error-text" role="alert">{problem}</p>}
        {!problem && done && <p className="sf-ok">{done}</p>}
      </div>

      {!tagData && !tagsReq.error && <p className="loading">加载中</p>}
      {!tagData && tagsReq.error != null && (
        <div className="notice stack">
          <p className="error-text" style={{ margin: 0 }}>{errMsg(tagsReq.error, '标签加载失败')}</p>
          <div><button type="button" className="btn" onClick={tagsReq.reload}>重试</button></div>
        </div>
      )}
      {tagData && (
        <>
          <p className="small muted tm-summary">
            共 <span className="mono">{tagData.tags.length}</span> 个标签，其中你的 <span className="mono">{own}</span> 个。右侧数字是带这个标签或其子孙标签的照片数。
          </p>
          <div className="tm-tree">{renderNodes(tree.roots)}</div>
        </>
      )}
    </main>
  );
}
