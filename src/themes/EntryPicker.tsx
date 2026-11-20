import { useMemo, useState } from 'react';
import { entryLabel, entryTypeLabel, occurredDay } from '../../shared/entries';
import type { EntrySummary, PhotoSummary, ThemeEntry } from '../../shared/types';
import { attachmentsLabel } from '../attachments/kinds';
import { Icon } from '../components/icons';
import Img from '../components/Img';
import PickerDialog from '../components/PickerDialog';
import { MY_ENTRIES, MY_PHOTOS, useEntryList, usePhotoMap } from '../entries/api';
import { fmtDay } from '../lib/format';
import { VISIBILITY_LABEL } from './util';

// The owner's own entries in a dialog, to add to a collection: words to look for and a date range, several at once.
// The dialog and its styles are the photo picker's (components/PickerDialog.tsx).

interface Props {
  open: boolean;
  onClose: () => void;
  /** ids of entries already there: shown, but not selectable */
  existing: ReadonlySet<string>;
  /** date range to start with (a trip's own dates) */
  from?: string;
  to?: string;
  /** in the order they happened */
  onAdd: (entries: ThemeEntry[]) => void;
}

const PAGE = 60;

const haystack = (e: EntrySummary) => `${e.title ?? ''}\n${e.excerpt ?? ''}`.toLowerCase();

function Body({ existing, from = '', to = '', onAdd, onClose, titleId }: Omit<Props, 'open'> & { titleId: string }) {
  const list = useEntryList(MY_ENTRIES);
  const photos = usePhotoMap(MY_PHOTOS);
  const [words, setWords] = useState('');
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [limit, setLimit] = useState(PAGE);

  const entries = list.entries;
  const filtered = useMemo(() => {
    const w = words.trim().toLowerCase();
    return entries?.filter((e) => {
      const d = occurredDay(e.occurredAt);
      if ((start && d < start) || (end && d > end)) return false;
      return !w || haystack(e).includes(w);
    });
  }, [entries, words, start, end]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const refilter =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setLimit(PAGE);
    };

  const shownPhotos = (e: EntrySummary): PhotoSummary[] =>
    e.photoIds.map((id) => photos.byId.get(id)).filter((p): p is PhotoSummary => !!p);
  const chosen = (entries ?? []).filter((e) => selected.has(e.id)).sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : 1));
  const alreadyIn = filtered?.filter((e) => existing.has(e.id)).length ?? 0;

  const submit = () => {
    if (!chosen.length) return;
    onAdd(chosen.map((e) => ({ ...e, photos: shownPhotos(e) })));
    onClose();
  };

  return (
    <div className="pp-panel">
      <header className="pp-head">
        <h2 id={titleId} className="pp-title">
          添加记录
        </h2>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </header>

      <div className="pp-filters">
        <div className="pp-dates">
          <div className="field ep-words">
            <label className="label" htmlFor="ep-words">
              查找
            </label>
            <input
              id="ep-words"
              type="search"
              className="input"
              value={words}
              placeholder="标题或正文里的字"
              onChange={(e) => refilter(setWords)(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="ep-from">
              开始日期
            </label>
            <input
              id="ep-from"
              type="date"
              className="input"
              value={start}
              max={end || undefined}
              onChange={(e) => refilter(setStart)(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="ep-to">
              结束日期
            </label>
            <input
              id="ep-to"
              type="date"
              className="input"
              value={end}
              min={start || undefined}
              onChange={(e) => refilter(setEnd)(e.target.value)}
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
      </div>

      <div className="pp-scroll">
        {list.error && !entries ? (
          <div className="th-empty" role="alert">
            <p className="th-empty-title">记录加载失败</p>
            <button type="button" className="btn" onClick={list.reload}>
              重试
            </button>
          </div>
        ) : !filtered ? (
          <p className="loading">加载中</p>
        ) : filtered.length === 0 ? (
          <p className="loading">{entries && entries.length === 0 ? '你还没有记录。' : '没有符合条件的记录。'}</p>
        ) : (
          <>
            <ul className="ep-list">
              {filtered.slice(0, limit).map((e) => {
                const added = existing.has(e.id);
                const on = selected.has(e.id);
                const label = entryLabel(e.title, e.excerpt, 60) || entryTypeLabel(e.type);
                const cover = shownPhotos(e)[0];
                const marks = [
                  e.type !== 'note' ? entryTypeLabel(e.type) : '',
                  e.status === 'draft' ? '草稿' : e.status === 'archived' ? '已归档' : '',
                  e.visibility !== 'public' ? `${VISIBILITY_LABEL[e.visibility]}可见` : ''
                ].filter(Boolean);
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      className="ep-row"
                      aria-pressed={on}
                      aria-label={[label, fmtDay(e.occurredAt), ...marks, added ? '已在合集里' : ''].filter(Boolean).join('，')}
                      disabled={added}
                      onClick={() => toggle(e.id)}
                    >
                      <span className="ep-thumb">
                        {cover ? (
                          <Img photo={cover} ratio="1 / 1" sizes="56px" alt="" />
                        ) : (
                          <span className="ep-thumb-blank">
                            <Icon name="note" size={18} />
                          </span>
                        )}
                      </span>
                      <span className="ep-main">
                        <span className="ep-meta">
                          <span className="mono">{fmtDay(e.occurredAt)}</span>
                          {marks.map((m) => (
                            <span key={m}>{m}</span>
                          ))}
                          {e.photoIds.length > 0 && <span>{e.photoIds.length} 张照片</span>}
                          {e.attachments.length > 0 && <span>{attachmentsLabel(e.attachments)}</span>}
                        </span>
                        <span className="ep-label">{label}</span>
                      </span>
                      {added ? (
                        <span className="ep-added">已添加</span>
                      ) : (
                        <span className="ep-check" aria-hidden="true">
                          {on && <Icon name="check" size={16} />}
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
                  显示更多（还有 {filtered.length - limit} 条）
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <footer className="pp-foot">
        <div className="pp-stat" aria-live="polite">
          <span>
            <b className="mono">{filtered?.length ?? 0}</b> 条{alreadyIn > 0 && <span className="muted">，{alreadyIn} 条已添加</span>}
          </span>
          <span className="pp-stat-sel">
            已选 <b className="mono">{selected.size}</b>
          </span>
        </div>
        <div className="pp-acts">
          {selected.size > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setSelected(new Set())}>
              清除选择
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!chosen.length} onClick={submit}>
            添加{chosen.length ? ` ${chosen.length} 条` : ''}
          </button>
        </div>
      </footer>
    </div>
  );
}

/** Modal over the owner's own entries: words and a date range, multi-select. */
export default function EntryPicker(props: Props) {
  return (
    <PickerDialog open={props.open} onClose={props.onClose}>
      {(titleId) => (
        <Body existing={props.existing} from={props.from} to={props.to} onAdd={props.onAdd} onClose={props.onClose} titleId={titleId} />
      )}
    </PickerDialog>
  );
}
