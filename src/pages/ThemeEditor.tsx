import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Redirect, useLocation, useParams } from 'wouter';
import type { PhotoSummary, Poi, SessionUser, ThemeDetail } from '../../shared/types';
import { Icon } from '../components/icons';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { setCached, useApi } from '../lib/useApi';
import DeleteSection from '../themes/DeleteSection';
import ItemRow, { type RowActions } from '../themes/ItemRow';
import MetaFields from '../themes/MetaFields';
import PhotoPicker from '../themes/PhotoPicker';
import {
  dayItem,
  draftFromTheme,
  emptyDraft,
  mergeByDay,
  photoItem,
  textItem,
  type Draft,
  type DraftItem,
  type EditorPhoto
} from '../themes/draft';
import { useDocumentTitle, useScrollTop } from '../themes/hooks';
import { insertAfter, insertPhotos, moveItem, removeItem, suggestDay, swapItem, type DropPos } from '../themes/items';
import { useItemDrag } from '../themes/useItemDrag';
import { useItemFocus } from '../themes/useItemFocus';
import { usePickerSlot } from '../themes/usePickerSlot';
import { useThemeSave, type Message } from '../themes/useThemeSave';
import { dayOf, errorMessage, unwrapTheme } from '../themes/util';
import '../styles/themes.css';

// /themes/new and /t/:id/edit. The form wires the draft (src/themes/draft.ts, items.ts) to the rows, the photo
// picker and the save flow (useThemeSave); drag ordering, focus after a row change and the picker's insertion point
// are hooks of their own.

/** The theme this page just wrote, so the edit route it moves to can open without another fetch. */
let justSaved: ThemeDetail | null = null;

// ---- the form ------------------------------------------------------------------------------------

function Form({ user, initial }: { user: SessionUser; initial?: ThemeDetail }) {
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState<Draft>(() => (initial ? draftFromTheme(initial) : emptyDraft()));
  const [msg, setMsg] = useState<Message | null>(() => {
    const flash = (history.state as { flash?: string } | null)?.flash;
    return flash ? { kind: 'ok', text: flash } : null;
  });
  const [arranging, setArranging] = useState(false);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const picker = usePickerSlot();

  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    // the flash message was handed over through history; do not show it again on reload
    if ((history.state as { flash?: string } | null)?.flash) history.replaceState(null, '');
  }, []);

  const { themeId, dirty, saving, deleting, confirmDelete, setConfirmDelete, save, destroy } = useThemeSave({
    draft,
    setDraft,
    initial,
    setMsg,
    onCreated: (id, theme) => {
      justSaved = theme;
      navigate(`/t/${id}/edit`, { replace: true, state: { flash: '已创建' } });
    },
    onDeleted: () => navigate('/themes?mine=1')
  });

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
  const pendingFocus = useItemFocus(draft.items);
  const onDragMove = useCallback(
    (from: string, to: string, pos: DropPos) => setDraft((d) => ({ ...d, items: moveItem(d.items, from, to, pos) })),
    []
  );
  const drag = useItemDrag(onDragMove);
  const openPicker = picker.openAt;
  const actions = useMemo<RowActions>(
    () => ({
      patch: (key, patch) =>
        setDraft((d) => ({ ...d, items: d.items.map((it) => (it.key === key ? ({ ...it, ...patch } as DraftItem) : it)) })),
      move: (key, delta) => {
        pendingFocus.current = { key, focus: false, act: delta < 0 ? 'up' : 'down' };
        setDraft((d) => {
          const items = swapItem(d.items, key, delta);
          return items === d.items ? d : { ...d, items };
        });
      },
      remove: (key) => {
        setMenuKey(null);
        const cur = draftRef.current.items;
        const at = cur.findIndex((it) => it.key === key);
        const neighbour = cur[at + 1] ?? cur[at - 1];
        pendingFocus.current = neighbour ? { key: neighbour.key, focus: false, act: 'remove' } : null;
        if (!neighbour) document.getElementById('th-add-photo')?.focus();
        setDraft((d) => removeItem(d, key));
      },
      toggleMenu: (key) => setMenuKey((k) => (k === key ? null : key)),
      insert: (key, kind) => {
        setMenuKey(null);
        if (kind === 'photo') {
          openPicker(key);
          return;
        }
        const cur = draftRef.current;
        const at = cur.items.findIndex((it) => it.key === key) + 1;
        const item = kind === 'text' ? textItem() : dayItem(suggestDay(cur.items, at, cur.startDate));
        pendingFocus.current = { key: item.key, focus: true };
        setDraft((d) => ({ ...d, items: insertAfter(d.items, key, item) }));
      },
      ...drag.handlers
    }),
    [pendingFocus, openPicker, drag.handlers]
  );

  const append = (kind: 'text' | 'day') => {
    const item = kind === 'text' ? textItem() : dayItem(suggestDay(draft.items, draft.items.length, draft.startDate));
    pendingFocus.current = { key: item.key, focus: true };
    setDraft((d) => ({ ...d, items: [...d.items, item] }));
  };

  const addPhotos = (photos: EditorPhoto[]) => {
    if (!photos.length) return;
    const fresh = photos.map(photoItem);
    pendingFocus.current = { key: fresh[0].key, focus: false };
    const after = picker.after;
    setDraft((d) => ({ ...d, items: insertPhotos(d.items, after, fresh) }));
    setMsg({ kind: 'info', text: `已加入 ${photos.length} 张照片` });
  };

  const photoIds = useMemo(() => new Set(draft.items.flatMap((it) => (it.kind === 'photo' ? [it.photoId] : []))), [draft.items]);

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

  const trip = draft.kind === 'trip';
  const photoCount = draft.items.filter((it) => it.kind === 'photo').length;
  const shownMsg = msg && !(msg.kind === 'ok' && dirty) ? msg : null;
  const canSave = !saving && !deleting && (dirty || !themeId);

  return (
    <>
      <main>
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

            <MetaFields draft={draft} set={set} setDraft={setDraft} isNew={!themeId} />

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
                <button id="th-add-photo" type="button" className="btn" onClick={() => openPicker(null)}>
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
                      dropPos={drag.over?.key === it.key ? drag.over.pos : null}
                      dragging={drag.dragKey === it.key}
                      actions={actions}
                    />
                  ))}
                </ol>
              )}
            </section>

            {themeId && (
              <DeleteSection
                confirm={confirmDelete}
                deleting={deleting}
                onConfirmChange={setConfirmDelete}
                onDelete={() => void destroy()}
              />
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
      </main>

      <PhotoPicker
        open={picker.open}
        onClose={picker.close}
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
