import { useEffect, useRef, useState } from 'react';
import { ATTACHMENT_LIMITS } from '../../shared/limits';
import type { Attachment, OwnAttachment } from '../../shared/types';
import AutoTextarea from '../components/AutoTextarea';
import { Icon } from '../components/icons';
import type { DraftAttachment } from '../entries/draft';
import { fmtBytes } from '../lib/format';
import { attachmentFacts, attachProblem, fileUrl, fmtDuration, KIND_ICON, posterUrl } from './kinds';
import { canRecord } from './recorder';
import { useRecorder, type RecorderState } from './useRecorder';
import { useUploads, type Upload } from './useUploads';
import '../styles/attachments.css';

// An entry's attachments in the editor: files added or recorded go up at once and join the entry when they are up;
// each has what the entry says under it, and its place in the list. Docs: /docs/product/features/attachments.md

/** Seconds since `since`, as a clock, ticking. */
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return <span className="mono">{fmtDuration((now - since) / 1000)}</span>;
}

/** Asks before the page is closed while `active`. */
export function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [active]);
}

/** Its frame, or what kind of file it is. */
export function AttachmentThumb({ a }: { a: Pick<Attachment, 'id' | 'kind' | 'poster'> }) {
  return a.poster ? <img src={posterUrl(a.id)} alt="" loading="lazy" decoding="async" /> : <Icon name={KIND_ICON[a.kind]} size={24} />;
}

export function RecordingBar({ state, onStop, onCancel }: { state: RecorderState; onStop: () => void; onCancel: () => void }) {
  if (state.kind !== 'on') return null;
  return (
    <div className="att-rec" role="status">
      <span className="att-rec-dot" aria-hidden="true" />
      <span>
        录音中 <Elapsed since={state.since} />
      </span>
      <span className="row att-rec-tools">
        <button type="button" className="btn btn-primary" onClick={onStop}>
          <Icon name="stop" size={16} />
          停止
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          取消
        </button>
      </span>
    </div>
  );
}

function progress(u: Upload): string {
  if (u.state === 'waiting') return '等待上传';
  if (u.state === 'reading') return '读取中…';
  return `${Math.floor((u.sent / u.size) * 100)}% · ${fmtBytes(u.sent)} / ${fmtBytes(u.size)}`;
}

/** A file going up, or one that did not. */
export function UploadRow({ u, onRetry, onCancel }: { u: Upload; onRetry: () => void; onCancel: () => void }) {
  return (
    <li className="att-row" data-state={u.state}>
      <span className="att-thumb">
        <Icon name={KIND_ICON[u.kind]} size={24} />
      </span>
      <div className="att-main">
        <p className="att-name">{u.name}</p>
        {u.state === 'failed' ? (
          <p className="small error-text" role="alert">
            {u.error}
          </p>
        ) : (
          <>
            <progress
              className="att-bar"
              max={u.size}
              value={u.state === 'sending' ? u.sent : undefined}
              aria-label={`${u.name} 上传进度`}
            />
            <p className="small muted mono">{progress(u)}</p>
          </>
        )}
      </div>
      <div className="att-tools">
        {u.state === 'failed' && (
          <button type="button" className="btn btn-ghost" onClick={onRetry}>
            重试
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-icon" aria-label={`取消上传 ${u.name}`} onClick={onCancel}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </li>
  );
}

interface Props {
  id: string;
  value: readonly DraftAttachment[];
  onAdd: (a: OwnAttachment) => void;
  onCaption: (attachmentId: string, caption: string) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onRemove: (attachmentId: string) => void;
  /** files are going up, or a recording is on: the entry is not to be finished yet */
  onBusyChange: (busy: boolean) => void;
}

export default function AttachmentsField({ id, value, onAdd, onCaption, onMove, onRemove, onBusyChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const { uploads, busy, add, retry, cancel } = useUploads(onAdd);
  const room = ATTACHMENT_LIMITS.perEntry - value.length - uploads.length;
  const recorder = useRecorder((file, seconds) => add([{ file, seconds }]));
  const recording = recorder.state.kind === 'on' || recorder.state.kind === 'starting';
  const working = busy || recording;

  const report = useRef(onBusyChange);
  report.current = onBusyChange;
  useEffect(() => report.current(working), [working]);
  useLeaveGuard(working);

  function pick(files: File[]) {
    const out: string[] = [];
    const ok: File[] = [];
    for (const f of files) {
      const problem = attachProblem(f);
      if (problem) out.push(`${f.name}：${problem}`);
      else if (ok.length >= room) out.push(`${f.name}：一条记录最多 ${ATTACHMENT_LIMITS.perEntry} 个附件`);
      else ok.push(f);
    }
    setProblems(out);
    add(ok.map((file) => ({ file })));
  }

  return (
    <section className="ee-sec" aria-labelledby={`${id}-att`}>
      <div className="ee-sec-head">
        <h2 id={`${id}-att`} className="ee-h">
          附件
        </h2>
        <div className="row att-add">
          {canRecord() && (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={recording || room <= 0}
              onClick={() => {
                setProblems([]);
                recorder.start();
              }}
            >
              <Icon name="mic" size={18} />
              录音
            </button>
          )}
          <button type="button" className="btn btn-quiet" aria-label="添加附件" disabled={room <= 0} onClick={() => input.current?.click()}>
            <Icon name="plus" size={18} />
            添加
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            aria-label="附件文件"
            onChange={(e) => {
              pick([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </div>
      </div>
      <RecordingBar state={recorder.state} onStop={recorder.stop} onCancel={recorder.cancel} />
      {recorder.state.kind === 'error' && (
        <p className="small error-text" role="alert">
          {recorder.state.text}
        </p>
      )}
      {problems.length > 0 && (
        <ul className="att-problems small" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {(value.length > 0 || uploads.length > 0) && (
        <ol className="att-list">
          {value.map((d, i) => {
            const a = d.attachment;
            return (
              <li key={d.attachmentId} className="att-row">
                <a className="att-thumb" href={fileUrl(a.id)} target="_blank" rel="noopener" aria-label={`打开 ${a.name}`}>
                  <AttachmentThumb a={a} />
                </a>
                <div className="att-main">
                  <p className="att-name">{a.name}</p>
                  <p className="small muted mono">{attachmentFacts(a)}</p>
                  {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- a recording to listen to again, with no captions file */}
                  {a.kind === 'audio' && <audio className="att-audio" controls preload="none" src={fileUrl(a.id)} />}
                  <label className="visually-hidden" htmlFor={`${id}-acap-${a.id}`}>
                    {a.name} 的说明
                  </label>
                  <AutoTextarea
                    id={`${id}-acap-${a.id}`}
                    className="textarea ee-caption"
                    placeholder="说明"
                    rows={1}
                    maxLength={ATTACHMENT_LIMITS.captionMax}
                    value={d.caption}
                    onChange={(e) => onCaption(a.id, e.target.value)}
                  />
                </div>
                <div className="att-tools">
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    aria-label={`上移 ${a.name}`}
                    disabled={i === 0}
                    onClick={() => onMove(i, -1)}
                  >
                    <Icon name="up" size={18} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    aria-label={`下移 ${a.name}`}
                    disabled={i === value.length - 1}
                    onClick={() => onMove(i, 1)}
                  >
                    <Icon name="down" size={18} />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon" aria-label={`移除 ${a.name}`} onClick={() => onRemove(a.id)}>
                    <Icon name="close" size={18} />
                  </button>
                </div>
              </li>
            );
          })}
          {uploads.map((u) => (
            <UploadRow key={u.key} u={u} onRetry={() => retry(u.key)} onCancel={() => cancel(u.key)} />
          ))}
        </ol>
      )}
    </section>
  );
}
