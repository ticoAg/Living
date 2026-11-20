// What a new entry starts with when another page opens the editor on it, as `history.state` of /entries/new: the quick
// note's text and recordings, or the photos and files picked in the library. Docs: /docs/product/features/entries.md

import type { Attachment, PhotoSummary } from '../../shared/types';
import { attachmentOf } from './draft';

/** history.state of the editor opened from another page. */
export interface Handoff {
  livingEntryBody?: string;
  livingEntryAttachments?: Attachment[];
  livingEntryPhotos?: PhotoSummary[];
}

/** What the new entry starts with. */
export interface Start {
  body: string;
  attachments: Attachment[];
  photos: PhotoSummary[];
}

export const NO_HANDOFF: Start = { body: '', attachments: [], photos: [] };

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A photo enough to show: one kept in the state by a page of an earlier version, or by hand, is left out. */
const isPhoto = (v: unknown): v is PhotoSummary => {
  if (!v || typeof v !== 'object') return false;
  const { id, width, height, variants } = v as Record<string, unknown>;
  return typeof id === 'string' && typeof width === 'number' && typeof height === 'number' && !!variants && typeof variants === 'object';
};

/** What `state` hands over; anything else in it, or none, is nothing to start with. */
export function handoffOf(state: unknown): Start {
  const h = (state && typeof state === 'object' ? state : {}) as Partial<Record<keyof Handoff, unknown>>;
  return {
    body: typeof h.livingEntryBody === 'string' ? h.livingEntryBody : '',
    attachments: list(h.livingEntryAttachments)
      .map(attachmentOf)
      .filter((a): a is Attachment => !!a),
    photos: list(h.livingEntryPhotos).filter(isPhoto)
  };
}

/** Whether the editor starts with something handed over, rather than empty. */
export const handsOver = (s: Start): boolean => !!s.body || s.attachments.length > 0 || s.photos.length > 0;
