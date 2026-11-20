import SectionTabs from '../components/SectionTabs';

// For someone signed in, the photos, the map, the index and their own media library are one section of the site, 图库
// (the main navigation keeps 今天 and 档案 instead); these tabs move between them. A visitor has the first three in the
// main navigation, and no library.

const TABS = [
  { href: '/', label: '照片' },
  { href: '/map', label: '地图' },
  { href: '/index', label: '索引' },
  { href: '/library', label: '媒体库' }
];

export default function LibraryTabs({ className }: { className?: string }) {
  return <SectionTabs label="图库" tabs={TABS} className={className} />;
}
