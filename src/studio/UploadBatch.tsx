import { Icon } from '../components/icons';
import { GEO, SegRow, VISIBILITY } from './PhotoFields';
import { applyTagEdit, commonTags } from './tag-board';
import TagPicker from './TagPicker';
import ThemePicker from './ThemePicker';
import { inBulk, isEditable, type Item } from './upload-model';

// The right column while several photos are selected in the queue: their tags, visibility, location precision and
// themes edited together, and one button that publishes them. A tag or theme only some of them have is drawn
// half-on; clicking it gives it to all. Photos already sent are shown but not changed.
// Docs: /docs/product/features/upload.md#一起整理

interface Props {
  /** the selected photos, in queue order */
  items: Item[];
  /** applies a change to every selected photo that can still be edited */
  onEdit: (fn: (it: Item) => Partial<Item>) => void;
  onPublish: () => void;
  onClear: () => void;
  /** show one of them in the middle column */
  onShow: (id: string) => void;
  shownId: string | null;
  bulk: { done: number; total: number } | null;
}

/** The one value they all share, or null when they differ. */
function shared<T>(values: readonly T[]): T | null {
  return values.length && values.every((v) => v === values[0]) ? values[0] : null;
}

export default function UploadBatch({ items, onEdit, onPublish, onClear, onShow, shownId, bulk }: Props) {
  const open = items.filter(isEditable);
  const tags = commonTags(open.map((it) => it.tags));
  const themes = commonTags(open.map((it) => it.themeIds));
  const zoned = open.filter((it) => it.match?.res?.privacyZone);
  const free = open.filter((it) => !it.match?.res?.privacyZone);
  const sendable = items.filter(inBulk).length;
  const none = open.length === 0;

  return (
    <div className="up-panel up-details up-batch">
      <div className="up-panel-head">
        <h2 className="up-h up-name">已选 {items.length} 张</h2>
        <button type="button" className="btn btn-quiet up-batch-clear" onClick={onClear}>
          取消选择
        </button>
      </div>

      <ul className="up-batch-strip" aria-label="已选的照片">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              className="up-batch-thumb"
              aria-current={it.id === shownId ? 'true' : undefined}
              data-locked={!isEditable(it) || undefined}
              title={it.file.name}
              onClick={() => onShow(it.id)}
            >
              {it.thumbUrl ? <img src={it.thumbUrl} alt={it.file.name} /> : <Icon name="upload" size={16} />}
              {it.publish.state === 'done' && <Icon name="check" size={14} className="up-batch-done" />}
            </button>
          </li>
        ))}
      </ul>

      <div className="up-form pf">
        <div className="pf-row pf-top">
          <span className="pf-k">标签</span>
          <div className="pf-v">
            <TagPicker
              value={tags.all}
              mixed={tags.some}
              onEdit={(e) => onEdit((it) => ({ tags: applyTagEdit(it.tags, e) }))}
              disabled={none}
            />
          </div>
        </div>
        <SegRow
          label="公开"
          value={shared(open.map((it) => it.visibility))}
          options={VISIBILITY}
          onChange={(v) => onEdit(() => ({ visibility: v }))}
          disabled={none}
        />
        <SegRow
          label="位置"
          value={shared(free.map((it) => it.geoPrivacy))}
          options={GEO}
          onChange={(v) => onEdit((it) => (it.match?.res?.privacyZone ? {} : { geoPrivacy: v, geoTouched: true }))}
          disabled={free.length === 0}
          note={zoned.length ? `${zoned.length} 张在隐私区域内，保持隐藏` : undefined}
        />
        <div className="pf-row pf-top">
          <span className="pf-k">主题</span>
          <div className="pf-v">
            <ThemePicker
              value={themes.all}
              mixed={themes.some}
              onToggle={(id, on) =>
                onEdit((it) => ({
                  themeIds: on ? (it.themeIds.includes(id) ? it.themeIds : [...it.themeIds, id]) : it.themeIds.filter((x) => x !== id)
                }))
              }
              disabled={none}
            />
          </div>
        </div>
      </div>

      <div className="up-publish">
        <button type="button" className="btn btn-primary up-publish-btn" disabled={!!bulk || sendable === 0} onClick={onPublish}>
          {bulk ? `发布中 ${bulk.done} / ${bulk.total}` : `发布所选（${sendable}）`}
        </button>
      </div>
    </div>
  );
}
