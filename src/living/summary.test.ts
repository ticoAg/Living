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
  user: '',
  order: 'shuffle',
  ...over
});
const names: SourceNames = {
  place: (id) => (id === 'poi_1' ? '断桥' : undefined),
  themeTitle: '西湖三日',
  tag: (id) => ({ lake: '湖', fog: '雾' })[id]
};
const none: SourceNames = { place: () => undefined, themeTitle: '', tag: () => undefined };

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
    expect(sourceName(source({ src: 'theme', theme: 'th_1' }), none)).toBe('主题');
    expect(sourceName(source({ src: 'tags', tags: ['secret'] }), names)).toBe('标签');
    expect(sourceName(source({ src: 'tags', tags: ['secret', 'lake'] }), names)).toBe('湖');
    expect(sourceName(source({ src: 'tags' }), names)).toBe('全部');
  });
  it('adds city and user, except for a theme', () => {
    expect(sourceName(source({ src: 'tags', tags: ['lake'], city: '杭州市', user: 'song' }), names)).toBe('湖 · 杭州市 · @song');
    expect(sourceName(source({ src: 'city', city: '杭州市' }), names)).toBe('杭州市');
    expect(sourceName(source({ src: 'theme', theme: 'th_1', city: '杭州市', user: 'song' }), names)).toBe('西湖三日');
  });
});

describe('summaryLine', () => {
  it('says the order and count once ready', () => {
    expect(summaryLine(source(), names, 'ready', 29)).toBe('全部 · 随机 · 29 张');
    expect(summaryLine(source({ order: 'time' }), names, 'ready', 3)).toBe('全部 · 按时间 · 3 张');
    expect(summaryLine(source({ src: 'theme', theme: 'th_1', order: 'time' }), names, 'ready', 14)).toBe('西湖三日 · 按顺序 · 14 张');
  });
  it('shows loading and error states', () => {
    expect(summaryLine(source(), names, 'loading', 0)).toBe('全部 · 载入中');
    expect(summaryLine(source({ src: 'today' }), names, 'error', 0)).toBe('那年今日');
  });
});

describe('scopeSwitches', () => {
  it('offers only what the link opened with', () => {
    expect(scopeSwitches({ place: '', theme: '', city: '', user: '' }, source(), names)).toEqual([]);
  });
  it('switches a place off to everything and back', () => {
    const opened = { place: 'poi_1', theme: '', city: '', user: '' };
    expect(scopeSwitches(opened, source({ src: 'place', place: 'poi_1' }), names)).toEqual([
      { key: 'place', label: '地点 · 断桥', on: true, patch: { src: 'all' } }
    ]);
    expect(scopeSwitches(opened, source(), none)).toEqual([
      { key: 'place', label: '地点 · 指定地点', on: false, patch: { src: 'place', place: 'poi_1' } }
    ]);
  });
  it('switches a theme with its order', () => {
    const opened = { place: '', theme: 'th_1', city: '', user: '' };
    expect(scopeSwitches(opened, source({ src: 'theme', theme: 'th_1' }), names)[0]).toMatchObject({
      label: '主题 · 西湖三日',
      on: true,
      patch: { src: 'all', order: 'shuffle' }
    });
    expect(scopeSwitches(opened, source(), none)[0]).toMatchObject({
      label: '主题 · 指定主题',
      on: false,
      patch: { src: 'theme', theme: 'th_1', order: 'time' }
    });
  });
  it('clears a city, leaving a city source for everything', () => {
    const opened = { place: '', theme: '', city: '杭州市', user: '' };
    expect(scopeSwitches(opened, source({ src: 'city', city: '杭州市' }), names)[0].patch).toEqual({ city: '', src: 'all' });
    expect(scopeSwitches(opened, source({ src: 'tags', city: '杭州市' }), names)[0].patch).toEqual({ city: '' });
    expect(scopeSwitches(opened, source(), names)[0]).toMatchObject({ on: false, patch: { city: '杭州市' } });
  });
  it('toggles the user filter, listing the switches in a fixed order', () => {
    const opened = { place: 'poi_1', theme: '', city: '杭州市', user: 'song' };
    const list = scopeSwitches(opened, source({ user: 'song' }), names);
    expect(list.map((s) => s.key)).toEqual(['place', 'city', 'user']);
    expect(list[2]).toEqual({ key: 'user', label: '仅 @song', on: true, patch: { user: '' } });
    expect(scopeSwitches(opened, source(), names)[2].patch).toEqual({ user: 'song' });
  });
});
