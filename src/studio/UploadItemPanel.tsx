import type { Poi } from '../../shared/types';
import ExifList from './ExifList';
import PlacePicker from './PlacePicker';
import type { PlaceChoice } from './match';
import { customAtFor, coordsOf, placeOf, type Item } from './upload-model';
import { StatusChip } from './UploadQueue';
import { fmtBytes, useObjectUrl } from './util';

interface Props {
  item: Item;
  all: Item[];
  extras: Poi[];
  onCreated: (poi: Poi) => void;
  onPlace: (id: string, choice: PlaceChoice | null) => void;
  onRadius: (id: string, radius: number) => void;
  onRetryMatch: (id: string) => void;
  onRetryProcess: (id: string) => void;
}

/** Middle column: the photo, what the file knows about itself, and the place chooser. */
export default function UploadItemPanel({ item, all, extras, onCreated, onPlace, onRadius, onRetryMatch, onRetryProcess }: Props) {
  const preview = useObjectUrl(item.p?.variants.m.blob);
  const place = placeOf(item, all);
  const coords = coordsOf(item);
  const busy = item.publish.state === 'sending' || item.publish.state === 'done' || item.publish.state === 'duplicate';

  return (
    <div className="up-panel stack" style={{ ['--gap' as string]: '18px' }}>
      <div className="up-panel-head">
        <h2 className="up-h serif">{item.file.name}</h2>
        <StatusChip item={item} all={all} />
      </div>

      {item.stage === 'error' && (
        <div className="notice up-fail" role="alert">
          <p className="error-text">{item.error}</p>
          <button type="button" className="btn btn-quiet" onClick={() => onRetryProcess(item.id)}>
            重试
          </button>
        </div>
      )}
      {(item.stage === 'queued' || item.stage === 'processing') && (
        <p className="muted up-wait" role="status">
          {item.stage === 'queued' ? '排队中，前面的照片处理完就轮到它。' : '正在读取信息并生成三种尺寸…'}
        </p>
      )}

      {item.stage === 'ready' && item.p && (
        <>
          <figure className="up-figure">
            <div className="up-preview" style={{ aspectRatio: `${item.p.width} / ${item.p.height}` }}>
              {preview && <img src={preview} alt={`${item.file.name} 的预览`} />}
            </div>
            {item.p.palette.length > 0 && (
              <div className="up-palette" aria-label="主色">
                {item.p.palette.map((c) => (
                  <span key={c} style={{ background: c }} title={c} />
                ))}
              </div>
            )}
          </figure>

          <ExifList x={{ ...item.p.exif, width: item.p.width, height: item.p.height, bytes: item.file.size }} />
          {item.publish.state !== 'done' && (
            <p className="small muted up-variants">
              已生成{' '}
              {(['s', 'm', 'l'] as const)
                .map((k) => `${item.p!.variants[k].w}×${item.p!.variants[k].h}（${fmtBytes(item.p!.variants[k].blob.size)}）`)
                .join(' · ')}
              ，不含 EXIF。
            </p>
          )}

          <section className="up-section" aria-label="地点">
            <h3 className="up-sub serif">地点</h3>
            <PlacePicker
              key={item.id}
              coords={coords}
              heading={item.p.exif.heading}
              match={item.match}
              onRadius={(r) => onRadius(item.id, r)}
              onRetry={() => onRetryMatch(item.id)}
              value={place}
              onChange={(c) => onPlace(item.id, c)}
              extras={extras}
              onCreated={onCreated}
              customAt={customAtFor(item, all)}
              privacyZone={item.match?.res?.privacyZone ?? null}
              disabled={busy}
            />
          </section>
          {!coords && place == null && !item.p.exif.takenAt && (
            <p className="small muted">这张照片既没有位置也没有拍摄时间，没法按时间推断，请搜索地点。</p>
          )}
        </>
      )}
    </div>
  );
}
