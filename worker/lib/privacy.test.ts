import { describe, expect, it } from 'vite-plus/test';
import { destination } from '../../shared/geo';
import { fakeD1 } from '../test-utils';
import { zoneAt } from './privacy';

interface Zone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number;
}

const HOME: Zone = { id: 'pz_home', name: '家', lat: 30.25, lng: 120.14, radius: 200 };
const OFFICE: Zone = { id: 'pz_office', name: '公司', lat: 30.3, lng: 120.2, radius: 500 };

/** `zoneAt` against a database that holds `zones` (already in creation order, as the query returns them). */
async function lookup(zones: Zone[], lat: number, lng: number, userId = 'u_1') {
  const { db, calls } = fakeD1(() => zones);
  const zone = await zoneAt(db, userId, lat, lng);
  return { zone, calls };
}

describe('zoneAt', () => {
  it('finds the zone that contains the point', async () => {
    const { zone } = await lookup([HOME, OFFICE], HOME.lat, HOME.lng);
    expect(zone).toEqual({ id: 'pz_home', name: '家' });
  });

  it('checks every zone, not just the first', async () => {
    const { zone } = await lookup([HOME, OFFICE], OFFICE.lat, OFFICE.lng);
    expect(zone).toEqual({ id: 'pz_office', name: '公司' });
  });

  it('includes points just inside the radius and excludes points just outside', async () => {
    const [insideLat, insideLng] = destination(HOME.lat, HOME.lng, 45, 199);
    const [outsideLat, outsideLng] = destination(HOME.lat, HOME.lng, 45, 201);
    expect((await lookup([HOME], insideLat, insideLng)).zone).toEqual({ id: 'pz_home', name: '家' });
    expect((await lookup([HOME], outsideLat, outsideLng)).zone).toBeNull();
  });

  it('measures the radius in every direction', async () => {
    for (const bearing of [0, 90, 180, 270]) {
      const [lat, lng] = destination(HOME.lat, HOME.lng, bearing, 190);
      expect((await lookup([HOME], lat, lng)).zone, `${bearing}° inside`).not.toBeNull();
      const [farLat, farLng] = destination(HOME.lat, HOME.lng, bearing, 210);
      expect((await lookup([HOME], farLat, farLng)).zone, `${bearing}° outside`).toBeNull();
    }
  });

  it('is null away from every zone, and when the user has no zones', async () => {
    expect((await lookup([HOME, OFFICE], 31, 121)).zone).toBeNull();
    expect((await lookup([], HOME.lat, HOME.lng)).zone).toBeNull();
  });

  it('returns the first matching zone when several overlap', async () => {
    const wide: Zone = { id: 'pz_wide', name: '大区域', lat: HOME.lat, lng: HOME.lng, radius: 5000 };
    expect((await lookup([HOME, wide], HOME.lat, HOME.lng)).zone).toEqual({ id: 'pz_home', name: '家' });
    expect((await lookup([wide, HOME], HOME.lat, HOME.lng)).zone).toEqual({ id: 'pz_wide', name: '大区域' });
  });

  it('reveals only the id and name of the zone, never where it is', async () => {
    const { zone } = await lookup([HOME], HOME.lat, HOME.lng);
    expect(Object.keys(zone ?? {}).sort()).toEqual(['id', 'name']);
  });

  it('asks the database for the signed-in user’s zones only, oldest first', async () => {
    const { calls } = await lookup([HOME], HOME.lat, HOME.lng, 'u_42');
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/FROM privacy_zones WHERE owner_id = \?1/);
    expect(calls[0].sql).toMatch(/ORDER BY created_at/);
    expect(calls[0].params).toEqual(['u_42']);
  });
});
