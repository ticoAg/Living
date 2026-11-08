import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PhotoSummary, Tag } from '../../shared/types';
import Img from '../components/Img';
import { Icon } from '../components/icons';
import { fmtDay } from '../lib/format';
import { buildTagTree, filterByTags, inclusiveCounts, isSwatch, swatchFill, type TagNode } from '../lib/tags';
import { useApi } from '../lib/useApi';
import { byTaken, type EditorPhoto } from './draft';
import { dayOf } from './util';

interface Props {
  open: boolean;
  onClose: () => void;
  /** ids of photos already in the theme: shown, but not selectable */
  existing: ReadonlySet<string>;
  /** date range to start with (the trip's own dates) */
  from?: string;
  to?: string;
  onAdd: (photos: EditorPhoto[]) => void;
}

const PAGE = 120;

function flatten(node: TagNode): TagNode[] {
  return node.children.flatMap((c) => [c, ...flatten(c)]);
}

function Body({ existing, from = '', to = '', onAdd, onClose, titleId }: Omit<Props, 'open'> & { titleId: string }) {
  const photosReq = useApi<{ photos: PhotoSummary[] }>('/api/photos?mine=1');
  const tagsReq = useApi<{ tags: Tag[] }>('/api/tags');
  const tree = useMemo(() => buildTagTree(tagsReq.data?.tags ?? []), [tagsReq.data]);

  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [limit, setLimit] = useState(PAGE);

  const photos = photosReq.data?.photos;
  const dated = useMemo(
    () =>
      photos?.filter((p) => {
        if (!start && !end) return true;
        const d = dayOf(p.takenAt);
        return !!d && (!start || d >= start) && (!end || d <= end);
      }),
    [photos, start, end]
  );
  const filtered = useMemo(() => (dated ? filterByTags(dated, tagIds, tree) : undefined), [dated, tagIds, tree]);
  const counts = useMemo(() => inclusiveCounts(dated ?? [], tree), [dated, tree]);
  const groups = useMemo(
    () =>
      tree.roots
        .map((root) => {
          const nodes = (root.children.length ? flatten(root) : [root]).filter((n) => (counts.get(n.id) ?? 0) > 0 || tagIds.includes(n.id));
          return { root, nodes };
        })
        .filter((g) => g.nodes.length),
    [tree, counts, tagIds]
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleTag = (id: string) => {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setLimit(PAGE);
  };

  const addable = filtered?.filter((p) => !existing.has(p.id)) ?? [];
  const alreadyIn = (filtered?.length ?? 0) - addable.length;
  const chosen = photos?.filter((p) => selected.has(p.id)).sort(byTaken) ?? [];
  const tagNames = tagIds.map((id) => tree.byId.get(id)?.name).filter(Boolean);

  const submit = () => {
    if (!chosen.length) return;
    onAdd(chosen);
    onClose();
  };

  return (
    <div className="pp-panel">
      <header className="pp-head">
        <h2 id={titleId} className="pp-title">
          添加照片
        </h2>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </header>

      <div className="pp-filters">
        <div className="pp-dates">
          <div className="field">
            <label className="label" htmlFor="pp-from">
              开始日期
            </label>
            <input
              id="pp-from"
              type="date"
              className="input"
              value={start}
              max={end || undefined}
              onChange={(e) => {
                setStart(e.target.value);
                setLimit(PAGE);
              }}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="pp-to">
              结束日期
            </label>
            <input
              id="pp-to"
              type="date"
              className="input"
              value={end}
              min={start || undefined}
              onChange={(e) => {
                setEnd(e.target.value);
                setLimit(PAGE);
              }}
            />
          </div>
          {(start || end) && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                setStart('');
                setEnd('');
                setLimit(PAGE);
              }}
            >
              清除日期
            </button>
          )}
        </div>
        {groups.length > 0 && (
          <details className="pp-tags">
            <summary>
              标签
              {tagNames.length > 0 && <span className="pp-tags-on">{tagNames.join('、')}</span>}
            </summary>
            <div className="pp-taglist">
              {groups.map(({ root, nodes }) => (
                <div key={root.id} className="pp-taggroup">
                  {root.children.length > 0 && <span className="pp-taggroup-name">{root.name}</span>}
                  <div className="pp-chips">
                    {nodes.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className="chip chip-outline pp-chip"
                        data-depth={n.depth}
                        aria-pressed={tagIds.includes(n.id)}
                        title={tree.path(n.id).join(' / ')}
                        onClick={() => toggleTag(n.id)}
                      >
                        {isSwatch(n) && <span className="pp-dot" style={{ background: swatchFill(n.color) }} aria-hidden="true" />}
                        {n.name}
                        <span className="mono pp-chip-n">{counts.get(n.id) ?? 0}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="pp-scroll">
        {photosReq.error ? (
          <div className="th-empty" role="alert">
            <p className="th-empty-title">照片加载失败</p>
            <button type="button" className="btn" onClick={photosReq.reload}>
              重试
            </button>
          </div>
        ) : !filtered ? (
          <p className="loading">加载中</p>
        ) : filtered.length === 0 ? (
          <p className="loading">{photos && photos.length === 0 ? '你还没有照片，先去上传。' : '没有符合条件的照片。'}</p>
        ) : (
          <>
            <ul className="pp-grid">
              {filtered.slice(0, limit).map((p) => {
                const added = existing.has(p.id);
                const on = selected.has(p.id);
                const label = [fmtDay(p.takenAt), p.title ?? p.city, added ? '已在主题里' : ''].filter(Boolean).join('，') || '照片';
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="pp-cell"
                      aria-pressed={on}
                      aria-label={label}
                      disabled={added}
                      onClick={() => toggle(p.id)}
                    >
                      <Img photo={p} ratio="1 / 1" sizes="(max-width: 640px) 34vw, 160px" alt="" />
                      <span className="pp-date mono">{p.takenAt ? fmtDay(p.takenAt) : '无日期'}</span>
                      {added && <span className="pp-added">已添加</span>}
                      {on && (
                        <span className="pp-check" aria-hidden="true">
                          <Icon name="check" size={16} />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {filtered.length > limit && (
              <div className="pp-more">
                <button type="button" className="btn" onClick={() => setLimit((n) => n + PAGE)}>
                  显示更多（还有 {filtered.length - limit} 张）
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <footer className="pp-foot">
        <div className="pp-stat" aria-live="polite">
          <span>
            <b className="mono">{filtered?.length ?? 0}</b> 张{alreadyIn > 0 && <span className="muted">，{alreadyIn} 张已添加</span>}
          </span>
          <span className="pp-stat-sel">
            已选 <b className="mono">{selected.size}</b>
          </span>
        </div>
        <div className="pp-acts">
          {addable.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setSelected(new Set([...selected, ...addable.map((p) => p.id)]))}
            >
              全选
            </button>
          )}
          {selected.size > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setSelected(new Set())}>
              清除选择
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!chosen.length} onClick={submit}>
            添加{chosen.length ? ` ${chosen.length} 张` : ''}
          </button>
        </div>
      </footer>
    </div>
  );
}

/** Modal over the owner's own photos: date range and tag filters, multi-select. */
export default function PhotoPicker(props: Props) {
  const { open, onClose } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // a press that starts inside the panel and ends on the backdrop (text selection, a date picker) must not close it
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="pp"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      {open && <Body existing={props.existing} from={props.from} to={props.to} onAdd={props.onAdd} onClose={onClose} titleId={titleId} />}
    </dialog>
  );
}
