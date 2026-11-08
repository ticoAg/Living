import { Hono } from 'hono';
import type { UserProfile } from '../../shared/types';
import type { AppEnv } from '../env';
import { listCache, notFound } from '../lib/http';
import { viewerId } from '../lib/session';
import { prepQ, Sql } from '../lib/sql';
import { photoList, themeList } from '../lib/visibility';

export const users = new Hono<AppEnv>({ strict: false });

users.get('/:handle', async (c) => {
  const handle = c.req.param('handle');
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(handle)) throw notFound('用户不存在');
  const viewer = await viewerId(c);

  const q = new Sql();
  const photoVis = photoList(q, viewer, 'p');
  const themeVis = themeList(q, viewer, 'th');
  const row = await prepQ(
    c.env.DB,
    `SELECT u.id, u.handle, u.display_name, u.bio, u.avatar_photo_id, u.created_at,
        (SELECT COUNT(*) FROM photos p WHERE p.owner_id = u.id AND ${photoVis}) AS photo_count,
        (SELECT COUNT(*) FROM themes th WHERE th.owner_id = u.id AND ${themeVis}) AS theme_count
     FROM users u WHERE u.handle = ${q.p(handle)}`,
    q
  ).first<{
    id: string;
    handle: string;
    display_name: string;
    bio: string | null;
    avatar_photo_id: string | null;
    created_at: string;
    photo_count: number;
    theme_count: number;
  }>();
  if (!row) throw notFound('用户不存在');

  listCache(c, viewer);
  const profile: UserProfile = {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarPhotoId: row.avatar_photo_id,
    photoCount: row.photo_count,
    themeCount: row.theme_count,
    createdAt: row.created_at
  };
  return c.json(profile);
});
