import { Link } from 'wouter';
import PhotoFields from './PhotoFields';
import ThemePicker from './ThemePicker';
import { statusOf, canPublish, isLocked, type Item } from './upload-model';

interface Props {
  item: Item;
  all: Item[];
  onPatch: (id: string, patch: Partial<Item>) => void;
  onPublish: (id: string) => void;
}

/** Right column for one photo: title, note, tags, privacy and themes, with the publish bar pinned to its foot. */
export default function UploadDetails({ item, all, onPatch, onPublish }: Props) {
  const status = statusOf(item, all);
  const ready = item.stage === 'ready' && !!item.p;
  // the form opens while the file is still being read; only publishing waits for it
  const open = item.stage !== 'error';
  const locked = isLocked(item);
  const zone = item.match?.res?.privacyZone ?? null;
  const unplaced = ready && (status.key === 'review' || status.key === 'nogps');

  return (
    <div className="up-panel up-details">
      {!open && <p className="muted small">这张不会发布。</p>}
      {open && (
        <>
          <div className="up-form">
            <PhotoFields
              value={item}
              onChange={(patch) => onPatch(item.id, 'geoPrivacy' in patch ? { ...patch, geoTouched: true } : patch)}
              tags={{ value: item.tags, onChange: (ids) => onPatch(item.id, { tags: ids }) }}
              geoLocked={zone ? `在隐私区域「${zone}」内，位置固定为隐藏` : null}
              toggles={false}
              disabled={locked}
            />
            <div className="pf-row pf-top">
              <span className="pf-k">主题</span>
              <div className="pf-v">
                <ThemePicker
                  value={item.themeIds}
                  onToggle={(id, on) => onPatch(item.id, { themeIds: on ? [...item.themeIds, id] : item.themeIds.filter((x) => x !== id) })}
                  disabled={locked}
                />
              </div>
            </div>
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
            {unplaced && item.publish.state !== 'sending' && <p className="small muted">没有地点，发布后不关联地点。</p>}

            {item.publish.state !== 'done' && item.publish.state !== 'duplicate' && (
              <button
                type="button"
                className="btn btn-primary up-publish-btn"
                disabled={!canPublish(item, all)}
                onClick={() => onPublish(item.id)}
              >
                {!ready
                  ? '处理中…'
                  : item.publish.state === 'sending'
                    ? `发布中 ${Math.round(item.publish.progress * 100)}%`
                    : item.publish.state === 'failed'
                      ? '重试发布'
                      : '发布'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
