// Recovery from page chunks that no longer exist. Every deploy replaces the hashed files under /assets/, so a tab
// opened before it asks for chunks that are gone. The cure is a full page load, which fetches the new index.html
// and with it the new chunk names. A session flag allows one such load per minute, so a chunk that keeps failing
// (offline, a broken deploy) ends on the error state instead of reloading forever.
// Docs: /docs/architecture/frontend.md#分块失效与错误

const KEY = 'living:chunk-reload';
const WINDOW_MS = 60_000;

/** Errors Vite reported through `vite:preloadError`: what the browser calls them differs between engines. */
const reported = new WeakSet<object>();
/** A chunk failed in the background: the build this tab runs has been replaced. */
let stale = false;
let reloading = false;

const MESSAGES = [
  'Failed to fetch dynamically imported module', // Chromium
  'error loading dynamically imported module', // Firefox
  'Importing a module script failed', // Safari
  'Unable to preload CSS' // Vite's own, for a page's stylesheet
];

/** Whether `e` is a failed page chunk (as opposed to a page that threw while rendering). */
export function isChunkError(e: unknown): boolean {
  if (typeof e === 'object' && e !== null && reported.has(e)) return true;
  const message = e instanceof Error ? e.message : '';
  return MESSAGES.some((m) => message.includes(m));
}

function recentReload(now: number): boolean {
  try {
    const at = Number(sessionStorage.getItem(KEY));
    return at > 0 && now - at < WINDOW_MS;
  } catch {
    return false;
  }
}

/**
 * Load `url` from the server, unless that already happened in the last minute. Returns true when the page is
 * going away (also on a second call while the first load is under way), false when the caller should show an error.
 */
export function reloadOnce(url: string = location.href, now = Date.now()): boolean {
  if (reloading) return true;
  if (recentReload(now)) return false;
  try {
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // no storage (private mode, blocked): without the flag a loop could not be stopped, so do not reload
    return false;
  }
  reloading = true;
  // if the user stays (a beforeunload warning answered with "stay"), later failures are handled again
  setTimeout(() => (reloading = false), 5000);
  location.assign(url);
  return true;
}

function linkUrl(e: MouseEvent): URL | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null; // same page or an anchor
  return url;
}

/** Install the listeners. Call once at startup. */
export function startChunkRecovery(): void {
  // Vite reports every failed page import here, the background prefetches included. A prefetch failing must not
  // reload the page in front (it may hold unsaved work), so it only marks the build as stale.
  window.addEventListener('vite:preloadError', (e) => {
    const payload = (e as Event & { payload?: unknown }).payload;
    if (typeof payload === 'object' && payload !== null) reported.add(payload);
    stale = true;
  });
  // Once stale, the next in-app link loads its page from the server instead of asking the router for a chunk
  // that is likely gone. Capturing on window runs before the router's handler, and before any leave guard on
  // document: the page's own beforeunload warning still asks about unsaved work.
  window.addEventListener(
    'click',
    (e) => {
      if (!stale) return;
      const url = linkUrl(e);
      if (!url || !reloadOnce(url.href)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );
}
