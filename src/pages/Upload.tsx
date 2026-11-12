import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import type { Poi, Tag } from '../../shared/types';
import { Icon } from '../components/icons';
import { invalidate, useApi } from '../lib/useApi';
import { ensureSaved, planPlace } from '../studio/batch-place';
import type { ApplyResult } from '../studio/BatchPlace';
import { isAndroid, onCaptured, pickerAccept, takeCaptured, type Capture } from '../studio/capture';
import { createPoi, type PlaceChoice } from '../studio/match';
import { fileKey } from '../studio/upload-drafts';
import { PageHead } from '../studio/ui';
import UploadBatch from '../studio/UploadBatch';
import UploadBulk from '../studio/UploadBulk';
import UploadDetails from '../studio/UploadDetails';
import UploadItemPanel from '../studio/UploadItemPanel';
import UploadQueue from '../studio/UploadQueue';
import UploadQueueHead from '../studio/UploadQueueHead';
import { hasGps, inBulk, isEditable, newItem, placeOf, statusOf, type Item } from '../studio/upload-model';
import { useFileDrop } from '../studio/useFileDrop';
import { usePlaceMatching } from '../studio/usePlaceMatching';
import { useProcessQueue } from '../studio/useProcessQueue';
import { usePublishing } from '../studio/usePublishing';
import { useQueueSelection } from '../studio/useQueueSelection';
import { useUploadQueue } from '../studio/useUploadQueue';
import { useKeep, useLeaveGuard, useRequireLogin, useTitle } from '../studio/util';
import '../styles/studio.css';

// /upload — drop photos, let the browser read and resize them, confirm places, tag them one by one or several at a
// time, publish one, a selection or everything. Docs: /docs/product/features/upload.md and poi-matching.md
// The queue, reading (a few files at a time), place matching, publishing and the selection are hooks in src/studio/;
// this page connects them to the three columns.

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|heic|heif|gif|bmp|tiff?)$/i;
const isImage = (f: File) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name);
const UA = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const ACCEPT = pickerAccept(UA);
const ANDROID = isAndroid(UA);

export default function Upload() {
  useTitle('上传');
  const { user, ready } = useRequireLogin();

  const queue = useUploadQueue(user?.id ?? null);
  const { items, itemsRef, update, patch, drafts } = queue;
  const { selected, checked, picked, pickedIds, selecting, setSelectedId, setChecked, onPickRow } = useQueueSelection(items, itemsRef);
  const [notice, setNotice] = useState<string | null>(null);
  const [extras, setExtras] = useState<Poi[]>([]);

  const matching = usePlaceMatching(queue);
  useProcessQueue(queue, ready, matching.enqueueMatch);
  const { bulk, publishAndAdvance, publishMany, stopPublishing } = usePublishing(queue, { setNotice, setSelectedId });

  /* ------------------------------------------------------------ adding files */

  const addFiles = useCallback(
    (files: File[], captures?: Map<File, Capture>) => {
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
      // what was filled in for these files before (a reload, a crashed tab) comes back with them
      let restored = 0;
      const added = fresh.map((f) => {
        const kept = drafts.take(f);
        if (kept) restored++;
        const item = newItem(f, captures?.get(f));
        return kept ? { ...item, ...kept } : item;
      });
      if (restored) parts.push(`已恢复 ${restored} 张之前填的内容`);
      setNotice(parts.length ? `${parts.join('，')}。` : null);
      if (!added.length) return;
      update((prev) => [...prev, ...added]);
      setSelectedId((cur) => (cur && itemsRef.current.some((i) => i.id === cur) ? cur : added[0].id));
    },
    [itemsRef, update, drafts, setSelectedId]
  );
  const drop = useFileDrop(addFiles);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  // Photos taken with the camera button in the phone's bottom bar: left for this page before it opened, or while it is open.
  useEffect(() => {
    const take = () => {
      const shots = takeCaptured();
      if (shots.length)
        addFiles(
          shots.map((s) => s.file),
          new Map(shots.map((s) => [s.file, s]))
        );
    };
    take();
    return onCaptured(take);
  }, [addFiles]);

  /* ------------------------------------------------------------ item actions */

  const { forget } = matching;
  const remove = useCallback(
    (id: string) => {
      const list = itemsRef.current;
      const at = list.findIndex((i) => i.id === id);
      const it = list[at];
      if (!it) return;
      if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
      forget(id);
      update((prev) => prev.filter((i) => i.id !== id));
      drafts.forget([it.file]);
      setSelectedId((cur) => {
        if (cur !== id) return cur;
        const rest = itemsRef.current;
        return (rest[at] ?? rest[at - 1] ?? null)?.id ?? null;
      });
    },
    [itemsRef, forget, update, drafts, setSelectedId]
  );

  const clearPublished = useCallback(() => {
    for (const it of itemsRef.current)
      if ((it.publish.state === 'done' || it.publish.state === 'duplicate') && it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
    update((prev) => prev.filter((i) => i.publish.state !== 'done' && i.publish.state !== 'duplicate'));
    setSelectedId((cur) => (cur && itemsRef.current.some((i) => i.id === cur) ? cur : (itemsRef.current[0]?.id ?? null)));
  }, [itemsRef, update, setSelectedId]);

  const onPlace = useCallback((id: string, choice: PlaceChoice | null) => patch(id, { place: choice, cleared: choice == null }), [patch]);
  const onPatch = useCallback((id: string, p: Partial<Item>) => patch(id, p), [patch]);
  const onCreated = useCallback((poi: Poi) => setExtras((prev) => (prev.some((x) => x.id === poi.id) ? prev : [...prev, poi])), []);
  const onRetryProcess = useCallback((id: string) => patch(id, { stage: 'queued', error: null }), [patch]);

  /* ------------------------------------------------------------ the selection */

  /** Change every selected photo that can still be edited. */
  const editPicked = useCallback(
    (fn: (it: Item) => Partial<Item>) => {
      const ids = new Set(checked);
      update((prev) => prev.map((it) => (ids.has(it.id) && isEditable(it) ? { ...it, ...fn(it) } : it)));
    },
    [checked, update]
  );

  /**
   * One place for every selected photo that can take it. A custom place is created once first, so the photos share
   * one row instead of the server making one per photo; photos clearly too far from it are left alone.
   */
  const placePicked = useCallback(
    async (choice: PlaceChoice, fromCandidates: boolean): Promise<ApplyResult> => {
      const { choice: saved, created } = await ensureSaved(choice, createPoi);
      if (created) {
        invalidate('/api/pois');
        onCreated(created);
      }
      const ids = new Set(checked);
      const plan = planPlace(
        itemsRef.current.filter((i) => ids.has(i.id)),
        saved,
        fromCandidates
      );
      update((prev) => prev.map((it) => (plan.patches.has(it.id) ? { ...it, ...plan.patches.get(it.id) } : it)));
      return { key: saved.key, done: plan.patches.size, far: plan.far.length, pending: plan.pending.length };
    },
    [checked, itemsRef, update, onCreated]
  );
  const clearPickedPlace = useCallback(() => editPicked(() => ({ place: null, cleared: true })), [editPicked]);

  const publishPicked = useCallback(async () => {
    await publishMany(checked);
    if (!queue.alive.current) return;
    // what did not go out stays checked, so it can be fixed and sent again
    setChecked(checked.filter((id) => itemsRef.current.some((i) => i.id === id && inBulk(i))));
  }, [checked, publishMany, queue.alive, itemsRef, setChecked]);

  /* ------------------------------------------------------------ derived */

  const { data: tagData } = useApi<{ tags: Tag[] }>(ready ? '/api/tags' : null);
  const tagList = useKeep(tagData)?.tags;
  const tagNames = useMemo(() => new Map((tagList ?? []).map((t) => [t.id, t.name])), [tagList]);

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
  const batch = picked.length > 1;
  // Android's photo picker removes the position before the browser sees the file; the file browser does not.
  const stripped = ANDROID && items.some((i) => i.stage === 'ready' && !i.capture && !hasGps(i));

  // Unpublished photos live only in this tab; what was typed for them is kept as a draft (useUploadDrafts).
  const unsaved = items.some((i) => i.stage !== 'error' && i.publish.state !== 'done' && i.publish.state !== 'duplicate');
  useLeaveGuard(unsaved, '还有没发布的照片。离开后要重新加入，已填的内容会恢复。确定离开吗？');

  if (!ready) return <p className="loading">加载中</p>;

  const filled = items.length > 0;
  const { dragging } = drop;

  return (
    <main
      className="page up"
      onDragEnter={drop.handlers.onDragEnter}
      onDragOver={drop.handlers.onDragOver}
      onDragLeave={drop.handlers.onDragLeave}
      onDrop={drop.handlers.onDrop}
      data-dragging={dragging}
      data-filled={filled}
      data-batch={batch}
    >
      {!filled && <PageHead title="上传" caption="照片在浏览器里处理，确认后才会发到站点。关掉页面，没发布的照片不会入库。" />}

      {/* with photos queued, the heading and the drop zone shrink to one bar so the workspace below fits the window:
          the title, a button to add more (the whole page takes a drop), and publishing everything at the right */}
      <div className="up-top">
        {filled && <h1 className="display up-title">上传</h1>}
        <label className="up-drop" data-active={dragging} data-compact={filled}>
          <input type="file" multiple accept={ACCEPT} className="visually-hidden" onChange={onPick} />
          <span className="up-drop-btn">
            <span className="up-drop-icon" aria-hidden="true">
              <Icon name={filled ? 'plus' : 'upload'} size={filled ? 16 : 26} />
            </span>
            <span className="up-drop-title">{dragging ? '松开以添加' : filled ? '添加照片' : '拖入照片，或点击选择'}</span>
          </span>
          <span className="small muted up-drop-hint">
            {filled
              ? '也可以把照片拖进页面 · 单张不超过 50 MB'
              : 'JPEG、PNG、WebP、AVIF、HEIC（iPhone 照片）。单张不超过 50 MB。Safari 以外的浏览器会先在本地解码 HEIC，比 JPEG 慢一些。'}
          </span>
        </label>
        {filled && (
          <UploadBulk
            items={items}
            bulk={bulk}
            onPublishAll={(ids) => void publishMany(ids)}
            onStop={stopPublishing}
            onClearPublished={clearPublished}
          />
        )}
        {notice && (
          <p className="notice up-notice small" role="status">
            {notice}
          </p>
        )}
        {ANDROID && (!filled || stripped) && (
          <p className="up-notice small muted" role={stripped ? 'status' : undefined}>
            {stripped
              ? '有照片没有位置。安卓的照片选择器会去掉位置：点选择后请进「文件」里选，照片才是带位置的原图。'
              : '安卓上点选择后请进「文件」里选：系统的照片选择器会去掉照片的位置。'}
          </p>
        )}
      </div>

      {items.length > 0 && selected && (
        <div className="up-grid">
          <aside className="up-col up-col-queue" aria-label="队列">
            <UploadQueueHead
              items={items}
              statuses={statuses}
              selected={selected}
              pickedIds={pickedIds}
              pickedCount={picked.length}
              onCheck={setChecked}
            />
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
              onRadius={matching.onRadius}
              onRetryMatch={matching.onRetryMatch}
              onRetryProcess={onRetryProcess}
            />
          </section>

          <section className="up-col up-col-details" aria-label="整理">
            {batch ? (
              <UploadBatch
                items={picked}
                all={items}
                extras={extras}
                onPlace={placePicked}
                onClearPlace={clearPickedPlace}
                onCreated={onCreated}
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
