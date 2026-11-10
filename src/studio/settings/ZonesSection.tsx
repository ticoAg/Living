import { useMemo, useState, type FormEvent } from 'react';
import type { CreatePrivacyZoneResponse, PhotoSummary, PrivacyZone } from '../../../shared/types';
import { fmtLat, fmtLng } from '../../../shared/geo';
import { Icon } from '../../components/icons';
import Img from '../../components/Img';
import { api } from '../../lib/api';
import { invalidate, useApi } from '../../lib/useApi';
import { ConfirmBar } from '../ui';
import { errMsg, fmtStamp, useKeep } from '../util';

const PAGE = 60;
const PAIR = /^\s*(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)\s*$/;

function parseNum(s: string, min: number, max: number): number | null {
  if (!s.trim()) return null;
  const n = Number(s.trim());
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Privacy zones: photos taken inside one get their location hidden, those already uploaded and those to come. */
export default function ZonesSection() {
  const zonesReq = useApi<{ zones: PrivacyZone[] }>('/api/privacy-zones');
  const zones = useKeep(zonesReq.data)?.zones;

  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('300');
  const [from, setFrom] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // The picker needs your photos; fetch them only once it is opened.
  const photosReq = useApi<{ photos: PhotoSummary[] }>(picking ? '/api/photos?mine=1' : null);
  const myPhotos = photosReq.data?.photos;
  const located = useMemo(() => (myPhotos ?? []).filter((p) => p.lat != null && p.lng != null), [myPhotos]);

  function onLat(v: string) {
    const m = PAIR.exec(v);
    if (m) {
      setLat(m[1]);
      setLng(m[2]);
    } else {
      setLat(v);
    }
    setFrom(null);
  }

  function pick(p: PhotoSummary) {
    setLat(String(Math.round(p.lat! * 1e5) / 1e5));
    setLng(String(Math.round(p.lng! * 1e5) / 1e5));
    setFrom(`${p.title ?? '未命名'}${p.takenAt ? `（${fmtStamp(p.takenAt)}）` : ''}`);
    if (!name.trim() && p.city) setName(p.city);
    setPicking(false);
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const la = parseNum(lat, -90, 90);
    const ln = parseNum(lng, -180, 180);
    const r = parseNum(radius, 50, 5000);
    if (!name.trim()) return setMsg({ ok: false, text: '请给这个区域起个名字，例如「家」' });
    if (la == null || ln == null) return setMsg({ ok: false, text: '纬度要在 -90 到 90 之间，经度要在 -180 到 180 之间' });
    if (r == null) return setMsg({ ok: false, text: '半径需要在 50 到 5000 米之间' });
    setBusy(true);
    setMsg(null);
    try {
      const { hiddenPhotos } = await api<CreatePrivacyZoneResponse>('/api/privacy-zones', {
        json: { name: name.trim(), lat: la, lng: ln, radius: Math.round(r) }
      });
      invalidate('/api/privacy-zones');
      if (hiddenPhotos > 0) {
        // those photos now show no location to others: lists, place counts and the map change
        invalidate('/api/photos');
        invalidate('/api/pois');
      }
      setName('');
      setLat('');
      setLng('');
      setRadius('300');
      setFrom(null);
      setMsg({
        ok: true,
        text:
          hiddenPhotos > 0
            ? `已添加「${name.trim()}」，隐藏了 ${hiddenPhotos} 张照片的位置`
            : `已添加「${name.trim()}」，区域内没有要隐藏的照片`
      });
    } catch (err) {
      setMsg({ ok: false, text: errMsg(err, '添加失败') });
    } finally {
      setBusy(false);
    }
  }

  async function remove(z: PrivacyZone) {
    setRemoveBusy(true);
    setMsg(null);
    try {
      await api(`/api/privacy-zones/${z.id}`, { method: 'DELETE' });
      invalidate('/api/privacy-zones');
      setRemoving(null);
      setMsg({ ok: true, text: `已删除「${z.name}」` });
    } catch (err) {
      setMsg({ ok: false, text: errMsg(err, '删除失败') });
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <section className="se-section sf-panel" id="privacy" aria-labelledby="se-zones-h">
      <h2 className="sf-h" id="se-zones-h">
        隐私区域
      </h2>
      <p className="muted se-lede">
        落在区域里的照片，位置会设为隐藏：添加区域时已有的照片一并隐藏，之后上传的自动隐藏，上传页也会提示。删除区域不会恢复。
      </p>

      {!zones && !zonesReq.error && <p className="small muted">加载中…</p>}
      {zonesReq.error != null && !zones && (
        <p className="error-text">
          隐私区域加载失败。
          <button type="button" className="btn btn-quiet" onClick={zonesReq.reload}>
            重试
          </button>
        </p>
      )}
      {zones && zones.length === 0 && <p className="small muted">还没有隐私区域。</p>}
      {zones && zones.length > 0 && (
        <ul className="se-zones">
          {zones.map((z) => (
            <li key={z.id} className="se-zone">
              <div className="se-zone-row">
                <Icon name="pin" size={18} />
                <div className="se-zone-main">
                  <span className="serif se-zone-name">{z.name}</span>
                  <span className="small muted mono">
                    {fmtLat(z.lat)} {fmtLng(z.lng)} · 半径 {z.radius} m
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-quiet"
                  aria-label={`删除隐私区域「${z.name}」`}
                  onClick={() => setRemoving(removing === z.id ? null : z.id)}
                  aria-expanded={removing === z.id}
                >
                  删除
                </button>
              </div>
              {removing === z.id && (
                <ConfirmBar
                  prompt={`删除「${z.name}」？之后上传的照片不再因为它而自动隐藏位置，已隐藏的不会恢复。`}
                  confirmLabel="确认删除"
                  busy={removeBusy}
                  onConfirm={() => void remove(z)}
                  onCancel={() => setRemoving(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="se-zone-form stack" style={{ ['--gap' as string]: '16px' }} onSubmit={add} aria-label="添加隐私区域">
        <h3 className="sf-sub">添加区域</h3>
        <div className="field">
          <label className="label" htmlFor="se-z-name">
            名称
          </label>
          <input
            id="se-z-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="如 家、公司"
          />
        </div>

        <div className="se-coords">
          <div className="field">
            <label className="label" htmlFor="se-z-lat">
              纬度
            </label>
            <input
              id="se-z-lat"
              className="input mono"
              value={lat}
              onChange={(e) => onLat(e.target.value)}
              inputMode="decimal"
              placeholder="30.25920"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="se-z-lng">
              经度
            </label>
            <input
              id="se-z-lng"
              className="input mono"
              value={lng}
              onChange={(e) => {
                setLng(e.target.value);
                setFrom(null);
              }}
              inputMode="decimal"
              placeholder="120.14000"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="se-z-r">
              半径（米）
            </label>
            <input
              id="se-z-r"
              className="input mono"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              inputMode="numeric"
              placeholder="300"
              autoComplete="off"
              aria-describedby="se-z-r-hint"
            />
          </div>
        </div>
        <p id="se-z-r-hint" className="small muted se-hint">
          半径 50–5000 米。坐标是 WGS-84，可以把「纬度, 经度」整段粘贴到纬度栏。
          {from && <> 当前坐标取自照片「{from}」。</>}
        </p>

        <div>
          <button
            type="button"
            className="btn btn-quiet"
            aria-expanded={picking}
            onClick={() => {
              setPicking((p) => !p);
              setShown(PAGE);
            }}
          >
            <Icon name="pin" size={16} />
            {picking ? '收起' : '用照片的位置'}
          </button>
        </div>
        {picking && (
          <div className="se-pick" role="group" aria-label="选择一张有位置的照片">
            {!photosReq.data && !photosReq.error && <p className="small muted">照片加载中…</p>}
            {photosReq.error != null && !photosReq.data && <p className="error-text">照片加载失败。</p>}
            {photosReq.data && located.length === 0 && <p className="small muted">你的照片里还没有带位置的。</p>}
            {located.length > 0 && (
              <>
                <div className="se-grid">
                  {located.slice(0, shown).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="se-thumb"
                      aria-label={`${p.title ?? '未命名'} ${fmtStamp(p.takenAt)} ${p.city ?? ''}`}
                      onClick={() => pick(p)}
                    >
                      <Img photo={p} ratio="1 / 1" sizes="96px" alt="" />
                    </button>
                  ))}
                </div>
                {located.length > shown && (
                  <button type="button" className="btn btn-quiet" onClick={() => setShown((n) => n + PAGE)}>
                    显示更多（还有 {located.length - shown} 张）
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? '添加中…' : '添加隐私区域'}
          </button>
          <span className="small" role="status" aria-live="polite">
            {msg && <span className={msg.ok ? 'sf-ok' : 'error-text'}>{msg.text}</span>}
          </span>
        </div>
      </form>
    </section>
  );
}
