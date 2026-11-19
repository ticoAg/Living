import { Link } from 'wouter';
import { entryLabel, entryTypeLabel } from '../../shared/entries';
import type { EntrySummary, PhotoSummary } from '../../shared/types';
import { posterUrl } from '../attachments/kinds';
import Img from '../components/Img';
import { entryHref } from '../entries/EntryCard';
import Markdown from '../entries/Markdown';
import { fmtDay } from '../lib/format';
import { VISIBILITY_LABEL } from '../themes/util';

interface Props {
  entry: EntrySummary;
  /** the photos asked for by id; undefined while they load, so a work with photos waits instead of showing its text */
  photos: ReadonlyMap<string, PhotoSummary> | undefined;
  /** who can see it, for the author's own pages */
  own?: boolean;
  sizes: string;
}

/** A work in a grid: its first photo the viewer may see, else a video's frame, else the start of its text; its name and day below. */
export default function WorkTile({ entry: e, photos, own, sizes }: Props) {
  const label = entryLabel(e.title, e.excerpt) || entryTypeLabel(e.type);
  const first = e.photoIds[0];
  const cover = first ? photos?.get(first) : undefined;
  const waiting = !!first && !photos;
  const film = cover || waiting ? undefined : e.attachments.find((a) => a.poster);
  const mark = own && e.visibility !== 'public' ? `${VISIBILITY_LABEL[e.visibility]}可见` : '';
  return (
    <Link href={entryHref(e)} className="sc-work" aria-label={[label, fmtDay(e.occurredAt), mark].filter(Boolean).join('，')}>
      {cover ? (
        <Img photo={cover} ratio="4 / 5" sizes={sizes} alt="" />
      ) : film ? (
        <span className="sc-work-film">
          <img src={posterUrl(film.id)} alt="" loading="lazy" decoding="async" />
        </span>
      ) : (
        <span className="sc-work-text" aria-hidden="true">
          {!waiting && e.excerpt && <Markdown text={e.excerpt} compact />}
        </span>
      )}
      <span className="sc-work-title">{label}</span>
      <span className="sc-work-meta">
        <span className="mono">{fmtDay(e.occurredAt)}</span>
        {mark && <em>{mark}</em>}
      </span>
    </Link>
  );
}
