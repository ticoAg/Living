import { useMemo } from 'react';
import { nearbyGroup } from './batch-place';
import { isEditable, type Item, type Status, type StatusKey } from './upload-model';

const SUMMARY: { key: StatusKey; label: string }[] = [
  { key: 'matched', label: '已匹配' },
  { key: 'review', label: '待确认' },
  { key: 'nogps', label: '无位置' },
  { key: 'hidden', label: '位置不公开' },
  { key: 'processing', label: '处理中' },
  { key: 'sending', label: '发布中' },
  { key: 'published', label: '已发布' },
  { key: 'duplicate', label: '已存在' },
  { key: 'failed', label: '失败' }
];

interface Props {
  items: Item[];
  /** `statusOf` for every item, same order */
  statuses: Status[];
  /** the photo on screen */
  selected: Item;
  /** checked photos */
  pickedIds: ReadonlySet<string>;
  pickedCount: number;
  onCheck: (ids: string[]) => void;
}

/** Above the queue: its title with the select buttons, and the status counts. Publishing everything is UploadBulk. */
export default function UploadQueueHead({ items, statuses, selected, pickedIds, pickedCount, onCheck }: Props) {
  const counts = useMemo(() => {
    const c = new Map<StatusKey, number>();
    for (const s of statuses) c.set(s.key, (c.get(s.key) ?? 0) + 1);
    return c;
  }, [statuses]);
  const selectable = items.filter(isEditable);
  const allPicked = selectable.length > 0 && selectable.every((i) => pickedIds.has(i.id));
  // the photos taken around the same spot as the one on screen, one click to select
  const nearby = useMemo(() => nearbyGroup(items, selected.id), [items, selected]);
  const nearbyPicked = nearby.length > 1 && nearby.length === pickedCount && nearby.every((id) => pickedIds.has(id));

  return (
    <div className="up-queue-head">
      <div className="up-queue-title">
        <h2 className="up-h">
          队列 <span className="mono">{items.length}</span>
        </h2>
        <div className="up-picktools">
          {nearby.length > 1 && (
            <button
              type="button"
              className="btn btn-ghost up-pickall"
              aria-pressed={nearbyPicked}
              title="选中和当前照片在同一处拍的照片"
              onClick={() => onCheck(nearbyPicked ? [] : nearby)}
            >
              同处 {nearby.length} 张
            </button>
          )}
          {selectable.length > 1 && (
            <button
              type="button"
              className="btn btn-ghost up-pickall"
              aria-pressed={allPicked}
              onClick={() => onCheck(allPicked ? [] : selectable.map((i) => i.id))}
            >
              {allPicked ? '取消全选' : '全选'}
            </button>
          )}
        </div>
      </div>
      <div className="up-summary small" aria-label="状态统计">
        {SUMMARY.filter((s) => counts.get(s.key)).map((s) => (
          <span key={s.key} className="up-chip" data-status={s.key}>
            {s.label} <span className="mono">{counts.get(s.key)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
