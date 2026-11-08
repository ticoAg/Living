import { distance } from '../../shared/geo';

/** The first of the user's privacy zones that contains the point, if any. */
export async function zoneAt(db: D1Database, userId: string, lat: number, lng: number): Promise<{ id: string; name: string } | null> {
  const res = await db
    .prepare('SELECT id, name, lat, lng, radius FROM privacy_zones WHERE owner_id = ?1 ORDER BY created_at')
    .bind(userId)
    .all<{ id: string; name: string; lat: number; lng: number; radius: number }>();
  for (const z of res.results) {
    if (distance(lat, lng, z.lat, z.lng) <= z.radius) return { id: z.id, name: z.name };
  }
  return null;
}
