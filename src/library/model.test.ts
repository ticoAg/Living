import { describe, expect, it } from 'vite-plus/test';
import { ATTACHMENT_LIMITS, ENTRY_LIMITS } from '../../shared/limits';
import type { LibraryAttachment } from '../../shared/types';
import { attachment, photo } from '../test-utils';
import { asAttachment, attachmentsShown, entryStart, kindParam, photosShown, purgeText, selectable, showParam } from './model';

const file = (id: string, over: Partial<LibraryAttachment> = {}): LibraryAttachment => ({
  ...attachment(id),
  state: 'loose',
  entryId: null,
  caption: null,
  uploadedAt: '2026-11-16T01:00:00Z',
  purgeAt: '2026-11-23T01:00:00Z',
  entry: null,
  ...over
});
const inEntry = (id: string, over: Partial<LibraryAttachment> = {}): LibraryAttachment =>
  file(id, {
    state: 'attached',
    entryId: 'en_1',
    purgeAt: null,
    entry: { id: 'en_1', label: '湖边', occurredAt: '2026-11-16T09:00:00', visibility: 'private', status: 'published' },
    ...over
  });

describe('the address', () => {
  it('opens on photos unless it names another tab', () => {
    expect(kindParam(null)).toBe('photos');
    expect(kindParam('video')).toBe('video');
    expect(kindParam('audio')).toBe('audio');
    expect(kindParam('file')).toBe('file');
    expect(kindParam('image')).toBe('photos');
  });

  it('filters in no entry on every tab, by who may see them on photos only', () => {
    expect(showParam('loose', 'photos')).toBe('loose');
    expect(showParam('loose', 'audio')).toBe('loose');
    expect(showParam('private', 'photos')).toBe('private');
    expect(showParam('unlisted', 'photos')).toBe('unlisted');
    expect(showParam('public', 'photos')).toBe('public');
    expect(showParam('private', 'video')).toBe('all');
    expect(showParam('nope', 'photos')).toBe('all');
    expect(showParam(null, 'file')).toBe('all');
  });
});

describe('photosShown', () => {
  const list = [
    photo('ph_a', { takenAt: '2026-01-02T08:00:00', visibility: 'public' }),
    photo('ph_b', { takenAt: null, visibility: 'private' }),
    photo('ph_c', { takenAt: '2026-03-01T08:00:00', visibility: 'unlisted' }),
    photo('ph_d', { takenAt: null, visibility: 'private' })
  ];
  const none = new Set<string>();

  it('puts the newest capture first and the undated last, in the order they came', () => {
    expect(photosShown(list, 'all', none).map((p) => p.id)).toEqual(['ph_c', 'ph_a', 'ph_b', 'ph_d']);
  });

  it('keeps those in no entry, or those so visible', () => {
    expect(photosShown(list, 'loose', new Set(['ph_a', 'ph_d'])).map((p) => p.id)).toEqual(['ph_c', 'ph_b']);
    expect(photosShown(list, 'private', none).map((p) => p.id)).toEqual(['ph_b', 'ph_d']);
    expect(photosShown(list, 'unlisted', none).map((p) => p.id)).toEqual(['ph_c']);
    expect(photosShown(list, 'public', none).map((p) => p.id)).toEqual(['ph_a']);
  });

  it('leaves the list it was given as it was', () => {
    const copy = list.map((p) => p.id);
    photosShown(list, 'all', none);
    expect(list.map((p) => p.id)).toEqual(copy);
  });
});

describe('attachmentsShown', () => {
  const list = [
    file('at_1', { kind: 'audio' }),
    inEntry('at_2', { kind: 'audio' }),
    file('at_3', { kind: 'audio', state: 'uploading', uploadedAt: null }),
    file('at_4', { kind: 'video' })
  ];

  it('keeps one kind, in the order listed; in no entry: the uploading too', () => {
    expect(attachmentsShown(list, 'audio', 'all').map((a) => a.id)).toEqual(['at_1', 'at_2', 'at_3']);
    expect(attachmentsShown(list, 'audio', 'loose').map((a) => a.id)).toEqual(['at_1', 'at_3']);
    expect(attachmentsShown(list, 'video', 'all').map((a) => a.id)).toEqual(['at_4']);
    expect(attachmentsShown(list, 'file', 'all')).toEqual([]);
  });
});

describe('purgeText', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const at = (ms: number) => new Date(now + ms).toISOString();
  const HOUR = 3600_000;

  it('says in how many days, or within the day in how many hours', () => {
    expect(purgeText(at(7 * 24 * HOUR), now)).toBe('7 天后删去');
    expect(purgeText(at(6.4 * 24 * HOUR), now)).toBe('6 天后删去');
    expect(purgeText(at(1.6 * 24 * HOUR), now)).toBe('2 天后删去');
    expect(purgeText(at(24 * HOUR), now)).toBe('1 天后删去');
    // nearer a day than 23 hours: a day, not "24 hours"
    expect(purgeText(at(23.75 * HOUR), now)).toBe('1 天后删去');
    expect(purgeText(at(23.4 * HOUR), now)).toBe('23 小时后删去');
    expect(purgeText(at(2 * HOUR), now)).toBe('2 小时后删去');
    expect(purgeText(at(10 * 60_000), now)).toBe('1 小时后删去');
  });

  it('says soon once its time has come: the hourly cleanup has not run yet', () => {
    expect(purgeText(at(0), now)).toBe('即将删去');
    expect(purgeText(at(-HOUR), now)).toBe('即将删去');
  });
});

describe('entryStart', () => {
  const photos = [
    photo('ph_new', { takenAt: '2026-10-05T18:00:00' }),
    photo('ph_none', { takenAt: null }),
    photo('ph_old', { takenAt: '2026-10-03T07:30:00' }),
    photo('ph_other', { takenAt: '2026-01-01T00:00:00' })
  ];
  const files = [
    file('at_loose'),
    inEntry('at_in'),
    file('at_up', { state: 'uploading', uploadedAt: null }),
    file('at_more', { kind: 'file' })
  ];

  it('starts with the picked photos in capture order, the undated last, on the day of the first', () => {
    const s = entryStart(new Set(['ph_none', 'ph_new', 'ph_old']), photos, files);
    expect(s.photos.map((p) => p.id)).toEqual(['ph_old', 'ph_new', 'ph_none']);
    expect(s.date).toBe('2026-10-03');
    expect(s.attachments).toEqual([]);
    expect(s.problem).toBeNull();
  });

  it('with no dated photo: no day, the editor’s own', () => {
    expect(entryStart(new Set(['ph_none']), photos, files).date).toBeNull();
    expect(entryStart(new Set(['at_loose']), photos, files).date).toBeNull();
  });

  it('takes only the attachments in no entry and uploaded whole, as the attachments themselves', () => {
    const s = entryStart(new Set(['at_loose', 'at_in', 'at_up', 'at_more']), photos, files);
    expect(s.attachments).toEqual([asAttachment(files[0]), asAttachment(files[3])]);
    // the attachment as the editor knows it: every field of its own, none of the library's
    expect(s.attachments[0]).toStrictEqual(attachment('at_loose'));
    expect(s.attachments[1]).toStrictEqual(attachment('at_more', { kind: 'file' }));
    expect(selectable(files[0])).toBe(true);
    expect(selectable(files[1])).toBe(false);
    expect(selectable(files[2])).toBe(false);
  });

  it('says when one entry cannot hold them all', () => {
    const many = Array.from({ length: ENTRY_LIMITS.mediaCount + 1 }, (_, i) => photo(`ph_${i}`));
    const all = new Set(many.map((p) => p.id));
    expect(entryStart(all, many, []).problem).toBe(`一条记录最多 ${ENTRY_LIMITS.mediaCount} 张照片`);
    all.delete('ph_0');
    expect(entryStart(all, many, []).problem).toBeNull();

    const loose = Array.from({ length: ATTACHMENT_LIMITS.perEntry + 1 }, (_, i) => file(`at_${i}`));
    const picked = new Set(loose.map((a) => a.id));
    expect(entryStart(picked, [], loose).problem).toBe(`一条记录最多 ${ATTACHMENT_LIMITS.perEntry} 个附件`);
    picked.delete('at_0');
    expect(entryStart(picked, [], loose).problem).toBeNull();
  });
});
