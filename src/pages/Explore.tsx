import Gallery from '../browse/Gallery';
import { useScrollTop } from '../browse/hooks';
import LibraryTabs from '../browse/LibraryTabs';
import '../styles/browse.css';

// Home: everyone's public photos. Filters, sort and Living link live in the shared gallery.
export default function Explore() {
  useScrollTop(null);
  return (
    <main className="page bw">
      <h1 className="visually-hidden">图库</h1>
      <LibraryTabs />
      <Gallery />
    </main>
  );
}
