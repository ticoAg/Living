import { describe, expect, it } from 'vite-plus/test';
import { entry, photo } from '../test-utils';
import { buildTimeline, keepEntries, loosePhotos, showsPhotos, todayView, yearMarks, type Segment } from './timeline';

/** A day's segments in brief: an entry by its id, a run of photos as their ids in brackets. */
const brief = (segments: Segment[]) => segments.map((s) => (s.kind === 'entry' ? s.entry.id : s.photos.map((p) => p.id)));

describe('keepEntries', () => {
  const all = [
    entry('a', { type: 'note' }),
    entry('b', { type: 'reading' }),
    entry('c', { type: 'reading', status: 'archived' }),
    entry('d', { status: 'draft' })
  ];

  it('keeps drafts, and archived entries only when asked', () => {
    expect(keepEntries(all, 'all', false).map((e) => e.id)).toEqual(['a', 'b', 'd']);
    expect(keepEntries(all, 'all', true).map((e) => e.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('narrows to one type, and to none for the photos alone', () => {
    expect(keepEntries(all, 'reading', false).map((e) => e.id)).toEqual(['b']);
    expect(keepEntries(all, 'reading', true).map((e) => e.id)).toEqual(['b', 'c']);
    expect(keepEntries(all, 'photos', true)).toEqual([]);
  });

  it('shows photos in the whole view and the photos alone', () => {
    expect(showsPhotos('all')).toBe(true);
    expect(showsPhotos('photos')).toBe(true);
    expect(showsPhotos('reading')).toBe(false);
  });
});

describe('buildTimeline', () => {
  it('puts entries and photos on their days, latest day first', () => {
    const t = buildTimeline(
      [entry('e1', { occurredAt: '2026-11-16T09:00:00' }), entry('e2', { occurredAt: '2026-11-14T20:00:00' })],
      [photo('p1', { takenAt: '2026-11-15T12:00:00' })]
    );
    expect(t.days.map((d) => d.day)).toEqual(['2026-11-16', '2026-11-15', '2026-11-14']);
    expect(brief(t.days[1].segments)).toEqual([['p1']]);
  });

  it('alternates entries and runs of photos in time order within a day', () => {
    const t = buildTimeline(
      [entry('noon', { occurredAt: '2026-11-16T12:00:00' }), entry('night', { occurredAt: '2026-11-16T22:00:00' })],
      [
        photo('p20', { takenAt: '2026-11-16T20:00:00' }),
        photo('p19', { takenAt: '2026-11-16T19:00:00' }),
        photo('p08', { takenAt: '2026-11-16T08:00:00' })
      ]
    );
    expect(brief(t.days[0].segments)).toEqual(['night', ['p20', 'p19'], 'noon', ['p08']]);
  });

  it('closes a day with the entries that have no time', () => {
    const t = buildTimeline(
      [entry('whole', { occurredAt: '2026-11-16' }), entry('timed', { occurredAt: '2026-11-16T07:00:00' })],
      [photo('p', { takenAt: '2026-11-16T06:00:00' })]
    );
    expect(brief(t.days[0].segments)).toEqual(['timed', ['p'], 'whole']);
  });

  it('keeps the given order for entries at the same time', () => {
    const t = buildTimeline(
      [entry('later', { occurredAt: '2026-11-16T09:00:00' }), entry('earlier', { occurredAt: '2026-11-16T09:00:00' })],
      []
    );
    expect(brief(t.days[0].segments)).toEqual(['later', 'earlier']);
  });

  it('does not repeat a photo beside an entry of the same day that shows it', () => {
    const t = buildTimeline(
      [entry('e', { occurredAt: '2026-11-16T12:00:00', photoIds: ['inside'] })],
      [photo('inside', { takenAt: '2026-11-16T11:00:00' }), photo('beside', { takenAt: '2026-11-16T10:00:00' })]
    );
    expect(brief(t.days[0].segments)).toEqual(['e', ['beside']]);
  });

  it('keeps a photo on its own day when an entry of another day shows it', () => {
    const t = buildTimeline(
      [entry('later', { occurredAt: '2026-11-20', photoIds: ['p'] })],
      [photo('p', { takenAt: '2026-11-16T11:00:00' })]
    );
    expect(t.days.map((d) => [d.day, brief(d.segments)])).toEqual([
      ['2026-11-20', ['later']],
      ['2026-11-16', [['p']]]
    ]);
  });

  it('lists photos with no capture time apart', () => {
    const t = buildTimeline([], [photo('undated'), photo('dated', { takenAt: '2026-11-16T11:00:00' })]);
    expect(t.undated.map((p) => p.id)).toEqual(['undated']);
    expect(t.days).toHaveLength(1);
  });

  it('is empty for nothing', () => {
    expect(buildTimeline([], [])).toEqual({ days: [], undated: [] });
  });
});

describe('loosePhotos', () => {
  it('drops the photos that an entry of their day shows', () => {
    const photos = [photo('a', { takenAt: '2026-11-16T10:00:00' }), photo('b', { takenAt: '2026-11-16T11:00:00' }), photo('c')];
    expect(loosePhotos(photos, [entry('e', { occurredAt: '2026-11-16', photoIds: ['a', 'c'] })]).map((p) => p.id)).toEqual(['b', 'c']);
  });
});

describe('yearMarks', () => {
  it('marks where each year starts', () => {
    const t = buildTimeline(
      [
        entry('a', { occurredAt: '2026-01-02' }),
        entry('b', { occurredAt: '2026-01-01' }),
        entry('c', { occurredAt: '2025-12-31' }),
        entry('d', { occurredAt: '2023-05-01' })
      ],
      []
    );
    expect(yearMarks(t.days)).toEqual([
      { year: '2026', index: 0 },
      { year: '2025', index: 2 },
      { year: '2023', index: 3 }
    ]);
  });
});

describe('todayView', () => {
  const today = '2026-11-16';

  it('holds the finished entries of the day and every draft, last edited first', () => {
    const v = todayView(
      [
        entry('now', { occurredAt: '2026-11-16T09:00:00' }),
        entry('yesterday', { occurredAt: '2026-11-15T09:00:00' }),
        entry('old-draft', { status: 'draft', occurredAt: '2026-10-01', updatedAt: '2026-11-10T00:00:00Z' }),
        entry('new-draft', { status: 'draft', occurredAt: '2026-11-16T08:00:00', updatedAt: '2026-11-16T00:00:00Z' }),
        entry('archived', { status: 'archived', occurredAt: '2026-11-16T07:00:00' })
      ],
      [],
      today
    );
    expect(v.entries.map((e) => e.id)).toEqual(['now']);
    expect(v.drafts.map((e) => e.id)).toEqual(['new-draft', 'old-draft']);
  });

  it('holds the photos taken that day, latest first, but not those its entries show', () => {
    const v = todayView(
      [entry('e', { photoIds: ['in'] })],
      [
        photo('early', { takenAt: '2026-11-16T07:00:00' }),
        photo('late', { takenAt: '2026-11-16T21:00:00' }),
        photo('in', { takenAt: '2026-11-16T08:00:00' }),
        photo('other', { takenAt: '2026-11-15T08:00:00' })
      ],
      today
    );
    expect(v.photos.map((p) => p.id)).toEqual(['late', 'early']);
  });

  it('finds the same day of earlier years, the latest year first', () => {
    const v = todayView(
      [
        entry('y2024', { occurredAt: '2024-11-16T10:00:00' }),
        entry('y2025', { occurredAt: '2025-11-16', photoIds: ['p2025a'] }),
        entry('draft2025', { status: 'draft', occurredAt: '2025-11-16' }),
        entry('other-day', { occurredAt: '2025-11-17' })
      ],
      [
        photo('p2025a', { takenAt: '2025-11-16T08:00:00' }),
        photo('p2025b', { takenAt: '2025-11-16T09:00:00' }),
        photo('p2020', { takenAt: '2020-11-16T09:00:00' })
      ],
      today
    );
    expect(v.past.map((y) => [y.year, y.entries.map((e) => e.id), y.photos.map((p) => p.id)])).toEqual([
      [2025, ['y2025'], ['p2025b']],
      [2024, ['y2024'], []],
      [2020, [], ['p2020']]
    ]);
  });
});
