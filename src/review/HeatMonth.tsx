import { Link } from 'wouter';
import { holdsText, monthWeeks, type HeatLevel } from './calendar';

// One month as a small grid of days, weeks from Monday, each day as dark as what it holds: the year in review and a
// project's rhythm. Pointing at a day or focusing it tells what it holds. Docs: /docs/product/features/calendar.md

export type DayCount = { entries: number; photos: number };

interface Props {
  year: number;
  month: number;
  counts: ReadonlyMap<string, DayCount>;
  level: (n: number) => HeatLevel;
  today: string;
  /** the heading, 3月 by default */
  label?: string;
  /** where the heading links: the month on the calendar */
  href?: string;
  /** where a day with something links; without it the days only tell */
  dayHref?: (day: string) => string;
}

export const monthDay = (day: string) => `${+day.slice(5, 7)}月${+day.slice(8, 10)}日`;

export default function HeatMonth({ year, month, counts, level, today, label, href, dayHref }: Props) {
  const name = label ?? `${month}月`;
  const total = { entries: 0, photos: 0 };
  for (const [day, c] of counts) {
    if (+day.slice(0, 4) !== year || +day.slice(5, 7) !== month) continue;
    total.entries += c.entries;
    total.photos += c.photos;
  }
  const sum = holdsText(total, true);
  return (
    <section className="hm" aria-label={name}>
      <h3 className="hm-name">
        {href ? <Link href={href}>{name}</Link> : name}
        {sum && <span className="hm-sum mono">{sum}</span>}
      </h3>
      <div className="hm-days">
        {monthWeeks(year, month)
          .flat()
          .map((day, i) => {
            if (!day) return <span key={`pad${i}`} className="hm-pad" aria-hidden="true" />;
            const c = counts.get(day);
            const n = c ? c.entries + c.photos : 0;
            const tip = n ? `${monthDay(day)}：${holdsText(c!)}` : monthDay(day);
            const common = {
              className: 'hm-day',
              'data-level': level(n),
              'data-col': i % 7,
              'data-today': day === today ? 'true' : undefined,
              'data-future': !n && day > today ? 'true' : undefined,
              'data-tip': tip
            };
            if (!n) return <span key={day} {...common} aria-hidden="true" />;
            if (dayHref) return <Link key={day} href={dayHref(day)} {...common} aria-label={tip} />;
            return <span key={day} {...common} role="img" aria-label={tip} />;
          })}
      </div>
    </section>
  );
}
