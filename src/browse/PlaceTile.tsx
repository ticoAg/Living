import { memo } from 'react';
import { Link } from 'wouter';
import type { PhotoSummary } from '../../shared/types';
import Img from '../components/Img';
import { fmtDay } from '../lib/format';
import type { MasonryItem } from './columns';

// below the picture: the 10px flex gap, the 19px title row, and the 18px owner row after a 2px gap (.plc-cap in browse.css)
const CAPTION = 10 + 19;
const OWNER = 2 + 18;

/** Size of a tile for the masonry layout, without measuring it. */
export function placeTileSize(photo: PhotoSummary, showOwner: boolean): MasonryItem {
  return { ratio: photo.width / photo.height, extra: CAPTION + (showOwner ? OWNER : 0) };
}

/** Masonry tile for a place page: title and date under the photo, `@owner` when several people shot here. */
const PlaceTile = memo(function PlaceTile({ photo, showOwner }: { photo: PhotoSummary; showOwner: boolean }) {
  const label = [photo.title, fmtDay(photo.takenAt), showOwner ? `@${photo.ownerHandle}` : ''].filter(Boolean).join(' · ') || '照片';
  return (
    <Link href={`/p/${photo.id}`} className="gal-tile" aria-label={label}>
      <Img photo={photo} alt="" />
      <span className="plc-cap">
        {photo.title && <span className="plc-cap-title">{photo.title}</span>}
        <span className="plc-cap-day mono">{fmtDay(photo.takenAt)}</span>
        {showOwner && <span className="plc-cap-owner mono">@{photo.ownerHandle}</span>}
      </span>
    </Link>
  );
});

export default PlaceTile;
