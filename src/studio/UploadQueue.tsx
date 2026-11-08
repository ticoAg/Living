import { memo, useEffect, useRef, type MouseEvent } from 'react';
import { Icon } from '../components/icons';
import { fmtBytes, fmtStamp } from './util';
import { PHASE_TEXT, statusOf, type Item, type PickHow, type Status } from './upload-model';

/** Status pill for the item in the details panel. */
export function StatusChip({ item, all }: { item: Item; all: Item[] }) {
  return <Chip status={statusOf(item, all)} progress={item.publish.progress} />;
}

/** A matched photo's pill names its place; the colour still says "已匹配". */
function Chip({ status, progress, place }: { status: Status; progress: number; place?: string | null }) {
  return (
    <span className="up-chip" data-status={status.key} title={place ? `${status.label}：${place}` : undefined}>
      <span className="up-chip-text">{place ?? status.label}</span>
      {status.key === 'sending' && <span className="mono"> {Math.round(progress * 100)}%</span>}
    </span>
  );
}

/** Shift picks a run; ctrl/⌘ or the checkbox adds or drops one photo; a plain click shows one. */
const howOf = (e: MouseEvent, box = false): PickHow => (e.shiftKey ? 'range' : box ? 'check' : e.metaKey || e.ctrlKey ? 'toggle' : 'one');

interface RowProps {
  it: Item;
  statusKey: Status['key'];
  statusLabel: string;
  /** where a matched photo will be published */
  place: string | null;
  /** its tags' names */
  tagLine: string;
  current: boolean;
  checked: boolean;
  onPick: (id: string, how: PickHow) => void;
  onRemove: (id: string) => void;
}

// Memoised: typing in the details form re-renders the page, but only the edited item's row changes.
const Row = memo(function Row({ it, statusKey, statusLabel, place, tagLine, current, checked, onPick, onRemove }: RowProps) {
  const ref = useRef<HTMLLIElement>(null);
  // After "publish" moves on to the next photo, keep its row in view (the strip on phones scrolls sideways).
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current]);
  return (
    <li ref={ref} className="up-q" data-selected={current} data-checked={checked} data-status={statusKey}>
      <button
        type="button"
        className="up-q-main"
        aria-current={current ? 'true' : undefined}
        title={it.file.name}
        onClick={(e) => onPick(it.id, howOf(e))}
      >
        <span className="up-thumb" aria-hidden="true">
          {it.thumbUrl ? <img src={it.thumbUrl} alt="" /> : <Icon name={it.stage === 'error' ? 'close' : 'upload'} size={20} />}
        </span>
        <span className="up-q-text">
          <span className="up-q-name">{it.file.name}</span>
          <span className="up-q-meta small muted mono">
            {it.phase ? PHASE_TEXT[it.phase].short : it.p?.exif.takenAt ? fmtStamp(it.p.exif.takenAt) : fmtBytes(it.file.size)}
          </span>
          <Chip status={{ key: statusKey, label: statusLabel }} progress={it.publish.progress} place={place} />
          {tagLine && <span className="up-q-tags">{tagLine}</span>}
        </span>
      </button>
      <input
        type="checkbox"
        className="up-q-check"
        aria-label={`选择 ${it.file.name}`}
        checked={checked}
        onChange={() => {}}
        onClick={(e) => onPick(it.id, howOf(e, true))}
      />
      <button
        type="button"
        className="up-q-x"
        aria-label={`移除 ${it.file.name}`}
        title="移除"
        disabled={it.publish.state === 'sending'}
        onClick={() => onRemove(it.id)}
      >
        <Icon name="close" size={16} />
      </button>
    </li>
  );
});

interface Props {
  items: Item[];
  /** `statusOf` for every item, same order */
  statuses: Status[];
  /** the place each matched item will be published with, same order */
  places: (string | null)[];
  tagLines: string[];
  currentId: string | null;
  checked: ReadonlySet<string>;
  /** photos are checked: the checkboxes stay in view */
  selecting: boolean;
  onPick: (id: string, how: PickHow) => void;
  onRemove: (id: string) => void;
}

export default function UploadQueue({ items, statuses, places, tagLines, currentId, checked, selecting, onPick, onRemove }: Props) {
  return (
    <ol className="up-queue" aria-label="上传队列" data-selecting={selecting}>
      {items.map((it, i) => (
        <Row
          key={it.id}
          it={it}
          statusKey={statuses[i].key}
          statusLabel={statuses[i].label}
          place={places[i]}
          tagLine={tagLines[i]}
          current={it.id === currentId}
          checked={checked.has(it.id)}
          onPick={onPick}
          onRemove={onRemove}
        />
      ))}
    </ol>
  );
}
