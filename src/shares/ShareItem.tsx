import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import type { ShareLink } from '../../shared/types';
import { Icon } from '../components/icons';
import { errMsg } from '../studio/util';
import { copyText, deleteShare, expiryText, KIND_LABEL, shareUrl, targetPath } from './api';

// One share link: its address to copy, until when it opens, and deleting it (two steps: it cannot be had back).

export default function ShareItem({ share, withTarget, autoFocus }: { share: ShareLink; withTarget?: boolean; autoFocus?: boolean }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const [arming, setArming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const url = shareUrl(share.token);
  const exp = expiryText(share.expiresAt);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    const ok = await copyText(url);
    // without the clipboard, the address is selected for the reader to copy
    if (!ok) input.current?.select();
    setCopied(ok);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteShare(share.id);
    } catch (e) {
      setError(errMsg(e, '删除失败'));
      setBusy(false);
    }
  }

  return (
    <li className="sh-item" data-expired={exp.expired || undefined}>
      {withTarget && (
        <Link href={targetPath(share.kind, share.targetId)} className="sh-target">
          <span className="sh-kind">{KIND_LABEL[share.kind]}</span>
          <span className="sh-target-title">{share.targetTitle || '未命名'}</span>
        </Link>
      )}
      <input
        ref={input}
        className="input mono sh-url"
        readOnly
        value={url}
        aria-label={`链接，${exp.text}`}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="sh-item-foot">
        <span className="small sh-exp">{exp.text}</span>
        <div className="sh-item-actions">
          {arming ? (
            <>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
                {busy ? '删除中…' : '确认删除'}
              </button>
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setArming(false)} autoFocus>
                取消
              </button>
            </>
          ) : (
            <>
              {!exp.expired && (
                <button type="button" className="btn btn-quiet" onClick={() => void copy()} autoFocus={autoFocus}>
                  <Icon name={copied ? 'check' : 'copy'} size={16} />
                  {copied ? '已复制' : '复制'}
                </button>
              )}
              <button type="button" className="btn btn-quiet" onClick={() => setArming(true)}>
                删除
              </button>
            </>
          )}
        </div>
      </div>
      {copied === false && (
        <p className="small muted" role="status">
          没能复制，链接已选中，请手动复制。
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
