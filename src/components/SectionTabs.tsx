import { Link, useLocation } from 'wouter';
import { useSession } from '../lib/session';

// The pages of one section of the main navigation, as tabs at the top of each: the library (photos, map, index), the
// archive (timeline, projects). Only for someone signed in: a visitor's navigation has no such sections.

export default function SectionTabs({
  label,
  tabs,
  className
}: {
  label: string;
  tabs: readonly { href: string; label: string }[];
  className?: string;
}) {
  const [path] = useLocation();
  const { user, expired } = useSession();
  if (!user || expired) return null;
  return (
    <nav aria-label={label} className={className ? `lib-tabs ${className}` : 'lib-tabs'}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="lib-tab" aria-current={path === t.href ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
