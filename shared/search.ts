// Searching one's own archive: the words of a query, the piece of text a hit shows, and where the words are in it.
// The Worker reads the query and cuts the snippets; the SPA marks the words. Docs: /docs/api/search.md

import { plainText } from './entries';
import { SEARCH_LIMITS } from './limits';

/** Lower-cases A–Z only, as SQLite's LIKE and lower() do: what matches in the database is found here too. */
export const asciiLower = (s: string): string => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());

/**
 * A phrase in straight or curly quotes or in 「」 is one word, and a quote not yet closed runs to the end (a query is
 * searched while it is typed); otherwise words are split at any space, ideographic ones included.
 */
const WORD = /"([^"]*)(?:"|$)|“([^”]*)(?:”|$)|「([^」]*)(?:」|$)|(\S+)/gu;

/**
 * The words of a query, in order, each once (A–Z case aside); [] when it has none. More than
 * SEARCH_LIMITS.termCount is the caller's to refuse.
 */
export function searchTerms(q: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of q.matchAll(WORD)) {
    const word = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').replace(/\s+/gu, ' ').trim();
    const key = asciiLower(word);
    if (!word || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

/** Code points a snippet shows, and how many of them come before the first word found. */
export const SNIPPET_MAX = 90;
const SNIPPET_BEFORE = 24;

/** Code points in `s` (a string's length counts UTF-16 units). */
const codePoints = (s: string): number => [...s].length;

/** UTF-16 index of the first of `terms` found in `text` (A–Z case aside), or -1. */
function firstIndex(text: string, terms: string[]): number {
  const low = asciiLower(text);
  let at = -1;
  for (const t of terms) {
    const i = low.indexOf(asciiLower(t));
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  return at;
}

/**
 * Plain text from `markdown` around the first of `terms` it holds (or from its start), at most `max` code points, with
 * an ellipsis where it was cut. `cutStart`/`cutEnd`: `markdown` is itself a piece of a longer text.
 */
export function snippetAround(markdown: string, terms: string[], cutStart = false, cutEnd = false, max = SNIPPET_MAX): string {
  const plain = plainText(markdown);
  const cps = [...plain];
  const at = firstIndex(plain, terms);
  const atCp = at < 0 ? 0 : codePoints(plain.slice(0, at));
  const end = Math.min(cps.length, Math.max(atCp - SNIPPET_BEFORE, 0) + max);
  const start = Math.max(0, end - max);
  const text = cps.slice(start, end).join('').trim();
  return `${start > 0 || cutStart ? '…' : ''}${text}${end < cps.length || cutEnd ? '…' : ''}`;
}

/** Where `terms` are in `text` (A–Z case aside): sorted, overlaps merged, as [start, end) UTF-16 indices. */
export function highlightRanges(text: string, terms: string[]): [number, number][] {
  const low = asciiLower(text);
  const found: [number, number][] = [];
  for (const t of terms) {
    const word = asciiLower(t);
    if (!word) continue;
    for (let i = low.indexOf(word); i >= 0; i = low.indexOf(word, i + word.length)) found.push([i, i + word.length]);
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const r of found) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Why a query cannot be searched, or null: it has no words, or too many. */
export function queryProblem(q: string): string | null {
  if ([...q].length > SEARCH_LIMITS.queryMax) return `最多 ${SEARCH_LIMITS.queryMax} 个字`;
  const n = searchTerms(q).length;
  if (!n) return '输入要找的字';
  if (n > SEARCH_LIMITS.termCount) return `最多 ${SEARCH_LIMITS.termCount} 个词`;
  return null;
}
