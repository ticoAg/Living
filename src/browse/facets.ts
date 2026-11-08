import type { TagTree } from '../lib/tags';
import { dayPart } from '../lib/format';

// Season and time-of-day facets shared by the place and map pages.

export const SEASONS = [
  { id: 'spring', label: '春' },
  { id: 'summer', label: '夏' },
  { id: 'autumn', label: '秋' },
  { id: 'winter', label: '冬' }
] as const;
export const DAY_PARTS = ['晨', '昼', '暮', '夜'] as const;
export type DayPart = (typeof DAY_PARTS)[number];

interface Taggable {
  tagIds: string[];
  takenAt: string | null;
}

/** Season of a photo: the preset season tag (or a child of it), else the northern-hemisphere month. */
export function seasonOf(p: Taggable, tree: TagTree | undefined): string {
  const set = tree ? tree.expand(p.tagIds) : new Set(p.tagIds);
  for (const s of SEASONS) if (set.has(s.id)) return s.id;
  const m = p.takenAt ? Number(p.takenAt.slice(5, 7)) : 0;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  if (m === 12 || (m >= 1 && m <= 2)) return 'winter';
  return '';
}

export const partOf = (p: Pick<Taggable, 'takenAt'>): DayPart | '' => dayPart(p.takenAt) as DayPart | '';

/** Leaf tags under the 光与天气 root, in tree order (白昼 is the unmarked default and is left out, as in the docs). */
export function lightTags(tree: TagTree | undefined): { id: string; name: string }[] {
  const root = tree?.byId.get('light');
  if (!tree || !root) return [];
  const out: { id: string; name: string }[] = [];
  const walk = (n: (typeof root)['children'][number]) => {
    if (n.children.length) n.children.forEach(walk);
    else if (n.id !== 'daylight') out.push({ id: n.id, name: n.name });
  };
  root.children.forEach(walk);
  return out;
}
