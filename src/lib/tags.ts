import type { Tag } from '../../shared/types';

// Tag trees are arbitrary depth. Filtering by a tag includes every descendant: a photo tagged 湖
// matches a filter on 自然 and on 题材. `expand` turns a photo's direct tags into that closed set.

export interface TagNode extends Tag {
  depth: number;
  children: TagNode[];
}

export interface TagTree {
  roots: TagNode[];
  byId: Map<string, TagNode>;
  /** ids from the root down to the tag's parent */
  ancestors(id: string): string[];
  /** every id below the tag */
  descendants(id: string): string[];
  /** display path, e.g. ['题材', '自然', '湖'] */
  path(id: string): string[];
  /** direct tag ids plus all their ancestors */
  expand(ids: readonly string[]): Set<string>;
}

const bySort = (a: Tag, b: Tag) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN');

export function buildTagTree(tags: readonly Tag[]): TagTree {
  const byId = new Map<string, TagNode>();
  for (const t of tags) byId.set(t.id, { ...t, depth: 0, children: [] });
  const roots: TagNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const walk = (nodes: TagNode[], depth: number) => {
    nodes.sort(bySort);
    for (const n of nodes) {
      n.depth = depth;
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);

  const ancCache = new Map<string, string[]>();
  const ancestors = (id: string): string[] => {
    const hit = ancCache.get(id);
    if (hit) return hit;
    const out: string[] = [];
    const seen = new Set<string>([id]);
    let cur = byId.get(id)?.parentId ?? null;
    while (cur && !seen.has(cur) && byId.has(cur)) {
      out.unshift(cur);
      seen.add(cur);
      cur = byId.get(cur)!.parentId;
    }
    ancCache.set(id, out);
    return out;
  };
  const descendants = (id: string): string[] => {
    const out: string[] = [];
    const stack = [...(byId.get(id)?.children ?? [])];
    while (stack.length) {
      const n = stack.pop()!;
      out.push(n.id);
      stack.push(...n.children);
    }
    return out;
  };
  return {
    roots,
    byId,
    ancestors,
    descendants,
    path: (id) => [...ancestors(id), id].map((x) => byId.get(x)?.name ?? x),
    expand: (ids) => {
      const s = new Set<string>();
      for (const id of ids) {
        if (!byId.has(id)) continue;
        s.add(id);
        for (const a of ancestors(id)) s.add(a);
      }
      return s;
    }
  };
}

/** Photos matching every selected tag (descendants included). */
export function filterByTags<T extends { tagIds: string[] }>(items: readonly T[], selected: readonly string[], tree: TagTree): T[] {
  if (!selected.length) return items.slice();
  return items.filter((p) => {
    const set = tree.expand(p.tagIds);
    return selected.every((id) => set.has(id));
  });
}

/** Inclusive counts: how many items carry each tag or any of its descendants. */
export function inclusiveCounts(items: readonly { tagIds: string[] }[], tree: TagTree): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of items) {
    for (const id of tree.expand(p.tagIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Tags carrying a colour render as swatches (the 色调 group). */
export const isSwatch = (t: Tag) => !!t.color;
export const swatchFill = (color: string | null) =>
  color === 'mono' ? 'linear-gradient(90deg, #1C201E 50%, #FAFAF8 50%)' : color ?? 'transparent';
