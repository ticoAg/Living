import { describe, expect, it } from 'vite-plus/test';
import { Sql } from './sql';
import { photoById, photoList, photoLocation, themeList } from './visibility';

// The three rules of docs/api/conventions.md#可见性:
//  list: public, plus the viewer's own content of any visibility
//  byId: public and unlisted, plus the viewer's own
//  loc:  the viewer's own, or anything not geo-hidden

const helpers = [
  ['photoList', photoList],
  ['photoById', photoById],
  ['photoLocation', photoLocation],
  ['themeList', themeList]
] as const;

describe('photoList', () => {
  it('shows a visitor public photos only', () => {
    const q = new Sql();
    expect(photoList(q, null)).toBe("p.visibility = 'public'");
    expect(q.params).toEqual([]);
  });

  it('adds the signed-in viewer’s own photos, whatever their visibility', () => {
    const q = new Sql();
    expect(photoList(q, 'u_1')).toBe("(p.visibility = 'public' OR p.owner_id = ?1)");
    expect(q.params).toEqual(['u_1']);
  });

  it('never lets unlisted or private photos of other people through', () => {
    expect(photoList(new Sql(), 'u_1')).not.toContain('unlisted');
    expect(photoList(new Sql(), null)).not.toContain('unlisted');
    expect(photoList(new Sql(), null)).not.toContain('private');
  });
});

describe('photoById', () => {
  it('shows a visitor everything but private photos, so unlisted ones open by link', () => {
    const q = new Sql();
    expect(photoById(q, null)).toBe("p.visibility != 'private'");
    expect(q.params).toEqual([]);
  });

  it('adds the viewer’s own photos, private ones included', () => {
    const q = new Sql();
    expect(photoById(q, 'u_1')).toBe("(p.visibility != 'private' OR p.owner_id = ?1)");
    expect(q.params).toEqual(['u_1']);
  });
});

describe('photoLocation', () => {
  it('hides geo-hidden photos from a visitor', () => {
    const q = new Sql();
    expect(photoLocation(q, null)).toBe("p.geo_privacy != 'hidden'");
    expect(q.params).toEqual([]);
  });

  it('keeps the viewer’s own located photos even when hidden from others', () => {
    const q = new Sql();
    expect(photoLocation(q, 'u_1')).toBe("(p.owner_id = ?1 OR p.geo_privacy != 'hidden')");
    expect(q.params).toEqual(['u_1']);
  });
});

describe('themeList', () => {
  it('shows a visitor public themes only, using the th alias by default', () => {
    const q = new Sql();
    expect(themeList(q, null)).toBe("th.visibility = 'public'");
    expect(q.params).toEqual([]);
  });

  it('adds the viewer’s own themes', () => {
    const q = new Sql();
    expect(themeList(q, 'u_1')).toBe("(th.visibility = 'public' OR th.owner_id = ?1)");
    expect(q.params).toEqual(['u_1']);
  });
});

describe.each(helpers)('%s', (_name, helper) => {
  it('qualifies its columns with the table alias it is given', () => {
    const sql = helper(new Sql(), 'u_1', 'photos');
    expect(sql).toContain('photos.');
    expect(sql).not.toMatch(/(?<![\w.])(visibility|owner_id|geo_privacy)\b/);
  });

  it('numbers its placeholder after the ones already registered', () => {
    const q = new Sql();
    q.p('first');
    q.p('second');
    expect(helper(q, 'u_1')).toContain('?3');
    expect(q.params).toEqual(['first', 'second', 'u_1']);
  });

  it('registers exactly the placeholder it writes, and none for a visitor', () => {
    const visitor = new Sql();
    expect(helper(visitor, null)).not.toMatch(/\?\d/);
    expect(visitor.params).toEqual([]);

    const member = new Sql();
    const sql = helper(member, 'u_1');
    expect(sql.match(/\?\d+/g)).toEqual(['?1']);
    expect(member.params).toHaveLength(1);
  });

  it('passes the viewer id as a bound parameter, never inside the SQL text', () => {
    const hostile = "u_1' OR '1'='1";
    const q = new Sql();
    const sql = helper(q, hostile);
    expect(sql).not.toContain(hostile);
    expect(sql).not.toContain("'1'='1");
    expect(q.params).toEqual([hostile]);
  });
});
