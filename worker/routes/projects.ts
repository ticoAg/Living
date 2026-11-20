// Projects (项目): a goal or a long piece of work, with the entries written along the way and milestones. Private
// unless the author says otherwise; showing one never shows an entry or photo the reader may not open.
// Contract: /docs/api/projects.md

import { Hono } from 'hono';
import { MILESTONE_LIMITS } from '../../shared/limits';
import type { ProjectListResponse, ProjectStatus, SessionUser, Visibility } from '../../shared/types';
import type { AppEnv } from '../env';
import { forbidden, invalid, listCache, notFound, paramId, readJson, unauthenticated, type Ctx } from '../lib/http';
import { newId } from '../lib/ids';
import { assertDays, parseMilestoneFields, parseProjectFields } from '../lib/projectInput';
import { loadProjectDetail, selectProjects, toMilestone, type MilestoneRow } from '../lib/projects';
import { requireUser, viewerId } from '../lib/session';
import { grantFor, sharedCache } from '../lib/shares';
import { nowIso, prep, prepInsert, prepQ, Sql } from '../lib/sql';
import { projectList } from '../lib/visibility';

export const projects = new Hono<AppEnv>({ strict: false });

// ---- reading ------------------------------------------------------------------------------------------------------

projects.get('/', async (c) => {
  const viewer = await viewerId(c);
  const db = c.env.DB;
  const ownerHandle = c.req.query('owner');
  const mine = ['1', 'true'].includes(c.req.query('mine') ?? '');
  if (mine && !viewer) throw unauthenticated();

  const q = new Sql();
  const where = [projectList(q, viewer, 'pj')];
  if (mine) where.push(`pj.owner_id = ${q.p(viewer)}`);
  if (ownerHandle) where.push(`u.handle = ${q.p(ownerHandle)}`);
  if (!mine && !ownerHandle) where.push(`pj.visibility = 'public'`);
  const list = await selectProjects(db, viewer, q, where.join(' AND '));
  listCache(c, viewer);
  return c.json({ projects: list } satisfies ProjectListResponse);
});

projects.get('/:id', async (c) => {
  const id = paramId(c);
  const grant = await grantFor(c, 'project', id);
  const detail = await loadProjectDetail(c.env.DB, id, await viewerId(c), grant);
  if (!detail) throw notFound('项目不存在，或你没有权限查看');
  if (grant) sharedCache(c);
  return c.json(detail);
});

// ---- writing ------------------------------------------------------------------------------------------------------

interface OwnedProject {
  id: string;
  owner_id: string;
  visibility: Visibility;
  status: ProjectStatus;
  start_date: string;
  end_date: string | null;
}

/** The project if the user owns it; 404 for others' projects they cannot open, 403 for ones they can. */
async function ownedProject(c: Ctx, user: SessionUser, id: string): Promise<OwnedProject> {
  const row = await c.env.DB.prepare('SELECT id, owner_id, visibility, status, start_date, end_date FROM projects WHERE id = ?1')
    .bind(id)
    .first<OwnedProject>();
  if (!row) throw notFound('项目不存在');
  if (row.owner_id !== user.id) {
    if (row.visibility === 'private') throw notFound('项目不存在');
    throw forbidden('只能修改自己的项目');
  }
  return row;
}

async function detailOf(c: Ctx, id: string, user: SessionUser) {
  const detail = await loadProjectDetail(c.env.DB, id, user.id);
  if (!detail) throw notFound('项目不存在');
  return detail;
}

projects.post('/', async (c) => {
  const user = await requireUser(c);
  const f = parseProjectFields(await readJson(c), true);
  const startDate = f.startDate as string;
  assertDays(startDate, f.endDate ?? null);
  const id = newId.project();
  const now = nowIso();
  await prepInsert(c.env.DB, 'projects', {
    id,
    owner_id: user.id,
    type: f.type ?? 'other',
    title: f.title,
    description: f.description ?? null,
    start_date: startDate,
    end_date: f.endDate ?? null,
    status: f.status ?? 'active',
    // private unless the author chooses otherwise
    visibility: f.visibility ?? 'private',
    created_at: now,
    updated_at: now
  }).run();
  return c.json({ project: await detailOf(c, id, user) }, 201);
});

projects.patch('/:id', async (c) => {
  const user = await requireUser(c);
  const row = await ownedProject(c, user, paramId(c));
  const f = parseProjectFields(await readJson(c), false);
  assertDays(f.startDate ?? row.start_date, 'endDate' in f ? (f.endDate ?? null) : row.end_date);

  const q = new Sql();
  const sets: string[] = [];
  const set = (col: string, v: unknown) => sets.push(`${col} = ${q.p(v)}`);
  if (f.title) set('title', f.title);
  if (f.type) set('type', f.type);
  if ('description' in f) set('description', f.description ?? null);
  if (f.startDate) set('start_date', f.startDate);
  if ('endDate' in f) set('end_date', f.endDate ?? null);
  if (f.status) set('status', f.status);
  if (f.visibility) set('visibility', f.visibility);
  if (sets.length) {
    set('updated_at', nowIso());
    await prepQ(c.env.DB, `UPDATE projects SET ${sets.join(', ')} WHERE id = ${q.p(row.id)}`, q).run();
  }
  return c.json({ project: await detailOf(c, row.id, user) });
});

projects.delete('/:id', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const row = await ownedProject(c, user, paramId(c));
  // the entries stay: a project only gathers them
  await db.batch([
    prep(db, 'DELETE FROM entry_projects WHERE project_id = ?1', row.id),
    prep(db, 'DELETE FROM milestones WHERE project_id = ?1', row.id),
    prep(db, 'DELETE FROM share_links WHERE project_id = ?1', row.id),
    prep(db, 'DELETE FROM projects WHERE id = ?1', row.id)
  ]);
  return c.json({ ok: true });
});

// ---- milestones ---------------------------------------------------------------------------------------------------

const touch = (db: D1Database, projectId: string, now: string) =>
  prep(db, 'UPDATE projects SET updated_at = ?1 WHERE id = ?2', now, projectId);

async function ownedMilestone(c: Ctx, projectId: string): Promise<MilestoneRow> {
  const row = await c.env.DB.prepare('SELECT * FROM milestones WHERE id = ?1 AND project_id = ?2')
    .bind(paramId(c, 'milestoneId'), projectId)
    .first<MilestoneRow>();
  if (!row) throw notFound('里程碑不存在');
  return row;
}

projects.post('/:id/milestones', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const project = await ownedProject(c, user, paramId(c));
  const f = parseMilestoneFields(await readJson(c), true);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM milestones WHERE project_id = ?1').bind(project.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MILESTONE_LIMITS.count) throw invalid(`一个项目最多 ${MILESTONE_LIMITS.count} 个里程碑`);
  const id = newId.milestone();
  const now = nowIso();
  await db.batch([
    prepInsert(db, 'milestones', {
      id,
      project_id: project.id,
      title: f.title,
      body: f.body ?? null,
      date: f.date,
      created_at: now,
      updated_at: now
    }),
    touch(db, project.id, now)
  ]);
  const row = await db.prepare('SELECT * FROM milestones WHERE id = ?1').bind(id).first<MilestoneRow>();
  return c.json({ milestone: toMilestone(row as MilestoneRow) }, 201);
});

projects.patch('/:id/milestones/:milestoneId', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const project = await ownedProject(c, user, paramId(c));
  const row = await ownedMilestone(c, project.id);
  const f = parseMilestoneFields(await readJson(c), false);

  const q = new Sql();
  const sets: string[] = [];
  const set = (col: string, v: unknown) => sets.push(`${col} = ${q.p(v)}`);
  if (f.title) set('title', f.title);
  if ('body' in f) set('body', f.body ?? null);
  if (f.date) set('date', f.date);
  if (sets.length) {
    const now = nowIso();
    set('updated_at', now);
    await db.batch([prepQ(db, `UPDATE milestones SET ${sets.join(', ')} WHERE id = ${q.p(row.id)}`, q), touch(db, project.id, now)]);
  }
  const updated = await db.prepare('SELECT * FROM milestones WHERE id = ?1').bind(row.id).first<MilestoneRow>();
  return c.json({ milestone: toMilestone(updated as MilestoneRow) });
});

projects.delete('/:id/milestones/:milestoneId', async (c) => {
  const user = await requireUser(c);
  const db = c.env.DB;
  const project = await ownedProject(c, user, paramId(c));
  const row = await ownedMilestone(c, project.id);
  await db.batch([prep(db, 'DELETE FROM milestones WHERE id = ?1', row.id), touch(db, project.id, nowIso())]);
  return c.json({ ok: true });
});
