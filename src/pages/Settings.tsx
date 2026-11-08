import { useLocation } from 'wouter';
import { useSession } from '../lib/session';
import { PageHead } from '../studio/ui';
import AdminSection from '../studio/settings/AdminSection';
import PasswordSection from '../studio/settings/PasswordSection';
import ProfileSection from '../studio/settings/ProfileSection';
import ZonesSection from '../studio/settings/ZonesSection';
import { useRequireLogin, useTitle } from '../studio/util';
import '../styles/studio.css';

// /settings — profile, password, privacy zones; site administration for the owner and admins.
// Docs: /docs/product/features/accounts.md, privacy.md, admin.md

const ROLE: Record<string, string> = { owner: '站长', admin: '管理员', member: '成员' };

export default function Settings() {
  useTitle('设置');
  const { ready } = useRequireLogin();
  const { user, logout } = useSession();
  const [, navigate] = useLocation();

  if (!ready || !user) return <p className="loading">加载中</p>;
  const staff = user.role === 'owner' || user.role === 'admin';

  return (
    <main className="page-narrow se">
      <PageHead
        title="设置"
        caption={
          <>
            @{user.handle} · {ROLE[user.role] ?? user.role}
          </>
        }
      />

      <nav className="se-nav" aria-label="设置分区">
        <a href="#profile">个人资料</a>
        <a href="#password">密码</a>
        <a href="#privacy">隐私区域</a>
        {staff && <a href="#admin">站点管理</a>}
      </nav>

      <div className="se-stack">
        <ProfileSection user={user} />
        <PasswordSection />
        <ZonesSection />
        {staff && <AdminSection user={user} />}
        <div className="se-out">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              // leave first, so the login guard does not bounce the guest back to /login?next=/settings
              navigate('/');
              void logout();
            }}
          >
            退出登录
          </button>
        </div>
      </div>
    </main>
  );
}
