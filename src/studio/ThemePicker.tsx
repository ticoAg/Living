import { Link } from 'wouter';
import type { ThemeSummary } from '../../shared/types';
import { useApi } from '../lib/useApi';
import { useKeep } from './util';

// Theme toggles for the upload form and the upload batch panel.

/** The user's themes as toggles; editing several photos, a theme only some of them are in is drawn half-on. */
export default function ThemePicker({
  value,
  mixed = [],
  onToggle,
  disabled
}: {
  value: readonly string[];
  mixed?: readonly string[];
  onToggle: (id: string, on: boolean) => void;
  disabled?: boolean;
}) {
  const { data, error, reload } = useApi<{ themes: ThemeSummary[] }>('/api/themes?mine=1');
  const kept = useKeep(data);
  const themes = kept?.themes ?? [];
  if (!kept && !error) return <p className="small muted">主题加载中…</p>;
  if (!kept && error) {
    return (
      <p className="small error-text">
        主题加载失败。
        <button type="button" className="btn btn-quiet" onClick={reload}>
          重试
        </button>
      </p>
    );
  }
  if (!themes.length) {
    return (
      <p className="small muted up-themes-none">
        还没有主题，
        <Link href="/themes/new" target="_blank" rel="noopener">
          新建一个
        </Link>
      </p>
    );
  }
  return (
    <div className="up-themes" role="group" aria-label="加入主题">
      {themes.map((t) => {
        const on = value.includes(t.id);
        return (
          <button
            key={t.id}
            type="button"
            className="chip chip-outline up-theme"
            aria-pressed={on ? true : mixed.includes(t.id) ? 'mixed' : false}
            disabled={disabled}
            onClick={() => onToggle(t.id, !on)}
          >
            <span>{t.title}</span>
            <span className="small up-theme-kind">{t.kind === 'trip' ? '旅程' : '专题'}</span>
          </button>
        );
      })}
    </div>
  );
}
