import { Link } from 'wouter';
import { entryLabel, entryTypeLabel, hasTime } from '../../shared/entries';
import type { EntrySummary, PhotoSummary, Tag } from '../../shared/types';
import { Icon } from '../components/icons';
import Img from '../components/Img';
import { fmtDay, fmtTime } from '../lib/format';
import { VISIBILITY_LABEL } from '../themes/util';
import Markdown from './Markdown';

// An entry in a list: its time, type and state, the start of its text and a few of its photos. The whole card is one
// link (compact Markdown has none of its own); drafts open in the editor, to be finished.

const THUMBS = 4;

interface Props {
  entry: EntrySummary;
  /** photos to draw its thumbnails from: the owner's list; ids not in it are counted, not drawn */
  photos?: ReadonlyMap<string, PhotoSummary>;
  tags?: ReadonlyMap<string, Tag>;
  /** the day too, for lists not grouped by day */
  withDay?: boolean;
  /** visibility and status marks, for the author's own lists */
  own?: boolean;
  /** the author's handle, for lists mixing several people's entries */
  by?: boolean;
  /** the place it happened; off where every entry is at the same one */
  place?: boolean;
}

export const entryHref = (e: Pick<EntrySummary, 'id' | 'status'>) => (e.status === 'draft' ? `/e/${e.id}/edit` : `/e/${e.id}`);

export default function EntryCard({ entry: e, photos, tags, withDay, own, by, place = true }: Props) {
  const label = entryLabel(e.title, e.excerpt) || entryTypeLabel(e.type);
  const shown = photos ? e.photoIds.map((id) => photos.get(id)).filter((p): p is PhotoSummary => !!p) : [];
  const thumbs = shown.slice(0, THUMBS);
  const more = e.photoIds.length - thumbs.length;
  const tagNames = tags ? e.tagIds.map((id) => tags.get(id)?.name).filter((n): n is string => !!n) : [];
  const when = [withDay ? fmtDay(e.occurredAt) : '', hasTime(e.occurredAt) ? fmtTime(e.occurredAt) : ''].filter(Boolean).join(' ');
  const marks = [
    e.type !== 'note' ? entryTypeLabel(e.type) : '',
    own && e.status === 'draft' ? '草稿' : '',
    own && e.status === 'archived' ? '已归档' : '',
    own ? `${VISIBILITY_LABEL[e.visibility]}${e.visibility === 'public' ? '' : '可见'}` : ''
  ].filter(Boolean);
  const where = place ? (e.poi?.name ?? '') : '';
  const who = by ? `@${e.ownerHandle}` : '';

  return (
    <Link
      href={entryHref(e)}
      className="en-card"
      data-status={e.status}
      aria-label={[label, who, when, where, ...marks, e.photoIds.length ? `${e.photoIds.length} 张照片` : ''].filter(Boolean).join('，')}
    >
      {(when || where || who || marks.length > 0) && (
        <span className="en-card-meta">
          {who && <span>{who}</span>}
          {when && <span className="mono">{when}</span>}
          {where && (
            <span className="en-card-place">
              <Icon name="pin" size={14} />
              {where}
            </span>
          )}
          {marks.map((m) => (
            <span key={m} className="en-mark" data-mark={m === '草稿' ? 'draft' : undefined}>
              {m}
            </span>
          ))}
        </span>
      )}
      {e.title && <span className="en-card-title">{e.title}</span>}
      {e.excerpt && <Markdown text={e.excerpt} compact className="en-card-text" />}
      {e.hasMore && <span className="en-card-more">……</span>}
      {(thumbs.length > 0 || more > 0) && (
        <span className="en-card-photos">
          {thumbs.map((p) => (
            <span key={p.id} className="en-card-thumb">
              <Img photo={p} ratio="1 / 1" sizes="96px" alt="" />
            </span>
          ))}
          {more > 0 && (
            <span className="en-card-count mono">
              {thumbs.length === 0 && <Icon name="image" size={16} />}
              {thumbs.length ? `+${more}` : more}
            </span>
          )}
        </span>
      )}
      {tagNames.length > 0 && (
        <span className="en-card-tags">
          {tagNames.map((n) => (
            <span key={n}>#{n}</span>
          ))}
        </span>
      )}
    </Link>
  );
}
