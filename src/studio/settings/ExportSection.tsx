import { Fragment, useEffect, useRef, useState } from 'react';
import type { ExportSummary, SessionUser } from '../../../shared/types';
import { rootFolder, zipName } from '../../export/archive';
import { runExport, type ExportOutcome, type ExportProgress } from '../../export/run';
import { canPickFolder, FolderSink, PART_BYTES, pickFolder, ZipSink, type ExportSink } from '../../export/sinks';
import { fmtBytes, localDay } from '../../lib/format';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/useApi';
import { Toggle } from '../ui';
import { errMsg } from '../util';

// The whole archive to take away: entries, projects and collections as Markdown, everything in living.json, and the
// photos' originals. As ZIP parts, or into a folder (Chrome, Edge), where the next export downloads only what is new.
// Docs: /docs/product/features/export.md

interface Part {
  name: string;
  url: string;
  size: number;
}

type State =
  | { kind: 'idle' }
  | { kind: 'running'; to: 'zip' | 'folder'; progress: ExportProgress | null }
  | { kind: 'done'; to: 'zip' | 'folder'; outcome: ExportOutcome; folder?: string }
  | { kind: 'failed'; message: string };

const n = (v: number) => v.toLocaleString('zh-CN');

function progressText(p: ExportProgress | null): string {
  if (!p) return '准备导出';
  switch (p.phase) {
    case 'reading':
      return `读取档案 ${n(p.rows)} / ${n(p.totalRows)}`;
    case 'media':
      return `照片 ${n(p.photos)} / ${n(p.totalPhotos)} · ${fmtBytes(p.bytes)} / ${fmtBytes(p.totalBytes)}`;
    case 'writing':
      return '写入记录、项目、合集和 living.json';
    case 'tidying':
      return '清理上次导出后删去的文件';
  }
}

/** 0–1: the rows while they are read, then the photos by their bytes. */
function fraction(p: ExportProgress | null): number {
  if (!p) return 0;
  if (p.phase === 'reading') return p.totalRows ? (p.rows / p.totalRows) * 0.05 : 0.05;
  if (p.phase === 'media') return 0.05 + (p.totalBytes ? p.bytes / p.totalBytes : p.totalPhotos ? p.photos / p.totalPhotos : 1) * 0.9;
  return 0.97;
}

function outcomeLines(o: ExportOutcome, originals: boolean): string[] {
  const lines: string[] = [];
  if (o.kept) lines.push(`${n(o.kept)} 张照片上次已经导出，这次没有再下载。`);
  if (o.large.length) lines.push(`${n(o.large.length)} 张照片缺少原文件，用 2560 像素的大图代替了。`);
  if (o.missing.length) lines.push(`${n(o.missing.length)} 张照片找不到文件，只有信息在 living.json 里。`);
  if (!originals && o.photos > o.files) lines.push(`${n(o.photos - o.files)} 张照片没有下载，只有信息在 living.json 里。`);
  if (o.removed) lines.push(`清理了 ${n(o.removed)} 个上次导出后删去的文件。`);
  return lines;
}

export default function ExportSection({ user }: { user: SessionUser }) {
  const { site } = useSession();
  const { data: summary, error } = useApi<ExportSummary>('/api/export');
  const [originals, setOriginals] = useState(true);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [parts, setParts] = useState<Part[]>([]);
  const abort = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);
  const running = state.kind === 'running';

  // the parts' URLs hold their bytes: let go of them on leaving
  useEffect(
    () => () => {
      abort.current?.abort();
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    []
  );

  // leaving the page stops the export: ask first
  useEffect(() => {
    if (!running) return;
    const stay = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', stay);
    return () => window.removeEventListener('beforeunload', stay);
  }, [running]);

  const root = rootFolder(user);

  function clearParts() {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
    setParts([]);
  }

  async function start(to: 'zip' | 'folder') {
    if (running) return;
    let sink: ExportSink;
    let folder: string | undefined;
    if (to === 'folder') {
      try {
        // the picker needs the click: nothing may be awaited before it
        const dir = await pickFolder(root);
        folder = dir.name;
        sink = new FolderSink(dir);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setState({ kind: 'failed', message: errMsg(e, '没能打开这个文件夹') });
        return;
      }
    } else {
      const day = localDay();
      sink = new ZipSink(root, (blob, index, last) => {
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        const name = zipName(root, day, index === 1 && last ? null : index);
        setParts((ps) => [...ps, { name, url, size: blob.size }]);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
      });
    }
    clearParts();
    const ctl = new AbortController();
    abort.current = ctl;
    setState({ kind: 'running', to, progress: null });
    let frame = 0;
    let latest: ExportProgress | null = null;
    try {
      const outcome = await runExport({
        sink,
        originals,
        site: site ?? { name: 'Living', url: location.origin },
        signal: ctl.signal,
        // one render a frame, however fast the photos go
        onProgress: (p) => {
          latest = p;
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            setState((s) => (s.kind === 'running' ? { ...s, progress: latest } : s));
          });
        }
      });
      setState({ kind: 'done', to, outcome, folder });
    } catch (e) {
      setState({ kind: 'failed', message: ctl.signal.aborted ? '已取消' : errMsg(e, '导出没能完成') });
    } finally {
      cancelAnimationFrame(frame);
      abort.current = null;
    }
  }

  const counts = summary?.counts;
  const zipParts = summary && originals ? Math.max(1, Math.ceil(summary.originalBytes / PART_BYTES)) : 1;

  return (
    <section className="se-section sf-panel" id="export" aria-labelledby="se-export-h">
      <h2 className="sf-h" id="se-export-h">
        导出
      </h2>

      <p className="se-lede muted">
        {counts ? (
          [
            `${n(counts.entries)} 条记录`,
            `${n(counts.photos)} 张照片`,
            counts.projects > 0 && `${n(counts.projects)} 个项目`,
            counts.themes > 0 && `${n(counts.themes)} 个合集`,
            summary.originalBytes > 0 && `原文件 ${fmtBytes(summary.originalBytes)}`
          ]
            .filter((c) => c !== false)
            .map((c, i) => (
              <Fragment key={c}>
                {i > 0 && ' · '}
                <span className="ex-count">{c}</span>
              </Fragment>
            ))
        ) : error ? (
          <span className="error-text">{errMsg(error)}</span>
        ) : (
          '\u00a0'
        )}
      </p>

      <Toggle label="包含照片原文件" checked={originals} onChange={setOriginals} disabled={running} />

      <div className="stack" style={{ ['--gap' as string]: '8px' }}>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={running || !summary} onClick={() => void start('zip')}>
            下载 zip
          </button>
          {canPickFolder() && (
            <button type="button" className="btn btn-quiet" disabled={running || !summary} onClick={() => void start('folder')}>
              导出到文件夹
            </button>
          )}
        </div>
        {!running && zipParts > 1 && <p className="small muted">zip 会分成 {zipParts} 个，每个约 1 GB。</p>}
        {!running && canPickFolder() && <p className="small muted">再次导出到同一个文件夹，只下载新加的照片。</p>}
      </div>

      {state.kind === 'running' && (
        <div className="ex-progress" role="status" aria-live="polite">
          <div
            className="up-progress"
            role="progressbar"
            aria-label="导出进度"
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
          <p className="sf-ok">{state.to === 'folder' ? `已导出到「${state.folder}」` : '导出完成'}</p>
          {outcomeLines(state.outcome, originals).map((l) => (
            <p key={l} className="small muted">
              {l}
            </p>
          ))}
        </div>
      )}
      {state.kind === 'failed' && (
        <p className="error-text" role="alert">
          {state.message}
        </p>
      )}

      {parts.length > 0 && (
        <ul className="ex-parts">
          {parts.map((p) => (
            <li key={p.url}>
              <a href={p.url} download={p.name}>
                {p.name}
              </a>
              <span className="small muted">{fmtBytes(p.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
