import { useEffect, useId, useRef, type ReactNode } from 'react';
import '../styles/picker.css';

// The modal the pickers share (PhotoPicker, themes/EntryPicker): it follows `open`, and Esc or a press on the backdrop
// closes it. Its body is only rendered while open, so a picker starts fresh each time.

interface Props {
  open: boolean;
  onClose: () => void;
  /** the body, given the id its heading must carry */
  children: (titleId: string) => ReactNode;
}

export default function PickerDialog({ open, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // a press that starts inside the panel and ends on the backdrop (text selection, a date picker) must not close it
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="pp"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onMouseDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      {open && children(titleId)}
    </dialog>
  );
}
