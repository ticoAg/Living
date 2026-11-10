import { useId, useRef, useState, type FormEvent } from 'react';
import type { SessionUser } from '../../shared/types';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { errMsg } from './util';
import '../styles/studio.css';

// Handle and password, used by /login and by the sign-in dialog shown when a session has expired (components/ReLogin.tsx).
// Docs: /docs/api/auth.md

interface Props {
  initialHandle?: string;
  autoFocus?: boolean;
  /** Called once the session is refreshed. */
  onSignedIn: (user: SessionUser) => void;
}

export default function LoginForm({ initialHandle = '', autoFocus, onSignedIn }: Props) {
  const { refresh } = useSession();
  const id = useId();
  const [handle, setHandle] = useState(initialHandle);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: SessionUser }>('/api/auth/login', { json: { handle: handle.trim(), password } });
      await refresh();
      onSignedIn(res.user);
    } catch (err) {
      setError(errMsg(err, '登录失败，请稍后再试'));
      setBusy(false);
      // the submit button was disabled while sending, which dropped the focus: put it back where the fix goes
      requestAnimationFrame(() => passwordRef.current?.select());
    }
  }

  return (
    <form className="stack" style={{ ['--gap' as string]: '20px' }} onSubmit={submit}>
      <div className="field">
        <label className="label" htmlFor={`${id}-handle`}>
          用户名
        </label>
        <input
          id={`${id}-handle`}
          className="input"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={24}
          required
          autoFocus={autoFocus && !initialHandle}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor={`${id}-password`}>
          密码
        </label>
        <div className="au-pw">
          <input
            ref={passwordRef}
            id={`${id}-password`}
            className="input"
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            maxLength={256}
            required
            autoFocus={autoFocus && !!initialHandle}
          />
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
  );
}
