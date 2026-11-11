import { useState, type FormEvent } from 'react';
import { ACCOUNT_LIMITS } from '../../../shared/limits';
import { api } from '../../lib/api';
import { errMsg } from '../util';

/** Change password. Other sessions stay signed in. */
export default function PasswordSection() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (next.length < ACCOUNT_LIMITS.passwordMin) return setMsg({ ok: false, text: `新密码至少需要 ${ACCOUNT_LIMITS.passwordMin} 个字符` });
    if (next !== again) return setMsg({ ok: false, text: '两次输入的新密码不一样' });
    if (next === current) return setMsg({ ok: false, text: '新密码和当前密码相同' });
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/me/password', { json: { current, next } });
      setCurrent('');
      setNext('');
      setAgain('');
      setMsg({ ok: true, text: '密码已更新' });
    } catch (err) {
      setMsg({ ok: false, text: errMsg(err, '修改失败') });
    } finally {
      setBusy(false);
    }
  }

  const type = show ? 'text' : 'password';
  return (
    <section className="se-section sf-panel" id="password" aria-labelledby="se-password-h">
      <h2 className="sf-h" id="se-password-h">
        修改密码
      </h2>
      <form className="stack" style={{ ['--gap' as string]: '20px' }} onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="se-pw-cur">
            当前密码
          </label>
          <input
            id="se-pw-cur"
            className="input"
            type={type}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            maxLength={ACCOUNT_LIMITS.passwordMax}
            required
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="se-pw-new">
            新密码
          </label>
          <input
            id="se-pw-new"
            className="input"
            type={type}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            maxLength={ACCOUNT_LIMITS.passwordMax}
            required
            aria-describedby="se-pw-hint"
          />
          <span id="se-pw-hint" className="small muted">
            至少 {ACCOUNT_LIMITS.passwordMin} 位。
          </span>
        </div>
        <div className="field">
          <label className="label" htmlFor="se-pw-again">
            再输一次新密码
          </label>
          <input
            id="se-pw-again"
            className="input"
            type={type}
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            autoComplete="new-password"
            maxLength={ACCOUNT_LIMITS.passwordMax}
            required
          />
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || !current || !next || !again}>
            {busy ? '保存中…' : '修改密码'}
          </button>
          <button type="button" className="btn btn-quiet" aria-pressed={show} onClick={() => setShow((s) => !s)}>
            {show ? '隐藏密码' : '显示密码'}
          </button>
          <span className="small" role="status" aria-live="polite">
            {msg && <span className={msg.ok ? 'sf-ok' : 'error-text'}>{msg.text}</span>}
          </span>
        </div>
      </form>
    </section>
  );
}
