import EntryShelf from '../browse/EntryShelf';
import Gallery from '../browse/Gallery';
import { useScrollTop } from '../browse/hooks';
import LibraryTabs from '../browse/LibraryTabs';
import { replaceQuery, useQuery } from '../browse/url';
import '../styles/browse.css';

// Home: everyone's public photos, or (?layer=entries) everyone's public entries. Filters, sort and the Living link live
// in each layer. Docs: /docs/product/features/gallery.md
export default function Explore() {
  useScrollTop(null);
  const entries = useQuery().get('layer') === 'entries';
  // what one layer filters by means nothing to the other
  const layers = (
    <div className="seg gal-layers" role="group" aria-label="图层">
      <button type="button" aria-pressed={!entries} onClick={() => replaceQuery({ layer: null, type: null })}>
        照片
      </button>
      <button type="button" aria-pressed={entries} onClick={() => replaceQuery({ layer: 'entries', tags: null, city: null })}>
        记录
      </button>
    </div>
  );
  return (
    <main className="page bw">
      <h1 className="visually-hidden">图库</h1>
      <LibraryTabs />
      {entries ? <EntryShelf lead={layers} /> : <Gallery lead={layers} />}
    </main>
  );
}
