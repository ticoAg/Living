import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Invite, Role, SessionUser, SiteInfo } from '../../../shared/types';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { invalidate, useApi } from '../../lib/useApi';
import { ConfirmBar, Seg } from '../ui';
import { copyText, errMsg, useKeep } from '../util';

type Registration = SiteInfo['registration'];

const REGISTRATION: { value: Registration; label: string; hint: string }[] = [
  { value: 'invite', label: '邀请码', hint: '需要邀请码才能注册（默认）' },
  { value: 'open', label: '开放', hint: '任何人都可以注册' },
  { value: 'closed', label: '关闭', hint: '暂不接受新用户' }
];
const REG_NOTE: Record<Registration, string> = {
  invite: '新用户需要邀请码才能注册。',
  open: '任何人都可以注册；有邀请码的话角色按邀请码算。',
  closed: '暂不接受新用户注册，已有账号不受影响。'
};
const EXPIRY: { days: number | null; label: string }[] = [
  { days: null, label: '不限期' },
  { days: 1, label: '1 天' },
  { days: 7, label: '7 天' },
  { days: 14, label: '14 天' },
  { days: 30, label: '30 天' },
  { days: 90, label: '90 天' }
];
const ROLE_LABEL: Record<Role, string> = { owner: '站长', admin: '管理员', member: '成员' };

const expired = (i: Invite) => !i.usedAt && !!i.expiresAt && Date.parse(i.expiresAt) < Date.now();
const day = (iso: string) => iso.slice(0, 10).replace(/-/g, '.');

/** Owner and admins: registration mode and invite codes. */
export default function AdminSection({ user }: { user: SessionUser }) {
  const { refresh } = useSession();
  const settingsReq = useApi<{ registration: Registration }>('/api/admin/settings');
  const invitesReq = useApi<{ invites: Invite[] }>('/api/admin/invites');
  const registration = useKeep(settingsReq.data)?.registration;
  const invites = useKeep(invitesReq.data)?.invites;

  const [regBusy, setRegBusy] = useState(false);
  const [regMsg, setRegMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [note, setNote] = useState('');
  const [days, setDays] = useState<number | null>(null);
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<Invite | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  async function setRegistration(value: Registration) {
    if (value === registration || regBusy) return;
    setRegBusy(true);
    setRegMsg(null);
    try {
      await api('/api/admin/settings', { method: 'PATCH', json: { registration: value } });
      invalidate('/api/admin/settings');
      await refresh();
      setRegMsg({ ok: true, text: '已保存' });
    } catch (err) {
      setRegMsg({ ok: false, text: errMsg(err, '保存失败') });
    } finally {
      setRegBusy(false);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (making) return;
    setMaking(true);
    setProblem(null);
    try {
      const res = await api<{ invite: Invite }>('/api/admin/invites', { json: { role, note: note.trim() || undefined, expiresInDays: days ?? undefined } });
      invalidate('/api/admin/invites');
      setMade(res.invite);
      setNote('');
    } catch (err) {
      setProblem(errMsg(err, '生成失败'));
    } finally {
      setMaking(false);
    }
  }

  async function copy(key: string, text: string) {
    const ok = await copyText(text);
    setCopied(ok ? key : null);
    if (!ok) setProblem('复制失败，请手动选中邀请码复制');
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1600);
  }

  async function remove(code: string) {
    setRemoveBusy(true);
    setProblem(null);
    try {
      await api(`/api/admin/invites/${code}`, { method: 'DELETE' });
      invalidate('/api/admin/invites');
      if (made?.code === code) setMade(null);
      setRemoving(null);
    } catch (err) {
      setProblem(errMsg(err, '删除失败'));
    } finally {
      setRemoveBusy(false);
    }
  }

  const link = (code: string) => `${location.origin}/register?invite=${code}`;

  return (
    <section className="se-section sf-panel" id="admin" aria-labelledby="se-admin-h">
      <h2 className="sf-h" id="se-admin-h">站点管理</h2>

      <div className="stack" style={{ ['--gap' as string]: '10px' }}>
        {registration ? (
          <Seg label="注册方式" value={registration} options={REGISTRATION} onChange={(v) => void setRegistration(v)} disabled={regBusy} hint={REG_NOTE[registration]} />
        ) : settingsReq.error != null ? (
          <p className="error-text">注册方式加载失败。<button type="button" className="btn btn-quiet" onClick={settingsReq.reload}>重试</button></p>
        ) : (
          <p className="small muted">加载中…</p>
        )}
        <span className="small" role="status" aria-live="polite">{regMsg && <span className={regMsg.ok ? 'sf-ok' : 'error-text'}>{regMsg.text}</span>}</span>
      </div>

      <form className="se-zone-form stack" style={{ ['--gap' as string]: '16px' }} onSubmit={create} aria-label="生成邀请码">
        <h3 className="sf-sub">生成邀请码</h3>
        <div className="se-invite-form">
          {user.role === 'owner' && (
            <Seg
              label="角色"
              value={role}
              options={[
                { value: 'member', label: '成员' },
                { value: 'admin', label: '管理员' }
              ]}
              onChange={setRole}
            />
          )}
          <div className="field se-grow">
            <label className="label" htmlFor="se-inv-note">备注（可不填）</label>
            <input id="se-inv-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="给谁的，如 小林" />
          </div>
          <div className="field">
            <label className="label" htmlFor="se-inv-days">有效期</label>
            <select id="se-inv-days" className="input select" value={days ?? ''} onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)}>
              {EXPIRY.map((o) => (
                <option key={o.label} value={o.days ?? ''}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={making}>{making ? '生成中…' : '生成邀请码'}</button>
          {problem && <span className="error-text small" role="alert">{problem}</span>}
        </div>
      </form>

      {made && (
        <div className="notice se-made" role="status">
          <span className="small muted">新邀请码</span>
          <code className="se-code mono">{made.code}</code>
          <div className="row">
            <button type="button" className="btn" onClick={() => void copy('made', made.code)}>{copied === 'made' ? '已复制' : '复制邀请码'}</button>
            <button type="button" className="btn btn-quiet" onClick={() => void copy('made-link', link(made.code))}>{copied === 'made-link' ? '已复制' : '复制注册链接'}</button>
          </div>
        </div>
      )}

      <div className="stack" style={{ ['--gap' as string]: '10px' }}>
        <h3 className="sf-sub">邀请码</h3>
        {!invites && !invitesReq.error && <p className="small muted">加载中…</p>}
        {invitesReq.error != null && !invites && <p className="error-text">邀请码加载失败。<button type="button" className="btn btn-quiet" onClick={invitesReq.reload}>重试</button></p>}
        {invites && invites.length === 0 && <p className="small muted">还没有邀请码。</p>}
        {invites && invites.length > 0 && (
          <ul className="se-invites">
            {invites.map((i) => {
              const used = !!i.usedAt || !!i.usedBy;
              const dead = expired(i);
              const who = i.usedByHandle ?? (i.usedBy && !i.usedBy.startsWith('u_') ? i.usedBy : null);
              return (
                <li key={i.code} className="se-invite" data-state={used ? 'used' : dead ? 'expired' : 'open'}>
                  <div className="se-invite-row">
                    <code className="se-code mono">{i.code}</code>
                    <span className="se-invite-meta small">
                      <span className="tm-badge">{ROLE_LABEL[i.role]}</span>
                      {used ? (
                        <span className="muted">已使用{who ? ` · @${who}` : ''}{i.usedAt ? ` · ${day(i.usedAt)}` : ''}</span>
                      ) : dead ? (
                        <span className="error-text">已过期 · {day(i.expiresAt!)}</span>
                      ) : (
                        <span className="muted">未使用{i.expiresAt ? ` · 有效至 ${day(i.expiresAt)}` : ' · 不限期'}</span>
                      )}
                      {i.note && <span className="se-invite-note">{i.note}</span>}
                    </span>
                    <span className="se-invite-actions">
                      {!used && !dead && (
                        <>
                          <button type="button" className="btn btn-quiet" onClick={() => void copy(i.code, i.code)}>{copied === i.code ? '已复制' : '复制'}</button>
                          <button type="button" className="btn btn-quiet" onClick={() => void copy(`${i.code}-link`, link(i.code))}>{copied === `${i.code}-link` ? '已复制' : '复制链接'}</button>
                        </>
                      )}
                      {!used && (
                        <button type="button" className="btn btn-quiet" aria-expanded={removing === i.code} aria-label={`删除邀请码 ${i.code}`} onClick={() => setRemoving(removing === i.code ? null : i.code)}>
                          删除
                        </button>
                      )}
                    </span>
                  </div>
                  {removing === i.code && <ConfirmBar prompt={`删除邀请码 ${i.code}？拿着它的人将无法注册。`} confirmLabel="确认删除" busy={removeBusy} onConfirm={() => void remove(i.code)} onCancel={() => setRemoving(null)} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
