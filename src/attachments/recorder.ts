// Recording a sound in the browser, to attach: MediaRecorder, in the first format the browser records (Opus in WebM
// in Chrome and Firefox, AAC in MP4 in Safari), named by when it began. Docs: /docs/product/features/attachments.md

const FORMATS = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' };

/** The format to record in, of those `supported` takes; null: the browser's own. */
export const recordingFormat = (supported: (type: string) => boolean): string | null => FORMATS.find(supported) ?? null;

const pad = (n: number) => String(n).padStart(2, '0');

/** A recording's file name, by when it began: `录音 2026-05-01 14.03.m4a`. */
export function recordingName(at: Date, type: string): string {
  const ext = EXT[type.split(';')[0].trim().toLowerCase()] ?? 'webm';
  return `录音 ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}.${ext}`;
}

/** Why recording did not start, in words. */
export function recordError(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '没有得到使用麦克风的许可，可以在浏览器的网站设置里打开';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '没有找到麦克风';
  if (name === 'NotReadableError' || name === 'AbortError') return '麦克风正被别的程序占用';
  return '这个浏览器不能录音';
}

/** The browser records sound at all. */
export const canRecord = (): boolean =>
  typeof window !== 'undefined' && typeof window.MediaRecorder === 'function' && !!navigator.mediaDevices?.getUserMedia;
