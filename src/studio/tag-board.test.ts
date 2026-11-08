import { describe, expect, it } from 'vite-plus/test';
import type { Tag } from '../../shared/types';
import { buildTagTree } from '../lib/tags';
import { boardRows, EXCLUSIVE, mergeTags, searchBoard, toggleTag, withTag } from './tag-board';

const tag = (id: string, name: string, parentId: string | null, sort = 0, over: Partial<Tag> = {}): Tag => ({
  id,
  name,
  parentId,
  ownerId: null,
  color: null,
  sort,
  count: 0,
  ...over
});

// a slice of the preset tree, plus someone's own 西湖 under 湖 and their own root 人物
const TREE = buildTagTree([
  tag('subject', '题材', null, 10),
  tag('nature', '自然', 'subject', 10),
  tag('lake', '湖', 'nature', 10),
  tag('mountain', '山', 'nature', 20),
  tag('t_xihu', '西湖', 'lake', 10, { ownerId: 'u_1' }),
  tag('life', '生活', 'subject', 40),
  tag('food', '美食', 'life', 20),
  tag('light', '光与天气', null, 20),
  tag('lighting', '光线', 'light', 10),
  tag('morning', '晨光', 'lighting', 10),
  tag('night', '夜', 'lighting', 50),
  tag('weather', '天气', 'light', 20),
  tag('fog', '雾', 'weather', 10),
  tag('rain', '雨', 'weather', 20),
  tag('season', '季节', null, 30),
  tag('spring', '春', 'season', 10),
  tag('autumn', '秋', 'season', 30),
  tag('tone', '色调', null, 40),
  tag('warm', '暖', 'tone', 10, { color: '#C9925E' }),
  tag('blue', '蓝', 'tone', 40, { color: '#4A7BA6' }),
  tag('t_people', '人物', null, 50, { ownerId: 'u_1' }),
  tag('t_kid', '孩子', 't_people', 10, { ownerId: 'u_1' })
]);

describe('EXCLUSIVE', () => {
  it('holds the preset seasons, lights and tones, each id once', () => {
    const all = EXCLUSIVE.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(EXCLUSIVE.map((s) => s.length)).toEqual([4, 5, 5]);
  });
});

describe('toggleTag and withTag', () => {
  it('adds a tag at the end, and takes it off again', () => {
    expect(toggleTag(['lake'], 'fog')).toEqual(['lake', 'fog']);
    expect(toggleTag(['lake', 'fog'], 'lake')).toEqual(['fog']);
  });

  it('keeps one season, one light and one tone', () => {
    expect(toggleTag(['lake', 'spring', 'fog'], 'autumn')).toEqual(['lake', 'fog', 'autumn']);
    expect(toggleTag(['morning'], 'night')).toEqual(['night']);
    expect(toggleTag(['warm', 'spring'], 'blue')).toEqual(['spring', 'blue']);
  });

  it('lets weather, subjects and people’s own tags combine', () => {
    expect(toggleTag(['fog'], 'rain')).toEqual(['fog', 'rain']);
    expect(toggleTag(['lake', 't_xihu'], 'mountain')).toEqual(['lake', 't_xihu', 'mountain']);
  });

  it('never repeats a tag', () => {
    expect(withTag(['lake', 'fog'], 'lake')).toEqual(['fog', 'lake']);
  });
});

describe('mergeTags', () => {
  it('adds the tags another photo does not have yet, keeping its own', () => {
    expect(mergeTags(['food'], ['lake', 'fog'])).toEqual(['food', 'lake', 'fog']);
    expect(mergeTags(['lake'], ['lake', 'fog'])).toEqual(['lake', 'fog']);
  });

  it('lets the applied season, light or tone replace the other photo’s', () => {
    expect(mergeTags(['spring', 'food', 'morning'], ['autumn', 'night'])).toEqual(['food', 'autumn', 'night']);
  });

  it('changes nothing with nothing to add', () => {
    expect(mergeTags(['spring'], [])).toEqual(['spring']);
  });
});

describe('boardRows', () => {
  const rows = boardRows(TREE);

  it('has a row per root, presets first, in tree order', () => {
    expect(rows.map((r) => r.root.name)).toEqual(['题材', '光与天气', '季节', '色调', '人物']);
  });

  it('lists every tag below the root, groups before their tags, deeper tags after their parent', () => {
    const subject = rows[0].items.map((i) => [i.node.name, i.level, i.group]);
    expect(subject).toEqual([
      ['自然', 1, true],
      ['湖', 2, true],
      ['西湖', 3, false],
      ['山', 2, false],
      ['生活', 1, true],
      ['美食', 2, false]
    ]);
    expect(rows[2].items.map((i) => [i.node.name, i.group])).toEqual([
      ['春', false],
      ['秋', false]
    ]);
  });
});

describe('searchBoard', () => {
  const rows = boardRows(TREE);

  it('keeps the matching tags as plain chips, and says when one is named exactly that', () => {
    const r = searchBoard(rows, '湖');
    expect(r.rows.map((row) => [row.root.name, row.items.map((i) => [i.node.name, i.group])])).toEqual([
      [
        '题材',
        [
          ['湖', false],
          ['西湖', false]
        ]
      ]
    ]);
    expect(r.exact).toBe(true);
    expect(searchBoard(rows, '西').exact).toBe(false);
  });

  it('keeps a whole row when its root matches', () => {
    const r = searchBoard(rows, '季节');
    expect(r.rows.map((row) => row.root.name)).toEqual(['季节']);
    expect(r.rows[0].items).toHaveLength(2);
    expect(r.exact).toBe(true);
  });

  it('ignores case and spaces, finds nothing for a new name, and shows everything for an empty query', () => {
    expect(searchBoard(rows, ' 孩 子 ').rows.map((row) => row.items.map((i) => i.node.name))).toEqual([['孩子']]);
    expect(searchBoard(rows, '咖啡')).toEqual({ rows: [], exact: false });
    expect(searchBoard(rows, '  ').rows).toHaveLength(5);
  });
});
