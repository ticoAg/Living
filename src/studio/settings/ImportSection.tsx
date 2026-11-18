import { Fragment, useEffect, useRef, useState } from 'react';
import { ImportStopped, planImport, runImport, type ImportOutcome, type ImportPlan, type ImportProgress } from '../../import/run';
import { folderSource, zipSource, type ImportSource } from '../../import/source';
import { fmtBytes, fmtDay } from '../../lib/format';
import { invalidate } from '../../lib/useApi';
import { processFile } from '../process';
import { deviceHints, processLimit } from '../process-queue';
import { uploadPhoto } from '../publish';
import { Toggle } from '../ui';
import { errMsg } from '../util';

// An export brought back: its folder, or all its ZIP parts, read here; what is here already skipped, never overwritten;
// the rest sent a batch at a time, the photos resized and uploaded as an upload is. Docs: /docs/product/features/import.md

type State =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'planned'; source: ImportSource; plan: ImportPlan }
  | { kind: 'running'; progress: ImportProgress | null }
  | { kind: 'done'; outcome: ImportOutcome }
  | { kind: 'stopped'; outcome: ImportOutcome; message: string }
  | { kind: 'failed'; message: string };

const n = (v: number) => v.toLocaleString('zh-CN');

/** "3 条记录、12 张照片": the non-zero ones. */
function list(parts: [number, string][]): string {
  return parts
    .filter(([v]) => v > 0)
    .map(([v, unit]) => `${n(v)} ${unit}`)
    .join('、');
}

const PHASE_TEXT: Record<ImportProgress['phase'], string> = {
  tags: '导入标签',
  places: '导入地点',
  zones: '导入隐私区域',
  photos: '',
  projects: '导入项目',
  entries: '导入记录',
  collections: '导入合集'
};

function progressText(p: ImportProgress | null): string {
  if (!p) return '准备导入';
  if (p.phase !== 'photos') return PHASE_TEXT[p.phase];
  return `照片 ${n(p.photos)} / ${n(p.totalPhotos)}${p.totalBytes ? ` · ${fmtBytes(p.bytes)} / ${fmtBytes(p.totalBytes)}` : ''}`;
}

/** 0–1: the photos by their bytes, the rows before and after them a sliver each. */
function fraction(p: ImportProgress | null): number {
  if (!p) return 0;
  const before = { tags: 0, places: 0.01, zones: 0.02 } as Record<string, number>;
  const after = { projects: 0.95, entries: 0.96, collections: 0.98 } as Record<string, number>;
  if (p.phase in before) return before[p.phase];
  if (p.phase in after) return after[p.phase];
  const done = p.totalBytes ? p.bytes / p.totalBytes : p.totalPhotos ? p.photos / p.totalPhotos : 1;
  return 0.03 + Math.min(1, done) * 0.92;
}

function planLines(plan: ImportPlan): string[] {
  const a = plan.archive;
  const lines: string[] = [];
  const here = list([
    [plan.photosHere.size, '张照片'],
    [[...plan.entries.values()].filter((t) => t.exists).length, '条记录'],
    [[...plan.projects.values()].filter((t) => t.exists).length, '个项目'],
    [[...plan.collections.values()].filter((t) => t.exists).length, '个合集']
  ]);
  if (here) lines.push(`其中 ${here}已经在这里，会跳过。`);
  if (plan.noFile) lines.push(`${n(plan.noFile)} 张照片在导出里只有信息、没有文件，不会导入。`);
  if (plan.notPicked) lines.push(`${n(plan.notPicked)} 张照片的文件不在选中的文件里。导出分成了几个 zip 的话，要一起选上。`);
  if (a.skipped) lines.push(`${n(a.skipped)} 行数据不完整，会跳过。`);
  return lines;
}

function outcomeLines(o: ImportOutcome): string[] {
  const lines: string[] = [];
  const made = list([
    [o.created.photos, '张照片'],
    [o.created.entries, '条记录'],
    [o.created.projects, '个项目'],
    [o.created.collections, '个合集'],
    [o.created.tags, '个标签'],
    [o.created.places, '个地点'],
    [o.created.zones, '个隐私区域']
  ]);
  lines.push(made ? `新加了 ${made}。` : '没有新加任何内容。');
  const kept = list([
    [o.existing.photos, '张照片'],
    [o.existing.entries, '条记录'],
    [o.existing.projects, '个项目'],
    [o.existing.collections, '个合集'],
    [o.existing.zones, '个隐私区域']
  ]);
  if (kept) lines.push(`${kept}已经在这里，跳过了。`);
  if (o.noFile) lines.push(`${n(o.noFile)} 张照片在导出里没有文件，没有导入。`);
  if (o.notPicked) lines.push(`${n(o.notPicked)} 张照片的文件不在选中的文件里，没有导入。`);
  if (o.zonesFull) lines.push(`${n(o.zonesFull)} 个隐私区域超出了 50 个的上限，没有导入。`);
  if (o.shareLinks) lines.push('分享链接没有导入：导出里不含它们的地址，需要的话重新分享。');
  return lines;
}

const KIND_TEXT = { photo: '照片', entry: '记录', project: '项目', collection: '合集' } as const;

function Outcome({ outcome }: { outcome: ImportOutcome }) {
  return (
    <>
      {outcomeLines(outcome).map((l) => (
        <p key={l} className="small muted">
          {l}
        </p>
      ))}
      {outcome.failed.length > 0 && (
        <details className="im-failed">
          <summary className="small">{n(outcome.failed.length)} 项没能导入</summary>
          <ul>
            {outcome.failed.map((f, i) => (
              <li key={i} className="small">
                <span className="muted">{KIND_TEXT[f.kind]}</span> {f.label}：{f.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export default function ImportSection() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [privateAll, setPrivateAll] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const zipInput = useRef<HTMLInputElement | null>(null);
  const running = state.kind === 'running';
  const busy = running || state.kind === 'reading';

  useEffect(() => () => abort.current?.abort(), []);

  // leaving the page stops the import: ask first
  useEffect(() => {
    if (!running) return;
    const stay = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', stay);
    return () => window.removeEventListener('beforeunload', stay);
  }, [running]);

  async function read(kind: 'folder' | 'zip', input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length || busy) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setState({ kind: 'reading' });
    try {
      const source = kind === 'folder' ? folderSource(files) : await zipSource(files);
      const plan = await planImport(source, ctl.signal);
      setState({ kind: 'planned', source, plan });
    } catch (e) {
      setState(ctl.signal.aborted ? { kind: 'idle' } : { kind: 'failed', message: errMsg(e, '没能读出这份导出') });
    } finally {
      abort.current = null;
    }
  }

  async function start() {
    if (state.kind !== 'planned') return;
    const { source, plan } = state;
    const ctl = new AbortController();
    abort.current = ctl;
    setState({ kind: 'running', progress: null });
    let frame = 0;
    let latest: ImportProgress | null = null;
    try {
      const outcome = await runImport({
        plan,
        source,
        privateAll,
        origin: location.origin,
        signal: ctl.signal,
        parallel: processLimit(deviceHints()),
        resize: (file) => processFile(file),
        send: uploadPhoto,
        // one render a frame, however fast it goes
        onProgress: (p) => {
          latest = p;
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            setState((s) => (s.kind === 'running' ? { ...s, progress: latest } : s));
          });
        }
      });
      setState({ kind: 'done', outcome });
    } catch (e) {
      setState(
        e instanceof ImportStopped
          ? { kind: 'stopped', outcome: e.outcome, message: e.message }
          : { kind: 'failed', message: errMsg(e, '导入没能完成') }
      );
    } finally {
      cancelAnimationFrame(frame);
      abort.current = null;
      // whatever came in shows on every page
      invalidate('/api');
    }
  }

  const planned = state.kind === 'planned' ? state : null;
  const plan = planned?.plan;
  const counts = plan
    ? [
        `${n(plan.archive.entries.length)} 条记录`,
        `${n(plan.archive.photos.length)} 张照片`,
        plan.archive.projects.length > 0 && `${n(plan.archive.projects.length)} 个项目`,
        plan.archive.collections.length > 0 && `${n(plan.archive.collections.length)} 个合集`,
        plan.bytes > 0 && `要上传 ${fmtBytes(plan.bytes)}`
      ].filter((c) => c !== false)
    : [];

  return (
    <section className="se-section sf-panel" id="import" aria-labelledby="se-import-h">
      <h2 className="sf-h" id="se-import-h">
        导入
      </h2>

      <input
        ref={(el) => {
          folderInput.current = el;
          el?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        hidden
        onChange={(e) => void read('folder', e.currentTarget)}
      />
      <input ref={zipInput} type="file" accept=".zip,application/zip" multiple hidden onChange={(e) => void read('zip', e.currentTarget)} />

      {planned && plan ? (
        <>
          <div className="stack" style={{ ['--gap' as string]: '6px' }}>
            <p className="se-lede">
              「{planned.source.root || 'living.json'}」
              {plan.archive.exportedAt && <span className="muted"> {fmtDay(plan.archive.exportedAt)} 导出</span>}
            </p>
            <p className="se-lede muted">
              {counts.map((c, i) => (
                <Fragment key={c}>
                  {i > 0 && ' · '}
                  <span className="ex-count">{c}</span>
                </Fragment>
              ))}
            </p>
            {planLines(plan).map((l) => (
              <p key={l} className="small muted im-line">
                {l}
              </p>
            ))}
          </div>
          <Toggle label="全部设为私密" checked={privateAll} onChange={setPrivateAll} />
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => void start()}>
              开始导入
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setState({ kind: 'idle' })}>
              取消
            </button>
          </div>
        </>
      ) : (
        <>
          {!running && <p className="se-lede muted">选导出的文件夹，或者导出的全部 zip。已经在这里的会跳过，不会覆盖。</p>}
          {!running && (
            <div className="row">
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => folderInput.current?.click()}>
                选文件夹
              </button>
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => zipInput.current?.click()}>
                选 zip
              </button>
            </div>
          )}
        </>
      )}

      {state.kind === 'reading' && (
        <p className="small muted" role="status">
          正在读取导出…
        </p>
      )}

      {state.kind === 'running' && (
        <div className="ex-progress" role="status" aria-live="polite">
          <div
            className="up-progress"
            role="progressbar"
            aria-label="导入进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fraction(state.progress) * 100)}
          >
            <span style={{ width: `${Math.round(fraction(state.progress) * 100)}%` }} />
          </div>
          <div className="row">
            <span className="small muted ex-grow">{progressText(state.progress)}</span>
            <button type="button" className="btn btn-quiet" onClick={() => abort.current?.abort()}>
              取消
            </button>
          </div>
        </div>
      )}

      {state.kind === 'done' && (
        <div className="ex-done" role="status">
          <p className="sf-ok">导入完成</p>
          <Outcome outcome={state.outcome} />
        </div>
      )}
      {state.kind === 'stopped' && (
        <div className="ex-done" role="alert">
          <p className="error-text">{state.message}</p>
          <Outcome outcome={state.outcome} />
        </div>
      )}
      {state.kind === 'failed' && (
        <p className="error-text" role="alert">
          {state.message}
        </p>
      )}
    </section>
  );
}
