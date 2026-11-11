// How many photos the upload page reads and resizes at once, and which go next.
// Decoding (createImageBitmap), encoding (toBlob) and hashing (crypto.subtle) run off the main thread, so with two photos
// in flight the decoder, the encoder and the main thread are busy at the same time. Measured in Chromium on a 4-core
// machine with 20 photos of 24 MP, place matching left out: one at a time 20–21 s, two 12 s, three 9–10 s. On the real
// page, typing in the form meanwhile, keystrokes waited at most 0.06–0.16 s one at a time, 0.11–0.22 s at two and
// 0.44–0.73 s at three. So two, and one on devices that say they are very small.
// Every photo in flight holds its decoded bitmap (4 bytes a pixel, about 100 MB at 24 MP) until its largest size is
// drawn. Docs: /docs/product/features/upload.md#处理

export interface DeviceHints {
  /** navigator.hardwareConcurrency */
  cores?: number;
  /** navigator.deviceMemory, GB (Chromium only) */
  memory?: number;
}

/** Two at a time; one where the browser reports 2 GB of memory or less, or two cores or fewer. */
export function processLimit(h: DeviceHints): number {
  if (h.memory != null && h.memory <= 2) return 1;
  if (h.cores != null && h.cores <= 2) return 1;
  return 2;
}

/** What the browser tells about itself (Safari and Firefox do not report memory). */
export function deviceHints(): DeviceHints {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & { deviceMemory?: number };
  return { cores: nav.hardwareConcurrency || undefined, memory: nav.deviceMemory };
}

/** Files that take far more memory than a JPEG while being read: HEIC decoded by libheif (about 20 bytes a pixel), or very large files. */
export function isHeavy(file: { name: string; type: string; size: number }): boolean {
  return /\.(heic|heif|hif)$/i.test(file.name) || /hei[cf]/i.test(file.type) || file.size > 30 * 1024 * 1024;
}

interface Queued {
  id: string;
  stage: string;
  file: { name: string; type: string; size: number };
}

/**
 * The photos to start now, in queue order: as many `queued` ones as there are free places, but never two heavy files
 * at once, so a batch of HEICs is read one by one as before.
 */
export function nextToProcess<T extends Queued>(items: readonly T[], running: ReadonlySet<string>, limit: number): T[] {
  let free = limit - running.size;
  if (free <= 0) return [];
  let heavy = items.some((i) => running.has(i.id) && isHeavy(i.file));
  const out: T[] = [];
  for (const it of items) {
    if (free <= 0) break;
    if (it.stage !== 'queued' || running.has(it.id)) continue;
    if (isHeavy(it.file)) {
      if (heavy) continue;
      heavy = true;
    }
    out.push(it);
    free--;
  }
  return out;
}
