import { useEffect } from 'react';

// "/" opens the search from anywhere, as on many sites; on the search page it puts the cursor in the box.
// Docs: /docs/product/features/search.md

/** The search page's box. */
export const SEARCH_INPUT_ID = 'search-q';

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function useSearchShortcut(enabled: boolean, open: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || typing(e.target)) return;
      e.preventDefault();
      const box = document.getElementById(SEARCH_INPUT_ID);
      if (box) box.focus();
      else open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, open]);
}
