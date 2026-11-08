import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  DEFAULT_SETTINGS,
  STORE_KEY,
  buildQuery,
  defaultOrder,
  readInitial,
  readStored,
  sourceFromQuery,
  writeStored,
  type Settings,
  type Source
} from './settings';

const q = (search: string) => new URLSearchParams(search);

/** A `localStorage` holding `value` under the settings key. */
function stubStorage(value: string | null) {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: (key: string) => (key === STORE_KEY ? value : null), setItem });
  return setItem;
}

/** A `localStorage` that throws on every read, as when site data is blocked. */
function stubBlockedStorage() {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('storage blocked');
    },
    setItem: () => {
      throw new Error('storage blocked');
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('defaultOrder', () => {
  it('plays a theme in its own order and everything else shuffled', () => {
    expect(defaultOrder('theme')).toBe('time');
    for (const src of ['all', 'tags', 'place', 'city', 'today'] as const) expect(defaultOrder(src)).toBe('shuffle');
  });
});

describe('sourceFromQuery', () => {
  it('means "everything, shuffled" for a bare link', () => {
    expect(sourceFromQuery(q(''))).toEqual({
      src: 'all',
      tags: [],
      match: 'any',
      place: '',
      city: '',
      theme: '',
      user: '',
      order: 'shuffle'
    });
  });

  it('infers the source from whichever selector the link carries', () => {
    expect(sourceFromQuery(q('tags=lake')).src).toBe('tags');
    expect(sourceFromQuery(q('place=poi_1')).src).toBe('place');
    expect(sourceFromQuery(q('theme=th_1')).src).toBe('theme');
    expect(sourceFromQuery(q('city=杭州')).src).toBe('city');
  });

  it('prefers tags, then place, then theme, then city, when several are given', () => {
    expect(sourceFromQuery(q('tags=a&place=p&theme=t&city=c')).src).toBe('tags');
    expect(sourceFromQuery(q('place=p&theme=t&city=c')).src).toBe('place');
    expect(sourceFromQuery(q('theme=t&city=c')).src).toBe('theme');
  });

  it('lets an explicit src win, and ignores one it does not know', () => {
    expect(sourceFromQuery(q('src=all&tags=lake')).src).toBe('all');
    expect(sourceFromQuery(q('src=today')).src).toBe('today');
    expect(sourceFromQuery(q('src=bogus&tags=lake')).src).toBe('tags');
    expect(sourceFromQuery(q('src=bogus')).src).toBe('all');
  });

  it('falls back to everything when the chosen source has nothing to point at', () => {
    expect(sourceFromQuery(q('src=place')).src).toBe('all');
    expect(sourceFromQuery(q('src=theme')).src).toBe('all');
    expect(sourceFromQuery(q('src=city')).src).toBe('all');
    expect(sourceFromQuery(q('src=place&place=%20%20')).src).toBe('all');
    expect(sourceFromQuery(q('src=theme&theme=th_1')).src).toBe('theme');
  });

  it('reads tags as a trimmed, de-duplicated list', () => {
    expect(sourceFromQuery(q('tags=lake,%20bridge%20,lake,,sunset')).tags).toEqual(['lake', 'bridge', 'sunset']);
    expect(sourceFromQuery(q('tags=')).tags).toEqual([]);
  });

  it('trims the other selectors and drops a leading @ from the user', () => {
    expect(sourceFromQuery(q('place=%20poi_1%20&city=%20杭州%20&theme=%20th_1%20'))).toMatchObject({
      place: 'poi_1',
      city: '杭州',
      theme: 'th_1'
    });
    expect(sourceFromQuery(q('user=@ada')).user).toBe('ada');
    expect(sourceFromQuery(q('user=ada')).user).toBe('ada');
  });

  it('reads match and order, defaulting from the source', () => {
    expect(sourceFromQuery(q('tags=a&match=all')).match).toBe('all');
    expect(sourceFromQuery(q('tags=a&match=most')).match).toBe('any');
    expect(sourceFromQuery(q('tags=a&order=time')).order).toBe('time');
    expect(sourceFromQuery(q('tags=a&order=random')).order).toBe('shuffle');
    expect(sourceFromQuery(q('theme=th_1')).order).toBe('time');
    expect(sourceFromQuery(q('theme=th_1&order=shuffle')).order).toBe('shuffle');
  });

  it('decodes percent-encoded values', () => {
    expect(sourceFromQuery(q('city=%E6%9D%AD%E5%B7%9E')).city).toBe('杭州');
  });
});

describe('readInitial', () => {
  it('uses the defaults when the link and the device say nothing', () => {
    stubStorage(null);
    expect(readInitial('')).toEqual({ source: sourceFromQuery(q('')), settings: DEFAULT_SETTINGS, start: '' });
  });

  it('lets what the device remembers override the defaults', () => {
    stubStorage(JSON.stringify({ every: 30, fx: 'fade', fields: ['place', 'title'], night: true }));
    expect(readInitial('').settings).toEqual({ ...DEFAULT_SETTINGS, every: 30, fx: 'fade', fields: ['place', 'title'], night: true });
  });

  it('lets the link override what the device remembers, one parameter at a time', () => {
    stubStorage(JSON.stringify({ every: 30, fx: 'fade', size: 'l' }));
    expect(readInitial('?fx=cut&brief=1').settings).toEqual({ ...DEFAULT_SETTINGS, every: 30, fx: 'cut', size: 'l', brief: true });
  });

  it('reads the start photo', () => {
    stubStorage(null);
    expect(readInitial('?start=%20ph_9%20').start).toBe('ph_9');
  });

  it('does not take the source from the device: a bare link always plays everything', () => {
    stubStorage(JSON.stringify({ src: 'tags', tags: ['lake'], city: '杭州' }));
    expect(readInitial('').source.src).toBe('all');
  });

  describe('link values', () => {
    const settingsOf = (search: string) => readInitial(search).settings;

    it('takes seconds per photo between 2 and 86400, rounded', () => {
      stubStorage(null);
      expect(settingsOf('?every=30').every).toBe(30);
      expect(settingsOf('?every=7.6').every).toBe(8);
      expect(settingsOf('?every=2').every).toBe(2);
      expect(settingsOf('?every=86400').every).toBe(86_400);
    });

    it('ignores an unusable interval and keeps the default', () => {
      stubStorage(null);
      for (const bad of ['1', '0', '-5', '86401', 'abc', '', ' ', 'Infinity', 'NaN']) {
        expect(settingsOf(`?every=${encodeURIComponent(bad)}`).every, bad).toBe(DEFAULT_SETTINGS.every);
      }
    });

    it('accepts only known choices for fx, fit, pos and size', () => {
      stubStorage(null);
      expect(settingsOf('?fx=cut&fit=contain&pos=br&size=l')).toMatchObject({ fx: 'cut', fit: 'contain', pos: 'br', size: 'l' });
      expect(settingsOf('?fx=spin&fit=stretch&pos=tl&size=xl')).toMatchObject({
        fx: DEFAULT_SETTINGS.fx,
        fit: DEFAULT_SETTINGS.fit,
        pos: DEFAULT_SETTINGS.pos,
        size: DEFAULT_SETTINGS.size
      });
    });

    it('reads switches written as 1/0 or true/false', () => {
      stubStorage(null);
      expect(settingsOf('?brief=1&clock=true&awake=0&night=false')).toMatchObject({ brief: true, clock: true, awake: false, night: false });
      expect(settingsOf('?brief=yes&clock=on&awake=2&night=')).toMatchObject({
        brief: DEFAULT_SETTINGS.brief,
        clock: DEFAULT_SETTINGS.clock,
        awake: DEFAULT_SETTINGS.awake,
        night: DEFAULT_SETTINGS.night
      });
    });

    it('lists fields in a fixed order, whatever order the link gives, and drops unknown ones', () => {
      stubStorage(null);
      expect(settingsOf('?fields=date,place').fields).toEqual(['place', 'date']);
      expect(settingsOf('?fields=tags,exif,heading,coord,ago,time,date,city,title,place').fields).toEqual([
        'place',
        'title',
        'city',
        'date',
        'time',
        'ago',
        'coord',
        'heading',
        'exif',
        'tags'
      ]);
      expect(settingsOf('?fields=place,%20date%20,bogus,place').fields).toEqual(['place', 'date']);
    });

    it('turns every field off with "none" or an empty list, and leaves them alone when the parameter is absent', () => {
      stubStorage(null);
      expect(settingsOf('?fields=none').fields).toEqual([]);
      expect(settingsOf('?fields=').fields).toEqual([]);
      expect(settingsOf('?every=10').fields).toEqual(DEFAULT_SETTINGS.fields);
    });
  });
});

describe('readStored / writeStored', () => {
  it('is empty when nothing is stored', () => {
    stubStorage(null);
    expect(readStored()).toEqual({});
  });

  it('coerces what it finds, dropping bad entries', () => {
    stubStorage(
      JSON.stringify({ every: '45', fx: 'zoom', fit: 'contain', fields: 'place,exif', brief: 1, clock: 'maybe', size: 3, junk: true })
    );
    expect(readStored()).toEqual({ every: 45, fit: 'contain', fields: ['place', 'exif'], brief: true });
  });

  it('ignores damaged or unexpected content', () => {
    for (const raw of ['{not json', 'null', '5', '"text"', 'true', '']) {
      stubStorage(raw);
      expect(readStored(), raw).toEqual({});
    }
  });

  it('copes with storage that throws or is missing', () => {
    stubBlockedStorage();
    expect(readStored()).toEqual({});
    vi.unstubAllGlobals();
    expect(readStored()).toEqual({});
  });

  it('writes the settings as JSON under the settings key', () => {
    const setItem = stubStorage(null);
    writeStored({ ...DEFAULT_SETTINGS, every: 60 });
    expect(setItem).toHaveBeenCalledWith(STORE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, every: 60 }));
  });

  it('carries on when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('quota');
      }
    });
    expect(() => writeStored(DEFAULT_SETTINGS)).not.toThrow();
  });

  it('reads back what it wrote', () => {
    let saved = '';
    vi.stubGlobal('localStorage', { setItem: (_k: string, v: string) => (saved = v), getItem: () => saved });
    const settings: Settings = {
      every: 300,
      fx: 'cut',
      fit: 'contain',
      fields: ['place', 'coord', 'tags'],
      pos: 'bc',
      size: 's',
      brief: true,
      clock: true,
      awake: false,
      night: true
    };
    writeStored(settings);
    expect(readStored()).toEqual(settings);
  });
});

describe('buildQuery', () => {
  const all: Source = { src: 'all', tags: [], match: 'any', place: '', city: '', theme: '', user: '', order: 'shuffle' };

  it('writes every setting, so the link behaves the same on any device', () => {
    expect(buildQuery(all, DEFAULT_SETTINGS)).toBe(
      'src=all&order=shuffle&every=10&fx=drift&fit=cover&fields=place,date&pos=bl&size=m&brief=0&clock=0&awake=1&night=0'
    );
  });

  it('writes tags and match only for a tag source, encoding each tag', () => {
    const query = buildQuery({ ...all, src: 'tags', tags: ['a b', '湖', 'c&d'], match: 'all' }, DEFAULT_SETTINGS);
    expect(query).toContain('src=tags&tags=a%20b,%E6%B9%96,c%26d&match=all&');
    expect(buildQuery({ ...all, src: 'all', tags: ['a'], match: 'all' }, DEFAULT_SETTINGS)).not.toMatch(/tags=|match=/);
    expect(buildQuery({ ...all, src: 'tags', tags: [] }, DEFAULT_SETTINGS)).toContain('src=tags&match=any&');
  });

  it('writes place and theme only for their own sources', () => {
    expect(buildQuery({ ...all, src: 'place', place: 'poi_1' }, DEFAULT_SETTINGS)).toContain('src=place&place=poi_1&');
    expect(buildQuery({ ...all, src: 'theme', theme: 'th_1', order: 'time' }, DEFAULT_SETTINGS)).toContain(
      'src=theme&theme=th_1&order=time&'
    );
    expect(buildQuery({ ...all, src: 'all', place: 'poi_1', theme: 'th_1' }, DEFAULT_SETTINGS)).not.toMatch(/place=|theme=/);
  });

  it('adds city and user to every source but a theme, which plays its own photos', () => {
    expect(buildQuery({ ...all, src: 'city', city: '杭州', user: 'ada' }, DEFAULT_SETTINGS)).toContain('city=%E6%9D%AD%E5%B7%9E&user=ada&');
    expect(buildQuery({ ...all, src: 'theme', theme: 'th_1', city: '杭州', user: 'ada' }, DEFAULT_SETTINGS)).not.toMatch(/city=|user=/);
  });

  it('writes "none" when no field is shown', () => {
    expect(buildQuery(all, { ...DEFAULT_SETTINGS, fields: [] })).toContain('fields=none&');
  });

  describe('read back by readInitial', () => {
    const sources: Source[] = [
      all,
      { ...all, src: 'today' },
      { ...all, src: 'tags', tags: ['lake', '夕阳', 'a b'], match: 'all', city: '杭州', user: 'ada' },
      { ...all, src: 'tags', tags: ['lake'], match: 'any', order: 'time' },
      { ...all, src: 'place', place: 'poi_01HZ', order: 'time' },
      { ...all, src: 'city', city: '杭州市', user: 'ada' },
      { ...all, src: 'theme', theme: 'th_01HZ', order: 'time' },
      { ...all, src: 'theme', theme: 'th_01HZ', order: 'shuffle' }
    ];
    const settings: Settings[] = [
      DEFAULT_SETTINGS,
      { every: 900, fx: 'cut', fit: 'contain', fields: [], pos: 'br', size: 'l', brief: true, clock: true, awake: false, night: true },
      {
        every: 5,
        fx: 'fade',
        fit: 'cover',
        fields: ['place', 'title', 'city', 'date', 'time', 'ago', 'coord', 'heading', 'exif', 'tags'],
        pos: 'bc',
        size: 's',
        brief: false,
        clock: false,
        awake: true,
        night: false
      }
    ];

    it('gives back exactly the configuration it was built from', () => {
      stubStorage(null);
      for (const source of sources) {
        for (const s of settings) {
          const initial = readInitial(`?${buildQuery(source, s)}`);
          expect(initial.source, JSON.stringify(source)).toEqual(source);
          expect(initial.settings, JSON.stringify(s)).toEqual(s);
        }
      }
    });

    it('does not depend on what the opening device remembers', () => {
      stubStorage(JSON.stringify({ every: 5, fx: 'cut', fields: ['exif'], night: true }));
      const s = { ...DEFAULT_SETTINGS };
      expect(readInitial(`?${buildQuery(all, s)}`).settings).toEqual(s);
    });
  });
});
