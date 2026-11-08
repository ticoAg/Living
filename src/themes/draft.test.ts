import { describe, expect, it } from 'vite-plus/test';
import type { ThemeItem } from '../../shared/types';
import { photo, themeDetail } from '../test-utils';
import {
  MAX_ITEMS,
  byTaken,
  dayItem,
  draftFromTheme,
  emptyDraft,
  itemsPayload,
  mergeByDay,
  metaPayload,
  nextKey,
  photoDayRange,
  photoItem,
  textItem,
  validate,
  type Draft,
  type DraftItem
} from './draft';

const taken = (id: string, takenAt: string | null) => photo(id, { takenAt });
const draft = (over: Partial<Draft> = {}): Draft => ({ ...emptyDraft('trip'), title: '西湖三日', ...over });

/** An item reduced to what a test cares about, since keys are generated. */
const shape = (items: readonly DraftItem[]) =>
  items.map((it) => (it.kind === 'photo' ? `photo:${it.photoId}` : it.kind === 'day' ? `day:${it.day}` : `text:${it.text}`));

describe('keys', () => {
  it('are unique per item', () => {
    const keys = [nextKey(), nextKey(), photoItem(photo('a')).key, textItem().key, dayItem('2026-10-03').key];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('items', () => {
  it('start blank', () => {
    expect(photoItem(photo('a'))).toMatchObject({ kind: 'photo', photoId: 'a', text: '' });
    expect(textItem()).toMatchObject({ kind: 'text', text: '' });
    expect(dayItem()).toMatchObject({ kind: 'day', day: '', text: '' });
    expect(dayItem('2026-10-03')).toMatchObject({ day: '2026-10-03' });
  });
});

describe('emptyDraft', () => {
  it('starts as a private trip with nothing in it', () => {
    expect(emptyDraft()).toEqual({
      kind: 'trip',
      title: '',
      subtitle: '',
      intro: '',
      startDate: '',
      endDate: '',
      visibility: 'private',
      coverPhotoId: null,
      items: []
    });
    expect(emptyDraft('topic').kind).toBe('topic');
  });
});

describe('draftFromTheme', () => {
  it('turns a saved theme into editable strings', () => {
    const items: ThemeItem[] = [
      { id: 'it_1', kind: 'day', day: '2026-10-03T00:00:00', text: null },
      { id: 'it_2', kind: 'photo', photoId: 'ph_1', text: '登上断桥', photo: { ...photo('ph_1'), note: null } },
      { id: 'it_3', kind: 'text', text: '午后下起了雨' },
      { id: 'it_4', kind: 'photo', photoId: 'ph_gone', text: null, photo: null }
    ];
    const d = draftFromTheme(
      themeDetail({
        kind: 'trip',
        title: '西湖三日',
        subtitle: null,
        intro: null,
        startDate: '2026-10-03T00:00:00',
        endDate: null,
        visibility: 'unlisted',
        coverPhotoId: 'ph_1',
        items
      })
    );
    expect(d).toMatchObject({
      kind: 'trip',
      title: '西湖三日',
      subtitle: '',
      intro: '',
      startDate: '2026-10-03',
      endDate: '',
      visibility: 'unlisted',
      coverPhotoId: 'ph_1'
    });
    expect(shape(d.items)).toEqual(['day:2026-10-03', 'photo:ph_1', 'text:午后下起了雨', 'photo:ph_gone']);
    expect(d.items.map((it) => ('text' in it ? it.text : null))).toEqual(['', '登上断桥', '午后下起了雨', '']);
    // a photo the viewer cannot see stays in the draft, flagged by its missing photo
    expect(d.items[3]).toMatchObject({ kind: 'photo', photo: null });
    expect(new Set(d.items.map((it) => it.key)).size).toBe(4);
  });
});

describe('metaPayload', () => {
  it('trims the text fields and turns blanks into null', () => {
    const body = metaPayload(draft({ title: '  西湖三日  ', subtitle: '  ', intro: '\n\n' }));
    expect(body).toMatchObject({ title: '西湖三日', subtitle: null, intro: null });
  });

  it('trims the end of the intro but keeps its leading indentation and paragraphs', () => {
    expect(metaPayload(draft({ intro: '  第一段\n\n第二段  \n\n' })).intro).toBe('  第一段\n\n第二段');
  });

  it('keeps trip dates, and sends none for a topic', () => {
    const dates = { startDate: '2026-10-03', endDate: '2026-10-06' };
    expect(metaPayload(draft({ kind: 'trip', ...dates }))).toMatchObject({ startDate: '2026-10-03', endDate: '2026-10-06' });
    expect(metaPayload(draft({ kind: 'topic', ...dates }))).toMatchObject({ startDate: null, endDate: null });
    expect(metaPayload(draft({ kind: 'trip' }))).toMatchObject({ startDate: null, endDate: null });
  });

  it('passes kind, visibility and cover through', () => {
    expect(metaPayload(draft({ kind: 'topic', visibility: 'unlisted', coverPhotoId: 'ph_9' }))).toMatchObject({
      kind: 'topic',
      visibility: 'unlisted',
      coverPhotoId: 'ph_9'
    });
  });
});

describe('itemsPayload', () => {
  const withPhoto = (id: string, text = '') => ({ ...photoItem(photo(id)), text });

  it('sends photos, text and dated day sections in order', () => {
    const items: DraftItem[] = [{ ...dayItem('2026-10-03'), text: '第一天' }, withPhoto('a', '断桥'), { ...textItem(), text: '雨' }];
    expect(itemsPayload(items)).toEqual([
      { kind: 'day', day: '2026-10-03', text: '第一天' },
      { kind: 'photo', photoId: 'a', text: '断桥' },
      { kind: 'text', text: '雨' }
    ]);
  });

  it('leaves out empty text blocks, undated sections and photos that are gone', () => {
    const gone: DraftItem = { key: 'k', kind: 'photo', photoId: 'gone', text: '想写点什么', photo: null };
    const items: DraftItem[] = [textItem(), { ...textItem(), text: '   ' }, dayItem(), gone, withPhoto('a')];
    expect(itemsPayload(items)).toEqual([{ kind: 'photo', photoId: 'a', text: null }]);
  });

  it('sends blank captions as null and trims trailing space only', () => {
    const items: DraftItem[] = [withPhoto('a', '   '), withPhoto('b', ' 开头有空格  \n'), { ...dayItem('2026-10-03'), text: '  ' }];
    expect(itemsPayload(items)).toEqual([
      { kind: 'photo', photoId: 'a', text: null },
      { kind: 'photo', photoId: 'b', text: ' 开头有空格' },
      { kind: 'day', day: '2026-10-03', text: null }
    ]);
  });
});

describe('validate', () => {
  it('passes a complete draft', () => {
    expect(
      validate(draft({ startDate: '2026-10-03', endDate: '2026-10-06', items: [dayItem('2026-10-03'), photoItem(photo('a'))] }))
    ).toBeNull();
    expect(validate(draft())).toBeNull();
  });

  it('wants a title', () => {
    expect(validate(draft({ title: '' }))).toEqual({ text: '请填写标题', field: 'th-title' });
    expect(validate(draft({ title: '   ' }))).toEqual({ text: '请填写标题', field: 'th-title' });
  });

  it('rejects a trip that ends before it starts, but allows the same day', () => {
    expect(validate(draft({ startDate: '2026-10-06', endDate: '2026-10-03' }))).toEqual({
      text: '结束日期不能早于开始日期',
      field: 'th-end'
    });
    expect(validate(draft({ startDate: '2026-10-03', endDate: '2026-10-03' }))).toBeNull();
    expect(validate(draft({ startDate: '2026-10-03', endDate: '' }))).toBeNull();
    expect(validate(draft({ startDate: '', endDate: '2026-10-03' }))).toBeNull();
  });

  it('does not check dates on a topic, which sends none', () => {
    expect(validate(draft({ kind: 'topic', startDate: '2026-10-06', endDate: '2026-10-03' }))).toBeNull();
  });

  it('limits a theme to 1000 items that would actually be sent', () => {
    const photos = Array.from({ length: MAX_ITEMS }, (_, i) => photoItem(photo(`ph_${i}`)));
    expect(validate(draft({ items: photos }))).toBeNull();
    const tooMany = [...photos, photoItem(photo('one-more'))];
    expect(validate(draft({ items: tooMany }))).toEqual({ text: `一个主题最多 ${MAX_ITEMS} 个条目，请先移除一些`, field: 'th-add-photo' });
    // empty blocks are not sent, so they do not count against the limit
    expect(validate(draft({ items: [...photos, textItem(), textItem()] }))).toBeNull();
  });

  it('points at the first day section without a date, by its position', () => {
    const undated = dayItem();
    const result = validate(draft({ items: [photoItem(photo('a')), dayItem('2026-10-03'), undated, dayItem()] }));
    expect(result).toEqual({ text: '第 3 项是日期分段，请选择日期', field: `th-day-${undated.key}` });
  });

  it('reports the title before anything else', () => {
    expect(validate(draft({ title: '', startDate: '2026-10-06', endDate: '2026-10-03', items: [dayItem()] }))?.field).toBe('th-title');
    expect(validate(draft({ startDate: '2026-10-06', endDate: '2026-10-03', items: [dayItem()] }))?.field).toBe('th-end');
  });
});

describe('photoDayRange', () => {
  it('spans the earliest and latest capture day of the photos', () => {
    const items = [
      photoItem(taken('a', '2026-10-05T10:00:00')),
      textItem(),
      photoItem(taken('b', '2026-10-03T23:59:00')),
      photoItem(taken('c', '2026-10-04T00:00:00'))
    ];
    expect(photoDayRange(items)).toEqual({ start: '2026-10-03', end: '2026-10-05' });
  });

  it('is one day for a single photo, and ignores photos without a time or a photo', () => {
    expect(photoDayRange([photoItem(taken('a', '2026-10-05T10:00:00')), photoItem(taken('b', null))])).toEqual({
      start: '2026-10-05',
      end: '2026-10-05'
    });
    expect(photoDayRange([{ key: 'k', kind: 'photo', photoId: 'gone', text: '', photo: null }])).toBeNull();
  });

  it('is null without any dated photo', () => {
    expect(photoDayRange([])).toBeNull();
    expect(photoDayRange([textItem(), dayItem('2026-10-03'), photoItem(taken('a', null))])).toBeNull();
  });
});

describe('byTaken', () => {
  it('sorts oldest first, undated last, and equal times by id', () => {
    const list = [
      photo('d'),
      taken('c', '2026-01-02T00:00:00'),
      taken('b', '2026-01-01T00:00:00'),
      taken('a', '2026-01-01T00:00:00'),
      photo('c2')
    ];
    expect(list.sort(byTaken).map((p) => p.id)).toEqual(['a', 'b', 'c', 'c2', 'd']);
  });
});

describe('mergeByDay', () => {
  const day = (iso: string) => dayItem(iso);

  it('adds a day section ahead of the first photo of each new day, in date order', () => {
    const out = mergeByDay([], [taken('c', '2026-10-04T08:00:00'), taken('a', '2026-10-03T09:00:00'), taken('b', '2026-10-03T07:30:00')]);
    expect(shape(out)).toEqual(['day:2026-10-03', 'photo:b', 'photo:a', 'day:2026-10-04', 'photo:c']);
  });

  it('puts photos for a day that already has a section at the end of that section', () => {
    const existing = [
      day('2026-10-03'),
      photoItem(taken('x', '2026-10-03T08:00:00')),
      textItem(),
      day('2026-10-05'),
      photoItem(taken('y', '2026-10-05T08:00:00'))
    ];
    const out = mergeByDay(existing, [taken('new', '2026-10-03T20:00:00')]);
    expect(shape(out)).toEqual(['day:2026-10-03', 'photo:x', 'text:', 'photo:new', 'day:2026-10-05', 'photo:y']);
  });

  it('puts photos for the last section at the very end', () => {
    const out = mergeByDay([day('2026-10-03'), photoItem(taken('x', '2026-10-03T08:00:00'))], [taken('new', '2026-10-03T20:00:00')]);
    expect(shape(out)).toEqual(['day:2026-10-03', 'photo:x', 'photo:new']);
  });

  it('inserts a new day between existing sections', () => {
    const existing = [
      day('2026-10-03'),
      photoItem(taken('x', '2026-10-03T08:00:00')),
      day('2026-10-05'),
      photoItem(taken('y', '2026-10-05T08:00:00'))
    ];
    const out = mergeByDay(existing, [taken('new', '2026-10-04T12:00:00')]);
    expect(shape(out)).toEqual(['day:2026-10-03', 'photo:x', 'day:2026-10-04', 'photo:new', 'day:2026-10-05', 'photo:y']);
  });

  it('puts a day before all sections, or after all of them', () => {
    const existing = [day('2026-10-04'), photoItem(taken('x', '2026-10-04T08:00:00'))];
    expect(shape(mergeByDay(existing, [taken('early', '2026-10-01T12:00:00')]))).toEqual([
      'day:2026-10-01',
      'photo:early',
      'day:2026-10-04',
      'photo:x'
    ]);
    expect(shape(mergeByDay(existing, [taken('late', '2026-10-09T12:00:00')]))).toEqual([
      'day:2026-10-04',
      'photo:x',
      'day:2026-10-09',
      'photo:late'
    ]);
  });

  it('adds a section after loose items that come before any section', () => {
    const out = mergeByDay([textItem()], [taken('a', '2026-10-03T08:00:00')]);
    expect(shape(out)).toEqual(['text:', 'day:2026-10-03', 'photo:a']);
  });

  it('skips photos without a capture day', () => {
    const out = mergeByDay([], [taken('a', null), taken('b', '2026-10-03T08:00:00')]);
    expect(shape(out)).toEqual(['day:2026-10-03', 'photo:b']);
    expect(mergeByDay([], [taken('a', null)])).toEqual([]);
  });

  it('leaves the items it is given alone and returns a new list', () => {
    const existing = [day('2026-10-03')];
    const before = [...existing];
    const out = mergeByDay(existing, [taken('a', '2026-10-03T08:00:00')]);
    expect(existing).toEqual(before);
    expect(out).not.toBe(existing);
    expect(mergeByDay(existing, [])).toEqual(existing);
  });

  it('gives every new item its own key', () => {
    const out = mergeByDay([], [taken('a', '2026-10-03T08:00:00'), taken('b', '2026-10-04T08:00:00')]);
    expect(new Set(out.map((it) => it.key)).size).toBe(out.length);
  });
});
