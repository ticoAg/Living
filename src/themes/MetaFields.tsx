import { useMemo, type Dispatch, type SetStateAction } from 'react';
import { THEME_LIMITS } from '../../shared/limits';
import type { ThemeKind, Visibility } from '../../shared/types';
import Img from '../components/Img';
import { photoDayRange, type Draft } from './draft';
import { coverChoices } from './items';
import { KIND_LABEL, VISIBILITY_HINT, VISIBILITY_LABEL } from './util';

const VISIBILITIES: Visibility[] = ['public', 'unlisted', 'private'];
const KINDS: ThemeKind[] = ['trip', 'topic'];

interface Props {
  draft: Draft;
  set: <K extends keyof Draft>(field: K, value: Draft[K]) => void;
  setDraft: Dispatch<SetStateAction<Draft>>;
  /** a new theme: the title field takes focus */
  isNew: boolean;
}

/** The editor's 基本信息 section: kind, title, subtitle, intro, dates, visibility and cover. */
export default function MetaFields({ draft, set, setDraft, isNew }: Props) {
  const trip = draft.kind === 'trip';
  const coverPhotos = useMemo(() => coverChoices(draft.items), [draft.items]);
  const privateCount = useMemo(
    () => draft.items.filter((it) => it.kind === 'photo' && it.photo?.visibility === 'private').length,
    [draft.items]
  );
  const range = useMemo(() => photoDayRange(draft.items), [draft.items]);

  return (
    <section className="ed-sec" aria-labelledby="ed-basic">
      <h2 id="ed-basic" className="ed-h">
        基本信息
      </h2>

      <div className="field">
        <span className="label" id="th-kind-label">
          类型
        </span>
        <div className="seg" role="group" aria-labelledby="th-kind-label">
          {KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={draft.kind === k} onClick={() => set('kind', k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="small muted ed-hint">{trip ? '有起止日期，按天分段，游记里画出路线。' : '不受时间约束的精选。'}</p>
      </div>

      <div className="field">
        <label className="label" htmlFor="th-title">
          标题
        </label>
        <input
          id="th-title"
          className="input ed-title-input"
          value={draft.title}
          maxLength={THEME_LIMITS.titleMax}
          autoFocus={isNew}
          placeholder={trip ? '例：2026 秋 · 杭州三日' : '例：西湖四季'}
          onChange={(e) => set('title', e.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="th-subtitle">
          副标题
        </label>
        <input
          id="th-subtitle"
          className="input"
          value={draft.subtitle}
          maxLength={THEME_LIMITS.subtitleMax}
          onChange={(e) => set('subtitle', e.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="th-intro">
          导语
        </label>
        <textarea
          id="th-intro"
          className="textarea"
          rows={5}
          maxLength={THEME_LIMITS.introMax}
          value={draft.intro}
          placeholder="几句话说明这次旅程或这个专题。空一行分段。"
          onChange={(e) => set('intro', e.target.value)}
        />
      </div>

      {trip && (
        <div className="ed-dates">
          <div className="field">
            <label className="label" htmlFor="th-start">
              开始日期
            </label>
            <input
              id="th-start"
              type="date"
              className="input"
              value={draft.startDate}
              max={draft.endDate || undefined}
              onChange={(e) => set('startDate', e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="th-end">
              结束日期
            </label>
            <input
              id="th-end"
              type="date"
              className="input"
              value={draft.endDate}
              min={draft.startDate || undefined}
              onChange={(e) => set('endDate', e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-quiet"
            disabled={!range || (range.start === draft.startDate && range.end === draft.endDate)}
            onClick={() => range && setDraft((d) => ({ ...d, startDate: range.start, endDate: range.end }))}
          >
            取自照片
          </button>
        </div>
      )}

      <div className="field">
        <span className="label" id="th-vis-label">
          公开范围
        </span>
        <div className="seg" role="group" aria-labelledby="th-vis-label">
          {VISIBILITIES.map((v) => (
            <button key={v} type="button" aria-pressed={draft.visibility === v} onClick={() => set('visibility', v)}>
              {VISIBILITY_LABEL[v]}
            </button>
          ))}
        </div>
        <p className="small muted ed-hint">{VISIBILITY_HINT[draft.visibility]}</p>
        {draft.visibility !== 'private' && privateCount > 0 && (
          <p className="small ed-warn" role="note">
            有 {privateCount} 张照片仅自己可见，读者看不到它们。
          </p>
        )}
      </div>

      <div className="field">
        <span className="label" id="th-cover-label">
          封面
        </span>
        {coverPhotos.length === 0 ? (
          <p className="small muted ed-hint">添加照片后，可以从中选择封面。</p>
        ) : (
          <div className="ed-covers" role="group" aria-labelledby="th-cover-label">
            <button
              type="button"
              className="ed-cover ed-cover-auto"
              aria-pressed={!draft.coverPhotoId}
              onClick={() => set('coverPhotoId', null)}
            >
              默认
              <br />
              第一张
            </button>
            {coverPhotos.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className="ed-cover"
                aria-pressed={draft.coverPhotoId === p.id}
                aria-label={`设为封面：第 ${i + 1} 张照片`}
                onClick={() => set('coverPhotoId', p.id)}
              >
                <Img photo={p} ratio="4 / 3" sizes="96px" alt="" />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
