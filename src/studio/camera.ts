// The site's own camera: a live picture inside the page (getUserMedia) and a still taken from it. The page never
// leaves the foreground, unlike handing over to the system camera, where a phone short of memory closes the browser
// behind it and the photo has nowhere to come back to ("内存不足，无法完成之前的操作" in Chrome).
// Docs: /docs/product/features/upload.md#拍照

export type Facing = 'environment' | 'user';

/** Why there is no live picture. */
export type CameraProblem =
  /** no camera API here: an old browser, a page not served over HTTPS, some in-app browsers */
  | 'unsupported'
  /** the browser or the person said no */
  | 'denied'
  /** this device has no camera */
  | 'missing'
  /** another app holds the camera, or it would not start */
  | 'busy'
  | 'failed';

export const CAMERA_PROBLEM_TEXT: Record<CameraProblem, string> = {
  unsupported: '这个浏览器不能在页面里打开相机。',
  denied: '没有相机权限。请在浏览器的网站设置里允许本站使用相机，然后重试。',
  missing: '没有找到相机。',
  busy: '相机正被其他应用占用，或没能启动。关掉其他相机应用后重试。',
  failed: '相机没能启动。'
};

/** What went wrong with `getUserMedia`, from the error it rejected with. */
export function cameraProblemOf(e: unknown): CameraProblem {
  const name = typeof e === 'object' && e && 'name' in e ? String((e as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'missing';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'failed';
}

/** The ImageCapture API (Chrome): a full-resolution still from the camera, not a frame of the preview. */
interface StillCapture {
  takePhoto(settings?: { imageWidth?: number; imageHeight?: number }): Promise<Blob>;
  getPhotoCapabilities(): Promise<{ imageWidth?: { max?: number }; imageHeight?: { max?: number } }>;
}
type StillCaptureCtor = new (track: MediaStreamTrack) => StillCapture;

const stillCapture = (): StillCaptureCtor | undefined => (globalThis as unknown as { ImageCapture?: StillCaptureCtor }).ImageCapture;

/**
 * What to ask the camera for. With ImageCapture the preview only has to look right on a phone screen, so it stays
 * modest (the still is taken at the sensor's size anyway); without it the photo is a frame of the preview, so the
 * preview is asked for at the largest size on offer. 4:3 is the sensor's shape on phones.
 */
export function videoConstraints(facing: Facing, fullStills: boolean): MediaTrackConstraints {
  return {
    facingMode: { ideal: facing },
    aspectRatio: { ideal: 4 / 3 },
    width: { ideal: fullStills ? 1920 : 4096 },
    height: { ideal: fullStills ? 1440 : 3072 }
  };
}

export const cameraSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

/** Open the camera facing `facing`. Rejects with what `cameraProblemOf` reads. */
export function openCamera(facing: Facing): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints(facing, !!stillCapture()) });
}

export function closeCamera(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** How long a still may take before the preview frame is used instead: some cameras never answer. */
export const STILL_TIMEOUT_MS = 8000;

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** The preview's current frame as a JPEG, at the size the camera delivers it. */
export function frameOf(video: HTMLVideoElement): Promise<Blob> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return Promise.reject(new Error('no frame'));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('no canvas'));
  ctx.drawImage(video, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/jpeg', 0.92));
}

/**
 * Take the photo: a still at the camera's largest size where the browser can (ImageCapture), else the preview's
 * current frame. A still that fails or does not come falls back to the frame, so a tap on the shutter always
 * yields a picture when there is a live preview.
 */
export async function takeStill(video: HTMLVideoElement, stream: MediaStream): Promise<Blob> {
  const track = stream.getVideoTracks()[0];
  const Still = stillCapture();
  if (Still && track && track.readyState === 'live') {
    try {
      const still = new Still(track);
      let largest: { imageWidth: number; imageHeight: number } | undefined;
      try {
        const caps = await within(still.getPhotoCapabilities(), 2000);
        if (caps.imageWidth?.max && caps.imageHeight?.max) largest = { imageWidth: caps.imageWidth.max, imageHeight: caps.imageHeight.max };
      } catch {
        // no capabilities: the camera's default still size
      }
      const blob = await within(
        still.takePhoto(largest).catch((e: unknown) => {
          // some cameras refuse the size they advertise
          if (largest) return still.takePhoto();
          throw e;
        }),
        STILL_TIMEOUT_MS
      );
      if (blob.size > 0) return blob;
    } catch {
      // fall through to the frame
    }
  }
  return frameOf(video);
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif'
};

/** `IMG_20261111_113045_123.jpg`: local time to the millisecond, so two quick shots do not share a name. */
export function shotName(at: number, type: string, offsetMin = -new Date(at).getTimezoneOffset()): string {
  const d = new Date(at + offsetMin * 60000);
  const day = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `IMG_${day}_${time}_${pad(d.getUTCMilliseconds(), 3)}.${EXT[type] ?? 'jpg'}`;
}

/** The still as a file for the upload queue. */
export function shotFile(blob: Blob, at: number): File {
  const type = blob.type || 'image/jpeg';
  return new File([blob], shotName(at, type), { type, lastModified: at });
}

/** A small picture of what was just taken, from the preview: decoding the full still for a thumbnail would cost a phone tens of megabytes. */
export function thumbOf(video: HTMLVideoElement, edge = 96): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const side = Math.min(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, edge, edge);
  return canvas.toDataURL('image/jpeg', 0.7);
}
