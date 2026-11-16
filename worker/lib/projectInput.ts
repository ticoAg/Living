// Validation of the JSON bodies of the project routes: CreateProjectBody, UpdateProjectBody and the milestone bodies.
// Docs: /docs/api/projects.md

import { MILESTONE_LIMITS, PROJECT_LIMITS } from '../../shared/limits';
import { PROJECT_STATUSES, PROJECT_TYPES, VISIBILITIES, type ProjectStatus, type ProjectType, type Visibility } from '../../shared/types';
import { invalid } from './http';
import { cpLen, has, isDate, optEnum, optMarkdown, type Body } from './validate';

/** What a request sets; a key that is absent stays as it is. */
export interface ProjectFields {
  title?: string;
  type?: ProjectType;
  description?: string | null;
  startDate?: string;
  endDate?: string | null;
  status?: ProjectStatus;
  visibility?: Visibility;
}

/** A title that must be there: trimmed, not blank, at most `max` code points. */
function title(v: unknown, label: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw invalid(`请填写${label}`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (cpLen(s) > max) throw invalid(`${label}最多 ${max} 个字符`);
  return s;
}

function day(v: unknown, label: string): string {
  if (typeof v !== 'string' || !isDate(v.trim())) throw invalid(`${label}格式应为 YYYY-MM-DD`);
  return v.trim();
}

export function parseProjectFields(body: Body, create: boolean): ProjectFields {
  const f: ProjectFields = {};
  if (create || has(body, 'title')) f.title = title(body.title, '项目名称', PROJECT_LIMITS.titleMax);
  const type = optEnum<ProjectType>(body.type, '项目类型', PROJECT_TYPES);
  if (type) f.type = type;
  if (has(body, 'description')) f.description = optMarkdown(body.description, '项目说明', PROJECT_LIMITS.descriptionMax);
  if (create || has(body, 'startDate')) f.startDate = day(body.startDate, '开始日期');
  if (has(body, 'endDate')) f.endDate = body.endDate === null || body.endDate === '' ? null : day(body.endDate, '结束日期');
  const status = optEnum<ProjectStatus>(body.status, '项目状态', PROJECT_STATUSES);
  if (status) f.status = status;
  const visibility = optEnum<Visibility>(body.visibility, '公开范围', VISIBILITIES);
  if (visibility) f.visibility = visibility;
  return f;
}

/** The days in order: a project cannot end before it starts. */
export function assertDays(startDate: string, endDate: string | null): void {
  if (endDate && endDate < startDate) throw invalid('结束日期不能早于开始日期');
}

export interface MilestoneFields {
  title?: string;
  body?: string | null;
  date?: string;
}

export function parseMilestoneFields(body: Body, create: boolean): MilestoneFields {
  const f: MilestoneFields = {};
  if (create || has(body, 'title')) f.title = title(body.title, '里程碑名称', MILESTONE_LIMITS.titleMax);
  if (has(body, 'body')) f.body = optMarkdown(body.body, '里程碑说明', MILESTONE_LIMITS.bodyMax);
  if (create || has(body, 'date')) f.date = day(body.date, '里程碑日期');
  return f;
}
