import { useMemo } from 'react';
import type { EntrySummary, ProjectDetail } from '../../shared/types';
import { calendarHref, heatScale, perMonth } from '../review/calendar';
import HeatMonth, { type DayCount } from '../review/HeatMonth';
import MonthBars from '../review/MonthBars';
import { rhythmOf } from './stages';
import '../styles/review.css';

// A project's rhythm: its runs of days and how often a week, its last months day by day, and over a longer span the
// count of every month. Like the project's other figures it counts finished entries only, not drafts.
// Docs: /docs/product/features/projects.md

/** months drawn day by day */
const RECENT = 6;

const perWeekText = (n: number) => (n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ''));

export default function Rhythm({
  project: p,
  entries,
  today,
  own
}: {
  project: ProjectDetail;
  entries: readonly EntrySummary[];
  today: string;
  own: boolean;
}) {
  const done = useMemo(() => entries.filter((e) => e.status === 'published'), [entries]);
  const r = useMemo(() => rhythmOf(p, done, today), [p, done, today]);
  const counts = useMemo(() => {
    const out = new Map<string, DayCount>();
    for (const e of done) {
      const day = e.occurredAt.slice(0, 10);
      const c = out.get(day);
      if (c) c.entries++;
      else out.set(day, { entries: 1, photos: 0 });
    }
    return out;
  }, [done]);
  const level = useMemo(() => heatScale(Math.max(0, ...[...counts.values()].map((c) => c.entries))), [counts]);
  const bars = useMemo(() => (r && r.months.length > RECENT ? perMonth(done, r.months) : null), [r, done]);
  // one day of work is not yet a rhythm
  if (!r || r.days.size < 2) return null;

  const recent = r.months.slice(-RECENT);
  return (
    <section className="pj-sec" aria-labelledby="pj-rhythm">
      <h2 id="pj-rhythm" className="en-h2">
        节奏
      </h2>
      <p className="pj-rhythm">
        {r.longest > 1 && <span>最长连续 {r.longest} 天</span>}
        {p.status === 'active' && r.current > 1 && <span>现在连续 {r.current} 天</span>}
        <span>平均每周 {perWeekText(r.perWeek)} 天</span>
      </p>
      <div className="pj-months">
        {recent.map((ym, i) => {
          const y = +ym.slice(0, 4);
          const m = +ym.slice(5, 7);
          return (
            <HeatMonth
              key={ym}
              year={y}
              month={m}
              counts={counts}
              level={level}
              today={today}
              label={i === 0 || m === 1 ? `${y}年${m}月` : `${m}月`}
              href={own ? calendarHref(ym) : undefined}
              dayHref={own ? (d) => calendarHref(ym, d) : undefined}
            />
          );
        })}
      </div>
      {bars && <MonthBars data={bars} label="每月的记录" />}
    </section>
  );
}
