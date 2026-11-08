import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { UpstreamError } from './http';
import { geocodeFromAddress, nominatimReverse, nominatimSearch, overpassAround, parseOverpass, type OverpassElement } from './osm';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Replaces `fetch` with a stub that answers every request with `body` and records the requests. */
function stubFetch(body: unknown, init: ResponseInit = {}) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, requestInit?: RequestInit) => {
      requests.push({ url, init: requestInit });
      return Response.json(body, init);
    })
  );
  return requests;
}

describe('parseOverpass', () => {
  it('turns a named, categorised node into a place', () => {
    const elements: OverpassElement[] = [
      {
        type: 'node',
        id: 123,
        lat: 30.2589,
        lon: 120.1494,
        tags: { name: '断桥', man_made: 'bridge', 'addr:city': '杭州市', 'addr:district': '西湖区' }
      }
    ];
    expect(parseOverpass(elements)).toEqual([
      { source: 'osm', sourceId: 'node/123', name: '断桥', category: '桥', lat: 30.2589, lng: 120.1494, city: '杭州市', district: '西湖区' }
    ]);
  });

  it('uses the centre of a way or relation', () => {
    const [place] = parseOverpass([{ type: 'way', id: 7, center: { lat: 30.24, lon: 120.14 }, tags: { name: '西湖', natural: 'water' } }]);
    expect(place).toMatchObject({ sourceId: 'way/7', lat: 30.24, lng: 120.14, category: '湖' });
    const [relation] = parseOverpass([{ type: 'relation', id: 9, center: { lat: 1, lon: 2 }, tags: { name: '某岛', place: 'island' } }]);
    expect(relation).toMatchObject({ sourceId: 'relation/9', category: '岛' });
  });

  it('accepts a place at latitude or longitude 0', () => {
    expect(parseOverpass([{ type: 'node', id: 1, lat: 0, lon: 0, tags: { name: '零点', tourism: 'attraction' } }])).toHaveLength(1);
  });

  it('skips elements without a usable name, position or category', () => {
    const skipped: OverpassElement[] = [
      { type: 'node', id: 1, lat: 1, lon: 1, tags: { tourism: 'attraction' } },
      { type: 'node', id: 2, lat: 1, lon: 1, tags: { name: '   ', tourism: 'attraction' } },
      { type: 'node', id: 3, tags: { name: '无坐标', tourism: 'attraction' } },
      { type: 'way', id: 4, tags: { name: '无中心', tourism: 'attraction' } },
      { type: 'node', id: 5, lat: 1, lon: 1, tags: { name: '某路', highway: 'residential' } },
      { type: 'node', id: 6, lat: 1, lon: 1 },
      { type: 'node', id: 7, lat: 1, tags: { name: '只有纬度', tourism: 'attraction' } }
    ];
    expect(parseOverpass(skipped)).toEqual([]);
  });

  it('keeps the good elements among the bad, in order', () => {
    const elements: OverpassElement[] = [
      { type: 'node', id: 1, lat: 1, lon: 1, tags: { name: '甲', tourism: 'attraction' } },
      { type: 'node', id: 2, lat: 2, lon: 2, tags: { tourism: 'attraction' } },
      { type: 'node', id: 3, lat: 3, lon: 3, tags: { name: '丙', tourism: 'attraction' } }
    ];
    expect(parseOverpass(elements).map((p) => p.name)).toEqual(['甲', '丙']);
  });

  it('trims names and address parts, and leaves missing or blank ones null', () => {
    const [place] = parseOverpass([
      {
        type: 'node',
        id: 1,
        lat: 1,
        lon: 1,
        tags: { name: '  湖心亭  ', tourism: 'attraction', 'addr:city': '  ', 'addr:district': ' 西湖区 ' }
      }
    ]);
    expect(place).toMatchObject({ name: '湖心亭', category: '亭', city: null, district: '西湖区' });
  });

  it('applies the name suffix rules, so a monument called 塔 is a 塔', () => {
    const [place] = parseOverpass([{ type: 'node', id: 1, lat: 1, lon: 1, tags: { name: '雷峰塔', historic: 'monument' } }]);
    expect(place.category).toBe('塔');
  });

  it('copes with an empty list', () => {
    expect(parseOverpass([])).toEqual([]);
  });
});

describe('geocodeFromAddress', () => {
  describe('the four municipalities', () => {
    it('name the city from the ISO code, and take the district from the usual fields', () => {
      expect(geocodeFromAddress({ 'ISO3166-2-lvl4': 'CN-SH', city: '上海市', city_district: '黄浦区' })).toEqual({
        city: '上海市',
        district: '黄浦区'
      });
      expect(geocodeFromAddress({ 'ISO3166-2-lvl4': 'CN-BJ', district: '朝阳区' })).toEqual({ city: '北京市', district: '朝阳区' });
      expect(geocodeFromAddress({ 'ISO3166-2-lvl4': 'CN-TJ' })).toEqual({ city: '天津市', district: null });
      expect(geocodeFromAddress({ 'ISO3166-2-lvl4': 'CN-CQ', city_district: '渝中区' })).toEqual({ city: '重庆市', district: '渝中区' });
    });

    it('treat a `city` that is really the district as the district', () => {
      expect(geocodeFromAddress({ 'ISO3166-2-lvl4': 'CN-BJ', city: '东城区' })).toEqual({ city: '北京市', district: '东城区' });
    });
  });

  describe('elsewhere in mainland China', () => {
    it('turns a district-looking `city` into the district and leaves the city to the caller', () => {
      expect(geocodeFromAddress({ country_code: 'cn', city: '西湖区' })).toEqual({ city: null, district: '西湖区' });
      expect(geocodeFromAddress({ country_code: 'cn', town: '临安县' })).toEqual({ city: null, district: '临安县' });
      for (const name of ['西湖区', '余杭區', '临安县', '桐庐縣', '某某旗']) {
        expect(geocodeFromAddress({ country_code: 'cn', city: name }).district, name).toBe(name);
      }
    });

    it('takes the prefecture-level city from state_district when there is one', () => {
      expect(geocodeFromAddress({ country_code: 'cn', city: '西湖区', state_district: '杭州市' })).toEqual({
        city: '杭州市',
        district: '西湖区'
      });
    });

    it('keeps a real city name as the city', () => {
      expect(geocodeFromAddress({ country_code: 'cn', city: '杭州市', city_district: '西湖区' })).toEqual({
        city: '杭州市',
        district: '西湖区'
      });
    });
  });

  describe('everywhere else', () => {
    it('uses the first of city, town, municipality and village as the city', () => {
      expect(geocodeFromAddress({ city: 'Tokyo', town: 'x', village: 'y' }).city).toBe('Tokyo');
      expect(geocodeFromAddress({ town: 'Smalltown', village: 'y' }).city).toBe('Smalltown');
      expect(geocodeFromAddress({ municipality: 'Muni', village: 'y' }).city).toBe('Muni');
      expect(geocodeFromAddress({ village: 'Hamlet' }).city).toBe('Hamlet');
    });

    it('falls back to state_district, county and state for the city', () => {
      expect(geocodeFromAddress({ state_district: 'SD', county: 'C', state: 'S' }).city).toBe('SD');
      expect(geocodeFromAddress({ county: 'C', state: 'S' }).city).toBe('C');
      expect(geocodeFromAddress({ state: 'Bavaria' }).city).toBe('Bavaria');
    });

    it('prefers city_district, then district, then a county other than the city, then the suburb', () => {
      expect(geocodeFromAddress({ city: 'A', city_district: 'D1', district: 'D2', county: 'C', suburb: 'S' }).district).toBe('D1');
      expect(geocodeFromAddress({ city: 'A', district: 'D2', county: 'C', suburb: 'S' }).district).toBe('D2');
      expect(geocodeFromAddress({ city: 'A', county: 'C', suburb: 'S' }).district).toBe('C');
      expect(geocodeFromAddress({ city: 'A', suburb: 'S' }).district).toBe('S');
    });

    it('does not repeat the city as the district', () => {
      expect(geocodeFromAddress({ county: 'Same' })).toEqual({ city: 'Same', district: null });
      expect(geocodeFromAddress({ county: 'Same', suburb: 'Sub' })).toEqual({ city: 'Same', district: 'Sub' });
    });

    it('has nothing to say about an empty address', () => {
      expect(geocodeFromAddress({})).toEqual({ city: null, district: null });
    });
  });
});

describe('overpassAround', () => {
  it('posts a query for named places around the point and returns the parsed places', async () => {
    const requests = stubFetch({
      elements: [{ type: 'node', id: 1, lat: 30.2, lon: 120.1, tags: { name: '雷峰塔', tourism: 'attraction' } }]
    });
    const places = await overpassAround(30.25, 120.14, 300.4);
    expect(places).toMatchObject([{ sourceId: 'node/1', name: '雷峰塔', category: '塔' }]);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://overpass-api.de/api/interpreter');
    expect(requests[0].init?.method).toBe('POST');
    const raw = requests[0].init?.body;
    if (typeof raw !== 'string') throw new Error('expected a string body');
    const body = decodeURIComponent(raw.replace(/^data=/, ''));
    expect(body).toContain('(around:300,30.25000,120.14000)');
    expect(body).toContain('[out:json][timeout:8]');
    expect(body).toContain('out center tags 150;');
  });

  it('sends a User-Agent that identifies the app, as the Nominatim and Overpass policies ask', async () => {
    const requests = stubFetch({ elements: [] });
    await overpassAround(1, 2, 100);
    const headers = requests[0].init?.headers as Record<string, string>;
    expect(headers['user-agent']).toMatch(/^Living\//);
  });

  it('treats a response without elements as a failure, so it is not cached', async () => {
    stubFetch({ unexpected: true });
    await expect(overpassAround(1, 2, 100)).rejects.toThrow(UpstreamError);
  });

  it('treats a 200 answer carrying a runtime-error remark as a failure too', async () => {
    for (const remark of [
      'runtime error: Query timed out in "query" at line 3',
      'runtime error: out of memory',
      'The server is probably timed out'
    ]) {
      stubFetch({ elements: [], remark });
      await expect(overpassAround(1, 2, 100), remark).rejects.toThrow('overpass: query did not complete');
    }
  });

  it('accepts an empty answer with a harmless remark', async () => {
    stubFetch({ elements: [], remark: 'Overpass API version 0.7.62' });
    expect(await overpassAround(1, 2, 100)).toEqual([]);
  });

  it('reports an HTTP error without echoing the URL or query', async () => {
    stubFetch({ error: 'busy' }, { status: 429 });
    await expect(overpassAround(30.25, 120.14, 300)).rejects.toThrow(new UpstreamError('overpass: HTTP 429'));
  });
});

describe('nominatimReverse', () => {
  it('asks for a Chinese address at zoom 16 and maps it to city and district', async () => {
    const requests = stubFetch({ address: { country_code: 'cn', city: '西湖区', state_district: '杭州市' } });
    expect(await nominatimReverse(30.25, 120.14)).toEqual({ city: '杭州市', district: '西湖区' });

    const url = new URL(requests[0].url);
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/reverse');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: 'jsonv2',
      lat: '30.250000',
      lon: '120.140000',
      zoom: '16',
      addressdetails: '1',
      'accept-language': 'zh-CN'
    });
  });

  it('answers with nothing for a point it cannot geocode, which is not an outage', async () => {
    stubFetch({ error: 'Unable to geocode' });
    expect(await nominatimReverse(0, 0)).toEqual({ city: null, district: null });
  });

  it('copes with a response without an address', async () => {
    stubFetch({});
    expect(await nominatimReverse(0, 0)).toEqual({ city: null, district: null });
  });
});

describe('nominatimSearch', () => {
  const hit = (over: Record<string, unknown> = {}) => ({
    osm_type: 'way',
    osm_id: 42,
    lat: '30.2433',
    lon: '120.1399',
    name: '湖心亭',
    class: 'tourism',
    type: 'attraction',
    address: { country_code: 'cn', city: '西湖区', state_district: '杭州市' },
    ...over
  });

  it('maps hits to places, with city and district from the address', async () => {
    const requests = stubFetch([hit()]);
    expect(await nominatimSearch('湖心亭')).toEqual([
      { source: 'osm', sourceId: 'way/42', name: '湖心亭', category: '亭', lat: 30.2433, lng: 120.1399, city: '杭州市', district: '西湖区' }
    ]);
    const url = new URL(requests[0].url);
    expect(url.searchParams.get('q')).toBe('湖心亭');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('falls back to the first part of display_name when there is no name', async () => {
    stubFetch([hit({ name: undefined, display_name: '雷峰塔, 南山路, 西湖区, 杭州市, 中国' })]);
    const [place] = await nominatimSearch('雷峰塔');
    expect(place.name).toBe('雷峰塔');
  });

  it('uses the broader Nominatim classes as 景 when Overpass-style tags give nothing', async () => {
    stubFetch([
      hit({ class: 'boundary', type: 'administrative', name: '某处' }),
      hit({ osm_id: 43, class: undefined, type: undefined, name: '另一处' })
    ]);
    expect((await nominatimSearch('x')).map((p) => p.category)).toEqual(['景', '景']);
  });

  it('skips hits that lack an id, a name or a usable position', async () => {
    stubFetch([
      hit({ osm_type: undefined }),
      hit({ osm_id: 0 }),
      hit({ name: '', display_name: '' }),
      hit({ lat: 'abc' }),
      hit({ lon: undefined }),
      hit({ osm_id: 99, name: '好的' })
    ]);
    expect((await nominatimSearch('x')).map((p) => p.sourceId)).toEqual(['way/99']);
  });

  it('treats a non-list answer as a failure', async () => {
    stubFetch({ error: 'nope' });
    await expect(nominatimSearch('x')).rejects.toThrow('nominatim search: unexpected response');
  });
});
