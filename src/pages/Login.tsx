import { useEffect } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useSession } from '../lib/session';
import LoginForm from '../studio/LoginForm';
import { encodeNext, safeNext, useTitle } from '../studio/util';
import '../styles/studio.css';

// /login — handle and password. After success go to ?next, else Today.
// Docs: /docs/api/auth.md

export default function Login() {
  useTitle('登录');
  const { user, site, expired } = useSession();
  const [, navigate] = useLocation();
  const search = useSearch();
  const next = safeNext(new URLSearchParams(search).get('next'));

  // Already signed in (or just signed in): leave. An expired session counts as signed out.
  useEffect(() => {
    if (user && !expired) navigate(next ?? '/today', { replace: true });
  }, [user, expired, next, navigate]);

  const registerHref = next ? `/register?next=${encodeNext(next)}` : '/register';

  return (
    <main className="page-narrow au">
      <div className="au-card">
        <h1 className="display display-m au-title">登录</h1>
        <LoginForm autoFocus onSignedIn={() => navigate(next ?? '/today', { replace: true })} />

        <p className="au-alt small muted">
          {site?.needsSetup ? (
            <>
              站点还没有账号。<Link href={registerHref}>用站长邀请码创建第一个账号</Link>
            </>
          ) : site?.registration === 'closed' ? (
            <>站点暂不开放注册。</>
          ) : (
            <>
              还没有账号？<Link href={registerHref}>注册</Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
