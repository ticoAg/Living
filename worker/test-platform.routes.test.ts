// The route-test platform itself: migrations, isolation between tests, and no network.

import { describe, expect, it } from 'vite-plus/test';
import { Client, expectStatus, newUser, splitStatements, upload, usePlatform } from './test-platform';

const platform = usePlatform();

describe('splitStatements', () => {
  it('splits on semicolons outside quotes and comments', () => {
    const sql = `-- a comment; not a statement
CREATE TABLE a (
  x TEXT DEFAULT 'semi;colon', -- trailing; comment
  y TEXT DEFAULT 'it''s'
);
/* block; comment */ INSERT INTO a (x) VALUES ("q;uoted");
-- only a comment at the end`;
    expect(splitStatements(sql)).toEqual([
      `-- a comment; not a statement
CREATE TABLE a (
  x TEXT DEFAULT 'semi;colon', -- trailing; comment
  y TEXT DEFAULT 'it''s'
)`,
      `/* block; comment */ INSERT INTO a (x) VALUES ("q;uoted")`
    ]);
  });
});

describe('the platform', () => {
  it('applies every migration, multi-line statements and seeds included', async () => {
    const db = platform.env.DB;
    const tables = await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' ORDER BY name`).all();
    expect(tables.results.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        'invites',
        'photo_tags',
        'photos',
        'place_cache',
        'pois',
        'privacy_zones',
        'settings',
        'tags',
        'theme_items',
        'themes',
        'users'
      ])
    );
    // 0003 added a column
    expect(await db.prepare('SELECT province FROM photos LIMIT 1').all()).toMatchObject({ success: true });
    expect(await db.prepare(`SELECT value FROM settings WHERE key = 'registration'`).first('value')).toBe('invite');
    expect(await db.prepare('SELECT COUNT(*) AS n FROM tags WHERE owner_id IS NULL').first('n')).toBeGreaterThan(40);
  });

  it('enforces D1’s own rules: constraints, and no undefined parameters', async () => {
    const db = platform.env.DB;
    await expect(db.prepare(`INSERT INTO settings (key, value) VALUES ('registration', 'x')`).run()).rejects.toThrow(
      /UNIQUE constraint failed/
    );
    await expect(db.prepare('SELECT ?1 AS v').bind(undefined).first()).rejects.toThrow();
  });

  it('leaves a test’s data behind for nobody: step one writes everywhere…', async () => {
    const alice = await newUser(platform, 'alice', 'owner');
    const photo = await upload(alice);
    await platform.env.DB.prepare(`UPDATE tags SET name = 'renamed' WHERE id = 'lake'`).run();
    await platform.env.DB.prepare(`UPDATE settings SET value = 'open'`).run();
    expect((await new Client(platform).fetch(`/media/${photo.variants.s.key}`)).status).toBe(200);
    expect(await platform.cached(`/media/${photo.variants.s.key}`)).toBe(true);
  });

  it('…step two finds everything as the migrations left it', async () => {
    const db = platform.env.DB;
    expect(await db.prepare('SELECT COUNT(*) AS n FROM users').first('n')).toBe(0);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM photos').first('n')).toBe(0);
    expect(await db.prepare(`SELECT name FROM tags WHERE id = 'lake'`).first('name')).toBe('湖');
    expect(await db.prepare(`SELECT value FROM settings WHERE key = 'registration'`).first('value')).toBe('invite');
    expect((await platform.env.KV.list()).keys).toEqual([]);
    expect((await platform.env.MEDIA.list()).objects).toEqual([]);
    expect(expectStatus(await new Client(platform).get('/api/site'), 200).needsSetup).toBe(true);
  });

  it('answers the place providers itself', async () => {
    platform.external.respond = () => Response.json({ type: 'FeatureCollection', features: [] });
    const res = await fetch('https://photon.komoot.io/reverse?lat=1&lon=1');
    expect(await res.json()).toEqual({ type: 'FeatureCollection', features: [] });
    expect(platform.external.calls.map((u) => u.hostname)).toEqual(['photon.komoot.io']);
  });

  it('refuses any other host, and fails the test that tried', async () => {
    await expect(fetch('https://example.com/')).rejects.toThrow(/must not reach example.com/);
    // what the platform's afterEach would report
    expect(platform.external.stray.splice(0)).toEqual(['https://example.com/']);
  });
});
