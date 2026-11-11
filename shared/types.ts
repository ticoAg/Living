// API contract shared by the Worker and the SPA. Docs: /docs/api/
// All JSON keys are camelCase; D1 columns are snake_case.

export type Role = 'owner' | 'admin' | 'member';
export type Visibility = 'public' | 'unlisted' | 'private';
export type GeoPrivacy = 'exact' | 'fuzzy' | 'hidden';
export type PoiMethod = 'auto' | 'confirmed' | 'inferred' | 'manual';
export type PoiSource = 'custom' | 'amap' | 'osm';
export type ThemeKind = 'trip' | 'topic';

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
}
export interface UserProfile extends UserPublic {
  photoCount: number;
  themeCount: number;
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
  uploadedAt: string;
  updatedAt: string | null;
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
  photoCount: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export type ThemeItem =
  | { id: string; kind: 'photo'; photoId: string; text: string | null; photo: (PhotoSummary & { note: string | null }) | null }
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'day'; day: string; text: string | null };

export interface ThemeDetail extends ThemeSummary {
  intro: string | null;
  items: ThemeItem[];
  /** POIs referenced by the photos, for the route map */
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
  )[];
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
}
