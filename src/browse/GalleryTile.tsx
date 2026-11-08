import { memo } from 'react';
import { Link } from 'wouter';
import type { PhotoSummary, Poi } from '../../shared/types';
import Img from '../components/Img';
import { CategoryIcon } from '../components/icons';
import { fmtDay } from '../lib/format';

/** Masonry tile: the photo at its own ratio; under it the place symbol and name, or the city in muted ink. */
const GalleryTile = memo(function GalleryTile({ photo, poi }: { photo: PhotoSummary; poi: Poi | undefined }) {
  const place = poi?.name ?? photo.city ?? '';
  const label = [photo.title, place, fmtDay(photo.takenAt)].filter(Boolean).join(' · ') || '照片';
  return (
    <Link href={`/p/${photo.id}`} className="gal-tile" aria-label={label}>
      <Img photo={photo} alt="" />
      {place && (
        <span className="gal-cap" data-muted={poi ? undefined : 'true'}>
          {poi && <CategoryIcon category={poi.category} />}
          <span>{place}</span>
        </span>
      )}
    </Link>
  );
});

export default GalleryTile;
