import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { Link } from 'wouter';
import { addDays, dayOf, isDay, monthSpan, parseMonth } from '../../shared/days';
import { LoadError, Loading, TruncatedNote } from '../browse/ui';
import { replaceQuery, useQuery } from '../browse/url';
import { Icon } from '../components/icons';
import Img from '../components/Img';
import { MY_ENTRIES, MY_PHOTOS, useEntryList, usePhotoMap, useTagMap } from '../entries/api';
import ArchiveTabs from '../entries/ArchiveTabs';
import EntryCard from '../entries/EntryCard';
import PhotoRun from '../entries/PhotoRun';
import { buildTimeline, keepEntries } from '../entries/timeline';
import { DayName, SignedOut } from '../entries/ui';
import { fmtLongDay, localDay } from '../lib/format';
import { useSession } from '../lib/session';
import { dayMarks, holdsText, monthWeeks, shiftMonth, type DayMark } from '../review/calendar';
import { useDocumentTitle, useScrollTop } from '../themes/hooks';
import '../styles/browse.css';
import '../styles/entries.css';
import '../styles/review.css';

// /archive/calendar — one's archive a month at a time: each day shows what it holds, and the day chosen shows all of
// it beside the month. ?month=YYYY-MM picks the month (this one by default), ?day=YYYY-MM-DD the day: today in this
// month, else the month's latest day with anything. Docs: /docs/product/features/calendar.md

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

interface CellProps {
  day: string;
  mark?: DayMark;
  today: string;
  /** the day shown beside the month */
  chosen: boolean;
  /** the one day Tab reaches: the chosen day, else the first */
  tabbable: boolean;
  onPick: () => void;
}

function Cell({ day, mark, today, chosen, tabbable, onPick }: CellProps) {
  const holds = mark ? holdsText(mark) : '';
  const label = [fmtLongDay(day), day === today ? '今天' : '', holds].filter(Boolean).join('，');
  return (
    <button
      type="button"
      className="cal-day"
      data-day={day}
      data-has={mark ? 'true' : undefined}
      data-cover={mark?.cover ? 'true' : undefined}
      data-today={day === today ? 'true' : undefined}
      aria-pressed={chosen}
      aria-label={label}
      tabIndex={tabbable ? 0 : -1}
      onClick={onPick}
    >
      {mark?.cover && <Img photo={mark.cover} ratio="fill" sizes="96px" alt="" />}
      <span className="cal-num mono">{+day.slice(8)}</span>
      {mark && mark.entries > 0 && (
        <span className="cal-dots" aria-hidden="true">
          {Array.from({ length: Math.min(3, mark.entries) }, (_, i) => (
            <i key={i} />
          ))}
        </span>
      )}
    </button>
  );
}

function Body() {
  const query = useQuery();
  const today = localDay();
  const month = parseMonth(query.get('month')) ?? today.slice(0, 7);
  const year = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  const { from, to } = monthSpan(month);
  const list = useEntryList(`${MY_ENTRIES}&from=${from}&to=${to}`);
  const photos = usePhotoMap(`${MY_PHOTOS}&from=${from}&to=${to}`);
  const tags = useTagMap();

  const entries = useMemo(() => keepEntries(list.entries ?? [], 'all', false), [list.entries]);
  const shot = photos.photos;
  const marks = useMemo(() => dayMarks(entries, shot ?? [], photos.byId), [entries, shot, photos.byId]);
  const timeline = useMemo(() => buildTimeline(entries, shot ?? []), [entries, shot]);
  const loaded = !!list.entries && (!!shot || !!photos.error);

  const asked = query.get('day');
  const day =
    asked && isDay(asked) && asked.startsWith(month)
      ? asked
      : month === today.slice(0, 7)
        ? today
        : loaded
          ? (timeline.days[0]?.day ?? null)
          : null;
  const shown = day ? timeline.days.find((d) => d.day === day) : undefined;
  const total = useMemo(() => {
    let e = 0;
    let p = 0;
    for (const mk of marks.values()) {
      e += mk.entries;
      p += mk.photos;
    }
    return { entries: e, photos: p, days: marks.size };
  }, [marks]);

  // a day chosen with the arrow keys takes the focus along, into the next month too
  const grid = useRef<HTMLDivElement>(null);
  const follow = useRef<string | null>(null);
  useEffect(() => {
    if (!follow.current || follow.current !== day) return;
    follow.current = null;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus();
  }, [day]);
  const pick = (d: string) => replaceQuery({ month: d.slice(0, 7), day: d });
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP[e.key];
    const at = (e.target as HTMLElement).dataset.day;
    if (!step || !at) return;
    e.preventDefault();
    const next = addDays(at, step);
    follow.current = next;
    pick(next);
  };
  const go = (to: string) => replaceQuery({ month: to, day: null });

  const weeks = monthWeeks(year, m);
  // the first day keeps the grid reachable by Tab when no day is chosen
  const focusDay = day ?? dayOf(year, m, 1);

  return (
    <div className="cal">
      <div className="cal-month">
        <div className="cal-head">
          <h2 className="cal-title">
            <Link href={`/archive/${month.slice(0, 4)}`}>{year}年</Link>
            {m}月
          </h2>
          <div className="cal-nav">
            <button type="button" className="btn btn-ghost btn-icon" aria-label="上个月" onClick={() => go(shiftMonth(month, -1))}>
              <Icon name="left" size={18} />
            </button>
            <button type="button" className="btn btn-ghost btn-icon" aria-label="下个月" onClick={() => go(shiftMonth(month, 1))}>
              <Icon name="right" size={18} />
            </button>
            {(month !== today.slice(0, 7) || day !== today) && (
              <button type="button" className="btn btn-quiet cal-today" onClick={() => replaceQuery({ month: null, day: null })}>
                今天
              </button>
            )}
          </div>
        </div>
        <p className="cal-sum">
          {loaded && ([total.days ? `${total.days} 天` : '', holdsText(total)].filter(Boolean).join(' · ') || '这个月没有内容')}
        </p>
        <div className="cal-week" aria-hidden="true">
          {WEEK.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div ref={grid} className="cal-grid" role="group" aria-label={`${year}年${m}月`} onKeyDown={onKey}>
          {weeks
            .flat()
            .map((d, i) =>
              d ? (
                <Cell
                  key={d}
                  day={d}
                  mark={marks.get(d)}
                  today={today}
                  chosen={d === day}
                  tabbable={d === focusDay}
                  onPick={() => pick(d)}
                />
              ) : (
                <span key={`pad${i}`} className="cal-pad" />
              )
            )}
        </div>
        {photos.truncated && <TruncatedNote />}
      </div>

      <section className="cal-panel" aria-labelledby="cal-day">
        {day ? (
          <>
            <div className="cal-panel-head">
              <h2 id="cal-day" className="cal-panel-name">
                <DayName day={day} today={today} />
              </h2>
              <Link href={`/entries/new?date=${day}`} className="btn btn-quiet">
                <Icon name="plus" size={18} />
                {day < today ? '补记' : '记一笔'}
              </Link>
            </div>
            {list.error && !list.entries ? (
              <LoadError error={list.error} onRetry={list.reload} />
            ) : !loaded ? (
              <Loading />
            ) : shown ? (
              <div className="cal-panel-body">
                {shown.segments.map((s) =>
                  s.kind === 'entry' ? (
                    <EntryCard key={s.entry.id} entry={s.entry} photos={photos.byId} tags={tags.byId} own />
                  ) : (
                    <PhotoRun key={s.photos[0].id} photos={s.photos} />
                  )
                )}
              </div>
            ) : (
              <p className="cal-none">这一天没有内容</p>
            )}
          </>
        ) : (
          <>
            <h2 id="cal-day" className="visually-hidden">
              {year}年{m}月
            </h2>
            {!loaded && !list.error && <Loading />}
            {list.error && !list.entries && <LoadError error={list.error} onRetry={list.reload} />}
          </>
        )}
      </section>
    </div>
  );
}

export default function Calendar() {
  const { user, loading } = useSession();
  useDocumentTitle('日历');
  useScrollTop();
  return (
    <main className="page-narrow en">
      <ArchiveTabs />
      <header className="en-head">
        <h1 className="display display-l">日历</h1>
      </header>
      {loading ? <Loading /> : user ? <Body /> : <SignedOut title="登录后查看自己的日历" next="/archive/calendar" />}
    </main>
  );
}
