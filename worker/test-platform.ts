// Harness for the route tests (`*.routes.test.ts`, run with `npm run test:routes`): the Hono app runs in Node with
// real D1, R2, KV and Cache API from a local workerd started by Miniflare, in memory. Nothing touches disk or the
// network. See docs/runbooks/local-dev.md#路由测试.

import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vite-plus/test';
import type { PhotoDetail, Role, SessionUser } from '../shared/types';
import type { Env } from './env';
import { app } from './index';
import { hashPassword, randomToken } from './lib/crypto';
import { newId } from './lib/ids';

declare global {
  interface ImportMeta {
    glob<T>(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }): Record<string, T>;
  }
}

export const SITE = 'https://living.example';

/** Every migration, applied in file-name order like `wrangler d1 migrations apply`. */
const MIGRATIONS = Object.entries(import.meta.glob<string>('../migrations/*.sql', { query: '?raw', import: 'default', eager: true }))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql);

/**
 * Splits a migration into statements on `;`, skipping quoted text and comments. (D1's exec() splits on newlines,
 * which breaks multi-line statements.) Trigger bodies (BEGIN … END) are not supported: none of the migrations has one.
 */
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i = sql.indexOf(ch, i + 1);
      // a doubled quote inside a string is just the next string starting right away: the loop handles it
      if (i < 0) break;
    } else if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
    } else if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end < 0 ? sql.length : end + 1;
    } else if (ch === ';') {
      out.push(sql.slice(start, i));
      start = i + 1;
    }
  }
  out.push(sql.slice(start));
  // drop pieces that are only whitespace and comments
  return out.map((s) => s.trim()).filter((s) => s.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim());
}

// ---- D1 -----------------------------------------------------------------------------------------------------------

/**
 * Runs in workerd next to the bindings. Miniflare's Node proxy for D1 makes a blocking round trip for every
 * prepare() and bind(); this worker instead takes a whole execution (or batch) per request and runs it on the real D1
 * binding, so a test pays one round trip per query. Parameters keep the values JSON cannot carry (undefined, NaN,
 * bytes) so D1 itself accepts or rejects them, exactly as in production.
 */
const D1_WORKER = `
const decode = (p) => ('u' in p ? undefined : 'n' in p ? Number(p.n) : 'b' in p ? Uint8Array.from(atob(p.b), (c) => c.charCodeAt(0)).buffer : p.v);
export default {
  async fetch(request, env) {
    const { mode, arg, statements } = await request.json();
    try {
      const prepared = statements.map((s) => env.DB.prepare(s.sql).bind(...s.params.map(decode)));
      const result = mode === 'batch' ? await env.DB.batch(prepared) : await prepared[0][mode](arg);
      return Response.json({ result: result === undefined ? null : result });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
};`;

type Param = { u: 1 } | { n: string } | { b: string } | { v: unknown };
function encode(v: unknown): Param {
  if (v === undefined) return { u: 1 };
  if (typeof v === 'number' && !Number.isFinite(v)) return { n: String(v) };
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return { b: btoa(String.fromCharCode(...bytes)) };
  }
  return { v };
}

/** The D1Database API the Worker uses, executed by `D1_WORKER` on the real binding. */
function remoteD1(url: URL, fetchImpl: typeof fetch): D1Database {
  interface Stmt {
    sql: string;
    params: Param[];
  }
  const send = async (mode: string, statements: Stmt[], arg?: unknown): Promise<unknown> => {
    const res = await fetchImpl(url, { method: 'POST', body: JSON.stringify({ mode, arg, statements }) });
    const body = (await res.json()) as { result?: unknown; error?: string };
    if (body.error !== undefined) throw new Error(body.error);
    return body.result;
  };
  const statement = (sql: string, params: Param[] = []) => {
    const s = { sql, params };
    return {
      __stmt: s,
      bind: (...values: unknown[]) => statement(sql, values.map(encode)),
      first: (column?: string) => send('first', [s], column),
      all: () => send('all', [s]),
      run: () => send('run', [s]),
      raw: (options?: unknown) => send('raw', [s], options)
    };
  };
  return {
    prepare: (sql: string) => statement(sql),
    batch: (list: { __stmt: Stmt }[]) =>
      send(
        'batch',
        list.map((x) => x.__stmt)
      ),
    exec: () => Promise.reject(new Error('exec() is not used by the Worker and not supported by the test platform'))
  } as unknown as D1Database;
}

// ---- outbound requests ----------------------------------------------------------------------------------------------

/** Place providers the Worker calls (worker/providers/). Requests to them are answered by `external.respond`. */
const PROVIDER_HOSTS = new Set(['photon.komoot.io', 'nominatim.openstreetmap.org', 'overpass-api.de', 'restapi.amap.com']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface External {
  /** Provider requests made during the current test. */
  calls: URL[];
  /** Answers provider requests; by default every provider is down (503). */
  respond: (url: URL, init?: RequestInit) => Response | Promise<Response>;
  /** Requests to any other non-loopback host: refused, and reported as a test failure. */
  stray: string[];
}

const providersDown = () => new Response('unavailable in tests', { status: 503 });

// ---- platform -----------------------------------------------------------------------------------------------------

export interface Platform {
  env: Env;
  external: External;
  /** Whether the edge cache (`caches.default`) holds `path` of the site. */
  cached(path: string): Promise<boolean>;
  /** Back to the freshly migrated state: tables as the migrations left them, empty KV, R2 and edge cache. */
  reset(): Promise<void>;
}

interface Snapshot {
  /** In creation order, so parents come before the tables that reference them. */
  tables: string[];
  /** Rows the migrations inserted (settings, preset tags), per table. */
  seeds: Map<string, { cols: string[]; json: string }>;
  /** One statement that fingerprints every table: its row count, or for seeded tables their whole content. */
  probe: string;
  /** The probe's answer right after the migrations. */
  clean: Record<string, unknown>;
}

async function migrate(db: D1Database): Promise<Snapshot> {
  const statements = MIGRATIONS.flatMap(splitStatements);
  await db.batch(statements.map((s) => db.prepare(s)));
  const tables = (
    await db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid`)
      .all<{ name: string }>()
  ).results.map((r) => r.name);
  const seeds: Snapshot['seeds'] = new Map();
  for (const table of tables) {
    const res = await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all<Record<string, unknown>>();
    if (res.results.length) seeds.set(table, { cols: Object.keys(res.results[0]), json: JSON.stringify(res.results) });
  }
  const probe = `SELECT ${tables
    .map((t) => {
      const seed = seeds.get(t);
      return seed
        ? `(SELECT json_group_array(json_array(${seed.cols.join(', ')})) FROM (SELECT * FROM ${t} ORDER BY rowid)) AS ${t}`
        : `(SELECT COUNT(*) FROM ${t}) AS ${t}`;
    })
    .join(', ')}`;
  const clean = (await db.prepare(probe).first<Record<string, unknown>>()) ?? {};
  return { tables, seeds, probe, clean };
}

async function emptyKv(kv: KVNamespace): Promise<void> {
  for (;;) {
    const page = await kv.list();
    if (!page.keys.length) return;
    await Promise.all(page.keys.map((k) => kv.delete(k.name)));
  }
}

async function emptyR2(bucket: R2Bucket): Promise<void> {
  for (;;) {
    const page = await bucket.list({ limit: 1000 });
    if (!page.objects.length) return;
    await bucket.delete(page.objects.map((o) => o.key));
  }
}

/**
 * Starts local D1, R2, KV and Cache API for this test file (in memory), applies the migrations, answers provider
 * requests with `external.respond`, and fails any test that reaches another host. Call once at the top level of a
 * test file. Each test starts from the migrated state unless `resetBetweenTests` is false (a read-only fixture).
 */
export function usePlatform({ resetBetweenTests = true } = {}): Platform {
  let mf: Miniflare | undefined;
  let snapshot: Snapshot;
  let edge: Cache;
  const realFetch = globalThis.fetch;
  const realCaches = (globalThis as { caches?: unknown }).caches;
  const external: External = { calls: [], respond: providersDown, stray: [] };

  const platform = {
    env: undefined as unknown as Env,
    external,
    async cached(path: string) {
      return (await edge.match(new Request(`${SITE}${path}`))) !== undefined;
    },
    async reset() {
      // Find the tables a test changed with one statement, then empty those and refill the seeded ones.
      const db = platform.env.DB;
      const now = (await db.prepare(snapshot.probe).first<Record<string, unknown>>()) ?? {};
      const dirty = snapshot.tables.filter((t) => now[t] !== snapshot.clean[t]);
      if (dirty.length) {
        await db.batch([
          ...[...dirty].reverse().map((t) => db.prepare(`DELETE FROM ${t}`)),
          ...dirty.flatMap((t) => {
            const seed = snapshot.seeds.get(t);
            if (!seed) return [];
            const values = seed.cols.map((c) => `json_extract(value, '$.${c}')`).join(', ');
            return [db.prepare(`INSERT INTO ${t} (${seed.cols.join(', ')}) SELECT ${values} FROM json_each(?1)`).bind(seed.json)];
          })
        ]);
      }
      await Promise.all([emptyKv(platform.env.KV), emptyR2(platform.env.MEDIA), mf?.purgeCache()]);
    }
  } satisfies Platform;

  beforeAll(async () => {
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: D1_WORKER,
        compatibilityDate: '2026-06-01', // as in wrangler.jsonc
        d1Databases: { DB: 'living' },
        kvNamespaces: { KV: 'living-kv' },
        r2Buckets: { MEDIA: 'living-photos' },
        host: '127.0.0.1',
        port: 0
      })
    );
    const url = await mf.ready;
    const assets = {
      fetch: async () => new Response('<!doctype html><title>Living</title>', { headers: { 'content-type': 'text/html' } })
    };
    platform.env = {
      DB: remoteD1(url, realFetch),
      KV: (await mf.getKVNamespace('KV')) as unknown as KVNamespace,
      MEDIA: (await mf.getR2Bucket('MEDIA')) as unknown as R2Bucket,
      ASSETS: assets as unknown as Fetcher,
      SITE_NAME: 'Living',
      SITE_URL: SITE
    };
    const caches = (await mf.getCaches()) as unknown as CacheStorage;
    edge = caches.default;
    snapshot = await migrate(platform.env.DB);

    (globalThis as { caches?: unknown }).caches = caches;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(input instanceof Request ? input.url : String(input));
      if (LOOPBACK.has(target.hostname)) return realFetch(input, init); // the platform's own traffic to workerd
      if (PROVIDER_HOSTS.has(target.hostname)) {
        external.calls.push(target);
        return external.respond(target, init);
      }
      external.stray.push(target.href);
      throw new TypeError(`route tests must not reach ${target.host}`);
    };
  }, 60_000);

  if (resetBetweenTests) beforeEach(() => platform.reset());

  afterEach(() => {
    const stray = external.stray.splice(0);
    external.calls.length = 0;
    external.respond = providersDown;
    expect(stray, 'requests to hosts outside the test platform').toEqual([]);
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    (globalThis as { caches?: unknown }).caches = realCaches;
    await mf?.dispose();
  });

  return platform;
}

// ---- requests -----------------------------------------------------------------------------------------------------

export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
  headers: Headers;
}

/** Shorthand for the shape of a JSON body under test. */
// oxlint-disable-next-line typescript/no-explicit-any -- assertions read arbitrary fields of the JSON body
export type Json = Record<string, any>;

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * One browser: keeps the session cookie (Secure, so it is carried by hand), sends the site's `Origin` on writes and a
 * fixed `CF-Connecting-IP` (the login rate limit counts per address). Each request awaits the Worker's waitUntil work.
 */
export class Client {
  cookie: string | null = null;
  user: SessionUser | null = null;

  constructor(
    readonly platform: Platform,
    readonly ip = '203.0.113.1'
  ) {}

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    if (this.cookie && !headers.has('cookie')) headers.set('cookie', `living_session=${this.cookie}`);
    if (!SAFE.has(method) && !headers.has('origin')) headers.set('origin', SITE);
    if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', this.ip);
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => {}, props: {} };
    const res = await app.request(`${SITE}${path}`, { ...init, method, headers }, this.platform.env, ctx as unknown as ExecutionContext);
    await Promise.all(pending);
    this.takeCookie(res);
    return res;
  }

  private takeCookie(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const m = /^living_session=([^;]*)/.exec(line);
      if (!m) continue;
      const cleared = m[1] === '' || /max-age=0\b/i.test(line) || /expires=Thu, 01 Jan 1970/i.test(line);
      this.cookie = cleared ? null : m[1];
      if (cleared) this.user = null;
    }
  }

  async json<T = Json>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'content-type': 'application/json' };
    }
    const res = await this.fetch(path, init);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as T, headers: res.headers };
  }

  get = <T = Json>(path: string) => this.json<T>('GET', path);
  post = <T = Json>(path: string, body?: unknown) => this.json<T>('POST', path, body ?? {});
  patch = <T = Json>(path: string, body: unknown) => this.json<T>('PATCH', path, body);
  put = <T = Json>(path: string, body: unknown) => this.json<T>('PUT', path, body);
  del = <T = Json>(path: string) => this.json<T>('DELETE', path);

  /** The signed-in user; throws when signed out. */
  get me(): SessionUser {
    if (!this.user) throw new Error('client is not signed in');
    return this.user;
  }
}

/** Returns the body of a response that must have `status`, with the error body in the failure message. */
export function expectStatus<T>(res: ApiResponse<T>, status: number): T {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
}

// ---- accounts -----------------------------------------------------------------------------------------------------

export const PASSWORD = 'correct horse battery';

export async function addInvite(platform: Platform, code: string, role: Role, expiresAt: string | null = null) {
  await platform.env.DB.prepare('INSERT INTO invites (code, role, note, expires_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(code, role, 'test', expiresAt)
    .run();
}

let passwordHash: Promise<string> | undefined;

/**
 * A signed-in user with `role` (password `PASSWORD`), written straight to D1 and KV the way registration does.
 * Registration itself is covered in auth.routes.test.ts; this saves most of its round trips in every other test.
 */
export async function newUser(platform: Platform, handle: string, role: Role = 'member'): Promise<Client> {
  passwordHash ??= hashPassword(PASSWORD);
  const user: SessionUser = { id: newId.user(), handle, displayName: handle, bio: null, avatarPhotoId: null, role };
  const token = randomToken(32);
  await Promise.all([
    platform.env.DB.prepare('INSERT INTO users (id, handle, display_name, role, password_hash) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(user.id, handle, handle, role, await passwordHash)
      .run(),
    platform.env.KV.put(`sess:${token}`, JSON.stringify({ userId: user.id, createdAt: new Date().toISOString() }))
  ]);
  const client = new Client(platform);
  client.cookie = token;
  client.user = user;
  return client;
}

// ---- photos -------------------------------------------------------------------------------------------------------

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
export const WEBP = new Uint8Array(
  [...'RIFF']
    .map((c) => c.charCodeAt(0))
    .concat(
      [24, 0, 0, 0],
      [...'WEBPVP8 '].map((c) => c.charCodeAt(0))
    )
);
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

let shaSeq = 0;
/** A fresh, valid sha256 hex string. */
export const newSha = (): string => (++shaSeq).toString(16).padStart(64, 'a');

/** A minimal valid upload; `meta` and `files` override parts of it (`null` leaves a part out). */
export function uploadForm(meta: Json = {}, files: Partial<Record<'original' | 's' | 'm' | 'l', Blob | null>> = {}): FormData {
  const form = new FormData();
  form.set(
    'meta',
    JSON.stringify({
      width: 3000,
      height: 2000,
      variantSizes: { s: [480, 320], m: [1600, 1067], l: [2560, 1707] },
      sha256: newSha(),
      ...meta
    })
  );
  const parts = {
    original: new File([JPEG], 'IMG_0001.jpg', { type: 'image/jpeg' }),
    s: new File([WEBP], 's.webp', { type: 'image/webp' }),
    m: new File([WEBP], 'm.webp', { type: 'image/webp' }),
    l: new File([WEBP], 'l.webp', { type: 'image/webp' }),
    ...files
  };
  for (const [name, blob] of Object.entries(parts)) if (blob) form.set(name, blob);
  return form;
}

export async function uploadRaw(client: Client, form: FormData): Promise<ApiResponse<Json>> {
  const res = await client.fetch('/api/photos', { method: 'POST', body: form });
  return { status: res.status, body: (await res.json()) as Json, headers: res.headers };
}

/** Uploads a photo that must succeed and returns it. */
export async function upload(client: Client, meta: Json = {}): Promise<PhotoDetail> {
  return expectStatus(await uploadRaw(client, uploadForm(meta)), 201).photo as PhotoDetail;
}
