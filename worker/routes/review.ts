// Review (回顾): one's own archive by the calendar. The years that hold anything, and a year looked back on: its days,
// how much was written, the entry types, places and tags most used, the projects worked on and the collections made,
// the favourite photos. Only the signed-in owner's own entries (archived ones aside, as in the timeline) and photos,
// whatever their visibility; nothing of anyone else's. Docs: /docs/api/review.md

import { Hono } from 'hono';
import { endOfDay } from '../../shared/days';
import {
  REVIEW_FAVORITES,
  REVIEW_TOP,
  type EntryType,
  type ProjectStatus,
  type ProjectType,
  type ReviewDay,
  type ReviewPlace,
  type ReviewProject,
  type ReviewTag,
  type ReviewYearsResponse,
  type Visibility,
  type YearReview
} from '../../shared/types';
import type { AppEnv } from '../env';
import { invalid, unauthenticated } from '../lib/http';
import { PHOTO_FROM, SUMMARY_COLS, toSummary, type PhotoRow } from '../lib/photos';
import { viewerId } from '../lib/session';
import { prepQ, Sql } from '../lib/sql';
import { selectThemes } from './themes';

export const review = new Hono<AppEnv>({ strict: false });

/** The entries a review counts: all but the archived ones, which the timeline also leaves out by default. */
const KEPT = `e.status != 'archived'`;

review.get('/', async (c) => {
  const viewer = await viewerId(c);
  if (!viewer) throw unauthenticated();
  const q = new Sql();
  const v = q.p(viewer);
  const res = await prepQ(
    c.env.DB,
    `SELECT year, SUM(en) AS entries, SUM(ph) AS photos FROM (
       SELECT CAST(substr(e.occurred_at, 1, 4) AS INTEGER) AS year, 1 AS en, 0 AS ph FROM entries e WHERE e.owner_id = ${v} AND ${KEPT}
       UNION ALL
       SELECT CAST(substr(p.taken_at, 1, 4) AS INTEGER), 0, 1 FROM photos p WHERE p.owner_id = ${v} AND p.taken_at IS NOT NULL
     ) GROUP BY year ORDER BY year DESC`,
    q
  ).all<ReviewYearsResponse['years'][number]>();
  return c.json({ years: res.results } satisfies ReviewYearsResponse);
});

interface ProjectRow {
  id: string;
  title: string;
  type: ProjectType;
  status: ProjectStatus;
  visibility: Visibility;
  entries: number;
  days: number;
}

review.get('/:year', async (c) => {
  const viewer = await viewerId(c);
  if (!viewer) throw unauthenticated();
  const raw = c.req.param('year');
  if (!/^\d{4}$/.test(raw)) throw invalid('年份的格式应为 YYYY');
  const db = c.env.DB;
  const from = `${raw}-01-01`;
  const until = endOfDay(`${raw}-12-31`);

  /** A statement over the year: `E` keeps the owner's entries that happened in it, `P` their photos taken in it. */
  const st = (sql: (w: { v: string; f: string; u: string; E: string; P: string }) => string) => {
    const q = new Sql();
    const v = q.p(viewer);
    const f = q.p(from);
    const u = q.p(until);
    const E = `e.owner_id = ${v} AND ${KEPT} AND e.occurred_at >= ${f} AND e.occurred_at < ${u}`;
    const P = `p.owner_id = ${v} AND p.taken_at >= ${f} AND p.taken_at < ${u}`;
    return prepQ(db, sql({ v, f, u, E, P }), q);
  };

  const [days, types, places, tags, projects, milestones, favorites] = await db.batch([
    st(
      ({ E, P }) => `SELECT day, SUM(en) AS entries, SUM(ph) AS photos FROM (
          SELECT substr(e.occurred_at, 1, 10) AS day, 1 AS en, 0 AS ph FROM entries e WHERE ${E}
          UNION ALL
          SELECT substr(p.taken_at, 1, 10), 0, 1 FROM photos p WHERE ${P}
        ) GROUP BY day ORDER BY day`
    ),
    st(
      ({ E }) => `SELECT e.type, COUNT(*) AS count, SUM(length(coalesce(e.title, '')) + length(coalesce(e.body, ''))) AS chars
        FROM entries e WHERE ${E} GROUP BY e.type ORDER BY count DESC, e.type`
    ),
    st(
      ({ E, P }) => `SELECT po.id, po.name, po.category, po.city, po.district, x.photos, x.entries, COUNT(*) OVER () AS total FROM (
          SELECT poi_id, SUM(ph) AS photos, SUM(en) AS entries FROM (
            SELECT p.poi_id, 1 AS ph, 0 AS en FROM photos p WHERE ${P} AND p.poi_id IS NOT NULL
            UNION ALL
            SELECT e.poi_id, 0, 1 FROM entries e WHERE ${E} AND e.poi_id IS NOT NULL
          ) GROUP BY poi_id
        ) x JOIN pois po ON po.id = x.poi_id
        ORDER BY x.photos + x.entries DESC, po.name, po.id LIMIT ${REVIEW_TOP}`
    ),
    st(
      ({ E, P }) => `SELECT t.id, t.name, t.color, x.photos, x.entries FROM (
          SELECT tag_id, SUM(ph) AS photos, SUM(en) AS entries FROM (
            SELECT pt.tag_id, 1 AS ph, 0 AS en FROM photo_tags pt JOIN photos p ON p.id = pt.photo_id WHERE ${P}
            UNION ALL
            SELECT et.tag_id, 0, 1 FROM entry_tags et JOIN entries e ON e.id = et.entry_id WHERE ${E}
          ) GROUP BY tag_id
        ) x JOIN tags t ON t.id = x.tag_id
        ORDER BY x.photos + x.entries DESC, t.name, t.id LIMIT ${REVIEW_TOP}`
    ),
    st(({ v, f, u, E }) => {
      const mine = `FROM entry_projects ep JOIN entries e ON e.id = ep.entry_id WHERE ep.project_id = pj.id AND ${E}`;
      return `SELECT id, title, type, status, visibility, entries, days FROM (
          SELECT pj.id, pj.title, pj.type, pj.status, pj.visibility,
            (SELECT COUNT(*) ${mine}) AS entries,
            (SELECT COUNT(DISTINCT substr(e.occurred_at, 1, 10)) ${mine}) AS days,
            EXISTS (SELECT 1 FROM milestones ms WHERE ms.project_id = pj.id AND ms.date >= ${f} AND ms.date < ${u}) AS marked
          FROM projects pj WHERE pj.owner_id = ${v}
        ) WHERE entries > 0 OR marked ORDER BY entries DESC, title, id`;
    }),
    st(
      ({ v, f, u }) => `SELECT ms.id, ms.project_id, ms.title, ms.date FROM milestones ms JOIN projects pj ON pj.id = ms.project_id
        WHERE pj.owner_id = ${v} AND ms.date >= ${f} AND ms.date < ${u} ORDER BY ms.date, ms.id`
    ),
    st(
      ({ P }) => `SELECT ${SUMMARY_COLS} FROM ${PHOTO_FROM} WHERE ${P} AND p.favorite = 1
        ORDER BY p.taken_at, p.rowid LIMIT ${REVIEW_FAVORITES}`
    )
  ]);

  // collections of the year: a dated one when its days meet the year, an undated one when it was made in it
  const tq = new Sql();
  const tv = tq.p(viewer);
  const tf = tq.p(from);
  const tu = tq.p(until);
  const collections = await selectThemes(
    db,
    viewer,
    tq,
    `th.owner_id = ${tv} AND CASE WHEN th.start_date IS NOT NULL
       THEN th.start_date < ${tu} AND coalesce(th.end_date, th.start_date) >= ${tf}
       ELSE th.created_at >= ${tf} AND th.created_at < ${tu} END`
  );

  const typeRows = types.results as { type: EntryType; count: number; chars: number | null }[];
  const placeRows = places.results as (ReviewPlace & { total: number })[];
  const marks = new Map<string, ReviewProject['milestones']>();
  for (const m of milestones.results as { id: string; project_id: string; title: string; date: string }[]) {
    const list = marks.get(m.project_id) ?? [];
    list.push({ id: m.id, title: m.title, date: m.date });
    marks.set(m.project_id, list);
  }

  return c.json({
    year: +raw,
    days: days.results as ReviewDay[],
    chars: typeRows.reduce((n, r) => n + (r.chars ?? 0), 0),
    types: typeRows.map((r) => ({ type: r.type, count: r.count })),
    places: placeRows.map(({ total: _total, ...place }) => place),
    placeCount: placeRows[0]?.total ?? 0,
    tags: tags.results as ReviewTag[],
    projects: (projects.results as ProjectRow[]).map((r) => ({ ...r, milestones: marks.get(r.id) ?? [] })),
    collections: collections.map((t) => t.summary),
    favorites: (favorites.results as PhotoRow[]).map((r) => toSummary(r, viewer))
  } satisfies YearReview);
});
