import { Hono } from 'hono';
import { distance } from '../../shared/geo';
import { POI_CATEGORIES, POI_LIMITS, type MatchCandidate, type PoiDetail } from '../../shared/types';
import type { AppEnv } from '../env';
import { forbidden, invalid, listCache, notFound, paramId, readJson } from '../lib/http';
import { canEditPoi, getPoiRow, parseNewPoi, findOrCreatePoi, poiCols, toPoi, toPoiDetail, type PoiRow } from '../lib/poi';
import { currentUser, requireUser, viewerId } from '../lib/session';
import { likeContains, prepQ, Sql } from '../lib/sql';
import { has, optNum, optText, reqStr, strArray } from '../lib/validate';
import { photoList, photoLocation, poiOffered } from '../lib/visibility';
import { dedupe, fromExternal, fromPoiRow, matchPlaces, score, searchExternal, type RawPlace } from '../providers/match';
import { settle } from '../providers/http';

export const pois = new Hono<AppEnv>({ strict: false });

const NEARBY_METERS = 5000;
const NEARBY_LIMIT = 8;
const SEARCH_LIMIT = 30;

/** Visible-photo POIs: the viewer's own photos, or public photos whose location is not hidden. */
function visiblePhotos(q: Sql, viewer: string | null): string {
  return `${photoList(q, viewer, 'p')} AND ${photoLocation(q, viewer, 'p')}`;
}

pois.get('/', async (c) => {
  const viewer = await viewerId(c);
  const ownerHandle = c.req.query('owner');
  let ownerId: string | null = null;
  if (ownerHandle) {
    const u = await c.env.DB.prepare('SELECT id FROM users WHERE handle = ?1').bind(ownerHandle).first<{ id: string }>();
    if (!u) throw notFound('用户不存在');
    ownerId = u.id;
  }
  const q = new Sql();
  const where = visiblePhotos(q, viewer) + (ownerId ? ` AND p.owner_id = ${q.p(ownerId)}` : '');
  const res = await prepQ(
    c.env.DB,
    `SELECT ${poiCols('po')}, COUNT(*) AS n FROM photos p JOIN pois po ON po.id = p.poi_id
     WHERE ${where} GROUP BY po.id ORDER BY n DESC, po.name`,
    q
  ).all<PoiRow & { n: number }>();
  listCache(c, viewer);
  return c.json({ pois: res.results.map((r) => toPoi(r, r.n)) });
});

pois.get('/search', async (c) => {
  const user = await requireUser(c);
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ results: [] as MatchCandidate[] });
  if ([...q].length > 60) throw invalid('搜索词最多 60 个字符');
  const lat = c.req.query('lat') !== undefined ? Number(c.req.query('lat')) : null;
  const lng = c.req.query('lng') !== undefined ? Number(c.req.query('lng')) : null;
  const at =
    lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? { lat, lng, heading: null }
      : null;

  const like = likeContains(q);
  const q1 = new Sql();
  const localRows = await prepQ(
    c.env.DB,
    `SELECT ${poiCols('po')} FROM pois po
     WHERE (po.name LIKE ${q1.p(like)} ESCAPE '\\' OR po.aliases LIKE ${q1.p(like)} ESCAPE '\\') AND ${poiOffered(q1, user.id)}
     LIMIT 50`,
    q1
  ).all<PoiRow>();
  const local = localRows.results.map(fromPoiRow);

  // AMap with a key in China; otherwise OpenStreetMap (Photon, Nominatim). With a point, only places around it.
  // A provider failure just leaves the local results.
  const external = await settle(searchExternal(c.env, q, at));
  let remote: RawPlace[] = [];
  if (external.ok) {
    // Provider results carry their own city/district; no reference-point fallback (they may be anywhere).
    remote = dedupe(
      local,
      external.value.map((e) => fromExternal(e, { city: null, district: null })),
      at ?? undefined
    );
  } else {
    console.warn('search: provider failed', external.error instanceof Error ? external.error.message : external.error);
  }

  const places = [...local, ...remote];
  let results: MatchCandidate[];
  if (at) {
    results = places
      .map((p) => score(p, at))
      .sort((a, b) => a.distance - b.distance || Number(b.source === 'local') - Number(a.source === 'local'))
      .slice(0, SEARCH_LIMIT);
  } else {
    // No reference point: no distance to speak of. Local places first, then provider order.
    results = places.slice(0, SEARCH_LIMIT).map((p) => ({
      key: p.key,
      poiId: p.poiId,
      name: p.name,
      category: p.category,
      lat: p.lat,
      lng: p.lng,
      distance: 0,
      bearing: 0,
      inView: false,
      score: 0,
      source: p.source,
      sourceId: p.sourceId,
      area: false,
      city: p.city,
      district: p.district
    }));
  }
  return c.json({ results });
});

pois.post('/match', async (c) => {
  const user = await requireUser(c);
  const body = await readJson(c);
  const lat = optNum(body.lat, '纬度', { min: -90, max: 90 });
  const lng = optNum(body.lng, '经度', { min: -180, max: 180 });
  if (lat === null || lng === null) throw invalid('请提供拍摄点的经纬度');
  const heading = optNum(body.heading, '朝向', { min: -360, max: 720 });
  const radius = Math.min(1000, Math.max(30, optNum(body.radius, '匹配半径', { min: 0, max: 100000 }) ?? 300));
  return c.json(await matchPlaces(c.env, user.id, { lat, lng, heading: heading === null ? null : ((heading % 360) + 360) % 360, radius }));
});

pois.post('/', async (c) => {
  const user = await requireUser(c);
  const input = parseNewPoi(await readJson(c));
  const row = await findOrCreatePoi(c.env.DB, input, user.id);
  return c.json({ poi: toPoi(row) }, 201);
});

pois.get('/:id', async (c) => {
  const id = paramId(c);
  const viewer = await viewerId(c);
  const row = await getPoiRow(c.env.DB, id);
  if (!row) throw notFound('地点不存在');

  const dLat = NEARBY_METERS / 111_320;
  const dLng = NEARBY_METERS / (111_320 * Math.max(0.01, Math.cos((row.lat * Math.PI) / 180)));
  const q = new Sql();
  const where = visiblePhotos(q, viewer);
  const [own, near, user] = await Promise.all([
    (() => {
      const q2 = new Sql();
      return prepQ(c.env.DB, `SELECT COUNT(*) AS n FROM photos p WHERE p.poi_id = ${q2.p(id)} AND ${visiblePhotos(q2, viewer)}`, q2).first<{
        n: number;
      }>();
    })(),
    prepQ(
      c.env.DB,
      `SELECT ${poiCols('po')}, COUNT(*) AS n FROM photos p JOIN pois po ON po.id = p.poi_id
       WHERE po.id != ${q.p(id)} AND po.lat BETWEEN ${q.p(row.lat - dLat)} AND ${q.p(row.lat + dLat)}
         AND po.lng BETWEEN ${q.p(row.lng - dLng)} AND ${q.p(row.lng + dLng)} AND ${where}
       GROUP BY po.id`,
      q
    ).all<PoiRow & { n: number }>(),
    viewer ? currentUser(c) : null
  ]);

  const nearby = near.results
    .map((r) => ({ ...toPoi(r, r.n), distance: distance(row.lat, row.lng, r.lat, r.lng) }))
    .filter((p) => p.distance <= NEARBY_METERS)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEARBY_LIMIT)
    .map((p) => ({ ...p, distance: Math.round(p.distance) }));

  listCache(c, viewer);
  const poi: PoiDetail = toPoiDetail(row, canEditPoi(user, row), own?.n ?? 0);
  return c.json({ poi, nearby });
});

pois.patch('/:id', async (c) => {
  const user = await requireUser(c);
  const row = await getPoiRow(c.env.DB, paramId(c));
  if (!row) throw notFound('地点不存在');
  if (!canEditPoi(user, row)) throw forbidden('只有地点的创建者或管理员可以修改地点');
  const body = await readJson(c);

  let { name, category, radius } = row;
  let aliases = row.aliases;
  if (has(body, 'name')) name = reqStr(body, 'name', '地点名称', 1, POI_LIMITS.nameMax);
  if (has(body, 'category')) {
    if (typeof body.category !== 'string' || !(POI_CATEGORIES as readonly string[]).includes(body.category)) {
      throw invalid(`地点类别需要是：${POI_CATEGORIES.join('、')}`);
    }
    category = body.category;
  }
  if (has(body, 'radius')) {
    radius = optNum(body.radius, '匹配半径', { min: POI_LIMITS.radiusMin, max: POI_LIMITS.radiusMax }) ?? row.radius;
  }
  if (has(body, 'aliases')) {
    const raw = body.aliases;
    const list =
      typeof raw === 'string'
        ? raw
            .split(/[,，;；、\n]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : strArray(raw, '别名', POI_LIMITS.aliasCount, POI_LIMITS.aliasMax);
    aliases = list.length ? JSON.stringify(list.map((s) => optText(s, '别名', POI_LIMITS.aliasMax)).filter(Boolean)) : null;
  }

  await c.env.DB.prepare('UPDATE pois SET name = ?1, category = ?2, radius = ?3, aliases = ?4 WHERE id = ?5')
    .bind(name, category, radius, aliases, row.id)
    .run();
  return c.json({ poi: toPoiDetail({ ...row, name, category, radius, aliases }, true) });
});
