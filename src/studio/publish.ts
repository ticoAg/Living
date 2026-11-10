import type { PhotoDetail } from '../../shared/types';
import { reportUnauthenticated } from '../lib/api';

// POST /api/photos as multipart with upload progress. This does not go through lib/api.ts because a
// 409 duplicate carries `photoId` in the body, which ApiError does not keep, and fetch has no upload progress.

export type PublishResult =
  | { ok: true; photo: PhotoDetail }
  | { ok: false; status: number; code: string; message: string; photoId?: string };

const FALLBACK: Record<number, string> = {
  401: '登录已过期，请重新登录后再发布',
  403: '没有权限发布，请刷新页面后重试',
  413: '原图超过 50 MB，无法上传',
  502: '存储服务暂时不可用，请稍后重试'
};

export function uploadPhoto(form: FormData, onProgress?: (fraction: number) => void): Promise<PublishResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/photos');
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      let body: { photo?: PhotoDetail; error?: string; message?: string; photoId?: string } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      // the session layer asks for the password again; the photo stays in the queue to be sent once more
      if (xhr.status === 401) reportUnauthenticated('/api/photos');
      if (xhr.status >= 200 && xhr.status < 300 && body?.photo) {
        resolve({ ok: true, photo: body.photo });
        return;
      }
      resolve({
        ok: false,
        status: xhr.status,
        code: body?.error ?? `http_${xhr.status}`,
        message: body?.message ?? FALLBACK[xhr.status] ?? '发布失败，请稍后重试',
        photoId: body?.photoId
      });
    };
    xhr.onerror = () => resolve({ ok: false, status: 0, code: 'network', message: '网络中断，请检查网络后重试' });
    xhr.ontimeout = () => resolve({ ok: false, status: 0, code: 'timeout', message: '上传超时，请重试' });
    xhr.onabort = () => resolve({ ok: false, status: 0, code: 'abort', message: '已取消' });
    xhr.send(form);
  });
}
