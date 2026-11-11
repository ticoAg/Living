import type { ApiErrorBody } from '../../shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: Partial<ApiErrorBody> = {}
  ) {
    super(message);
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON body */
  json?: unknown;
  /** raw body, e.g. FormData */
  body?: BodyInit;
  signal?: AbortSignal;
}

// A 401 from anything but /api/auth/* means the session ended (expired after 30 days, or signed out elsewhere).
// The session layer (lib/session.tsx) listens and asks for the password again without leaving the page.
// /api/auth/* answers 401 for a wrong password and the like, which says nothing about the session.
const sessionLost = new Set<() => void>();

/** Run `fn` whenever a request is refused for lack of a session. Returns the unsubscribe function. */
export function onSessionLost(fn: () => void): () => void {
  sessionLost.add(fn);
  return () => void sessionLost.delete(fn);
}

/** Report a 401 for `path`; for requests that do not go through `api()` (the upload's XHR). */
export function reportUnauthenticated(path: string): void {
  if (path.startsWith('/api/auth/')) return;
  sessionLost.forEach((fn) => fn());
}

/** fetch wrapper for /api: sends cookies, parses JSON, throws ApiError with the server's message. */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: opts.method ?? (opts.json !== undefined || opts.body !== undefined ? 'POST' : 'GET'),
    credentials: 'same-origin',
    signal: opts.signal
  };
  if (opts.json !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(opts.json);
  } else if (opts.body !== undefined) {
    init.body = opts.body;
  }
  const res = await fetch(path, init);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    if (res.status === 401) reportUnauthenticated(path);
    const e = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, e.error ?? `http_${res.status}`, e.message ?? '请求失败，请稍后再试', e);
  }
  return data as T;
}

/** URL of an R2 object served by the Worker. */
export const mediaUrl = (key: string) => `/media/${key}`;
