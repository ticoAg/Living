import { describe, expect, it } from 'vite-plus/test';
import { ENTRY_LIMITS } from '../../shared/limits';
import { entryDetail, photo } from '../test-utils';
import {
  addMedia,
  changedFields,
  draftFromEntry,
  draftProblem,
  emptyDraft,
  isEmptyDraft,
  moveMedia,
  occurredAtOf,
  parseBackup,
  payloadOf,
  type EntryDraft
} from './draft';

const at = new Date(2026, 10, 16, 8, 30, 15);

describe('emptyDraft', () => {
  it('is a private note of this moment', () => {
    const d = emptyDraft(at, '一句话');
    expect(d).toMatchObject({ type: 'note', body: '一句话', date: '2026-11-16', time: '08:30', visibility: 'private', media: [] });
    expect(occurredAtOf(d)).toBe('2026-11-16T08:30:15');
  });

  it('starts as a project asks: its kind of entry, in it', () => {
    const d = emptyDraft(at, '', { type: 'practice', projectIds: ['pj_1'] });
    expect(d).toMatchObject({ type: 'practice', projectIds: ['pj_1'], body: '' });
    expect(payloadOf(d).projectIds).toEqual(['pj_1']);
    expect(payloadOf({ ...d, projectIds: ['pj_2', 'pj_1'] }).projectIds).toEqual(['pj_1', 'pj_2']);
  });
});

describe('draftFromEntry', () => {
  it('reads a saved entry back into the form, and the same payload comes out', () => {
    const e = entryDetail('en_1', {
      type: 'reading',
      title: '长安的荔枝',
      body: '第一章',
      occurredAt: '2026-11-16T21:05:42',
      visibility: 'unlisted',
      media: [{ photoId: 'ph_a', caption: null, photo: photo('ph_a') }],
      tagIds: ['t_1'],
      projectIds: ['pj_1']
    });
    const d = draftFromEntry(e);
    expect(d).toMatchObject({ title: '长安的荔枝', date: '2026-11-16', time: '21:05', heldTime: '21:05:42' });
    expect(payloadOf(d)).toEqual({
      type: 'reading',
      title: '长安的荔枝',
      body: '第一章',
      occurredAt: '2026-11-16T21:05:42',
      visibility: 'unlisted',
      media: [{ photoId: 'ph_a', caption: null }],
      tagIds: ['t_1'],
      projectIds: ['pj_1']
    });
  });

  it('reads a day-only time as no time', () => {
    const d = draftFromEntry(entryDetail('en_1', { occurredAt: '2026-11-16', title: null, body: null }));
    expect(d).toMatchObject({ date: '2026-11-16', time: '', heldTime: '', title: '', body: '' });
    expect(occurredAtOf(d)).toBe('2026-11-16');
  });
});

describe('occurredAtOf', () => {
  const base: EntryDraft = emptyDraft(at);

  it('keeps the seconds while the minute stays, and drops them when it changes', () => {
    expect(occurredAtOf({ ...base, time: '08:30' })).toBe('2026-11-16T08:30:15');
    expect(occurredAtOf({ ...base, time: '08:31' })).toBe('2026-11-16T08:31:00');
    expect(occurredAtOf({ ...base, date: '2026-11-15' })).toBe('2026-11-15T08:30:15');
  });

  it('is the day alone without a time', () => {
    expect(occurredAtOf({ ...base, time: '' })).toBe('2026-11-16');
  });
});

describe('payloadOf', () => {
  it('sends blank fields as null and trims titles and captions, but not the text', () => {
    const d: EntryDraft = {
      ...emptyDraft(at),
      title: '  ',
      body: '\n  缩进的第一行\n',
      media: [{ photoId: 'ph_a', caption: ' 说明 ', photo: null }]
    };
    expect(payloadOf(d)).toMatchObject({ title: null, body: '\n  缩进的第一行\n', media: [{ photoId: 'ph_a', caption: '说明' }] });
    expect(payloadOf({ ...d, body: ' \n ' }).body).toBeNull();
  });
});

describe('changedFields', () => {
  it('names only what differs from what was sent', () => {
    const before = payloadOf(emptyDraft(at, '一'));
    const after = payloadOf({ ...emptyDraft(at, '一二'), tagIds: [] });
    expect(changedFields(after, before)).toEqual({ body: '一二' });
    expect(changedFields(before, before)).toEqual({});
  });

  it('sends everything when nothing was sent yet', () => {
    const p = payloadOf(emptyDraft(at, '一'));
    expect(changedFields(p, null)).toEqual(p);
  });

  it('notices a change of order among the photos', () => {
    const one = { photoId: 'a', caption: null };
    const two = { photoId: 'b', caption: null };
    const p = payloadOf(emptyDraft(at, '一'));
    expect(changedFields({ ...p, media: [two, one] }, { ...p, media: [one, two] })).toEqual({ media: [two, one] });
  });
});

describe('isEmptyDraft and draftProblem', () => {
  const d = emptyDraft(at);

  it('call a draft with no words and no photo empty', () => {
    expect(isEmptyDraft(d)).toBe(true);
    expect(isEmptyDraft({ ...d, body: '  \n' })).toBe(true);
    expect(isEmptyDraft({ ...d, title: '题' })).toBe(false);
    expect(isEmptyDraft({ ...d, media: [{ photoId: 'a', caption: '', photo: null }] })).toBe(false);
  });

  it('need a day, and a time if any in hours and minutes', () => {
    expect(draftProblem(d)).toBeNull();
    expect(draftProblem({ ...d, date: '' })).toBe('请填写日期');
    expect(draftProblem({ ...d, time: '8' })).toBe('时间格式应为 时:分');
  });

  it('hold the server’s limits, counted in characters', () => {
    expect(draftProblem({ ...d, title: '字'.repeat(ENTRY_LIMITS.titleMax) })).toBeNull();
    expect(draftProblem({ ...d, title: '字'.repeat(ENTRY_LIMITS.titleMax + 1) })).toBe(`标题最多 ${ENTRY_LIMITS.titleMax} 个字符`);
    expect(draftProblem({ ...d, body: '😀'.repeat(ENTRY_LIMITS.bodyMax + 1) })).toBe(`正文最多 ${ENTRY_LIMITS.bodyMax} 个字符`);
    expect(draftProblem({ ...d, media: [{ photoId: 'a', caption: '字'.repeat(ENTRY_LIMITS.captionMax + 1), photo: null }] })).toBe(
      `第 1 张照片的说明最多 ${ENTRY_LIMITS.captionMax} 个字符`
    );
  });
});

describe('addMedia and moveMedia', () => {
  const m = (id: string) => ({ photoId: id, caption: '', photo: null });

  it('adds new photos at the end, in the order picked', () => {
    const out = addMedia([m('a')], [photo('b'), photo('a'), photo('c'), photo('b')]);
    expect(out.map((x) => x.photoId)).toEqual(['a', 'b', 'c']);
    expect(out[1].photo?.id).toBe('b');
  });

  it('moves a photo within the list', () => {
    const list = [m('a'), m('b'), m('c')];
    expect(moveMedia(list, 0, 1).map((x) => x.photoId)).toEqual(['b', 'a', 'c']);
    expect(moveMedia(list, 2, -1).map((x) => x.photoId)).toEqual(['a', 'c', 'b']);
    expect(moveMedia(list, 0, -1).map((x) => x.photoId)).toEqual(['a', 'b', 'c']);
    expect(moveMedia(list, 2, 5).map((x) => x.photoId)).toEqual(['a', 'b', 'c']);
  });
});

describe('parseBackup', () => {
  const draft = { ...emptyDraft(at, '未保存的一段'), media: [{ photoId: 'ph_a', caption: '说明', photo: photo('ph_a') }] };

  it('reads back what was stored', () => {
    const raw = JSON.stringify({ draft, at: '2026-11-16T00:30:00.000Z' });
    expect(parseBackup(raw)).toEqual({ draft, at: '2026-11-16T00:30:00.000Z' });
  });

  it('refuses what is not a backup', () => {
    for (const raw of [null, '', '{', '[]', '{"draft":{}}', JSON.stringify({ draft: { ...draft, type: 'diary' }, at: 'x' })]) {
      expect(parseBackup(raw)).toBeNull();
    }
    expect(parseBackup(JSON.stringify({ draft: { ...draft, media: [{ photoId: 1 }] }, at: 'x' }))).toBeNull();
    expect(parseBackup(JSON.stringify({ draft: { ...draft, tagIds: [1] }, at: 'x' }))).toBeNull();
    expect(parseBackup(JSON.stringify({ draft: { ...draft, projectIds: 'pj_1' }, at: 'x' }))).toBeNull();
  });

  it('reads a copy kept before entries had projects as in none', () => {
    const { projectIds: _gone, ...older } = draft;
    expect(parseBackup(JSON.stringify({ draft: older, at: 'x' }))?.draft.projectIds).toEqual([]);
  });
});
