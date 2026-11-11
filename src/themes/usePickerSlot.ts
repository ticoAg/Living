import { useCallback, useState } from 'react';

/**
 * Whether the editor's photo picker is open, and where its photos go: after the row whose menu opened it, or at the
 * end (the toolbar's 添加照片). The insertion point is kept after closing; the next opening sets it again.
 */
export function usePickerSlot() {
  const [open, setOpen] = useState(false);
  const [after, setAfter] = useState<string | null>(null);
  const openAt = useCallback((key: string | null) => {
    setAfter(key);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  return { open, after, openAt, close };
}
