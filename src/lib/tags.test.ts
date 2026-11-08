import { describe, expect, it } from 'vite-plus/test';
import type { Tag } from '../../shared/types';
import { buildTagTree, filterByTags, inclusiveCounts, isSwatch, swatchFill, type TagNode } from './tags';

const tag = (id: string, name: string, parentId: string | null = null, sort = 0, color: string | null = null): Tag => ({
  id,
  name,
  parentId,
  ownerId: null,
  color,
  sort,
  count: 0
});

// 题材 ─ 自然 ─ 湖, 山
//      └ 城市 ─ 街道
// 色调 ─ 红 (swatch), 黑白 (swatch)
const TAGS: Tag[] = [
  tag('subject', '题材', null, 1),
  tag('nature', '自然', 'subject', 1),
  tag('lake', '湖', 'nature', 1),
  tag('mountain', '山', 'nature', 2),
  tag('city', '城市', 'subject', 2),
  tag('street', '街道', 'city', 1),
  tag('tone', '色调', null, 2),
  tag('red', '红', 'tone', 1, '#C0392B'),
  tag('mono', '黑白', 'tone', 2, 'mono')
];

/** Depth-first outline: one `id` per line, indented by depth. */
function outline(nodes: TagNode[]): string[] {
  return nodes.flatMap((n) => [`${'  '.repeat(n.depth)}${n.id}`, ...outline(n.children)]);
}

const sorted = (ids: string[]) => [...ids].sort();

describe('buildTagTree', () => {
  it('nests tags under their parents with depths, ordered by sort', () => {
    const tree = buildTagTree(TAGS);
    expect(tree.roots.map((r) => r.id)).toEqual(['subject', 'tone']);
    expect(outline(tree.roots)).toEqual([
      'subject',
      '  nature',
      '    lake',
      '    mountain',
      '  city',
      '    street',
      'tone',
      '  red',
      '  mono'
    ]);
  });

  it('gives the same tree whatever order the tags arrive in', () => {
    const expected = outline(buildTagTree(TAGS).roots);
    expect(outline(buildTagTree([...TAGS].reverse()).roots)).toEqual(expected);
    const shuffled = [3, 7, 0, 5, 8, 1, 6, 2, 4].map((i) => TAGS[i]);
    expect(outline(buildTagTree(shuffled).roots)).toEqual(expected);
  });

  it('orders siblings with the same sort by name, in Chinese collation', () => {
    // pinyin: 湖 (hú) before 山 (shān), although 山 has the smaller code point
    const tree = buildTagTree([tag('b', '山'), tag('a', '湖'), tag('r', '根', null, -1)]);
    expect(tree.roots.map((n) => n.id)).toEqual(['r', 'a', 'b']);
  });

  it('indexes every tag by id and keeps its fields', () => {
    const tree = buildTagTree(TAGS);
    expect(tree.byId.size).toBe(TAGS.length);
    const red = tree.byId.get('red');
    expect(red).toMatchObject({ id: 'red', name: '红', parentId: 'tone', color: '#C0392B', sort: 1, count: 0, depth: 1, children: [] });
    expect(tree.byId.get('subject')?.children.map((c) => c.id)).toEqual(['nature', 'city']);
    expect(tree.byId.get('street')?.depth).toBe(2);
  });

  it('does not modify the tags it is given', () => {
    const input = TAGS.map((t) => ({ ...t }));
    buildTagTree(input);
    expect(input).toEqual(TAGS);
    expect(input[0]).not.toHaveProperty('children');
    expect(input[0]).not.toHaveProperty('depth');
  });

  it('treats a tag whose parent is missing as a root', () => {
    const tree = buildTagTree([tag('a', 'A', 'gone'), tag('b', 'B', 'a')]);
    expect(tree.roots.map((n) => n.id)).toEqual(['a']);
    expect(tree.byId.get('b')?.depth).toBe(1);
  });

  it('handles an empty list', () => {
    const tree = buildTagTree([]);
    expect(tree.roots).toEqual([]);
    expect(tree.byId.size).toBe(0);
    expect(tree.expand(['x']).size).toBe(0);
  });
});

describe('ancestors / descendants / path', () => {
  const tree = buildTagTree(TAGS);

  it('lists ancestors from the root down to the parent', () => {
    expect(tree.ancestors('lake')).toEqual(['subject', 'nature']);
    expect(tree.ancestors('nature')).toEqual(['subject']);
    expect(tree.ancestors('subject')).toEqual([]);
    expect(tree.ancestors('mono')).toEqual(['tone']);
  });

  it('has no ancestors for an unknown id', () => {
    expect(tree.ancestors('nope')).toEqual([]);
  });

  it('lists every descendant at any depth, but not the tag itself', () => {
    expect(sorted(tree.descendants('subject'))).toEqual(['city', 'lake', 'mountain', 'nature', 'street']);
    expect(sorted(tree.descendants('nature'))).toEqual(['lake', 'mountain']);
    expect(tree.descendants('lake')).toEqual([]);
    expect(tree.descendants('nope')).toEqual([]);
  });

  it('builds the display path from names', () => {
    expect(tree.path('lake')).toEqual(['题材', '自然', '湖']);
    expect(tree.path('subject')).toEqual(['题材']);
    // an unknown id falls back to the id itself
    expect(tree.path('nope')).toEqual(['nope']);
  });

  it('survives corrupted parent links without looping', () => {
    const loop = buildTagTree([tag('a', 'A', 'b'), tag('b', 'B', 'a'), tag('c', 'C', 'c')]);
    expect(loop.roots).toEqual([]);
    expect(loop.ancestors('a')).toEqual(['b']);
    expect(loop.ancestors('c')).toEqual([]);
    expect(loop.path('a')).toEqual(['B', 'A']);
  });
});

describe('expand', () => {
  const tree = buildTagTree(TAGS);

  it('adds the ancestors of every direct tag', () => {
    expect(sorted([...tree.expand(['lake'])])).toEqual(['lake', 'nature', 'subject']);
    expect(sorted([...tree.expand(['lake', 'red'])])).toEqual(['lake', 'nature', 'red', 'subject', 'tone']);
  });

  it('does not add descendants or siblings', () => {
    const set = tree.expand(['nature']);
    expect(set.has('lake')).toBe(false);
    expect(set.has('city')).toBe(false);
    expect(sorted([...set])).toEqual(['nature', 'subject']);
  });

  it('ignores ids that are not in the tree and accepts an empty list', () => {
    expect(sorted([...tree.expand(['ghost', 'street'])])).toEqual(['city', 'street', 'subject']);
    expect(tree.expand([]).size).toBe(0);
  });
});

describe('filterByTags', () => {
  const tree = buildTagTree(TAGS);
  const photos = [
    { id: 'p1', tagIds: ['lake'] },
    { id: 'p2', tagIds: ['mountain', 'red'] },
    { id: 'p3', tagIds: ['street', 'mono'] },
    { id: 'p4', tagIds: ['nature'] },
    { id: 'p5', tagIds: [] },
    { id: 'p6', tagIds: ['lake', 'red'] },
    { id: 'p7', tagIds: ['deleted-tag'] }
  ];
  const ids = (items: { id: string }[]) => items.map((p) => p.id);

  it('returns a copy of everything when nothing is selected', () => {
    const out = filterByTags(photos, [], tree);
    expect(ids(out)).toEqual(ids(photos));
    expect(out).not.toBe(photos);
  });

  it('matches a tag directly', () => {
    expect(ids(filterByTags(photos, ['lake'], tree))).toEqual(['p1', 'p6']);
    expect(ids(filterByTags(photos, ['red'], tree))).toEqual(['p2', 'p6']);
  });

  it('lets a parent match everything tagged with its descendants', () => {
    expect(ids(filterByTags(photos, ['nature'], tree))).toEqual(['p1', 'p2', 'p4', 'p6']);
    expect(ids(filterByTags(photos, ['subject'], tree))).toEqual(['p1', 'p2', 'p3', 'p4', 'p6']);
    expect(ids(filterByTags(photos, ['tone'], tree))).toEqual(['p2', 'p3', 'p6']);
  });

  it('does not let a child match photos that only carry its parent', () => {
    expect(ids(filterByTags(photos, ['lake'], tree))).not.toContain('p4');
    expect(ids(filterByTags(photos, ['mountain'], tree))).toEqual(['p2']);
  });

  it('requires every selected tag (AND), each one also matching through descendants', () => {
    expect(ids(filterByTags(photos, ['lake', 'red'], tree))).toEqual(['p6']);
    expect(ids(filterByTags(photos, ['nature', 'red'], tree))).toEqual(['p2', 'p6']);
    expect(ids(filterByTags(photos, ['subject', 'tone'], tree))).toEqual(['p2', 'p3', 'p6']);
    expect(ids(filterByTags(photos, ['lake', 'mono'], tree))).toEqual([]);
    expect(ids(filterByTags(photos, ['nature', 'lake'], tree))).toEqual(['p1', 'p6']);
  });

  it('matches nothing for an unknown tag, and ignores unknown tags on a photo', () => {
    expect(filterByTags(photos, ['ghost'], tree)).toEqual([]);
    expect(ids(filterByTags(photos, ['subject'], tree))).not.toContain('p7');
  });

  it('keeps the original objects and their order', () => {
    const out = filterByTags(photos, ['nature'], tree);
    expect(out[0]).toBe(photos[0]);
    expect(out[1]).toBe(photos[1]);
  });
});

describe('inclusiveCounts', () => {
  const tree = buildTagTree(TAGS);

  it('counts a photo for its tag and every ancestor', () => {
    const counts = inclusiveCounts([{ tagIds: ['lake'] }, { tagIds: ['mountain'] }, { tagIds: ['street'] }], tree);
    expect(counts.get('lake')).toBe(1);
    expect(counts.get('mountain')).toBe(1);
    expect(counts.get('nature')).toBe(2);
    expect(counts.get('city')).toBe(1);
    expect(counts.get('subject')).toBe(3);
    expect(counts.has('tone')).toBe(false);
  });

  it('counts a photo once per tag even when it carries a tag and its descendant', () => {
    const counts = inclusiveCounts([{ tagIds: ['lake', 'nature', 'mountain'] }], tree);
    expect(counts.get('nature')).toBe(1);
    expect(counts.get('subject')).toBe(1);
    expect(counts.get('lake')).toBe(1);
  });

  it('skips unknown tags and handles no photos at all', () => {
    expect(inclusiveCounts([], tree).size).toBe(0);
    const counts = inclusiveCounts([{ tagIds: ['ghost'] }, { tagIds: [] }], tree);
    expect(counts.size).toBe(0);
  });

  it('agrees with filterByTags for every tag', () => {
    const photos = [
      { id: 'a', tagIds: ['lake', 'red'] },
      { id: 'b', tagIds: ['mountain'] },
      { id: 'c', tagIds: ['street', 'mono'] },
      { id: 'd', tagIds: ['nature', 'lake'] }
    ];
    const counts = inclusiveCounts(photos, tree);
    for (const id of tree.byId.keys()) {
      expect(counts.get(id) ?? 0, id).toBe(filterByTags(photos, [id], tree).length);
    }
  });
});

describe('swatches', () => {
  it('treats tags with a colour as swatches', () => {
    expect(isSwatch(tag('red', '红', 'tone', 1, '#C0392B'))).toBe(true);
    expect(isSwatch(tag('mono', '黑白', 'tone', 2, 'mono'))).toBe(true);
    expect(isSwatch(tag('lake', '湖'))).toBe(false);
    expect(isSwatch(tag('x', 'X', null, 0, ''))).toBe(false);
  });

  it('fills a swatch with its colour, a split gradient for mono, and nothing otherwise', () => {
    expect(swatchFill('#C0392B')).toBe('#C0392B');
    expect(swatchFill(null)).toBe('transparent');
    const mono = swatchFill('mono');
    expect(mono).toContain('linear-gradient(90deg');
    expect(mono).toContain('#1C201E 50%');
    expect(mono).toContain('#FAFAF8 50%');
  });
});
