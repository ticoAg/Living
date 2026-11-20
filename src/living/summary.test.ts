import { describe, expect, it } from 'vite-plus/test';
import type { Source } from './settings';
import { scopeSwitches, sourceName, summaryLine, type SourceNames } from './summary';

const source = (over: Partial<Source> = {}): Source => ({
  src: 'all',
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
const names: SourceNames = {
  place: (id) => (id === 'poi_1' ? '断桥' : undefined),
  themeTitle: '西湖三日',
  entryTitle: '湖边的早晨',
  tag: (id) => ({ lake: '湖', fog: '雾' })[id]
};
const none: SourceNames = { place: () => undefined, themeTitle: '', entryTitle: '', tag: () => undefined };

describe('sourceName', () => {
  it('names each kind of source', () => {
    expect(sourceName(source(), names)).toBe('全部');
    expect(sourceName(source({ src: 'place', place: 'poi_1' }), names)).toBe('断桥');
    expect(sourceName(source({ src: 'theme', theme: 'th_1' }), names)).toBe('西湖三日');
    expect(sourceName(source({ src: 'today' }), names)).toBe('那年今日');
    expect(sourceName(source({ src: 'tags', tags: ['lake', 'fog'] }), names)).toBe('湖 · 雾');
  });
  it('falls back to generic words, never raw ids', () => {
    expect(sourceName(source({ src: 'place', place: 'poi_9' }), none)).toBe('地点');
    expect(sourceName(source({ src: 'theme', theme: 'th_1' }), none)).toBe('合集');
    expect(sourceName(source({ src: 'tags', tags: ['secret'] }), names)).toBe('标签');
    expect(sourceName(source({ src: 'tags', tags: ['secret', 'lake'] }), names)).toBe('湖');
    expect(sourceName(source({ src: 'tags' }), names)).toBe('全部');
  });
  it('adds city and user, except for a theme', () => {
    expect(sourceName(source({ src: 'tags', tags: ['lake'], city: '杭州市', user: 'song' }), names)).toBe('湖 · 杭州市 · @song');
    expect(sourceName(source({ src: 'city', city: '杭州市' }), names)).toBe('杭州市');
    expect(sourceName(source({ src: 'theme', theme: 'th_1', city: '杭州市', user: 'song' }), names)).toBe('西湖三日');
  });
  it('names an entry by its name once loaded, and entries by their types', () => {
    expect(sourceName(source({ src: 'entry', entry: 'en_1' }), names)).toBe('湖边的早晨');
    expect(sourceName(source({ src: 'entry', entry: 'en_1' }), none)).toBe('记录');
    expect(sourceName(source({ src: 'entries' }), names)).toBe('记录');
    expect(sourceName(source({ src: 'entries', types: ['practice', 'creation'], user: 'ada' }), names)).toBe('练习、创作 · @ada');
    // one entry is the entry, whatever city or user the link also says
    expect(sourceName(source({ src: 'entry', entry: 'en_1', city: '杭州', user: 'ada' }), names)).toBe('湖边的早晨');
  });
});

describe('summaryLine', () => {
  it('says the order and count once ready', () => {
    expect(summaryLine(source(), names, 'ready', 29)).toBe('全部 · 随机 · 29 张');
    expect(summaryLine(source({ order: 'time' }), names, 'ready', 3)).toBe('全部 · 按时间 · 3 张');
    expect(summaryLine(source({ src: 'theme', theme: 'th_1', order: 'time' }), names, 'ready', 14)).toBe('西湖三日 · 按顺序 · 14 张');
    expect(summaryLine(source({ src: 'entry', entry: 'en_1', order: 'time' }), names, 'ready', 4)).toBe('湖边的早晨 · 按顺序 · 4 张');
    expect(summaryLine(source({ src: 'entries', order: 'time' }), names, 'ready', 9)).toBe('记录 · 按时间 · 9 张');
  });
  it('shows loading and error states', () => {
    expect(summaryLine(source(), names, 'loading', 0)).toBe('全部 · 载入中');
    expect(summaryLine(source({ src: 'today' }), names, 'error', 0)).toBe('那年今日');
  });
});

describe('scopeSwitches', () => {
  it('offers only what the link opened with', () => {
    expect(scopeSwitches({ place: '', theme: '', entry: '', types: [], city: '', user: '' }, source(), names)).toEqual([]);
  });
  it('switches a place off to everything and back', () => {
    const opened = { place: 'poi_1', theme: '', entry: '', types: [], city: '', user: '' };
    expect(scopeSwitches(opened, source({ src: 'place', place: 'poi_1' }), names)).toEqual([
      { key: 'place', label: '地点 · 断桥', on: true, patch: { src: 'all' } }
    ]);
    expect(scopeSwitches(opened, source(), none)).toEqual([
      { key: 'place', label: '地点 · 指定地点', on: false, patch: { src: 'place', place: 'poi_1' } }
    ]);
  });
  it('switches a theme with its order', () => {
    const opened = { place: '', theme: 'th_1', entry: '', types: [], city: '', user: '' };
    expect(scopeSwitches(opened, source({ src: 'theme', theme: 'th_1' }), names)[0]).toMatchObject({
      label: '合集 · 西湖三日',
      on: true,
      patch: { src: 'all', order: 'shuffle' }
    });
    expect(scopeSwitches(opened, source(), none)[0]).toMatchObject({
      label: '合集 · 指定合集',
      on: false,
      patch: { src: 'theme', theme: 'th_1', order: 'time' }
    });
  });
  it('clears a city, leaving a city source for everything', () => {
    const opened = { place: '', theme: '', entry: '', types: [], city: '杭州市', user: '' };
    expect(scopeSwitches(opened, source({ src: 'city', city: '杭州市' }), names)[0].patch).toEqual({ city: '', src: 'all' });
    expect(scopeSwitches(opened, source({ src: 'tags', city: '杭州市' }), names)[0].patch).toEqual({ city: '' });
    expect(scopeSwitches(opened, source(), names)[0]).toMatchObject({ on: false, patch: { city: '杭州市' } });
  });
  it('switches an entry with its order, and entry types back to every type', () => {
    const one = { place: '', theme: '', entry: 'en_1', types: [], city: '', user: '' };
    expect(scopeSwitches(one, source({ src: 'entry', entry: 'en_1', order: 'time' }), names)).toEqual([
      { key: 'entry', label: '记录 · 湖边的早晨', on: true, patch: { src: 'all', order: 'shuffle' } }
    ]);
    expect(scopeSwitches(one, source(), none)[0]).toMatchObject({
      label: '记录 · 指定记录',
      on: false,
      patch: { src: 'entry', entry: 'en_1', order: 'time' }
    });
    const typed = { place: '', theme: '', entry: '', types: ['practice' as const], city: '', user: '' };
    expect(scopeSwitches(typed, source({ src: 'entries', types: ['practice'] }), names)).toEqual([
      { key: 'types', label: '类型 · 练习', on: true, patch: { types: [] } }
    ]);
    // off while every type plays, or while something else does
    expect(scopeSwitches(typed, source({ src: 'entries' }), names)[0]).toMatchObject({
      on: false,
      patch: { src: 'entries', types: ['practice'] }
    });
    expect(scopeSwitches(typed, source({ types: ['practice'] }), names)[0].on).toBe(false);
  });
  it('toggles the user filter, listing the switches in a fixed order', () => {
    const opened = { place: 'poi_1', theme: '', entry: '', types: [], city: '杭州市', user: 'song' };
    const list = scopeSwitches(opened, source({ user: 'song' }), names);
    expect(list.map((s) => s.key)).toEqual(['place', 'city', 'user']);
    expect(list[2]).toEqual({ key: 'user', label: '仅 @song', on: true, patch: { user: '' } });
    expect(scopeSwitches(opened, source(), names)[2].patch).toEqual({ user: 'song' });
  });
});
