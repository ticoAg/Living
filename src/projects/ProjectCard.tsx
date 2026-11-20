import { Link } from 'wouter';
import { PROJECT_STATUS_LABELS, projectTypeLabel } from '../../shared/projects';
import type { ProjectSummary } from '../../shared/types';
import Img from '../components/Img';
import { fmtDay } from '../lib/format';
import { VISIBILITY_LABEL } from '../themes/util';
import { projectSpan } from './stages';

// A project in a list: its latest work, its name, how long it has run and how much it holds. The whole card is one
// link to the project.

export function spanText(p: ProjectSummary, today: string): string {
  const span = projectSpan(p, today);
  if (!span) return `${fmtDay(p.startDate)} 开始`;
  if (span.ended) return `历时 ${span.days} 天`;
  return p.status === 'paused' ? `暂停 · 第 ${span.days} 天` : `第 ${span.days} 天`;
}

export function countsText(p: ProjectSummary): string {
  if (!p.entryCount) return '还没有记录';
  return [`${p.entryCount} 条记录`, p.dayCount > 1 ? `${p.dayCount} 天` : '', p.photoCount ? `${p.photoCount} 张照片` : '']
    .filter(Boolean)
    .join(' · ');
}

export default function ProjectCard({ project: p, today, own }: { project: ProjectSummary; today: string; own?: boolean }) {
  const marks = [
    projectTypeLabel(p.type),
    p.status === 'active' ? '' : PROJECT_STATUS_LABELS[p.status],
    own ? `${VISIBILITY_LABEL[p.visibility]}${p.visibility === 'public' ? '' : '可见'}` : ''
  ].filter(Boolean);
  return (
    <Link href={`/projects/${p.id}`} className="pj-card" data-status={p.status}>
      <span className="pj-card-cover">{p.cover ? <Img photo={p.cover} ratio="4 / 3" sizes="200px" alt="" /> : null}</span>
      <span className="pj-card-body">
        <span className="pj-card-meta">
          {marks.map((m) => (
            <span key={m} className="en-mark">
              {m}
            </span>
          ))}
          <span className="mono">{spanText(p, today)}</span>
        </span>
        <span className="pj-card-title">{p.title}</span>
        <span className="pj-card-counts small">{countsText(p)}</span>
      </span>
    </Link>
  );
}
