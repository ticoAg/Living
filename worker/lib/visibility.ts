// SQL fragments for the visibility rules of docs/api/conventions.md#可见性.
//
//  - list:  what shows up in lists and counts   → public, plus the viewer's own content of any visibility
//  - byId:  what can be opened by id or link    → public + unlisted, plus the viewer's own
//  - loc:   photos whose location may be shown  → the viewer's own, or not geo-hidden
//
// Each helper registers its parameter on `q` and returns SQL text; `a` is the table alias.

import type { Sql } from './sql';

export function photoList(q: Sql, viewer: string | null, a = 'p'): string {
  return viewer ? `(${a}.visibility = 'public' OR ${a}.owner_id = ${q.p(viewer)})` : `${a}.visibility = 'public'`;
}

export function photoById(q: Sql, viewer: string | null, a = 'p'): string {
  return viewer ? `(${a}.visibility != 'private' OR ${a}.owner_id = ${q.p(viewer)})` : `${a}.visibility != 'private'`;
}

export function photoLocation(q: Sql, viewer: string | null, a = 'p'): string {
  return viewer ? `(${a}.owner_id = ${q.p(viewer)} OR ${a}.geo_privacy != 'hidden')` : `${a}.geo_privacy != 'hidden'`;
}

export function themeList(q: Sql, viewer: string | null, a = 'th'): string {
  return viewer ? `(${a}.visibility = 'public' OR ${a}.owner_id = ${q.p(viewer)})` : `${a}.visibility = 'public'`;
}
