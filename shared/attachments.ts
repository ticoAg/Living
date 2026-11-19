// What a browser does with an attachment's file: plays it in place, opens it in its own viewer, or only saves it. The
// Worker serves each file accordingly (worker/routes/media.ts) and the pages show it the same way.
// Docs: /docs/api/attachments.md

import type { AttachmentKind } from './types';

/** Types a browser plays in a <video> or <audio>; nothing in them runs. Anything else is served as bytes to save. */
export const PLAYABLE = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/ogg',
  'video/x-matroska',
  'video/3gpp',
  'video/3gpp2',
  'video/x-m4v',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/x-aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/webm',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  'audio/x-flac',
  'audio/amr',
  'audio/3gpp',
  'audio/3gpp2',
  'audio/aiff',
  'audio/x-aiff'
]);

/**
 * The Content-Type a file is served with, and whether a browser may show it in place: videos and recordings of the
 * types above, and PDFs, which browsers open in their own viewer. Everything else (HTML, SVG, documents) is
 * `application/octet-stream` and only ever saved, so nothing uploaded runs on the site.
 */
export function servedAs(kind: AttachmentKind, mime: string): { type: string; inline: boolean } {
  if (kind !== 'file' && PLAYABLE.has(mime)) return { type: mime, inline: true };
  if (mime === 'application/pdf') return { type: mime, inline: true };
  return { type: 'application/octet-stream', inline: false };
}
