import { describe, expect, it } from 'vite-plus/test';
import { entry } from '../test-utils';
import { byYear, coverIds, fmtLength, shelve } from './showcase';

describe('shelve', () => {
  it('puts finished creations with the works and finished articles with the articles, the rest after, in list order', () => {
    const list = [
      entry('a1', { type: 'article' }),
      entry('n1', { type: 'note' }),
      entry('w1', { type: 'creation' }),
      entry('p1', { type: 'practice' }),
      entry('w2', { type: 'creation' }),
      entry('a2', { type: 'article' }),
      entry('t1', { type: 'trip' }),
      entry('r1', { type: 'reading' })
    ];
    const s = shelve(list);
    expect(s.works.map((e) => e.id)).toEqual(['w1', 'w2']);
    expect(s.articles.map((e) => e.id)).toEqual(['a1', 'a2']);
    expect(s.rest.map((e) => e.id)).toEqual(['n1', 'p1', 't1', 'r1']);
  });

  it('leaves drafts and archived entries of every type off every shelf', () => {
    const list = [
      entry('w', { type: 'creation', status: 'draft' }),
      entry('a', { type: 'article', status: 'archived' }),
      entry('n', { type: 'note', status: 'draft' }),
      entry('ok', { type: 'creation' })
    ];
    expect(shelve(list)).toEqual({ works: [list[3]], articles: [], rest: [] });
  });

  it('keeps an entry whatever its visibility: the list already holds only what the viewer may see', () => {
    const list = [entry('a', { type: 'article', visibility: 'private' }), entry('b', { type: 'article', visibility: 'unlisted' })];
    expect(shelve(list).articles).toEqual(list);
  });
});

describe('byYear', () => {
  it('groups a latest-first list by the year each happened, day-only or timed, keeping the order', () => {
    const list = [
      entry('c', { occurredAt: '2026-03-01' }),
      entry('b', { occurredAt: '2026-01-01T08:00:00' }),
      entry('a', { occurredAt: '2025-12-31T23:59:59' }),
      entry('z', { occurredAt: '1999-06-01' })
    ];
    expect(byYear(list).map((g) => [g.year, g.entries.map((e) => e.id)])).toEqual([
      ['2026', ['c', 'b']],
      ['2025', ['a']],
      ['1999', ['z']]
    ]);
    expect(byYear([])).toEqual([]);
  });
});

describe('fmtLength', () => {
  it('writes characters as 字, with thousands separators under ten thousand and 万 from there', () => {
    expect(fmtLength(0)).toBe('0 字');
    expect(fmtLength(860)).toBe('860 字');
    expect(fmtLength(2300)).toBe('2,300 字');
    expect(fmtLength(9999)).toBe('9,999 字');
    expect(fmtLength(10_000)).toBe('1万字');
    expect(fmtLength(12_345)).toBe('1.2万字');
    expect(fmtLength(1_234_567)).toBe('123万字');
  });
});

describe('coverIds', () => {
  it('takes the first photo of each entry that has one, each once, at most 200', () => {
    expect(coverIds([entry('a', { photoIds: ['p1', 'p2'] }), entry('b'), entry('c', { photoIds: ['p3'] })])).toEqual(['p1', 'p3']);
    expect(coverIds([entry('a', { photoIds: ['p1'] }), entry('b', { photoIds: ['p2', 'p1'] }), entry('c', { photoIds: ['p1'] })])).toEqual([
      'p1',
      'p2'
    ]);
    const many = Array.from({ length: 250 }, (_, i) => entry(`e${i}`, { photoIds: [`p${i}`] }));
    expect(coverIds(many)).toHaveLength(200);
    expect(coverIds(many)[199]).toBe('p199');
  });
});
