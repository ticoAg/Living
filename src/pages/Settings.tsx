import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { startScroll } from '../lib/scroll';
import { useSession } from '../lib/session';
import { PageHead } from '../studio/ui';
import AdminSection from '../studio/settings/AdminSection';
import ExportSection from '../studio/settings/ExportSection';
import ImportSection from '../studio/settings/ImportSection';
import PasswordSection from '../studio/settings/PasswordSection';
import PhotoDefaultsSection from '../studio/settings/PhotoDefaultsSection';
import ProfileSection from '../studio/settings/ProfileSection';
import SharesSection from '../studio/settings/SharesSection';
import ZonesSection from '../studio/settings/ZonesSection';
import { useRequireLogin, useTitle } from '../studio/util';
import '../styles/studio.css';

// /settings — profile, password, new photos' visibility, privacy zones, share links, export; site administration for
// the owner and admins.
// Docs: /docs/product/features/accounts.md, privacy.md, export.md, admin.md

const ROLE: Record<string, string> = { owner: '站长', admin: '管理员', member: '成员' };

export default function Settings() {
  useTitle('设置');
  const { ready } = useRequireLogin();
  const { user, logout } = useSession();
  const [, navigate] = useLocation();
  const shown = ready && !!user;

  // the sections render once the session is known, so a link such as /settings#photos is taken to its section here
  useEffect(() => {
    if (!shown) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    if (target) target.scrollIntoView();
    else startScroll();
  }, [shown]);

  if (!shown) return <p className="loading">加载中</p>;
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
        <a href="#photos">新照片</a>
        <a href="#privacy">隐私区域</a>
        <a href="#shares">分享链接</a>
        <a href="#export">导出</a>
        <a href="#import">导入</a>
        {staff && <a href="#admin">站点管理</a>}
      </nav>

      <div className="se-stack">
        <ProfileSection user={user} />
        <PasswordSection />
        <PhotoDefaultsSection user={user} />
        <ZonesSection />
        <SharesSection />
        <ExportSection user={user} />
        <ImportSection />
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
