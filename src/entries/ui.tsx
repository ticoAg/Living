import { Link } from 'wouter';
import { fmtLongDay, localDay } from '../lib/format';
import { encodeNext } from '../studio/util';

// Small pieces the entry pages share.

/** The pages of one's own archive, for a visitor who is not signed in. */
export function SignedOut({ title, next }: { title: string; next: string }) {
  return (
    <div className="en-empty">
      <p className="en-empty-title">{title}</p>
      <Link href={`/login?next=${encodeNext(next)}`} className="btn btn-primary">
        登录
      </Link>
    </div>
  );
}

/** The day before `day` (both YYYY-MM-DD). */
function dayBefore(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return localDay(d);
}

/** A day's heading on the timeline: 11月14日, 星期五, and 今天 or 昨天 when it is. */
export function DayName({ day, today }: { day: string; today: string }) {
  const [date, week] = fmtLongDay(day).split(' ');
  const near = day === today ? '今天' : day === dayBefore(today) ? '昨天' : '';
  return (
    <>
      <span className="en-day-date">{date}</span> <span className="en-day-week">{week}</span>
      {near && (
        <>
          {' '}
          <span className="en-day-near">{near}</span>
        </>
      )}
    </>
  );
}
