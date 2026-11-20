import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ENTRY_STATUS_LABELS } from '../../shared/entries';
import type { LibraryAttachment, LibraryResponse, PhotoListResponse, PhotoSummary } from '../../shared/types';
import { attachmentFacts, fileUrl, KIND_ICON, posterUrl } from '../attachments/kinds';
import { setBrowseList } from '../browse/context';
import { useScrollTop } from '../browse/hooks';
import LibraryTabs from '../browse/LibraryTabs';
import { EmptyState, LoadError, Loading, TruncatedNote } from '../browse/ui';
import { replaceQuery, useQuery } from '../browse/url';
import { Icon } from '../components/icons';
import Img from '../components/Img';
import type { Handoff } from '../entries/handoff';
import { api, ApiError } from '../lib/api';
import { fmtBytes, fmtDay } from '../lib/format';
import { useSession } from '../lib/session';
import { invalidate, useApi } from '../lib/useApi';
import {
  attachmentsShown,
  entryStart,
  kindParam,
  LIBRARY_KIND_LABEL,
  LIBRARY_KINDS,
  photosShown,
  purgeText,
  selectable,
  showParam,
  type Show
} from '../library/model';
import { encodeNext } from '../studio/util';
import { VISIBILITY_LABEL } from '../themes/util';
import '../styles/attachments.css';
import '../styles/browse.css';
import '../styles/library.css';

// The library (媒体库): one's photos, videos, recordings and other files, how many and how big; which are in no entry,
// and when the cleanup deletes a loose file; picked ones start a new entry. State in the address: ?kind=video&show=loose
// Docs: /docs/product/features/library.md

const PAGE = 240;
const count = (n: number) => n.toLocaleString('en-US');
const entryHref = (e: { id: string; status: string }) => (e.status === 'draft' ? `/e/${e.id}/edit` : `/e/${e.id}`);

export default function Library() {
  useScrollTop(null);
  const { user, loading } = useSession();
  if (loading) return <Loading />;
  if (!user) {
    return (
      <main className="page bw lib">
        <LibraryTabs />
        <EmptyState title="登录后查看自己的媒体库">
          <Link href={`/login?next=${encodeNext('/library')}`} className="btn btn-primary">
            登录
          </Link>
        </EmptyState>
      </main>
    );
  }
  return <Shelf />;
}

function Shelf() {
  const q = useQuery();
  const kind = kindParam(q.get('kind'));
  const show = showParam(q.get('show'), kind);
  const [, navigate] = useLocation();
  const photosReq = useApi<PhotoListResponse>('/api/photos?mine=1');
  const libReq = useApi<LibraryResponse>('/api/library');
  const lib = libReq.data;
  const photos = photosReq.data?.photos;

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [kind, show]);

  const inEntries = useMemo(() => new Set(lib?.entryPhotoIds ?? []), [lib]);
  const shownPhotos = useMemo(() => (photos && lib ? photosShown(photos, show, inEntries) : []), [photos, lib, show, inEntries]);
  const shownFiles = useMemo(() => (lib && kind !== 'photos' ? attachmentsShown(lib.attachments, kind, show) : []), [lib, kind, show]);
  // the photo page steps through the photos shown here
  useEffect(() => {
    if (kind === 'photos')
      setBrowseList(
        shownPhotos.map((p) => p.id),
        false
      );
  }, [kind, shownPhotos]);

  const start = useMemo(() => entryStart(selected, photos ?? [], lib?.attachments ?? []), [selected, photos, lib]);
  const picked = start.photos.length + start.attachments.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const write = () => {
    if (!picked || start.problem) return;
    const handoff: Handoff = { livingEntryPhotos: start.photos, livingEntryAttachments: start.attachments };
    navigate(start.date ? `/entries/new?date=${start.date}` : '/entries/new', { state: handoff });
  };

  const error = photosReq.error ?? libReq.error;
  if (error) {
    return (
      <main className="page bw lib">
        <LibraryTabs />
        <LoadError
          error={error}
          onRetry={() => {
            if (photosReq.error) photosReq.reload();
            if (libReq.error) libReq.reload();
          }}
        />
      </main>
    );
  }

  const total = lib ? LIBRARY_KINDS.reduce((n, k) => n + lib.usage[k].bytes, 0) : 0;
  const shows: [Show, string, number][] =
    kind === 'photos'
      ? [
          ['all', '全部', photos?.length ?? 0],
          ['loose', '不在记录里', photos?.filter((p) => !inEntries.has(p.id)).length ?? 0],
          ...(['public', 'unlisted', 'private'] as const).map((v): [Show, string, number] => [
            v,
            VISIBILITY_LABEL[v],
            photos?.filter((p) => p.visibility === v).length ?? 0
          ])
        ]
      : [
          ['all', '全部', lib?.attachments.filter((a) => a.kind === kind).length ?? 0],
          ['loose', '不在记录里', lib?.attachments.filter((a) => a.kind === kind && a.state !== 'attached').length ?? 0]
        ];
  const anything = kind === 'photos' ? (photos?.length ?? 0) > 0 : shows[0][2] > 0;
  const limited = kind === 'photos' ? photosReq.data?.truncated === true : lib?.truncated === true;

  let body: ReactNode;
  if (!photos || !lib) {
    body = <Loading />;
  } else if (!anything) {
    body = (
      <EmptyState title={`还没有${LIBRARY_KIND_LABEL[kind]}`}>
        <Link href={kind === 'photos' ? '/upload' : '/entries/new'} className="btn">
          <Icon name={kind === 'photos' ? 'upload' : 'edit'} size={18} />
          {kind === 'photos' ? '上传照片' : '写一条记录'}
        </Link>
      </EmptyState>
    );
  } else if (kind === 'photos' ? shownPhotos.length === 0 : shownFiles.length === 0) {
    body = (
      <EmptyState title="没有符合的">
        <button type="button" className="btn" onClick={() => replaceQuery({ show: null })}>
          清除筛选
        </button>
      </EmptyState>
    );
  } else if (kind === 'photos') {
    body = (
      <>
        <ul className="lib-grid">
          {shownPhotos.slice(0, limit).map((p) => (
            <li key={p.id}>
              <PhotoCell photo={p} selecting={selecting} on={selected.has(p.id)} onToggle={() => toggle(p.id)} />
            </li>
          ))}
        </ul>
        {shownPhotos.length > limit && (
          <div className="lib-more">
            <button type="button" className="btn" onClick={() => setLimit((n) => n + PAGE)}>
              显示更多（还有 {count(shownPhotos.length - limit)} 张）
            </button>
          </div>
        )}
      </>
    );
  } else {
    body = (
      <ul className="lib-files">
        {shownFiles.map((a) => (
          <li key={a.id}>
            <FileRow a={a} selecting={selecting} on={selected.has(a.id)} onToggle={() => toggle(a.id)} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main className="page bw lib" data-selecting={selecting || undefined}>
      <LibraryTabs />
      <div className="lib-head">
        <h1 className="display lib-h1">媒体库</h1>
        {lib && <p className="lib-total mono">{fmtBytes(total)}</p>}
      </div>

      <div className="lib-kinds" role="group" aria-label="类型">
        {LIBRARY_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="lib-kind"
            aria-pressed={kind === k}
            onClick={() => replaceQuery({ kind: k === 'photos' ? null : k, show: null })}
          >
            <span className="lib-kind-name">{LIBRARY_KIND_LABEL[k]}</span>
            <span className="lib-kind-n mono">{lib ? count(lib.usage[k].count) : '–'}</span>
            <span className="lib-kind-size mono">{lib ? fmtBytes(lib.usage[k].bytes) : ''}</span>
          </button>
        ))}
      </div>

      <div className="lib-tools">
        <div className="lib-shows" role="group" aria-label="筛选">
          {shows.map(([s, label, n]) => (
            <button
              key={s}
              type="button"
              className="chip"
              aria-pressed={show === s}
              onClick={() => replaceQuery({ show: s === 'all' ? null : s })}
            >
              {label}
              <span className="mono lib-show-n">{count(n)}</span>
            </button>
          ))}
        </div>
        {anything && (
          <button
            type="button"
            className="btn btn-quiet"
            aria-pressed={selecting}
            onClick={selecting ? stopSelecting : () => setSelecting(true)}
          >
            <Icon name={selecting ? 'close' : 'check'} size={16} />
            {selecting ? '取消' : '选择'}
          </button>
        )}
      </div>
      {limited &&
        (kind === 'photos' ? (
          <TruncatedNote className="lib-limit" />
        ) : (
          <p className="bw-limit lib-limit">只显示最近的 {count(lib?.attachments.length ?? 0)} 个</p>
        ))}

      {body}

      {selecting && (
        <div className="lib-bar">
          <p className="lib-bar-n" aria-live="polite">
            已选 <b className="mono">{picked}</b>
            {start.problem && <span className="lib-bar-problem">{start.problem}</span>}
          </p>
          {selected.size > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => setSelected(new Set())}>
              清除选择
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!picked || !!start.problem} onClick={write}>
            <Icon name="edit" size={16} />
            写一条记录
          </button>
        </div>
      )}
    </main>
  );
}

function PhotoCell({ photo: p, selecting, on, onToggle }: { photo: PhotoSummary; selecting: boolean; on: boolean; onToggle: () => void }) {
  const label = [p.title, fmtDay(p.takenAt) || '无日期', p.visibility === 'public' ? '' : `${VISIBILITY_LABEL[p.visibility]}可见`]
    .filter(Boolean)
    .join('，');
  const inner = (
    <>
      <Img photo={p} ratio="1 / 1" sizes="(max-width: 640px) 34vw, 180px" alt="" />
      <span className="lib-date mono">{p.takenAt ? fmtDay(p.takenAt) : '无日期'}</span>
      {on && (
        <span className="lib-check" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
      )}
    </>
  );
  return selecting ? (
    <button type="button" className="lib-cell" aria-pressed={on} aria-label={label} onClick={onToggle}>
      {inner}
    </button>
  ) : (
    <Link href={`/p/${p.id}`} className="lib-cell" aria-label={label}>
      {inner}
    </Link>
  );
}

/** Where it is: its entry and who may see it, or when it goes. */
function Where({ a }: { a: LibraryAttachment }) {
  if (a.entry) {
    const marks = [
      a.entry.status === 'published' ? '' : ENTRY_STATUS_LABELS[a.entry.status],
      `${VISIBILITY_LABEL[a.entry.visibility]}${a.entry.visibility === 'public' ? '' : '可见'}`
    ].filter(Boolean);
    return (
      <p className="small lib-where">
        <Link href={entryHref(a.entry)} className="bw-hydro">
          {a.entry.label}
        </Link>
        <span className="muted">
          {' '}
          · {fmtDay(a.entry.occurredAt)} · {marks.join(' · ')}
        </span>
      </p>
    );
  }
  return (
    <p className="small lib-where" data-loose="true">
      {a.state === 'uploading' ? '没传完' : '不在记录里'}
      {a.purgeAt && <span> · {purgeText(a.purgeAt)}</span>}
    </p>
  );
}

function FileRow({ a, selecting, on, onToggle }: { a: LibraryAttachment; selecting: boolean; on: boolean; onToggle: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const uploaded = a.state !== 'uploading';
  const canPick = selecting && selectable(a);
  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api(`/api/attachments/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
      invalidate('/api/attachments');
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : '删除失败，请稍后再试');
      setBusy(false);
    }
  };
  const thumb = (
    <span className="att-thumb lib-thumb">
      {a.poster ? <img src={posterUrl(a.id)} alt="" loading="lazy" /> : <Icon name={KIND_ICON[a.kind]} size={24} />}
      {on && (
        <span className="lib-check" aria-hidden="true">
          <Icon name="check" size={16} />
        </span>
      )}
    </span>
  );
  return (
    <div className="lib-file" data-on={on || undefined}>
      {canPick ? (
        <button type="button" className="lib-file-pick" aria-pressed={on} aria-label={`选择 ${a.name}`} onClick={onToggle}>
          {thumb}
        </button>
      ) : (
        thumb
      )}
      <div className="att-main">
        {uploaded ? (
          <a className="att-name bw-hydro" href={fileUrl(a.id)} target="_blank" rel="noopener">
            {a.name}
          </a>
        ) : (
          <p className="att-name">{a.name}</p>
        )}
        <p className="small muted mono">{[attachmentFacts(a), fmtDay(a.uploadedAt ?? a.createdAt)].filter(Boolean).join(' · ')}</p>
        <Where a={a} />
        {problem && (
          <p className="small error-text" role="alert">
            {problem}
          </p>
        )}
      </div>
      <div className="lib-file-tools">
        {uploaded && (
          <a className="btn btn-ghost btn-icon" href={fileUrl(a.id, true)} download={a.name} aria-label={`下载 ${a.name}`}>
            <Icon name="download" size={18} />
          </a>
        )}
        {!a.entry &&
          (confirm ? (
            <>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>
                确认删除
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setConfirm(false)}>
                取消
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost btn-icon" aria-label={`删除 ${a.name}`} onClick={() => setConfirm(true)}>
              <Icon name="trash" size={18} />
            </button>
          ))}
      </div>
    </div>
  );
}
