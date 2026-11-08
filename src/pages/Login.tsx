import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import type { SessionUser } from '../../shared/types';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { encodeNext, errMsg, safeNext, useTitle } from '../studio/util';
import '../styles/studio.css';

// /login — handle and password. After success go to ?next, else the account's own page.
// Docs: /docs/api/auth.md

export default function Login() {
  useTitle('登录');
  const { user, site, refresh } = useSession();
  const [, navigate] = useLocation();
  const search = useSearch();
  const next = safeNext(new URLSearchParams(search).get('next'));

  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in (or just signed in): leave.
  useEffect(() => {
    if (user) navigate(next ?? `/@${user.handle}`, { replace: true });
  }, [user, next, navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: SessionUser }>('/api/auth/login', { json: { handle: handle.trim(), password } });
      await refresh();
      navigate(next ?? `/@${res.user.handle}`, { replace: true });
    } catch (err) {
      setError(errMsg(err, '登录失败，请稍后再试'));
      setBusy(false);
    }
  }

  const registerHref = next ? `/register?next=${encodeNext(next)}` : '/register';

  return (
    <main className="page-narrow au">
      <div className="au-card">
        <h1 className="display display-m au-title">登录</h1>
        <form className="stack" style={{ ['--gap' as string]: '20px' }} onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="au-handle">用户名</label>
            <input id="au-handle" className="input" value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={24} required autoFocus />
          </div>
          <div className="field">
            <label className="label" htmlFor="au-password">密码</label>
            <div className="au-pw">
              <input id="au-password" className="input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" maxLength={256} required />
              <button type="button" className="btn btn-quiet au-pw-toggle" aria-pressed={show} onClick={() => setShow((s) => !s)}>
                {show ? '隐藏' : '显示'}
              </button>
            </div>
          </div>
          <div className="au-status" role="alert" aria-live="assertive">
            {error && <p className="error-text">{error}</p>}
          </div>
          <button type="submit" className="btn btn-primary au-submit" disabled={busy || !handle.trim() || !password}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>

        <p className="au-alt small muted">
          {site?.needsSetup ? (
            <>站点还没有账号。<Link href={registerHref}>用站长邀请码创建第一个账号</Link></>
          ) : site?.registration === 'closed' ? (
            <>站点暂不开放注册。</>
          ) : (
            <>还没有账号？<Link href={registerHref}>注册</Link></>
          )}
        </p>
      </div>
    </main>
  );
}
