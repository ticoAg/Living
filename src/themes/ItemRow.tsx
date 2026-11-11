import { memo, useId, type DragEvent } from 'react';
import { THEME_ITEM_LIMITS } from '../../shared/limits';
import type { Poi, Visibility } from '../../shared/types';
import Img from '../components/Img';
import { CategoryIcon, Icon } from '../components/icons';
import { fmtDay, fmtTime } from '../lib/format';
import AutoTextarea from './AutoTextarea';
import type { DraftItem } from './draft';
import { fmtDayHeading } from './util';

/** Callbacks shared by every row. The object is created once, so rows only re-render when their own data changes. */
export interface RowActions {
  patch: (key: string, patch: { text?: string; day?: string }) => void;
  move: (key: string, delta: -1 | 1) => void;
  remove: (key: string) => void;
  toggleMenu: (key: string) => void;
  insert: (key: string, kind: 'text' | 'day' | 'photo') => void;
  dragStart: (key: string) => void;
  dragOver: (key: string, pos: 'before' | 'after') => void;
  drop: () => void;
  dragEnd: () => void;
}

interface Props {
  item: DraftItem;
  index: number;
  total: number;
  poi: Poi | null;
  themeVisibility: Visibility;
  menuOpen: boolean;
  dropPos: 'before' | 'after' | null;
  dragging: boolean;
  actions: RowActions;
}

const DRAG_TYPE = 'application/x-living-item';
const KIND_NAME = { photo: '照片', text: '文字段落', day: '日期分段' } as const;

const excerpt = (s: string, n = 56) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

function ItemRow({ item, index, total, poi, themeVisibility, menuOpen, dropPos, dragging, actions }: Props) {
  const uid = useId();
  const { key } = item;
  const num = `第 ${index + 1} 项`;
  const photo = item.kind === 'photo' ? item.photo : null;

  const onDragOver = (e: DragEvent<HTMLLIElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = e.currentTarget.getBoundingClientRect();
    actions.dragOver(key, e.clientY < r.top + r.height / 2 ? 'before' : 'after');
  };
  const onDrop = (e: DragEvent<HTMLLIElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    actions.drop();
  };

  let noteLine = '照片还没有笔记';
  if (photo?.note) noteLine = `照片笔记：${excerpt(photo.note)}`;
  else if (photo && photo.note === undefined && photo.hasNote) noteLine = '这张照片有笔记';

  return (
    <li
      className="ed-row"
      data-kind={item.kind}
      data-item-key={key}
      data-drop={dropPos ?? undefined}
      data-dragging={dragging || undefined}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="ed-row-head">
        <span
          className="ed-grip"
          draggable
          title="拖动排序"
          aria-hidden="true"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData(DRAG_TYPE, key);
            e.dataTransfer.setData('text/plain', key);
            const li = (e.currentTarget as HTMLElement).closest('li');
            if (li) e.dataTransfer.setDragImage(li, 24, 24);
            actions.dragStart(key);
          }}
          onDragEnd={actions.dragEnd}
        >
          <Icon name="grip" size={18} />
        </span>
        <span className="ed-index mono">{String(index + 1).padStart(2, '0')}</span>
        <span className="ed-kind">{KIND_NAME[item.kind]}</span>
        <span className="ed-ctrls">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            data-act="up"
            aria-label={`上移${num}`}
            disabled={index === 0}
            onClick={() => actions.move(key, -1)}
          >
            <Icon name="down" size={18} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            data-act="down"
            aria-label={`下移${num}`}
            disabled={index === total - 1}
            onClick={() => actions.move(key, 1)}
          >
            <Icon name="down" size={18} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={`在${num}之后插入`}
            aria-expanded={menuOpen}
            data-active={menuOpen || undefined}
            onClick={() => actions.toggleMenu(key)}
          >
            <Icon name="plus" size={18} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon ed-remove"
            data-act="remove"
            aria-label={`移除${num}`}
            onClick={() => actions.remove(key)}
          >
            <Icon name="trash" size={18} />
          </button>
        </span>
      </div>

      {item.kind === 'photo' && (
        <div className="ed-photo">
          <div className="ed-thumb">
            {photo ? (
              <Img photo={photo} ratio="4 / 3" sizes="120px" alt="" />
            ) : (
              <span className="ed-thumb-blank" aria-hidden="true">
                <Icon name="close" size={20} />
              </span>
            )}
          </div>
          <div className="ed-photo-main">
            {photo ? (
              <p className="ed-meta">
                {poi ? (
                  <span className="ed-poi">
                    <CategoryIcon category={poi.category} size={15} />
                    {poi.name}
                  </span>
                ) : (
                  photo.city && <span>{photo.city}</span>
                )}
                {photo.takenAt && (
                  <span className="mono">
                    {fmtDay(photo.takenAt)} {fmtTime(photo.takenAt)}
                  </span>
                )}
                {photo.visibility === 'private' && themeVisibility !== 'private' && (
                  <span className="ed-flag" title="照片本身是仅自己可见，读者在主题里看不到它">
                    照片仅自己可见
                  </span>
                )}
              </p>
            ) : (
              <p className="ed-meta">这张照片已不可用，保存时会从主题中移除。</p>
            )}
            {photo && (
              <>
                <div className="field">
                  <label className="label" htmlFor={`${uid}-t`}>
                    本主题说明
                  </label>
                  <AutoTextarea
                    id={`${uid}-t`}
                    className="textarea ed-ta"
                    rows={1}
                    maxLength={THEME_ITEM_LIMITS.captionMax}
                    value={item.text}
                    placeholder="不填则显示照片笔记"
                    onChange={(e) => actions.patch(key, { text: e.target.value })}
                  />
                </div>
                <p className="ed-note">
                  {noteLine}
                  <a href={`/studio/photo/${item.photoId}`} target="_blank" rel="noopener">
                    编辑照片笔记
                  </a>
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {item.kind === 'text' && (
        <div className="field">
          <label className="visually-hidden" htmlFor={`${uid}-t`}>
            文字段落（{num}）
          </label>
          <AutoTextarea
            id={`${uid}-t`}
            className="textarea ed-ta ed-ta-text"
            rows={3}
            maxLength={THEME_ITEM_LIMITS.textMax}
            value={item.text}
            placeholder="写一段文字。空一行分段，网址会自动成为链接。"
            onChange={(e) => actions.patch(key, { text: e.target.value })}
          />
        </div>
      )}

      {item.kind === 'day' && (
        <div className="ed-day">
          <div className="field">
            <label className="label" htmlFor={`th-day-${key}`}>
              日期
            </label>
            <input
              id={`th-day-${key}`}
              type="date"
              className="input"
              value={item.day}
              onChange={(e) => actions.patch(key, { day: e.target.value })}
            />
          </div>
          <p className="ed-day-preview" aria-live="polite">
            {item.day ? fmtDayHeading(item.day) : '请选择日期'}
          </p>
          <div className="field ed-day-text">
            <label className="label" htmlFor={`${uid}-t`}>
              说明（可选）
            </label>
            <AutoTextarea
              id={`${uid}-t`}
              className="textarea ed-ta"
              rows={1}
              maxLength={THEME_ITEM_LIMITS.captionMax}
              value={item.text}
              placeholder="这一天的概述，显示在日期下面"
              onChange={(e) => actions.patch(key, { text: e.target.value })}
            />
          </div>
        </div>
      )}

      {menuOpen && (
        <div className="ed-insert" role="group" aria-label={`在${num}之后插入`}>
          <span className="small muted">在此项之后插入</span>
          <button type="button" className="btn btn-quiet" onClick={() => actions.insert(key, 'photo')}>
            照片
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => actions.insert(key, 'text')}>
            文字段落
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => actions.insert(key, 'day')}>
            日期分段
          </button>
        </div>
      )}
    </li>
  );
}

export default memo(ItemRow);
