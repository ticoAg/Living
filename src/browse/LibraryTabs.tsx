import { Link, useLocation } from 'wouter';
import { useSession } from '../lib/session';

// For someone signed in, the photos, the map and the index are one section of the site, 图库 (the main navigation
// keeps 今天 and 档案 instead); these tabs move between them. A visitor has all three in the main navigation.

const TABS = [
  { href: '/', label: '照片' },
  { href: '/map', label: '地图' },
  { href: '/index', label: '索引' }
];

export default function LibraryTabs({ className }: { className?: string }) {
  const [path] = useLocation();
  const { user, expired } = useSession();
  if (!user || expired) return null;
  return (
    <nav aria-label="图库" className={className ? `lib-tabs ${className}` : 'lib-tabs'}>
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className="lib-tab" aria-current={path === t.href ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
