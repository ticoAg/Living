import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { Sql, addDaysIso, capped, isUniqueViolation, likeContains, norm, nowIso, parseJson, prep, prepQ } from './sql';

describe('norm', () => {
  it('turns undefined and null into NULL', () => {
    expect(norm(undefined)).toBeNull();
    expect(norm(null)).toBeNull();
  });

  it('turns booleans into 1 and 0, which D1 accepts', () => {
    expect(norm(true)).toBe(1);
    expect(norm(false)).toBe(0);
  });

  it('keeps finite numbers and drops NaN and infinities', () => {
    expect(norm(0)).toBe(0);
    expect(norm(-5.5)).toBe(-5.5);
    expect(norm(1e21)).toBe(1e21);
    expect(norm(Number.NaN)).toBeNull();
    expect(norm(Number.POSITIVE_INFINITY)).toBeNull();
    expect(norm(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it('keeps strings as they are, empty ones included', () => {
    expect(norm('杭州')).toBe('杭州');
    expect(norm('')).toBe('');
    expect(norm('null')).toBe('null');
  });

  it('stores objects and arrays as JSON text', () => {
    expect(norm({ a: 1, b: [true, null] })).toBe('{"a":1,"b":[true,null]}');
    expect(norm(['x', 2])).toBe('["x",2]');
    expect(norm([])).toBe('[]');
  });

  it('turns values JSON cannot represent into NULL', () => {
    expect(norm(() => 1)).toBeNull();
    expect(norm(Symbol('x'))).toBeNull();
  });
});

describe('Sql', () => {
  it('hands out numbered placeholders in the order values are registered', () => {
    const q = new Sql();
    expect(q.p('a')).toBe('?1');
    expect(q.p(2)).toBe('?2');
    expect(q.p('c')).toBe('?3');
    expect(q.params).toEqual(['a', 2, 'c']);
  });

  it('normalises what it stores, and still counts a value that becomes NULL', () => {
    const q = new Sql();
    expect(q.p(undefined)).toBe('?1');
    expect(q.p(true)).toBe('?2');
    expect(q.p({ k: 1 })).toBe('?3');
    expect(q.p(Number.NaN)).toBe('?4');
    expect(q.params).toEqual([null, 1, '{"k":1}', null]);
  });

  it('lets one placeholder be used several times in a statement', () => {
    const q = new Sql();
    const viewer = q.p('u_1');
    const sql = `SELECT 1 WHERE a = ${viewer} OR b = ${viewer} OR c = ${q.p('x')}`;
    expect(sql).toBe('SELECT 1 WHERE a = ?1 OR b = ?1 OR c = ?2');
    expect(q.params).toEqual(['u_1', 'x']);
  });

  it('keeps separate statements independent', () => {
    const first = new Sql();
    const second = new Sql();
    first.p('a');
    first.p('b');
    expect(second.p('z')).toBe('?1');
    expect(first.params).toEqual(['a', 'b']);
  });
});

describe('prep / prepQ', () => {
  /** Records `prepare(sql).bind(...params)` and returns what was bound. */
  function fakeDb() {
    const bound: { sql: string; params: unknown[] }[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...params: unknown[]) => {
          bound.push({ sql, params });
          return { sql, params };
        }
      })
    } as unknown as D1Database;
    return { db, bound };
  }

  it('prep binds normalised parameters', () => {
    const { db, bound } = fakeDb();
    prep(db, 'INSERT INTO t VALUES (?1, ?2, ?3, ?4)', true, undefined, 'x', { a: 1 });
    expect(bound).toEqual([{ sql: 'INSERT INTO t VALUES (?1, ?2, ?3, ?4)', params: [1, null, 'x', '{"a":1}'] }]);
  });

  it('prepQ binds the parameters collected by a Sql', () => {
    const { db, bound } = fakeDb();
    const q = new Sql();
    const sql = `SELECT * FROM t WHERE a = ${q.p(false)} AND b = ${q.p('y')}`;
    prepQ(db, sql, q);
    expect(bound).toEqual([{ sql: 'SELECT * FROM t WHERE a = ?1 AND b = ?2', params: [0, 'y'] }]);
  });
});

/** Minimal SQL `LIKE ... ESCAPE '\'` matcher (case-sensitive), as an oracle for `likeContains`. */
function likeMatches(pattern: string, text: string): boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (ch === '%') re += '[\\s\\S]*';
    else if (ch === '_') re += '[\\s\\S]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`).test(text);
}

describe('likeContains', () => {
  it('wraps the text in % wildcards', () => {
    expect(likeContains('abc')).toBe('%abc%');
    expect(likeContains('西湖')).toBe('%西湖%');
    expect(likeContains('')).toBe('%%');
  });

  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(likeContains('50%')).toBe('%50\\%%');
    expect(likeContains('a_b')).toBe('%a\\_b%');
    expect(likeContains('c:\\dir')).toBe('%c:\\\\dir%');
    expect(likeContains('100%_\\')).toBe('%100\\%\\_\\\\%');
  });

  it('matches exactly the texts that contain the search string, wildcards or not', () => {
    const needles = ['abc', '50%', 'a_b', '_', '%', '\\', 'x\\%y', '100%_\\', '西湖', 'a.b', '(x)', '[a]'];
    const haystacks = [
      'abc',
      'xxabcxx',
      '50%',
      'cost 50% off',
      '50 percent',
      'a_b',
      'aXb',
      'a b',
      '_',
      '%',
      'anything',
      '\\',
      'x\\%y',
      'x\\Zy',
      '100%_\\',
      '西湖边',
      '西边湖',
      'a.b',
      '(x)',
      '[a]',
      'x',
      'a'
    ];
    const wrong: string[] = [];
    for (const needle of needles) {
      for (const text of haystacks) {
        if (likeMatches(likeContains(needle), text) !== text.includes(needle))
          wrong.push(`${JSON.stringify(needle)} in ${JSON.stringify(text)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('isUniqueViolation', () => {
  it('recognises the messages SQLite and D1 produce', () => {
    expect(isUniqueViolation(new Error('UNIQUE constraint failed: users.handle'))).toBe(true);
    expect(isUniqueViolation(new Error('D1_ERROR: UNIQUE constraint failed: tags.name: SQLITE_CONSTRAINT'))).toBe(true);
    expect(isUniqueViolation(new Error('SQLITE_CONSTRAINT_UNIQUE'))).toBe(true);
    expect(isUniqueViolation(new Error('SQLITE_CONSTRAINT_PRIMARYKEY: failed'))).toBe(true);
    expect(isUniqueViolation(new Error('unique constraint failed: x'))).toBe(true);
  });

  it('does not mistake other constraint failures for it', () => {
    expect(isUniqueViolation(new Error('FOREIGN KEY constraint failed'))).toBe(false);
    expect(isUniqueViolation(new Error('NOT NULL constraint failed: users.handle'))).toBe(false);
    expect(isUniqueViolation(new Error('SQLITE_CONSTRAINT_FOREIGNKEY'))).toBe(false);
    expect(isUniqueViolation(new Error('no such table: users'))).toBe(false);
  });

  it('only looks at real errors', () => {
    expect(isUniqueViolation('UNIQUE constraint failed')).toBe(false);
    expect(isUniqueViolation({ message: 'UNIQUE constraint failed' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});

describe('capped', () => {
  it('keeps a list that fits, and says it is complete', () => {
    expect(capped([1, 2, 3], 3)).toEqual({ rows: [1, 2, 3], truncated: false });
    expect(capped([], 3)).toEqual({ rows: [], truncated: false });
  });

  it('cuts the extra row off a list queried with limit + 1, and says it was cut', () => {
    expect(capped([1, 2, 3, 4], 3)).toEqual({ rows: [1, 2, 3], truncated: true });
  });

  it('cuts any longer list to the limit too', () => {
    expect(capped([1, 2, 3, 4, 5, 6], 3)).toEqual({ rows: [1, 2, 3], truncated: true });
  });
});

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson<string[]>('["#fff","#000"]')).toEqual(['#fff', '#000']);
    expect(parseJson<number>('0')).toBe(0);
  });

  it('gives null for missing or malformed text instead of throwing', () => {
    expect(parseJson(null)).toBeNull();
    expect(parseJson(undefined)).toBeNull();
    expect(parseJson('')).toBeNull();
    expect(parseJson('{broken')).toBeNull();
    expect(parseJson('undefined')).toBeNull();
    expect(parseJson('null')).toBeNull();
  });
});

describe('nowIso / addDaysIso', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const freeze = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  };

  it('formats UTC time without milliseconds', () => {
    freeze('2026-11-08T10:11:12.345Z');
    expect(nowIso()).toBe('2026-11-08T10:11:12Z');
    freeze('2026-11-08T10:11:12.999Z');
    expect(nowIso()).toBe('2026-11-08T10:11:12Z');
  });

  it('matches the shape of the other UTC timestamps in the database', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(addDaysIso(3)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('adds whole and partial days, forwards and backwards, across month and year ends', () => {
    freeze('2026-11-08T10:11:12.345Z');
    expect(addDaysIso(0)).toBe('2026-11-08T10:11:12Z');
    expect(addDaysIso(7)).toBe('2026-11-15T10:11:12Z');
    expect(addDaysIso(30)).toBe('2026-12-08T10:11:12Z');
    expect(addDaysIso(-1)).toBe('2026-11-07T10:11:12Z');
    expect(addDaysIso(0.5)).toBe('2026-11-08T22:11:12Z');
    freeze('2026-12-30T23:59:59.999Z');
    expect(addDaysIso(2)).toBe('2027-01-01T23:59:59Z');
    freeze('2027-02-27T12:00:00.000Z');
    expect(addDaysIso(2)).toBe('2027-03-01T12:00:00Z');
  });
});
