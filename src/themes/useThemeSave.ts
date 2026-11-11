import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CreateThemeBody, ThemeDetail } from '../../shared/types';
import { api } from '../lib/api';
import { invalidate } from '../lib/useApi';
import { itemsPayload, metaPayload, validate, type Draft } from './draft';
import { useLeaveGuard } from './hooks';
import { dropEmptyText } from './items';
import { errorMessage, unwrapTheme } from './util';

/** The line in the editor's bottom bar. */
export type Message = { kind: 'ok' | 'info' | 'error'; text: string };

/** What the server holds, as the request bodies would say it; a draft that differs is unsaved. */
interface Snapshot {
  meta: string;
  items: string;
}

const snapshot = (d: Draft): Snapshot => ({ meta: JSON.stringify(metaPayload(d)), items: JSON.stringify(itemsPayload(d.items)) });

interface Options {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  /** the theme being edited; none on /themes/new */
  initial?: ThemeDetail;
  setMsg: (msg: Message | null) => void;
  /** a new theme was created (and its items and details saved): move to its edit route */
  onCreated: (id: string, theme: ThemeDetail | null) => void;
  onDeleted: () => void;
}

/**
 * Saving and deleting a theme. A save sends only what changed, in order: POST for a new theme, then PUT of the items,
 * then PATCH of the details (the cover can only point at photos already in the theme). Each step that succeeds moves
 * the saved snapshot on, so a retry after a failure picks up where it stopped. Ctrl/Cmd+S saves; leaving with unsaved
 * edits asks first.
 */
export function useThemeSave({ draft, setDraft, initial, setMsg, onCreated, onDeleted }: Options) {
  const [themeId, setThemeId] = useState<string | null>(initial?.id ?? null);
  const [saved, setSaved] = useState<Snapshot>(() => snapshot(draft));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const metaJson = useMemo(() => JSON.stringify(metaPayload(draft)), [draft]);
  const itemsJson = useMemo(() => JSON.stringify(itemsPayload(draft.items)), [draft.items]);
  const dirty = metaJson !== saved.meta || itemsJson !== saved.items;
  useLeaveGuard(dirty && !saving && !deleting);

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
      setDraft(dropEmptyText);
      // saved from /themes/new (possibly after a retry): continue on the theme's own edit route
      if (!initial) onCreated(id, last ?? null);
      else setMsg({ kind: 'ok', text: '已保存' });
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
      onDeleted();
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

  return { themeId, dirty, saving, deleting, confirmDelete, setConfirmDelete, save, destroy };
}
