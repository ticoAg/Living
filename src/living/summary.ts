import type { Source } from './settings';

// What the brand line says is playing, and the drawer's switches for the parts of the link the visit opened with.

/** Names the page knows for the ids in the source; missing ones fall back to a generic word. */
export interface SourceNames {
  place: (id: string) => string | undefined;
  /** the theme's title once it has loaded (kept while a reload is in flight) */
  themeTitle: string;
  tag: (id: string) => string | undefined;
}

/** `孤山 · 杭州市 · @song`, or `全部`. */
export function sourceName(source: Source, names: SourceNames): string {
  const parts: string[] = [];
  if (source.src === 'place') parts.push(names.place(source.place) ?? '地点');
  else if (source.src === 'theme') parts.push(names.themeTitle || '主题');
  else if (source.src === 'today') parts.push('那年今日');
  else if (source.src === 'tags' && source.tags.length) {
    // ids the viewer cannot see (someone else's own tags) have no name; never print raw ids
    const tagNames = source.tags.map((id) => names.tag(id)).filter((x): x is string => !!x);
    parts.push(...(tagNames.length ? tagNames : ['标签']));
  }
  if (source.city && source.src !== 'theme') parts.push(source.city);
  if (source.user && source.src !== 'theme') parts.push(`@${source.user}`);
  return parts.length ? parts.join(' · ') : '全部';
}

/** The brand line: source, order and count once ready; just the source after an error. */
export function summaryLine(source: Source, names: SourceNames, status: 'loading' | 'error' | 'ready', count: number): string {
  const name = sourceName(source, names);
  const order = source.order === 'time' ? (source.src === 'theme' ? '按顺序' : '按时间') : '随机';
  return status === 'ready' ? `${name} · ${order} · ${count} 张` : status === 'error' ? name : `${name} · 载入中`;
}

/** The parts of the opening link that the drawer can switch off and on again. */
export type OpenedScope = Pick<Source, 'place' | 'theme' | 'city' | 'user'>;

export interface ScopeSwitch {
  key: 'place' | 'theme' | 'city' | 'user';
  label: string;
  on: boolean;
  /** the source change that flips it */
  patch: Partial<Source>;
}

export function scopeSwitches(opened: OpenedScope, source: Source, names: SourceNames): ScopeSwitch[] {
  const out: ScopeSwitch[] = [];
  if (opened.place) {
    const on = source.src === 'place';
    out.push({
      key: 'place',
      label: `地点 · ${names.place(opened.place) ?? '指定地点'}`,
      on,
      patch: on ? { src: 'all' } : { src: 'place', place: opened.place }
    });
  }
  if (opened.theme) {
    const on = source.src === 'theme';
    out.push({
      key: 'theme',
      label: `主题 · ${names.themeTitle || '指定主题'}`,
      on,
      patch: on ? { src: 'all', order: 'shuffle' } : { src: 'theme', theme: opened.theme, order: 'time' }
    });
  }
  if (opened.city) {
    const on = !!source.city;
    out.push({
      key: 'city',
      label: `城市 · ${opened.city}`,
      on,
      patch: on ? { city: '', ...(source.src === 'city' ? { src: 'all' as const } : {}) } : { city: opened.city }
    });
  }
  if (opened.user) {
    out.push({ key: 'user', label: `仅 @${opened.user}`, on: !!source.user, patch: { user: source.user ? '' : opened.user } });
  }
  return out;
}
