import { useMemo } from 'react';
import { Link } from 'wouter';
import { PROJECT_STATUSES, type ProjectStatus } from '../../shared/types';
import { EmptyState, LoadError, Loading } from '../browse/ui';
import ArchiveTabs from '../entries/ArchiveTabs';
import { SignedOut } from '../entries/ui';
import { Icon } from '../components/icons';
import { localDay } from '../lib/format';
import { useSession } from '../lib/session';
import ProjectCard from '../projects/ProjectCard';
import { MY_PROJECTS, useProjectList } from '../projects/api';
import { byStatusAndTouch } from '../projects/stages';
import { useDocumentTitle, useScrollTop } from '../themes/hooks';
import '../styles/browse.css';
import '../styles/entries.css';
import '../styles/projects.css';

// /projects — one's own projects: those going on first, then paused, then completed; within each, the one most
// recently worked on first. Docs: /docs/product/features/projects.md

const HEADINGS: Record<ProjectStatus, string> = { active: '进行中', paused: '暂停', completed: '已完成' };

function Body() {
  const { projects, error, reload } = useProjectList(MY_PROJECTS);
  const today = localDay();
  const groups = useMemo(() => {
    const sorted = [...(projects ?? [])].sort(byStatusAndTouch);
    return PROJECT_STATUSES.map((s) => ({ status: s, list: sorted.filter((p) => p.status === s) })).filter((g) => g.list.length);
  }, [projects]);

  if (error && !projects) return <LoadError error={error} onRetry={reload} />;
  if (!projects) return <Loading />;
  if (!projects.length) {
    return (
      <EmptyState title="还没有项目">
        <Link href="/projects/new" className="btn btn-primary">
          新建项目
        </Link>
      </EmptyState>
    );
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.status} className="pj-group" aria-labelledby={`pj-${g.status}`}>
          <h2 id={`pj-${g.status}`} className="en-h2">
            {HEADINGS[g.status]}
          </h2>
          <ul className="pj-list">
            {g.list.map((p) => (
              <li key={p.id}>
                <ProjectCard project={p} today={today} own />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export default function Projects() {
  const { user, loading } = useSession();
  useDocumentTitle('项目');
  useScrollTop();
  return (
    <main className="page-narrow en">
      <ArchiveTabs />
      <header className="en-head pj-head">
        <h1 className="display display-l">项目</h1>
        {user && (
          <Link href="/projects/new" className="btn btn-quiet pj-new">
            <Icon name="plus" size={18} />
            新建项目
          </Link>
        )}
      </header>
      {loading ? <Loading /> : user ? <Body /> : <SignedOut title="登录后查看自己的项目" next="/projects" />}
    </main>
  );
}
