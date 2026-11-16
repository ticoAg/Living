import { Link, useLocation } from 'wouter';
import { useSession } from '../lib/session';
import CaptureButton from './CaptureButton';
import { Icon, type IconName } from './icons';

interface NavItem {
  href: string;
  label: string;
  /** shows on phones only, where the sections are a tab bar at the foot of the screen (base.css) */
  icon: IconName;
  match: (p: string) => boolean;
}

const themes: NavItem = { href: '/themes', label: '主题', icon: 'book', match: (p) => p.startsWith('/themes') || p.startsWith('/t/') };

// A visitor browses the public photos.
const GUEST_NAV: NavItem[] = [
  { href: '/', label: '图库', icon: 'grid', match: (p) => p === '/' || p.startsWith('/p/') },
  themes,
  { href: '/map', label: '地图', icon: 'map', match: (p) => p.startsWith('/map') || p.startsWith('/place/') },
  { href: '/index', label: '索引', icon: 'list', match: (p) => p.startsWith('/index') }
];

// Someone signed in keeps an archive: the day, then everything kept; the photos, map and index are one library
// (browse/LibraryTabs.tsx). Docs: /docs/architecture/frontend.md#导航
const MEMBER_NAV: NavItem[] = [
  { href: '/today', label: '今天', icon: 'today', match: (p) => p.startsWith('/today') || p.startsWith('/entries/') },
  { href: '/archive', label: '档案', icon: 'archive', match: (p) => p.startsWith('/archive') || p.startsWith('/e/') },
  {
    href: '/',
    label: '图库',
    icon: 'grid',
    match: (p) => p === '/' || ['/p/', '/map', '/place/', '/index'].some((s) => p.startsWith(s))
  },
  themes
];

export default function Header() {
  const [path, navigate] = useLocation();
  const { user, expired, askLogin, logout } = useSession();
  const signedIn = !!user && !expired;
  const nav = signedIn ? MEMBER_NAV : GUEST_NAV;
  // on phones the camera button sits in the middle of the bar, between the two halves
  const half = nav.length / 2;
  const link = (n: NavItem) => (
    <Link key={n.href} href={n.href} className="nav-link" aria-current={n.match(path) ? 'page' : undefined}>
      <Icon name={n.icon} size={22} />
      {n.label}
    </Link>
  );
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="wordmark">
          LIVING
        </Link>
        {/* on phones the nav becomes a bar fixed to the foot of the screen; the account actions stay up here */}
        <nav aria-label="主导航" className="site-nav">
          {nav.slice(0, half).map(link)}
          {signedIn && <CaptureButton />}
          {nav.slice(half).map(link)}
        </nav>
        <div className="site-bar">
          {signedIn ? (
            <>
              <Link href="/upload" className="btn btn-primary site-upload" aria-label="上传">
                <Icon name="upload" size={18} />
                <span aria-hidden="true">上传</span>
              </Link>
              <details className="user-menu">
                <summary className="btn btn-ghost btn-icon" aria-label={`${user.displayName} 的菜单`}>
                  <Icon name="user" size={18} />
                </summary>
                <div
                  className="user-menu-panel"
                  onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}
                >
                  <Link href={`/@${user.handle}`}>我的主页</Link>
                  <Link href="/themes?mine=1">我的主题</Link>
                  <Link href="/studio/tags">标签</Link>
                  <Link href="/settings">设置</Link>
                  <button
                    type="button"
                    onClick={async () => {
                      await logout();
                      navigate('/');
                    }}
                  >
                    退出
                  </button>
                </div>
              </details>
            </>
          ) : (
            <Link
              href="/login"
              className="nav-link"
              onClick={(e) => {
                // an expired session signs in on top of the page, so nothing open there is lost
                if (expired) {
                  e.preventDefault();
                  askLogin();
                }
              }}
            >
              登录
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
