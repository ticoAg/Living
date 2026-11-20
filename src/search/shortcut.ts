import { useEffect, useLayoutEffect, useRef } from 'react';

// "/" opens the search from anywhere, as on many sites; on the search page it puts the cursor in the box.
// Docs: /docs/product/features/search.md

/** The search page's box. */
export const SEARCH_INPUT_ID = 'search-q';

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function useSearchShortcut(enabled: boolean, open: () => void): void {
  // One listener for the life of the header, reading the latest state through a ref set before the browser paints:
  // the key works as soon as the search button shows. A listener added once signed in came in after the paint, and a
  // key pressed in between was lost.
  const live = useRef({ enabled, open });
  useLayoutEffect(() => {
    live.current = { enabled, open };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!live.current.enabled) return;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || typing(e.target)) return;
      e.preventDefault();
      const box = document.getElementById(SEARCH_INPUT_ID);
      if (box) box.focus();
      else live.current.open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
