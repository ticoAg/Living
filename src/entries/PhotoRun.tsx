import { useState } from 'react';
import { Link } from 'wouter';
import type { PhotoSummary } from '../../shared/types';
import Img from '../components/Img';
import { fmtTime } from '../lib/format';

// Photos of a day that no entry holds, as a row of squares. A long run shows its first few and opens in place.

const FOLDED = 11;

export default function PhotoRun({ photos, label }: { photos: readonly PhotoSummary[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const fold = !open && photos.length > FOLDED + 1;
  const shown = fold ? photos.slice(0, FOLDED) : photos;
  return (
    <ul className="en-run" aria-label={label ?? `${photos.length} 张照片`}>
      {shown.map((p) => (
        <li key={p.id}>
          <Link href={`/p/${p.id}`} className="en-run-cell" aria-label={p.title ?? (p.takenAt ? `${fmtTime(p.takenAt)} 的照片` : '照片')}>
            <Img photo={p} ratio="1 / 1" sizes="(max-width: 640px) 25vw, 120px" alt="" />
          </Link>
        </li>
      ))}
      {fold && (
        <li>
          <button
            type="button"
            className="en-run-cell en-run-more mono"
            onClick={() => setOpen(true)}
            aria-label={`再显示 ${photos.length - FOLDED} 张`}
          >
            +{photos.length - FOLDED}
          </button>
        </li>
      )}
    </ul>
  );
}
