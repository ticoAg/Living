import { describe, expect, it } from 'vite-plus/test';
import type { Milestone, PhotoSummary } from '../../shared/types';
import { entry, photo } from '../test-utils';
import { byStatusAndTouch, courseOf, firstAndLatest, projectSpan, rhythmOf, touchedDay } from './stages';

const milestone = (id: string, date: string, title = id): Milestone => ({
  id,
  projectId: 'pj_1',
  title,
  body: null,
  date,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
});

const photoMap = (...ids: string[]) => new Map<string, PhotoSummary>(ids.map((id) => [id, photo(id)]));

describe('projectSpan', () => {
  const p = { startDate: '2026-03-01', endDate: null, status: 'active' as const, lastOccurredAt: null };

  it('counts the days of an open project, its first day as day 1', () => {
    expect(projectSpan(p, '2026-03-01')).toEqual({ days: 1, ended: false });
    expect(projectSpan(p, '2026-11-16')).toEqual({ days: 261, ended: false });
    expect(projectSpan({ ...p, status: 'paused', endDate: '2026-04-01' }, '2026-11-16')).toEqual({ days: 261, ended: false });
  });

  it('counts a completed one to its end, else to its latest entry', () => {
    expect(projectSpan({ ...p, status: 'completed', endDate: '2026-03-10' }, '2026-11-16')).toEqual({ days: 10, ended: true });
    expect(projectSpan({ ...p, status: 'completed', lastOccurredAt: '2026-03-05T20:00:00' }, '2026-11-16')).toEqual({
      days: 5,
      ended: true
    });
    expect(projectSpan({ ...p, status: 'completed' }, '2026-03-03')).toEqual({ days: 3, ended: true });
  });

  it('has nothing to count before it starts', () => {
    expect(projectSpan({ ...p, startDate: '2026-12-01' }, '2026-11-16')).toBeNull();
  });
});

describe('courseOf', () => {
  const photos = photoMap('ph_1', 'ph_2', 'ph_3', 'ph_4');
  const entries = [
    entry('en_1', { occurredAt: '2026-03-02T09:00:00', photoIds: ['ph_1'] }),
    entry('en_2', { occurredAt: '2026-04-30', photoIds: ['ph_2', 'ph_1'] }),
    entry('en_3', { occurredAt: '2026-05-01T08:00:00', photoIds: ['ph_3'] }),
    entry('en_4', { occurredAt: '2026-11-15T21:00:00', photoIds: ['ph_4', 'ph_gone'] }),
    entry('en_draft', { occurredAt: '2026-11-16T07:00:00', status: 'draft', photoIds: ['ph_4'] })
  ];
  const project = { startDate: '2026-03-01', status: 'active' as const };

  it('closes a stage at each milestone reached, its day included, and keeps the rest as the stage going on', () => {
    const c = courseOf(project, [milestone('ms_b', '2026-08-01'), milestone('ms_a', '2026-04-30')], entries, photos, '2026-11-16');
    expect(c.stages.map((s) => [s.milestone?.id ?? null, s.from, s.to, s.entries.map((e) => e.id)])).toEqual([
      ['ms_a', '2026-03-01', '2026-04-30', ['en_1', 'en_2']],
      ['ms_b', '2026-05-01', '2026-08-01', ['en_3']],
      [null, '2026-08-02', null, ['en_4']]
    ]);
    expect(c.planned).toEqual([]);
  });

  it('gives each stage its photos once, in order, and only those it can show', () => {
    const c = courseOf(project, [milestone('ms_a', '2026-04-30')], entries, photos, '2026-11-16');
    expect(c.stages[0].photos.map((p) => p.id)).toEqual(['ph_1', 'ph_2']);
    expect(c.stages[1].photos.map((p) => p.id)).toEqual(['ph_3', 'ph_4']);
  });

  it('lists milestones still ahead apart, and leaves drafts out of every stage', () => {
    const c = courseOf(project, [milestone('ms_next', '2026-12-31')], entries, photos, '2026-11-16');
    expect(c.planned.map((m) => m.id)).toEqual(['ms_next']);
    expect(c.stages).toHaveLength(1);
    expect(c.stages[0].entries.map((e) => e.id)).toEqual(['en_1', 'en_2', 'en_3', 'en_4']);
  });

  it('ends a completed project at its last milestone unless entries came after it', () => {
    const done = { ...project, status: 'completed' as const };
    expect(
      courseOf(done, [milestone('ms_end', '2026-11-15')], entries, photos, '2026-11-16').stages.map((s) => s.milestone?.id ?? null)
    ).toEqual(['ms_end']);
    expect(
      courseOf(done, [milestone('ms_a', '2026-04-30')], entries, photos, '2026-11-16').stages.map((s) => s.milestone?.id ?? null)
    ).toEqual(['ms_a', null]);
  });

  it('is one stage going on for a project without milestones, even an empty one', () => {
    expect(courseOf(project, [], [], photos, '2026-11-16').stages).toEqual([
      { milestone: null, from: '2026-03-01', to: null, entries: [], photos: [] }
    ]);
  });
});

describe('firstAndLatest', () => {
  const photos = photoMap('ph_1', 'ph_2', 'ph_3');

  it('sets the first work of the earliest entry beside that of the latest', () => {
    const r = firstAndLatest(
      [
        entry('en_3', { occurredAt: '2026-11-01', photoIds: ['ph_3'] }),
        entry('en_1', { occurredAt: '2026-03-01', photoIds: ['ph_gone', 'ph_1'] }),
        entry('en_2', { occurredAt: '2026-06-01', photoIds: ['ph_2'] }),
        entry('en_d', { occurredAt: '2026-11-10', photoIds: ['ph_2'], status: 'draft' })
      ],
      photos
    );
    expect([r?.first.photo.id, r?.first.entry.id, r?.latest.photo.id, r?.latest.entry.id]).toEqual(['ph_1', 'en_1', 'ph_3', 'en_3']);
  });

  it('needs two different photos', () => {
    expect(firstAndLatest([entry('en_1', { photoIds: ['ph_1'] })], photos)).toBeNull();
    expect(
      firstAndLatest(
        [entry('en_1', { occurredAt: '2026-03-01', photoIds: ['ph_1'] }), entry('en_2', { occurredAt: '2026-04-01', photoIds: ['ph_1'] })],
        photos
      )
    ).toBeNull();
  });
});

describe('ordering projects', () => {
  const p = (id: string, status: 'active' | 'paused' | 'completed', updatedAt: string, lastOccurredAt: string | null = null) => ({
    id,
    status,
    updatedAt,
    lastOccurredAt
  });

  it('takes the later of its latest entry and its last change as the day it was worked on', () => {
    expect(touchedDay(p('a', 'active', '2026-03-01T08:00:00Z', '2026-03-05T21:00:00'))).toBe('2026-03-05');
    expect(touchedDay(p('a', 'active', '2026-03-09T08:00:00Z', '2026-03-05T21:00:00'))).toBe('2026-03-09');
    expect(touchedDay(p('a', 'active', '2026-03-09T08:00:00Z'))).toBe('2026-03-09');
  });

  it('puts those going on first, then paused, then completed, each the most recently worked on first', () => {
    const list = [
      p('done', 'completed', '2026-11-15T00:00:00Z'),
      p('old', 'active', '2026-01-01T00:00:00Z', '2026-02-01T09:00:00'),
      p('rest', 'paused', '2026-11-16T00:00:00Z'),
      p('new', 'active', '2026-01-01T00:00:00Z', '2026-11-10T09:00:00'),
      p('same-day-later', 'active', '2026-11-10T12:00:00Z')
    ];
    expect([...list].sort(byStatusAndTouch).map((x) => x.id)).toEqual(['same-day-later', 'new', 'old', 'rest', 'done']);
  });
});

describe('rhythmOf', () => {
  const p = { startDate: '2026-10-01', endDate: null, status: 'active' as const };
  const on = (...days: string[]) => days.map((d, i) => entry(`e${i}`, { occurredAt: d }));

  it('reads an open project from its start to today', () => {
    const r = rhythmOf(p, on('2026-10-01', '2026-10-02', '2026-10-03', '2026-11-15', '2026-11-16T07:00:00'), '2026-11-16')!;
    expect(r).toMatchObject({ longest: 3, current: 2, months: ['2026-10', '2026-11'] });
    expect([...r.days].sort()).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-11-15', '2026-11-16']);
    // 5 days over the 47 days from 1 October to 16 November
    expect(r.perWeek).toBeCloseTo(5 / (47 / 7));
  });

  it('reads a completed one to its end date, else to its latest entry', () => {
    const entries = on('2026-10-01', '2026-10-08');
    expect(rhythmOf({ ...p, status: 'completed', endDate: '2026-10-14' }, entries, '2026-11-16')!.perWeek).toBe(1);
    expect(rhythmOf({ ...p, status: 'completed' }, entries, '2026-11-16')!.months).toEqual(['2026-10']);
    // an end date still ahead is not reached yet: the latest entry closes it
    expect(rhythmOf({ ...p, status: 'completed', endDate: '2027-01-01' }, entries, '2026-11-16')!.months).toEqual(['2026-10']);
  });

  it('reaches back to an entry before the start, and on to one dated later', () => {
    expect(rhythmOf(p, on('2026-08-30', '2026-12-02'), '2026-11-16')!.months).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12'
    ]);
  });

  it('is nothing without entries', () => {
    expect(rhythmOf(p, [], '2026-11-16')).toBeNull();
  });
});
