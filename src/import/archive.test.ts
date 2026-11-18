import { describe, expect, it } from 'vite-plus/test';
import { FORMAT, FORMAT_VERSION, textFiles } from '../export/archive';
import { exportData, exportEntry, exportPhoto, exportPlace, exportProject, exportTheme, EXPORT_PROFILE } from '../test-utils';
import {
  ArchiveError,
  batches,
  byCreated,
  collectionRow,
  emptyMaps,
  entryRow,
  photoMeta,
  projectRow,
  readArchive,
  relinker,
  zoneRow,
  type ArchivePhoto,
  type IdMaps,
  type Resized
} from './archive';

const SITE = { name: 'Living', url: 'https://old.example' };
const NOW = new Date(2026, 10, 17, 9, 5);
const HERE = 'https://new.example';

/** An id as the site makes them: a prefix and 26 characters of Crockford base 32. */
const ulid = (prefix: string, n: number | string) => `${prefix}_${String(n).padStart(26, '0')}`;
const SHA = 'AB'.repeat(32);

const keep = (s: string | null) => s;

function maps(over: Partial<Record<keyof IdMaps, [string, string][]>> = {}): IdMaps {
  const m = emptyMaps();
  for (const [k, pairs] of Object.entries(over) as [keyof IdMaps, [string, string][]][]) for (const [a, b] of pairs) m[k].set(a, b);
  return m;
}

describe('readArchive', () => {
  it('reads back the living.json an export writes, every row as it is there', () => {
    const data = exportData({
      photos: [
        exportPhoto('ph_1', { sha256: SHA, title: '断桥' }),
        exportPhoto('ph_2', { uploadedAt: '2026-11-15T08:00:00Z' }),
        exportPhoto('ph_3')
      ],
      photoTags: [
        { photoId: 'ph_1', tagId: 't_1', source: 'manual' },
        { photoId: 'ph_1', tagId: 't_2', source: 'suggested' }
      ],
      entries: [exportEntry('en_1', { title: '西湖' })],
      entryMedia: [
        { entryId: 'en_1', photoId: 'ph_2', position: 1, caption: null },
        { entryId: 'en_1', photoId: 'ph_1', position: 0, caption: '湖边' }
      ],
      entryTags: [{ entryId: 'en_1', tagId: 't_1' }],
      entryProjects: [{ entryId: 'en_1', projectId: 'pj_1' }],
      projects: [exportProject('pj_1')],
      milestones: [
        {
          id: 'ms_1',
          projectId: 'pj_1',
          title: '第一首曲子',
          body: null,
          date: '2026-10-01',
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z'
        }
      ],
      themes: [exportTheme('th_1')],
      themeItems: [
        { id: 'it_2', themeId: 'th_1', position: 1, kind: 'entry', photoId: null, entryId: 'en_1', text: null, day: null },
        { id: 'it_1', themeId: 'th_1', position: 0, kind: 'day', photoId: null, entryId: null, text: '第一天', day: '2026-11-15' },
        { id: 'it_3', themeId: 'th_1', position: 2, kind: 'photo', photoId: 'ph_1', entryId: null, text: null, day: null }
      ],
      tags: [
        { id: 't_1', ownerId: EXPORT_PROFILE.id, parentId: null, name: '旅行', color: null, sort: 0, createdAt: '2026-01-01T00:00:00Z' },
        { id: 't_2', ownerId: null, parentId: null, name: '风景', color: null, sort: 0, createdAt: '2026-01-01T00:00:00Z' }
      ],
      places: [exportPlace('poi_1')],
      privacyZones: [{ id: 'pz_1', name: '家', lat: 30.2, lng: 120.1, radius: 300, createdAt: '2026-01-01T00:00:00Z' }],
      shareLinks: [
        { id: 'sl_1', kind: 'entry', itemId: 'en_1', createdAt: '2026-11-17T00:00:00Z', expiresAt: null },
        { id: 'sl_2', kind: 'project', itemId: 'pj_1', createdAt: '2026-11-17T00:00:00Z', expiresAt: null }
      ]
    });
    const files = new Map([
      ['ph_1', { path: 'media/2026/2026-11-16_ph_1.jpg' }],
      ['ph_2', { path: 'media/2026/2026-11-16_ph_2.webp', large: true }]
    ]);
    const json = textFiles(data, files, SITE, NOW).find((f) => f.path === 'living.json')?.text as string;
    const a = readArchive(json);

    expect(a.exportedAt).toBe(NOW.toISOString());
    expect(a.site).toEqual(SITE);
    expect(a.profile).toEqual({ id: EXPORT_PROFILE.id, handle: 'ada', displayName: 'Ada' });
    expect(a.photos.map((p) => [p.id, p.file, p.large, p.sha256, p.uploadedAt])).toEqual([
      ['ph_1', 'media/2026/2026-11-16_ph_1.jpg', false, SHA.toLowerCase(), '2026-11-16T08:00:00Z'],
      ['ph_2', 'media/2026/2026-11-16_ph_2.webp', true, null, '2026-11-15T08:00:00Z'],
      ['ph_3', null, false, null, '2026-11-16T08:00:00Z']
    ]);
    expect(a.photos[0].tags).toEqual([
      { id: 't_1', source: 'manual' },
      { id: 't_2', source: 'suggested' }
    ]);
    expect(a.photos[0].row.title).toBe('断桥');
    expect(a.entries).toHaveLength(1);
    expect(a.entries[0].media).toEqual([
      { photoId: 'ph_1', caption: '湖边' },
      { photoId: 'ph_2', caption: null }
    ]);
    expect(a.entries[0].tagIds).toEqual(['t_1']);
    expect(a.entries[0].projectIds).toEqual(['pj_1']);
    expect(a.entries[0].row.title).toBe('西湖');
    expect(a.projects.map((p) => p.milestones.map((m) => m.title))).toEqual([['第一首曲子']]);
    expect(a.collections[0].items.map((i) => i.kind)).toEqual(['day', 'entry', 'photo']);
    expect(a.tags.map((t) => t.name)).toEqual(['旅行', '风景']);
    expect(a.places.map((p) => p.id)).toEqual(['poi_1']);
    expect(a.zones.map(zoneRow)).toEqual([{ name: '家', lat: 30.2, lng: 120.1, radius: 300 }]);
    expect(a.shareLinks).toBe(2);
    expect(a.skipped).toBe(0);
  });

  it('will not read what is not an export it can work with', () => {
    expect(() => readArchive('{"format":')).toThrow(ArchiveError);
    expect(() => readArchive('{"format":')).toThrow('living.json 读不出来，文件可能不完整');
    expect(() => readArchive('[]')).toThrow('这个 living.json 不是 Living 的导出');
    expect(() => readArchive(JSON.stringify({ format: 'other', version: 1 }))).toThrow('这个 living.json 不是 Living 的导出');
    expect(() => readArchive(JSON.stringify({ format: FORMAT, version: FORMAT_VERSION + 1 }))).toThrow(
      '这份导出来自更新版本的 Living，这个站点还读不了'
    );
    expect(() => readArchive(JSON.stringify({ format: FORMAT }))).toThrow(ArchiveError);
  });

  it('leaves out rows without an id and counts them; reads what is missing as empty', () => {
    const a = readArchive(
      JSON.stringify({
        format: FORMAT,
        version: FORMAT_VERSION,
        photos: [{ id: 'ph_1', sha256: 'not a hash', tags: [{ id: 't_1' }, 'x'] }, { title: '没有编号' }, 'ph_2', { id: '有 空格' }],
        entries: [{ id: 'en_1', media: [{ photoId: 'ph_1' }, { caption: 'x' }], tagIds: ['t_1', 3, 'bad id'], projectIds: 'pj_1' }, null],
        privacyZones: [{ name: '家' }, 'x'],
        shareLinks: 'none'
      })
    );
    expect(a.photos.map((p) => p.id)).toEqual(['ph_1']);
    expect(a.photos[0]).toMatchObject({ file: null, large: false, sha256: null, uploadedAt: '', tags: [{ id: 't_1', source: 'manual' }] });
    expect(a.entries[0]).toMatchObject({ media: [{ photoId: 'ph_1', caption: null }], tagIds: ['t_1'], projectIds: [] });
    expect(a.skipped).toBe(4);
    expect(a.zones).toHaveLength(1);
    expect([a.projects, a.collections, a.tags, a.places]).toEqual([[], [], [], []]);
    expect([a.site, a.exportedAt, a.shareLinks]).toEqual([null, null, 0]);
    expect(a.profile).toEqual({ id: null, handle: null, displayName: null });
  });
});

describe('relinker', () => {
  const en1 = ulid('en', 1);
  const en2 = ulid('en', 2);
  const ph1 = ulid('ph', 1);
  const th1 = ulid('th', 1);

  it('gives the ids of items brought their ids here, by their prefix', () => {
    const m = maps({ entries: [[en1, ulid('en', 'H1')]], photos: [[ph1, ulid('ph', 'H1')]], collections: [[th1, ulid('th', 'H1')]] });
    const relink = relinker(m, SITE.url, HERE);
    expect(relink(`见 ${en1}、[照片](/photos/${ph1}) 和 /collections/${th1}`)).toBe(
      `见 ${ulid('en', 'H1')}、[照片](/photos/${ulid('ph', 'H1')}) 和 /collections/${ulid('th', 'H1')}`
    );
    // not brought, not an id of this site's, or part of a longer word: as written
    expect(relink(`${en2} en_${'I'.repeat(26)} x${en1} ${en1}0`)).toBe(`${en2} en_${'I'.repeat(26)} x${en1} ${en1}0`);
    // an id is looked up among its own kind only
    expect(relink(ulid('pj', 1))).toBe(ulid('pj', 1));
    expect(relink(null)).toBeNull();
    expect(relink('')).toBe('');
  });

  it("moves links to the old site's items here, and leaves its other pages and other sites alone", () => {
    const m = maps({ entries: [[en1, ulid('en', 'H1')]] });
    const relink = relinker(m, `${SITE.url}/some/page`, HERE);
    expect(relink(`[西湖](https://old.example/entries/${en1}) 和 <https://old.example/entries/${en1}?from=feed#top>`)).toBe(
      `[西湖](${HERE}/entries/${ulid('en', 'H1')}) 和 <${HERE}/entries/${ulid('en', 'H1')}?from=feed#top>`
    );
    expect(relink(`https://old.example/about 和 https://old.example/entries/${en2}`)).toBe(
      `https://old.example/about 和 https://old.example/entries/${en2}`
    );
    expect(relink(`https://other.example/entries/${en1}`)).toBe(`https://other.example/entries/${en1}`);
  });

  it("follows this site's own links, and leaves links to a site alone when the export names none it can read", () => {
    const m = maps({ entries: [[en1, ulid('en', 'H1')]] });
    expect(relinker(m, HERE, HERE)(`${HERE}/entries/${en1}`)).toBe(`${HERE}/entries/${ulid('en', 'H1')}`);
    expect(relinker(m, 'not a url', HERE)(`https://old.example/entries/${en1}`)).toBe(`https://old.example/entries/${en1}`);
    expect(relinker(m, null, HERE)(`见 ${en1}`)).toBe(`见 ${ulid('en', 'H1')}`);
  });

  it('reads the maps as they are when a text is relinked', () => {
    const m = maps();
    const relink = relinker(m, SITE.url, HERE);
    expect(relink(`https://old.example/entries/${en1}`)).toBe(`https://old.example/entries/${en1}`);
    m.entries.set(en1, ulid('en', 'H1'));
    expect(relink(`https://old.example/entries/${en1}`)).toBe(`${HERE}/entries/${ulid('en', 'H1')}`);
  });
});

const RESIZED: Resized = {
  width: 4032,
  height: 3024,
  variants: { s: { w: 480, h: 360 }, m: { w: 1600, h: 1200 }, l: { w: 2560, h: 1920 } },
  thumbhash: 'NEW-HASH',
  palette: ['#112233'],
  sha256: 'cd'.repeat(32)
};

function archivePhoto(row: Record<string, unknown>, tags: ArchivePhoto['tags'] = []): ArchivePhoto {
  return { id: 'ph_1', file: 'media/2026/a.jpg', large: false, sha256: null, uploadedAt: '', tags, row: { id: 'ph_1', ...row } };
}

describe('photoMeta', () => {
  it('says of the photo what living.json says, and of its file only what the file as resized here is', () => {
    const row = exportPhoto('ph_1', {
      title: `见 ${ulid('en', 1)}`,
      note: '湖边',
      takenAt: '2026-11-16T15:30:00',
      tz: '+08:00',
      lat: 30.25,
      lng: 120.15,
      alt: 10,
      heading: 90,
      geoPrivacy: 'fuzzy',
      province: '浙江',
      city: '杭州',
      district: '西湖区',
      poiId: 'poi_1',
      poiDistance: 42,
      poiMethod: 'auto',
      camera: 'X100V',
      lens: null,
      focal: 23,
      focal35: 35,
      aperture: 2,
      shutter: '1/250',
      iso: 160,
      thumbhash: 'OLD-HASH',
      palette: ['#000000'],
      sha256: 'ab'.repeat(32),
      focus: [0.3, 0.6],
      visibility: 'unlisted',
      inLiving: false,
      favorite: true
    });
    const m = maps({
      places: [['poi_1', 'poi_here']],
      tags: [
        ['t_1', 't_here1'],
        ['t_2', 't_here2']
      ],
      entries: [[ulid('en', 1), ulid('en', 'H1')]]
    });
    const meta = photoMeta(
      archivePhoto(row as unknown as Record<string, unknown>, [
        { id: 't_1', source: 'manual' },
        { id: 't_2', source: 'suggested' },
        { id: 't_gone', source: 'manual' }
      ]),
      RESIZED,
      m,
      relinker(m, SITE.url, HERE),
      false
    );
    expect(meta).toEqual({
      title: `见 ${ulid('en', 'H1')}`,
      note: '湖边',
      takenAt: '2026-11-16T15:30:00',
      tz: '+08:00',
      lat: 30.25,
      lng: 120.15,
      alt: 10,
      heading: 90,
      geoPrivacy: 'fuzzy',
      province: '浙江',
      city: '杭州',
      district: '西湖区',
      poiId: 'poi_here',
      poiDistance: 42,
      poiMethod: 'auto',
      camera: 'X100V',
      lens: null,
      focal: 23,
      focal35: 35,
      aperture: 2,
      shutter: '1/250',
      iso: 160,
      width: 4032,
      height: 3024,
      variantSizes: { s: [480, 360], m: [1600, 1200], l: [2560, 1920] },
      thumbhash: 'NEW-HASH',
      palette: ['#112233'],
      focus: [0.3, 0.6],
      visibility: 'unlisted',
      inLiving: false,
      favorite: true,
      sha256: 'cd'.repeat(32),
      tagIds: ['t_here1'],
      suggestedTagIds: ['t_here2']
    });
  });

  it('leaves out a place that did not come over, with how far and how it was found', () => {
    const meta = photoMeta(archivePhoto({ poiId: 'poi_1', poiDistance: 42, poiMethod: 'auto' }), RESIZED, maps(), keep, false);
    expect([meta.poiId, meta.poiDistance, meta.poiMethod]).toEqual([null, null, null]);
  });

  it('reads what is missing or odd in a row as nothing, and its visibility as the account default', () => {
    const meta = photoMeta(
      archivePhoto({ lat: 'north', geoPrivacy: 'secret', visibility: 'secret', focus: [1], favorite: 'yes' }),
      RESIZED,
      maps(),
      keep,
      false
    );
    expect(meta).toMatchObject({
      lat: null,
      title: null,
      takenAt: null,
      geoPrivacy: 'exact',
      focus: null,
      inLiving: true,
      favorite: false
    });
    expect(meta.visibility).toBeUndefined();
    expect(photoMeta(archivePhoto({ visibility: 'public' }), RESIZED, maps(), keep, true).visibility).toBe('private');
  });
});

describe('projectRow, entryRow, collectionRow', () => {
  const m = maps({
    photos: [['ph_1', 'ph_here1']],
    entries: [['en_1', 'en_here1']],
    projects: [['pj_1', 'pj_here1']],
    tags: [['t_1', 't_here1']],
    places: [['poi_1', 'poi_here1']]
  });

  it('sends a project and its milestones as they are, the text relinked', () => {
    const relink = (s: string | null) => (s === null ? null : `«${s}»`);
    const row = { ...exportProject('pj_1'), description: '说明', visibility: 'public' };
    const p = projectRow(
      {
        id: 'pj_1',
        row,
        milestones: [{ id: 'ms_1', title: '第一首', body: '弹完了', date: '2026-10-01', createdAt: 'c', updatedAt: 'u', extra: 1 }]
      },
      relink,
      false
    );
    expect(p).toEqual({
      id: 'pj_1',
      type: 'learning',
      title: '学吉他',
      description: '«说明»',
      startDate: '2026-09-01',
      endDate: null,
      status: 'active',
      visibility: 'public',
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      milestones: [{ title: '第一首', body: '«弹完了»', date: '2026-10-01', createdAt: 'c', updatedAt: 'u' }]
    });
    expect(projectRow({ id: 'pj_1', row, milestones: [] }, relink, true).visibility).toBe('private');
  });

  it('sends an entry with the photos, tags, projects and place that came over, their ids here', () => {
    const e = entryRow(
      {
        id: 'en_1',
        row: { ...exportEntry('en_1', { title: '西湖', poiId: 'poi_1', visibility: 'public' }) },
        media: [
          { photoId: 'ph_1', caption: '湖边' },
          { photoId: 'ph_gone', caption: null }
        ],
        tagIds: ['t_1', 't_gone'],
        projectIds: ['pj_gone', 'pj_1']
      },
      m,
      keep,
      false
    );
    expect(e).toEqual({
      id: 'en_1',
      type: 'note',
      title: '西湖',
      body: '今天',
      occurredAt: '2026-11-16T15:30:00',
      visibility: 'public',
      status: 'published',
      poiId: 'poi_here1',
      createdAt: '2026-11-16T08:00:00Z',
      updatedAt: '2026-11-16T08:00:00Z',
      media: [{ photoId: 'ph_here1', caption: '湖边' }],
      tagIds: ['t_here1'],
      projectIds: ['pj_here1']
    });
    expect('revision' in e).toBe(false);
    const gone = entryRow(
      { id: 'en_2', row: { ...exportEntry('en_2', { poiId: 'poi_gone' }) }, media: [], tagIds: [], projectIds: [] },
      m,
      keep,
      true
    );
    expect([gone.poiId, gone.visibility]).toEqual([null, 'private']);
  });

  it('sends a collection with the items whose photo or entry came over; empty text items and the cover that did not, left out', () => {
    const c = collectionRow(
      {
        id: 'th_1',
        row: { ...exportTheme('th_1', { coverPhotoId: 'ph_1', visibility: 'public', publishedAt: '2026-11-17T00:00:00Z' }) },
        items: [
          { kind: 'day', day: '2026-11-15', text: '第一天' },
          { kind: 'photo', photoId: 'ph_1', text: '断桥' },
          { kind: 'photo', photoId: 'ph_gone' },
          { kind: 'entry', entryId: 'en_1' },
          { kind: 'entry', entryId: 'en_gone' },
          { kind: 'text', text: '' },
          { kind: 'text', text: null },
          { kind: 'text', text: '晚上下雨了' },
          { kind: 'map', text: 'x' }
        ]
      },
      m,
      keep,
      false
    );
    expect(c).toMatchObject({
      id: 'th_1',
      kind: 'trip',
      title: '杭州',
      coverPhotoId: 'ph_here1',
      startDate: '2026-11-15',
      endDate: '2026-11-17',
      visibility: 'public',
      publishedAt: '2026-11-17T00:00:00Z'
    });
    expect(c.items).toEqual([
      { kind: 'day', photoId: null, entryId: null, text: '第一天', day: '2026-11-15' },
      { kind: 'photo', photoId: 'ph_here1', entryId: null, text: '断桥', day: null },
      { kind: 'entry', photoId: null, entryId: 'en_here1', text: null, day: null },
      { kind: 'text', photoId: null, entryId: null, text: '晚上下雨了', day: null },
      // a kind this site does not know goes as it is, for the Worker to say so
      { kind: 'map', text: 'x' }
    ]);
    const bare = collectionRow({ id: 'th_2', row: { ...exportTheme('th_2', { coverPhotoId: 'ph_gone' }) }, items: [] }, m, keep, true);
    expect([bare.coverPhotoId, bare.visibility, bare.items]).toEqual([null, 'private', []]);
  });
});

describe('batches', () => {
  it('cuts at a number of rows', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([1, 2], 2)).toEqual([[1, 2]]);
    expect(batches([], 2)).toEqual([]);
  });

  it('cuts at a number of bytes of JSON, a row bigger than that alone', () => {
    const small = { t: 'a'.repeat(30) };
    const big = { t: '湖'.repeat(100) };
    expect(batches([small, small, small], 100, 90)).toEqual([[small, small], [small]]);
    expect(batches([small, big, small, small], 100, 100)).toEqual([[small], [big], [small, small]]);
  });
});

describe('byCreated', () => {
  it('puts the oldest first, the same moment by id, an undated one before all', () => {
    const r = (id: string, createdAt?: string) => ({ id, row: createdAt === undefined ? {} : { createdAt } });
    const sorted = [r('b', '2026-02-01T00:00:00Z'), r('c', '2026-01-01T00:00:00Z'), r('a', '2026-02-01T00:00:00Z'), r('z')].sort(byCreated);
    expect(sorted.map((x) => x.id)).toEqual(['z', 'c', 'a', 'b']);
  });
});
