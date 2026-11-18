// Input limits the Worker enforces, shared so the SPA's maxLength, hints and pre-checks say the same numbers.
// Docs: /docs/api/conventions.md
// Text lengths are in Unicode code points (the Worker's cpLen), except passwords, which count UTF-16 units (`.length`).
// Purely technical caps (body bytes, id formats, query page sizes) stay next to the code that needs them.

import { POI_LIMITS } from './types';

/** Place edit form (`PATCH /api/pois/:id`); defined in types.ts next to `UpdatePoiBody`. */
export { POI_LIMITS };

/** Place search (`GET /api/pois?q=`). */
export const POI_SEARCH_LIMITS = {
  queryMax: 60
} as const;

/** Searching one's archive (`GET /api/search?q=`). */
export const SEARCH_LIMITS = {
  queryMax: 100,
  /** words of one query; a quoted phrase is one */
  termCount: 5
} as const;

/** Province, city and district names, on photos and on new places. */
export const REGION_LIMITS = {
  nameMax: 60
} as const;

/** Photo upload meta and `PATCH /api/photos/:id`. */
export const PHOTO_LIMITS = {
  titleMax: 200,
  noteMax: 5000,
  cameraMax: 120,
  lensMax: 120,
  shutterMax: 30,
  /** tags on one photo, also suggested tags */
  tagCount: 200,
  /** themes one upload can join */
  themeCount: 50
} as const;

/** `POST /api/themes`, `PATCH /api/themes/:id`. */
export const THEME_LIMITS = {
  titleMax: 100,
  subtitleMax: 200,
  introMax: 20000,
  /** items in one theme (`PUT /api/themes/:id/items`), also photos in `photoIds` */
  itemCount: 1000
} as const;

/** One item of `PUT /api/themes/:id/items`. */
export const THEME_ITEM_LIMITS = {
  /** caption under a photo or a day heading */
  captionMax: 5000,
  /** a text paragraph */
  textMax: 20000
} as const;

/** `POST /api/entries`, `PATCH /api/entries/:id`. */
export const ENTRY_LIMITS = {
  titleMax: 200,
  /** Markdown, as written */
  bodyMax: 50000,
  /** photos one entry shows */
  mediaCount: 200,
  /** under one photo of an entry */
  captionMax: 2000,
  tagCount: 200
} as const;

/** `POST /api/projects`, `PATCH /api/projects/:id`. */
export const PROJECT_LIMITS = {
  titleMax: 100,
  /** Markdown */
  descriptionMax: 5000,
  /** projects one entry belongs to */
  perEntry: 50
} as const;

/** `POST /api/projects/:id/milestones` and its `PATCH`. */
export const MILESTONE_LIMITS = {
  titleMax: 100,
  /** Markdown */
  bodyMax: 20000,
  /** milestones of one project */
  count: 500
} as const;

export const TAG_LIMITS = {
  nameMax: 24
} as const;

/** Register, profile, password. */
export const ACCOUNT_LIMITS = {
  handleMin: 3,
  handleMax: 24,
  displayNameMax: 40,
  bioMax: 500,
  passwordMin: 8,
  passwordMax: 256
} as const;

/** Handle format: starts with a letter or digit, then letters, digits, `_` and `-`, within the handle length range. */
export const HANDLE_RE = new RegExp(`^[a-zA-Z0-9][a-zA-Z0-9_-]{${ACCOUNT_LIMITS.handleMin - 1},${ACCOUNT_LIMITS.handleMax - 1}}$`);

export const PRIVACY_ZONE_LIMITS = {
  nameMax: 40,
  /** metres */
  radiusMin: 50,
  radiusMax: 5000,
  /** zones per user */
  count: 50
} as const;

/** Rows in one request to `/api/import/*`; the browser also keeps each request's JSON to about 1 MB. */
export const IMPORT_LIMITS = {
  /** ids (for photos, SHA-256) of each kind in one `resolve` */
  resolve: 1000,
  tags: 2000,
  places: 500,
  zones: 10,
  projects: 50,
  entries: 100,
  collections: 20
} as const;

/** `POST /api/admin/invites`. */
export const INVITE_LIMITS = {
  noteMax: 200,
  expiresInDaysMin: 1,
  expiresInDaysMax: 365
} as const;
