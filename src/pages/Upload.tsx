import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { Poi } from '../../shared/types';
import { Icon } from '../components/icons';
import { invalidate } from '../lib/useApi';
import { DEFAULT_RADIUS, initialMatch, matchPois, type PlaceChoice } from '../studio/match';
import { processFile } from '../studio/process';
import { uploadPhoto } from '../studio/publish';
import { PageHead } from '../studio/ui';
import UploadDetails from '../studio/UploadDetails';
import UploadItemPanel from '../studio/UploadItemPanel';
import UploadQueue from '../studio/UploadQueue';
import { applyMatch, buildForm, coordsOf, freshMatch, isBulkReady, newItem, statusOf, type Item, type StatusKey } from '../studio/upload-model';
import { errMsg, useLeaveGuard, useRequireLogin, useTitle } from '../studio/util';
import '../styles/studio.css';

// /upload — drop photos, let the browser read and resize them, confirm places, publish.
// Docs: /docs/product/features/upload.md and poi-matching.md

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|heic|heif|gif|bmp|tiff?)$/i;
const isImage = (f: File) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name);
const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

const SUMMARY: { key: StatusKey; label: string }[] = [
  { key: 'matched', label: '已匹配' },
  { key: 'review', label: '待确认' },
  { key: 'nogps', label: '无位置' },
  { key: 'hidden', label: '位置不公开' },
  { key: 'processing', label: '处理中' },
  { key: 'sending', label: '发布中' },
  { key: 'published', label: '已发布' },
  { key: 'duplicate', label: '已存在' },
  { key: 'failed', label: '失败' }
];

const EMPTY_BLOB = new Blob([]);

export default function Upload() {
  useTitle('上传');
  const { ready } = useRequireLogin();

  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [extras, setExtras] = useState<Poi[]>([]);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [kick, setKick] = useState(0);

  const alive = useRef(true);
  const busy = useRef(false);
  const dragDepth = useRef(0);
  const stopBulk = useRef(false);
  const inflight = useRef(new Set<string>());
  const matchChain = useRef<Promise<void>>(Promise.resolve());
  const matchSeq = useRef(new Map<string, number>());
  const radiusTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    alive.current = true;
    const timers = radiusTimers.current;
    return () => {
      alive.current = false;
      timers.forEach(clearTimeout);
      for (const it of itemsRef.current) if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
    };
  }, []);

  /** All queue changes go through here so `itemsRef` is always current for async code. */
  const update = useCallback((fn: (prev: Item[]) => Item[]) => {
    const next = fn(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
  }, []);
  const patch = useCallback(
    (id: string, p: Partial<Item> | ((cur: Item) => Partial<Item>)) =>
      update((prev) => prev.map((it) => (it.id === id ? { ...it, ...(typeof p === 'function' ? p(it) : p) } : it))),
    [update]
  );

  /* ------------------------------------------------------------ adding files */

  const addFiles = useCallback(
    (files: File[]) => {
      const images = files.filter(isImage);
      const known = new Set(itemsRef.current.map((i) => fileKey(i.file)));
      const fresh: File[] = [];
      for (const f of images) {
        if (!known.has(fileKey(f))) {
          known.add(fileKey(f));
          fresh.push(f);
        }
      }
      const parts: string[] = [];
      if (files.length - images.length > 0) parts.push(`已忽略 ${files.length - images.length} 个不是图片的文件`);
      if (images.length - fresh.length > 0) parts.push(`${images.length - fresh.length} 张已在队列里`);
      setNotice(parts.length ? `${parts.join('，')}。` : null);
      if (!fresh.length) return;
      const added = fresh.map(newItem);
      update((prev) => [...prev, ...added]);
      setSelectedId((cur) => (cur && itemsRef.current.some((i) => i.id === cur) ? cur : added[0].id));
    },
    [update]
  );

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  /* ------------------------------------------------------------ matching */

  const runMatch = useCallback(
    async (id: string, radius: number) => {
      const it = itemsRef.current.find((i) => i.id === id);
      const at = it && coordsOf(it);
      if (!it || !it.p || !at) return;
      const mine = (matchSeq.current.get(id) ?? 0) + 1;
      matchSeq.current.set(id, mine);
      patch(id, (cur) => ({ match: { ...(cur.match ?? initialMatch()), radius, loading: true, error: null } }));
      try {
        const res = await matchPois(at.lat, at.lng, it.p.exif.heading, radius);
        if (!alive.current || matchSeq.current.get(id) !== mine) return;
        patch(id, (cur) => applyMatch(cur, res, radius));
      } catch (e) {
        if (!alive.current || matchSeq.current.get(id) !== mine) return;
        patch(id, (cur) => ({ match: { ...(cur.match ?? initialMatch()), radius, loading: false, error: errMsg(e, '地点匹配失败') } }));
      }
    },
    [patch]
  );

  /** First matches run one after another so a big batch does not hammer the map providers. */
  const enqueueMatch = useCallback(
    (id: string) => {
      matchChain.current = matchChain.current.then(() => runMatch(id, DEFAULT_RADIUS)).catch(() => {});
    },
    [runMatch]
  );

  const onRadius = useCallback(
    (id: string, radius: number) => {
      patch(id, (cur) => ({ match: { ...(cur.match ?? initialMatch()), radius } }));
      clearTimeout(radiusTimers.current.get(id));
      radiusTimers.current.set(
        id,
        setTimeout(() => void runMatch(id, radius), 350)
      );
    },
    [patch, runMatch]
  );

  const onRetryMatch = useCallback(
    (id: string) => {
      const it = itemsRef.current.find((i) => i.id === id);
      void runMatch(id, it?.match?.radius ?? DEFAULT_RADIUS);
    },
    [runMatch]
  );

  /* ------------------------------------------------------------ processing (one file at a time) */

  useEffect(() => {
    if (!ready || busy.current) return;
    const next = items.find((i) => i.stage === 'queued');
    if (!next) return;
    busy.current = true;
    patch(next.id, { stage: 'processing', error: null });
    void (async () => {
      try {
        const p = await processFile(next.file);
        if (!alive.current) return;
        if (!itemsRef.current.some((i) => i.id === next.id)) return; // removed while processing
        const twin = p.sha256 ? itemsRef.current.find((o) => o.id !== next.id && o.p?.sha256 === p.sha256) : undefined;
        if (twin) {
          patch(next.id, { stage: 'error', error: `和「${twin.file.name}」是同一个文件，已跳过。` });
          return;
        }
        const positioned = p.exif.lat != null && p.exif.lng != null;
        patch(next.id, { stage: 'ready', p, thumbUrl: URL.createObjectURL(p.variants.s.blob), match: positioned ? freshMatch() : null });
        if (positioned) enqueueMatch(next.id);
      } catch (e) {
        if (alive.current) patch(next.id, { stage: 'error', error: errMsg(e, '处理失败') });
      } finally {
        busy.current = false;
        if (alive.current) setKick((k) => k + 1);
      }
    })();
  }, [items, ready, kick, patch, enqueueMatch]);

  /* ------------------------------------------------------------ publishing */

  const publishOne = useCallback(
    async (id: string): Promise<void> => {
      const it = itemsRef.current.find((i) => i.id === id);
      if (!it || !it.p || inflight.current.has(id)) return;
      inflight.current.add(id);
      patch(id, { publish: { state: 'sending', progress: 0 } });
      try {
        let last = 0;
        const r = await uploadPhoto(buildForm(it, itemsRef.current), (f) => {
          if (f - last >= 0.01 || f === 1) {
            last = f;
            if (alive.current) patch(id, { publish: { state: 'sending', progress: f } });
          }
        });
        if (!alive.current) return;
        if (r.ok) {
          patch(id, (cur) => ({
            publish: { state: 'done', progress: 1, photoId: r.photo.id },
            // the 2560 px copy is no longer needed in memory
            p: cur.p ? { ...cur.p, variants: { ...cur.p.variants, l: { ...cur.p.variants.l, blob: EMPTY_BLOB } } } : cur.p
          }));
          invalidate('/api/photos');
          invalidate('/api/tags');
          invalidate('/api/pois');
          invalidate('/api/themes');
        } else if (r.status === 409 && r.code === 'duplicate') {
          patch(id, { publish: { state: 'duplicate', progress: 0, photoId: r.photoId } });
        } else {
          patch(id, { publish: { state: 'failed', progress: 0, error: r.message } });
        }
      } catch (e) {
        if (alive.current) patch(id, { publish: { state: 'failed', progress: 0, error: errMsg(e, '发布失败，请重试') } });
      } finally {
        inflight.current.delete(id);
      }
    },
    [patch]
  );

  /** After a manual publish, move on to the next photo that still needs attention. */
  const publishAndAdvance = useCallback(
    async (id: string) => {
      await publishOne(id);
      if (!alive.current) return;
      const list = itemsRef.current;
      // A duplicate stays selected: its explanation and the link to the existing photo are on this panel.
      if (list.find((i) => i.id === id)?.publish.state !== 'done') return;
      const at = list.findIndex((i) => i.id === id);
      const open = (i: Item) => i.publish.state !== 'done' && i.publish.state !== 'duplicate';
      const nxt = list.slice(at + 1).find(open) ?? list.find(open);
      setSelectedId((cur) => (cur === id && nxt ? nxt.id : cur));
      // One column on a phone: bring the next photo's preview back into view.
      if (nxt && window.matchMedia('(max-width: 759px)').matches) {
        requestAnimationFrame(() => document.querySelector('.up-col-match')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
      }
    },
    [publishOne]
  );

  const publishAll = useCallback(async () => {
    const ids = itemsRef.current.filter((i) => isBulkReady(i, itemsRef.current)).map((i) => i.id);
    if (!ids.length) return;
    stopBulk.current = false;
    setBulk({ done: 0, total: ids.length });
    let done = 0;
    for (const id of ids) {
      if (stopBulk.current || !alive.current) break;
      const cur = itemsRef.current.find((i) => i.id === id);
      if (!cur || !isBulkReady(cur, itemsRef.current)) {
        done++;
        continue; // changed since the click
      }
      await publishOne(id);
      done++;
      if (alive.current) setBulk({ done, total: ids.length });
    }
    if (alive.current) setBulk(null);
  }, [publishOne]);

  /* ------------------------------------------------------------ item actions */

  const remove = useCallback(
    (id: string) => {
      const list = itemsRef.current;
      const at = list.findIndex((i) => i.id === id);
      const it = list[at];
      if (!it) return;
      if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
      clearTimeout(radiusTimers.current.get(id));
      update((prev) => prev.filter((i) => i.id !== id));
      setSelectedId((cur) => {
        if (cur !== id) return cur;
        const rest = itemsRef.current;
        return (rest[at] ?? rest[at - 1] ?? null)?.id ?? null;
      });
    },
    [update]
  );

  const clearPublished = useCallback(() => {
    for (const it of itemsRef.current) if ((it.publish.state === 'done' || it.publish.state === 'duplicate') && it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
    update((prev) => prev.filter((i) => i.publish.state !== 'done' && i.publish.state !== 'duplicate'));
    setSelectedId((cur) => (cur && itemsRef.current.some((i) => i.id === cur) ? cur : itemsRef.current[0]?.id ?? null));
  }, [update]);

  const onPlace = useCallback((id: string, choice: PlaceChoice | null) => patch(id, { place: choice, cleared: choice == null }), [patch]);
  const onPatch = useCallback((id: string, p: Partial<Item>) => patch(id, p), [patch]);
  const onCreated = useCallback((poi: Poi) => setExtras((prev) => (prev.some((x) => x.id === poi.id) ? prev : [...prev, poi])), []);
  const onRetryProcess = useCallback((id: string) => patch(id, { stage: 'queued', error: null }), [patch]);

  const settled = (i: Item) => i.publish.state === 'done' || i.publish.state === 'duplicate' || i.publish.state === 'sending';
  const applyRest = useCallback(
    (fromId: string) => {
      const src = itemsRef.current.find((i) => i.id === fromId);
      if (!src) return;
      update((prev) =>
        prev.map((it) =>
          it.id === fromId || it.stage !== 'ready' || settled(it)
            ? it
            : {
                ...it,
                visibility: src.visibility,
                geoPrivacy: it.match?.res?.privacyZone ? 'hidden' : src.geoPrivacy,
                geoTouched: it.geoTouched || src.geoTouched,
                inLiving: src.inLiving,
                favorite: src.favorite,
                themeIds: [...src.themeIds]
              }
        )
      );
      setNotice('已套用到其余未发布的照片。');
    },
    [update]
  );

  /* ------------------------------------------------------------ derived */

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? items[0] ?? null, [items, selectedId]);
  const statuses = useMemo(() => items.map((it) => statusOf(it, items)), [items]);
  const counts = useMemo(() => {
    const c = new Map<StatusKey, number>();
    for (const s of statuses) c.set(s.key, (c.get(s.key) ?? 0) + 1);
    return c;
  }, [statuses]);
  const bulkCount = useMemo(() => items.filter((it, i) => it.stage === 'ready' && it.publish.state === 'idle' && statuses[i].key === 'matched').length, [items, statuses]);
  const publishedCount = (counts.get('published') ?? 0) + (counts.get('duplicate') ?? 0);
  const othersOpen = selected ? items.filter((i) => i.id !== selected.id && i.stage === 'ready' && !settled(i)).length : 0;

  // Unpublished photos live only in this tab.
  const unsaved = items.some((i) => i.stage !== 'error' && i.publish.state !== 'done' && i.publish.state !== 'duplicate');
  useLeaveGuard(unsaved, '还有没发布的照片，离开这个页面会丢掉它们。确定离开吗？');

  if (!ready) return <p className="loading">加载中</p>;

  return (
    <main className="page up" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} data-dragging={dragging}>
      <PageHead title="上传" caption="照片在浏览器里处理，确认后才会发到站点。关掉页面，没发布的照片不会入库。" />

      <label className="up-drop" data-active={dragging} data-compact={items.length > 0}>
        <input type="file" multiple accept="image/*,.heic,.heif,.avif" className="visually-hidden" onChange={onPick} />
        <Icon name="upload" size={items.length ? 22 : 30} />
        <span className="up-drop-text">
          <span className="up-drop-title serif">{dragging ? '松开以添加' : '拖入照片，或点击选择'}</span>
          <span className="small muted">JPEG、PNG、WebP、AVIF；HEIC 需在 Safari 中上传。单张不超过 50 MB。</span>
        </span>
      </label>

      {notice && (
        <p className="notice up-notice" role="status">
          {notice}
        </p>
      )}

      {items.length > 0 && selected && (
        <div className="up-grid">
          <aside className="up-col up-col-queue" aria-label="队列">
            <div className="up-queue-head">
              <h2 className="up-h serif">队列 <span className="mono">{items.length}</span></h2>
              <div className="up-summary small" aria-label="状态统计">
                {SUMMARY.filter((s) => counts.get(s.key)).map((s) => (
                  <span key={s.key} className="up-chip" data-status={s.key}>
                    {s.label} <span className="mono">{counts.get(s.key)}</span>
                  </span>
                ))}
              </div>
              <div className="up-bulk">
                <button type="button" className="btn btn-primary" disabled={!!bulk || bulkCount === 0} onClick={() => void publishAll()}>
                  {bulk ? `发布中 ${bulk.done} / ${bulk.total}` : `发布全部已匹配（${bulkCount}）`}
                </button>
                {bulk && (
                  <button type="button" className="btn btn-quiet" onClick={() => (stopBulk.current = true)}>
                    停止
                  </button>
                )}
                {!bulk && publishedCount > 0 && (
                  <button type="button" className="btn btn-quiet" onClick={clearPublished}>
                    清除已发布
                  </button>
                )}
              </div>
            </div>
            <UploadQueue items={items} statuses={statuses} selectedId={selected.id} onSelect={setSelectedId} onRemove={remove} />
          </aside>

          <section className="up-col up-col-match" aria-label="照片与地点">
            <UploadItemPanel
              key={selected.id}
              item={selected}
              all={items}
              extras={extras}
              onCreated={onCreated}
              onPlace={onPlace}
              onRadius={onRadius}
              onRetryMatch={onRetryMatch}
              onRetryProcess={onRetryProcess}
            />
          </section>

          <section className="up-col up-col-details" aria-label="整理">
            <UploadDetails key={selected.id} item={selected} all={items} onPatch={onPatch} onPublish={(id) => void publishAndAdvance(id)} onApplyRest={applyRest} unpublishedOthers={othersOpen} />
          </section>
        </div>
      )}
    </main>
  );
}
