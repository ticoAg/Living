import { Hono } from 'hono';
import type { PrivacyZone } from '../../shared/types';
import type { AppEnv } from '../env';
import { invalid, notFound, paramId, readJson } from '../lib/http';
import { newId } from '../lib/ids';
import { requireUser } from '../lib/session';
import { nowIso, prep } from '../lib/sql';
import { optNum, reqNum, reqStr } from '../lib/validate';

export const privacyZones = new Hono<AppEnv>({ strict: false });

const MAX_ZONES = 50;

interface ZoneRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;
}
const toZone = (r: ZoneRow): PrivacyZone => ({ id: r.id, name: r.name, lat: r.lat, lng: r.lng, radius: r.radius });

privacyZones.get('/', async (c) => {
  const user = await requireUser(c);
  const res = await c.env.DB.prepare('SELECT id, name, lat, lng, radius FROM privacy_zones WHERE owner_id = ?1 ORDER BY created_at, id')
    .bind(user.id)
    .all<ZoneRow>();
  return c.json({ zones: res.results.map(toZone) });
});

privacyZones.post('/', async (c) => {
  const user = await requireUser(c);
  const body = await readJson(c);
  const db = c.env.DB;
  const name = reqStr(body, 'name', '区域名称', 1, 40);
  const lat = reqNum(body.lat, '纬度', { min: -90, max: 90 });
  const lng = reqNum(body.lng, '经度', { min: -180, max: 180 });
  const radius = optNum(body.radius, '半径', { min: 50, max: 5000 }) ?? 300;
  const count = await db.prepare('SELECT COUNT(*) AS n FROM privacy_zones WHERE owner_id = ?1').bind(user.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_ZONES) throw invalid(`隐私区域最多 ${MAX_ZONES} 个`);

  const id = newId.zone();
  await prep(db, 'INSERT INTO privacy_zones (id, owner_id, name, lat, lng, radius, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)', id, user.id, name, lat, lng, radius, nowIso()).run();
  return c.json({ zone: toZone({ id, name, lat, lng, radius }) }, 201);
});

privacyZones.delete('/:id', async (c) => {
  const user = await requireUser(c);
  const id = paramId(c);
  // Someone else's zone is none of your business: same 404 as a missing one.
  const res = await c.env.DB.prepare('DELETE FROM privacy_zones WHERE id = ?1 AND owner_id = ?2').bind(id, user.id).run();
  if (!res.meta.changes) throw notFound('隐私区域不存在');
  return c.json({ ok: true });
});
