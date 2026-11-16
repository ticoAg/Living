import { Link, useSearchParams } from 'wouter';
import type { ThemeSummary } from '../../shared/types';
import { Icon } from '../components/icons';
import { useApi } from '../lib/useApi';
import { useSession } from '../lib/session';
import ThemeCard from '../themes/ThemeCard';
import { useDocumentTitle, useScrollTop } from '../themes/hooks';
import '../styles/themes.css';

function Skeleton() {
  return (
    <ul className="th-grid" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="th-skel">
          <span className="th-skel-cover" />
          <span className="th-skel-line" />
          <span className="th-skel-line" style={{ width: '45%' }} />
        </li>
      ))}
    </ul>
  );
}

export default function Themes() {
  const { user, loading: sessionLoading } = useSession();
  const [params] = useSearchParams();
  const wantMine = params.get('mine') === '1';
  const path = wantMine ? (user ? '/api/themes?mine=1' : null) : '/api/themes';
  const { data, error, reload } = useApi<{ themes: ThemeSummary[] }>(path);
  useDocumentTitle('合集');
  useScrollTop();

  const waiting = wantMine && sessionLoading;
  const needLogin = wantMine && !sessionLoading && !user;
  const themes = data?.themes;

  let body;
  if (needLogin) {
    body = (
      <div className="th-empty">
        <p className="th-empty-title">登录后查看自己的合集</p>
        <Link href="/login" className="btn btn-primary">
          登录
        </Link>
      </div>
    );
  } else if (waiting || (!themes && !error)) {
    body = <Skeleton />;
  } else if (error || !themes) {
    body = (
      <div className="th-empty" role="alert">
        <p className="th-empty-title">合集加载失败</p>
        <p className="muted">请检查网络后重试。</p>
        <button type="button" className="btn" onClick={reload}>
          重试
        </button>
      </div>
    );
  } else if (themes.length === 0) {
    body = (
      <div className="th-empty">
        <p className="th-empty-title">{wantMine ? '你还没有合集' : '还没有公开的合集'}</p>
        <p className="muted">
          {wantMine ? '把照片和记录编成一次旅程或一个专题。' : user ? '把你的照片和记录编成第一个合集。' : '登录后可以创建自己的合集。'}
        </p>
        {user && (
          <Link href="/themes/new" className="btn btn-primary">
            <Icon name="plus" size={18} />
            新建合集
          </Link>
        )}
      </div>
    );
  } else {
    body = (
      <ul className="th-grid">
        {themes.map((t) => (
          <li key={t.id}>
            <ThemeCard theme={t} own={t.ownerId === user?.id} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main className="th-page">
      <div className="th-head">
        <h1 className="display display-l">合集</h1>
        {user && (
          <Link href="/themes/new" className="btn btn-primary">
            <Icon name="plus" size={18} />
            新建合集
          </Link>
        )}
      </div>
      <div className="th-tabs-row">
        <nav className="th-tabs" aria-label="合集范围">
          <Link href="/themes" className="th-tab" aria-current={!wantMine ? 'page' : undefined}>
            全部
          </Link>
          {(user || wantMine) && (
            <Link href="/themes?mine=1" className="th-tab" aria-current={wantMine ? 'page' : undefined}>
              我的
            </Link>
          )}
        </nav>
        {themes && !error && themes.length > 0 && (
          <span className="th-count">
            共 <b className="mono">{themes.length}</b> 个
          </span>
        )}
      </div>
      {body}
    </main>
  );
}
