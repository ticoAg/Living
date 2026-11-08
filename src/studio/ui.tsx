import { useId, type ReactNode } from 'react';

// Small form controls shared by the studio pages. Styles: src/styles/studio.css (`sf-` prefix) and base.css.

export interface SegOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

/** Segmented single choice built from real buttons. */
export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  hint
}: {
  label: string;
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className="label" id={id}>
        {label}
      </span>
      <div className="seg sf-seg" role="group" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            title={o.hint}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
}

/** On/off switch (a real checkbox with role=switch). */
export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  hint
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className="sf-toggle" data-disabled={disabled || undefined}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="sf-toggle-track" aria-hidden="true">
        <span />
      </span>
      <span className="sf-toggle-text">
        {label}
        {hint && <span className="small muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Inline two-step confirmation: first click arms the button, second click runs it. */
export function ConfirmBar({
  prompt,
  confirmLabel,
  cancelLabel = '取消',
  busy,
  onConfirm,
  onCancel
}: {
  prompt: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="sf-confirm" role="alert">
      <p className="sf-confirm-text">{prompt}</p>
      <div className="row">
        <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
          {busy ? '处理中…' : confirmLabel}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}

/** Page heading in the atlas style: spaced serif with a small caption. */
export function PageHead({ title, caption, children }: { title: string; caption?: ReactNode; children?: ReactNode }) {
  return (
    <header className="sf-head">
      <div>
        <h1 className="display display-m sf-title">{title}</h1>
        {caption && <p className="muted sf-caption">{caption}</p>}
      </div>
      {children && <div className="row sf-head-actions">{children}</div>}
    </header>
  );
}
