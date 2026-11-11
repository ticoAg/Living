import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The settings drawer. Opening it moves focus to its close button; closing it while focus is inside returns focus
 * to the bar's 设置 button. `everOpened` lets the page fetch the tag list the first time it opens.
 */
export function useDrawer() {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  const openDrawer = useCallback(() => {
    setEverOpened(true);
    setOpen(true);
  }, []);
  const closeDrawer = useCallback(() => {
    restoreFocus.current = !!document.getElementById('lv-drawer')?.contains(document.activeElement);
    setOpen(false);
  }, []);
  const toggleDrawer = useCallback(() => (open ? closeDrawer() : openDrawer()), [open, closeDrawer, openDrawer]);

  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true });
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      settingsRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  return { open, everOpened, closeDrawer, toggleDrawer, closeRef, settingsRef };
}
