import { Link } from 'wouter';
import type { ThemeSummary } from '../../shared/types';
import { useApi } from '../lib/useApi';
import PhotoFields from './PhotoFields';
import { statusOf, tagPatch, tagState, canPublish, type Item } from './upload-model';
import { useKeep } from './util';

function ThemePicker({ value, onChange, disabled }: { value: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const { data, error, reload } = useApi<{ themes: ThemeSummary[] }>('/api/themes?mine=1');
  const kept = useKeep(data);
  const themes = kept?.themes ?? [];
  if (!kept && !error) return <p className="small muted">主题加载中…</p>;
  if (!kept && error) {
    return (
      <p className="small error-text">
        主题加载失败。
        <button type="button" className="btn btn-quiet" onClick={reload}>
          重试
        </button>
      </p>
    );
  }
  if (!themes.length) {
    return (
      <p className="small muted">
        还没有主题。
        <Link href="/themes/new" target="_blank" rel="noopener">
          新建主题
        </Link>
      </p>
    );
  }
  return (
    <div className="up-themes" role="group" aria-label="加入主题">
      {themes.map((t) => {
        const on = value.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            className="chip chip-outline up-theme"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}
          >
            <span>{t.title}</span>
            <span className="small up-theme-kind">{t.kind === 'trip' ? '旅程' : '专题'}</span>
          </button>
        );
      })}
    </div>
  );
}

interface Props {
  item: Item;
  all: Item[];
  onPatch: (id: string, patch: Partial<Item>) => void;
  onPublish: (id: string) => void;
  onApplyRest: (id: string) => void;
  unpublishedOthers: number;
}

/** Right column: title, note, tags, privacy, themes, and the publish button. */
export default function UploadDetails({ item, all, onPatch, onPublish, onApplyRest, unpublishedOthers }: Props) {
  const status = statusOf(item, all);
  const ready = item.stage === 'ready' && !!item.p;
  const locked = item.publish.state === 'sending' || item.publish.state === 'done' || item.publish.state === 'duplicate';
  const tags = tagState(item, all);
  const zone = item.match?.res?.privacyZone ?? null;
  const unplaced = ready && (status.key === 'review' || status.key === 'nogps');

  return (
    <div className="up-panel stack" style={{ ['--gap' as string]: '20px' }}>
      <h2 className="up-h serif">整理</h2>
      {!ready && <p className="muted small">照片处理完成后可以填写。</p>}
      {ready && (
        <>
          <PhotoFields
            value={item}
            onChange={(patch) => onPatch(item.id, 'geoPrivacy' in patch ? { ...patch, geoTouched: true } : patch)}
            tags={{ value: tags.value, suggested: tags.suggested, onChange: (ids) => onPatch(item.id, tagPatch(item, all, ids)) }}
            geoLocked={zone ? `在隐私区域「${zone}」内，位置固定为隐藏` : null}
            disabled={locked}
          />

          <div className="field">
            <span className="label">加入主题</span>
            <ThemePicker value={item.themeIds} onChange={(ids) => onPatch(item.id, { themeIds: ids })} disabled={locked} />
          </div>

          <div className="up-publish">
            {item.publish.state === 'sending' && (
              <div
                className="up-progress"
                role="progressbar"
                aria-label="上传进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(item.publish.progress * 100)}
              >
                <span style={{ width: `${Math.round(item.publish.progress * 100)}%` }} />
              </div>
            )}
            {item.publish.state === 'failed' && (
              <p className="error-text" role="alert">
                {item.publish.error}
              </p>
            )}
            {item.publish.state === 'done' && item.publish.photoId && (
              <p role="status">
                已发布。<Link href={`/p/${item.publish.photoId}`}>查看照片</Link> ·{' '}
                <Link href={`/studio/photo/${item.publish.photoId}`}>继续编辑</Link>
              </p>
            )}
            {item.publish.state === 'duplicate' && (
              <p role="status">
                你已经上传过这张照片，已跳过。
                {item.publish.photoId && (
                  <>
                    {' '}
                    <Link href={`/p/${item.publish.photoId}`}>查看已有的</Link>
                  </>
                )}
              </p>
            )}
            {unplaced && item.publish.state !== 'sending' && <p className="small muted">还没有选择地点，发布后这张照片不会关联地点。</p>}

            {item.publish.state !== 'done' && item.publish.state !== 'duplicate' && (
              <button
                type="button"
                className="btn btn-primary up-publish-btn"
                disabled={!canPublish(item, all)}
                onClick={() => onPublish(item.id)}
              >
                {item.publish.state === 'sending'
                  ? `发布中 ${Math.round(item.publish.progress * 100)}%`
                  : item.publish.state === 'failed'
                    ? '重试发布'
                    : '发布'}
              </button>
            )}
            {!locked && unpublishedOthers > 0 && (
              <button type="button" className="btn btn-quiet" onClick={() => onApplyRest(item.id)}>
                把公开范围、位置精度、Living、收藏和主题套用到其余 {unpublishedOthers} 张
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
