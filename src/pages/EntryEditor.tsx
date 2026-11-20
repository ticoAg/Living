import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { isDay } from '../../shared/days';
import { ENTRY_STATUS_LABELS, ENTRY_TYPE_LABELS, entryLabel } from '../../shared/entries';
import { entryTypeFor } from '../../shared/projects';
import { ENTRY_LIMITS } from '../../shared/limits';
import {
  ENTRY_TYPES,
  VISIBILITIES,
  type EntryDetail,
  type EntryStatus,
  type EntryType,
  type ProjectDetail,
  type SessionUser,
  type Visibility
} from '../../shared/types';
import { LoadError, Loading } from '../browse/ui';
import { useQuery } from '../browse/url';
import AutoTextarea from '../components/AutoTextarea';
import { Icon } from '../components/icons';
import Img from '../components/Img';
import PhotoPicker from '../components/PhotoPicker';
import AttachmentsField from '../attachments/AttachmentsField';
import {
  addAttachments,
  addMedia,
  clearBackup,
  draftFromEntry,
  emptyDraft,
  isEmptyDraft,
  moveMedia,
  payloadOf,
  readBackup,
  type Backup,
  type EntryDraft
} from '../entries/draft';
import EntryPlaceField from '../entries/EntryPlaceField';
import Markdown from '../entries/Markdown';
import { handoffOf, handsOver, NO_HANDOFF, type Start } from '../entries/handoff';
import { SignedOut } from '../entries/ui';
import { useEntryAutosave, type SaveState } from '../entries/useEntryAutosave';
import { ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { setCached, useApi } from '../lib/useApi';
import { projectPath } from '../projects/api';
import EntryProjects from '../projects/EntryProjects';
import TagPicker from '../studio/TagPicker';
import { applyTagEdit } from '../studio/tag-board';
import { useDocumentTitle } from '../themes/hooks';
import { VISIBILITY_LABEL } from '../themes/util';
import '../styles/studio.css';
import '../styles/entries.css';

// /entries/new and /e/:id/edit — writing an entry. Everything saves itself (entries/useEntryAutosave.ts): a new entry
// becomes a draft with its first words and moves to its own address; 完成 finishes it and opens it to read.
// Docs: /docs/product/features/entries.md

const VISIBILITY_HINT: Record<Visibility, string> = {
  public: '完成后出现在你的主页，任何人都能读到。',
  unlisted: '完成后不进入列表，知道链接的人可以读到。',
  private: '只有你能看到。'
};

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function statusLine(state: SaveState): { text: string; kind?: 'ok' | 'error' | 'dirty' } {
  switch (state.kind) {
    case 'saving':
      return { text: '保存中…' };
    case 'saved':
      return { text: `已保存 ${hhmm(state.at)}`, kind: 'ok' };
    case 'pending':
      return { text: '有改动', kind: 'dirty' };
    case 'empty':
      return { text: '写点什么，或者加照片、附件' };
    case 'invalid':
    case 'error':
      return { text: state.text, kind: 'error' };
    case 'conflict':
      return { text: '这条记录在别的窗口或设备上改过了', kind: 'error' };
    case 'gone':
      return { text: '这条记录已经被删除了', kind: 'error' };
    default:
      return { text: '' };
  }
}

function fmtBackupTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm(d)}`;
}

interface EditorProps {
  user: SessionUser;
  initial: EntryDetail | null;
  /** what the quick note or the library carried over */
  handoff: Start;
  /** a new entry's project, when it is written from the project's page */
  project: ProjectDetail | null;
  /** the day a new entry starts on, when not today */
  startDate: string | null;
  onCreated: (entry: EntryDetail) => void;
}

function Editor({ user, initial, handoff, project, startDate, onCreated }: EditorProps) {
  const id = useId();
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState<EntryDraft>(() =>
    initial
      ? draftFromEntry(initial)
      : emptyDraft(new Date(), handoff.body, {
          ...(project ? { projectIds: [project.id], type: entryTypeFor(project.type) } : {}),
          ...(startDate ? { date: startDate } : {}),
          attachments: handoff.attachments,
          photos: handoff.photos
        })
  );
  // a copy kept on this device that the server does not have: offered once, as the editor opens
  const [offer, setOffer] = useState<Backup | null>(() => {
    if (!initial && handsOver(handoff)) return null;
    const b = readBackup(user.id, initial?.id ?? null);
    if (!b) return null;
    const server = JSON.stringify(payloadOf(initial ? draftFromEntry(initial) : emptyDraft()));
    return JSON.stringify(payloadOf(b.draft)) === server ? null : b;
  });
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [picking, setPicking] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // files going up, or a recording on: finished only once they are in
  const [attaching, setAttaching] = useState(false);

  const { entry, state, unsaved, save, keepMine, takeTheirs, saveAsNew, remove } = useEntryAutosave({
    userId: user.id,
    initial,
    draft,
    setDraft,
    onCreated
  });
  const status: EntryStatus = entry?.status ?? 'draft';
  const set = <K extends keyof EntryDraft>(k: K, v: EntryDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  useDocumentTitle(entryLabel(draft.title, draft.body) || (initial ? '编辑记录' : '新记录'));

  const empty = isEmptyDraft(draft);
  const blocked = state.kind === 'conflict' || state.kind === 'gone';

  async function finish() {
    if (attaching) return;
    const done = await save(status === 'draft' ? 'published' : undefined);
    if (done) navigate(`/e/${done.id}`);
  }

  async function changeStatus(next: EntryStatus) {
    await save(next);
  }

  async function destroy() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await remove();
      navigate('/archive');
    } catch (e) {
      setDeleting(false);
      setDeleteError(e instanceof ApiError ? e.message : '网络不可用，请稍后再试');
    }
  }

  // Ctrl/Cmd+S saves now, Ctrl/Cmd+Enter finishes
  const keys = useRef({ save, finish });
  keys.current = { save, finish };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        void keys.current.save();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void keys.current.finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const photoIds = useMemo(() => new Set(draft.media.map((m) => m.photoId)), [draft.media]);
  const mediaPhotos = useMemo(() => draft.media.map((m) => m.photo), [draft.media]);
  const hiddenPhotos = draft.media.filter((m) => m.photo?.visibility === 'private').length;
  const saveLine = statusLine(state);
  const line = attaching && saveLine.kind !== 'error' ? { text: '附件上传中…', kind: undefined } : saveLine;
  const bodyLeft = ENTRY_LIMITS.bodyMax - [...draft.body].length;

  return (
    <main className="page-narrow en ee">
      <h1 className="visually-hidden">{initial ? '编辑记录' : '新记录'}</h1>

      {offer && (
        <div className="notice ee-banner" role="alert">
          <p>这台设备上有一份没保存上的修改{fmtBackupTime(offer.at) && `（${fmtBackupTime(offer.at)}）`}。</p>
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setDraft(offer.draft);
                setOffer(null);
              }}
            >
              恢复
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                clearBackup(user.id, initial?.id ?? null);
                setOffer(null);
              }}
            >
              丢弃
            </button>
          </div>
        </div>
      )}
      {state.kind === 'conflict' && (
        <div className="notice ee-banner ee-banner-warn" role="alert">
          <p>这条记录在别的窗口或设备上改过了。这里的修改先不保存，选一份留下：</p>
          <div className="row">
            <button type="button" className="btn btn-quiet" onClick={() => void takeTheirs()}>
              载入那边的版本
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => void keepMine()}>
              用这里的覆盖
            </button>
          </div>
        </div>
      )}
      {state.kind === 'gone' && (
        <div className="notice ee-banner ee-banner-warn" role="alert">
          <p>这条记录已经在别处删除了。</p>
          <div className="row">
            <button type="button" className="btn btn-quiet" onClick={() => void saveAsNew()}>
              另存为新记录
            </button>
          </div>
        </div>
      )}

      <div className="ee-when">
        <label className="visually-hidden" htmlFor={`${id}-type`}>
          类型
        </label>
        <select id={`${id}-type`} className="select ee-type" value={draft.type} onChange={(e) => set('type', e.target.value as EntryType)}>
          {ENTRY_TYPES.map((t) => (
            <option key={t} value={t}>
              {ENTRY_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <label className="visually-hidden" htmlFor={`${id}-date`}>
          日期
        </label>
        <input id={`${id}-date`} type="date" className="input" required value={draft.date} onChange={(e) => set('date', e.target.value)} />
        <label className="visually-hidden" htmlFor={`${id}-time`}>
          时间
        </label>
        <input id={`${id}-time`} type="time" className="input" value={draft.time} onChange={(e) => set('time', e.target.value)} />
        {draft.time ? (
          <button type="button" className="btn btn-ghost ee-allday" onClick={() => set('time', '')}>
            全天
          </button>
        ) : (
          <span className="small muted">全天</span>
        )}
      </div>

      <label className="visually-hidden" htmlFor={`${id}-title`}>
        标题
      </label>
      <input
        id={`${id}-title`}
        className="ee-title"
        placeholder="标题"
        value={draft.title}
        maxLength={ENTRY_LIMITS.titleMax}
        onChange={(e) => set('title', e.target.value)}
      />

      <div className="ee-body-head">
        <div className="seg" role="group" aria-label="编辑与预览">
          <button type="button" aria-pressed={tab === 'write'} onClick={() => setTab('write')}>
            编辑
          </button>
          <button type="button" aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>
            预览
          </button>
        </div>
        {bodyLeft < 2000 && (
          <span className="small mono" data-over={bodyLeft < 0 || undefined}>
            {bodyLeft}
          </span>
        )}
      </div>
      {tab === 'write' ? (
        <>
          <label className="visually-hidden" htmlFor={`${id}-body`}>
            正文
          </label>
          <AutoTextarea
            id={`${id}-body`}
            className="ee-body"
            placeholder="正文，可以用 Markdown"
            value={draft.body}
            onChange={(e) => set('body', e.target.value)}
            autoFocus={!initial}
          />
        </>
      ) : (
        <div className="ee-preview">{draft.body.trim() ? <Markdown text={draft.body} /> : <p className="muted">还没有正文</p>}</div>
      )}

      <section className="ee-sec" aria-labelledby={`${id}-photos`}>
        <div className="ee-sec-head">
          <h2 id={`${id}-photos`} className="ee-h">
            照片
          </h2>
          <button type="button" className="btn btn-quiet" onClick={() => setPicking(true)}>
            <Icon name="plus" size={18} />
            添加
          </button>
        </div>
        {draft.media.length > 0 && (
          <ol className="ee-media">
            {draft.media.map((m, i) => (
              <li key={m.photoId} className="ee-photo">
                <Link href={`/p/${m.photoId}`} className="ee-thumb" aria-label={`第 ${i + 1} 张照片`}>
                  {m.photo ? <Img photo={m.photo} ratio="1 / 1" sizes="112px" alt="" /> : <span className="ee-thumb-blank" />}
                </Link>
                <label className="visually-hidden" htmlFor={`${id}-cap-${m.photoId}`}>
                  第 {i + 1} 张照片的说明
                </label>
                <AutoTextarea
                  id={`${id}-cap-${m.photoId}`}
                  className="textarea ee-caption"
                  placeholder="说明"
                  rows={1}
                  maxLength={ENTRY_LIMITS.captionMax}
                  value={m.caption}
                  onChange={(e) => {
                    const caption = e.target.value;
                    setDraft((d) => ({ ...d, media: d.media.map((x) => (x.photoId === m.photoId ? { ...x, caption } : x)) }));
                  }}
                />
                <div className="ee-photo-tools">
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    aria-label={`上移第 ${i + 1} 张`}
                    disabled={i === 0}
                    onClick={() => setDraft((d) => ({ ...d, media: moveMedia(d.media, i, -1) }))}
                  >
                    <Icon name="up" size={18} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    aria-label={`下移第 ${i + 1} 张`}
                    disabled={i === draft.media.length - 1}
                    onClick={() => setDraft((d) => ({ ...d, media: moveMedia(d.media, i, 1) }))}
                  >
                    <Icon name="down" size={18} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    aria-label={`移除第 ${i + 1} 张`}
                    onClick={() => setDraft((d) => ({ ...d, media: d.media.filter((x) => x.photoId !== m.photoId) }))}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <AttachmentsField
        id={id}
        value={draft.attachments}
        onAdd={(a) => setDraft((d) => ({ ...d, attachments: addAttachments(d.attachments, [a]) }))}
        onCaption={(attachmentId, caption) =>
          setDraft((d) => ({ ...d, attachments: d.attachments.map((x) => (x.attachmentId === attachmentId ? { ...x, caption } : x)) }))
        }
        onMove={(i, by) => setDraft((d) => ({ ...d, attachments: moveMedia(d.attachments, i, by) }))}
        onRemove={(attachmentId) => setDraft((d) => ({ ...d, attachments: d.attachments.filter((x) => x.attachmentId !== attachmentId) }))}
        onBusyChange={setAttaching}
      />

      <EntryPlaceField value={draft.poi} photos={mediaPhotos} onChange={(poi) => set('poi', poi)} />

      <EntryProjects id={`${id}-projects`} value={draft.projectIds} onChange={(ids) => set('projectIds', ids)} />

      <section className="ee-sec" aria-labelledby={`${id}-tags`}>
        <h2 id={`${id}-tags`} className="ee-h">
          标签
        </h2>
        <TagPicker value={draft.tagIds} onEdit={(e) => setDraft((d) => ({ ...d, tagIds: applyTagEdit(d.tagIds, e) }))} />
      </section>

      <section className="ee-sec" aria-labelledby={`${id}-vis`}>
        <h2 id={`${id}-vis`} className="ee-h">
          公开范围
        </h2>
        <div className="seg" role="group" aria-labelledby={`${id}-vis`}>
          {[...VISIBILITIES].reverse().map((v) => (
            <button key={v} type="button" aria-pressed={draft.visibility === v} onClick={() => set('visibility', v)}>
              {VISIBILITY_LABEL[v]}
            </button>
          ))}
        </div>
        <p className="small muted">
          {VISIBILITY_HINT[draft.visibility]}照片各有自己的公开范围，不随记录改变{draft.attachments.length > 0 && '；附件随记录'}。
        </p>
        {draft.visibility !== 'private' && hiddenPhotos > 0 && (
          <p className="small ee-warn" role="note">
            有 {hiddenPhotos} 张照片仅自己可见，读者看不到它们。
          </p>
        )}
      </section>

      {entry && (
        <section className="ee-sec ee-status" aria-labelledby={`${id}-state`}>
          <h2 id={`${id}-state`} className="ee-h">
            {ENTRY_STATUS_LABELS[status]}
          </h2>
          {!confirmDelete ? (
            <div className="row">
              {status === 'published' && (
                <>
                  <button type="button" className="btn btn-quiet" disabled={blocked} onClick={() => void changeStatus('draft')}>
                    改回草稿
                  </button>
                  <button type="button" className="btn btn-quiet" disabled={blocked} onClick={() => void changeStatus('archived')}>
                    归档
                  </button>
                </>
              )}
              {status === 'archived' && (
                <button type="button" className="btn btn-quiet" disabled={blocked} onClick={() => void changeStatus('published')}>
                  取消归档
                </button>
              )}
              <button id={`${id}-delete`} type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={18} />
                删除
              </button>
            </div>
          ) : (
            <div className="notice ee-confirm" role="alert">
              <p>确定删除这条记录吗？照片不会被删除，记录里的文字无法恢复。</p>
              {deleteError && <p className="error-text">{deleteError}</p>}
              <div className="row">
                <button type="button" className="btn btn-danger" disabled={deleting} onClick={() => void destroy()}>
                  {deleting ? '删除中…' : '确认删除'}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  autoFocus
                  disabled={deleting}
                  onClick={() => {
                    setConfirmDelete(false);
                    requestAnimationFrame(() => document.getElementById(`${id}-delete`)?.focus());
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="ee-bar">
        <div className="ee-bar-inner">
          <p className="ee-state" role={line.kind === 'error' ? 'alert' : 'status'} data-kind={line.kind}>
            {status !== 'published' && <span className="en-mark">{ENTRY_STATUS_LABELS[status]}</span>}
            {line.text}
            {state.kind === 'error' && (
              <button type="button" className="btn btn-ghost ee-retry" onClick={() => void save()}>
                重试
              </button>
            )}
          </p>
          <div className="row" style={{ gap: 8 }}>
            {entry && status !== 'draft' && !unsaved && (
              <Link href={`/e/${entry.id}`} className="btn btn-quiet">
                查看
              </Link>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={empty || blocked || attaching || state.kind === 'saving'}
              onClick={() => void finish()}
              aria-keyshortcuts="Control+Enter Meta+Enter"
            >
              完成
            </button>
          </div>
        </div>
      </div>

      <PhotoPicker
        open={picking}
        onClose={() => setPicking(false)}
        existing={photoIds}
        noun="记录"
        from={draft.date}
        to={draft.date}
        onAdd={(photos) => setDraft((d) => ({ ...d, media: addMedia(d.media, photos) }))}
      />
    </main>
  );
}

/** Which editor is open: a new address starts a new one, except the address the editor's own entry has just moved to. */
function useEditorSlot(id: string | null) {
  const [slot, setSlot] = useState<{ id: string | null; key: number; adopt: string | null }>({ id, key: 0, adopt: null });
  if (slot.id !== id) {
    setSlot({ id, key: slot.adopt !== null && slot.adopt === id ? slot.key : slot.key + 1, adopt: null });
  }
  const adopt = (created: string) => setSlot((s) => ({ ...s, adopt: created }));
  return { key: slot.key, adopt };
}

export default function EntryEditor() {
  const params = useParams<{ id?: string }>();
  const id = params.id ?? null;
  const { user, loading } = useSession();
  const [, navigate] = useLocation();
  const { key, adopt } = useEditorSlot(id);
  // read once per editor: later changes to the cached copy are this editor's own saves
  const { data, error, reload } = useApi<EntryDetail>(id && user ? `/api/entries/${encodeURIComponent(id)}` : null);
  const [handoff] = useState(() => handoffOf(history.state));
  // /entries/new?project=… starts the entry in that project, as the kind of entry the project keeps; ?date=YYYY-MM-DD
  // on that day
  const query = useQuery();
  const projectId = id ? null : query.get('project');
  const dateParam = id ? null : query.get('date');
  const startDate = dateParam && isDay(dateParam) ? dateParam : null;
  const project = useApi<ProjectDetail>(projectId && user ? projectPath(projectId) : null);

  if (loading) return <Loading />;
  if (!user) {
    return (
      <main className="page-narrow en">
        <SignedOut title="登录后写记录" next={id ? `/e/${id}/edit` : '/entries/new'} />
      </main>
    );
  }
  if (id && !data) {
    return (
      <main className="page-narrow en">
        {error ? (
          <LoadError
            error={error}
            onRetry={reload}
            notFound={{ title: '记录不存在，或你没有权限修改', back: { href: '/archive', label: '回到档案' } }}
          />
        ) : (
          <Loading />
        )}
      </main>
    );
  }
  if (data && data.ownerId !== user.id) {
    return (
      <main className="page-narrow en">
        <div className="en-empty">
          <p className="en-empty-title">只能修改自己的记录</p>
          <Link href={`/e/${data.id}`} className="btn">
            查看这条记录
          </Link>
        </div>
      </main>
    );
  }
  if (projectId && !project.data && !project.error) return <Loading />;
  return (
    <Editor
      key={key}
      user={user}
      initial={id ? (data ?? null) : null}
      handoff={id ? NO_HANDOFF : handoff}
      project={project.data?.ownerId === user.id ? project.data : null}
      startDate={startDate}
      onCreated={(e) => {
        adopt(e.id);
        setCached(`/api/entries/${e.id}`, e);
        navigate(`/e/${e.id}/edit`, { replace: true });
      }}
    />
  );
}
