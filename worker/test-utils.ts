// Helpers shared by the worker's unit tests. Nothing in the Worker itself imports this file.

import { expect } from 'vite-plus/test';
import { HttpError } from './lib/http';

/** Asserts that `error` is the 400 `invalid_input` HttpError the API turns into `{ error, message }`, and returns its message. */
function expectInvalid(error: unknown): string {
  if (!(error instanceof HttpError)) throw error;
  expect(error.status).toBe(400);
  expect(error.code).toBe('invalid_input');
  return error.message;
}

/** Runs `fn`, which must throw the 400 `invalid_input` HttpError, and returns the user-facing message. */
export function invalidMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return expectInvalid(e);
  }
  throw new Error('expected the call to throw');
}

/** Same for a promise that must reject with the 400 `invalid_input` HttpError. */
export async function rejectedInvalidMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    return expectInvalid(e);
  }
  throw new Error('expected the promise to reject');
}

export interface DbCall {
  sql: string;
  params: unknown[];
  method: 'first' | 'all' | 'run';
}

/**
 * A stand-in for D1. Every `prepare(sql).bind(...).first() / .all() / .run()` is recorded in `calls` and answered by
 * `answer`: its return value is the row for `first()` and the list of rows for `all()` (ignored for `run()`).
 */
export function fakeD1(answer: (call: DbCall) => unknown = () => null) {
  const calls: DbCall[] = [];
  const statement = (sql: string, params: unknown[]) => {
    const record = (method: DbCall['method']): unknown => {
      const call: DbCall = { sql, params, method };
      calls.push(call);
      return answer(call);
    };
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      first: async () => record('first') ?? null,
      all: async () => {
        const rows = record('all');
        return { results: Array.isArray(rows) ? (rows as unknown[]) : [] };
      },
      run: async () => {
        record('run');
        return { success: true };
      }
    };
  };
  const db = { prepare: (sql: string) => statement(sql, []) } as unknown as D1Database;
  return { db, calls };
}

/**
 * The `place_cache` table (providers/cache.ts) in memory, for a `fakeD1` answer: `wrap(answer)` answers the cache's
 * statements from `rows` and passes every other statement on to `answer`.
 */
export function fakePlaceCache() {
  const rows = new Map<string, { value: string; expiresAt: number }>();
  const own = (call: DbCall): unknown => {
    if (call.sql.startsWith('SELECT')) {
      const [key, now] = call.params as [string, number];
      const row = rows.get(key);
      return row && row.expiresAt > now ? { value: row.value } : null;
    }
    if (call.sql.startsWith('INSERT')) {
      const [key, value, expiresAt] = call.params as [string, string, number];
      rows.set(key, { value, expiresAt });
    } else if (call.sql.startsWith('DELETE')) {
      const [now] = call.params as [number];
      for (const [key, row] of rows) if (row.expiresAt <= now) rows.delete(key);
    }
    return null;
  };
  const wrap =
    (answer: (call: DbCall) => unknown = () => null) =>
    (call: DbCall): unknown =>
      call.sql.includes('place_cache') ? own(call) : answer(call);
  return { rows, wrap };
}

/** An in-memory KV namespace holding JSON values; `puts` records each write with its options. */
export function fakeKv(initial: Record<string, unknown> = {}) {
  const store = new Map<string, string>(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  const puts: { key: string; value: string; options: unknown }[] = [];
  const kv = {
    get: async (key: string, type?: string): Promise<unknown> => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? (JSON.parse(raw) as unknown) : raw;
    },
    put: async (key: string, value: string, options?: unknown): Promise<void> => {
      store.set(key, value);
      puts.push({ key, value, options });
    },
    delete: async (key: string): Promise<void> => {
      store.delete(key);
    }
  } as unknown as KVNamespace;
  return { kv, store, puts };
}

/** A readable label for an arbitrary value, for assertion messages. */
export function show(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || value === null || value === undefined) {
    return String(value);
  }
  return JSON.stringify(value) ?? typeof value;
}
