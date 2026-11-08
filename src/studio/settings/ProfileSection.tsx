import { useState, type FormEvent } from 'react';
import type { PhotoSummary, SessionUser } from '../../../shared/types';
import { Icon } from '../../components/icons';
import Img from '../../components/Img';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { invalidate, useApi } from '../../lib/useApi';
import { errMsg, fmtStamp, useKeep } from '../util';

const PAGE = 60;

/** Display name, bio and an avatar chosen from your own photos. */
export default function ProfileSection({ user }: { user: SessionUser }) {
  const { refresh } = useSession();
  const photosReq = useApi<{ photos: PhotoSummary[] }>('/api/photos?mine=1');
  const photos = useKeep(photosReq.data)?.photos;

  const [name, setName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatar, setAvatar] = useState<string | null>(user.avatarPhotoId);
  const [picking, setPicking] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = name.trim() !== user.displayName || bio.trim() !== (user.bio ?? '') || avatar !== user.avatarPhotoId;
  const current = avatar ? photos?.find((p) => p.id === avatar) : undefined;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    if (!name.trim()) {
      setMsg({ ok: false, text: '显示名不能为空' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api<{ user: SessionUser }>('/api/me', { method: 'PATCH', json: { displayName: name.trim(), bio: bio.trim() || null, avatarPhotoId: avatar } });
      await refresh();
      invalidate('/api/users');
      setMsg({ ok: true, text: '已保存' });
    } catch (err) {
      setMsg({ ok: false, text: errMsg(err, '保存失败') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="se-section sf-panel" id="profile" aria-labelledby="se-profile-h">
      <h2 className="sf-h" id="se-profile-h">个人资料</h2>
      <form className="stack" style={{ ['--gap' as string]: '20px' }} onSubmit={save}>
        <div className="se-avatar-row">
          <span className="se-avatar" aria-hidden="true">
            {current ? <Img photo={current} ratio="1 / 1" sizes="96px" alt="" eager /> : <Icon name="user" size={32} />}
          </span>
          <div className="stack" style={{ ['--gap' as string]: '8px' }}>
            <span className="label">头像</span>
            <div className="row">
              <button type="button" className="btn btn-quiet" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
                {picking ? '收起' : '从我的照片里选'}
              </button>
              {avatar && (
                <button type="button" className="btn btn-quiet" onClick={() => setAvatar(null)}>
                  不用头像
                </button>
              )}
            </div>
          </div>
        </div>

        {picking && (
          <div className="se-pick" role="group" aria-label="选择头像">
            {!photos && !photosReq.error && <p className="small muted">照片加载中…</p>}
            {photosReq.error != null && !photos && <p className="error-text">照片加载失败。<button type="button" className="btn btn-quiet" onClick={photosReq.reload}>重试</button></p>}
            {photos && photos.length === 0 && <p className="small muted">你还没有照片。先去上传几张。</p>}
            {photos && photos.length > 0 && (
              <>
                <div className="se-grid">
                  {photos.slice(0, shown).map((p) => (
                    <button key={p.id} type="button" className="se-thumb" aria-pressed={avatar === p.id} aria-label={`${p.title ?? '未命名'} ${fmtStamp(p.takenAt)}`} onClick={() => setAvatar(p.id)}>
                      <Img photo={p} ratio="1 / 1" sizes="96px" alt="" />
                    </button>
                  ))}
                </div>
                {photos.length > shown && (
                  <button type="button" className="btn btn-quiet" onClick={() => setShown((n) => n + PAGE)}>
                    显示更多（还有 {photos.length - shown} 张）
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="se-name">显示名</label>
          <input id="se-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="nickname" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="se-bio">简介</label>
          <textarea id="se-bio" className="textarea" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} rows={3} placeholder="一两句话介绍自己" />
          {bio.length > 400 && <span className="small muted mono" style={{ textAlign: 'right' }}>{bio.length} / 500</span>}
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={!dirty || busy || !name.trim()}>{busy ? '保存中…' : '保存'}</button>
          <span className="small" role="status" aria-live="polite">{msg && <span className={msg.ok ? 'sf-ok' : 'error-text'}>{msg.text}</span>}</span>
        </div>
      </form>
    </section>
  );
}
