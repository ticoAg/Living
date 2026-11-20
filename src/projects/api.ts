import { useMemo } from 'react';
import type { PhotoSummary, ProjectDetail, ProjectListResponse } from '../../shared/types';
import { useApi } from '../lib/useApi';

// Typed readers over the shared GET cache for the project pages.

/** The signed-in author's own projects. */
export const MY_PROJECTS = '/api/projects?mine=1';

export const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
export const projectEntriesPath = (id: string) => `/api/entries?project=${encodeURIComponent(id)}`;

export function useProjectList(path: string | null) {
  const r = useApi<ProjectListResponse>(path);
  return { projects: r.data?.projects, error: r.error, reload: r.reload };
}

export function useProject(id: string | null) {
  const r = useApi<ProjectDetail>(id ? projectPath(id) : null);
  const photos = r.data?.photos;
  const photoById = useMemo(() => new Map<string, PhotoSummary>((photos ?? []).map((p) => [p.id, p])), [photos]);
  return { project: r.data, photoById, error: r.error, reload: r.reload };
}
