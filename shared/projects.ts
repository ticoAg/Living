// Project helpers shared by the Worker and the SPA: the names of types and statuses, the type of entry a project
// suggests, and day arithmetic on the author's local days. Docs: /docs/data/projects.md

import type { EntryType, ProjectStatus, ProjectType } from './types';

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  learning: '学习',
  practice: '练习',
  reading: '阅读',
  creation: '创作',
  other: '其他'
};

/** The name of a type. One this version does not know (the list may grow) reads as 其他. */
export const projectTypeLabel = (type: string): string => PROJECT_TYPE_LABELS[type as ProjectType] ?? PROJECT_TYPE_LABELS.other;

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = { active: '进行中', paused: '暂停', completed: '已完成' };

const ENTRY_TYPE_OF: Record<ProjectType, EntryType> = {
  learning: 'practice',
  practice: 'practice',
  reading: 'reading',
  creation: 'creation',
  other: 'note'
};

/** The type a new entry written for a project starts as: a practice for learning, a reading for reading. */
export const entryTypeFor = (type: string): EntryType => ENTRY_TYPE_OF[type as ProjectType] ?? 'note';

const dayNumber = (day: string): number => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86400_000;

/** Days from `from` to `to` (`YYYY-MM-DD`), counting both: the same day is 1. Never less than 1. */
export function daysSpanned(from: string, to: string): number {
  return Math.max(1, Math.round(dayNumber(to) - dayNumber(from)) + 1);
}
