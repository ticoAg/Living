import { describe, expect, it } from 'vite-plus/test';
import type { PhotoSummary } from '../../shared/types';
import { entry, entryDetail, photo } from '../test-utils';
import { entriesPath, entryName, missingPhotoIds, photosOfEntries, photosOfEntry, playableEntries } from './entries';
import type { Source } from './settings';

const source = (over: Partial<Source> = {}): Source => ({
  src: 'entries',
  tags: [],
  match: 'any',
  place: '',
  city: '',
  theme: '',
  entry: '',
  types: [],
  user: '',
  order: 'shuffle',
  ...over
});
const ids = (list: readonly PhotoSummary[]) => list.map((p) => p.id);

describe('entriesPath', () => {
  it('asks for everyone’s public entries, or one person’s, of the types given', () => {
    expect(entriesPath(source())).toBe('/api/entries');
    expect(entriesPath(source({ user: 'ada' }))).toBe('/api/entries?owner=ada');
    expect(entriesPath(source({ types: ['practice', 'creation'] }))).toBe('/api/entries?type=practice,creation');
    expect(entriesPath(source({ user: '林 芝', types: ['trip'] }))).toBe('/api/entries?owner=%E6%9E%97%20%E8%8A%9D&type=trip');
  });

  it('asks for nothing for another source', () => {
    expect(entriesPath(source({ src: 'all' }))).toBeNull();
    expect(entriesPath(source({ src: 'entry', entry: 'en_1' }))).toBeNull();
  });
});

describe('entryName', () => {
  it('is the title, else the start of the text, else the type', () => {
    expect(entryName({ title: '湖边', type: 'note' }, '正文')).toBe('湖边');
    expect(entryName({ title: null, type: 'note' }, '## 早上\n\n其余')).toBe('早上');
    expect(entryName({ title: '  ', type: 'practice' }, null)).toBe('练习');
  });
});

describe('playableEntries', () => {
  it('keeps the finished ones, in order', () => {
    const list = [entry('en_1'), entry('en_2', { status: 'draft' }), entry('en_3', { status: 'archived' }), entry('en_4')];
    expect(playableEntries(list).map((e) => e.id)).toEqual(['en_1', 'en_4']);
  });
});

describe('missingPhotoIds', () => {
  it('names the photos of the entries the list does not have, each once', () => {
    const listed = new Map([['ph_a', photo('ph_a')]]);
    const list = [entry('en_1', { photoIds: ['ph_a', 'ph_b'] }), entry('en_2', { photoIds: ['ph_b', 'ph_c'] })];
    expect(missingPhotoIds(list, listed)).toEqual(['ph_b', 'ph_c']);
    expect(missingPhotoIds([], listed)).toEqual([]);
  });
});

describe('photosOfEntry', () => {
  it('plays its photos in its order, each under its name', () => {
    const [a, b] = [photo('ph_a'), photo('ph_b')];
    const e = entryDetail('en_1', {
      title: '湖边的早晨',
      media: [
        { photoId: 'ph_b', caption: '桥', photo: b },
        { photoId: 'ph_a', caption: null, photo: a }
      ]
    });
    const play = photosOfEntry(e);
    expect(ids(play.photos)).toEqual(['ph_b', 'ph_a']);
    expect([...play.entryOf]).toEqual([
      ['ph_b', '湖边的早晨'],
      ['ph_a', '湖边的早晨']
    ]);
  });

  it('names an untitled one by its text', () => {
    const e = entryDetail('en_1', { title: null, body: '雾很大', media: [{ photoId: 'ph_a', caption: null, photo: photo('ph_a') }] });
    expect(photosOfEntry(e).entryOf.get('ph_a')).toBe('雾很大');
  });
});

describe('photosOfEntries', () => {
  const have = new Map(['ph_a', 'ph_b', 'ph_c', 'ph_d'].map((id) => [id, photo(id)]));
  const find = (id: string) => have.get(id);

  it('plays the newest entry’s photos first, in each entry’s order', () => {
    const list = [entry('en_2', { title: '后来', photoIds: ['ph_c', 'ph_a'] }), entry('en_1', { title: '起初', photoIds: ['ph_b'] })];
    const play = photosOfEntries(list, find);
    expect(ids(play.photos)).toEqual(['ph_c', 'ph_a', 'ph_b']);
    expect(play.entryOf.get('ph_a')).toBe('后来');
    expect(play.entryOf.get('ph_b')).toBe('起初');
  });

  it('plays a photo in several entries once, under the first', () => {
    const list = [entry('en_2', { title: '后来', photoIds: ['ph_a'] }), entry('en_1', { title: '起初', photoIds: ['ph_a', 'ph_d'] })];
    const play = photosOfEntries(list, find);
    expect(ids(play.photos)).toEqual(['ph_a', 'ph_d']);
    expect(play.entryOf.get('ph_a')).toBe('后来');
  });

  it('names an untitled entry by the start of its text, else by its type', () => {
    const list = [
      entry('en_2', { title: null, excerpt: '雾很大\n\n后来散了', photoIds: ['ph_a'] }),
      entry('en_1', { title: null, excerpt: '', type: 'practice', photoIds: ['ph_b'] })
    ];
    const play = photosOfEntries(list, find);
    expect(play.entryOf.get('ph_a')).toBe('雾很大');
    expect(play.entryOf.get('ph_b')).toBe('练习');
  });

  it('leaves out a photo it has not got, and an entry with none', () => {
    const list = [entry('en_1', { title: '一', photoIds: ['ph_x', 'ph_b'] }), entry('en_2', { title: '二', photoIds: [] })];
    const play = photosOfEntries(list, find);
    expect(ids(play.photos)).toEqual(['ph_b']);
    expect(play.entryOf.has('ph_x')).toBe(false);
    expect(photosOfEntries([], find)).toEqual({ photos: [], entryOf: new Map() });
  });
});
