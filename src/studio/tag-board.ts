import type { TagNode, TagTree } from '../lib/tags';

// The logic behind the tag board (TagPicker): which preset tags exclude each other, how a photo's tags change when one
// is added or taken off, what several photos have in common, and how the tree is laid out as one row per root.
// Docs: /docs/product/features/hierarchical-tags.md#打标签

/**
 * Preset tags a photo has at most one of: its season, its light, its dominant tone. Picking one drops the others of its
 * set. Weather (雾 雨 雪) and subjects combine freely, and so do the tags people add themselves, wherever they sit.
 */
export const EXCLUSIVE: readonly (readonly string[])[] = [
  ['spring', 'summer', 'autumn', 'winter'],
  ['morning', 'daylight', 'sunset', 'bluehour', 'night'],
  ['warm', 'cool', 'green', 'blue', 'mono']
];

const rivals = new Map<string, readonly string[]>();
for (const set of EXCLUSIVE) for (const id of set) rivals.set(id, set);

/** The selection with `id` added and the tags it excludes removed, order kept. */
export function withTag(value: readonly string[], id: string): string[] {
  const set = rivals.get(id);
  const out = value.filter((v) => v !== id && !(set && set.includes(v)));
  out.push(id);
  return out;
}

/** Clicking a tag: off when it is on, else on (dropping the tags it excludes). */
export function toggleTag(value: readonly string[], id: string): string[] {
  return value.includes(id) ? value.filter((v) => v !== id) : withTag(value, id);
}

/** One change to the tags of the photo, or photos, being edited. */
export interface TagEdit {
  op: 'add' | 'remove';
  id: string;
}

/**
 * A photo's tags after an edit: an added tag drops the ones it excludes, so 秋 added to a photo tagged 春 makes it 秋;
 * a photo that has the tag already keeps its tags as they are.
 */
export function applyTagEdit(value: readonly string[], e: TagEdit): string[] {
  if (e.op === 'remove') return value.filter((v) => v !== e.id);
  return value.includes(e.id) ? [...value] : withTag(value, e.id);
}

/** For several photos: the tags all of them have and the tags only some have, each in order of first appearance. */
export function commonTags(lists: readonly (readonly string[])[]): { all: string[]; some: string[] } {
  const order: string[] = [];
  const count = new Map<string, number>();
  for (const list of lists) {
    for (const id of new Set(list)) {
      if (!count.has(id)) order.push(id);
      count.set(id, (count.get(id) ?? 0) + 1);
    }
  }
  return {
    all: order.filter((id) => count.get(id) === lists.length),
    some: order.filter((id) => count.get(id)! < lists.length)
  };
}

export interface BoardItem {
  node: TagNode;
  /** depth below the row's root: 1 for 自然, 2 for 湖, 3 for a tag someone put under 湖 */
  level: number;
  /** has tags below it: drawn as the small label that starts a group */
  group: boolean;
}

export interface BoardRow {
  root: TagNode;
  items: BoardItem[];
}

/** One row per root (题材, 光与天气, 季节, 色调, then people's own roots), its tags in tree order. */
export function boardRows(tree: TagTree): BoardRow[] {
  return tree.roots.map((root) => {
    const items: BoardItem[] = [];
    const walk = (nodes: TagNode[], level: number) => {
      for (const n of nodes) {
        items.push({ node: n, level, group: n.children.length > 0 });
        walk(n.children, level + 1);
      }
    };
    walk(root.children, 1);
    return { root, items };
  });
}

/** Lower-case name match, ignoring spaces: what the board's search box keeps. */
export const tagMatches = (name: string, query: string) =>
  name.replace(/\s+/g, '').toLowerCase().includes(query.replace(/\s+/g, '').toLowerCase());

/**
 * The rows narrowed to tags whose name contains `query` (a root whose own name matches keeps all of its tags), and
 * whether one of them is named exactly that, so the board knows when to offer "新建".
 */
export function searchBoard(rows: readonly BoardRow[], query: string): { rows: BoardRow[]; exact: boolean } {
  const q = query.trim();
  if (!q) return { rows: [...rows], exact: false };
  let exact = false;
  const out: BoardRow[] = [];
  for (const row of rows) {
    if (row.root.name === q) exact = true;
    if (tagMatches(row.root.name, q)) {
      out.push(row);
      continue;
    }
    const items = row.items.filter((it) => tagMatches(it.node.name, q));
    if (items.some((it) => it.node.name === q)) exact = true;
    if (items.length) out.push({ root: row.root, items: items.map((it) => ({ ...it, group: false })) });
  }
  return { rows: out, exact };
}

/** The tags a (searched) board offers, in reading order: what ↑ ↓ walk through and Enter takes from the search box. */
export function boardChoices(rows: readonly BoardRow[]): TagNode[] {
  return rows.flatMap((r) => [...(r.root.ownerId ? [r.root] : []), ...r.items.map((it) => it.node)]);
}

/** Where Enter starts: the tag named exactly like the query, else the first one offered. */
export function firstChoice(choices: readonly TagNode[], query: string): number {
  const at = choices.findIndex((n) => n.name === query.trim());
  return at >= 0 ? at : 0;
}
