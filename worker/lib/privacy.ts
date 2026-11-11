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

/**
 * The user's photos whose own coordinates fall inside the circle and whose position is not hidden yet: the photos a
 * new privacy zone must hide. A photo placed only through its place (no coordinates of its own) is left alone.
 */
export async function photosToHide(db: D1Database, userId: string, zone: { lat: number; lng: number; radius: number }): Promise<string[]> {
  // A box around the circle narrows the rows down in SQL; the exact distance is checked here. The box is 1% wider
  // than the circle so that photos right on the edge survive the flat-earth approximation.
  const reach = zone.radius * 1.01;
  const dLat = reach / 111_320;
  const dLng = reach / (111_320 * Math.max(0.01, Math.cos((zone.lat * Math.PI) / 180)));
  const res = await db
    .prepare(
      `SELECT id, lat, lng FROM photos
       WHERE owner_id = ?1 AND geo_privacy != 'hidden' AND lat BETWEEN ?2 AND ?3 AND lng BETWEEN ?4 AND ?5`
    )
    .bind(userId, zone.lat - dLat, zone.lat + dLat, zone.lng - dLng, zone.lng + dLng)
    .all<{ id: string; lat: number; lng: number }>();
  return res.results.filter((p) => distance(p.lat, p.lng, zone.lat, zone.lng) <= zone.radius).map((p) => p.id);
}
