// SQL fragments for the visibility rules of docs/api/conventions.md#可见性.
//
//  - list:  what shows up in lists and counts   → public, plus the viewer's own content of any visibility
//  - byId:  what can be opened by id or link    → public + unlisted, plus the viewer's own
//  - loc:   photos whose location may be shown  → the viewer's own, or not geo-hidden
//  - poi:   places offered in matching and search → provider places, the viewer's own custom places, and custom
//           places used by a public photo whose location may be shown
//
// Entries add a status to the visibility: others only ever see finished (`published`) entries. Drafts and archived
// entries are their author's alone, whatever their visibility says.
//
// A container shown to someone (a theme, an entry, a project) shows only what they could open by id: making it
// public never makes a private photo or entry public.
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

/** Projects in lists and counts: public ones, plus every project of the viewer's own. Their status hides nothing. */
export function projectList(q: Sql, viewer: string | null, a = 'pj'): string {
  return viewer ? `(${a}.visibility = 'public' OR ${a}.owner_id = ${q.p(viewer)})` : `${a}.visibility = 'public'`;
}

/** Projects that open by id or link: public and unlisted ones, plus every project of the viewer's own. */
export function projectById(q: Sql, viewer: string | null, a = 'pj'): string {
  return viewer ? `(${a}.visibility != 'private' OR ${a}.owner_id = ${q.p(viewer)})` : `${a}.visibility != 'private'`;
}

/** Entries in lists and counts: finished public ones, plus every entry of the viewer's own. */
export function entryList(q: Sql, viewer: string | null, a = 'e'): string {
  const shown = `(${a}.visibility = 'public' AND ${a}.status = 'published')`;
  return viewer ? `(${shown} OR ${a}.owner_id = ${q.p(viewer)})` : shown;
}

/** Entries that open by id or link: finished public and unlisted ones, plus every entry of the viewer's own. */
export function entryById(q: Sql, viewer: string | null, a = 'e'): string {
  const shown = `(${a}.visibility != 'private' AND ${a}.status = 'published')`;
  return viewer ? `(${shown} OR ${a}.owner_id = ${q.p(viewer)})` : shown;
}

/**
 * Custom places stay with their creator until a public photo with a shown location uses them, so a place named
 * "家" or a hotel is not offered to everyone nearby. Provider places (AMap, OSM) are public data.
 */
export function poiOffered(q: Sql, viewer: string, a = 'po'): string {
  const v = q.p(viewer);
  return `(${a}.source != 'custom' OR ${a}.created_by = ${v} OR EXISTS (SELECT 1 FROM photos vp WHERE vp.poi_id = ${a}.id AND (vp.owner_id = ${v} OR (vp.visibility = 'public' AND vp.geo_privacy != 'hidden'))))`;
}
