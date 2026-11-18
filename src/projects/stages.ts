// A project read as a course of time: how long it has run, its stages between milestones with the works of each,
// and its first work beside its latest. Pure, so the project page only lays it out. Docs: /docs/product/features/projects.md

import { daysSpanned } from '../../shared/projects';
import { occurredDay } from '../../shared/entries';
import type { EntrySummary, Milestone, PhotoSummary, ProjectSummary } from '../../shared/types';
import { monthsBetween, rhythm } from '../review/calendar';

/**
 * How long it has run: day N of a project still open, or the days a completed one took (to its end date, else to its
 * latest entry); null before it starts.
 */
export function projectSpan(
  p: Pick<ProjectSummary, 'startDate' | 'endDate' | 'status' | 'lastOccurredAt'>,
  today: string
): { days: number; ended: boolean } | null {
  const ended = p.status === 'completed';
  const last = !ended ? today : p.endDate && p.endDate <= today ? p.endDate : p.lastOccurredAt ? occurredDay(p.lastOccurredAt) : today;
  if (last < p.startDate) return null;
  return { days: daysSpanned(p.startDate, last), ended };
}

export interface Rhythm {
  /** the days it was worked on */
  days: ReadonlySet<string>;
  longest: number;
  current: number;
  /** days a week it was worked on, over its span */
  perWeek: number;
  /** `YYYY-MM` of every month of its span */
  months: string[];
}

/**
 * How a project has been kept up, from the days of its entries: read over its span, from its start (or an earlier
 * entry) to today while it goes on, or to its end once completed (its end date, else its latest entry), and on to any
 * entry dated later. Null without entries.
 */
export function rhythmOf(
  p: Pick<ProjectSummary, 'startDate' | 'endDate' | 'status'>,
  entries: readonly EntrySummary[],
  today: string
): Rhythm | null {
  if (entries.length === 0) return null;
  const days = new Set(entries.map((e) => occurredDay(e.occurredAt)));
  const sorted = [...days].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const from = first < p.startDate ? first : p.startDate;
  const end = p.status === 'completed' ? (p.endDate && p.endDate <= today ? p.endDate : last) : today;
  const to = last > end ? last : end;
  return { days, ...rhythm(days, from, to, today), months: monthsBetween(from, to) };
}

const STATUS_ORDER: Record<ProjectSummary['status'], number> = { active: 0, paused: 1, completed: 2 };

/** The day a project was last worked on: its latest entry, or the last change to it, whichever came later. */
export function touchedDay(p: Pick<ProjectSummary, 'lastOccurredAt' | 'updatedAt'>): string {
  const entry = p.lastOccurredAt ? occurredDay(p.lastOccurredAt) : '';
  const changed = p.updatedAt.slice(0, 10);
  return entry > changed ? entry : changed;
}

/** Projects going on first, then paused ones, then completed; within each, the one worked on most recently first. */
export const byStatusAndTouch = (
  a: Pick<ProjectSummary, 'status' | 'lastOccurredAt' | 'updatedAt'>,
  b: Pick<ProjectSummary, 'status' | 'lastOccurredAt' | 'updatedAt'>
): number =>
  STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || touchedDay(b).localeCompare(touchedDay(a)) || b.updatedAt.localeCompare(a.updatedAt);

export interface Stage {
  /** the milestone that closes it; null for the stage still going */
  milestone: Milestone | null;
  /** the first day of the stage: the project's start, or the day after the milestone before */
  from: string;
  /** its last day: the milestone's, or null for the stage still going */
  to: string | null;
  /** finished entries of the stage, earliest first */
  entries: EntrySummary[];
  /** the photos of those entries the page can show, in that order, each once */
  photos: PhotoSummary[];
}

export interface Course {
  stages: Stage[];
  /** milestones still ahead (dated after today), earliest first */
  planned: Milestone[];
}

const byTime = (a: EntrySummary, b: EntrySummary) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0);
const dayAfter = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * The stages of a project: each milestone reached (dated today or before) closes one, taking the finished entries up
 * to and including its day; what came after the last one is the stage still going, shown while the project is not
 * completed or has entries in it. Milestones still ahead are listed apart.
 */
export function courseOf(
  project: Pick<ProjectSummary, 'startDate' | 'status'>,
  milestones: readonly Milestone[],
  entries: readonly EntrySummary[],
  photos: ReadonlyMap<string, PhotoSummary>,
  today: string
): Course {
  const sorted = [...milestones].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const reached = sorted.filter((m) => m.date <= today);
  const planned = sorted.filter((m) => m.date > today);
  const finished = entries.filter((e) => e.status === 'published').sort(byTime);

  const stages: Stage[] = [];
  let from = project.startDate;
  let i = 0;
  const take = (until: string | null) => {
    const out: EntrySummary[] = [];
    while (i < finished.length && (until === null || occurredDay(finished[i].occurredAt) <= until)) out.push(finished[i++]);
    return out;
  };
  for (const m of reached) {
    const own = take(m.date);
    stages.push({ milestone: m, from, to: m.date, entries: own, photos: photosOf(own, photos) });
    from = dayAfter(m.date);
  }
  const rest = take(null);
  if (project.status !== 'completed' || rest.length) {
    stages.push({ milestone: null, from, to: null, entries: rest, photos: photosOf(rest, photos) });
  }
  return { stages, planned };
}

function photosOf(entries: readonly EntrySummary[], photos: ReadonlyMap<string, PhotoSummary>): PhotoSummary[] {
  const seen = new Set<string>();
  const out: PhotoSummary[] = [];
  for (const e of entries) {
    for (const id of e.photoIds) {
      const p = photos.get(id);
      if (p && !seen.has(id)) {
        seen.add(id);
        out.push(p);
      }
    }
  }
  return out;
}

/**
 * The first work and the latest: the first photo of the earliest finished entry with one, and the first photo of the
 * latest. Null until there are two different photos to set side by side.
 */
export function firstAndLatest(
  entries: readonly EntrySummary[],
  photos: ReadonlyMap<string, PhotoSummary>
): { first: { photo: PhotoSummary; entry: EntrySummary }; latest: { photo: PhotoSummary; entry: EntrySummary } } | null {
  const withPhoto = entries
    .filter((e) => e.status === 'published')
    .map((entry) => ({ entry, photo: entry.photoIds.map((id) => photos.get(id)).find((p): p is PhotoSummary => !!p) }))
    .filter((x): x is { entry: EntrySummary; photo: PhotoSummary } => !!x.photo)
    .sort((a, b) => byTime(a.entry, b.entry));
  if (withPhoto.length < 2) return null;
  const first = withPhoto[0];
  const latest = withPhoto[withPhoto.length - 1];
  return first.photo.id === latest.photo.id ? null : { first, latest };
}
