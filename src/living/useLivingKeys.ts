import { useEffect } from 'react';
import { useLatest, type FullscreenApi } from './hooks';

export interface KeyActions {
  go: (delta: number) => void;
  togglePause: () => void;
  toggleFields: () => void;
  toggleDrawer: () => void;
  closeDrawer: () => void;
  drawerOpen: boolean;
  fs: FullscreenApi;
  leave: () => void;
  /** show the controls */
  poke: () => void;
}

/**
 * Living's keys: ← → move, Space pauses, I fields, S settings, F fullscreen, Esc steps out one level at a time.
 * Every key shows the controls. Keys typed into a field, and Space on a focused button, are left alone.
 */
export function useLivingKeys(latest: KeyActions) {
  const actions = useLatest(latest);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const a = actions.current;
      a.poke();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        a.go(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (e.repeat) return;
      if (e.key === ' ' || e.key === 'Spacebar') {
        // On a focused button Space is that button's own click.
        if (t?.closest('button, a[href], summary, [role="button"]')) return;
        e.preventDefault();
        a.togglePause();
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'i':
          a.toggleFields();
          break;
        case 's':
          a.toggleDrawer();
          break;
        case 'f':
          a.fs.toggle();
          break;
        case 'escape':
          // One Esc at a time: leave fullscreen, then close the drawer, then leave Living.
          // (Browsers usually swallow the Esc that ends fullscreen; justExited covers those that do not.)
          if (a.fs.active || a.fs.justExited()) {
            if (a.fs.active) a.fs.exit();
          } else if (a.drawerOpen) a.closeDrawer();
          else a.leave();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions]);
}
