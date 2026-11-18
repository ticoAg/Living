import { useMemo } from 'react';
import { Link, useParams } from 'wouter';
import { dayOf } from '../../shared/days';
import { ENTRY_TYPE_LABELS } from '../../shared/entries';
import { PROJECT_STATUS_LABELS, projectTypeLabel } from '../../shared/projects';
import type { ReviewYearsResponse, YearReview as Review } from '../../shared/types';
import { EmptyState, LoadError, Loading } from '../browse/ui';
import ArchiveTabs from '../entries/ArchiveTabs';
import PhotoRun from '../entries/PhotoRun';
import { SignedOut } from '../entries/ui';
import { fmtDay, localDay } from '../lib/format';
import { useSession } from '../lib/session';
import { swatchFill } from '../lib/tags';
import { useApi } from '../lib/useApi';
import { calendarHref, fmtAmount, heatScale, holdsText, streaks } from '../review/calendar';
import HeatMonth, { type DayCount } from '../review/HeatMonth';
import ThemeCard from '../themes/ThemeCard';
import { useDocumentTitle, useScrollTop } from '../themes/hooks';
import '../styles/browse.css';
import '../styles/entries.css';
import '../styles/review.css';
import '../styles/themes.css';

// /archive/:year — a year looked back on: how much it holds, its days month by month, the favourite photos, the
// projects worked on and collections made, the places and tags most used, the kinds of entries. Only one's own, from
// /api/review/:year. Docs: /docs/product/features/calendar.md

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function Stat({ label, n }: { label: string; n: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="rv-stat-n">{n}</dd>
    </div>
  );
}

/** A year as its address and heading spell it: four digits. */
const yyyy = (y: number) => String(y).padStart(4, '0');

/** The years that hold anything, to move between; none while this is the only one. */
function Years({ year }: { year: number }) {
  const r = useApi<ReviewYearsResponse>('/api/review');
  const years = r.data?.years ?? [];
  if (years.length === 0 || (years.length === 1 && years[0].year === year)) return null;
  return (
    <nav className="ar-years mono" aria-label="年份">
      {years.map((y) => (
        <Link key={y.year} href={`/archive/${yyyy(y.year)}`} aria-current={y.year === year ? 'page' : undefined}>
          {yyyy(y.year)}
        </Link>
      ))}
    </nav>
  );
}

function Body({ year }: { year: number }) {
  const r = useApi<Review>(`/api/review/${yyyy(year)}`);
  const today = localDay();
  const review = r.data;
  const counts = useMemo(() => new Map<string, DayCount>((review?.days ?? []).map((d) => [d.day, d])), [review]);
  const level = useMemo(() => heatScale(Math.max(0, ...(review?.days ?? []).map((d) => d.entries + d.photos))), [review]);

  if (r.error && !review) return <LoadError error={r.error} onRetry={r.reload} />;
  if (!review) return <Loading />;

  const entries = review.days.reduce((n, d) => n + d.entries, 0);
  const photos = review.days.reduce((n, d) => n + d.photos, 0);
  if (entries + photos === 0) {
    return (
      <>
        <Years year={year} />
        <EmptyState title={`${yyyy(year)} 年没有内容`}>
          <Link href="/archive/calendar" className="btn">
            打开日历
          </Link>
        </EmptyState>
      </>
    );
  }
  const run = streaks(
    review.days.map((d) => d.day),
    today
  ).longest;
  const typeMax = Math.max(...review.types.map((t) => t.count));

  return (
    <>
      <Years year={year} />
      <dl className="rv-stats">
        <Stat label="记录" n={fmtAmount(entries)} />
        <Stat label="照片" n={fmtAmount(photos)} />
        <Stat label="天" n={fmtAmount(review.days.length)} />
        {run > 1 && <Stat label="最长连续" n={`${run} 天`} />}
        {review.placeCount > 0 && <Stat label="地点" n={fmtAmount(review.placeCount)} />}
        {review.chars > 0 && <Stat label="字" n={fmtAmount(review.chars)} />}
      </dl>

      <section className="rv-sec" aria-labelledby="rv-days">
        <h2 id="rv-days" className="en-h2">
          每一天
        </h2>
        <div className="rv-months">
          {MONTHS.map((m) => {
            const ym = dayOf(year, m, 1).slice(0, 7);
            return (
              <HeatMonth
                key={m}
                year={year}
                month={m}
                counts={counts}
                level={level}
                today={today}
                href={calendarHref(ym)}
                dayHref={(d) => calendarHref(ym, d)}
              />
            );
          })}
        </div>
      </section>

      {review.favorites.length > 0 && (
        <section className="rv-sec" aria-labelledby="rv-fav">
          <h2 id="rv-fav" className="en-h2">
            收藏
          </h2>
          <PhotoRun photos={review.favorites} label={`${yyyy(year)} 年收藏的照片`} />
        </section>
      )}

      {review.projects.length > 0 && (
        <section className="rv-sec" aria-labelledby="rv-projects">
          <h2 id="rv-projects" className="en-h2">
            项目
          </h2>
          <ul className="rv-projects">
            {review.projects.map((p) => (
              <li key={p.id}>
                <div className="rv-project">
                  <Link href={`/projects/${p.id}`} className="rv-project-name">
                    {p.title}
                  </Link>
                  <span className="rv-project-meta">
                    <span className="en-mark">{projectTypeLabel(p.type)}</span>
                    {p.status !== 'active' && <span className="en-mark">{PROJECT_STATUS_LABELS[p.status]}</span>}
                    {p.entries > 0 && <span>{p.days > 1 ? `${p.entries} 条记录 · ${p.days} 天` : `${p.entries} 条记录`}</span>}
                  </span>
                </div>
                {p.milestones.length > 0 && (
                  <ol className="rv-marks">
                    {p.milestones.map((m) => (
                      <li key={m.id}>
                        <span className="mono">{fmtDay(m.date)}</span> {m.title}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.collections.length > 0 && (
        <section className="rv-sec" aria-labelledby="rv-collections">
          <h2 id="rv-collections" className="en-h2">
            合集
          </h2>
          <ul className="th-grid rv-collections">
            {review.collections.map((t) => (
              <li key={t.id}>
                <ThemeCard theme={t} own level={3} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.places.length > 0 && (
        <section className="rv-sec" aria-labelledby="rv-places">
          <h2 id="rv-places" className="en-h2">
            地点
          </h2>
          <ol className="rv-rank">
            {review.places.map((p) => (
              <li key={p.id}>
                <Link href={`/place/${p.id}`} className="rv-rank-name">
                  {p.name}
                </Link>
                <span className="rv-rank-sub">{p.district ?? p.city ?? ''}</span>
                <span className="rv-rank-n mono">{holdsText(p, true)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {review.tags.length > 0 && (
        <section className="rv-sec" aria-labelledby="rv-tags">
          <h2 id="rv-tags" className="en-h2">
            标签
          </h2>
          <ul className="rv-tags">
            {review.tags.map((t) => (
              <li key={t.id}>
                <Link href={`/archive?tags=${encodeURIComponent(t.id)}`} className="chip chip-outline">
                  {t.color && <span className="rv-swatch" style={{ background: swatchFill(t.color) }} aria-hidden="true" />}
                  {t.name}
                  <span className="mono rv-tag-n">{t.photos + t.entries}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.types.length > 1 && (
        <section className="rv-sec" aria-labelledby="rv-types">
          <h2 id="rv-types" className="en-h2">
            类型
          </h2>
          <ol className="rv-bars">
            {review.types.map((t) => (
              <li key={t.type}>
                <span className="rv-bar-name">{ENTRY_TYPE_LABELS[t.type]}</span>
                <span className="rv-bar-track">
                  <span className="rv-bar" style={{ width: `${(t.count / typeMax) * 100}%` }} />
                </span>
                <span className="rv-bar-n mono">{t.count}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

export default function YearReview() {
  const { year: raw } = useParams<{ year: string }>();
  const year = +raw;
  const { user, loading } = useSession();
  useDocumentTitle(`${raw} 年`);
  useScrollTop(raw);
  return (
    <main className="page-narrow en">
      <ArchiveTabs />
      <header className="en-head">
        <h1 className="display display-l mono rv-year">{raw}</h1>
      </header>
      {loading ? <Loading /> : user ? <Body year={year} /> : <SignedOut title="登录后回顾自己的一年" next={`/archive/${raw}`} />}
    </main>
  );
}
