import { useState } from 'react';
import { VISIBILITIES, type SessionUser, type Visibility } from '../../../shared/types';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { VISIBILITY_LABEL } from '../../themes/util';
import { errMsg } from '../util';

// Who sees a new photo unless its upload says otherwise. It changes only later uploads: photos already up keep their
// own visibility. Docs: /docs/product/features/privacy.md#照片

export const PHOTO_DEFAULT_HINT: Record<Visibility, string> = {
  public: '新照片进入图库、地图和你的主页，任何人都能看到。',
  unlisted: '新照片不进入图库和列表，凭链接可以打开。',
  private: '新照片只有你能看到。'
};

export default function PhotoDefaultsSection({ user }: { user: SessionUser }) {
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function choose(v: Visibility) {
    if (v === user.photoVisibility || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await api('/api/me', { method: 'PATCH', json: { photoVisibility: v } });
      await refresh();
      setMsg({ ok: true, text: '已保存' });
    } catch (err) {
      setMsg({ ok: false, text: errMsg(err, '保存失败') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="se-section sf-panel" id="photos" aria-labelledby="se-photos-h">
      <h2 className="sf-h" id="se-photos-h">
        新照片
      </h2>
      <div className="stack" style={{ ['--gap' as string]: '10px' }}>
        <span className="label" id="se-photo-vis">
          默认公开范围
        </span>
        <div className="row">
          <div className="seg" role="group" aria-labelledby="se-photo-vis">
            {VISIBILITIES.map((v) => (
              <button key={v} type="button" aria-pressed={user.photoVisibility === v} disabled={busy} onClick={() => void choose(v)}>
                {VISIBILITY_LABEL[v]}
              </button>
            ))}
          </div>
          <span className="small" role="status" aria-live="polite">
            {msg && <span className={msg.ok ? 'sf-ok' : 'error-text'}>{msg.text}</span>}
          </span>
        </div>
        <p className="small muted">{PHOTO_DEFAULT_HINT[user.photoVisibility]}上传时可以逐张更改，已经上传的照片不受影响。</p>
      </div>
    </section>
  );
}
