import { inBulk, type Item } from './upload-model';

interface Props {
  items: Item[];
  /** a publishing run in progress */
  bulk: { done: number; total: number } | null;
  onPublishAll: (ids: string[]) => void;
  onStop: () => void;
  onClearPublished: () => void;
}

/** The page's own actions, at the right of the top bar: 全部发布, 停止 while a run is going, 清除已发布 after one. */
export default function UploadBulk({ items, bulk, onPublishAll, onStop, onClearPublished }: Props) {
  const toSend = items.filter(inBulk).length;
  const published = items.filter((i) => i.publish.state === 'done' || i.publish.state === 'duplicate').length;
  return (
    <div className="up-bulk">
      {bulk && (
        <button type="button" className="btn btn-quiet" onClick={onStop}>
          停止
        </button>
      )}
      {!bulk && published > 0 && (
        <button type="button" className="btn btn-ghost" onClick={onClearPublished}>
          清除已发布
        </button>
      )}
      <button
        type="button"
        className="btn btn-primary up-bulk-go"
        disabled={!!bulk || toSend === 0}
        title="照原样发布队列里所有还没发的照片；没确认地点的不关联地点"
        onClick={() => onPublishAll(items.filter(inBulk).map((i) => i.id))}
      >
        {bulk ? `发布中 ${bulk.done} / ${bulk.total}` : `全部发布（${toSend}）`}
      </button>
    </div>
  );
}
