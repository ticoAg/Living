export type SqlValue = string | number | null;

/** Normalises JS values for D1 binding (D1 rejects `undefined` and booleans). */
export function norm(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return typeof v === 'string' ? v : (JSON.stringify(v) ?? null);
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

const COLUMN_RE = /^[a-z_][a-z0-9_]*$/i;

/**
 * `INSERT INTO <table> (<columns>) VALUES (<placeholders>)` from a column → value object, with the values collected in
 * `q`. Each value sits next to its column name, so adding a column cannot shift the others. Names are interpolated
 * into the SQL, so they must be plain identifiers (they come from code, never from input).
 */
export function insertSql(table: string, row: Record<string, unknown>, q: Sql): string {
  const cols = Object.keys(row);
  if (!cols.length) throw new Error(`insert into ${table}: no columns`);
  for (const name of [table, ...cols]) if (!COLUMN_RE.test(name)) throw new Error(`insert into ${table}: bad identifier ${name}`);
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((col) => q.p(row[col])).join(', ')})`;
}

/** The prepared `INSERT` for one row given as a column → value object (see `insertSql`). */
export function prepInsert(db: D1Database, table: string, row: Record<string, unknown>): D1PreparedStatement {
  const q = new Sql();
  return prepQ(db, insertSql(table, row, q), q);
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

/**
 * The first `limit` of `rows`, and whether there were more. Query `limit + 1` rows for this: the extra row only tells
 * that the list goes on, without counting the rest.
 */
export function capped<T>(rows: T[], limit: number): { rows: T[]; truncated: boolean } {
  return rows.length > limit ? { rows: rows.slice(0, limit), truncated: true } : { rows, truncated: false };
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
