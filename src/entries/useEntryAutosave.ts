import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { EntryDetail, EntryStatus } from '../../shared/types';
import { api, ApiError } from '../lib/api';
import { forget, invalidate, setCached } from '../lib/useApi';
import {
  changedFields,
  clearBackup,
  draftFromEntry,
  draftProblem,
  isEmptyDraft,
  payloadOf,
  writeBackup,
  type EntryDraft,
  type EntryPayload
} from './draft';

// Saving an entry while it is written. A change goes to the server a moment after typing stops; at once with
// Ctrl/Cmd+S or a change of status, and when the editor is left or the tab hidden. Until the server has it, it is kept
// on this device too, so a closed tab or a lost connection costs nothing. A new entry is created by its first save, as
// a draft. Only the fields that changed are sent, with the revision the editor holds: an entry saved elsewhere in
// between is a conflict, and nothing more is saved until the author picks a copy. Docs: /docs/product/features/entries.md

export const AUTOSAVE_MS = 1200;

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  /** nothing written and no photo: not saved */
  | { kind: 'empty' }
  | { kind: 'invalid'; text: string }
  | { kind: 'error'; text: string }
  /** saved elsewhere since this editor loaded it; `revision` is the server's */
  | { kind: 'conflict'; revision: number | null }
  /** deleted elsewhere */
  | { kind: 'gone' };

interface Options {
  userId: string;
  /** the entry as loaded; null for a new one */
  initial: EntryDetail | null;
  draft: EntryDraft;
  setDraft: Dispatch<SetStateAction<EntryDraft>>;
  /** the first save created the entry */
  onCreated: (entry: EntryDetail) => void;
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : '网络不可用，改动先留在这台设备上');

/** Lists and counts that show what was saved: entry lists, photos' lists of their entries, tags' entry counts. */
function refreshAround(fields: Partial<EntryPayload> | null) {
  invalidate('/api/entries?');
  if (!fields || 'media' in fields) invalidate('/api/photos/');
  if (!fields || 'tagIds' in fields) invalidate('/api/tags');
}

export function useEntryAutosave({ userId, initial, draft, setDraft, onCreated }: Options) {
  const [entry, setEntry] = useState<EntryDetail | null>(initial);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });

  // What the server holds, as the request bodies said it: the base each save is compared with. null before the first
  // save, or after a conflict the author settled by keeping this copy, when everything is sent again.
  const sent = useRef<EntryPayload | null>(initial ? payloadOf(draftFromEntry(initial)) : null);
  const [sentJson, setSentJson] = useState<string | null>(() => (sent.current ? JSON.stringify(sent.current) : null));
  const server = useRef<{ id: string | null; revision: number; status: EntryStatus | null }>({
    id: initial?.id ?? null,
    revision: initial?.revision ?? 0,
    status: initial?.status ?? null
  });
  const held = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  const current = useRef(entry);
  current.current = entry;
  const created = useRef(onCreated);
  created.current = onCreated;
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const json = useMemo(() => JSON.stringify(payloadOf(draft)), [draft]);
  const empty = isEmptyDraft(draft);
  /** changes the server does not have yet, and could take */
  const unsaved = json !== sentJson && !empty;

  const run = useCallback(
    async (status?: EntryStatus): Promise<EntryDetail | null> => {
      if (held.current) return null;
      const d = latest.current;
      const { id, revision } = server.current;
      const payload = payloadOf(d);
      const fields = changedFields(payload, sent.current);
      const statusChange = !!status && status !== server.current.status;
      if (id && !Object.keys(fields).length && !statusChange) return current.current;
      if (isEmptyDraft(d)) {
        setState({ kind: 'empty' });
        return null;
      }
      const problem = draftProblem(d);
      if (problem) {
        setState({ kind: 'invalid', text: problem });
        return null;
      }
      setState({ kind: 'saving' });
      try {
        const { entry: e } = id
          ? await api<{ entry: EntryDetail }>(`/api/entries/${id}`, {
              method: 'PATCH',
              json: { ...fields, ...(statusChange ? { status } : {}), revision }
            })
          : await api<{ entry: EntryDetail }>('/api/entries', { method: 'POST', json: { ...payload, status: status ?? 'draft' } });
        const base = sent.current;
        sent.current = payload;
        server.current = { id: e.id, revision: e.revision, status: e.status };
        setEntry(e);
        setSentJson(JSON.stringify(payload));
        setState({ kind: 'saved', at: new Date() });
        // the copy on this device can go, unless more was typed while this was on its way
        if (!id) clearBackup(userId, null);
        if (JSON.stringify(payloadOf(latest.current)) === JSON.stringify(payload)) clearBackup(userId, e.id);
        else writeBackup(userId, e.id, latest.current);
        setCached(`/api/entries/${e.id}`, e);
        refreshAround(base ? fields : null);
        if (!id) created.current(e);
        return e;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          held.current = true;
          setState({ kind: 'conflict', revision: typeof err.body.revision === 'number' ? err.body.revision : null });
        } else if (err instanceof ApiError && err.status === 404 && id) {
          held.current = true;
          setState({ kind: 'gone' });
        } else {
          setState({ kind: 'error', text: errorText(err) });
        }
        return null;
      }
    },
    [userId]
  );

  /** Save what is there now, after any save under way; with `status`, change it too. */
  const save = useCallback(
    (status?: EntryStatus): Promise<EntryDetail | null> => {
      const next = chain.current.then(() => run(status));
      chain.current = next.catch(() => null);
      return next;
    },
    [run]
  );

  // A moment after the last change; meanwhile the change is kept on this device. A copy found there when the editor
  // opened stays until the author changes something (or settles it in the editor), so leaving does not lose it.
  const opened = useRef(json);
  const touched = useRef(false);
  useEffect(() => {
    if (json !== opened.current) touched.current = true;
    if (json === sentJson) {
      if (touched.current) clearBackup(userId, server.current.id);
      setState((s) => (s.kind === 'pending' ? { kind: 'idle' } : s));
      return;
    }
    if (empty) {
      if (touched.current) clearBackup(userId, server.current.id);
      setState((s) => (s.kind === 'pending' || s.kind === 'invalid' ? { kind: 'empty' } : s));
      return;
    }
    writeBackup(userId, server.current.id, draft);
    if (held.current) return;
    setState((s) => (s.kind === 'saving' ? s : { kind: 'pending' }));
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [json, sentJson, empty, draft, userId, save]);

  // leaving: the tab is hidden (often the last chance on a phone), or the editor unmounts
  const flushRef = useRef(() => {});
  flushRef.current = () => {
    if (!held.current && !isEmptyDraft(latest.current) && JSON.stringify(payloadOf(latest.current)) !== JSON.stringify(sent.current)) {
      void save();
    }
  };
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushRef.current();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flushRef.current();
    };
  }, []);

  // closing or reloading the tab with a change on its way asks first
  const busy = unsaved || state.kind === 'saving';
  useEffect(() => {
    if (!busy) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      flushRef.current();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [busy]);

  /** Conflict: this copy wins and overwrites the one saved elsewhere. */
  const keepMine = useCallback(async () => {
    const id = server.current.id;
    if (!id) return null;
    let revision = state.kind === 'conflict' ? state.revision : null;
    if (revision === null) {
      try {
        revision = (await api<EntryDetail>(`/api/entries/${id}`)).revision;
      } catch (err) {
        setState({ kind: 'error', text: errorText(err) });
        return null;
      }
    }
    server.current.revision = revision;
    held.current = false;
    sent.current = null;
    setSentJson(null);
    return save();
  }, [state, save]);

  /** Conflict: load the copy saved elsewhere and drop this one. */
  const takeTheirs = useCallback(async () => {
    const id = server.current.id;
    if (!id) return;
    try {
      const e = await api<EntryDetail>(`/api/entries/${id}`);
      const d = draftFromEntry(e);
      sent.current = payloadOf(d);
      server.current = { id: e.id, revision: e.revision, status: e.status };
      held.current = false;
      setSentJson(JSON.stringify(sent.current));
      setEntry(e);
      setDraft(d);
      clearBackup(userId, id);
      setCached(`/api/entries/${id}`, e);
      setState({ kind: 'idle' });
    } catch (err) {
      setState({ kind: 'error', text: errorText(err) });
    }
  }, [userId, setDraft]);

  /** Deleted elsewhere: keep what is here as a new entry. */
  const saveAsNew = useCallback(() => {
    clearBackup(userId, server.current.id);
    server.current = { id: null, revision: 0, status: null };
    held.current = false;
    sent.current = null;
    setSentJson(null);
    return save();
  }, [userId, save]);

  /** Delete the entry; its photos stay. */
  const remove = useCallback(async () => {
    const id = server.current.id;
    held.current = true;
    try {
      if (id) await api(`/api/entries/${id}`, { method: 'DELETE' });
    } catch (err) {
      held.current = false;
      throw err;
    }
    clearBackup(userId, id);
    clearBackup(userId, null);
    if (id) forget(`/api/entries/${id}`);
    refreshAround(null);
  }, [userId]);

  return { entry, state, unsaved, save, keepMine, takeTheirs, saveAsNew, remove };
}
