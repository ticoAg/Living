import { memo } from 'react';
import { Link } from 'wouter';
import type { PhotoSummary } from '../../shared/types';
import Img from '../components/Img';
import { fmtDay } from '../lib/format';

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
