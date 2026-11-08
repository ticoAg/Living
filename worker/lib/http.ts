import type { Context } from 'hono';
import type { AppEnv } from '../env';

export type Ctx = Context<AppEnv>;

/** An error that maps to the `{ error, message }` JSON body of docs/api/conventions.md. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export const invalid = (message: string) => new HttpError(400, 'invalid_input', message);
export const unauthenticated = (message = '请先登录') => new HttpError(401, 'unauthenticated', message);
export const forbidden = (message = '你没有权限执行这个操作') => new HttpError(403, 'forbidden', message);
export const notFound = (message = '内容不存在，或你没有权限查看') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, extra: Record<string, unknown> = {}) => new HttpError(409, 'conflict', message, extra);
export const duplicate = (message: string, extra: Record<string, unknown> = {}) => new HttpError(409, 'duplicate', message, extra);
export const tooLarge = (message: string) => new HttpError(413, 'too_large', message);
export const rateLimited = (message: string) => new HttpError(429, 'rate_limited', message);
export const upstream = (message: string) => new HttpError(502, 'upstream_failed', message);

const MAX_JSON_BYTES = 256 * 1024;

/** Reads a JSON object body, with a size cap and Chinese error messages. */
export async function readJson(c: Ctx, maxBytes = MAX_JSON_BYTES): Promise<Record<string, unknown>> {
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > maxBytes) throw tooLarge('请求内容太大');
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    throw invalid('无法读取请求内容');
  }
  if (text.length > maxBytes) throw tooLarge('请求内容太大');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw invalid('请求内容不是有效的 JSON');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw invalid('请求内容需要是一个 JSON 对象');
  return data as Record<string, unknown>;
}

/**
 * Cache headers for list endpoints (docs/api/conventions.md#缓存): anonymous requests may be cached for 30 s,
 * requests with a session never. `Vary: Cookie` keeps a browser from reusing an anonymous copy after login.
 */
export function listCache(c: Ctx, viewer: string | null): void {
  c.header('Vary', 'Cookie');
  c.header('Cache-Control', viewer ? 'private, no-store' : 'public, max-age=30');
}

/** Path parameter shape for ids (ULIDs with prefix, preset tag slugs, invite codes). */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function paramId(c: Ctx, name = 'id'): string {
  const v = c.req.param(name);
  if (!v || !ID_RE.test(v)) throw notFound();
  return v;
}

/** Weak/strong ETag list match for `If-None-Match`. */
export function etagMatches(header: string | null | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const strip = (s: string) => s.trim().replace(/^W\//, '');
  const want = strip(etag);
  return header.split(',').some((part) => strip(part) === want);
}
