import type { GeoPrivacy, Visibility } from '../../shared/types';
import type { PlaceChoice } from './match';
import type { Item } from './upload-model';

// What was typed and chosen for a photo in the upload queue, kept in the browser so a crashed tab, a phone that dropped
// the page in the background or a reload does not lose it. Keyed by file (name, size, modification time); only text and
// choices are kept, never pixels. Adding the same file again brings it back; publishing or removing it forgets it.
// The store takes any Storage, so it is tested without a browser. Docs: /docs/product/features/upload.md#草稿

/** Drafts older than this are dropped. */
export const DRAFT_TTL = 30 * 24 * 3600 * 1000;
/** At most this many files … */
export const DRAFT_MAX = 300;
/** … and this many characters of JSON, oldest dropped first (localStorage holds about 5 MB per site). */
export const DRAFT_MAX_CHARS = 512 * 1024;

export interface Draft {
  /** when it was last saved, ms */
  at: number;
  title: string;
  note: string;
  tags: string[];
  visibility: Visibility;
  /** only when the user set it; otherwise the place match decides (privacy zones) */
  geoPrivacy?: GeoPrivacy;
  themeIds: string[];
  /** a place the user picked (an automatic match is redone when the file comes back) */
  place: PlaceChoice | null;
  /** the user removed the place on purpose */
  cleared: boolean;
}

/** The part of Storage the store uses. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Same key as the queue uses to spot a file added twice. */
export const fileKey = (f: { name: string; size: number; lastModified: number }) => `${f.name}:${f.size}:${f.lastModified}`;

const userPlace = (p: PlaceChoice | null) => (p && p.method !== 'auto' && p.method !== 'inferred' ? p : null);

/** What to keep for this photo; null when nothing was filled in (or it is gone from the queue's concern). */
export function draftOf(it: Item, now: number): Draft | null {
  if (it.publish.state === 'done' || it.publish.state === 'duplicate') return null;
  const place = userPlace(it.place);
  const filled =
    it.title.trim() !== '' ||
    it.note.trim() !== '' ||
    it.tags.length > 0 ||
    it.visibility !== 'public' ||
    it.geoTouched ||
    it.themeIds.length > 0 ||
    !!place ||
    it.cleared;
  if (!filled) return null;
  const d: Draft = {
    at: now,
    title: it.title,
    note: it.note,
    tags: [...it.tags],
    visibility: it.visibility,
    themeIds: [...it.themeIds],
    place: place ? { ...place, from: undefined } : null,
    cleared: it.cleared && !place
  };
  if (it.geoTouched) d.geoPrivacy = it.geoPrivacy;
  return d;
}

/** The fields a restored draft puts back on a fresh queue item. */
export function restoreDraft(d: Draft): Partial<Item> {
  const out: Partial<Item> = {
    title: d.title,
    note: d.note,
    tags: [...d.tags],
    visibility: d.visibility,
    themeIds: [...d.themeIds],
    place: d.place,
    cleared: d.cleared
  };
  if (d.geoPrivacy) {
    out.geoPrivacy = d.geoPrivacy;
    out.geoTouched = true;
  }
  return out;
}

const VIS: readonly string[] = ['public', 'unlisted', 'private'];
const GEO: readonly string[] = ['exact', 'fuzzy', 'hidden'];
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A stored value that still looks like a draft (it may come from an older version, or from anyone with devtools). */
function valid(v: unknown): v is Draft {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.at === 'number' &&
    typeof d.title === 'string' &&
    typeof d.note === 'string' &&
    strings(d.tags) &&
    strings(d.themeIds) &&
    typeof d.visibility === 'string' &&
    VIS.includes(d.visibility) &&
    (d.geoPrivacy === undefined || (typeof d.geoPrivacy === 'string' && GEO.includes(d.geoPrivacy))) &&
    typeof d.cleared === 'boolean' &&
    (d.place === null ||
      (typeof d.place === 'object' &&
        typeof (d.place as PlaceChoice).key === 'string' &&
        typeof (d.place as PlaceChoice).name === 'string'))
  );
}

/** Keep the newest drafts that fit the limits. */
export function trim(drafts: Record<string, Draft>, now: number, max = DRAFT_MAX, maxChars = DRAFT_MAX_CHARS): Record<string, Draft> {
  const fresh = Object.entries(drafts)
    .filter(([, d]) => now - d.at <= DRAFT_TTL)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, max);
  const out: Record<string, Draft> = {};
  let size = 2;
  for (const [k, d] of fresh) {
    size += JSON.stringify(k).length + JSON.stringify(d).length + 2;
    if (size > maxChars) break;
    out[k] = d;
  }
  return out;
}

export class DraftStore {
  constructor(
    private readonly storage: DraftStorage | null,
    private readonly key: string,
    private readonly now: () => number = Date.now
  ) {}

  /** Every stored draft that is still valid and not expired. */
  all(): Record<string, Draft> {
    let raw: string | null = null;
    try {
      raw = this.storage?.getItem(this.key) ?? null;
    } catch {
      return {};
    }
    if (!raw) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const now = this.now();
    const out: Record<string, Draft> = {};
    for (const [k, v] of Object.entries(parsed)) if (valid(v) && now - v.at <= DRAFT_TTL) out[k] = v;
    return out;
  }

  get(key: string): Draft | null {
    return this.all()[key] ?? null;
  }

  /** Save (a draft) or forget (null) several files in one write; expired and surplus drafts go at the same time. */
  update(changes: ReadonlyMap<string, Draft | null>): void {
    if (!this.storage) return;
    const next = this.all();
    for (const [k, d] of changes) {
      if (d) next[k] = d;
      else delete next[k];
    }
    this.write(trim(next, this.now()));
  }

  forget(keys: readonly string[]): void {
    if (keys.length) this.update(new Map(keys.map((k) => [k, null])));
  }

  private write(drafts: Record<string, Draft>): void {
    const keys = Object.keys(drafts);
    try {
      if (!keys.length) this.storage!.removeItem(this.key);
      else this.storage!.setItem(this.key, JSON.stringify(drafts));
    } catch {
      // Storage full (other data of this site) or blocked: keep the newer half, or give up quietly.
      if (keys.length > 1) this.write(trim(drafts, this.now(), Math.floor(keys.length / 2)));
    }
  }
}

/** localStorage when the browser lets this page use it. */
export function browserStorage(): DraftStorage | null {
  try {
    const s = globalThis.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}
