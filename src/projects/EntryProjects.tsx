import { MY_PROJECTS, useProjectList } from './api';
import { byStatusAndTouch } from './stages';

// The projects an entry belongs to, chosen in the entry editor: one's projects still going or paused, and any it is
// already in. Nothing shows for someone with none of those.

export default function EntryProjects({
  id,
  value,
  onChange
}: {
  id: string;
  value: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const { projects } = useProjectList(MY_PROJECTS);
  const shown = (projects ?? []).filter((p) => p.status !== 'completed' || value.includes(p.id)).sort(byStatusAndTouch);
  if (!shown.length) return null;
  const toggle = (pid: string) => onChange(value.includes(pid) ? value.filter((v) => v !== pid) : [...value, pid]);
  return (
    <section className="ee-sec" aria-labelledby={id}>
      <h2 id={id} className="ee-h">
        项目
      </h2>
      <div className="row ee-projects" role="group" aria-labelledby={id}>
        {shown.map((p) => (
          <button key={p.id} type="button" className="chip chip-outline" aria-pressed={value.includes(p.id)} onClick={() => toggle(p.id)}>
            {p.title}
          </button>
        ))}
      </div>
    </section>
  );
}
