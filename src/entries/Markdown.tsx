import { Fragment, useMemo, type ReactNode } from 'react';
import { Link as RouteLink } from 'wouter';
import { parseMarkdown, type Block, type Inline, type ListItem } from './markdown';

// An entry's Markdown, from the tree markdown.ts parses. Every piece is a React element or a text node, so
// nothing in an entry can become HTML. `compact` is for timeline cards, where the whole card is one link: headings
// are bold paragraphs (they would clutter the page outline), and links are plain spans (a link cannot hold one).

/** Paths the Worker answers (files, the API); every other path on the site is a page of the app. */
const SERVED = /^\/(?:api|media)(?:[/?#]|$)/;

function Link({ href, external, className, children }: { href: string; external: boolean; className?: string; children: ReactNode }) {
  if (external) {
    return (
      <a className={className} href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
        {children}
      </a>
    );
  }
  // a page of the app opens without reloading it
  return SERVED.test(href) ? (
    <a className={className} href={href}>
      {children}
    </a>
  ) : (
    <RouteLink className={className} href={href}>
      {children}
    </RouteLink>
  );
}

function inlines(nodes: Inline[], compact: boolean): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return n.text;
      case 'break':
        return <br key={i} />;
      case 'code':
        return <code key={i}>{n.text}</code>;
      case 'em':
        return <em key={i}>{inlines(n.children, compact)}</em>;
      case 'strong':
        return <strong key={i}>{inlines(n.children, compact)}</strong>;
      case 'del':
        return <del key={i}>{inlines(n.children, compact)}</del>;
      case 'link':
        return compact ? (
          <span key={i} className="md-link">
            {inlines(n.children, compact)}
          </span>
        ) : (
          <Link key={i} href={n.href} external={n.external}>
            {inlines(n.children, compact)}
          </Link>
        );
      case 'image':
        // never an <img>: an entry must not load remote images
        return compact ? (
          n.alt
        ) : (
          <Link key={i} className="md-img" href={n.href} external={n.external}>
            {n.alt}
          </Link>
        );
    }
  });
}

/** In a tight list, an item's paragraphs are bare text. */
function blocks(nodes: Block[], compact: boolean, tight = false): ReactNode[] {
  return nodes.map((b, i) => {
    switch (b.type) {
      case 'paragraph':
        return tight ? <Fragment key={i}>{inlines(b.children, compact)}</Fragment> : <p key={i}>{inlines(b.children, compact)}</p>;
      case 'heading': {
        if (compact) {
          return (
            <p key={i} className="md-h">
              <strong>{inlines(b.children, compact)}</strong>
            </p>
          );
        }
        // the page's own <h1> is the entry title, so # is an <h2>
        const H = `h${Math.min(b.level + 1, 6)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        return <H key={i}>{inlines(b.children, compact)}</H>;
      }
      case 'quote':
        return <blockquote key={i}>{blocks(b.children, compact)}</blockquote>;
      case 'list': {
        const items = b.items.map((item, j) => (
          <li key={j} className={item.checked === null ? undefined : 'md-task-item'}>
            {itemContent(item, b.tight, compact)}
          </li>
        ));
        return b.ordered ? (
          <ol key={i} start={b.start === 1 ? undefined : b.start}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        );
      }
      case 'code':
        return (
          <pre key={i} className="md-code">
            <code data-lang={b.lang || undefined}>{b.text}</code>
          </pre>
        );
      case 'hr':
        return <hr key={i} />;
    }
  });
}

function itemContent(item: ListItem, tight: boolean, compact: boolean): ReactNode {
  if (item.checked === null) return blocks(item.children, compact, tight);
  // not an <input>: cards are links, which cannot hold interactive content
  const box = (
    <span className="md-task" data-done={item.checked ? 'true' : undefined} role="img" aria-label={item.checked ? '已完成' : '未完成'} />
  );
  const [first, ...rest] = item.children;
  // in a loose list the box goes inside the first paragraph, to stay on its line
  if (tight || first?.type !== 'paragraph') {
    return (
      <>
        {box}
        {blocks(item.children, compact, tight)}
      </>
    );
  }
  return (
    <>
      <p>
        {box}
        {inlines(first.children, compact)}
      </p>
      {blocks(rest, compact)}
    </>
  );
}

export default function Markdown({ text, compact, className }: { text: string | null | undefined; compact?: boolean; className?: string }) {
  const tree = useMemo(() => parseMarkdown(text ?? ''), [text]);
  if (!tree.length) return null;
  return <div className={`md${compact ? ' md-compact' : ''}${className ? ` ${className}` : ''}`}>{blocks(tree, !!compact)}</div>;
}
