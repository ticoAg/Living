import type { TagNode, TagTree } from '../lib/tags';

// The logic behind the tag board (TagPicker): which preset tags exclude each other, how a selection changes when a
// tag is toggled or a batch's tags are applied to another photo, and how the tree is laid out as one row per root.
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

/** Another photo's tags plus `add`; where they clash, `add` wins (applying 秋 to a photo tagged 春 makes it 秋). */
export function mergeTags(value: readonly string[], add: readonly string[]): string[] {
  let out = [...value];
  for (const id of add) if (!out.includes(id)) out = withTag(out, id);
  return out;
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
