import { useEffect, useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { ENTRY_LIMITS } from '../../shared/limits';
import type { Attachment, EntryDetail } from '../../shared/types';
import { RecordingBar, useLeaveGuard } from '../attachments/AttachmentsField';
import { fmtDuration, KIND_ICON } from '../attachments/kinds';
import { canRecord } from '../attachments/recorder';
import { discardUpload } from '../attachments/upload';
import { useRecorder } from '../attachments/useRecorder';
import { useUploads, type Upload } from '../attachments/useUploads';
import AutoTextarea from '../components/AutoTextarea';
import { Icon } from '../components/icons';
import { api, ApiError } from '../lib/api';
import { DEVICE_DRAFT_PREFIX } from '../lib/deviceDrafts';
import { localDateTime } from '../lib/format';
import { invalidate } from '../lib/useApi';
import { attachmentOf } from './draft';
import type { Handoff } from './handoff';
import '../styles/attachments.css';

// A line or two, or a recording, kept at once as a finished note of this moment, for the author alone. Ctrl/Cmd+Enter
// keeps it; 写长文 carries the text and recordings into the editor. What is typed, and which recordings are up, stays
// on this device until it is kept.

function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function store(key: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    // storage refused: the text simply is not kept
  }
}

function storedList(key: string): Attachment[] {
  try {
    const v: unknown = JSON.parse(stored(key) || '[]');
    return Array.isArray(v) ? v.map(attachmentOf).filter((a): a is Attachment => !!a) : [];
  } catch {
    return [];
  }
}

const asAttachment = ({ id, kind, name, mime, size, duration, width, height, poster, createdAt }: Attachment): Attachment => ({
  id,
  kind,
  name,
  mime,
  size,
  duration,
  width,
  height,
  poster,
  createdAt
});

function Chip({ icon, text, children }: { icon: Attachment['kind']; text: string; children: ReactNode }) {
  return (
    <li className="qc-att">
      <Icon name={KIND_ICON[icon]} size={16} />
      <span className="mono">{text}</span>
      {children}
    </li>
  );
}

const upText = (u: Upload) =>
  u.state === 'failed' ? (u.error ?? '上传没有成功') : u.state === 'sending' ? `${Math.floor((u.sent / u.size) * 100)}%` : '…';

export default function QuickCapture({ userId }: { userId: string }) {
  const id = useId();
  const key = `${DEVICE_DRAFT_PREFIX}${userId}.capture`;
  const listKey = `${key}.attachments`;
  const [text, setText] = useState(() => stored(key));
  const [kept, setKept] = useState<Attachment[]>(() => storedList(listKey));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [, navigate] = useLocation();
  const { uploads, busy: sending, add, retry, cancel } = useUploads((a) => setKept((k) => [...k, asAttachment(a)]));
  const recorder = useRecorder((file, seconds) => add([{ file, seconds }]));
  const recording = recorder.state.kind === 'on' || recorder.state.kind === 'starting';
  const working = sending || recording;
  const something = !!text.trim() || kept.length > 0;
  useLeaveGuard(working);

  useEffect(() => store(key, text), [key, text]);
  useEffect(() => store(listKey, kept.length ? JSON.stringify(kept) : ''), [listKey, kept]);

  async function keep(e?: FormEvent) {
    e?.preventDefault();
    if (busy || working || !something) return;
    setBusy(true);
    setMsg(null);
    try {
      await api<{ entry: EntryDetail }>('/api/entries', {
        method: 'POST',
        json: {
          body: text,
          occurredAt: localDateTime(),
          status: 'published',
          attachments: kept.map((a) => ({ attachmentId: a.id }))
        }
      });
      setText('');
      setKept([]);
      setMsg({ kind: 'ok', text: '记下了' });
      invalidate('/api/entries?');
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof ApiError ? err.message : '网络不可用，内容还留在这里' });
    } finally {
      setBusy(false);
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void keep();
    }
  };

  return (
    <form className="qc" onSubmit={keep}>
      <label htmlFor={`${id}-text`} className="visually-hidden">
        记一笔
      </label>
      <AutoTextarea
        id={`${id}-text`}
        className="textarea qc-text"
        placeholder="记点什么"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (msg?.kind === 'ok') setMsg(null);
        }}
        onKeyDown={onKey}
        maxLength={ENTRY_LIMITS.bodyMax}
      />
      <RecordingBar state={recorder.state} onStop={recorder.stop} onCancel={recorder.cancel} />
      {(kept.length > 0 || uploads.length > 0) && (
        <ul className="qc-atts" aria-label="录音">
          {kept.map((a) => (
            <Chip key={a.id} icon={a.kind} text={a.duration !== null ? fmtDuration(a.duration) : a.name}>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-label={`移除 ${a.name}`}
                onClick={() => {
                  setKept((k) => k.filter((x) => x.id !== a.id));
                  discardUpload(a.id);
                }}
              >
                <Icon name="close" size={16} />
              </button>
            </Chip>
          ))}
          {uploads.map((u) => (
            <Chip key={u.key} icon={u.kind} text={upText(u)}>
              {u.state === 'failed' && (
                <button type="button" className="btn btn-ghost" onClick={() => retry(u.key)}>
                  重试
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-icon" aria-label={`取消上传 ${u.name}`} onClick={() => cancel(u.key)}>
                <Icon name="close" size={16} />
              </button>
            </Chip>
          ))}
        </ul>
      )}
      <div className="qc-bar">
        <span className="small muted">仅自己可见</span>
        <span className="qc-msg small" role="status" data-kind={msg?.kind ?? (recorder.state.kind === 'error' ? 'error' : undefined)}>
          {msg?.text ?? (recorder.state.kind === 'error' ? recorder.state.text : '')}
        </span>
        {canRecord() && (
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="录音"
            disabled={recording}
            onClick={() => {
              setMsg(null);
              recorder.start();
            }}
          >
            <Icon name="mic" size={18} />
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={working}
          onClick={() => {
            const handoff: Handoff = { livingEntryBody: text, livingEntryAttachments: kept };
            setText('');
            setKept([]);
            // the page goes before the effects that store the empty box would run: the editor has it all now
            store(key, '');
            store(listKey, '');
            navigate('/entries/new', { state: handoff });
          }}
        >
          写长文
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || working || !something}
          aria-keyshortcuts="Control+Enter Meta+Enter"
        >
          记下
        </button>
      </div>
    </form>
  );
}
