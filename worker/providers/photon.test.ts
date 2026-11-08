import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { bboxAround, nominatimSearch, osmSearch, parsePhoton, photonNearby, photonSearch, SCENIC_TAGS, type PhotonFeature } from './osm';

// Photon (photon.komoot.io): nearby places and name search over OpenStreetMap, free and without a key.
// docs/architecture/decisions/0003-poi-providers.md

const feature = (
  name: string | undefined,
  key: string,
  value: string,
  over: Partial<NonNullable<PhotonFeature['properties']>> = {},
  coordinates: number[] = [120.1516, 30.2593]
): PhotonFeature => ({
  geometry: { coordinates },
  properties: { osm_type: 'N', osm_id: 1, osm_key: key, osm_value: value, name, ...over }
});

describe('parsePhoton', () => {
  it('turns features into places with OSM source ids and WGS-84 coordinates', () => {
    const [place] = parsePhoton([feature('断桥', 'man_made', 'bridge', { osm_type: 'W', osm_id: 42 }, [120.15161, 30.2593])]);
    expect(place).toEqual({
      source: 'osm',
      sourceId: 'way/42',
      name: '断桥',
      category: '桥',
      lat: 30.2593,
      lng: 120.15161,
      city: null,
      district: null
    });
  });

  it('maps node, way and relation and skips anything else', () => {
    const ids = parsePhoton([
      feature('甲', 'tourism', 'attraction', { osm_type: 'N', osm_id: 1 }),
      feature('乙', 'tourism', 'attraction', { osm_type: 'W', osm_id: 2 }),
      feature('丙', 'tourism', 'attraction', { osm_type: 'R', osm_id: 3 }),
      feature('丁', 'tourism', 'attraction', { osm_type: 'X', osm_id: 4 })
    ]).map((p) => p.sourceId);
    expect(ids).toEqual(['node/1', 'way/2', 'relation/3']);
  });

  it('files ordinary places too: cafés and shops, hotels, named buildings, pedestrian streets', () => {
    const cats = parsePhoton([
      feature('库迪咖啡', 'amenity', 'cafe', { osm_id: 1 }),
      feature('全家', 'shop', 'convenience', { osm_id: 2 }),
      feature('望湖宾馆', 'tourism', 'hotel', { osm_id: 3 }),
      feature('仁济医院', 'amenity', 'hospital', { osm_id: 4 }),
      feature('玉屏书院', 'building', 'yes', { osm_id: 5 }),
      feature('南京路步行街', 'highway', 'pedestrian', { osm_id: 6 })
    ]).map((p) => [p.name, p.category]);
    expect(cats).toEqual([
      ['库迪咖啡', '店'],
      ['全家', '店'],
      ['望湖宾馆', '建筑'],
      ['仁济医院', '建筑'],
      ['玉屏书院', '建筑'],
      ['南京路步行街', '街区']
    ]);
  });

  it('leaves out unnamed features, signs and maps, plain roads and features without a point', () => {
    const places = parsePhoton([
      feature(undefined, 'tourism', 'attraction', { osm_id: 1 }),
      feature('  ', 'tourism', 'attraction', { osm_id: 2 }),
      feature('清水寺境内案内図', 'tourism', 'information', { osm_id: 3 }),
      feature('北山街', 'highway', 'secondary', { osm_id: 4 }),
      { properties: { osm_type: 'N', osm_id: 5, osm_key: 'tourism', osm_value: 'attraction', name: '无坐标' } }
    ]);
    expect(places).toEqual([]);
  });

  it('keeps the first of features that repeat the same OSM object', () => {
    const places = parsePhoton([
      feature('断桥', 'man_made', 'bridge', { osm_id: 7 }),
      feature('断桥', 'man_made', 'bridge', { osm_id: 7 })
    ]);
    expect(places).toHaveLength(1);
  });

  it('reads a Chinese 区 reported as the city as the district, leaving the city to the reverse geocode', () => {
    const [place] = parsePhoton([feature('断桥', 'man_made', 'bridge', { city: '西湖区', countrycode: 'CN' })]);
    expect(place).toMatchObject({ city: null, district: '西湖区' });
  });

  it('keeps a city reported abroad', () => {
    const [place] = parsePhoton([
      feature('Kiyomizu-dera', 'amenity', 'place_of_worship', { city: 'Kyoto', district: 'Higashiyama', countrycode: 'JP' })
    ]);
    expect(place).toMatchObject({ city: 'Kyoto', district: 'Higashiyama', category: '寺' });
  });
});

describe('Photon requests', () => {
  let calls: URL[];
  let answer: (url: URL) => Response;

  beforeEach(() => {
    calls = [];
    answer = () => Response.json({ features: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input);
        calls.push(url);
        return answer(url);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks for the nearest places twice: anything, and landmarks only', async () => {
    await photonNearby(30.25930123, 120.15161456, 300);
    expect(calls).toHaveLength(2);
    for (const url of calls) {
      expect(url.origin + url.pathname).toBe('https://photon.komoot.io/reverse');
      expect(url.searchParams.get('lat')).toBe('30.25930');
      expect(url.searchParams.get('lon')).toBe('120.15161');
      expect(url.searchParams.get('radius')).toBe('0.300');
      expect(url.searchParams.get('limit')).toBe('50');
    }
    expect(calls[0].searchParams.getAll('osm_tag')).toEqual([]);
    expect(calls[1].searchParams.getAll('osm_tag')).toEqual(SCENIC_TAGS);
  });

  it('merges the two answers without listing an object twice', async () => {
    answer = (url) =>
      Response.json({
        features: url.searchParams.has('osm_tag')
          ? [feature('断桥', 'man_made', 'bridge', { osm_id: 1 })]
          : [feature('断桥', 'man_made', 'bridge', { osm_id: 1 }), feature('库迪咖啡', 'amenity', 'cafe', { osm_id: 2 })]
      });
    expect((await photonNearby(30.2593, 120.1516, 300)).map((p) => p.name)).toEqual(['断桥', '库迪咖啡']);
  });

  it('fails only when both nearby requests fail', async () => {
    answer = () => new Response('down', { status: 502 });
    await expect(photonNearby(30.2593, 120.1516, 300)).rejects.toThrow('photon reverse: HTTP 502');
  });

  it('treats an answer without features as a failure', async () => {
    answer = () => Response.json({ message: 'unexpected' });
    await expect(photonNearby(30.2593, 120.1516, 300)).rejects.toThrow('photon reverse: unexpected response');
  });

  it('limits a name search to a box around the photo and ranks by closeness', async () => {
    await photonSearch('断桥', { lat: 30.2593, lng: 120.1516 });
    const [url] = calls;
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/api');
    expect(url.searchParams.get('q')).toBe('断桥');
    expect(url.searchParams.get('lat')).toBe('30.25930');
    expect(url.searchParams.get('bbox')).toBe('120.0916,30.1993,120.2116,30.3193');
  });

  it('searches everywhere without a point', async () => {
    await photonSearch('断桥', null);
    expect(calls[0].searchParams.has('bbox')).toBe(false);
    expect(calls[0].searchParams.has('lat')).toBe(false);
  });

  it('bounds a Nominatim search to the same box when given a point', async () => {
    answer = () => Response.json([]);
    await nominatimSearch('断桥', { lat: 30.2593, lng: 120.1516 });
    expect(calls[0].searchParams.get('viewbox')).toBe(bboxAround({ lat: 30.2593, lng: 120.1516 }));
    expect(calls[0].searchParams.get('bounded')).toBe('1');
  });

  it('combines Photon and Nominatim, and survives one of them failing', async () => {
    answer = (url) =>
      url.hostname === 'photon.komoot.io'
        ? new Response('down', { status: 502 })
        : Response.json([{ osm_type: 'way', osm_id: 9, lat: '30.2593', lon: '120.1516', name: '断桥', class: 'man_made', type: 'bridge' }]);
    const places = await osmSearch('断桥', { lat: 30.2593, lng: 120.1516 });
    expect(places.map((p) => [p.name, p.sourceId])).toEqual([['断桥', 'way/9']]);
  });
});
