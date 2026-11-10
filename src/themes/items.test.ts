import { describe, expect, it } from 'vite-plus/test';
import { photo } from '../test-utils';
import { dayItem, emptyDraft, photoItem, textItem, type Draft, type DraftItem } from './draft';
import { coverChoices, dropEmptyText, insertAfter, insertPhotos, moveItem, removeItem, suggestDay, swapItem } from './items';

const shape = (items: readonly DraftItem[]) =>
  items.map((it) => (it.kind === 'photo' ? `photo:${it.photoId}` : it.kind === 'day' ? `day:${it.day}` : `text:${it.text}`));
const text = (t: string): DraftItem => ({ ...textItem(), text: t }) as DraftItem;
const list = () => [photoItem(photo('a')), text('x'), dayItem('2026-05-01'), photoItem(photo('b'))];

describe('suggestDay', () => {
  it('is the day after the last dated section before the position', () => {
    const items = [dayItem('2026-05-01'), photoItem(photo('a')), dayItem('2026-05-31'), text('x')];
    expect(suggestDay(items, 4, '2026-04-01')).toBe('2026-06-01');
    expect(suggestDay(items, 2, '2026-04-01')).toBe('2026-05-02');
  });
  it('falls back to the start date, also past undated sections', () => {
    expect(suggestDay([dayItem(''), text('x')], 2, '2026-04-01')).toBe('2026-04-01');
    expect(suggestDay([], 0, '')).toBe('');
  });
  it('treats an index past the end as the end', () => {
    expect(suggestDay([dayItem('2026-12-31')], 9, '')).toBe('2027-01-01');
  });
});

describe('moveItem', () => {
  it('puts the dragged item before or after the target', () => {
    const items = list();
    const [a, x, day, b] = items.map((it) => it.key);
    expect(shape(moveItem(items, b, a, 'before'))).toEqual(['photo:b', 'photo:a', 'text:x', 'day:2026-05-01']);
    expect(shape(moveItem(items, a, day, 'after'))).toEqual(['text:x', 'day:2026-05-01', 'photo:a', 'photo:b']);
    expect(shape(moveItem(items, a, x, 'before'))).toEqual(shape(items));
  });
  it('returns the same list for a drop on itself or unknown keys', () => {
    const items = list();
    expect(moveItem(items, items[1].key, items[1].key, 'after')).toBe(items);
    expect(moveItem(items, 'nope', items[0].key, 'after')).toBe(items);
    expect(moveItem(items, items[0].key, 'nope', 'after')).toBe(items);
  });
});

describe('swapItem', () => {
  it('swaps with the neighbour above or below', () => {
    const items = list();
    expect(shape(swapItem(items, items[1].key, -1))).toEqual(['text:x', 'photo:a', 'day:2026-05-01', 'photo:b']);
    expect(shape(swapItem(items, items[1].key, 1))).toEqual(['photo:a', 'day:2026-05-01', 'text:x', 'photo:b']);
  });
  it('returns the same list at either end or for an unknown key', () => {
    const items = list();
    expect(swapItem(items, items[0].key, -1)).toBe(items);
    expect(swapItem(items, items[3].key, 1)).toBe(items);
    expect(swapItem(items, 'nope', 1)).toBe(items);
  });
});

describe('removeItem', () => {
  const draft = (over: Partial<Draft>): Draft => ({ ...emptyDraft('trip'), ...over });
  it('keeps the cover while its photo is still in the theme', () => {
    const items = [photoItem(photo('a')), photoItem(photo('b')), photoItem(photo('a'))];
    expect(removeItem(draft({ items, coverPhotoId: 'a' }), items[0].key).coverPhotoId).toBe('a');
    expect(removeItem(draft({ items, coverPhotoId: 'b' }), items[1].key)).toMatchObject({ coverPhotoId: null });
  });
  it('drops the item', () => {
    const items = list();
    expect(shape(removeItem(draft({ items }), items[2].key).items)).toEqual(['photo:a', 'text:x', 'photo:b']);
  });
});

describe('insertAfter', () => {
  it('inserts right after the item, or first when the key is gone', () => {
    const items = list();
    expect(shape(insertAfter(items, items[0].key, text('new')))).toEqual(['photo:a', 'text:new', 'text:x', 'day:2026-05-01', 'photo:b']);
    expect(shape(insertAfter(items, 'nope', text('new')))[0]).toBe('text:new');
    expect(items).toHaveLength(4);
  });
});

describe('insertPhotos', () => {
  it('inserts after the item, or at the end without one', () => {
    const items = list();
    const fresh = [photoItem(photo('c')), photoItem(photo('d'))];
    expect(shape(insertPhotos(items, items[1].key, fresh))).toEqual([
      'photo:a',
      'text:x',
      'photo:c',
      'photo:d',
      'day:2026-05-01',
      'photo:b'
    ]);
    expect(shape(insertPhotos(items, null, fresh)).slice(-2)).toEqual(['photo:c', 'photo:d']);
    expect(shape(insertPhotos(items, 'nope', fresh)).slice(-2)).toEqual(['photo:c', 'photo:d']);
  });
});

describe('dropEmptyText', () => {
  it('removes blank text blocks and returns the draft untouched when there are none', () => {
    const d: Draft = { ...emptyDraft(), items: [text('  '), text('x'), dayItem('')] };
    expect(shape(dropEmptyText(d).items)).toEqual(['text:x', 'day:']);
    const clean: Draft = { ...emptyDraft(), items: [text('x')] };
    expect(dropEmptyText(clean)).toBe(clean);
  });
});

describe('coverChoices', () => {
  it('lists each available photo once, in order', () => {
    const gone: DraftItem = { ...photoItem(photo('z')), photo: null } as DraftItem;
    const items = [photoItem(photo('b')), text('x'), photoItem(photo('a')), photoItem(photo('b')), gone];
    expect(coverChoices(items).map((p) => p.id)).toEqual(['b', 'a']);
  });
  it('stops at 300', () => {
    const items = Array.from({ length: 320 }, (_, i) => photoItem(photo(`p${i}`)));
    expect(coverChoices(items)).toHaveLength(300);
  });
});
