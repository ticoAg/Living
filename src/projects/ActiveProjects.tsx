import { Link } from 'wouter';
import { Icon } from '../components/icons';
import { MY_PROJECTS, useProjectList } from './api';
import { spanText } from './ProjectCard';
import { byStatusAndTouch } from './stages';
import '../styles/projects.css';

// On Today: the projects going on, each a step from its next entry. A check marks those with an entry finished today.

export default function ActiveProjects({ today }: { today: string }) {
  const { projects } = useProjectList(MY_PROJECTS);
  const active = (projects ?? []).filter((p) => p.status === 'active' && p.startDate <= today).sort(byStatusAndTouch);
  if (!active.length) return null;
  return (
    <section className="td-section" aria-labelledby="td-projects">
      <h2 id="td-projects" className="en-h2">
        进行中
      </h2>
      <ul className="pj-now">
        {active.map((p) => {
          const done = p.lastOccurredAt?.slice(0, 10) === today;
          return (
            <li key={p.id} className="pj-now-item">
              <Link href={`/projects/${p.id}`} className="pj-now-link">
                <span className="pj-now-title">{p.title}</span>
                <span className="pj-now-day mono">{spanText(p, today)}</span>
                {done && (
                  <span className="pj-now-done">
                    <Icon name="check" size={16} />
                    <span className="visually-hidden">今天记过了</span>
                  </span>
                )}
              </Link>
              <Link href={`/entries/new?project=${encodeURIComponent(p.id)}`} className="btn btn-quiet pj-now-add">
                <Icon name="plus" size={18} />
                记一笔<span className="visually-hidden">：{p.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
