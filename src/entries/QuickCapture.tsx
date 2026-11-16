import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLocation } from 'wouter';
import { ENTRY_LIMITS } from '../../shared/limits';
import type { EntryDetail } from '../../shared/types';
import AutoTextarea from '../components/AutoTextarea';
import { api, ApiError } from '../lib/api';
import { DEVICE_DRAFT_PREFIX } from '../lib/deviceDrafts';
import { localDateTime } from '../lib/format';
import { invalidate } from '../lib/useApi';

// A line or two, kept at once as a finished note of this moment, for the author alone. Ctrl/Cmd+Enter keeps it;
// 写长文 carries the text into the editor. What is typed stays on this device until it is kept.

/** history.state of the editor opened from here: the text to start with. */
export interface Handoff {
  livingEntryBody: string;
}

export const handoffBody = (state: unknown): string =>
  state && typeof state === 'object' && typeof (state as Partial<Handoff>).livingEntryBody === 'string'
    ? (state as Handoff).livingEntryBody
    : '';

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

export default function QuickCapture({ userId }: { userId: string }) {
  const id = useId();
  const key = `${DEVICE_DRAFT_PREFIX}${userId}.capture`;
  const [text, setText] = useState(() => stored(key));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => store(key, text), [key, text]);

  async function keep(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await api<{ entry: EntryDetail }>('/api/entries', {
        method: 'POST',
        json: { body: text, occurredAt: localDateTime(), status: 'published' }
      });
      setText('');
      setMsg({ kind: 'ok', text: '记下了' });
      invalidate('/api/entries?');
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof ApiError ? err.message : '网络不可用，文字还留在这里' });
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
      <div className="qc-bar">
        <span className="small muted">仅自己可见</span>
        <span className="qc-msg small" role="status" data-kind={msg?.kind}>
          {msg?.text}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            const body = text;
            setText('');
            navigate('/entries/new', { state: { livingEntryBody: body } satisfies Handoff });
          }}
        >
          写长文
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()} aria-keyshortcuts="Control+Enter Meta+Enter">
          记下
        </button>
      </div>
    </form>
  );
}
