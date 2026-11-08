import { memo, useEffect, useRef } from 'react';
import { Icon } from '../components/icons';
import { fmtBytes, fmtStamp } from './util';
import { statusOf, type Item, type Status } from './upload-model';

/** Status pill for the item in the details panel. */
export function StatusChip({ item, all }: { item: Item; all: Item[] }) {
  return <Chip status={statusOf(item, all)} progress={item.publish.progress} />;
}

function Chip({ status, progress }: { status: Status; progress: number }) {
  return (
    <span className="up-chip" data-status={status.key}>
      {status.label}
      {status.key === 'sending' && <span className="mono"> {Math.round(progress * 100)}%</span>}
    </span>
  );
}

interface RowProps {
  it: Item;
  statusKey: Status['key'];
  statusLabel: string;
  selected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

// Memoised: typing in the details form re-renders the page, but only the edited item's row changes.
const Row = memo(function Row({ it, statusKey, statusLabel, selected, onSelect, onRemove }: RowProps) {
  const ref = useRef<HTMLLIElement>(null);
  // After "publish" moves on to the next photo, keep its row in view (the strip on phones scrolls sideways).
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);
  return (
    <li ref={ref} className="up-q" data-selected={selected} data-status={statusKey}>
      <button type="button" className="up-q-main" aria-current={selected ? 'true' : undefined} onClick={() => onSelect(it.id)}>
        <span className="up-thumb" aria-hidden="true">
          {it.thumbUrl ? <img src={it.thumbUrl} alt="" /> : <Icon name={it.stage === 'error' ? 'close' : 'upload'} size={20} />}
        </span>
        <span className="up-q-text">
          <span className="up-q-name">{it.file.name}</span>
          <span className="up-q-meta small muted mono">{it.p?.exif.takenAt ? fmtStamp(it.p.exif.takenAt) : fmtBytes(it.file.size)}</span>
          <Chip status={{ key: statusKey, label: statusLabel }} progress={it.publish.progress} />
        </span>
      </button>
      <button type="button" className="up-q-x" aria-label={`移除 ${it.file.name}`} title="移除" disabled={it.publish.state === 'sending'} onClick={() => onRemove(it.id)}>
        <Icon name="close" size={16} />
      </button>
    </li>
  );
});

interface Props {
  items: Item[];
  /** `statusOf` for every item, same order */
  statuses: Status[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function UploadQueue({ items, statuses, selectedId, onSelect, onRemove }: Props) {
  return (
    <ol className="up-queue" aria-label="上传队列">
      {items.map((it, i) => (
        <Row key={it.id} it={it} statusKey={statuses[i].key} statusLabel={statuses[i].label} selected={it.id === selectedId} onSelect={onSelect} onRemove={onRemove} />
      ))}
    </ol>
  );
}
