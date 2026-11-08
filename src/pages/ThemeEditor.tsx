import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Redirect, useLocation, useParams } from 'wouter';
import type { CreateThemeBody, PhotoSummary, Poi, SessionUser, ThemeDetail, ThemeKind, Visibility } from '../../shared/types';
import Img from '../components/Img';
import { Icon } from '../components/icons';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { invalidate, setCached, useApi } from '../lib/useApi';
import ItemRow, { type RowActions } from '../themes/ItemRow';
import PhotoPicker from '../themes/PhotoPicker';
import {
  dayItem,
  draftFromTheme,
  emptyDraft,
  itemsPayload,
  mergeByDay,
  metaPayload,
  photoDayRange,
  photoItem,
  textItem,
  validate,
  type Draft,
  type DraftItem,
  type EditorPhoto
} from '../themes/draft';
import { useDocumentTitle, useLeaveGuard, useScrollTop } from '../themes/hooks';
import { dayIndex, dayOf, errorMessage, KIND_LABEL, unwrapTheme, VISIBILITY_HINT, VISIBILITY_LABEL } from '../themes/util';
import '../styles/themes.css';

type Message = { kind: 'ok' | 'info' | 'error'; text: string };

/** The theme this page just wrote, so the edit route it moves to can open without another fetch. */
let justSaved: ThemeDetail | null = null;

const VISIBILITIES: Visibility[] = ['public', 'unlisted', 'private'];
const KINDS: ThemeKind[] = ['trip', 'topic'];

/** Day after the last day section before `index`, else the start date. */
function suggestDay(items: readonly DraftItem[], index: number, start: string): string {
  for (let i = Math.min(index, items.length) - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'day' && it.day) return new Date((dayIndex(it.day) + 1) * 86400000).toISOString().slice(0, 10);
  }
  return start;
}

function moveItem(items: DraftItem[], fromKey: string, toKey: string, pos: 'before' | 'after'): DraftItem[] {
  if (fromKey === toKey) return items;
  const from = items.findIndex((i) => i.key === fromKey);
  if (from < 0) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  const to = next.findIndex((i) => i.key === toKey);
  if (to < 0) return items;
  next.splice(pos === 'after' ? to + 1 : to, 0, moved);
  return next;
}

// ---- the form ------------------------------------------------------------------------------------

function Form({ user, initial }: { user: SessionUser; initial?: ThemeDetail }) {
  const [, navigate] = useLocation();
  const [start] = useState(() => {
    const draft = initial ? draftFromTheme(initial) : emptyDraft();
    return { draft, snap: { meta: JSON.stringify(metaPayload(draft)), items: JSON.stringify(itemsPayload(draft.items)) } };
  });
  const [draft, setDraft] = useState<Draft>(start.draft);
  const [themeId, setThemeId] = useState<string | null>(initial?.id ?? null);
  const [saved, setSaved] = useState(start.snap);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Message | null>(() => {
    const flash = (history.state as { flash?: string } | null)?.flash;
    return flash ? { kind: 'ok', text: flash } : null;
  });
  const [arranging, setArranging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAfter, setPickerAfter] = useState<string | null>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [over, setOver] = useState<{ key: string; pos: 'before' | 'after' } | null>(null);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dragRef = useRef<string | null>(null);
  const overRef = useRef<{ key: string; pos: 'before' | 'after' } | null>(null);
  const pendingFocus = useRef<{ key: string; focus: boolean } | null>(null);

  useEffect(() => {
    // the flash message was handed over through history; do not show it again on reload
    if ((history.state as { flash?: string } | null)?.flash) history.replaceState(null, '');
  }, []);

  const metaJson = useMemo(() => JSON.stringify(metaPayload(draft)), [draft]);
  const itemsJson = useMemo(() => JSON.stringify(itemsPayload(draft.items)), [draft.items]);
  const dirty = metaJson !== saved.meta || itemsJson !== saved.items;
  useLeaveGuard(dirty && !saving && !deleting);

  // places of the owner's photos, for the names in the item rows
  const poiReq = useApi<{ pois: Poi[] }>(`/api/pois?owner=${encodeURIComponent(user.handle)}`);
  const poiById = useMemo(() => {
    const m = new Map<string, Poi>();
    for (const p of initial?.pois ?? []) m.set(p.id, p);
    for (const p of poiReq.data?.pois ?? []) m.set(p.id, p);
    return m;
  }, [initial, poiReq.data]);

  const set = useCallback(<K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((d) => ({ ...d, [field]: value })), []);

  // ---- item actions (one stable object for all rows) ----
  const actions = useMemo<RowActions>(
    () => ({
      patch: (key, patch) => setDraft((d) => ({ ...d, items: d.items.map((it) => (it.key === key ? ({ ...it, ...patch } as DraftItem) : it)) })),
      move: (key, delta) =>
        setDraft((d) => {
          const i = d.items.findIndex((it) => it.key === key);
          const j = i + delta;
          if (i < 0 || j < 0 || j >= d.items.length) return d;
          const items = d.items.slice();
          [items[i], items[j]] = [items[j], items[i]];
          return { ...d, items };
        }),
      remove: (key) => {
        setMenuKey(null);
        setDraft((d) => {
          const items = d.items.filter((it) => it.key !== key);
          // a cover that is no longer in the theme falls back to the first photo
          const stillThere = d.coverPhotoId && items.some((it) => it.kind === 'photo' && it.photoId === d.coverPhotoId);
          return { ...d, items, coverPhotoId: stillThere ? d.coverPhotoId : null };
        });
      },
      toggleMenu: (key) => setMenuKey((k) => (k === key ? null : key)),
      insert: (key, kind) => {
        setMenuKey(null);
        if (kind === 'photo') {
          setPickerAfter(key);
          setPickerOpen(true);
          return;
        }
        const cur = draftRef.current;
        const at = cur.items.findIndex((it) => it.key === key) + 1;
        const item = kind === 'text' ? textItem() : dayItem(suggestDay(cur.items, at, cur.startDate));
        pendingFocus.current = { key: item.key, focus: true };
        setDraft((d) => {
          const items = d.items.slice();
          items.splice(d.items.findIndex((it) => it.key === key) + 1, 0, item);
          return { ...d, items };
        });
      },
      dragStart: (key) => {
        dragRef.current = key;
        setDragKey(key);
      },
      dragOver: (key, pos) => {
        if (overRef.current?.key === key && overRef.current.pos === pos) return;
        overRef.current = { key, pos };
        setOver(overRef.current);
      },
      drop: () => {
        const from = dragRef.current;
        const target = overRef.current;
        if (from && target) setDraft((d) => ({ ...d, items: moveItem(d.items, from, target.key, target.pos) }));
        dragRef.current = null;
        overRef.current = null;
        setDragKey(null);
        setOver(null);
      },
      dragEnd: () => {
        dragRef.current = null;
        overRef.current = null;
        setDragKey(null);
        setOver(null);
      }
    }),
    []
  );

  // bring a newly added item into view
  useEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    const el = document.querySelector<HTMLElement>(`[data-item-key="${want.key}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    if (want.focus) el.querySelector<HTMLElement>('textarea, input')?.focus({ preventScroll: true });
  }, [draft.items]);

  const append = (kind: 'text' | 'day') => {
    const item = kind === 'text' ? textItem() : dayItem(suggestDay(draft.items, draft.items.length, draft.startDate));
    pendingFocus.current = { key: item.key, focus: true };
    setDraft((d) => ({ ...d, items: [...d.items, item] }));
  };

  const openPicker = (after: string | null) => {
    setPickerAfter(after);
    setPickerOpen(true);
  };
  const addPhotos = (photos: EditorPhoto[]) => {
    if (!photos.length) return;
    const fresh = photos.map(photoItem);
    pendingFocus.current = { key: fresh[0].key, focus: false };
    setDraft((d) => {
      const idx = pickerAfter ? d.items.findIndex((it) => it.key === pickerAfter) : -1;
      const items = d.items.slice();
      items.splice(idx >= 0 ? idx + 1 : items.length, 0, ...fresh);
      return { ...d, items };
    });
    setMsg({ kind: 'info', text: `已加入 ${photos.length} 张照片` });
  };

  const photoIds = useMemo(() => new Set(draft.items.flatMap((it) => (it.kind === 'photo' ? [it.photoId] : []))), [draft.items]);
  const coverPhotos = useMemo(() => {
    const seen = new Set<string>();
    const out: EditorPhoto[] = [];
    for (const it of draft.items) {
      if (it.kind === 'photo' && it.photo && !seen.has(it.photoId)) {
        seen.add(it.photoId);
        out.push(it.photo);
      }
    }
    return out.slice(0, 300);
  }, [draft.items]);
  const privateCount = useMemo(() => draft.items.filter((it) => it.kind === 'photo' && it.photo?.visibility === 'private').length, [draft.items]);
  const range = useMemo(() => photoDayRange(draft.items), [draft.items]);

  async function autoArrange() {
    if (!draft.startDate || !draft.endDate) return;
    setArranging(true);
    setMsg(null);
    try {
      const res = await api<{ photos: PhotoSummary[] }>('/api/photos?mine=1');
      setCached('/api/photos?mine=1', res);
      const fresh = res.photos.filter((p) => {
        const d = dayOf(p.takenAt);
        return !!d && d >= draft.startDate && d <= draft.endDate && !photoIds.has(p.id);
      });
      if (!fresh.length) {
        setMsg({ kind: 'info', text: '这段日期内没有可加入的照片' });
        return;
      }
      const days = new Set(fresh.map((p) => dayOf(p.takenAt))).size;
      setDraft((d) => ({ ...d, items: mergeByDay(d.items, fresh) }));
      setMsg({ kind: 'info', text: `已加入 ${fresh.length} 张照片，共 ${days} 天。保存后生效。` });
    } catch (e) {
      setMsg({ kind: 'error', text: errorMessage(e) });
    } finally {
      setArranging(false);
    }
  }

  // ---- save ----
  async function save() {
    if (saving) return;
    const problem = validate(draft);
    if (problem) {
      setMsg({ kind: 'error', text: problem.text });
      document.getElementById(problem.field)?.focus();
      return;
    }
    setSaving(true);
    setMsg(null);
    const meta = metaPayload(draft);
    const items = itemsPayload(draft.items);
    const nextMeta = JSON.stringify(meta);
    const nextItems = JSON.stringify(items);
    let id = themeId;
    let last: ThemeDetail | undefined = initial;
    let serverMeta = saved.meta;
    let serverItems = saved.items;
    try {
      if (!id) {
        // The cover is set afterwards, once the photos are part of the theme.
        const body: CreateThemeBody = { ...meta, coverPhotoId: null };
        const made = unwrapTheme(await api<unknown>('/api/themes', { method: 'POST', json: body }));
        if (!made) throw new Error('bad response');
        id = made.id;
        last = made;
        serverMeta = JSON.stringify({ ...meta, coverPhotoId: null });
        serverItems = '[]';
        setThemeId(id);
        setSaved({ meta: serverMeta, items: serverItems });
      }
      if (nextItems !== serverItems) {
        last = unwrapTheme(await api<unknown>(`/api/themes/${id}/items`, { method: 'PUT', json: { items } })) ?? last;
        serverItems = nextItems;
        setSaved({ meta: serverMeta, items: serverItems });
      }
      if (nextMeta !== serverMeta) {
        last = unwrapTheme(await api<unknown>(`/api/themes/${id}`, { method: 'PATCH', json: meta })) ?? last;
        serverMeta = nextMeta;
        setSaved({ meta: serverMeta, items: serverItems });
      }
      invalidate('/api/themes');
      // empty text blocks were not sent; drop them from the page too
      setDraft((d) =>
        d.items.some((it) => it.kind === 'text' && !it.text.trim())
          ? { ...d, items: d.items.filter((it) => !(it.kind === 'text' && !it.text.trim())) }
          : d
      );
      if (!initial) {
        // saved from /themes/new (possibly after a retry): continue on the theme's own edit route
        justSaved = last ?? null;
        navigate(`/t/${id}/edit`, { replace: true, state: { flash: '已创建' } });
      } else {
        setMsg({ kind: 'ok', text: '已保存' });
      }
    } catch (e) {
      const created = !themeId && id;
      setMsg({ kind: 'error', text: created ? `主题已创建，但后面的内容没有保存成功：${errorMessage(e)}` : errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    if (!themeId) return;
    setDeleting(true);
    try {
      await api(`/api/themes/${themeId}`, { method: 'DELETE' });
      invalidate('/api/themes');
      navigate('/themes?mine=1');
    } catch (e) {
      setDeleting(false);
      setConfirmDelete(false);
      setMsg({ kind: 'error', text: errorMessage(e) });
    }
  }

  // Ctrl/Cmd+S saves
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const trip = draft.kind === 'trip';
  const photoCount = draft.items.filter((it) => it.kind === 'photo').length;
  const shownMsg = msg && !(msg.kind === 'ok' && dirty) ? msg : null;
  const canSave = !saving && !deleting && (dirty || !themeId);

  return (
    <>
      <form
        className="ed"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="ed-inner">
          <header className="ed-head">
            <h1 className="display display-l">{themeId ? '编辑主题' : '新建主题'}</h1>
            {themeId && (
              <Link href={`/t/${themeId}`} className="btn btn-quiet">
                查看游记
              </Link>
            )}
          </header>

          <section className="ed-sec" aria-labelledby="ed-basic">
            <h2 id="ed-basic" className="ed-h">
              基本信息
            </h2>

            <div className="field">
              <span className="label" id="th-kind-label">
                类型
              </span>
              <div className="seg" role="group" aria-labelledby="th-kind-label">
                {KINDS.map((k) => (
                  <button key={k} type="button" aria-pressed={draft.kind === k} onClick={() => set('kind', k)}>
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              <p className="small muted ed-hint">{trip ? '有起止日期，按天分段，游记里画出路线。' : '不受时间约束的精选。'}</p>
            </div>

            <div className="field">
              <label className="label" htmlFor="th-title">
                标题
              </label>
              <input
                id="th-title"
                className="input ed-title-input"
                value={draft.title}
                maxLength={120}
                autoFocus={!themeId}
                placeholder={trip ? '例：2026 秋 · 杭州三日' : '例：西湖四季'}
                onChange={(e) => set('title', e.target.value)}
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="th-subtitle">
                副标题
              </label>
              <input id="th-subtitle" className="input" value={draft.subtitle} maxLength={200} onChange={(e) => set('subtitle', e.target.value)} />
            </div>

            <div className="field">
              <label className="label" htmlFor="th-intro">
                导语
              </label>
              <textarea
                id="th-intro"
                className="textarea"
                rows={5}
                value={draft.intro}
                placeholder="几句话说明这次旅程或这个专题。空一行分段。"
                onChange={(e) => set('intro', e.target.value)}
              />
            </div>

            {trip && (
              <div className="ed-dates">
                <div className="field">
                  <label className="label" htmlFor="th-start">
                    开始日期
                  </label>
                  <input
                    id="th-start"
                    type="date"
                    className="input"
                    value={draft.startDate}
                    max={draft.endDate || undefined}
                    onChange={(e) => set('startDate', e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="th-end">
                    结束日期
                  </label>
                  <input
                    id="th-end"
                    type="date"
                    className="input"
                    value={draft.endDate}
                    min={draft.startDate || undefined}
                    onChange={(e) => set('endDate', e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={!range || (range.start === draft.startDate && range.end === draft.endDate)}
                  onClick={() => range && setDraft((d) => ({ ...d, startDate: range.start, endDate: range.end }))}
                >
                  取自照片
                </button>
              </div>
            )}

            <div className="field">
              <span className="label" id="th-vis-label">
                公开范围
              </span>
              <div className="seg" role="group" aria-labelledby="th-vis-label">
                {VISIBILITIES.map((v) => (
                  <button key={v} type="button" aria-pressed={draft.visibility === v} onClick={() => set('visibility', v)}>
                    {VISIBILITY_LABEL[v]}
                  </button>
                ))}
              </div>
              <p className="small muted ed-hint">{VISIBILITY_HINT[draft.visibility]}</p>
              {draft.visibility !== 'private' && privateCount > 0 && (
                <p className="small ed-warn" role="note">
                  有 {privateCount} 张照片仅自己可见，读者看不到它们。
                </p>
              )}
            </div>

            <div className="field">
              <span className="label" id="th-cover-label">
                封面
              </span>
              {coverPhotos.length === 0 ? (
                <p className="small muted ed-hint">添加照片后，可以从中选择封面。</p>
              ) : (
                <div className="ed-covers" role="group" aria-labelledby="th-cover-label">
                  <button
                    type="button"
                    className="ed-cover ed-cover-auto"
                    aria-pressed={!draft.coverPhotoId}
                    onClick={() => set('coverPhotoId', null)}
                  >
                    默认
                    <br />
                    第一张
                  </button>
                  {coverPhotos.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      className="ed-cover"
                      aria-pressed={draft.coverPhotoId === p.id}
                      aria-label={`设为封面：第 ${i + 1} 张照片`}
                      onClick={() => set('coverPhotoId', p.id)}
                    >
                      <Img photo={p} ratio="4 / 3" sizes="96px" alt="" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="ed-sec" aria-labelledby="ed-items">
            <div className="spread">
              <h2 id="ed-items" className="ed-h">
                内容
              </h2>
              <span className="small muted mono">
                {draft.items.length} 项 · {photoCount} 张照片
              </span>
            </div>

            <div className="ed-tools">
              <button type="button" className="btn" onClick={() => openPicker(null)}>
                <Icon name="plus" size={18} />
                添加照片
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => append('text')}>
                添加文字段落
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => append('day')}>
                添加日期分段
              </button>
              {trip && (
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={arranging || !draft.startDate || !draft.endDate}
                  onClick={() => void autoArrange()}
                >
                  {arranging ? '编排中…' : '按日期范围自动编排'}
                </button>
              )}
            </div>
            {trip && (!draft.startDate || !draft.endDate) && (
              <p className="small muted ed-hint">填好起止日期后，可以把这段时间的照片按天自动排好。</p>
            )}

            {draft.items.length === 0 ? (
              <div className="ed-empty">
                <p>还没有内容。添加照片，或者先写一段文字。</p>
              </div>
            ) : (
              <ol className="ed-items">
                {draft.items.map((it, i) => (
                  <ItemRow
                    key={it.key}
                    item={it}
                    index={i}
                    total={draft.items.length}
                    poi={it.kind === 'photo' && it.photo?.poiId ? (poiById.get(it.photo.poiId) ?? null) : null}
                    themeVisibility={draft.visibility}
                    menuOpen={menuKey === it.key}
                    dropPos={over?.key === it.key ? over.pos : null}
                    dragging={dragKey === it.key}
                    actions={actions}
                  />
                ))}
              </ol>
            )}
          </section>

          {themeId && (
            <section className="ed-sec ed-danger" aria-labelledby="ed-del">
              <h2 id="ed-del" className="ed-h">
                删除主题
              </h2>
              {!confirmDelete ? (
                <div>
                  <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                    <Icon name="trash" size={18} />
                    删除主题
                  </button>
                </div>
              ) : (
                <div className="notice ed-confirm" role="alertdialog" aria-label="确认删除主题">
                  <p>确定删除这个主题吗？照片不会被删除，但主题和其中的文字无法恢复。</p>
                  <div className="row">
                    <button type="button" className="btn btn-danger" disabled={deleting} onClick={() => void destroy()}>
                      {deleting ? '删除中…' : '确认删除'}
                    </button>
                    <button type="button" className="btn btn-quiet" disabled={deleting} onClick={() => setConfirmDelete(false)}>
                      取消
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <div className="ed-bar">
          <div className="ed-bar-inner">
            <div
              className="ed-status"
              role={shownMsg?.kind === 'error' ? 'alert' : 'status'}
              data-kind={shownMsg?.kind ?? (dirty ? 'dirty' : undefined)}
            >
              {shownMsg ? shownMsg.text : dirty ? '有未保存的修改' : ''}
              {shownMsg?.kind === 'ok' && themeId && (
                <>
                  {' '}
                  <Link href={`/t/${themeId}`}>查看游记</Link>
                </>
              )}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <Link href={themeId ? `/t/${themeId}` : '/themes?mine=1'} className="btn btn-quiet">
                {themeId ? '返回' : '取消'}
              </Link>
              <button type="submit" className="btn btn-primary" disabled={!canSave}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      </form>

      <PhotoPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        existing={photoIds}
        from={trip ? draft.startDate : ''}
        to={trip ? draft.endDate : ''}
        onAdd={addPhotos}
      />
    </>
  );
}

// ---- routes --------------------------------------------------------------------------------------

function LoginGate() {
  return (
    <main className="th-page th-narrow">
      <div className="th-empty">
        <p className="th-empty-title">登录后才能新建主题</p>
        <Link href="/login" className="btn btn-primary">
          登录
        </Link>
      </div>
    </main>
  );
}

function Existing({ id, user }: { id: string; user: SessionUser }) {
  const [theme, setTheme] = useState<ThemeDetail | undefined>(() => (justSaved?.id === id ? justSaved : undefined));
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    justSaved = null;
    if (theme) return;
    const ctl = new AbortController();
    setError(null);
    api<unknown>(`/api/themes/${encodeURIComponent(id)}`, { signal: ctl.signal })
      .then((res) => {
        const t = unwrapTheme(res);
        if (t) setTheme(t);
        else setError(new Error('bad response'));
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(e);
      });
    return () => ctl.abort();
  }, [id, attempt, theme]);

  if (theme) {
    if (theme.ownerId !== user.id) return <Redirect href={`/t/${id}`} replace />;
    return <Form key={theme.id} user={user} initial={theme} />;
  }
  if (error) {
    const status = (error as { status?: number }).status;
    if (status === 401 || status === 403 || status === 404) return <Redirect href={`/t/${id}`} replace />;
    return (
      <main className="th-page th-narrow">
        <div className="th-empty" role="alert">
          <p className="th-empty-title">主题加载失败</p>
          <p className="muted">{errorMessage(error)}</p>
          <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
            重试
          </button>
        </div>
      </main>
    );
  }
  return <p className="loading">加载中</p>;
}

/** `/themes/new` and `/t/:id/edit`. */
export default function ThemeEditor() {
  const { id } = useParams<{ id?: string }>();
  const { user, loading } = useSession();
  useDocumentTitle(id ? '编辑主题' : '新建主题');
  useScrollTop(id ?? 'new');

  if (loading) return <p className="loading">加载中</p>;
  if (!id) return user ? <Form key="new" user={user} /> : <LoginGate />;
  if (!user) return <Redirect href={`/t/${id}`} replace />;
  return <Existing key={id} id={id} user={user} />;
}
