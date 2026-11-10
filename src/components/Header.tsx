import { Link, useLocation } from 'wouter';
import { useSession } from '../lib/session';
import { Icon } from './icons';

const NAV = [
  { href: '/', label: '图库', match: (p: string) => p === '/' || p.startsWith('/p/') },
  { href: '/themes', label: '主题', match: (p: string) => p.startsWith('/themes') || p.startsWith('/t/') },
  { href: '/map', label: '地图', match: (p: string) => p.startsWith('/map') || p.startsWith('/place/') },
  { href: '/index', label: '索引', match: (p: string) => p.startsWith('/index') }
];

export default function Header() {
  const [path, navigate] = useLocation();
  const { user, expired, askLogin, logout } = useSession();
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="wordmark">
          LIVING
        </Link>
        <nav aria-label="主导航" className="site-nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="nav-link" aria-current={n.match(path) ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
          {user && !expired ? (
            <>
              <Link href="/upload" className="btn btn-quiet btn-icon" aria-label="上传" style={{ marginLeft: 8 }}>
                <Icon name="upload" size={18} />
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
        </nav>
      </div>
    </header>
  );
}
