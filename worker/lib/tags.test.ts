import { describe, expect, it } from 'vite-plus/test';
import { fakeD1 } from '../test-utils';
import { tagCount, toTag, usableTagIds, type TagRow } from './tags';

const row = (over: Partial<TagRow> = {}): TagRow => ({
  id: 't_01',
  name: '晨雾',
  parent_id: 'light',
  owner_id: 'u_1',
  color: null,
  sort: 3,
  ...over
});

describe('toTag', () => {
  it('maps a row to the API shape', () => {
    expect(toTag(row({ count: 5 }))).toEqual({
      id: 't_01',
      name: '晨雾',
      parentId: 'light',
      ownerId: 'u_1',
      color: null,
      sort: 3,
      count: 5
    });
  });

  it('counts zero when the row carries no count, and lets an explicit count win', () => {
    expect(toTag(row()).count).toBe(0);
    expect(toTag(row({ count: 5 }), 9).count).toBe(9);
    expect(toTag(row({ count: 5 }), 0).count).toBe(0);
  });

  it('keeps preset tags (no owner) and colour swatches as they are', () => {
    expect(toTag(row({ owner_id: null, parent_id: null, color: 'mono' }))).toMatchObject({ ownerId: null, parentId: null, color: 'mono' });
  });
});

describe('usableTagIds', () => {
  it('keeps the ids the database confirms, in the caller’s order', async () => {
    const { db } = fakeD1(() => [{ id: 'lake' }, { id: 't_mine' }]);
    expect(await usableTagIds(db, 'u_1', ['t_mine', 'ghost', 'lake'])).toEqual(['t_mine', 'lake']);
  });

  it('drops everything the database does not return, such as other people’s private tags', async () => {
    const { db } = fakeD1(() => []);
    expect(await usableTagIds(db, 'u_1', ['t_someone_elses', 'ghost'])).toEqual([]);
  });

  it('does not ask the database about an empty list', async () => {
    const { db, calls } = fakeD1(() => [{ id: 'x' }]);
    expect(await usableTagIds(db, 'u_1', [])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('allows presets and the user’s own tags only, passing the ids as one JSON parameter', async () => {
    const { db, calls } = fakeD1(() => []);
    await usableTagIds(db, 'u_1', ['a', 'b']);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('owner_id IS NULL OR owner_id = ?2');
    expect(calls[0].params).toEqual(['["a","b"]', 'u_1']);
  });
});

describe('tagCount', () => {
  it('counts the photos a visitor can see in lists: public ones only', async () => {
    const { db, calls } = fakeD1(() => ({ n: 4 }));
    expect(await tagCount(db, null, 'lake')).toBe(4);
    expect(calls[0].sql).toContain("p.visibility = 'public'");
    expect(calls[0].sql).not.toContain('owner_id');
    expect(calls[0].params).toEqual(['lake']);
  });

  it('adds the viewer’s own photos for a signed-in viewer', async () => {
    const { db, calls } = fakeD1(() => ({ n: 7 }));
    expect(await tagCount(db, 'u_1', 'lake')).toBe(7);
    expect(calls[0].sql).toContain("(p.visibility = 'public' OR p.owner_id = ?1)");
    expect(calls[0].sql).toContain('pt.tag_id = ?2');
    expect(calls[0].params).toEqual(['u_1', 'lake']);
  });

  it('is zero when the query returns nothing', async () => {
    const { db } = fakeD1(() => null);
    expect(await tagCount(db, null, 'lake')).toBe(0);
  });
});
