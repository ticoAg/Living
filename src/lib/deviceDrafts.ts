// Unsaved writing kept on this device (the entry editor's backups, entries/draft.ts) until the server has it. It is
// the signed-in person's, so signing out on this device takes it away.

export const DEVICE_DRAFT_PREFIX = 'living.entryDraft.';

export function clearDeviceDrafts(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(DEVICE_DRAFT_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // storage refused: there is nothing kept to clear
  }
}
