// API contract shared by the Worker and the SPA. Docs: /docs/api/
// All JSON keys are camelCase; D1 columns are snake_case.

export type Role = 'owner' | 'admin' | 'member';
export const VISIBILITIES = ['public', 'unlisted', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export type GeoPrivacy = 'exact' | 'fuzzy' | 'hidden';
export type PoiMethod = 'auto' | 'confirmed' | 'inferred' | 'manual';
export type PoiSource = 'custom' | 'amap' | 'osm';
export type ThemeKind = 'trip' | 'topic';
/** What an item of a theme (合集) holds. The list may grow (the column has no CHECK). docs/data/theme-items.md */
export const THEME_ITEM_KINDS = ['photo', 'text', 'day', 'entry'] as const;
export type ThemeItemKind = (typeof THEME_ITEM_KINDS)[number];

/** What an entry records. The list may grow (the column has no CHECK); labels in shared/entries.ts. docs/data/entries.md */
export const ENTRY_TYPES = ['note', 'article', 'reading', 'practice', 'creation', 'trip'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];
/** draft: unfinished, only its author sees it; published: finished, in the timeline; archived: put away. Not visibility. */
export const ENTRY_STATUSES = ['draft', 'published', 'archived'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** What a project is about. The list may grow (no CHECK); labels in shared/projects.ts. docs/data/projects.md */
export const PROJECT_TYPES = ['learning', 'practice', 'reading', 'creation', 'other'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];
export const PROJECT_STATUSES = ['active', 'paused', 'completed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** POI categories double as map-legend symbols. */
export const POI_CATEGORIES = [
  '桥',
  '堤',
  '湖',
  '山',
  '塔',
  '寺',
  '亭',
  '园',
  '岛',
  '村',
  '景',
  '街区',
  '建筑',
  '美术馆',
  '海岸',
  '店',
  '道路'
] as const;
export type PoiCategory = (typeof POI_CATEGORIES)[number];

export interface UserPublic {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarPhotoId: string | null;
}
export interface SessionUser extends UserPublic {
  role: Role;
  /** Who sees a new photo unless its upload says otherwise: the account's setting, `private` for new accounts. */
  photoVisibility: Visibility;
}
export interface UserProfile extends UserPublic {
  photoCount: number;
  themeCount: number;
  /** Entries the requester may see in lists: finished public ones, or all of one's own. */
  entryCount: number;
  /** Projects the requester may see in lists: public ones, or all of one's own. */
  projectCount: number;
  createdAt: string;
}

export interface Variant {
  /** R2 key, served at `/media/${key}` */
  key: string;
  w: number;
  h: number;
}
export interface Variants {
  s: Variant; // long edge 480
  m: Variant; // long edge 1600
  l: Variant; // long edge 2560
}

export interface PhotoSummary {
  id: string;
  ownerId: string;
  ownerHandle: string;
  title: string | null;
  /** Local wall-clock time of capture, `YYYY-MM-DDTHH:mm:ss` (no offset; see `tz` on detail). */
  takenAt: string | null;
  width: number;
  height: number;
  thumbhash: string | null;
  variants: Variants;
  /** Dominant colours, hex, most dominant first. */
  palette: string[] | null;
  poiId: string | null;
  /** Province-level division (省、自治区、直辖市), from reverse geocoding; null when unknown. Always shown, like `city`. */
  province: string | null;
  city: string | null;
  /** District or county (区、县); hidden from others with `geoPrivacy: 'hidden'`. */
  district: string | null;
  tagIds: string[];
  visibility: Visibility;
  geoPrivacy: GeoPrivacy;
  /** Present only when `geoPrivacy` allows (exact, or rounded for fuzzy). */
  lat: number | null;
  lng: number | null;
  heading: number | null;
  inLiving: boolean;
  favorite: boolean;
  hasNote: boolean;
  /** Crop centre for cover fits, 0..1 each. */
  focus: [number, number] | null;
}

/**
 * The most photos `GET /api/photos` returns, newest capture first. There is no paging: past it the oldest photos are
 * left out and the response says `truncated`. docs/api/photos.md
 */
export const PHOTO_LIST_LIMIT = 5000;

/** Ids one `GET /api/photos?ids=` may name; more are asked for in parts. */
export const PHOTO_IDS_LIMIT = 200;

/** `GET /api/photos`. */
export interface PhotoListResponse {
  photos: PhotoSummary[];
  /** More photos matched than `PHOTO_LIST_LIMIT`; the oldest were left out. */
  truncated: boolean;
}

export interface PhotoDetail extends PhotoSummary {
  note: string | null;
  tz: string | null;
  alt: number | null;
  /** The place; null for others when `geoPrivacy` is `hidden`. */
  poi: Poi | null;
  /** Metres from the photo to the place; for others only with `geoPrivacy: 'exact'` (with fuzzy it would undo the rounding). */
  poiDistance: number | null;
  poiMethod: PoiMethod | null;
  camera: string | null;
  lens: string | null;
  focal: number | null;
  focal35: number | null;
  aperture: number | null;
  shutter: string | null;
  iso: number | null;
  themes: { id: string; title: string }[];
  /** Entries showing this photo that the requester may see in lists (the owner: all of theirs), latest first. */
  entries: PhotoEntryRef[];
  uploadedAt: string;
  updatedAt: string | null;
}

/** An entry as a photo page links to it. */
export interface PhotoEntryRef {
  id: string;
  /** The title, else the body's first line as plain text, else the type's name. */
  label: string;
  occurredAt: string;
}

export interface Tag {
  id: string;
  name: string;
  parentId: string | null;
  /** null = system preset */
  ownerId: string | null;
  /** hex colour, or 'mono' for black-and-white swatches */
  color: string | null;
  sort: number;
  /** Photos tagged directly with this tag, visible to the requester. Inclusive counts are computed client-side. */
  count: number;
  /** Entries tagged directly with this tag that the requester may see in lists (the owner: all of theirs). */
  entryCount: number;
}

export interface Poi {
  id: string;
  name: string;
  category: string;
  city: string | null;
  district: string | null;
  lat: number;
  lng: number;
  /** Matching radius in metres. */
  radius: number;
  source: PoiSource;
  sourceId: string | null;
  /** Photos at this POI visible to the requester (list endpoint only). */
  count?: number;
}

/** A place as `GET /api/pois/:id` and `PATCH /api/pois/:id` return it, with what the edit form needs. */
export interface PoiDetail extends Poi {
  /** The requester may change this place: its creator, an owner or an admin. Who created it is never sent. */
  canEdit: boolean;
  /** Other names the place is found by when searching. Only sent together with `canEdit: true`. */
  aliases?: string[];
}

/** Body of `PATCH /api/pois/:id`. Every field is optional; what is left out stays as it was. */
export interface UpdatePoiBody {
  name?: string;
  category?: string;
  /** Matching radius in metres, within `POI_LIMITS`. */
  radius?: number;
  /** Replaces the whole list; an empty list clears it. */
  aliases?: string[];
}

/** What `PATCH /api/pois/:id` accepts, shared so the edit form can check before it sends. */
export const POI_LIMITS = {
  /** characters (code points) of the name */
  nameMax: 80,
  /** metres */
  radiusMin: 10,
  radiusMax: 5000,
  aliasCount: 20,
  /** characters of one alias */
  aliasMax: 80
} as const;

export interface MatchCandidate {
  /** Stable key for the list: poi id, or `${source}:${sourceId}` for provider results. */
  key: string;
  poiId: string | null;
  name: string;
  category: string;
  lat: number;
  lng: number;
  /** metres from the photo; 0 when `area` is true */
  distance: number;
  /** degrees clockwise from north, photo → candidate */
  bearing: number;
  /** candidate lies within ±30° of the camera heading */
  inView: boolean;
  /** lower is better */
  score: number;
  source: 'local' | 'amap' | 'osm';
  sourceId: string | null;
  /** the photo lies inside this area POI (lake, park, district) */
  area: boolean;
  city: string | null;
  district: string | null;
}
export interface MatchRequest {
  lat: number;
  lng: number;
  heading?: number | null;
  /** search radius in metres, default 300, max 1000 */
  radius?: number;
}
export interface MatchResponse {
  candidates: MatchCandidate[];
  /** province-level division of the point, from the reverse geocode only */
  province: string | null;
  city: string | null;
  district: string | null;
  provider: 'amap' | 'osm' | 'local';
  /** the point lies inside one of the user's privacy zones */
  privacyZone: string | null;
}

export interface NewPoi {
  name: string;
  category: string;
  lat: number;
  lng: number;
  city?: string | null;
  district?: string | null;
  source?: PoiSource;
  sourceId?: string | null;
}

/** JSON part `meta` of the multipart upload to POST /api/photos */
export interface CreatePhotoMeta {
  title?: string | null;
  note?: string | null;
  takenAt?: string | null;
  tz?: string | null;
  lat?: number | null;
  lng?: number | null;
  alt?: number | null;
  heading?: number | null;
  geoPrivacy?: GeoPrivacy;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  /** existing POI id */
  poiId?: string | null;
  /** or a POI to create (provider result or custom) */
  newPoi?: NewPoi | null;
  poiDistance?: number | null;
  poiMethod?: PoiMethod | null;
  camera?: string | null;
  lens?: string | null;
  focal?: number | null;
  focal35?: number | null;
  aperture?: number | null;
  shutter?: string | null;
  iso?: number | null;
  width: number;
  height: number;
  /** pixel sizes of the uploaded variants */
  variantSizes: { s: [number, number]; m: [number, number]; l: [number, number] };
  thumbhash?: string | null;
  palette?: string[] | null;
  focus?: [number, number] | null;
  /** left out: the uploader's `photoVisibility` */
  visibility?: Visibility;
  inLiving?: boolean;
  favorite?: boolean;
  sha256?: string | null;
  tagIds?: string[];
  suggestedTagIds?: string[];
  /** add the new photo to these themes (appended) */
  themeIds?: string[];
}

export interface UpdatePhotoBody {
  title?: string | null;
  note?: string | null;
  takenAt?: string | null;
  geoPrivacy?: GeoPrivacy;
  visibility?: Visibility;
  inLiving?: boolean;
  favorite?: boolean;
  focus?: [number, number] | null;
  poiId?: string | null;
  newPoi?: NewPoi | null;
  poiMethod?: PoiMethod | null;
  /** replaces the full tag set */
  tagIds?: string[];
}

export interface ThemeSummary {
  id: string;
  ownerId: string;
  ownerHandle: string;
  kind: ThemeKind;
  title: string;
  subtitle: string | null;
  coverPhotoId: string | null;
  cover: PhotoSummary | null;
  startDate: string | null;
  endDate: string | null;
  visibility: Visibility;
  /** Photos as the requester sees them: photo items, and the photos of the entry items, each time it shows. */
  photoCount: number;
  /** Entry items the requester may open. */
  entryCount: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

/** An entry as a theme shows it: its summary and the photos of it the requester may open, in order. */
export interface ThemeEntry extends EntrySummary {
  photos: PhotoSummary[];
}

/**
 * An item the requester may not open (a private photo, an unfinished or private entry) keeps its place with `photo` or
 * `entry` null; readers leave it out.
 */
export type ThemeItem =
  | { id: string; kind: 'photo'; photoId: string; text: string | null; photo: (PhotoSummary & { note: string | null }) | null }
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'day'; day: string; text: string | null }
  | { id: string; kind: 'entry'; entryId: string; text: string | null; entry: ThemeEntry | null };

export interface ThemeDetail extends ThemeSummary {
  intro: string | null;
  items: ThemeItem[];
  /** POIs of the photos, entry photos included, for the route map */
  pois: Poi[];
}

export interface CreateThemeBody {
  kind: ThemeKind;
  title: string;
  subtitle?: string | null;
  intro?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  visibility?: Visibility;
  coverPhotoId?: string | null;
  /** seed the theme with these photos, in order */
  photoIds?: string[];
}
export type UpdateThemeBody = Partial<CreateThemeBody>;
export interface PutThemeItemsBody {
  items: (
    | { kind: 'photo'; photoId: string; text?: string | null }
    | { kind: 'text'; text: string }
    | { kind: 'day'; day: string; text?: string | null }
    | { kind: 'entry'; entryId: string; text?: string | null }
  )[];
}

// ---- entries (docs/api/entries.md) ----------------------------------------------------------------------------------

/** Code points of the body an entry summary carries (`excerpt`). */
export const ENTRY_EXCERPT_MAX = 300;

/**
 * The most entries `GET /api/entries` returns, latest first. There is no paging: past it the oldest are left out and
 * the response says `truncated`, as with photos.
 */
export const ENTRY_LIST_LIMIT = 5000;

export interface EntrySummary {
  id: string;
  ownerId: string;
  ownerHandle: string;
  type: EntryType;
  title: string | null;
  /** The start of the body as written (Markdown), at most ENTRY_EXCERPT_MAX code points, cut at a line break if it can. */
  excerpt: string | null;
  /** The body goes on past `excerpt`. */
  hasMore: boolean;
  /** How long the body is, in code points (Markdown as written); 0 without one. */
  chars: number;
  /**
   * When it happened, local wall-clock time like a photo's `takenAt`: `YYYY-MM-DD` when only the day is known,
   * else `YYYY-MM-DDTHH:mm:ss`. When it was written down is `createdAt`.
   */
  occurredAt: string;
  visibility: Visibility;
  status: EntryStatus;
  /** Its photos the requester may see, in order. */
  photoIds: string[];
  /** Direct tags. */
  tagIds: string[];
  /** Projects it belongs to that the requester may see in lists: public ones, or all of one's own. */
  projectIds: string[];
  /** Where it happened, as its author chose; shown to whoever may see the entry, with where it is on the map. */
  poi: LocatedPlace | null;
  /** Its videos, recordings and files, in order: whoever may see the entry may play or download them. */
  attachments: AttachmentBrief[];
  createdAt: string;
  updatedAt: string;
}

/** An entry's place: what a card or the reader shows of it, and the id the place page opens. */
export type EntryPlace = Pick<Poi, 'id' | 'name' | 'category' | 'city' | 'district'>;
/** An entry's place as the entry carries it: with its position, where the map puts the entry. */
export type LocatedPlace = EntryPlace & Pick<Poi, 'lat' | 'lng'>;

/** `GET /api/entries`. */
export interface EntryListResponse {
  entries: EntrySummary[];
  /** More entries matched than ENTRY_LIST_LIMIT; the oldest were left out. */
  truncated: boolean;
}

export interface EntryMedia {
  photoId: string;
  caption: string | null;
  photo: PhotoSummary;
}

export interface EntryDetail extends Omit<EntrySummary, 'attachments'> {
  body: string | null;
  /** Its photos the requester may see, in order, with their captions; the others are left out. */
  media: EntryMedia[];
  /** Its attachments, in order, with their captions. */
  attachments: EntryAttachment[];
  /** One more with every change. Send it back with `PATCH` to hear (409) about a change made elsewhere meanwhile. */
  revision: number;
  /** Themes (合集) holding it that the requester may see in lists: public ones, or all of one's own. */
  themes: { id: string; title: string }[];
}

export interface EntryMediaInput {
  photoId: string;
  caption?: string | null;
}

/** `POST /api/entries`. Only `occurredAt` is required: the browser knows the local time, the Worker does not. */
export interface CreateEntryBody {
  /** default `note` */
  type?: EntryType;
  title?: string | null;
  /** Markdown */
  body?: string | null;
  occurredAt: string;
  /** default `private` */
  visibility?: Visibility;
  /** default `published` */
  status?: EntryStatus;
  /** One's own photos, in order. */
  media?: EntryMediaInput[];
  /** One's own uploaded attachments, in order: loose ones, or ones this entry has already. */
  attachments?: EntryAttachmentInput[];
  tagIds?: string[];
  /** One's own projects; other ids are dropped. */
  projectIds?: string[];
  /** An existing place (`POST /api/pois` makes one from a search result); null or left out: none. */
  poiId?: string | null;
}

/** `PATCH /api/entries/:id`: what is given changes; `media`, `attachments` and `tagIds` replace the whole list. */
export interface UpdateEntryBody extends Partial<CreateEntryBody> {
  /** The revision this edit started from; when the entry has moved on, the answer is 409 and nothing changes. */
  revision?: number;
}

// ---- attachments (docs/api/attachments.md) --------------------------------------------------------------------------
// Videos, recordings and other files, kept as uploaded. An attachment is its author's and belongs to one entry; it has
// no visibility of its own: whoever may open the entry may play or download it.

/** A video, a recording (or any sound), or another file. */
export const ATTACHMENT_KINDS = ['video', 'audio', 'file'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** An attachment. Its file is at `/media/a/<id>` (`?download=1` to save it), a video's frame at `/media/a/<id>/poster`. */
export interface Attachment {
  id: string;
  kind: AttachmentKind;
  /** the file's name as uploaded */
  name: string;
  mime: string;
  /** bytes */
  size: number;
  /** seconds; null when the browser that uploaded it could not tell */
  duration: number | null;
  /** a video's, in pixels */
  width: number | null;
  height: number | null;
  /** a video has a frame to show before it plays */
  poster: boolean;
  createdAt: string;
}

/** One of an entry's attachments, with what the entry says under it. */
export interface EntryAttachment extends Attachment {
  caption: string | null;
}

/** What a list says of an entry's attachments: enough for a card. */
export type AttachmentBrief = Pick<Attachment, 'id' | 'kind' | 'duration' | 'poster'>;

export interface EntryAttachmentInput {
  attachmentId: string;
  caption?: string | null;
}

/** Where an attachment is: its file still coming in, uploaded but in no entry, or in one. */
export type AttachmentState = 'uploading' | 'loose' | 'attached';

/** An attachment as its author's upload sees it. */
export interface OwnAttachment extends Attachment {
  state: AttachmentState;
  entryId: string | null;
}

/** `POST /api/attachments`: a file about to be uploaded. */
export interface CreateAttachmentBody {
  kind: AttachmentKind;
  name: string;
  /** what the file is, `type/subtype`; a video's must be `video/…`, a recording's `audio/…` */
  mime: string;
  /** bytes */
  size: number;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
}

/** `POST /api/attachments` (201): the file goes up as `parts` parts, each `partBytes` long but the last. */
export interface AttachmentUpload {
  attachment: OwnAttachment;
  partBytes: number;
  parts: number;
}

/** `PUT /api/attachments/:id/parts/:n`. */
export interface AttachmentPart {
  partNumber: number;
  etag: string;
}

/** `POST /api/attachments/:id/complete`: every part, as the part uploads answered. */
export interface CompleteAttachmentBody {
  parts: AttachmentPart[];
}

/** `POST /api/attachments/:id/complete`, `PUT /api/attachments/:id/poster`. */
export interface AttachmentResponse {
  attachment: OwnAttachment;
}

// ---- library (docs/api/library.md) ----------------------------------------------------------------------------------

/** The most attachments `GET /api/library` lists, newest first; past it the response says `truncated`. */
export const LIBRARY_ATTACHMENTS_LIMIT = 5000;

/** The entry an attachment is in, as its author's library names it. */
export interface LibraryEntryRef extends PhotoEntryRef {
  visibility: Visibility;
  status: EntryStatus;
}

/** One's attachment as the library lists it. */
export interface LibraryAttachment extends OwnAttachment {
  /** what its entry says under it */
  caption: string | null;
  /** when its file came in whole; null while uploading */
  uploadedAt: string | null;
  /** UTC: when the hourly cleanup deletes one in no entry (within the hour after); null while it is in one */
  purgeAt: string | null;
  entry: LibraryEntryRef | null;
}

/** How many, and their bytes. */
export interface LibraryCount {
  count: number;
  bytes: number;
}

/** `GET /api/library`: one's attachments, what one keeps here, and which of one's photos are in one's entries. */
export interface LibraryResponse {
  attachments: LibraryAttachment[];
  truncated: boolean;
  /** photos: their original files (the sizes made from them not counted); attachments: those uploaded whole */
  usage: Record<'photos' | AttachmentKind, LibraryCount>;
  /** one's photos that are in at least one of one's entries */
  entryPhotoIds: string[];
}

// ---- share links (docs/api/shares.md) -------------------------------------------------------------------------------

/** What a share link can open: an entry, a collection (theme) or a project. */
export const SHARE_KINDS = ['entry', 'theme', 'project'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/** Days a new link may run for; left out or null: until it is deleted. */
export const SHARE_DAYS_MAX = 365;
/** Links one item may have at a time, and one person in all. */
export const SHARE_LIMITS = { perItem: 20, perOwner: 500 } as const;

/** A share link as its owner sees it (`GET /api/shares`). The address to hand out is `/s/<token>`. */
export interface ShareLink {
  id: string;
  token: string;
  kind: ShareKind;
  /** The shared entry, theme or project. */
  targetId: string;
  /** Its title as the owner sees it; an entry without one: the start of its text, or its type. */
  targetTitle: string;
  createdAt: string;
  /** UTC; null: until deleted. A link past it opens nothing and is listed until deleted. */
  expiresAt: string | null;
}

/** `POST /api/shares`. */
export interface CreateShareBody {
  kind: ShareKind;
  id: string;
  /** 1 to SHARE_DAYS_MAX; left out or null: until deleted. */
  expiresInDays?: number | null;
}

/** `POST /api/shares/open`: the link works; the browser now holds it, and the item opens at its usual address. */
export interface OpenShareResponse {
  kind: ShareKind;
  id: string;
}

// ---- projects (docs/api/projects.md) ----------------------------------------------------------------------------------

export interface ProjectSummary {
  id: string;
  ownerId: string;
  ownerHandle: string;
  type: ProjectType;
  title: string;
  /** Markdown: what it is for, the plan. */
  description: string | null;
  /** `YYYY-MM-DD`, the author's local day. */
  startDate: string;
  /** The planned or actual last day; null when open-ended. */
  endDate: string | null;
  status: ProjectStatus;
  visibility: Visibility;
  /**
   * Its finished entries the requester may open (the author's own: all finished ones), and of those the days they
   * happened on, their photos the requester may open, and the latest `occurredAt`. Drafts and archived entries are
   * not counted.
   */
  entryCount: number;
  dayCount: number;
  photoCount: number;
  lastOccurredAt: string | null;
  /** The latest of those photos. */
  cover: PhotoSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  /** Markdown: what the stage it closes came to. */
  body: string | null;
  /** `YYYY-MM-DD`: the day it was reached, or the day aimed at while it is still ahead. */
  date: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  /** By date, earliest first. */
  milestones: Milestone[];
  /**
   * The photos of its entries that the requester may open, in the entries the requester may open (the author: every
   * entry of theirs in it, drafts too). Enough to show those entries without the author's whole library.
   */
  photos: PhotoSummary[];
}

/** `GET /api/projects`. */
export interface ProjectListResponse {
  projects: ProjectSummary[];
}

/** `POST /api/projects`. `startDate` is required: the browser knows the local day, the Worker does not. */
export interface CreateProjectBody {
  title: string;
  /** default `other` */
  type?: ProjectType;
  description?: string | null;
  startDate: string;
  endDate?: string | null;
  /** default `active` */
  status?: ProjectStatus;
  /** default `private` */
  visibility?: Visibility;
}

/** `PATCH /api/projects/:id`: what is given changes. */
export type UpdateProjectBody = Partial<CreateProjectBody>;

/** `POST /api/projects/:id/milestones`. */
export interface CreateMilestoneBody {
  title: string;
  body?: string | null;
  date: string;
}

/** `PATCH /api/projects/:id/milestones/:milestoneId`. */
export type UpdateMilestoneBody = Partial<CreateMilestoneBody>;

// ---- search (docs/api/search.md) -------------------------------------------------------------------------------------

/** The groups of `GET /api/search`, in the order a results page shows them. */
export const SEARCH_GROUPS = ['entries', 'photos', 'projects', 'themes', 'places', 'tags'] as const;
export type SearchGroupName = (typeof SEARCH_GROUPS)[number];

/** Hits a group carries when the whole archive is searched; `?in=<group>` asks one group for up to SEARCH_GROUP_MAX. */
export const SEARCH_HITS: Record<SearchGroupName, number> = { entries: 50, photos: 60, projects: 20, themes: 20, places: 20, tags: 20 };
export const SEARCH_GROUP_MAX = 500;

/** One group: its first hits and how many matched in all. */
export interface SearchGroup<T> {
  hits: T[];
  total: number;
}

export interface SearchEntryHit {
  id: string;
  type: EntryType;
  title: string | null;
  /** The title, else the body's first line as plain text, else the type's name. */
  label: string;
  occurredAt: string;
  status: EntryStatus;
  visibility: Visibility;
  /** Its first photo. */
  photo: PhotoSummary | null;
  /** Plain text around the first word found in the body or a caption, else the start of the body; null without one. */
  snippet: string | null;
}

export interface SearchPhotoHit extends PhotoSummary {
  /** Plain text around the first word found in the note, else its start; null without a note. */
  snippet: string | null;
}

export interface SearchProjectHit {
  id: string;
  type: ProjectType;
  title: string;
  status: ProjectStatus;
  visibility: Visibility;
  startDate: string;
  endDate: string | null;
  /** From the description or a milestone (its title, then its summary). */
  snippet: string | null;
}

export interface SearchThemeHit {
  id: string;
  kind: ThemeKind;
  title: string;
  subtitle: string | null;
  visibility: Visibility;
  startDate: string | null;
  endDate: string | null;
  cover: PhotoSummary | null;
  /** From the opening words or an item (a paragraph, a caption, a day's heading). */
  snippet: string | null;
}

/** A place one's photos or entries are at (or one made). Counts are one's own. */
export interface SearchPlaceHit {
  id: string;
  name: string;
  category: string;
  city: string | null;
  district: string | null;
  photoCount: number;
  entryCount: number;
}

/** A preset or one's own tag; presets only when one uses them. Counts are one's own. */
export interface SearchTagHit {
  id: string;
  name: string;
  parentName: string | null;
  color: string | null;
  photoCount: number;
  entryCount: number;
}

/** `GET /api/search?q=`: the signed-in user's own archive. A group is there when it was searched. */
export interface SearchResponse {
  /** The words searched for, as the query was read: every hit has all of them. */
  terms: string[];
  entries?: SearchGroup<SearchEntryHit>;
  photos?: SearchGroup<SearchPhotoHit>;
  projects?: SearchGroup<SearchProjectHit>;
  themes?: SearchGroup<SearchThemeHit>;
  places?: SearchGroup<SearchPlaceHit>;
  tags?: SearchGroup<SearchTagHit>;
}

// ---- export (docs/api/export.md) -------------------------------------------------------------------------------------

/** The parts of an export, each read page by page from `GET /api/export/:part`. */
export const EXPORT_PARTS = [
  'photos',
  'photoTags',
  'entries',
  'entryMedia',
  'entryTags',
  'entryProjects',
  'attachments',
  'projects',
  'milestones',
  'themes',
  'themeItems',
  'tags',
  'places',
  'privacyZones',
  'shareLinks'
] as const;
export type ExportPart = (typeof EXPORT_PARTS)[number];

/** `GET /api/export`: what an export of one's archive will hold. */
export interface ExportSummary {
  profile: ExportProfile;
  /** rows of each part */
  counts: Record<ExportPart, number>;
  /** the photos' original files, in bytes */
  originalBytes: number;
  /** the attachments' files, in bytes */
  attachmentBytes: number;
}

/** `GET /api/export/:part?after=`: up to a page of rows (fields per part: docs/api/export.md); `next` reads on. */
export interface ExportPage<T = Record<string, unknown>> {
  rows: T[];
  next: string | null;
}

export interface ExportProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarPhotoId: string | null;
  role: Role;
  photoVisibility: Visibility;
  createdAt: string;
}

export interface ExportPhoto {
  id: string;
  title: string | null;
  note: string | null;
  takenAt: string | null;
  tz: string | null;
  lat: number | null;
  lng: number | null;
  alt: number | null;
  heading: number | null;
  geoPrivacy: GeoPrivacy;
  province: string | null;
  city: string | null;
  district: string | null;
  poiId: string | null;
  poiDistance: number | null;
  poiMethod: PoiMethod | null;
  camera: string | null;
  lens: string | null;
  focal: number | null;
  focal35: number | null;
  aperture: number | null;
  shutter: string | null;
  iso: number | null;
  width: number;
  height: number;
  /** R2 key of the original, served to its owner at `/media/<fileKey>` */
  fileKey: string;
  fileType: string | null;
  fileSize: number | null;
  sha256: string | null;
  variants: Variants;
  thumbhash: string | null;
  palette: string[] | null;
  focus: [number, number] | null;
  visibility: Visibility;
  inLiving: boolean;
  favorite: boolean;
  uploadedAt: string;
  updatedAt: string | null;
}

export interface ExportPhotoTag {
  photoId: string;
  tagId: string;
  source: 'manual' | 'suggested';
}

export interface ExportEntry {
  id: string;
  type: EntryType;
  title: string | null;
  body: string | null;
  occurredAt: string;
  visibility: Visibility;
  status: EntryStatus;
  revision: number;
  poiId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportEntryMedia {
  entryId: string;
  photoId: string;
  position: number;
  caption: string | null;
}

export interface ExportEntryTag {
  entryId: string;
  tagId: string;
}

export interface ExportEntryProject {
  entryId: string;
  projectId: string;
}

/** An attachment in an entry; its file is read from `/media/a/<id>`. */
export interface ExportAttachment {
  id: string;
  entryId: string;
  position: number;
  caption: string | null;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  poster: boolean;
  createdAt: string;
}

export interface ExportProject {
  id: string;
  type: ProjectType;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string | null;
  status: ProjectStatus;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
}

export interface ExportMilestone {
  id: string;
  projectId: string;
  title: string;
  body: string | null;
  date: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExportTheme {
  id: string;
  kind: ThemeKind;
  title: string;
  subtitle: string | null;
  intro: string | null;
  coverPhotoId: string | null;
  startDate: string | null;
  endDate: string | null;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ExportThemeItem {
  id: string;
  themeId: string;
  position: number;
  kind: ThemeItemKind;
  photoId: string | null;
  entryId: string | null;
  text: string | null;
  day: string | null;
}

/** Presets (`ownerId` null) and one's own tags. */
export interface ExportTag {
  id: string;
  ownerId: string | null;
  parentId: string | null;
  name: string;
  color: string | null;
  sort: number;
  createdAt: string;
}

/** Places one's photos or entries are at, and places one made. */
export interface ExportPlace {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  city: string | null;
  district: string | null;
  lat: number;
  lng: number;
  radius: number;
  source: PoiSource;
  sourceId: string | null;
  /** made by this account */
  own: boolean;
  createdAt: string;
}

export interface ExportPrivacyZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;
  createdAt: string;
}

/** A share link without its token: the token opens the item, and an export file is not the place for it. */
export interface ExportShareLink {
  id: string;
  kind: ShareKind;
  itemId: string;
  createdAt: string;
  expiresAt: string | null;
}

// ---- import (docs/api/import.md) -------------------------------------------------------------------------------------
// An export brought into the signed-in account, a batch at a time. Rows come as living.json has them, except that what
// they point to (photos, tags, projects, places, entries) is already this site's id; what is here already stays as it is.

/** Where an item of an export is, or is to be, in this account. */
export interface ImportTarget {
  id: string;
  /** here already: the export's own item (an export of this account), or the one an earlier import made */
  exists: boolean;
}

/** `POST /api/import/resolve`: photos by the SHA-256 of their file, the rest by their id in the export. */
export interface ImportResolveBody {
  photos?: string[];
  entries?: string[];
  attachments?: string[];
  projects?: string[];
  collections?: string[];
}

export interface ImportResolveResponse {
  /** this account's photo with those bytes, by SHA-256; a hash left out has none */
  photos: Record<string, string>;
  entries: Record<string, ImportTarget>;
  /** here: uploaded in full; one whose upload an earlier import left unfinished is not */
  attachments: Record<string, ImportTarget>;
  projects: Record<string, ImportTarget>;
  collections: Record<string, ImportTarget>;
}

/** `POST /api/import/tags` and `/places`: each one's id in the export → its id here. */
export interface ImportIdsResponse {
  ids: Record<string, string>;
  created: number;
}

/** `POST /api/import/zones`. */
export interface ImportZonesResponse {
  created: number;
  /** the same zone (name, centre and radius) was here already */
  existing: number;
  /** left out: the account had as many zones as it may have */
  full: number;
}

export type ImportMilestone = Pick<ExportMilestone, 'title' | 'body' | 'date' | 'createdAt' | 'updatedAt'>;

/** A project of an export, with its milestones. */
export interface ImportProject extends ExportProject {
  milestones: ImportMilestone[];
}

/** An entry of an export; `media`, `attachments`, `tagIds`, `projectIds` and `poiId` are ids here. */
export interface ImportEntry extends Omit<ExportEntry, 'revision'> {
  media: { photoId: string; caption: string | null }[];
  /** attachments uploaded for it (`POST /api/import/attachments`), in order */
  attachments?: { attachmentId: string; caption: string | null }[];
  tagIds: string[];
  projectIds: string[];
}

/** `POST /api/import/attachments`: one attachment of an export, its file to follow. */
export type ImportAttachmentBody = CreateAttachmentBody & { id: string; createdAt?: string };

/** Here already (uploaded in full by an earlier import), or where its parts go. */
export type ImportAttachmentResponse = ({ here: true } & AttachmentResponse) | ({ here: false } & AttachmentUpload);

export type ImportCollectionItem = Pick<ExportThemeItem, 'kind' | 'photoId' | 'entryId' | 'text' | 'day'>;

/** A collection of an export, its items in order; `coverPhotoId` and the items' photos and entries are ids here. */
export interface ImportCollection extends ExportTheme {
  items: ImportCollectionItem[];
}

/** `POST /api/import/projects`, `/entries` and `/collections`. */
export interface ImportRowsResponse {
  /** each one's id in the export → its id here, for every row that is here now */
  ids: Record<string, string>;
  created: number;
  existing: number;
  /** rows left out, with why */
  failed: { id: string; message: string }[];
}

// ---- review (回顾) ---------------------------------------------------------------------------------------------
// One's own archive by the calendar: the days that hold something, and a year looked back on. Only the signed-in
// owner's entries (archived ones aside) and photos. Docs: /docs/api/review.md

/** How many of a year's top places and tags a review lists. */
export const REVIEW_TOP = 10;
/** How many favourite photos a review shows. */
export const REVIEW_FAVORITES = 24;

/** `GET /api/review`: the years that hold an entry or a photo, latest first. */
export interface ReviewYearsResponse {
  years: { year: number; entries: number; photos: number }[];
}

/** One day of a year: the entries that happened on it and the photos taken on it. */
export interface ReviewDay {
  /** YYYY-MM-DD */
  day: string;
  entries: number;
  photos: number;
}

export interface ReviewPlace extends EntryPlace {
  photos: number;
  entries: number;
}

export interface ReviewTag {
  id: string;
  name: string;
  color: string | null;
  photos: number;
  entries: number;
}

/** A project with entries in the year, or a milestone dated in it. */
export interface ReviewProject {
  id: string;
  title: string;
  type: ProjectType;
  status: ProjectStatus;
  visibility: Visibility;
  /** its entries that happened in the year, and on how many days */
  entries: number;
  days: number;
  /** its milestones dated in the year, by date */
  milestones: Pick<Milestone, 'id' | 'title' | 'date'>[];
}

/** `GET /api/review/:year`. */
export interface YearReview {
  year: number;
  /** the days that hold anything, in order */
  days: ReviewDay[];
  /** characters of the titles and bodies written, Markdown included */
  chars: number;
  /** how many entries of each type, most first */
  types: { type: EntryType; count: number }[];
  /** the places most used, at most REVIEW_TOP of `placeCount` */
  places: ReviewPlace[];
  placeCount: number;
  /** the tags most used, at most REVIEW_TOP */
  tags: ReviewTag[];
  /** most entries first */
  projects: ReviewProject[];
  /** collections whose days meet the year, or undated ones holding something of it; the latest changed first */
  collections: ThemeSummary[];
  /** favourite photos taken in the year, in time order: REVIEW_FAVORITES spread over the year when there are more */
  favorites: PhotoSummary[];
}

export interface PrivacyZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;
}

/** `POST /api/privacy-zones`. */
export interface CreatePrivacyZoneResponse {
  zone: PrivacyZone;
  /** How many of the creator's photos inside the new zone just had their position set to `hidden`. */
  hiddenPhotos: number;
}

export interface Invite {
  code: string;
  role: Role;
  note: string | null;
  usedBy: string | null;
  /** Handle of `usedBy`, so the admin list can show who used a code. */
  usedByHandle?: string | null;
  usedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface SiteInfo {
  name: string;
  url: string;
  registration: 'invite' | 'open' | 'closed';
  /** AMap web-service key configured: POI matching uses AMap, otherwise OpenStreetMap */
  hasAmap: boolean;
  /** no account yet: the first registration (with the bootstrap invite) becomes the owner */
  needsSetup: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  /** Present on 409 `duplicate` from POST /api/photos: the photo that already has these bytes. */
  photoId?: string;
  /** Present on 409 `conflict` from PATCH /api/entries/:id: the entry's current revision. */
  revision?: number;
}
