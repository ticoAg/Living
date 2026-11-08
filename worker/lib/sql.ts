export type SqlValue = string | number | null;

/** Normalises JS values for D1 binding (D1 rejects `undefined` and booleans). */
export function norm(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return String(v);
}

/**
 * Collects bound parameters and hands back numbered placeholders (`?1`, `?2`…), so a value can be reused
 * in several places of one statement. Every placeholder returned must end up in the SQL text.
 */
export class Sql {
  readonly params: SqlValue[] = [];
  p(v: unknown): string {
    this.params.push(norm(v));
    return `?${this.params.length}`;
  }
}

export function prep(db: D1Database, sql: string, ...params: unknown[]): D1PreparedStatement {
  return db.prepare(sql).bind(...params.map(norm));
}

export function prepQ(db: D1Database, sql: string, q: Sql): D1PreparedStatement {
  return db.prepare(sql).bind(...q.params);
}

/** `LIKE` pattern matching `s` anywhere, with wildcards escaped (use with `ESCAPE '\'`). */
export function likeContains(s: string): string {
  return `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|SQLITE_CONSTRAINT_PRIMARYKEY/i.test(e.message);
}

export function parseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export const nowIso = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
export const addDaysIso = (days: number): string => new Date(Date.now() + days * 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
