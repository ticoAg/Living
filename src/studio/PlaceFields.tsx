import { useId, useRef, type KeyboardEvent } from 'react';
import { POI_CATEGORIES, POI_LIMITS } from '../../shared/types';
import { CategoryIcon, Icon } from '../components/icons';
import { aliasesOf, type PlaceDraft, type PlaceProblems } from './place-draft';

// The name, category and aliases of a place (the /studio/place/:id form). The radius has its own block, PlaceRadius.

interface Props {
  value: PlaceDraft;
  problems: PlaceProblems;
  onChange: (patch: Partial<PlaceDraft>) => void;
  disabled?: boolean;
}

export default function PlaceFields({ value, problems, onChange, disabled }: Props) {
  const id = useId();
  const aliasBox = useRef<HTMLInputElement>(null);
  const typed = value.aliasText.trim() !== '';

  const addAlias = () => {
    if (!typed) return;
    onChange({ aliases: aliasesOf(value), aliasText: '' });
    aliasBox.current?.focus();
  };
  const removeAlias = (alias: string) => {
    onChange({ aliases: value.aliases.filter((a) => a !== alias) });
    aliasBox.current?.focus();
  };
  const onAliasKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    // Enter here adds the alias; it must never save the whole form
    e.preventDefault();
    // Safari reports the Enter that confirms an IME candidate as keyCode 229, after the composition has ended
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    addAlias();
  };

  return (
    <div className="pl-fields">
      <div className="field">
        <label className="label" htmlFor={`${id}-name`}>
          名称
        </label>
        <input
          id={`${id}-name`}
          className="input"
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          maxLength={POI_LIMITS.nameMax}
          autoComplete="off"
          disabled={disabled}
          aria-invalid={!!problems.name}
          aria-describedby={problems.name ? `${id}-name-err` : undefined}
        />
        {problems.name && (
          <span id={`${id}-name-err`} className="error-text small">
            {problems.name}
          </span>
        )}
      </div>

      <div className="field">
        <span className="label" id={`${id}-cat`}>
          类别
        </span>
        <div className="pl-cats" role="radiogroup" aria-labelledby={`${id}-cat`}>
          {POI_CATEGORIES.map((c) => (
            <label key={c} className="pl-cat" data-checked={value.category === c} data-disabled={disabled || undefined}>
              <input
                type="radio"
                name={`${id}-cat`}
                className="visually-hidden"
                checked={value.category === c}
                onChange={() => onChange({ category: c })}
                disabled={disabled}
              />
              <CategoryIcon category={c} size={20} />
              {c}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-alias`}>
          别名
        </label>
        {value.aliases.length > 0 && (
          <ul className="pl-aliases" aria-label="已添加的别名">
            {value.aliases.map((a) => (
              <li key={a} className="pl-alias">
                <span>{a}</span>
                <button type="button" aria-label={`移除别名 ${a}`} onClick={() => removeAlias(a)} disabled={disabled}>
                  <Icon name="close" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="pl-add">
          <input
            ref={aliasBox}
            id={`${id}-alias`}
            className="input"
            value={value.aliasText}
            onChange={(e) => onChange({ aliasText: e.target.value })}
            onKeyDown={onAliasKey}
            maxLength={POI_LIMITS.aliasMax}
            placeholder="搜索时也能找到，如 断桥残雪"
            autoComplete="off"
            enterKeyHint="done"
            disabled={disabled}
            aria-invalid={!!problems.aliases}
            aria-describedby={problems.aliases ? `${id}-alias-err` : undefined}
          />
          <button type="button" className="btn" onClick={addAlias} disabled={disabled || !typed}>
            <Icon name="plus" size={16} />
            添加
          </button>
        </div>
        {problems.aliases && (
          <span id={`${id}-alias-err`} className="error-text small">
            {problems.aliases}
          </span>
        )}
      </div>
    </div>
  );
}
