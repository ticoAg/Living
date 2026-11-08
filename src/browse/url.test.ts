import { describe, expect, it } from 'vite-plus/test';
import { galleryLink, livingForFilter, livingPlace, livingStart } from './links';
import { sourceFromQuery } from '../living/settings';
import { serializeQuery, splitIds } from './url';

describe('splitIds', () => {
  it('splits a comma-separated list', () => {
    expect(splitIds('lake,bridge,sunset')).toEqual(['lake', 'bridge', 'sunset']);
    expect(splitIds('lake')).toEqual(['lake']);
  });

  it('trims each id and drops empty ones', () => {
    expect(splitIds(' lake , bridge ,, ,sunset,')).toEqual(['lake', 'bridge', 'sunset']);
  });

  it('is empty for nothing', () => {
    expect(splitIds(null)).toEqual([]);
    expect(splitIds(undefined)).toEqual([]);
    expect(splitIds('')).toEqual([]);
    expect(splitIds(' , ,')).toEqual([]);
  });

  it('keeps repeated ids, since callers decide what to do with them', () => {
    expect(splitIds('a,a')).toEqual(['a', 'a']);
  });
});

describe('serializeQuery', () => {
  it('joins key=value pairs with &', () => {
    expect(
      serializeQuery([
        ['a', '1'],
        ['b', '2']
      ])
    ).toBe('a=1&b=2');
  });

  it('skips missing and empty values', () => {
    expect(
      serializeQuery([
        ['a', '1'],
        ['b', null],
        ['c', undefined],
        ['d', ''],
        ['e', '0']
      ])
    ).toBe('a=1&e=0');
    expect(serializeQuery([])).toBe('');
    expect(serializeQuery([['a', null]])).toBe('');
  });

  it('percent-encodes keys and values', () => {
    expect(serializeQuery([['city', '杭州']])).toBe('city=%E6%9D%AD%E5%B7%9E');
    expect(serializeQuery([['q', 'a b&c=d#e']])).toBe('q=a%20b%26c%3Dd%23e');
    expect(serializeQuery([['a b', '1']])).toBe('a%20b=1');
  });

  it('leaves commas readable, so tag lists stay legible in the address bar', () => {
    expect(serializeQuery([['tags', 'lake,bridge']])).toBe('tags=lake,bridge');
    expect(serializeQuery([['tags', 'a%2Cb']])).toBe('tags=a%252Cb');
  });

  it('accepts any iterable of pairs, such as URLSearchParams entries', () => {
    const params = new URLSearchParams('tags=lake,bridge&city=%E6%9D%AD%E5%B7%9E&empty=');
    expect(serializeQuery(params.entries())).toBe('tags=lake,bridge&city=%E6%9D%AD%E5%B7%9E');
  });

  it('reads back to the same values through URLSearchParams', () => {
    const entries: [string, string][] = [
      ['city', '杭州 西湖'],
      ['tags', 'a,b'],
      ['q', 'x&y=z+1%']
    ];
    const parsed = new URLSearchParams(serializeQuery(entries));
    for (const [k, v] of entries) expect(parsed.get(k)).toBe(v);
  });
});

describe('livingForFilter', () => {
  it('plays everything when nothing is selected', () => {
    expect(livingForFilter({})).toBe('/living');
    expect(livingForFilter({ tags: [] })).toBe('/living');
  });

  it('plays one user’s photos when only a user is given', () => {
    expect(livingForFilter({ user: 'ada' })).toBe('/living?user=ada');
  });

  it('plays a city on its own', () => {
    expect(livingForFilter({ city: '杭州' })).toBe('/living?src=city&city=%E6%9D%AD%E5%B7%9E');
    expect(livingForFilter({ city: '杭州', user: 'ada' })).toBe('/living?src=city&city=%E6%9D%AD%E5%B7%9E&user=ada');
  });

  it('plays a tag selection, matching all tags only when there are several', () => {
    expect(livingForFilter({ tags: ['lake'] })).toBe('/living?src=tags&tags=lake');
    expect(livingForFilter({ tags: ['lake', 'sunset'] })).toBe('/living?src=tags&tags=lake,sunset&match=all');
  });

  it('adds the city and user to a tag selection', () => {
    expect(livingForFilter({ tags: ['lake'], city: '杭州', user: 'ada' })).toBe(
      '/living?src=tags&tags=lake&city=%E6%9D%AD%E5%B7%9E&user=ada'
    );
  });

  it('is understood by the Living page: the link plays what the gallery shows', () => {
    const queryOf = (link: string) => new URLSearchParams(link.split('?')[1] ?? '');
    expect(sourceFromQuery(queryOf(livingForFilter({ tags: ['lake', 'sunset'], city: '杭州', user: 'ada' })))).toMatchObject({
      src: 'tags',
      tags: ['lake', 'sunset'],
      match: 'all',
      city: '杭州',
      user: 'ada'
    });
    expect(sourceFromQuery(queryOf(livingForFilter({ city: '杭州' })))).toMatchObject({ src: 'city', city: '杭州' });
    expect(sourceFromQuery(queryOf(livingForFilter({})))).toMatchObject({ src: 'all', tags: [], city: '', user: '' });
    expect(sourceFromQuery(queryOf(livingForFilter({ user: 'ada' })))).toMatchObject({ src: 'all', user: 'ada' });
  });
});

describe('livingPlace / livingStart', () => {
  it('link to a place, or to a starting photo', () => {
    expect(livingPlace('poi_1')).toBe('/living?src=place&place=poi_1');
    expect(livingStart('ph_1')).toBe('/living?start=ph_1');
  });

  it('are understood by the Living page', () => {
    expect(sourceFromQuery(new URLSearchParams(livingPlace('poi_1').split('?')[1]))).toMatchObject({ src: 'place', place: 'poi_1' });
  });
});

describe('galleryLink', () => {
  it('links to the home gallery with a filter', () => {
    expect(galleryLink({})).toBe('/');
    expect(galleryLink({ tags: ['lake', 'sunset'] })).toBe('/?tags=lake,sunset');
    expect(galleryLink({ city: '杭州' })).toBe('/?city=%E6%9D%AD%E5%B7%9E');
    expect(galleryLink({ tags: ['lake'], city: '杭州' })).toBe('/?tags=lake&city=%E6%9D%AD%E5%B7%9E');
  });

  it('links to a user’s own gallery when an owner is given', () => {
    expect(galleryLink({}, 'ada')).toBe('/@ada');
    expect(galleryLink({ tags: ['lake'] }, 'ada')).toBe('/@ada?tags=lake');
  });

  it('leaves out an empty tag list', () => {
    expect(galleryLink({ tags: [], city: '杭州' })).toBe('/?city=%E6%9D%AD%E5%B7%9E');
  });
});
