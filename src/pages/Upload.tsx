import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { Poi, Tag } from '../../shared/types';
import { Icon } from '../components/icons';
import { invalidate, useApi } from '../lib/useApi';
import { DEFAULT_RADIUS, initialMatch, matchPois, type PlaceChoice } from '../studio/match';
import { processFile } from '../studio/process';
import { uploadPhoto } from '../studio/publish';
import { PageHead } from '../studio/ui';
import UploadBatch from '../studio/UploadBatch';
import UploadDetails from '../studio/UploadDetails';
import UploadItemPanel from '../studio/UploadItemPanel';
import UploadQueue from '../studio/UploadQueue';
import {
  applyMatch,
  buildForm,
  bulkSendable,
  coordsOf,
  freshMatch,
  inBulk,
  isEditable,
  newItem,
  pickRows,
  placeOf,
  statusOf,
  type Item,
  type PickHow,
  type StatusKey
} from '../studio/upload-model';
import { errMsg, useKeep, useLeaveGuard, useRequireLogin, useTitle } from '../studio/util';
import '../styles/studio.css';

// /upload — drop photos, let the browser read and resize them, confirm places, tag them one by one or several at a
// time, publish one, a selection or everything. Docs: /docs/product/features/upload.md and poi-matching.md

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

/** The line a publishing run leaves behind. */
function runSummary(t: { done: number; duplicate: number; failed: number }, stopped: boolean): string | null {
  const parts = [`已发布 ${t.done} 张`];
  if (t.duplicate) parts.push(`${t.duplicate} 张以前传过`);
  if (t.failed) parts.push(`${t.failed} 张失败，可以重试`);
  if (!stopped && !t.duplicate && !t.failed && !t.done) return null;
  return `${stopped ? '已停止。' : ''}${parts.join('，')}。`;
}

export default function Upload() {
  useTitle('上传');
  const { ready } = useRequireLogin();

  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** checked photos, in queue order; two or more are edited together */
  const [checked, setChecked] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [extras, setExtras] = useState<Poi[]>([]);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [kick, setKick] = useState(0);

  const alive = useRef(true);
  const busy = useRef(false);
  const dragDepth = useRef(0);
  const stopBulk = useRef(false);
  const bulkOn = useRef(false);
  const rangeFrom = useRef<string | null>(null);
  /** a publishing run waiting for photos to be processed or matched */
  const waiters = useRef<(() => void)[]>([]);
  const inflight = useRef(new Set<string>());
  const matchChain = useRef<Promise<void>>(Promise.resolve());
  const matchSeq = useRef(new Map<string, number>());
  const radiusTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const wake = useCallback(() => {
    const ws = waiters.current;
    waiters.current = [];
    for (const w of ws) w();
  }, []);

  useEffect(() => {
    alive.current = true;
    const timers = radiusTimers.current;
    return () => {
      alive.current = false;
      timers.forEach(clearTimeout);
      for (const it of itemsRef.current) if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
      wake();
    };
  }, [wake]);

  /** All queue changes go through here so `itemsRef` is always current for async code. */
  const update = useCallback(
    (fn: (prev: Item[]) => Item[]) => {
      const next = fn(itemsRef.current);
      itemsRef.current = next;
      setItems(next);
      wake();
    },
    [wake]
  );
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
        const p = await processFile(next.file, (phase) => {
          if (alive.current) patch(next.id, { phase });
        });
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
        if (alive.current) patch(next.id, { stage: 'error', phase: null, error: errMsg(e, '处理失败') });
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

  /**
   * Publish these photos as they are, one after another. Photos still being read or matched are waited for; each
   * photo is tried once, and one sent by hand meanwhile is left alone.
   */
  const publishMany = useCallback(
    async (ids: readonly string[]) => {
      if (bulkOn.current) return;
      const left = new Set(ids.filter((id) => itemsRef.current.some((i) => i.id === id && inBulk(i))));
      const total = left.size;
      if (!total) return;
      bulkOn.current = true;
      stopBulk.current = false;
      const tally = { done: 0, duplicate: 0, failed: 0 };
      setBulk({ done: 0, total });
      setNotice(null);
      try {
        while (left.size && !stopBulk.current && alive.current) {
          const list = itemsRef.current;
          let next: string | null = null;
          for (const id of left) {
            const it = list.find((i) => i.id === id);
            if (!it || !inBulk(it)) left.delete(id); // removed, unreadable, or sent by hand
            else if (!next && bulkSendable(it, list)) next = id;
          }
          if (next) {
            left.delete(next);
            await publishOne(next);
            const state = itemsRef.current.find((i) => i.id === next)?.publish.state;
            if (state === 'done') tally.done++;
            else if (state === 'duplicate') tally.duplicate++;
            else if (state === 'failed') tally.failed++;
          } else if (left.size) {
            await new Promise<void>((resolve) => waiters.current.push(resolve));
          }
          if (alive.current) setBulk({ done: total - left.size, total });
        }
      } finally {
        bulkOn.current = false;
        if (alive.current) {
          setBulk(null);
          setNotice(runSummary(tally, left.size > 0));
        }
      }
    },
    [publishOne]
  );

  const stopPublishing = useCallback(() => {
    stopBulk.current = true;
    wake();
  }, [wake]);

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
    for (const it of itemsRef.current)
      if ((it.publish.state === 'done' || it.publish.state === 'duplicate') && it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
    update((prev) => prev.filter((i) => i.publish.state !== 'done' && i.publish.state !== 'duplicate'));
    setSelectedId((cur) => (cur && itemsRef.current.some((i) => i.id === cur) ? cur : (itemsRef.current[0]?.id ?? null)));
  }, [update]);

  const onPlace = useCallback((id: string, choice: PlaceChoice | null) => patch(id, { place: choice, cleared: choice == null }), [patch]);
  const onPatch = useCallback((id: string, p: Partial<Item>) => patch(id, p), [patch]);
  const onCreated = useCallback((poi: Poi) => setExtras((prev) => (prev.some((x) => x.id === poi.id) ? prev : [...prev, poi])), []);
  const onRetryProcess = useCallback((id: string) => patch(id, { stage: 'queued', error: null }), [patch]);

  /* ------------------------------------------------------------ selection */

  const onPickRow = useCallback(
    (id: string, how: PickHow) => {
      const order = itemsRef.current.map((i) => i.id);
      const cur = itemsRef.current.some((i) => i.id === selectedId) ? selectedId : (order[0] ?? null);
      const next = pickRows(order, checked, cur, id, how, rangeFrom.current);
      if (how !== 'range') rangeFrom.current = id;
      setChecked(next.checked);
      setSelectedId(next.current);
    },
    [checked, selectedId]
  );

  /** Change every selected photo that can still be edited. */
  const editPicked = useCallback(
    (fn: (it: Item) => Partial<Item>) => {
      const ids = new Set(checked);
      update((prev) => prev.map((it) => (ids.has(it.id) && isEditable(it) ? { ...it, ...fn(it) } : it)));
    },
    [checked, update]
  );

  const publishPicked = useCallback(async () => {
    await publishMany(checked);
    if (!alive.current) return;
    // what did not go out stays checked, so it can be fixed and sent again
    setChecked(checked.filter((id) => itemsRef.current.some((i) => i.id === id && inBulk(i))));
  }, [checked, publishMany]);

  /* ------------------------------------------------------------ derived */

  const { data: tagData } = useApi<{ tags: Tag[] }>(ready ? '/api/tags' : null);
  const tagList = useKeep(tagData)?.tags;
  const tagNames = useMemo(() => new Map((tagList ?? []).map((t) => [t.id, t.name])), [tagList]);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? items[0] ?? null, [items, selectedId]);
  const statuses = useMemo(() => items.map((it) => statusOf(it, items)), [items]);
  const places = useMemo(
    () => items.map((it, i) => (statuses[i].key === 'matched' ? (placeOf(it, items)?.name ?? null) : null)),
    [items, statuses]
  );
  const tagLines = useMemo(
    () =>
      items.map((it) =>
        it.tags
          .map((id) => tagNames.get(id))
          .filter(Boolean)
          .join(' · ')
      ),
    [items, tagNames]
  );
  const counts = useMemo(() => {
    const c = new Map<StatusKey, number>();
    for (const s of statuses) c.set(s.key, (c.get(s.key) ?? 0) + 1);
    return c;
  }, [statuses]);
  const picked = useMemo(() => {
    const ids = new Set(checked);
    return items.filter((i) => ids.has(i.id));
  }, [items, checked]);
  const batch = picked.length > 1;
  const pickedIds = useMemo(() => new Set(picked.map((i) => i.id)), [picked]);
  const toSend = items.filter(inBulk).length;
  const selectable = items.filter(isEditable);
  const allPicked = selectable.length > 0 && selectable.every((i) => pickedIds.has(i.id));
  const publishedCount = (counts.get('published') ?? 0) + (counts.get('duplicate') ?? 0);

  // Esc drops a selection (but not while typing in a field)
  const selecting = picked.length > 0;
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest('input:not([type=checkbox]), textarea, select, [contenteditable]')) return;
      setChecked([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  // Unpublished photos live only in this tab.
  const unsaved = items.some((i) => i.stage !== 'error' && i.publish.state !== 'done' && i.publish.state !== 'duplicate');
  useLeaveGuard(unsaved, '还有没发布的照片，离开这个页面会丢掉它们。确定离开吗？');

  if (!ready) return <p className="loading">加载中</p>;

  const filled = items.length > 0;

  return (
    <main
      className="page up"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-dragging={dragging}
      data-filled={filled}
      data-batch={batch}
    >
      {!filled && <PageHead title="上传" caption="照片在浏览器里处理，确认后才会发到站点。关掉页面，没发布的照片不会入库。" />}

      {/* with photos queued, the heading and the drop zone shrink to one bar so the workspace below fits the window */}
      <div className="up-top">
        {filled && <h1 className="display up-title">上传</h1>}
        <label className="up-drop" data-active={dragging} data-compact={filled}>
          <input type="file" multiple accept="image/*,.heic,.heif,.avif" className="visually-hidden" onChange={onPick} />
          <Icon name="upload" size={filled ? 20 : 30} />
          <span className="up-drop-text">
            <span className="up-drop-title serif">{dragging ? '松开以添加' : filled ? '添加照片' : '拖入照片，或点击选择'}</span>
            <span className="small muted">
              {filled
                ? '拖入或点击 · JPEG、PNG、WebP、AVIF、HEIC，单张不超过 50 MB'
                : 'JPEG、PNG、WebP、AVIF、HEIC（iPhone 照片）。单张不超过 50 MB。Safari 以外的浏览器会先在本地解码 HEIC，比 JPEG 慢一些。'}
            </span>
          </span>
        </label>
        {notice && (
          <p className="notice up-notice small" role="status">
            {notice}
          </p>
        )}
      </div>

      {items.length > 0 && selected && (
        <div className="up-grid">
          <aside className="up-col up-col-queue" aria-label="队列">
            <div className="up-queue-head">
              <div className="up-queue-title">
                <h2 className="up-h serif">
                  队列 <span className="mono">{items.length}</span>
                </h2>
                {selectable.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-quiet up-pickall"
                    aria-pressed={allPicked}
                    onClick={() => setChecked(allPicked ? [] : selectable.map((i) => i.id))}
                  >
                    {allPicked ? '取消全选' : '全选'}
                  </button>
                )}
              </div>
              <div className="up-summary small" aria-label="状态统计">
                {SUMMARY.filter((s) => counts.get(s.key)).map((s) => (
                  <span key={s.key} className="up-chip" data-status={s.key}>
                    {s.label} <span className="mono">{counts.get(s.key)}</span>
                  </span>
                ))}
              </div>
              <div className="up-bulk">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!!bulk || toSend === 0}
                  title="照原样发布队列里所有还没发的照片；没确认地点的不关联地点"
                  onClick={() => void publishMany(items.filter(inBulk).map((i) => i.id))}
                >
                  {bulk ? `发布中 ${bulk.done} / ${bulk.total}` : `全部发布（${toSend}）`}
                </button>
                {bulk && (
                  <button type="button" className="btn btn-quiet" onClick={stopPublishing}>
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
            <UploadQueue
              items={items}
              statuses={statuses}
              places={places}
              tagLines={tagLines}
              currentId={selected.id}
              checked={pickedIds}
              selecting={selecting}
              onPick={onPickRow}
              onRemove={remove}
            />
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
            {batch ? (
              <UploadBatch
                items={picked}
                onEdit={editPicked}
                onPublish={() => void publishPicked()}
                onClear={() => setChecked([])}
                onShow={setSelectedId}
                shownId={selected.id}
                bulk={bulk}
              />
            ) : (
              <UploadDetails
                key={selected.id}
                item={selected}
                all={items}
                onPatch={onPatch}
                onPublish={(id) => void publishAndAdvance(id)}
              />
            )}
          </section>
        </div>
      )}
    </main>
  );
}
