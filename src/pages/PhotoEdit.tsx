import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import type { PhotoDetail, Poi } from '../../shared/types';
import { Icon } from '../components/icons';
import Img from '../components/Img';
import { ApiError, api, mediaUrl } from '../lib/api';
import { invalidate, useApi } from '../lib/useApi';
import ExifList from '../studio/ExifList';
import { useMatch, type PlaceChoice } from '../studio/match';
import PhotoFields from '../studio/PhotoFields';
import { diffDraft, draftOf, unwrapPhoto, type Draft } from '../studio/photo-draft';
import PlacePicker, { PlaceSummary } from '../studio/PlacePicker';
import { ConfirmBar, PageHead } from '../studio/ui';
import { errMsg, fmtStamp, useRequireLogin, useTitle } from '../studio/util';
import '../styles/studio.css';

// /studio/photo/:id — change title, note, tags, place, privacy and focus of one of your photos, or delete it.
// Docs: /docs/product/features/upload.md#编辑

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The preview: click (or use the arrow keys) to say where the subject is, so square and wide crops keep it. */
function FocusStage({ photo, focus, onChange }: { photo: PhotoDetail; focus: [number, number] | null; onChange: (f: [number, number] | null) => void }) {
  const box = useRef<HTMLDivElement>(null);

  const place = (e: MouseEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    onChange([round3(clamp01((e.clientX - r.left) / r.width)), round3(clamp01((e.clientY - r.top) / r.height))]);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.03;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = d[e.key];
    if (!move) return;
    e.preventDefault();
    const [x, y] = focus ?? [0.5, 0.5];
    onChange([round3(clamp01(x + move[0])), round3(clamp01(y + move[1]))]);
  };

  return (
    <div
      ref={box}
      className="pe-stage"
      tabIndex={0}
      role="group"
      aria-label={focus ? `焦点在横向 ${Math.round(focus[0] * 100)}%、纵向 ${Math.round(focus[1] * 100)}%。点击图片重设，或用方向键微调。` : '还没有设置焦点。点击图片设置，或用方向键开始。'}
      onClick={place}
      onKeyDown={onKey}
    >
      <img src={mediaUrl(photo.variants.m.key)} alt={photo.title ?? '照片预览'} draggable={false} style={{ aspectRatio: `${photo.width} / ${photo.height}` }} />
      {focus && <span className="pe-focus" style={{ left: `${focus[0] * 100}%`, top: `${focus[1] * 100}%` }} aria-hidden="true" />}
    </div>
  );
}

function PlaceEditor({ photo, value, onChange, disabled }: { photo: PhotoDetail; value: PlaceChoice | null; onChange: (c: PlaceChoice | null) => void; disabled?: boolean }) {
  const coords = photo.lat != null && photo.lng != null ? { lat: photo.lat, lng: photo.lng } : null;
  const m = useMatch(coords ? { ...coords, heading: photo.heading } : null);
  const [open, setOpen] = useState(false);
  const [extras, setExtras] = useState<Poi[]>([]);
  const started = useRef(false);
  const { start } = m;

  useEffect(() => {
    if (open && coords && !started.current) {
      started.current = true;
      void start();
    }
  }, [open, coords, start]);

  return (
    <section className="pe-section" aria-label="地点">
      <h2 className="sf-sub">地点</h2>
      <PlaceSummary value={value} onClear={() => onChange(null)} disabled={disabled} />
      <div>
        <button type="button" className="btn btn-quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={disabled}>
          <Icon name={open ? 'close' : 'pin'} size={16} />
          {open ? '收起' : coords ? '重新匹配或更换地点' : '更换地点'}
        </button>
      </div>
      {open && (
        <PlacePicker
          coords={coords}
          heading={photo.heading}
          match={coords ? m.state : null}
          onRadius={m.setRadius}
          onRetry={m.retry}
          value={value}
          onChange={onChange}
          extras={extras}
          onCreated={(poi) => setExtras((prev) => (prev.some((x) => x.id === poi.id) ? prev : [...prev, poi]))}
          customAt={coords}
          hideCurrent
          disabled={disabled}
        />
      )}
    </section>
  );
}

function Editor({ id }: { id: string }) {
  const { user, ready } = useRequireLogin();
  const [, navigate] = useLocation();
  const { data, error, reload } = useApi<PhotoDetail | { photo: PhotoDetail }>(ready ? `/api/photos/${id}` : null);

  const [base, setBase] = useState<PhotoDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Load once per version of the photo; a refetch with the same updatedAt must not wipe edits in progress.
  useEffect(() => {
    const p = unwrapPhoto(data);
    if (!p || p.id !== id) return;
    if (!base || base.updatedAt !== p.updatedAt) {
      setBase(p);
      setDraft(draftOf(p));
    }
  }, [data, id, base]);

  const baseDraft = useMemo(() => (base ? draftOf(base) : null), [base]);
  const changes = useMemo(() => (baseDraft && draft ? diffDraft(baseDraft, draft) : {}), [baseDraft, draft]);
  const dirty = Object.keys(changes).length > 0;
  const title = base?.title || base?.poi?.name || '编辑照片';
  useTitle(title);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const patch = useCallback((p: Partial<Draft>) => {
    setMsg(null);
    setDraft((d) => (d ? { ...d, ...p } : d));
  }, []);

  const refreshLists = () => {
    invalidate('/api/photos');
    invalidate('/api/tags');
    invalidate('/api/pois');
    invalidate('/api/themes');
  };

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await api<{ photo: PhotoDetail }>(`/api/photos/${id}`, { method: 'PATCH', json: changes });
      const saved = unwrapPhoto(res);
      if (saved) {
        setBase(saved);
        setDraft(draftOf(saved));
      }
      refreshLists();
      setMsg({ ok: true, text: '已保存' });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e, '保存失败') });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setMsg(null);
    try {
      await api(`/api/photos/${id}`, { method: 'DELETE' });
      refreshLists();
      navigate(`/@${user?.handle ?? ''}`);
    } catch (e) {
      setDeleting(false);
      setConfirmDelete(false);
      setMsg({ ok: false, text: errMsg(e, '删除失败') });
    }
  }

  if (!ready) return <p className="loading">加载中</p>;

  if (!base || !draft) {
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);
    return (
      <main className="page-narrow">
        <PageHead title="编辑照片" />
        {error ? (
          <div className="notice stack" role="alert">
            <p className="error-text" style={{ margin: 0 }}>{notFound ? '找不到这张照片，它可能已被删除，或者不是你的。' : errMsg(error, '加载失败')}</p>
            <div className="row">
              {!notFound && (
                <button type="button" className="btn" onClick={reload}>重试</button>
              )}
              <Link href="/" className="btn btn-quiet">回到图库</Link>
            </div>
          </div>
        ) : (
          <p className="loading">加载中</p>
        )}
      </main>
    );
  }

  if (user && base.ownerId !== user.id) {
    return (
      <main className="page-narrow">
        <PageHead title="编辑照片" />
        <div className="notice stack">
          <p style={{ margin: 0 }}>只有照片的主人可以编辑它。</p>
          <div className="row">
            <Link href={`/p/${base.id}`} className="btn">查看照片</Link>
          </div>
        </div>
      </main>
    );
  }

  const busy = saving || deleting;
  const caption = [base.takenAt ? fmtStamp(base.takenAt) : null, base.poi?.name ?? base.city].filter(Boolean).join(' · ');

  return (
    <main className="page pe">
      <PageHead title="编辑照片" caption={caption || undefined}>
        <Link href={`/p/${base.id}`} className="btn btn-quiet">查看照片</Link>
      </PageHead>

      <div className="pe-grid">
        <div className="pe-side stack" style={{ ['--gap' as string]: '20px' }}>
          <FocusStage photo={base} focus={draft.focus} onChange={(f) => patch({ focus: f })} />
          <div className="pe-focus-bar">
            <p className="small muted" style={{ margin: 0 }}>点击图片，标出主体的位置。方形和横幅裁切会以它为中心。</p>
            <button type="button" className="btn btn-quiet" onClick={() => patch({ focus: null })} disabled={!draft.focus || busy}>
              清除焦点
            </button>
          </div>
          <div className="pe-crops" aria-label="裁切预览">
            {(
              [
                ['1 / 1', '方形'],
                ['16 / 9', '横幅'],
                ['3 / 4', '竖幅']
              ] as const
            ).map(([ratio, label]) => (
              <figure key={ratio} className="pe-crop" style={{ flexBasis: ratio === '16 / 9' ? '38%' : ratio === '1 / 1' ? '26%' : '22%' }}>
                <Img photo={{ ...base, focus: draft.focus }} ratio={ratio} sizes="240px" alt="" />
                <figcaption className="small muted">{label}</figcaption>
              </figure>
            ))}
          </div>

          <ExifList x={base} />
          {base.themes.length > 0 && (
            <p className="small" style={{ margin: 0 }}>
              <span className="muted">所属主题：</span>
              {base.themes.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && '、'}
                  <Link href={`/t/${t.id}`}>{t.title}</Link>
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="pe-form stack" style={{ ['--gap' as string]: '28px' }}>
          <PhotoFields
            value={draft}
            onChange={(p) => patch(p)}
            tags={{ value: draft.tagIds, onChange: (ids) => patch({ tagIds: ids }) }}
            disabled={busy}
          />

          <PlaceEditor photo={base} value={draft.place} onChange={(c) => patch({ place: c })} disabled={busy} />

          <div className="pe-actions" role="group" aria-label="保存">
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!dirty || busy}>
              {saving ? '保存中…' : '保存修改'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => { setDraft(draftOf(base)); setMsg(null); }} disabled={!dirty || busy}>
              还原
            </button>
            <span className="small pe-state" role="status" aria-live="polite">
              {msg ? <span className={msg.ok ? 'sf-ok' : 'error-text'}>{msg.text}</span> : dirty ? <span className="muted">有未保存的修改</span> : null}
            </span>
          </div>

          <section className="pe-danger" aria-label="删除">
            {!confirmDelete ? (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                <Icon name="trash" size={16} />
                删除这张照片
              </button>
            ) : (
              <ConfirmBar
                prompt="删除后无法恢复：原图和三种尺寸一并删除，它会从所有主题里移除。"
                confirmLabel="确认删除"
                busy={deleting}
                onConfirm={() => void remove()}
                onCancel={() => setConfirmDelete(false)}
              />
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

export default function PhotoEdit() {
  const { id = '' } = useParams<{ id: string }>();
  return <Editor key={id} id={id} />;
}
