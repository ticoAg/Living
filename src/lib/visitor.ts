import { createContext, useContext } from 'react';

// The visitor view: a page as someone who is not signed in sees it, opened from one's own pages with ?as=visitor.
// Inside it the requests go without cookies (lib/useApi.ts), the pages see no one signed in (AsVisitor in
// lib/session.tsx), and links to other pages a visitor can open keep the view (components/VisitorView.tsx).
// Docs: /docs/product/features/showcase.md#访客视角

const PARAM = 'as';
const VALUE = 'visitor';

/** True inside the visitor view. */
export const VisitorContext = createContext(false);
export const useVisitor = () => useContext(VisitorContext);

/** Pages a visitor can open. A link to one keeps the visitor view; any other link leaves it. */
const VISITOR_PAGES =
  /^\/(?:|(?:@|%40)[^/]+(?:\/works|\/articles)?\/?|e\/[^/]+|t\/[^/]+|projects\/(?!new$)[^/]+|p\/[^/]+|place\/[^/]+|map|index|themes|living)$/i;

/** A query string (with or without its "?") that opens the visitor view. */
export const isVisitorSearch = (search: string): boolean => new URLSearchParams(search).get(PARAM) === VALUE;

/** `query` (without its "?") for a page that rewrites its own address: still in the visitor view if `search` is. */
export const keepVisitor = (query: string, search: string): string =>
  isVisitorSearch(search) ? `${query ? `${query}&` : ''}${PARAM}=${VALUE}` : query;

function parse(href: string): URL | null {
  try {
    const url = new URL(href, 'http://app.invalid/');
    return url.origin === 'http://app.invalid' ? url : null;
  } catch {
    return null;
  }
}

/** `href` (a path of the app) in the visitor view, if a visitor can open it; anything else as it is. */
export function withVisitor(href: string): string {
  const url = parse(href);
  if (!url || !href.startsWith('/') || href.startsWith('//') || !VISITOR_PAGES.test(url.pathname)) return href;
  url.searchParams.set(PARAM, VALUE);
  return url.pathname + url.search + url.hash;
}

/** `href` (a path of the app) out of the visitor view. */
export function withoutVisitor(href: string): string {
  const url = parse(href);
  if (!url || !href.startsWith('/') || href.startsWith('//') || !url.searchParams.has(PARAM)) return href;
  url.searchParams.delete(PARAM);
  return url.pathname + url.search + url.hash;
}
