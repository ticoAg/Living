import { Link } from 'wouter';
import { entryLabel, entryTypeLabel } from '../../shared/entries';
import type { EntrySummary } from '../../shared/types';
import { entryHref } from '../entries/EntryCard';
import Markdown from '../entries/Markdown';
import { fmtDay } from '../lib/format';
import { VISIBILITY_LABEL } from '../themes/util';
import { fmtLength } from './showcase';

/** An article in a list: its title, the start of its text, its day and length. Untitled, the start is its title. */
export default function ArticleRow({ entry: e, own }: { entry: EntrySummary; own?: boolean }) {
  const label = entryLabel(e.title, e.excerpt) || entryTypeLabel(e.type);
  const mark = own && e.visibility !== 'public' ? `${VISIBILITY_LABEL[e.visibility]}可见` : '';
  const length = fmtLength(e.chars);
  return (
    <Link href={entryHref(e)} className="sc-article" aria-label={[label, fmtDay(e.occurredAt), length, mark].filter(Boolean).join('，')}>
      <span className="sc-article-title">{label}</span>
      {e.title && e.excerpt && <Markdown text={e.excerpt} compact className="sc-article-text" />}
      <span className="sc-article-meta">
        <span className="mono">{fmtDay(e.occurredAt)}</span>
        <span>{length}</span>
        {mark && <em>{mark}</em>}
      </span>
    </Link>
  );
}
