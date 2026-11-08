import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'wouter';
import type { PoiDetail } from '../../shared/types';
import { ApiError, api } from '../lib/api';
import { invalidate, setCached, useApi } from '../lib/useApi';
import PlaceFields from '../studio/PlaceFields';
import PlaceRadius from '../studio/PlaceRadius';
import { diffDraft, draftOf, problemsOf, type PlaceDraft } from '../studio/place-draft';
import { PageHead } from '../studio/ui';
import { errMsg, useLeaveGuard, useRequireLogin, useTitle } from '../studio/util';
import '../styles/studio.css';

// /studio/place/:id — change the name, category, aliases and matching radius of a place you created (or of any place, as staff).
// Docs: /docs/product/features/places.md#编辑

// GET /api/pois/:id also carries `nearby`, which the place page reads from the same cache entry
interface PoiResponse {
  poi: PoiDetail;
}

function Editor({ id }: { id: string }) {
  const { ready } = useRequireLogin();
  const path = `/api/pois/${encodeURIComponent(id)}`;
  const { data, error, reload } = useApi<PoiResponse>(ready ? path : null);

  const [base, setBase] = useState<PoiDetail | null>(null);
  const [draft, setDraft] = useState<PlaceDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // the fields are disabled while saving, which drops focus: give it back to what had it (Enter in the name box, say)
  const refocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!saving && refocus.current) {
      refocus.current.focus();
      refocus.current = null;
    }
  }, [saving]);

  // Load once; a refetch (after saving, or from another page) must not wipe edits in progress.
  useEffect(() => {
    if (base || !data?.poi) return;
    setBase(data.poi);
    setDraft(draftOf(data.poi));
  }, [data, base]);

  const baseDraft = useMemo(() => (base ? draftOf(base) : null), [base]);
  const changes = useMemo(() => (baseDraft && draft ? diffDraft(baseDraft, draft) : {}), [baseDraft, draft]);
  const problems = useMemo(() => (draft ? problemsOf(draft) : {}), [draft]);
  const dirty = Object.keys(changes).length > 0;
  const valid = Object.keys(problems).length === 0;
  useTitle(base ? `编辑「${base.name}」` : '编辑地点');

  useLeaveGuard(dirty, '有没保存的修改，离开后会丢掉。确定离开吗？');

  const patch = useCallback((p: Partial<PlaceDraft>) => {
    setMsg(null);
    setDraft((d) => (d ? { ...d, ...p } : d));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!base || !dirty || !valid || saving) return;
    const active = document.activeElement;
    refocus.current = active instanceof HTMLElement && e.currentTarget.contains(active) ? active : null;
    setSaving(true);
    setMsg(null);
    try {
      const res = await api<{ poi: PoiDetail }>(path, { method: 'PATCH', json: changes });
      // the write response has no photo count; the place page keeps showing the one it had
      const saved: PoiDetail = { ...res.poi, count: base.count };
      setBase(saved);
      setDraft(draftOf(saved));
      // the place page reads the new values at once; every cached list and photo that carries the place refetches
      if (data) setCached(path, { ...data, poi: saved });
      invalidate('/api/pois');
      invalidate('/api/photos');
      invalidate('/api/themes');
      setMsg({ ok: true, text: '已保存' });
    } catch (err) {
      setMsg({ ok: false, text: errMsg(err, '保存失败') });
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <p className="loading">加载中</p>;

  if (!base || !draft) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <main className="page-narrow">
        <PageHead title="编辑地点" />
        {error ? (
          <div className="notice stack" role="alert">
            <p className="error-text" style={{ margin: 0 }}>
              {notFound ? '找不到这个地点，它可能已被合并或删除。' : errMsg(error, '加载失败')}
            </p>
            <div className="row">
              {!notFound && (
                <button type="button" className="btn" onClick={reload}>
                  重试
                </button>
              )}
              <Link href="/map" className="btn btn-quiet">
                回到地图
              </Link>
            </div>
          </div>
        ) : (
          <p className="loading">加载中</p>
        )}
      </main>
    );
  }

  if (!base.canEdit) {
    return (
      <main className="page-narrow">
        <PageHead title="编辑地点" />
        <div className="notice stack">
          <p style={{ margin: 0 }}>只有地点的创建者或管理员可以修改它。</p>
          <div className="row">
            <Link href={`/place/${base.id}`} className="btn">
              查看地点
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const caption = [base.name, base.district, base.city].filter(Boolean).join(' · ');

  return (
    <main className="page pl">
      <PageHead title="编辑地点" caption={caption}>
        <Link href={`/place/${base.id}`} className="btn btn-quiet">
          查看地点
        </Link>
      </PageHead>

      <form className="pl-form" onSubmit={(e) => void save(e)} noValidate>
        <div className="pl-grid">
          <PlaceFields value={draft} problems={problems} onChange={patch} disabled={saving} />
          <PlaceRadius
            place={base}
            value={draft.radius}
            error={problems.radius}
            onChange={(radius) => patch({ radius })}
            disabled={saving}
          />
        </div>

        <div className="pe-actions" role="group" aria-label="保存">
          <button type="submit" className="btn btn-primary" disabled={!dirty || !valid || saving}>
            {saving ? '保存中…' : '保存修改'}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setDraft(draftOf(base));
              setMsg(null);
            }}
            disabled={!dirty || saving}
          >
            还原
          </button>
          <span className="small pe-state" role="status" aria-live="polite">
            {msg?.ok ? <span className="sf-ok">{msg.text}</span> : !msg && dirty ? <span className="muted">有未保存的修改</span> : null}
          </span>
          {msg && !msg.ok && (
            <p className="error-text pl-error" role="alert">
              {msg.text}
            </p>
          )}
        </div>
      </form>
    </main>
  );
}

export default function PlaceEdit() {
  const { id } = useParams<{ id: string }>();
  return <Editor key={id} id={id} />;
}
