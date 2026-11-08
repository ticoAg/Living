import { describe, expect, it } from 'vite-plus/test';
import { POI_CATEGORIES } from '../../shared/types';
import { fakeD1, invalidMessage, show, type DbCall } from '../test-utils';
import { POI_COLS, defaultRadius, findOrCreatePoi, parseNewPoi, poiCols, toPoi, type PoiRow } from './poi';

const row = (over: Partial<PoiRow> = {}): PoiRow => ({
  id: 'poi_01',
  name: '断桥',
  aliases: '断桥残雪',
  category: '桥',
  city: '杭州',
  district: '西湖区',
  lat: 30.2589,
  lng: 120.1494,
  radius: 60,
  source: 'amap',
  source_id: 'B0FF1',
  created_by: 'u_1',
  created_at: '2026-11-01T00:00:00Z',
  ...over
});

describe('parseNewPoi', () => {
  const valid = { name: '湖心亭', category: '亭', lat: 30.2433, lng: 120.1399 };

  it('parses a place and fills in the defaults', () => {
    expect(parseNewPoi(valid)).toEqual({
      name: '湖心亭',
      category: '亭',
      lat: 30.2433,
      lng: 120.1399,
      city: null,
      district: null,
      source: 'custom',
      sourceId: null
    });
  });

  it('trims text and keeps provider details', () => {
    expect(
      parseNewPoi({ ...valid, name: '  湖心亭 ', city: ' 杭州 ', district: '西湖区', source: 'osm', sourceId: ' way/42 ' })
    ).toMatchObject({ name: '湖心亭', city: '杭州', district: '西湖区', source: 'osm', sourceId: 'way/42' });
  });

  it('only accepts a listed category', () => {
    for (const category of POI_CATEGORIES) expect(parseNewPoi({ ...valid, category }).category).toBe(category);
    for (const bad of ['', '亭子', '桥 ', 'bridge', 5, null, undefined]) {
      expect(
        invalidMessage(() => parseNewPoi({ ...valid, category: bad })),
        String(bad)
      ).toBe(`地点类别需要是：${POI_CATEGORIES.join('、')}`);
    }
  });

  it('wants a name of 1 to 80 characters', () => {
    expect(parseNewPoi({ ...valid, name: '名'.repeat(80) }).name).toBe('名'.repeat(80));
    expect(invalidMessage(() => parseNewPoi({ ...valid, name: '名'.repeat(81) }))).toBe('地点名称不能为空，且最多 80 个字符');
    expect(invalidMessage(() => parseNewPoi({ ...valid, name: '  ' }))).toBe('地点名称不能为空，且最多 80 个字符');
    expect(invalidMessage(() => parseNewPoi({ category: '亭', lat: 1, lng: 1 }))).toBe('请填写地点名称');
  });

  it('wants both coordinates, within range', () => {
    expect(invalidMessage(() => parseNewPoi({ ...valid, lat: undefined }))).toBe('请提供地点的经纬度');
    expect(invalidMessage(() => parseNewPoi({ ...valid, lng: null }))).toBe('请提供地点的经纬度');
    expect(invalidMessage(() => parseNewPoi({ ...valid, lat: 91 }))).toBe('地点纬度不能大于 90');
    expect(invalidMessage(() => parseNewPoi({ ...valid, lng: -181 }))).toBe('地点经度不能小于 -180');
    expect(invalidMessage(() => parseNewPoi({ ...valid, lat: '30.2' }))).toBe('地点纬度需要是数字');
    expect(parseNewPoi({ ...valid, lat: 0, lng: 0 })).toMatchObject({ lat: 0, lng: 0 });
  });

  it('limits the optional fields', () => {
    expect(invalidMessage(() => parseNewPoi({ ...valid, city: '城'.repeat(61) }))).toBe('城市最多 60 个字符');
    expect(invalidMessage(() => parseNewPoi({ ...valid, sourceId: 'x'.repeat(121) }))).toBe('地点来源编号最多 120 个字符');
    expect(invalidMessage(() => parseNewPoi({ ...valid, source: 'google' }))).toBe('地点来源需要是 custom / amap / osm 之一');
  });

  it('must be an object', () => {
    for (const bad of [null, undefined, 'x', 5, [], [valid]]) {
      expect(
        invalidMessage(() => parseNewPoi(bad)),
        show(bad)
      ).toBe('地点信息格式不对');
    }
  });
});

describe('POI_COLS / poiCols', () => {
  it('lists the columns of PoiRow', () => {
    expect(POI_COLS.split(', ')).toEqual([
      'id',
      'name',
      'aliases',
      'category',
      'city',
      'district',
      'lat',
      'lng',
      'radius',
      'source',
      'source_id',
      'created_by',
      'created_at'
    ]);
  });

  it('qualifies each column with a table alias', () => {
    const qualified = poiCols('p').split(', ');
    expect(qualified).toHaveLength(POI_COLS.split(', ').length);
    expect(qualified.every((c) => c.startsWith('p.'))).toBe(true);
    expect(poiCols('p')).toBe(
      POI_COLS.split(', ')
        .map((c) => `p.${c}`)
        .join(', ')
    );
    expect(poiCols('pois').startsWith('pois.id, pois.name')).toBe(true);
  });
});

describe('toPoi', () => {
  it('maps a row to the API shape', () => {
    expect(toPoi(row())).toEqual({
      id: 'poi_01',
      name: '断桥',
      category: '桥',
      city: '杭州',
      district: '西湖区',
      lat: 30.2589,
      lng: 120.1494,
      radius: 60,
      source: 'amap',
      sourceId: 'B0FF1'
    });
  });

  it('does not expose who created the place or its aliases', () => {
    const json = JSON.stringify(toPoi(row()));
    expect(json).not.toContain('u_1');
    expect(json).not.toContain('断桥残雪');
    expect(json).not.toContain('created');
  });

  it('adds a photo count only when given one, zero included', () => {
    expect(toPoi(row())).not.toHaveProperty('count');
    expect(toPoi(row(), 7).count).toBe(7);
    expect(toPoi(row(), 0).count).toBe(0);
  });

  it('keeps nulls', () => {
    expect(toPoi(row({ city: null, district: null, source_id: null }))).toMatchObject({ city: null, district: null, sourceId: null });
  });
});

describe('defaultRadius', () => {
  it('follows the category table, with 120 m for anything else', () => {
    expect(defaultRadius('桥')).toBe(60);
    expect(defaultRadius('湖')).toBe(600);
    expect(defaultRadius('寺')).toBe(150);
    expect(defaultRadius('???')).toBe(120);
  });
});

describe('findOrCreatePoi', () => {
  const input = { name: '湖心亭', category: '亭', lat: 30.2433, lng: 120.1399, city: '杭州', district: '西湖区' };
  const bySourceKey = (call: DbCall) => call.sql.includes('WHERE source = ?1 AND source_id = ?2');
  const byId = (call: DbCall) => call.sql.includes('WHERE id = ?1');
  const insert = (calls: DbCall[]) => calls.find((c) => c.sql.includes('INSERT OR IGNORE INTO pois'));

  it('returns the stored place for a provider id it already has, without inserting', async () => {
    const existing = row({ id: 'poi_existing', source: 'osm', source_id: 'way/42' });
    const { db, calls } = fakeD1((call) => (bySourceKey(call) ? existing : null));
    const found = await findOrCreatePoi(db, { ...input, source: 'osm', sourceId: 'way/42' }, 'u_9');
    expect(found).toBe(existing);
    expect(insert(calls)).toBeUndefined();
    expect(calls[0].params).toEqual(['osm', 'way/42']);
  });

  it('creates a place for a new provider id, with the category’s default radius, and reads it back by that id', async () => {
    const created = row({ id: 'poi_created', name: '湖心亭', category: '亭', radius: 40 });
    const { db, calls } = fakeD1((call) => (bySourceKey(call) ? (insert(calls) ? created : null) : null));
    const result = await findOrCreatePoi(db, { ...input, source: 'amap', sourceId: 'B0FF9' }, 'u_9');
    expect(result).toBe(created);

    const written = insert(calls);
    expect(written).toBeDefined();
    const params = written?.params ?? [];
    expect(params[0]).toMatch(/^poi_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(params.slice(1, 11)).toEqual(['湖心亭', '亭', '杭州', '西湖区', 30.2433, 120.1399, 40, 'amap', 'B0FF9', 'u_9']);
    expect(params[11]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // the second lookup is by the provider key, in case a concurrent request created it first
    expect(calls.filter(bySourceKey)).toHaveLength(2);
  });

  it('creates a custom place without a provider id, and reads it back by its own id', async () => {
    const created = row({ id: 'poi_custom', source: 'custom', source_id: null });
    const { db, calls } = fakeD1((call) => (byId(call) ? created : null));
    const result = await findOrCreatePoi(db, { name: '我家附近的长椅', category: '景', lat: 1, lng: 2 }, 'u_9');
    expect(result).toBe(created);

    const params = insert(calls)?.params ?? [];
    expect(params.slice(1, 11)).toEqual(['我家附近的长椅', '景', null, null, 1, 2, 120, 'custom', null, 'u_9']);
    // no lookup by provider key when there is no provider id
    expect(calls.some(bySourceKey)).toBe(false);
    expect(calls.find(byId)?.params).toEqual([params[0]]);
  });

  it('always creates a new place for custom input, even with the same name', async () => {
    const { db, calls } = fakeD1((call) => (byId(call) ? row() : null));
    await findOrCreatePoi(db, { name: '同名', category: '景', lat: 1, lng: 2 }, 'u_9');
    await findOrCreatePoi(db, { name: '同名', category: '景', lat: 1, lng: 2 }, 'u_9');
    const ids = calls.filter((c) => c.sql.includes('INSERT OR IGNORE')).map((c) => c.params[0]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('fails loudly if the place cannot be read back after the insert', async () => {
    const { db } = fakeD1(() => null);
    await expect(findOrCreatePoi(db, { name: 'x', category: '景', lat: 1, lng: 2 }, 'u_9')).rejects.toThrow('poi insert failed');
  });
});
