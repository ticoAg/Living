import { Icon } from '../components/icons';
import { fmtBytes, fmtStamp } from './util';
import { statusOf, type Item } from './upload-model';

export function StatusChip({ item, all }: { item: Item; all: Item[] }) {
  const s = statusOf(item, all);
  const pct = s.key === 'sending' ? ` ${Math.round(item.publish.progress * 100)}%` : '';
  return (
    <span className="up-chip" data-status={s.key}>
      {s.label}
      {pct && <span className="mono">{pct}</span>}
    </span>
  );
}

interface Props {
  items: Item[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function UploadQueue({ items, selectedId, onSelect, onRemove }: Props) {
  return (
    <ol className="up-queue" aria-label="上传队列">
      {items.map((it) => {
        const s = statusOf(it, items);
        const selected = it.id === selectedId;
        return (
          <li key={it.id} className="up-q" data-selected={selected} data-status={s.key}>
            <button type="button" className="up-q-main" aria-current={selected ? 'true' : undefined} onClick={() => onSelect(it.id)}>
              <span className="up-thumb" aria-hidden="true">
                {it.thumbUrl ? <img src={it.thumbUrl} alt="" /> : <Icon name={it.stage === 'error' ? 'close' : 'upload'} size={20} />}
              </span>
              <span className="up-q-text">
                <span className="up-q-name">{it.file.name}</span>
                <span className="up-q-meta small muted mono">
                  {it.p?.exif.takenAt ? fmtStamp(it.p.exif.takenAt) : fmtBytes(it.file.size)}
                </span>
                <StatusChip item={it} all={items} />
              </span>
            </button>
            <button type="button" className="up-q-x" aria-label={`移除 ${it.file.name}`} title="移除" disabled={it.publish.state === 'sending'} onClick={() => onRemove(it.id)}>
              <Icon name="close" size={16} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}
