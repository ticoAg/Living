import { describe, expect, it } from 'vite-plus/test';
import { attachment, photo } from '../test-utils';
import { emptyDraft } from './draft';
import { handoffOf, handsOver, NO_HANDOFF } from './handoff';

describe('handoffOf', () => {
  it('reads the quick note’s text and recordings, and the library’s photos and files', () => {
    const a = attachment('at_1', { kind: 'audio', poster: false });
    const p = photo('ph_1');
    expect(handoffOf({ livingEntryBody: '写下', livingEntryAttachments: [a], livingEntryPhotos: [p] })).toEqual({
      body: '写下',
      attachments: [a],
      photos: [p]
    });
  });

  it('is nothing to start with for no state, another page’s, or what is not one', () => {
    for (const state of [null, undefined, 'x', 3, { idx: 2 }, { livingEntryBody: 3, livingEntryAttachments: 'a', livingEntryPhotos: {} }]) {
      expect(handoffOf(state)).toEqual(NO_HANDOFF);
      expect(handsOver(handoffOf(state))).toBe(false);
    }
  });

  it('leaves out what is not an attachment or a photo to show, and keeps the rest', () => {
    const a = attachment('at_1');
    const p = photo('ph_1');
    const s = handoffOf({
      livingEntryAttachments: [a, { id: 'at_2' }, null],
      livingEntryPhotos: [p, { id: 'ph_2' }, { id: 'ph_3', width: 3, height: 2 }, 'ph_4', null]
    });
    expect(s.attachments).toEqual([a]);
    expect(s.photos).toEqual([p]);
    expect(handsOver(s)).toBe(true);
  });

  it('hands over even only photos, or only files', () => {
    expect(handsOver({ ...NO_HANDOFF, photos: [photo('ph_1')] })).toBe(true);
    expect(handsOver({ ...NO_HANDOFF, attachments: [attachment('at_1')] })).toBe(true);
    expect(handsOver({ ...NO_HANDOFF, body: '字' })).toBe(true);
  });
});

describe('a new entry from the library', () => {
  it('starts with the photos in the order given, and the files after them', () => {
    const now = new Date('2026-11-20T10:00:00');
    const photos = [photo('ph_2'), photo('ph_1'), photo('ph_2')];
    const d = emptyDraft(now, '', { date: '2026-10-03', photos, attachments: [attachment('at_1')] });
    expect(d.media).toEqual([
      { photoId: 'ph_2', caption: '', photo: photos[0] },
      { photoId: 'ph_1', caption: '', photo: photos[1] }
    ]);
    expect(d.attachments.map((a) => a.attachmentId)).toEqual(['at_1']);
    // another day: the whole day, private
    expect(d).toMatchObject({ date: '2026-10-03', time: '', visibility: 'private' });
  });
});
