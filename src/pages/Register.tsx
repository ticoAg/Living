import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import type { SessionUser } from '../../shared/types';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { encodeNext, errMsg, safeNext, useTitle } from '../studio/util';
import '../styles/studio.css';

// /register — invite code (when the site wants one), handle, display name, password.
// Docs: /docs/api/auth.md, /docs/product/features/accounts.md

const HANDLE_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,23}$/;

export default function Register() {
  useTitle('注册');
  const { user, site, refresh } = useSession();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const next = safeNext(params.get('next'));

  const [invite, setInvite] = useState((params.get('invite') ?? '').toUpperCase());
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !busy) navigate(next ?? `/@${user.handle}`, { replace: true });
  }, [user, busy, next, navigate]);

  const setup = !!site?.needsSetup;
  const closed = site?.registration === 'closed' && !setup;
  const needInvite = setup || site?.registration === 'invite';
  const openMode = site?.registration === 'open' && !setup;

  function problem(): string | null {
    if (needInvite && !invite.trim()) return setup ? '请输入站长邀请码' : '注册需要邀请码，请向站长或管理员索取';
    if (!HANDLE_RE.test(handle.trim())) return '用户名需要 3 到 24 个字符，只能包含字母、数字、下划线和连字符，并以字母或数字开头';
    if (!displayName.trim() || [...displayName.trim()].length > 40) return '显示名需要 1 到 40 个字符';
    if (password.length < 8) return '密码至少需要 8 个字符';
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const bad = problem();
    if (bad) {
      setError(bad);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: SessionUser }>('/api/auth/register', {
        json: { invite: invite.trim() || undefined, handle: handle.trim(), displayName: displayName.trim(), password }
      });
      await refresh();
      navigate(next ?? `/@${res.user.handle}`, { replace: true });
    } catch (err) {
      setError(errMsg(err, '注册失败，请稍后再试'));
      setBusy(false);
    }
  }

  const loginHref = next ? `/login?next=${encodeNext(next)}` : '/login';

  return (
    <main className="page-narrow au">
      <div className="au-card">
        <h1 className="display display-m au-title">注册</h1>

        {setup && (
          <p className="notice au-note" role="status">
            站点还没有任何账号。第一个注册的账号会成为<strong>站长</strong>，需要部署时写入的站长邀请码。
          </p>
        )}
        {closed && (
          <p className="notice au-note" role="status">
            站点暂不开放注册。已有账号请<Link href={loginHref}>登录</Link>。
          </p>
        )}
        {!setup && !closed && site?.registration === 'invite' && (
          <p className="small muted au-note">注册需要邀请码，请向站长或管理员索取。</p>
        )}
        {openMode && <p className="small muted au-note">任何人都可以注册。有邀请码的话也可以填写。</p>}

        <form className="stack" style={{ ['--gap' as string]: '20px' }} onSubmit={submit} noValidate>
          {(needInvite || openMode || !site) && (
            <div className="field">
              <label className="label" htmlFor="au-invite">
                邀请码{needInvite ? '' : '（可不填）'}
              </label>
              <input
                id="au-invite"
                className="input mono au-invite"
                value={invite}
                onChange={(e) => setInvite(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={32}
                disabled={closed}
                aria-required={needInvite}
              />
            </div>
          )}
          <div className="field">
            <label className="label" htmlFor="au-handle">
              用户名
            </label>
            <input
              id="au-handle"
              className="input"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={24}
              disabled={closed}
              aria-describedby="au-handle-hint"
            />
            <span id="au-handle-hint" className="small muted">
              3–24 位，字母、数字、下划线、连字符。你的主页是 /@{handle.trim() || '用户名'}
            </span>
          </div>
          <div className="field">
            <label className="label" htmlFor="au-name">
              显示名
            </label>
            <input
              id="au-name"
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="nickname"
              maxLength={40}
              disabled={closed}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="au-password">
              密码
            </label>
            <div className="au-pw">
              <input
                id="au-password"
                className="input"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                maxLength={256}
                disabled={closed}
                aria-describedby="au-pw-hint"
              />
              <button type="button" className="btn btn-quiet au-pw-toggle" aria-pressed={show} onClick={() => setShow((s) => !s)}>
                {show ? '隐藏' : '显示'}
              </button>
            </div>
            <span id="au-pw-hint" className="small muted">
              至少 8 位。
            </span>
          </div>
          <div className="au-status" role="alert" aria-live="assertive">
            {error && <p className="error-text">{error}</p>}
          </div>
          <button type="submit" className="btn btn-primary au-submit" disabled={busy || closed}>
            {busy ? '注册中…' : setup ? '创建站长账号' : '注册'}
          </button>
        </form>

        <p className="au-alt small muted">
          已有账号？<Link href={loginHref}>登录</Link>
        </p>
      </div>
    </main>
  );
}
