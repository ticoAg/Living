import { useMemo } from 'react';
import { nearbyGroup } from './batch-place';
import { inBulk, isEditable, type Item, type Status, type StatusKey } from './upload-model';

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
  /** a publishing run in progress */
  bulk: { done: number; total: number } | null;
  onCheck: (ids: string[]) => void;
  onPublishAll: (ids: string[]) => void;
  onStop: () => void;
  onClearPublished: () => void;
}

/** Above the queue: its title with the select buttons, the status counts, and 全部发布 / 停止 / 清除已发布. */
export default function UploadQueueHead({
  items,
  statuses,
  selected,
  pickedIds,
  pickedCount,
  bulk,
  onCheck,
  onPublishAll,
  onStop,
  onClearPublished
}: Props) {
  const counts = useMemo(() => {
    const c = new Map<StatusKey, number>();
    for (const s of statuses) c.set(s.key, (c.get(s.key) ?? 0) + 1);
    return c;
  }, [statuses]);
  const toSend = items.filter(inBulk).length;
  const selectable = items.filter(isEditable);
  const allPicked = selectable.length > 0 && selectable.every((i) => pickedIds.has(i.id));
  const publishedCount = (counts.get('published') ?? 0) + (counts.get('duplicate') ?? 0);
  // the photos taken around the same spot as the one on screen, one click to select
  const nearby = useMemo(() => nearbyGroup(items, selected.id), [items, selected]);
  const nearbyPicked = nearby.length > 1 && nearby.length === pickedCount && nearby.every((id) => pickedIds.has(id));

  return (
    <div className="up-queue-head">
      <div className="up-queue-title">
        <h2 className="up-h serif">
          队列 <span className="mono">{items.length}</span>
        </h2>
        <div className="up-picktools">
          {nearby.length > 1 && (
            <button
              type="button"
              className="btn btn-quiet up-pickall"
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
              className="btn btn-quiet up-pickall"
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
      <div className="up-bulk">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!!bulk || toSend === 0}
          title="照原样发布队列里所有还没发的照片；没确认地点的不关联地点"
          onClick={() => onPublishAll(items.filter(inBulk).map((i) => i.id))}
        >
          {bulk ? `发布中 ${bulk.done} / ${bulk.total}` : `全部发布（${toSend}）`}
        </button>
        {bulk && (
          <button type="button" className="btn btn-quiet" onClick={onStop}>
            停止
          </button>
        )}
        {!bulk && publishedCount > 0 && (
          <button type="button" className="btn btn-quiet" onClick={onClearPublished}>
            清除已发布
          </button>
        )}
      </div>
    </div>
  );
}
