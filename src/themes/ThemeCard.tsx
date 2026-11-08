import { Link } from 'wouter';
import type { ThemeSummary } from '../../shared/types';
import Img from '../components/Img';
import { Icon } from '../components/icons';
import { fmtMonth } from '../lib/format';
import { fmtRange, KIND_LABEL, VISIBILITY_LABEL } from './util';

interface Props {
  theme: ThemeSummary;
  /** the viewer owns it: private and unlisted themes get a badge */
  own?: boolean;
  /** heading level of the title, to fit the page outline */
  level?: 2 | 3;
}

/** One theme in a grid: cover, kind, title, subtitle, author, dates, count. The whole card opens the travelogue. */
export default function ThemeCard({ theme, own, level = 2 }: Props) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const href = `/t/${theme.id}`;
  const dates = fmtRange(theme.startDate, theme.endDate) || (theme.updatedAt ? `更新 ${fmtMonth(theme.updatedAt)}` : '');
  return (
    <article className="th-card">
      <div className="th-card-cover">
        {theme.cover ? (
          <Img photo={theme.cover} ratio="4 / 3" sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 340px" alt="" />
        ) : (
          <div className="th-card-blank" aria-hidden="true">
            <Icon name="book" size={36} />
          </div>
        )}
        {own && theme.visibility !== 'public' && <span className="th-badge">{VISIBILITY_LABEL[theme.visibility]}</span>}
      </div>
      <div className="th-card-body">
        <p className="th-card-meta">
          <span className="th-kind" data-kind={theme.kind}>
            {KIND_LABEL[theme.kind]}
          </span>
          {dates && <span className="mono">{dates}</span>}
        </p>
        <Heading className="th-card-title">
          <Link href={href} className="th-card-link">
            {theme.title}
          </Link>
        </Heading>
        {theme.subtitle && <p className="th-card-sub">{theme.subtitle}</p>}
        <p className="th-card-foot">
          <Link href={`/@${theme.ownerHandle}`} className="th-owner">
            @{theme.ownerHandle}
          </Link>
          <span className="mono">{theme.photoCount} 张</span>
        </p>
      </div>
    </article>
  );
}
