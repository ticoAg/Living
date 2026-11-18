import type { EntrySummary } from '../../shared/types';
import { usePhotoMap } from '../entries/api';
import { coverIds, WORK_STEP } from './showcase';
import WorkTile from './WorkTile';

const SIZES = '(max-width: 719px) 50vw, 25vw';

/** One run of works, with the photos of its covers asked for in one request. */
function Run({ works, own }: { works: readonly EntrySummary[]; own: boolean }) {
  const ids = coverIds(works);
  const { photos, byId, error } = usePhotoMap(ids.length ? `/api/photos?ids=${ids.join(',')}` : null);
  // a failed request leaves each work its text, like a cover the viewer may not see
  const ready = !ids.length || photos !== undefined || error !== undefined ? byId : undefined;
  return works.map((e) => (
    <li key={e.id}>
      <WorkTile entry={e} photos={ready} own={own} sizes={SIZES} />
    </li>
  ));
}

/** Works in a grid, in runs of WORK_STEP: showing more adds a run, and the runs already shown keep their request. */
export default function WorkGrid({ works, own }: { works: readonly EntrySummary[]; own: boolean }) {
  const runs: EntrySummary[][] = [];
  for (let i = 0; i < works.length; i += WORK_STEP) runs.push(works.slice(i, i + WORK_STEP));
  return (
    <ul className="sc-works">
      {runs.map((r, i) => (
        <Run key={i} works={r} own={own} />
      ))}
    </ul>
  );
}
