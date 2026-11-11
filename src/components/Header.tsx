import { Link, useLocation } from 'wouter';
import { useSession } from '../lib/session';
import CaptureButton from './CaptureButton';
import { Icon, type IconName } from './icons';

// `icon` shows on phones only, where the sections are a tab bar at the foot of the screen (base.css)
const NAV: { href: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { href: '/', label: '图库', icon: 'grid', match: (p) => p === '/' || p.startsWith('/p/') },
  { href: '/themes', label: '主题', icon: 'book', match: (p) => p.startsWith('/themes') || p.startsWith('/t/') },
  { href: '/map', label: '地图', icon: 'map', match: (p) => p.startsWith('/map') || p.startsWith('/place/') },
  { href: '/index', label: '索引', icon: 'list', match: (p) => p.startsWith('/index') }
];

/** On phones the camera button sits in the middle of the bar, between these two halves of NAV. */
const HALF = NAV.length / 2;

export default function Header() {
  const [path, navigate] = useLocation();
  const { user, expired, askLogin, logout } = useSession();
  const signedIn = !!user && !expired;
  const link = (n: (typeof NAV)[number]) => (
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
          {NAV.slice(0, HALF).map(link)}
          {signedIn && <CaptureButton />}
          {NAV.slice(HALF).map(link)}
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
