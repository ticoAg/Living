import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { distance, wgs84ToGcj02 } from '../../shared/geo';
import { amapAround, amapRegeo, amapText, parseAmapPois } from './amap';
import { UpstreamError } from './http';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      return Response.json(body);
    })
  );
  return urls;
}

/** AMap's `location` field ("lng,lat" in GCJ-02) for a WGS-84 point, as the service would report it. */
function gcjLocation(lat: number, lng: number): string {
  const [gLat, gLng] = wgs84ToGcj02(lat, lng);
  return `${gLng.toFixed(6)},${gLat.toFixed(6)}`;
}

// Leifeng Pagoda, WGS-84
const PAGODA = { lat: 30.2316, lng: 120.1485 };

describe('parseAmapPois', () => {
  const poi = (over: Record<string, unknown> = {}) => ({
    id: 'B0FFFAB6J2',
    name: '雷峰塔',
    type: '风景名胜;风景名胜;国家级景点',
    location: gcjLocation(PAGODA.lat, PAGODA.lng),
    pname: '浙江省',
    cityname: '杭州市',
    adname: '西湖区',
    ...over
  });

  it('turns a POI into a place in WGS-84 with a category and area', () => {
    const [place] = parseAmapPois([poi()]);
    expect(place).toMatchObject({
      source: 'amap',
      sourceId: 'B0FFFAB6J2',
      name: '雷峰塔',
      category: '塔',
      city: '杭州市',
      district: '西湖区'
    });
    // AMap reports GCJ-02 rounded to 6 decimals; the place must come back where the pagoda really is, within that rounding
    expect(distance(place.lat, place.lng, PAGODA.lat, PAGODA.lng)).toBeLessThan(0.2);
  });

  it('moves the coordinates by the GCJ-02 offset, not just copying them', () => {
    const [place] = parseAmapPois([poi()]);
    const [gLat, gLng] = gcjLocation(PAGODA.lat, PAGODA.lng).split(',').reverse().map(Number);
    expect(distance(place.lat, place.lng, gLat, gLng)).toBeGreaterThan(100);
  });

  it('uses the province as the city for municipalities, where AMap gives an empty list', () => {
    const [place] = parseAmapPois([poi({ cityname: [], pname: '上海市', adname: '黄浦区' })]);
    expect(place).toMatchObject({ city: '上海市', district: '黄浦区' });
  });

  it('treats the empty lists AMap sends for blank fields as missing', () => {
    const [place] = parseAmapPois([poi({ cityname: [], pname: [], adname: [] })]);
    expect(place).toMatchObject({ city: null, district: null });
  });

  it('trims text fields', () => {
    const [place] = parseAmapPois([poi({ id: ' B0FF ', name: '  雷峰塔 ', cityname: ' 杭州市 ' })]);
    expect(place).toMatchObject({ sourceId: 'B0FF', name: '雷峰塔', city: '杭州市' });
  });

  it('skips POIs without an id, a name or a location', () => {
    expect(parseAmapPois([poi({ id: undefined }), poi({ id: '' }), poi({ id: [] })])).toEqual([]);
    expect(parseAmapPois([poi({ name: undefined }), poi({ name: '  ' })])).toEqual([]);
    expect(parseAmapPois([poi({ location: undefined }), poi({ location: [] }), poi({ location: '' })])).toEqual([]);
  });

  it('skips POIs whose location is not a pair of numbers', () => {
    for (const location of ['abc,def', '120.1', 'x,30.2', '120.1,y', '120.1;30.2']) {
      expect(parseAmapPois([poi({ location })]), location).toEqual([]);
    }
  });

  it('drops places that are not photo places, such as housing, schools and addresses', () => {
    expect(parseAmapPois([poi({ type: '商务住宅;住宅区;住宅小区' }), poi({ type: '科教文化服务;学校;高等院校' })])).toEqual([]);
    expect(parseAmapPois([poi({ type: '商务住宅;住宅区;住宅小区' }), poi({ id: 'B0FF2', name: '孤山' })]).map((p) => p.sourceId)).toEqual([
      'B0FF2'
    ]);
  });

  it('copes with no POIs at all', () => {
    expect(parseAmapPois(undefined)).toEqual([]);
    expect(parseAmapPois([])).toEqual([]);
  });

  it('leaves places outside China where they are', () => {
    const [place] = parseAmapPois([poi({ location: '139.650300,35.676200' })]);
    expect(place.lat).toBe(35.6762);
    expect(place.lng).toBe(139.6503);
  });
});

describe('amapAround', () => {
  it('queries the converted point with the sights, culture and place-name types and returns parsed places', async () => {
    const urls = stubFetch({
      status: '1',
      pois: [{ id: 'B1', name: '雷峰塔', type: '风景名胜;风景名胜;国家级景点', location: gcjLocation(PAGODA.lat, PAGODA.lng) }]
    });
    const places = await amapAround('secret-key', PAGODA.lat, PAGODA.lng, 300.4);
    expect(places).toHaveLength(1);
    expect(distance(places[0].lat, places[0].lng, PAGODA.lat, PAGODA.lng)).toBeLessThan(0.2);

    const url = new URL(urls[0]);
    expect(url.origin + url.pathname).toBe('https://restapi.amap.com/v3/place/around');
    const params = Object.fromEntries(url.searchParams);
    expect(params).toEqual({
      key: 'secret-key',
      // GCJ-02, longitude first
      location: gcjLocation(PAGODA.lat, PAGODA.lng),
      radius: '300',
      types: '110000|140000|190000',
      sortrule: 'distance',
      offset: '25',
      page: '1',
      extensions: 'base'
    });
  });

  it('reports a service error with AMap’s own message, without the key', async () => {
    stubFetch({ status: '0', info: 'INVALID_USER_KEY' });
    const error = await amapAround('secret-key', 30, 120, 300).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).toBe('amap around: INVALID_USER_KEY');
    expect((error as Error).message).not.toContain('secret-key');
  });

  it('names the status when AMap gives no message', async () => {
    stubFetch({});
    await expect(amapAround('k', 30, 120, 300)).rejects.toThrow('amap around: status undefined');
  });
});

describe('amapText', () => {
  it('searches by keyword and returns parsed places', async () => {
    const urls = stubFetch({
      status: '1',
      pois: [{ id: 'B2', name: '孤山', type: '风景名胜;风景名胜;国家级景点', location: '120.14,30.25' }]
    });
    const places = await amapText('k', '孤山');
    expect(places.map((p) => p.name)).toEqual(['孤山']);
    const url = new URL(urls[0]);
    expect(url.pathname).toBe('/v3/place/text');
    expect(url.searchParams.get('keywords')).toBe('孤山');
    expect(url.searchParams.get('offset')).toBe('20');
  });

  it('fails on a service error', async () => {
    stubFetch({ status: '0', info: 'DAILY_QUERY_OVER_LIMIT' });
    await expect(amapText('k', 'x')).rejects.toThrow('amap text: DAILY_QUERY_OVER_LIMIT');
  });
});

describe('amapRegeo', () => {
  it('asks about the converted point and maps city and district', async () => {
    const urls = stubFetch({ status: '1', regeocode: { addressComponent: { province: '浙江省', city: '杭州市', district: '西湖区' } } });
    expect(await amapRegeo('k', PAGODA.lat, PAGODA.lng)).toEqual({ city: '杭州市', district: '西湖区' });
    const url = new URL(urls[0]);
    expect(url.pathname).toBe('/v3/geocode/regeo');
    expect(url.searchParams.get('location')).toBe(gcjLocation(PAGODA.lat, PAGODA.lng));
  });

  it('uses the province as the city for municipalities, where AMap’s city is an empty list', async () => {
    stubFetch({ status: '1', regeocode: { addressComponent: { province: '上海市', city: [], district: '黄浦区' } } });
    expect(await amapRegeo('k', 31.23, 121.47)).toEqual({ city: '上海市', district: '黄浦区' });
  });

  it('has nothing for a point AMap cannot place', async () => {
    stubFetch({ status: '1', regeocode: { addressComponent: { province: [], city: [], district: [] } } });
    expect(await amapRegeo('k', 0, 0)).toEqual({ city: null, district: null });
    stubFetch({ status: '1' });
    expect(await amapRegeo('k', 0, 0)).toEqual({ city: null, district: null });
  });

  it('fails on a service error', async () => {
    stubFetch({ status: '0', info: 'INVALID_USER_KEY' });
    await expect(amapRegeo('k', 30, 120)).rejects.toThrow('amap regeo: INVALID_USER_KEY');
  });
});
