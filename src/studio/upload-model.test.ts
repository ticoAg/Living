import { describe, expect, it } from 'vite-plus/test';
import type { Processed } from './process';
import { bulkSendable, inBulk, isEditable, newItem, pickRows, runSummary, stepRow, type Item } from './upload-model';

const at = (lat: number | null, lng: number | null, takenAt: string | null = '2026-03-20T18:00:00') =>
  ({ exif: { lat, lng, takenAt, tz: '+08:00', heading: null } }) as unknown as Processed;

function item(over: Partial<Item> = {}): Item {
  return { ...newItem(new File(['x'], 'a.jpg', { type: 'image/jpeg' })), ...over };
}
const ready = (over: Partial<Item> = {}) => item({ stage: 'ready', p: at(30.25, 120.15), ...over });
const loaded = { radius: 300, loading: false, error: null, res: null };

describe('inBulk', () => {
  it('takes every photo that is not on the site or in flight, processed or not', () => {
    expect(inBulk(ready())).toBe(true);
    expect(inBulk(item())).toBe(true);
    expect(inBulk(item({ stage: 'processing' }))).toBe(true);
    expect(inBulk(ready({ publish: { state: 'failed', progress: 0, error: 'x' } }))).toBe(true);
  });

  it('leaves out what is published, already there, being sent or unreadable', () => {
    expect(inBulk(ready({ publish: { state: 'done', progress: 1 } }))).toBe(false);
    expect(inBulk(ready({ publish: { state: 'duplicate', progress: 0 } }))).toBe(false);
    expect(inBulk(ready({ publish: { state: 'sending', progress: 0.4 } }))).toBe(false);
    expect(inBulk(item({ stage: 'error', error: 'x' }))).toBe(false);
  });
});

describe('isEditable', () => {
  it('is true until a photo is sent, and never for an unreadable file', () => {
    expect(isEditable(item())).toBe(true);
    expect(isEditable(ready({ publish: { state: 'failed', progress: 0 } }))).toBe(true);
    expect(isEditable(ready({ publish: { state: 'sending', progress: 0 } }))).toBe(false);
    expect(isEditable(ready({ publish: { state: 'done', progress: 1 } }))).toBe(false);
    expect(isEditable(item({ stage: 'error' }))).toBe(false);
  });
});

describe('bulkSendable', () => {
  it('sends a processed photo as it is, matched or not, once its match is back', () => {
    const it1 = ready({ match: loaded });
    expect(bulkSendable(it1, [it1])).toBe(true);
    const failed = ready({ match: { ...loaded, error: '地点匹配失败' } });
    expect(bulkSendable(failed, [failed])).toBe(true);
  });

  it('waits for processing and for the place match', () => {
    const waiting = item({ stage: 'processing' });
    const matching = ready({ match: { ...loaded, loading: true } });
    expect(bulkSendable(waiting, [waiting])).toBe(false);
    expect(bulkSendable(matching, [matching])).toBe(false);
  });

  it('holds a photo without GPS until its neighbours are settled, since its place may come from them', () => {
    const blind = ready({ p: at(null, null) });
    const neighbour = ready({ match: { ...loaded, loading: true } });
    expect(bulkSendable(blind, [blind, neighbour])).toBe(false);
    expect(bulkSendable(blind, [blind, { ...neighbour, match: loaded }])).toBe(true);
    expect(bulkSendable(blind, [blind, item({ stage: 'queued' })])).toBe(false);
    // a place of its own, or one taken away on purpose, needs no neighbour
    expect(bulkSendable({ ...blind, cleared: true }, [blind, neighbour])).toBe(true);
  });

  it('does not send what is not in the batch', () => {
    const done = ready({ publish: { state: 'done', progress: 1 } });
    expect(bulkSendable(done, [done])).toBe(false);
  });
});

describe('pickRows', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('a plain click shows one photo and drops the selection', () => {
    expect(pickRows(order, ['a', 'b'], 'a', 'd', 'one', 'a')).toEqual({ checked: [], current: 'd' });
  });

  it('ctrl/⌘ starts from the photo on screen and grows the selection', () => {
    expect(pickRows(order, [], 'b', 'd', 'toggle', 'b')).toEqual({ checked: ['b', 'd'], current: 'd' });
    expect(pickRows(order, ['b', 'd'], 'd', 'a', 'toggle', 'd')).toEqual({ checked: ['a', 'b', 'd'], current: 'a' });
  });

  it('a checkbox starts from nothing: the first one checks just its photo and shows it', () => {
    expect(pickRows(order, [], 'b', 'd', 'check', 'b')).toEqual({ checked: ['d'], current: 'd' });
    expect(pickRows(order, ['d'], 'd', 'a', 'check', 'd')).toEqual({ checked: ['a', 'd'], current: 'a' });
  });

  it('drops a photo, showing another checked one when it was on screen', () => {
    expect(pickRows(order, ['a', 'b', 'd'], 'd', 'b', 'toggle', 'd')).toEqual({ checked: ['a', 'd'], current: 'd' });
    expect(pickRows(order, ['a', 'b', 'd'], 'b', 'b', 'check', 'b')).toEqual({ checked: ['a', 'd'], current: 'd' });
    expect(pickRows(order, ['b', 'd'], 'd', 'd', 'check', 'd')).toEqual({ checked: ['b'], current: 'b' });
    expect(pickRows(order, ['b'], 'b', 'b', 'check', 'b')).toEqual({ checked: [], current: 'b' });
    expect(pickRows(order, [], 'b', 'b', 'toggle', 'b')).toEqual({ checked: [], current: 'b' });
  });

  it('shift takes the run from where the last click was, either way', () => {
    expect(pickRows(order, [], 'b', 'd', 'range', 'b')).toEqual({ checked: ['b', 'c', 'd'], current: 'd' });
    expect(pickRows(order, ['b', 'c', 'd'], 'd', 'a', 'range', 'b')).toEqual({ checked: ['a', 'b'], current: 'a' });
    expect(pickRows(order, [], 'c', 'c', 'range', null)).toEqual({ checked: ['c'], current: 'c' });
    expect(pickRows(order, [], 'c', 'e', 'range', 'gone')).toEqual({ checked: ['e'], current: 'e' });
  });
});

describe('runSummary', () => {
  it('counts what a run sent, skipped and could not send', () => {
    expect(runSummary({ done: 3, duplicate: 0, failed: 0 }, false)).toBe('已发布 3 张。');
    expect(runSummary({ done: 2, duplicate: 6, failed: 1 }, false)).toBe('已发布 2 张，6 张以前传过，1 张失败，可以重试。');
    expect(runSummary({ done: 0, duplicate: 1, failed: 0 }, false)).toBe('已发布 0 张，1 张以前传过。');
  });
  it('says when the run was stopped, even before anything went out', () => {
    expect(runSummary({ done: 1, duplicate: 0, failed: 0 }, true)).toBe('已停止。已发布 1 张。');
    expect(runSummary({ done: 0, duplicate: 0, failed: 0 }, true)).toBe('已停止。已发布 0 张。');
  });
  it('leaves nothing behind for a run that tried nothing', () => {
    expect(runSummary({ done: 0, duplicate: 0, failed: 0 }, false)).toBeNull();
  });
});

describe('stepRow', () => {
  const order = ['a', 'b', 'c'];

  it('moves to the neighbour in the queue', () => {
    expect(stepRow(order, 'a', 1)).toBe('b');
    expect(stepRow(order, 'c', -1)).toBe('b');
  });

  it('stops at either end', () => {
    expect(stepRow(order, 'c', 1)).toBeNull();
    expect(stepRow(order, 'a', -1)).toBeNull();
  });

  it('starts from the first photo when none is on screen or the one on screen has left the queue', () => {
    expect(stepRow(order, null, 1)).toBe('b');
    expect(stepRow(order, 'gone', 1)).toBe('b');
    expect(stepRow([], null, 1)).toBeNull();
  });
});
