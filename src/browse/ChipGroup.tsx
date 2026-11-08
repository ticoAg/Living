export interface ChipDef {
  id: string;
  label: string;
  /** no photos would be left */
  disabled?: boolean;
}

/** A row of toggle chips (`.chip`) with the pressed ones marked. Used for time-of-day, season and light filters. */
export default function ChipGroup({
  label,
  chips,
  selected,
  onPick
}: {
  label: string;
  chips: readonly ChipDef[];
  selected: readonly string[];
  onPick: (id: string) => void;
}) {
  if (!chips.length) return null;
  return (
    <div className="bw-chips" role="group" aria-label={label}>
      {chips.map((c) => {
        const pressed = selected.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            className="chip"
            aria-pressed={pressed}
            disabled={!pressed && c.disabled}
            onClick={() => onPick(c.id)}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
