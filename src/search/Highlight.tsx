import { Fragment, useMemo } from 'react';
import { highlightRanges } from '../../shared/search';

// Text with the words searched for marked, as found by the search (A–Z case aside). Docs: /docs/product/features/search.md

export default function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => {
    const out: { text: string; hit: boolean }[] = [];
    let at = 0;
    for (const [start, end] of highlightRanges(text, terms)) {
      if (start > at) out.push({ text: text.slice(at, start), hit: false });
      out.push({ text: text.slice(start, end), hit: true });
      at = end;
    }
    if (at < text.length) out.push({ text: text.slice(at), hit: false });
    return out;
  }, [text, terms]);
  return <>{parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>))}</>;
}
