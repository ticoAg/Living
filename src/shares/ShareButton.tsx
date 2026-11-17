import { useEffect, useId, useRef, useState } from 'react';
import type { ShareKind } from '../../shared/types';
import { Icon } from '../components/icons';
import { errMsg } from '../studio/util';
import { createShare, EXPIRY_CHOICES, sharesOf, useShares } from './api';
import ShareItem from './ShareItem';
import '../styles/shares.css';

// 分享 on an entry, collection or project of one's own: a dialog with its links, each to copy or delete, and a new
// one with how long it lasts. A native <dialog> keeps focus inside and gives it back on close.
// Docs: /docs/product/features/sharing.md

const REACH: Record<ShareKind, string> = {
  entry: '拿到链接的人不用登录，就能看这条记录和它的全部照片，包括仅自己可见的。',
  theme: '拿到链接的人不用登录，就能看这个合集和其中的照片、已完成的记录，包括仅自己可见的。',
  project: '拿到链接的人不用登录，就能看这个项目和其中已完成的记录与照片，包括仅自己可见的。'
};

/** New links last a week unless chosen otherwise. */
const DEFAULT_DAYS = '7';

function ShareDialog({
  kind,
  id,
  notice,
  open,
  onClose
}: {
  kind: ShareKind;
  id: string;
  notice?: string;
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const { shares, error: loadError, reload } = useShares(open ? sharesOf(kind, id) : null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const s = await createShare({ kind, id, expiresInDays: days ? Number(days) : null });
      setFresh(s.id);
    } catch (e) {
      setError(errMsg(e, '新建失败'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="sh" aria-labelledby={titleId} onClose={onClose}>
      {open && (
        <div className="sh-panel">
          <div className="sh-head">
            <h2 className="sh-title" id={titleId}>
              分享链接
            </h2>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="关闭" onClick={onClose}>
              <Icon name="close" size={20} />
            </button>
          </div>
          <p className="small muted">{REACH[kind]}删掉链接，立刻失效。</p>
          {notice && (
            <p className="small sh-notice" role="note">
              {notice}
            </p>
          )}

          {!shares && !loadError && <p className="small muted">加载中…</p>}
          {loadError != null && !shares && (
            <p className="error-text">
              链接加载失败。
              <button type="button" className="btn btn-quiet" onClick={reload}>
                重试
              </button>
            </p>
          )}
          {shares && shares.length > 0 && (
            <ul className="sh-list">
              {shares.map((s) => (
                <ShareItem key={s.id} share={s} autoFocus={s.id === fresh} />
              ))}
            </ul>
          )}

          <div className="sh-new">
            <label className="visually-hidden" htmlFor={`${titleId}-days`}>
              有效期
            </label>
            <select id={`${titleId}-days`} className="select" value={days} onChange={(e) => setDays(e.target.value)} disabled={busy}>
              {EXPIRY_CHOICES.map((c) => (
                <option key={c.label} value={c.days ?? ''}>
                  {c.days ? `${c.label}内有效` : c.label}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary" onClick={() => void create()} disabled={busy}>
              <Icon name="link" size={16} />
              {busy ? '新建中…' : '新建链接'}
            </button>
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </dialog>
  );
}

export default function ShareButton({
  kind,
  id,
  notice,
  className = 'btn btn-quiet'
}: {
  kind: ShareKind;
  id: string;
  notice?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="link" size={16} />
        分享
      </button>
      <ShareDialog kind={kind} id={id} notice={notice} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
