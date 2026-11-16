// Entry helpers shared by the Worker and the SPA: the names of types and statuses, the excerpt that lists carry, and a
// plain-text label for places that show no Markdown (a photo's list of its entries, the browser tab).
// Docs: /docs/data/entries.md

import type { EntryStatus, EntryType } from './types';

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  note: '随记',
  article: '文章',
  reading: '阅读',
  practice: '练习',
  creation: '创作',
  trip: '旅行'
};

/** The name of a type. One this version does not know (the list may grow) reads as a note. */
export const entryTypeLabel = (type: string): string => ENTRY_TYPE_LABELS[type as EntryType] ?? ENTRY_TYPE_LABELS.note;

export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = { draft: '草稿', published: '已完成', archived: '已归档' };

/** The day of an `occurredAt` (`YYYY-MM-DD`, with or without a time). */
export const occurredDay = (occurredAt: string): string => occurredAt.slice(0, 10);

/** The `occurredAt` carries a time of day, not just the day. */
export const hasTime = (occurredAt: string): boolean => occurredAt.length > 10;

/**
 * The start of a body for lists: at most `max` code points, cut at the last line break of its second half when it has
 * one, so a short note comes whole and a long one stops at the end of a line. `head` may be only the first `max + 1`
 * code points of the body: one past the limit is enough to tell that it goes on.
 */
export function excerptOf(head: string | null | undefined, max: number): { excerpt: string | null; hasMore: boolean } {
  if (!head) return { excerpt: null, hasMore: false };
  const cps = [...head];
  if (cps.length <= max) return { excerpt: head, hasMore: false };
  let cut = cps.slice(0, max);
  const nl = cut.lastIndexOf('\n');
  if (nl >= max / 2) cut = cut.slice(0, nl);
  return { excerpt: cut.join('').trimEnd(), hasMore: true };
}

const clip = (s: string, max: number): string => {
  const cps = [...s];
  return cps.length > max ? `${cps.slice(0, max).join('').trimEnd()}…` : s;
};

/** Markdown marks at the start of a line: headings, quotes, bullets and numbers, task boxes. */
const LINE_MARKS = /^(?:\s*(?:#{1,6}(?:\s+|$)|>\s?|[-*+]\s+|\d{1,9}[.)]\s+|\[[ xX]\]\s+))+/;
const FENCE = /^\s*(?:`{3,}|~{3,})/;
const BREAK = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const PUNCT = /[!-/:-@[-`{-~]/;
const WORD = /[A-Za-z0-9]/;

/** One line of Markdown as plain text: links give their text, emphasis and code marks go, escapes resolve. */
function plainLine(s: string): string {
  const linked = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<((?:https?|mailto):[^>\s]+)>/gi, '$1');
  let out = '';
  for (let i = 0; i < linked.length; i++) {
    const ch = linked[i];
    const next = linked[i + 1] ?? '';
    if (ch === '\\' && PUNCT.test(next)) {
      out += next;
      i++;
    } else if (ch === '~' && next === '~') {
      i++;
    } else if (ch === '_') {
      // snake_case stays; emphasis underscores go
      if (WORD.test(linked[i - 1] ?? '') && WORD.test(next)) out += ch;
    } else if (ch !== '*' && ch !== '`') {
      out += ch;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * A short plain-text name for an entry: its title, else the first line of its body that has words, without its
 * Markdown, else ''. At most `max` code points (then an ellipsis).
 */
export function entryLabel(title: string | null | undefined, body: string | null | undefined, max = 30): string {
  const t = title?.trim();
  if (t) return clip(t.replace(/\s+/g, ' '), max);
  let inCode = false;
  for (const raw of (body ?? '').split(/\r\n?|\n/)) {
    if (FENCE.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode || BREAK.test(raw)) continue;
    const line = plainLine(raw.replace(LINE_MARKS, ''));
    if (line) return clip(line, max);
  }
  return '';
}
