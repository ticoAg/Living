import { useEffect } from 'react';

/** `<title>` for the page while it is mounted. */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · Living`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/** Pages replace each other without a reload, so start each one at the top. */
export function useScrollTop(dep?: unknown) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [dep]);
}

/**
 * While `active`, ask before the page is left with edits unsaved: closing or reloading the tab
 * (browser prompt) and clicking any in-app link (confirm). The back button cannot be intercepted.
 */
export function useLeaveGuard(active: boolean, message = '有未保存的修改，确定离开吗？') {
  useEffect(() => {
    if (!active) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const to = new URL(a.href, location.href);
      if (to.origin !== location.origin || (to.pathname === location.pathname && to.search === location.search)) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    // capture phase: runs before the router sees the click
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active, message]);
}
