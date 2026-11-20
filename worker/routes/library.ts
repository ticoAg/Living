// Library (媒体库): what one keeps here as files. One's attachments with the entry each is in, or when the hourly
// cleanup deletes it; how many photos, videos, recordings and other files one keeps and their bytes; and which of
// one's photos are in one's entries, so the page can find those in none. The photos themselves are
// GET /api/photos?mine=1. Only the signed-in user's own. Contract: /docs/api/library.md

import { Hono } from 'hono';
import { entryLabel, entryTypeLabel } from '../../shared/entries';
import {
  ATTACHMENT_KINDS,
  LIBRARY_ATTACHMENTS_LIMIT,
  type AttachmentKind,
  type EntryStatus,
  type LibraryAttachment,
  type LibraryCount,
  type LibraryResponse,
  type Visibility
} from '../../shared/types';
import type { AppEnv } from '../env';
import { attachmentCols, purgeAt, toOwnAttachment, type AttachmentRow } from '../lib/attachments';
import { requireUser } from '../lib/session';
import { capped } from '../lib/sql';

export const library = new Hono<AppEnv>({ strict: false });

interface Row extends AttachmentRow {
  entry_type: string | null;
  entry_title: string | null;
  entry_body: string | null;
  entry_occurred_at: string | null;
  entry_visibility: Visibility | null;
  entry_status: EntryStatus | null;
}

function toLibraryAttachment(r: Row): LibraryAttachment {
  return {
    ...toOwnAttachment(r),
    caption: r.entry_id ? r.caption : null,
    uploadedAt: r.uploaded_at,
    purgeAt: purgeAt(r),
    entry:
      r.entry_id && r.entry_occurred_at !== null
        ? {
            id: r.entry_id,
            label: entryLabel(r.entry_title, r.entry_body) || entryTypeLabel(r.entry_type ?? 'note'),
            occurredAt: r.entry_occurred_at,
            visibility: r.entry_visibility as Visibility,
            status: r.entry_status as EntryStatus
          }
        : null
  };
}

library.get('/', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const [list, kinds, photos, inEntries] = await db.batch([
    db
      .prepare(
        `SELECT ${attachmentCols('a')}, e.type AS entry_type, e.title AS entry_title, substr(e.body, 1, 400) AS entry_body,
           e.occurred_at AS entry_occurred_at, e.visibility AS entry_visibility, e.status AS entry_status
         FROM attachments a LEFT JOIN entries e ON e.id = a.entry_id
         WHERE a.owner_id = ?1 ORDER BY a.created_at DESC, a.id DESC LIMIT ?2`
      )
      .bind(user.id, LIBRARY_ATTACHMENTS_LIMIT + 1),
    db
      .prepare(
        `SELECT kind, COUNT(*) AS count, coalesce(SUM(size), 0) AS bytes FROM attachments
         WHERE owner_id = ?1 AND uploaded_at IS NOT NULL GROUP BY kind`
      )
      .bind(user.id),
    db.prepare('SELECT COUNT(*) AS count, coalesce(SUM(file_size), 0) AS bytes FROM photos WHERE owner_id = ?1').bind(user.id),
    db.prepare('SELECT DISTINCT em.photo_id FROM entry_media em JOIN entries e ON e.id = em.entry_id WHERE e.owner_id = ?1').bind(user.id)
  ]);
  const { rows, truncated } = capped(list.results as Row[], LIBRARY_ATTACHMENTS_LIMIT);
  const byKind = new Map((kinds.results as ({ kind: AttachmentKind } & LibraryCount)[]).map((k) => [k.kind, k]));
  const count = (k: LibraryCount | undefined): LibraryCount => ({ count: k?.count ?? 0, bytes: k?.bytes ?? 0 });
  const body: LibraryResponse = {
    attachments: rows.map(toLibraryAttachment),
    truncated,
    usage: {
      photos: count(photos.results[0] as LibraryCount | undefined),
      ...(Object.fromEntries(ATTACHMENT_KINDS.map((k) => [k, count(byKind.get(k))])) as Record<AttachmentKind, LibraryCount>)
    },
    entryPhotoIds: (inEntries.results as { photo_id: string }[]).map((r) => r.photo_id)
  };
  return c.json(body);
});
